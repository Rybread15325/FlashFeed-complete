"""
Chart data service — sentiment-scout chart backend, carved out as a standalone
Flask service for the FlashFeed (sentiment-scout-v2) repo.

Routes live under a dedicated /api/sentchart prefix so they never shadow Ryan's
own /api/charts/<ticker> (Yahoo) route in the Node backend.
  • /api/sentchart/chart            — legacy line series (labels/prices/volumes)
  • /api/sentchart/charts/<ticker>  — 1-min OHLC candles + RSI(14)/MACD(12,26,9)/Bollinger(20,2)
  • /api/sentchart/chart/social     — density + sentiment overlays (phase-2b: live
                                      StockTwits walk + Mongo store, SQLite seed fallback)
  • /api/health                     — liveness + whether FINVIZ_TOKEN is configured

Data path is our exact one: Finviz Elite `quote_export?p=i1` 1-minute extended-hours
bars fetched via curl_cffi (chrome124 impersonation), walked back up to 5 sessions.

This is a faithful extraction of the chart slice from sentiment-scout/dashboard.py
(num, _fetch_intraday_bars, _latest_session_bars, build_chart, _ema_list,
_rsi_series, _macd_series, _bollinger_series) plus the two constants it needs from
correlation_engine (EDT, CURL_HEADERS). Nothing else from dashboard.py is imported,
because importing dashboard runs database.init_db() + pulls in the full screener /
social / AI / adapter stack at module load. See chart-service/README.md.

ENV RECONCILIATION: this service reads FINVIZ_TOKEN (our canonical name). Ryan's
repo previously used FINVIZ_AUTH_TOKEN; docker-compose bridges it (see compose).
"""

import csv
import io
import json
import os
import re
import sqlite3
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from curl_cffi import requests as cffi_requests
from flask import Flask, jsonify, request

import social_store   # phase-2b: StockTwits walk + Mongo/in-memory resting store

# ── Constants copied verbatim from sentiment-scout/correlation_engine.py ──────
# (correlation_engine itself imports social_store + config at module top, which
# would drag the social pipeline / DB into this candle-only service, so we copy
# just the two values the Finviz fetch needs.)
EDT = ZoneInfo("America/New_York")

CURL_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finviz.com/",
}


# ── .env loader (minimal, no dependency) — mirrors sentiment-scout/config.py ──
def _load_dotenv():
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(env_file):
        return
    with open(env_file, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


def get_finviz_token() -> str:
    """Finviz Elite token. Canonical name is FINVIZ_TOKEN (our convention); we
    also accept Ryan's legacy FINVIZ_AUTH_TOKEN as a fallback so an existing
    .env keeps working. Fail-loud if neither is set (no baked-in fallback)."""
    tok = os.environ.get("FINVIZ_TOKEN") or os.environ.get("FINVIZ_AUTH_TOKEN")
    if not tok or not tok.strip():
        raise RuntimeError(
            "FINVIZ_TOKEN is not set. Add it to chart-service/.env "
            "(copy .env.example). There is no baked-in fallback."
        )
    return tok.strip()


def has_finviz_token() -> bool:
    return bool(os.environ.get("FINVIZ_TOKEN") or os.environ.get("FINVIZ_AUTH_TOKEN"))


# ── Numeric parse helper — verbatim from dashboard.py:num ─────────────────────
def num(val):
    """Parse Finviz-style numeric strings ("-11.43%", "3.5", "1,234") -> float."""
    s = str(val if val is not None else "").replace(",", "").replace("%", "").strip()
    if not s or s in ("-", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ── Finviz 1-min OHLC fetch — verbatim from dashboard.py:_fetch_intraday_bars ─
_chart_cache: dict = {}          # (ticker, date) -> {"ts": epoch, "bars": [...]}
_CHART_CACHE_TTL = 60


def _fetch_intraday_bars(ticker: str, date_str: str):
    """1-min close+volume bars for one ticker/day. Returns list of bars,
    or a dict {"error": ...} on auth/transport failure."""
    key = (ticker, date_str)
    hit = _chart_cache.get(key)
    if hit and time.time() - hit["ts"] < _CHART_CACHE_TTL:
        return hit["bars"]

    try:
        dt_obj = datetime.strptime(date_str, "%Y-%m-%d")
        fdate = f"{dt_obj.month}/{dt_obj.day}/{dt_obj.year}"
    except ValueError:
        fdate = date_str
    url = (
        f"https://elite.finviz.com/quote_export"
        f"?t={ticker}&p=i1&s={fdate}&e={fdate}&auth={get_finviz_token()}"
    )
    try:
        session = cffi_requests.Session()
        # Retry on rate-limit responses: when a background poll (e.g. multicap) is
        # mid-burst, Finviz Elite can answer this on-demand call with 429 — or
        # escalate to a transient 401/403 — even though the token is valid. A short
        # backoff lets the burst clear so the chart still loads. A genuinely dead
        # token stays 401 across all retries and surfaces the auth error below.
        resp = None
        for attempt in range(3):
            resp = session.get(url, headers=CURL_HEADERS,
                               impersonate="chrome124", timeout=25)
            if resp.status_code in (429, 401, 403) and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            break
        if resp.status_code in (401, 403):
            return {"error": f"Finviz auth failed (HTTP {resp.status_code}) — token may be expired"}
        if resp.status_code == 429:
            return {"error": "Finviz rate-limited (HTTP 429) — try again in a moment."}
        if resp.status_code in (400, 404):
            return {"error": f"No data for {ticker} — check the ticker symbol."}
        resp.raise_for_status()
        body = resp.text
        if body.lstrip().startswith("<"):
            return {"error": "Finviz returned non-CSV response — token may be expired"}
        # quote_export?p=i1 ignores s/e and returns ~11 days of bars; times are
        # 24-hour with a decorative AM/PM suffix ("19:55 PM"), so strip-and-%H:%M
        # is correct. Group by day and cache every day returned — the walk-back
        # over previous days then costs zero extra requests.
        by_day: dict = {}
        for row in csv.DictReader(io.StringIO(body)):
            raw = (row.get("Date") or row.get("date") or "").strip()
            raw = re.sub(r"\s*(AM|PM)$", "", raw, flags=re.IGNORECASE).strip()
            close = num(row.get("Close") or row.get("close"))
            o = num(row.get("Open") or row.get("open"))
            hi = num(row.get("High") or row.get("high"))
            lo = num(row.get("Low") or row.get("low"))
            vol = num(row.get("Volume") or row.get("volume"))
            if not raw or close is None:
                continue
            try:
                ts = datetime.strptime(raw, "%m/%d/%Y %H:%M")
            except ValueError:
                continue
            # Keep true O/H/L (lightweight-charts candles need them); fall back to
            # close for any missing field. build_chart only reads close/volume/ts,
            # so these extra keys are additive and don't affect the legacy chart.
            by_day.setdefault(ts.strftime("%Y-%m-%d"), []).append(
                {"ts": ts,
                 "open": o if o is not None else close,
                 "high": hi if hi is not None else close,
                 "low": lo if lo is not None else close,
                 "close": close, "volume": int(vol or 0)})
        now = time.time()
        for day, day_bars in by_day.items():
            day_bars.sort(key=lambda b: b["ts"])
            _chart_cache[(ticker, day)] = {"ts": now, "bars": day_bars}
        if date_str not in by_day:   # cache the miss so walk-back doesn't refetch
            _chart_cache[key] = {"ts": now, "bars": []}
        return _chart_cache[key]["bars"]
    except Exception as exc:
        return {"error": f"Intraday fetch failed: {exc}"}


def _latest_session_bars(ticker: str):
    """Most recent session with data: try today (ET), walk back up to 4 days.
    Returns (bars, date_str). On auth/transport/no-data error, bars is an
    {"error": ...} dict and date_str is None."""
    now_et = datetime.now(EDT)
    for back in range(5):
        d = (now_et - timedelta(days=back)).strftime("%Y-%m-%d")
        result = _fetch_intraday_bars(ticker, d)
        if isinstance(result, dict):          # auth/transport error — stop immediately
            return result, None
        if result:
            return result, d
    return {"error": f"No intraday data for {ticker} in the last 5 days."}, None


def build_chart(ticker: str, window: str, date_req: str = "") -> dict:
    if window not in ("full", "2h", "1h"):
        window = "full"

    # Optional pinned historical session (else latest) — see /api/charts ?date note.
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_req or ""):
        res = _fetch_intraday_bars(ticker, date_req)
        if isinstance(res, dict):
            return {**res, "ticker": ticker}
        bars, date_used = (res, date_req) if res else ([], None)
    else:
        bars, date_used = _latest_session_bars(ticker)
    if date_used is None:
        return {"error": f"No intraday data for {ticker} on {date_req or 'recent sessions'}.", "ticker": ticker}

    if window in ("2h", "1h"):
        cutoff = bars[-1]["ts"] - timedelta(hours=2 if window == "2h" else 1)
        bars = [b for b in bars if b["ts"] >= cutoff]

    return {
        "ticker": ticker,
        "date": date_used,
        "window": window,
        "n": len(bars),
        "labels": [b["ts"].strftime("%H:%M") for b in bars],
        "prices": [b["close"] for b in bars],
        "volumes": [b["volume"] for b in bars],
        "open": bars[0]["close"],
        "last": bars[-1]["close"],
    }


# ── Indicators — verbatim from dashboard.py (pure python, no numpy/pandas) ────
def _ema_list(values, period):
    """Exponential moving average over the full series (seeded with values[0])."""
    if not values:
        return []
    k = 2.0 / (period + 1)
    out, ema = [], None
    for v in values:
        ema = v if ema is None else (v - ema) * k + ema
        out.append(ema)
    return out


def _rsi_series(times, closes, period=14):
    """Wilder's RSI(period). First value at close index `period`."""
    n = len(closes)
    if n < period + 1:
        return []
    ch = [closes[i] - closes[i - 1] for i in range(1, n)]
    gains = [c if c > 0 else 0.0 for c in ch]
    losses = [-c if c < 0 else 0.0 for c in ch]
    ag = sum(gains[:period]) / period
    al = sum(losses[:period]) / period

    def _val(ag, al):
        if al == 0:
            return 100.0
        rs = ag / al
        return 100.0 - 100.0 / (1.0 + rs)

    out = [{"time": times[period], "value": round(_val(ag, al), 2)}]
    for i in range(period, len(ch)):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
        out.append({"time": times[i + 1], "value": round(_val(ag, al), 2)})
    return out


def _macd_series(times, closes, fast=12, slow=26, signal=9):
    """MACD(fast,slow,signal): line = EMAfast - EMAslow, signal = EMAsignal(line),
    histogram = line - signal. Emitted from index slow-1 to skip EMA warmup."""
    n = len(closes)
    if n < slow:
        return {"macd": [], "signal": [], "histogram": []}
    ef, es = _ema_list(closes, fast), _ema_list(closes, slow)
    line = [ef[i] - es[i] for i in range(n)]
    sig = _ema_list(line, signal)
    m, s, h = [], [], []
    for i in range(slow - 1, n):
        m.append({"time": times[i], "value": round(line[i], 4)})
        s.append({"time": times[i], "value": round(sig[i], 4)})
        h.append({"time": times[i], "value": round(line[i] - sig[i], 4)})
    return {"macd": m, "signal": s, "histogram": h}


def _bollinger_series(times, closes, period=20, mult=2.0):
    """Bollinger(period, mult): basis = SMA, upper/lower = basis +/- mult*stddev."""
    n = len(closes)
    if n < period:
        return {"upper": [], "lower": [], "basis": []}
    up, lo, ba = [], [], []
    for i in range(period - 1, n):
        win = closes[i - period + 1:i + 1]
        m = sum(win) / period
        sd = (sum((x - m) ** 2 for x in win) / period) ** 0.5
        up.append({"time": times[i], "value": round(m + mult * sd, 4)})
        lo.append({"time": times[i], "value": round(m - mult * sd, 4)})
        ba.append({"time": times[i], "value": round(m, 4)})
    return {"upper": up, "lower": lo, "basis": ba}


# ── SOCIAL OVERLAYS: READ LAYER (phase 2) ────────────────────────────────────
# Density + sentiment series for the Charts overlays, computed from ALREADY-STORED
# social data. This is the READ/compute half only — it does NOT fetch fresh data.
#
# Provenance: faithful extraction from sentiment-scout/dashboard.py
# (_stored_social_messages, _build_social_series, _smooth_same) + social_store.py
# (social_window, EDT). In sentiment-scout the live resting store is MongoDB
# (sentiment_scout.social_history), populated by the StockTwits "walking" backfill;
# _stored_social_messages is the seed_fn fallback that reads the dashboard's SQLite
# ticker_insights.stocktwits_posts snapshots. We use THAT SQLite path here because
# it is file-based and copyable — a point-in-time snapshot, no live fetch. The
# Mongo store + live walk (the WRITE/backfill half) are deferred to phase 2b.

# Path to the copied point-in-time SQLite snapshot (our sentiment_screener.db).
SOCIAL_DB_PATH = os.environ.get(
    "SOCIAL_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "social_snapshot.db"))
SOCIAL_SOURCE = "store(sqlite-snapshot)"   # truthful: snapshot read, not live

WIN_START_H = 4    # 04:00 ET session start (research window)
WIN_END_H = 20     # 20:00 ET session end


def social_window(date_str: str):
    """ET session window [04:00, 20:00] for date_str. Verbatim from social_store."""
    y, m, d = (int(x) for x in date_str.split("-"))
    return (datetime(y, m, d, WIN_START_H, 0, 0),
            datetime(y, m, d, WIN_END_H, 0, 0))


def _smooth_same(values: list, k: int = 15) -> list:
    """Pure-python np.convolve(values, ones(k)/k, mode='same'): centered k-wide
    mean with zero padding at the edges. Verbatim from dashboard._smooth_same;
    skips smoothing entirely when len < k (matches the research scripts)."""
    n = len(values)
    if n < k:
        return list(values)
    lead = (k - 1) // 2
    out = []
    for i in range(n):
        s = 0.0
        for j in range(i - lead, i - lead + k):
            if 0 <= j < n:
                s += values[j]
        out.append(s / k)
    return out


def _stored_social_messages(ticker: str, date_str: str) -> list:
    """Every stored StockTwits post for ticker on date_str (ET), deduped across
    snapshot rows. Returns [(naive_et_dt, sentiment|None)]. Reads the SQLite
    ticker_insights.stocktwits_posts snapshots — verbatim logic from
    dashboard._stored_social_messages, with the sqlite read inlined (no live walk).
    """
    if not os.path.exists(SOCIAL_DB_PATH):
        return []
    conn = sqlite3.connect(SOCIAL_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT stocktwits_posts FROM ticker_insights "
            "WHERE ticker=? AND stocktwits_posts IS NOT NULL AND stocktwits_posts != ''",
            (ticker,)).fetchall()
    finally:
        conn.close()
    win_start, win_end = social_window(date_str)
    seen, msgs = set(), []
    for r in rows:
        try:
            posts = json.loads(r["stocktwits_posts"] or "[]")
        except Exception:
            continue
        for p in posts:
            ts = p.get("timestamp") or ""
            key = (ts, p.get("username", ""), (p.get("text") or "")[:80])
            if not ts or key in seen:
                continue
            seen.add(key)
            try:
                dt_utc = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                continue
            dt_et = dt_utc.astimezone(EDT).replace(tzinfo=None)
            if win_start <= dt_et <= win_end:
                msgs.append((dt_et, p.get("sentiment")))
    return msgs


# Wire the SQLite snapshot in as social_store's seed fallback: when a live
# StockTwits walk returns nothing (quiet ticker / rate-limited / old date out of
# StockTwits' reach), the resting-store walk seeds from these snapshots instead.
social_store.seed_fn = _stored_social_messages


def _build_social_series(msgs: list, date_str: str) -> dict:
    """per-minute counts -> zero-filled timeline -> 15-min rolling average;
    5-min sentiment windows sliding 1 min keyed by window start. Verbatim from
    dashboard._build_social_series."""
    win_start, win_end = social_window(date_str)

    minute_total = Counter()
    minute_bull = Counter()
    minute_bear = Counter()
    for dt_et, sent in msgs:
        b = dt_et.replace(second=0, microsecond=0)
        minute_total[b] += 1
        if sent == "Bullish":
            minute_bull[b] += 1
        elif sent == "Bearish":
            minute_bear[b] += 1

    all_minutes, t = [], win_start
    while t <= win_end:
        all_minutes.append(t)
        t += timedelta(minutes=1)
    density = [minute_total.get(m, 0) for m in all_minutes]

    sent_labels, scores, win_density = [], [], []
    t = win_start
    while t + timedelta(minutes=5) <= win_end:
        bull = bear = total = 0
        m = t
        while m < t + timedelta(minutes=5):
            bull += minute_bull.get(m, 0)
            bear += minute_bear.get(m, 0)
            total += minute_total.get(m, 0)
            m += timedelta(minutes=1)
        tagged = bull + bear
        scores.append(round((bull - bear) / tagged, 4) if tagged else 0.0)
        win_density.append(total)
        sent_labels.append(t.strftime("%H:%M"))
        t += timedelta(minutes=1)

    return {
        "labels":         [m.strftime("%H:%M") for m in all_minutes],
        "density":        density,
        "density_smooth": [round(v, 3) for v in _smooth_same(density, 15)],
        "sent_labels":    sent_labels,
        "scores":         scores,
        "scores_smooth":  [round(v, 4) for v in _smooth_same(scores, 15)],
        "win_density":        win_density,
        "win_density_smooth": [round(v, 3) for v in _smooth_same(win_density, 15)],
        "messages":       len(msgs),
        "bullish":        int(sum(minute_bull.values())),
        "bearish":        int(sum(minute_bear.values())),
        "tagged":         int(sum(minute_bull.values()) + sum(minute_bear.values())),
    }


# ── STRATEGY INDICATOR: entry/exit signals ───────────────────────────────────
# Clean reimplementation of the professor's confirmed strategy — OUR OWN code,
# not a copy of the research scripts:
#   ENTRY: the rolling Pearson correlation between price and per-minute message
#          density (360-min window) CROSSES UP through `threshold` (default 0.10).
#   EXIT : a price trailing stop — track the post-entry peak price, exit when
#          price falls `stop_pct`% below that peak (default 30%); otherwise the
#          position is closed at session end.
#   Non-overlapping: once entered, no new entry opens until the position exits.
#
# Computed on a continuous 1-min ET grid [04:00, 20:00) with price FORWARD-FILLED
# and density ZERO-FILLED, so the 360-min window spans 360 real minutes (matches
# the research definition: rolling(360, min_periods=360).corr). Density is the raw
# per-minute message count — the same stored social messages the chart overlay
# serves (via social_store) — NOT the smoothed overlay line. Each entry/exit is
# snapped to a real candle for display.
STRAT_ROLL_WINDOW = 360
STRAT_ENTRY_THRESHOLD = 0.10
STRAT_STOP_PCT = 30.0


def _epoch_utc(ts) -> int:
    """Naive ET wall-clock encoded as a UTC unix second — the SAME convention the
    candle endpoint uses, so markers land on the chart's UTC time axis at ET time."""
    return int(ts.replace(tzinfo=timezone.utc).timestamp())


def _session_minute_grid(date_str: str) -> list:
    """Continuous 1-min ET grid [04:00, 20:00) for date_str (960 minutes),
    inclusive-left to match the research build's date_range grid."""
    win_start, win_end = social_window(date_str)        # [04:00, 20:00]
    grid, t = [], win_start
    while t < win_end:
        grid.append(t)
        t += timedelta(minutes=1)
    return grid


def _rolling_corr_pd(price: list, density: list, window: int = STRAT_ROLL_WINDOW) -> list:
    """Rolling Pearson correlation of price vs density over `window` minutes,
    defined only on a FULL window (min_periods == window, matching the research
    build). `price` may hold None for leading minutes before the first bar; any
    missing price in the window -> None. A zero-variance window -> None."""
    n = len(price)
    out = [None] * n
    for i in range(window - 1, n):
        ps = price[i - window + 1:i + 1]
        if any(p is None for p in ps):
            continue
        ds = density[i - window + 1:i + 1]
        mp = sum(ps) / window
        md = sum(ds) / window
        cov = sp = sd = 0.0
        for p, d in zip(ps, ds):
            dp, dd = p - mp, d - md
            cov += dp * dd
            sp += dp * dp
            sd += dd * dd
        if sp <= 0.0 or sd <= 0.0:                       # flat price or flat density
            continue
        out[i] = cov / (sp * sd) ** 0.5
    return out


def _compute_strategy_signals(ticker, bars, date_used, threshold, stop_pct):
    """Run the entry/exit strategy for one session. Returns (markers, stats).
    markers: [{time, type:"entry"|"exit", price, ...}], time as candle-axis epoch."""
    today = datetime.now(EDT).strftime("%Y-%m-%d")
    try:
        msgs, _doc = social_store.get_messages(ticker, date_used, today=today)
    except Exception as exc:
        print(f"  [signals] message fetch failed {ticker}|{date_used}: {exc}")
        msgs = []

    # per-minute density = raw message counts (the research `msg_density`)
    minute_count = Counter()
    for dt_et, _sent in msgs:
        minute_count[dt_et.replace(second=0, microsecond=0)] += 1

    grid = _session_minute_grid(date_used)
    density = [float(minute_count.get(m, 0)) for m in grid]

    # forward-fill price onto the grid; remember the real bar backing each minute
    bar_by_min = {b["ts"].replace(second=0, microsecond=0): b for b in bars}
    price = [None] * len(grid)
    eff_bar = [None] * len(grid)          # last actual bar at/before each grid minute
    last = None
    for idx, m in enumerate(grid):
        b = bar_by_min.get(m)
        if b is not None:
            last = b
        if last is not None:
            price[idx] = last["close"]
            eff_bar[idx] = last

    corr = _rolling_corr_pd(price, density)

    stop_frac = stop_pct / 100.0
    n = len(grid)
    markers, trades = [], 0
    i = 1
    while i < n:
        prev_c, cur_c = corr[i - 1], corr[i]
        crossed_up = (prev_c is not None and cur_c is not None
                      and prev_c < threshold <= cur_c)
        if not crossed_up:
            i += 1
            continue
        entry_bar = eff_bar[i]
        if entry_bar is None:             # corr defined but no backing bar (shouldn't happen)
            i += 1
            continue

        # hold until the price trailing stop trips, else session end
        peak = price[i]
        exit_idx = None
        j = i + 1
        while j < n:
            pj = price[j]
            if pj is not None:
                if pj > peak:
                    peak = pj
                if pj <= peak * (1 - stop_frac):
                    exit_idx = j
                    break
            j += 1
        if exit_idx is not None:
            exit_bar = eff_bar[exit_idx]
            exit_reason = "price_trailing_stop"
        else:
            exit_idx = n - 1
            exit_bar = bars[-1]           # real last candle == session end
            exit_reason = "session_end"

        markers.append({"time": _epoch_utc(entry_bar["ts"]), "type": "entry",
                        "price": round(entry_bar["close"], 4),
                        "corr": round(corr[i], 4)})
        markers.append({"time": _epoch_utc(exit_bar["ts"]), "type": "exit",
                        "price": round(exit_bar["close"], 4),
                        "reason": exit_reason})
        trades += 1
        i = exit_idx + 1                  # DE-OVERLAP: resume strictly after the exit

    stats = {"trades": trades,
             "corr_defined": sum(1 for c in corr if c is not None),
             "messages": len(msgs)}
    return markers, stats


# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)

# CORS: a deployed frontend may call cross-origin. Defaults to the Vite dev origin.
_CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "FRONTEND_ORIGIN", "http://localhost:5173").split(",") if o.strip()]
try:
    from flask_cors import CORS
    CORS(app, resources={r"/api/*": {"origins": _CORS_ORIGINS}},
         supports_credentials=False)
except ImportError:
    @app.after_request
    def _add_cors_headers(resp):
        origin = request.headers.get("Origin")
        if origin and origin in _CORS_ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin
        return resp


@app.route("/api/health")
def api_health():
    return jsonify({"ok": True, "service": "chart-service", "phase": 2,
                    "finviz_token_configured": has_finviz_token(),
                    "social_snapshot_present": os.path.exists(SOCIAL_DB_PATH),
                    "social_mode": "live StockTwits walk + Mongo store, SQLite seed fallback (phase 2b)",
                    "mongo_available": social_store.collection() is not None})


# Legacy line-series endpoint (labels/prices/volumes). Same Finviz bars.
@app.route("/api/sentchart/chart")
def api_chart():
    ticker = request.args.get("ticker", "").upper().strip()
    window = request.args.get("window", "full").lower().strip()
    date_req = (request.args.get("date") or "").strip()
    if not ticker:
        return jsonify({"error": "ticker required"})
    return jsonify(build_chart(ticker, window, date_req))


# Candlestick view: real 1-min OHLC candles + RSI(14)/MACD/Bollinger.
@app.route("/api/sentchart/charts/<ticker>")
def api_charts(ticker):
    """1-min EXTENDED-HOURS intraday OHLC from Finviz quote_export, with
    RSI(14)/MACD(12,26,9)/Bollinger(20,2). `window` is intraday (full|2h|1h);
    no daily/weekly range. Times are unix seconds with the naive ET wall-clock
    encoded as UTC, so lightweight-charts' UTC axis shows ET session time."""
    ticker = ticker.upper().strip()
    window = (request.args.get("window", "full") or "full").lower().strip()
    if window not in ("full", "2h", "1h"):
        window = "full"
    # Optional ?date=YYYY-MM-DD pins a specific historical session instead of the
    # latest one. Used to view a past session and (phase-3) to align candles with
    # the historical social snapshot for the overlay demo. Absent = latest session.
    date_req = (request.args.get("date") or "").strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_req):
        res = _fetch_intraday_bars(ticker, date_req)
        if isinstance(res, dict):
            return jsonify({"ticker": ticker, "error": res.get("error"), "candles": []})
        bars, date_used = (res, date_req) if res else ([], None)
    else:
        bars, date_used = _latest_session_bars(ticker)
    if date_used is None:
        return jsonify({"ticker": ticker, "error": f"No intraday data for {ticker} on {date_req or 'recent sessions'}.", "candles": []})
    if window in ("2h", "1h"):
        cutoff = bars[-1]["ts"] - timedelta(hours=2 if window == "2h" else 1)
        bars = [b for b in bars if b["ts"] >= cutoff]

    def _epoch(ts):
        return int(ts.replace(tzinfo=timezone.utc).timestamp())

    times = [_epoch(b["ts"]) for b in bars]
    closes = [b["close"] for b in bars]
    candles = [{"time": t, "open": b["open"], "high": b["high"],
                "low": b["low"], "close": b["close"], "volume": b["volume"]}
               for t, b in zip(times, bars)]
    return jsonify({
        "ticker": ticker, "date": date_used, "window": window, "n": len(bars),
        "candles": candles,
        "rsi": _rsi_series(times, closes, 14),
        "macd": _macd_series(times, closes, 12, 26, 9),
        "bollinger": _bollinger_series(times, closes, 20, 2),
        "open": closes[0] if closes else None,
        "last": closes[-1] if closes else None,
    })


# Strategy indicator: entry/exit markers for the charted ticker/session.
# Same price fetch + date resolution as /api/sentchart/charts, same density source
# as the social overlay (social_store). Returns a list of markers the frontend
# draws as up-arrows (entry) / down-arrows (exit) on the candle chart.
@app.route("/api/sentchart/signals/<ticker>")
def api_signals(ticker):
    ticker = ticker.upper().strip()
    window = (request.args.get("window", "full") or "full").lower().strip()
    if window not in ("full", "2h", "1h"):
        window = "full"
    date_req = (request.args.get("date") or "").strip()
    try:
        threshold = float(request.args.get("threshold", STRAT_ENTRY_THRESHOLD))
    except (TypeError, ValueError):
        threshold = STRAT_ENTRY_THRESHOLD
    try:
        stop_pct = float(request.args.get("stop_pct", STRAT_STOP_PCT))
    except (TypeError, ValueError):
        stop_pct = STRAT_STOP_PCT

    # Resolve bars/session exactly like the candle endpoint (pinned ?date or latest).
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_req):
        res = _fetch_intraday_bars(ticker, date_req)
        if isinstance(res, dict):
            return jsonify({"ticker": ticker, "error": res.get("error"), "markers": []})
        bars, date_used = (res, date_req) if res else ([], None)
    else:
        bars, date_used = _latest_session_bars(ticker)
    if date_used is None:
        return jsonify({"ticker": ticker,
                        "error": f"No intraday data for {ticker} on {date_req or 'recent sessions'}.",
                        "markers": []})

    # Strategy runs on the FULL session (the 360-min warmup + non-overlap need it).
    markers, stats = _compute_strategy_signals(ticker, bars, date_used, threshold, stop_pct)

    # If the chart is zoomed to a 2h/1h window, only return markers inside it so
    # they line up with the visible candles (same cutoff the candle endpoint uses).
    if window in ("2h", "1h") and bars:
        cutoff = _epoch_utc(bars[-1]["ts"] - timedelta(hours=2 if window == "2h" else 1))
        markers = [m for m in markers if m["time"] >= cutoff]

    payload = {
        "ticker": ticker, "date": date_used, "window": window,
        "threshold": threshold, "stop_pct": stop_pct,
        "n": len(bars), "trades": stats["trades"],
        "corr_defined": stats["corr_defined"], "messages": stats["messages"],
        "markers": markers,
    }
    if not markers:
        payload["note"] = (
            f"No entry/exit signals for {ticker} on {date_used} "
            f"(threshold={threshold}, stop={stop_pct}%, "
            f"corr_defined={stats['corr_defined']} min, messages={stats['messages']}).")
    return jsonify(payload)


# Density / sentiment overlays — STUBBED in phase 1. The real implementation
# depends on our SQLite DB + the StockTwits "walking" backfill (social_store),
# which is phase 2. The route exists so the service starts cleanly and the
# frontend's overlay fetch gets a well-formed, clearly-unimplemented response.
def _social_ready_payload(ticker, date_str, doc, is_today):
    """Build the chart series from a resting-store doc, topping up today's
    messages incrementally first. Verbatim from dashboard._social_ready_payload."""
    added = 0
    if is_today:
        try:
            added = social_store.incremental_update(ticker, date_str, doc)
        except Exception as exc:
            print(f"  [social] incremental error {ticker}|{date_str}: {exc}")
    msgs = social_store.docs_to_msgs(doc.get("messages"))
    payload = _build_social_series(msgs, date_str)
    payload.update({
        "ticker": ticker, "date": date_str, "status": "ready",
        "source": "store" + ("+live" if (is_today and added) else ""),
        "complete": bool(doc.get("complete")),
        "stored": len(doc.get("messages") or []),
        "added": added,
    })
    if msgs and not payload["complete"]:
        payload["coverage_start"] = min(d for d, _ in msgs).strftime("%H:%M")
    return payload


# PHASE 2b: live density + sentiment overlays. Walk-once-then-persist over
# StockTwits (social_store), backed by MongoDB (sentiment_scout.social_history)
# with an in-memory fallback; the SQLite snapshot (_stored_social_messages) is
# wired in as social_store.seed_fn, so a quiet/blocked walk still yields what we
# have. Faithful port of dashboard.api_chart_social: store hit -> serve instantly;
# miss -> background walk reporting {status:"walking", count} until it completes.
@app.route("/api/sentchart/chart/social")
def api_chart_social():
    ticker = request.args.get("ticker", "").upper().strip()
    date_str = request.args.get("date", "").strip()
    if not ticker or not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return jsonify({"error": "ticker and date=YYYY-MM-DD required"})

    key = f"{ticker}|{date_str}"
    today = datetime.now(social_store.EDT).strftime("%Y-%m-%d")
    is_today = (date_str == today)

    # 1. Resting-store hit -> serve instantly (today gets a cheap incremental top-up)
    doc = social_store.read_doc(key)
    if doc is not None:
        return jsonify(_social_ready_payload(ticker, date_str, doc, is_today))

    # 2. First time for this ticker/day -> walk in the background, report progress
    job = social_store.ensure_job(ticker, date_str, key)
    if job["done"]:
        if job.get("error"):
            social_store.clear_job(key)           # clear so a re-select retries
            return jsonify({"error": f"StockTwits walk failed: {job['error']}",
                            "ticker": ticker, "date": date_str})
        doc = social_store.read_doc(key)          # walk just finished -- adopt result
        if doc is not None:
            return jsonify(_social_ready_payload(ticker, date_str, doc, is_today))
        if job.get("empty"):
            # Walk finished with no data and the empty-doc guard kept it OUT of the
            # store (nothing cached). Answer "ready, 0 messages" (well-formed empty
            # series) instead of polling forever.
            payload = _build_social_series([], date_str)
            payload.update({"ticker": ticker, "date": date_str, "status": "ready",
                            "source": "live", "complete": bool(job.get("complete")),
                            "stored": 0, "added": 0})
            return jsonify(payload)
    return jsonify({"status": "walking", "count": job["count"],
                    "ticker": ticker, "date": date_str})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    print(f"chart-service running at http://localhost:{port} "
          f"(FINVIZ_TOKEN configured: {has_finviz_token()})")
    app.run(host="0.0.0.0", port=port, debug=False)

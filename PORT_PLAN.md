# PORT_PLAN.md — Porting sentiment-scout charts into Flashfeed

**Goal:** Replace Ryan's chart components *and* his Yahoo-based chart data with
our charting system (frontend components + Finviz/density/sentiment backend) so
the charts in this app behave exactly as they do in `sentiment-scout`.

This document is a **plan only** — no chart code has been ported or modified.
Every claim below was checked against the real files in both checkouts:

- Ours (canonical): `/Users/amanagrawal/dev/sentiment-scout`
- Theirs (this repo): `/Users/amanagrawal/dev/flashfeed` → GitHub `Amansome/sentiment-scout-v2` (private)

---

## 0. Architecture comparison (the two things that make this non-trivial)

| | **Ryan / Flashfeed (this repo)** | **Ours / sentiment-scout** |
|---|---|---|
| Frontend build root | `app/src/` (live), components flattened into `app/src/pages/` | `frontend/src/`, charts in `frontend/src/pages/` |
| Chart lib | `lightweight-charts ^5.2.0` | `lightweight-charts ^4.2.0` **+ `chart.js ^4.4.0`** |
| Chart backend | **Node/Express** `Infrastructure/server/index.js` (:3001) | **Flask/Python** `dashboard.py` (:5050) |
| Chart data source | **Yahoo** `query1.finance.yahoo.com/v8/finance/chart` | **Finviz Elite** `elite.finviz.com/quote_export` 1-min OHLC |
| Density/sentiment | `/api/social/rolling`, `/api/social/series/:ticker` (Mongo) | `/api/chart/social` (our `social_store` — MongoDB `sentiment_scout.social_history` resting store, kept fresh by the StockTwits "walking" backfill; SQLite `ticker_insights.stocktwits_posts` is the seed-fallback) |
| Dev proxy | Vite `/api → http://localhost:3001` (`app/vite.config.ts`) | Vite `/api → http://localhost:5050` (`frontend/vite.config.ts`) |
| Data store | Mongo + Redis + Kafka | SQLite (`sentiment_screener.db`, candles + `ticker_insights` snapshots) + MongoDB (`sentiment_scout.social_history`, the social_store resting store, in-memory fallback) |

**Two hard problems** drive the whole plan:
1. **lightweight-charts v4 → v5** — our components use the v4 series API, which was
   removed in v5 (see §2). A direct copy will not compile.
2. **Backend is a different language/stack** — our chart data is Python/Flask/Finviz,
   not Node/Express/Yahoo. It comes in as its **own service** (see §3), it is not
   rewritten into Express.

### Note on duplicate trees in this repo
Ryan's chart code is duplicated in **four** places. Only one is live:
- `app/src/pages/*.tsx` — **LIVE** (`app/src/App.tsx` imports `./pages/ChartsPage`).
- `app/src/components/charts/*.tsx` — stale duplicate.
- `4_Charts/frontend/*.tsx` — module-source duplicate.
- `frontend/charts/*.tsx` — another duplicate.

`4_Charts/backend/prices.ts` and `sentiment.ts` are a **separate, dead stack**
(Hono + Bun SQLite + a Python sentiment microservice on :5001). They are NOT what
the running app uses — `prices.ts` only serves `/api/prices` (CNBC quotes) and has
no `/api/charts/:ticker` route. The live chart backend is the Express server. Treat
`4_Charts/backend/*` and `backend/server/*` (a copy of `Infrastructure/server/`) as
out of scope / to be left alone or deleted later; do not wire against them.

---

## 1. Frontend replacement map

### 1a. Ryan's files to REMOVE / replace (live tree `app/src/pages/`)
| File | Action | Reason |
|---|---|---|
| `app/src/pages/ChartsPage.tsx` | **Replace** with ours | Top-level page; ours has the timeframe selector, overlays, 4 views |
| `app/src/pages/CandlestickChart.tsx` | **Replace** with ours | v5 candlestick + Bollinger + overlays |
| `app/src/pages/RSIChart.tsx` | **Replace** with ours | RSI(14) pane |
| `app/src/pages/MACDChart.tsx` | **Replace** with ours | MACD(12,26,9) pane |
| `app/src/pages/SentimentChart.tsx` | **Remove** | Ours does not use it — sentiment is shown via the candle overlay + `ResearchChart`. No import will reference it after the swap. |

Also remove the stale duplicates so nobody re-imports them later:
`app/src/components/charts/*`, `4_Charts/frontend/*`, `frontend/charts/*` (optional
cleanup; not load-bearing once `app/src/pages/` is swapped).

### 1b. Our files that come IN (full import closure, not just the 4 headline files)
Ryan's app flattens everything into `app/src/pages/`, so **our chart files land in
`app/src/pages/`** and our shared lib lands in `app/src/lib/` (Ryan's Vite already
aliases `@ → ./src`, so `@/lib/chartAgg` resolves unchanged — see `app/vite.config.ts`).

| Our source (`sentiment-scout/frontend/src/...`) | Lands at (`flashfeed/app/src/...`) | Notes |
|---|---|---|
| `pages/ChartsPage.tsx` | `pages/ChartsPage.tsx` | Headline page |
| `pages/CandlestickChart.tsx` | `pages/CandlestickChart.tsx` | **needs v5 migration (§2)** |
| `pages/RSIChart.tsx` | `pages/RSIChart.tsx` | **needs v5 migration (§2)** |
| `pages/MACDChart.tsx` | `pages/MACDChart.tsx` | **needs v5 migration (§2)** |
| `pages/ResearchChart.tsx` | `pages/ResearchChart.tsx` | **Chart.js** (not lightweight-charts) — needs `chart.js` dep (§4) |
| `pages/TickerEnrichPanels.tsx` | `pages/TickerEnrichPanels.tsx` | Imported by our ChartsPage; reads `/api/ticker/<t>/enrich` |
| `lib/chartAgg.ts` | `lib/chartAgg.ts` | Client-side resample + indicators + overlay alignment |

**Verification of the closure:** our `ChartsPage.tsx` imports `CandlestickChart`,
`RSIChart`, `MACDChart`, `ResearchChart`, `TickerEnrichPanels`, and `@/lib/chartAgg`.
The only **external** imports across all of these are `react`, `react-router-dom`,
`clsx`, `chart.js/auto`, and `lightweight-charts`. Ryan already has `react`,
`react-router-dom`, `clsx`. The two gaps are **`chart.js`** (missing) and the
**lightweight-charts major version** (§2).

> Optional/secondary: our app also has `pages/ChartsGridPage.tsx` + the backend
> `/api/charts/grid-image/<ticker>` route. The prompt's scope is the single Charts
> page, so grid view is out of scope for v1 unless we also add a `/charts-grid` route.

### 1c. Wiring in `app/src/App.tsx`
No route change needed: `app/src/App.tsx` already has
`<Route path="/charts" element={<ChartsPage />} />` importing from `./pages/ChartsPage`.
Our `ChartsPage` is a **named** export (`export function ChartsPage`), matching Ryan's
named import. Confirm the AppShell/Tailwind tokens our components use (`bg-surface`,
`border-border`, `text-neutral`, `text-accent`, `bg-bg`) exist in Ryan's
`app/tailwind.config.js`; both apps appear to share this design language (Ryan's
ChartsPage uses the same classes), but verify and add any missing tokens.

### 1d. Feature parity our ChartsPage brings (and Ryan's lacks in this exact form)
- Ticker input + URL `?t=` sync (grid → chart deep-link).
- **Window selector**: Full Day / Last 2h / Last 1h (intraday only).
- **Timeframe selector**: 1m / 5m / 15m / 30m / 1h — *client-side resample* of the
  one 1-min series (no server round-trip), via `resampleCandles` in `chartAgg.ts`.
- **Density / Sentiment overlays** (checkboxes) on the candle chart, lazily fetched
  from `/api/chart/social`, cached per `(ticker, date)`, and **polled** through the
  server's "walking" StockTwits backfill (`status: 'walking'`).
- **Timeframe-aligned RSI/MACD/Bollinger**: server values used at 1m; at coarser
  timeframes they are **recomputed client-side** on the resampled closes
  (`rsiFromCandles` / `macdFromCandles` / `bollingerFromCandles`) so they stay
  registered to the candle x-axis.
- Four views: `candles` (lightweight-charts) + `pd` / `sent` / `ds` research views
  (Chart.js `ResearchChart`).
- Per-ticker enrichment panel below the chart (`TickerEnrichPanels`).

> On the "rolling-window slider": in the current code the rolling window is a fixed
> `windowMin = 15` argument threaded into `overlaySeries`/`smoothSame` and into
> `ResearchChart`; the UI exposes it as fixed smoothing, not a live slider. If a
> user-facing slider is wanted, it's a small addition during execution — flagging
> that it is **not** a slider in the source today, to avoid over-promising parity.

---

## 2. lightweight-charts version reconciliation (v4 → v5)

**Versions:** ours `^4.2.0`, Ryan's `^5.2.0` (`app/package.json`). This is a major
bump with a **breaking series-creation API**. Direct copy of our components will
fail to compile.

**Exact breakage (verified by grep in both repos):**

Our v4 code calls the per-type factory methods, which **no longer exist** in v5:
- `chart.addCandlestickSeries(opts)` — `CandlestickChart.tsx:53`
- `chart.addLineSeries(opts)` — `CandlestickChart.tsx:65,72,83,93`; `RSIChart.tsx:29,33,35`; `MACDChart.tsx:36,40`
- `chart.addHistogramSeries(opts)` — `MACDChart.tsx:44`

v5 replaces all of these with a single generic factory taking a series-type token:
- `chart.addSeries(CandlestickSeries, opts)`
- `chart.addSeries(LineSeries, opts)`
- `chart.addSeries(HistogramSeries, opts)`

…where `CandlestickSeries` / `LineSeries` / `HistogramSeries` are **imported from
`lightweight-charts`**.

**Reconciliation decision: adopt v5 (keep Ryan's pinned `^5.2.0`).** Rationale:
Ryan's whole app, build, and lockfile are on v5; downgrading the shared dependency
to v4 would risk his other charts (`app/src/pages/IntradayChart.tsx`, momentum
sparklines, etc.). Migrating our 3 components up is the smaller, contained change.

**Migration is mechanical, and Ryan's own v5 files are a working template** (verified):
- `app/src/pages/CandlestickChart.tsx:33,56,67` already imports
  `{ createChart, ColorType, CrosshairMode, CandlestickSeries, LineSeries, createSeriesMarkers }`
  and calls `chart.addSeries(CandlestickSeries, …)` / `addSeries(LineSeries, …)`.
- `app/src/pages/RSIChart.tsx:13,28` and `MACDChart.tsx:19,35,43` show the
  `addSeries(LineSeries…)` / `addSeries(HistogramSeries…)` form.

**Per-file change list for our components:**
1. `CandlestickChart.tsx`: import `CandlestickSeries, LineSeries`; `addCandlestickSeries(x)` → `addSeries(CandlestickSeries, x)`; 4× `addLineSeries(x)` → `addSeries(LineSeries, x)`.
2. `RSIChart.tsx`: import `LineSeries`; 3× `addLineSeries` → `addSeries(LineSeries, …)`.
3. `MACDChart.tsx`: import `LineSeries, HistogramSeries`; 2× `addLineSeries` → `addSeries(LineSeries,…)`, 1× `addHistogramSeries` → `addSeries(HistogramSeries,…)`.

**Unchanged between v4 and v5 for our usage** (so no other edits expected):
`createChart(...)` options block (`layout/grid/crosshair/rightPriceScale/timeScale`),
`ColorType.Solid`, `CrosshairMode.Normal`, `series.setData(...)`,
`chart.priceScale('id').applyOptions({ scaleMargins })`, `chart.timeScale().fitContent()`,
`chart.applyOptions({ width })`, and the `ResizeObserver` pattern — all appear
identically in Ryan's v5 files.

**Uncertainty to verify during execution (not assumed):** I did not exhaustively
diff every option name across v4→v5 (e.g. any `priceScale`/`layout` option renames,
or `lineStyle` enum import). The series-factory change is the known breaker; treat
a `tsc`/`vite build` of the swapped components as the gate that surfaces any
remaining option renames. Pin to Ryan's exact installed 5.x at execution time.

---

## 3. Backend replacement — our chart data as its own service

Our chart data is **Flask/Python + Finviz (candles) + a MongoDB-backed social_store
(SQLite seed-fallback) for the overlays**. It is brought in
as a **new container service**, not rewritten into Ryan's Express. Ryan's stack
already runs Python (his backend image builds a venv and `execFile`s `python3` via
`runPythonScriptForRoute`/`runPythonScript`), and his compose already runs
Python-only worker services (`rss-worker`, `sentiment-worker`) — so a Python chart
service fits his multi-service model cleanly.

### 3a. Our endpoints to bring in (verified in `dashboard.py`)
| Route | Line | Returns | Data path |
|---|---|---|---|
| `/api/charts/<ticker>?window=full\|2h\|1h` | 1883 | OHLC `candles` + `rsi` + `macd` + `bollinger` + `date`/`n` | `_latest_session_bars` → `_fetch_intraday_bars` → Finviz `quote_export?p=i1&auth=<token>` |
| `/api/chart/social?ticker=&date=` | 964 | `density`, `scores_smooth`, `labels`, `status:'walking'` backfill | `social_store` resting store (MongoDB `sentiment_scout.social_history`, in-memory fallback) + on-demand StockTwits walk; SQLite `ticker_insights.stocktwits_posts` is the seed-fallback (the phase-2 read layer uses this seed path) |
| `/api/chart?ticker=&window=` | 810 | legacy line series (`labels/prices/volumes`) | same Finviz bars via `build_chart` |
| `/api/ticker/<ticker>/enrich` | 1921 | per-ticker news alert + 3-day news + social | DB reads (needed by `TickerEnrichPanels`) |
| `/api/charts/grid-image/<ticker>` | 1866 | (grid view, optional/secondary) | — |

The live `ChartsPage` uses **`/api/charts/<ticker>`** (candles+indicators),
**`/api/chart/social`** (overlays), and **`/api/ticker/<ticker>/enrich`** (panel).
`/api/chart` (810) is legacy; bring it for completeness but it is not on the hot path.

### 3b. Service shape
Add a service, e.g. **`chart-service`**, to `docker-compose.yml`:
- Base `python:3.12-slim` (mirrors `Dockerfile.rss`).
- Runs our Flask app on its container port (our default `:5050`, `app.run(host=0.0.0.0, port=5050)`).
- Bring the chart-relevant Python modules from sentiment-scout: `dashboard.py`
  (or a carved-out chart-only Flask app exposing just the chart routes — preferred,
  to avoid dragging the entire 263KB dashboard + all its other routes), plus its
  imports: `config.py`, `credentials_store.py`, `social_store.py`,
  `correlation_engine.py` (used for ET tz), and the Finviz fetch helpers.
- Pip deps: `Flask`, `Flask-Cors`, `curl_cffi`, `requests`, `numpy`, `pandas`
  (see §4 / our `requirements.txt`).

> **Decision needed at execution time (flagged, not assumed):** full overlay parity
> (`/api/chart/social`) depends on our **`social_store` resting store (MongoDB
> `sentiment_scout.social_history`) kept fresh by the "walking" StockTwits backfill**.
> Candles (`/api/charts/<ticker>`) are Finviz-only and need **no DB**. So we can ship
> candles+indicators+Finviz immediately. For overlays there are two stages:
> read-only on existing data vs. keeping it fresh —
> - **Read layer (done in phase 2):** render overlays from already-stored data via the
>   **SQLite seed-fallback** path (`ticker_insights.stocktwits_posts`), a copyable
>   point-in-time snapshot. No Mongo, no network, no threads.
> - **Fresh layer (phase 2b):** the live MongoDB resting store + the StockTwits walking
>   backfill — this is **`pymongo` + `MONGO_URI` + the walk threads** (`ensure_job`/
>   `_run_walk`/`incremental_update`), **not** SQLite writes. SQLite stays read-only as
>   the seed-fallback.
>
> This is the single biggest data-dependency in the port.

### 3c. Routing `/api` without colliding with Ryan's Express
Ryan's Express **owns the same path** we need: `app.get("/api/charts/:ticker")`
(`Infrastructure/server/index.js:3057`) → `fetchYahooCandles` (2740). We are
replacing that. Also his `/api/social/rolling` (2510), `/api/social/series/:ticker`
(2640), and the `/api/charts/` cache rule (83) are part of the Yahoo chart path.

Plan — split `/api` by prefix so chart calls hit our service and everything else
stays on Express:
- **Dev (Vite):** change `app/vite.config.ts` proxy from a single
  `'/api': 'http://localhost:3001'` to per-path targets:
  - `'/api/charts'` → `http://localhost:5050` (our service)
  - `'/api/chart'` → `http://localhost:5050`
  - `'/api/ticker'` → `http://localhost:5050`
  - `'/api'` → `http://localhost:3001` (Express, fallback for all else)
  (Vite matches longest-prefix; order/most-specific-first as needed.)
- **Prod / compose:** Express is the single published `:3001`. Either (a) mount a
  small proxy in Express forwarding `/api/charts`, `/api/chart`, `/api/ticker` to
  `http://chart-service:5050`, or (b) put a reverse proxy in front. Express-side
  proxy (a) is least invasive given Ryan has no nginx today.

**Express routes to remove/bypass** (the Yahoo chart path) so they never shadow ours:
- `app.get("/api/charts/:ticker")` (3057) and helpers `fetchYahooCandles` (2740),
  `yahooRangeFor` (2724), `yahooIntervalFor` (2734).
- The `/api/charts/` entry in the cache table (83).
- Decide per-feature whether to keep `/api/social/rolling` (2510) and
  `/api/social/series/:ticker` (2640): if our `/api/chart/social` fully supplies the
  overlays, these become dead for the chart page (other pages may still use them —
  grep before deleting).
- Leave `/api/prices/:ticker` (2198) alone unless a conflict surfaces; our page does
  not call it.

> **Path-shape caveat:** Ryan's `/api/charts/:ticker` takes `?range=&interval=`
> (his ChartsPage sends `range`/`interval`); **ours takes `?window=full|2h|1h`** and
> serves only 1-min extended-hours intraday (no daily/weekly). After the swap the
> frontend is ours, so it will send `window`; just ensure no other caller still
> expects the Yahoo `range/interval` contract on that path.

---

## 4. Shared dependencies our chart code needs that Ryan's repo lacks

**Frontend (`app/package.json`):**
- **`chart.js` (^4.4.0)** — required by `ResearchChart.tsx` (`import Chart from 'chart.js/auto'`). **Missing in Ryan's app.** Add it.
- `lightweight-charts` — already present, but at v5 (drives §2 migration). Do **not** downgrade.
- `clsx`, `react-router-dom`, `react`, `react-dom`, `swr` — already present, versions compatible.

**Backend / Python (new `chart-service`):**
- From our `requirements.txt`: `Flask==3.1.3`, `Flask-Cors==6.0.0`, `curl_cffi==0.15.0`,
  `requests==2.32.3`, `numpy==2.2.6`, `pandas==2.3.3`. (`curl_cffi` is how we hit
  Finviz with browser-impersonation — important, not optional.)

**Env vars:**
- **Finviz token name mismatch — must reconcile.** Ours reads **`FINVIZ_TOKEN`**
  (`.env.example`, `config.get_finviz_token()`); Ryan's compose/.env use
  **`FINVIZ_AUTH_TOKEN`** (already wired into his `backend`/`rss-worker`/
  `sentiment-worker` env in `docker-compose.yml`). For the chart service, either
  (a) read `FINVIZ_AUTH_TOKEN` in our config, or (b) map
  `FINVIZ_TOKEN: ${FINVIZ_AUTH_TOKEN}` in the chart-service compose block. Pick one;
  document it. The actual token value stays in a real (gitignored) `.env`.
- Our optional social creds (`REDDIT_CLIENT_ID/SECRET/USER_AGENT`, StockTwits path)
  only matter once overlay/social parity (3b) is in scope.

**Data/config files our backend expects** (bring with the service if used):
`config.py`, `credentials_store.py` (Finviz token persistence/validation),
`social_store.py`, the SQLite snapshot (`ticker_insights`, seed-fallback read path),
and — for overlay *freshness* (phase 2b) — MongoDB (`pymongo` + `MONGO_URI`) and the
walk threads (3b).

---

## 5. Concrete phase ordering for execution

Each phase is independently verifiable; the follow-up prompt should run **one phase
at a time** and stop at each "verify" gate. No code is ported until Phase 1.

**Phase 0 — Prep & branch (no chart code).**
- Confirm checkout (`git -C ~/dev/flashfeed rev-parse --show-toplevel`), create a
  working branch off `master`. Add `chart.js` to `app/package.json`. Delete/park the
  dead duplicate trees (optional). No behavior change yet.

**Phase 1 — Backend service in and reachable FIRST.**
- 1a (candles, no DB): stand up `chart-service` (Flask) with `/api/charts/<ticker>`
  + `/api/chart` + indicators, Finviz via `curl_cffi`, `FINVIZ_*` reconciled. Add the
  compose service. **Verify:** `curl localhost:5050/api/charts/AAPL?window=full`
  returns real `candles`/`rsi`/`macd`/`bollinger` (show output).
- 1b (overlays + enrich, DB decision): bring `/api/chart/social` and
  `/api/ticker/<ticker>/enrich`; resolve the SQLite-vs-Mongo social-data decision
  (3b). **Verify:** `curl` both endpoints return data (or the documented `walking`
  state) for a known ticker.

**Phase 2 — Frontend components in (with v5 migration).**
- Copy our 7 files into `app/src/pages/` + `app/src/lib/chartAgg.ts`; apply the §2
  v5 migration to `CandlestickChart`/`RSIChart`/`MACDChart`; remove Ryan's
  `SentimentChart.tsx` and replace `ChartsPage/CandlestickChart/RSIChart/MACDChart`.
  **Verify:** `tsc`/`vite build` is clean (this is the gate that catches any residual
  v4→v5 option renames — show the build output).

**Phase 3 — Wiring + parity check.**
- Split the Vite dev proxy (and Express prod proxy) so `/api/charts`, `/api/chart`,
  `/api/ticker` hit `:5050` and the rest stays on `:3001`; remove/bypass Express's
  Yahoo chart routes (3c). **Verify (parity):** load `/charts` in the running app,
  pick a ticker, and confirm — candles render, timeframe resample (1m→1h) works,
  RSI/MACD/Bollinger track, density/sentiment overlays toggle and load, the research
  views (pd/sent/ds) render, and the enrich panel populates — i.e. it matches
  sentiment-scout's Charts page. Confirm Ryan's other tabs (news/screener/social/
  momentum/correlation) still work (no `/api` regressions).

---

## Open decisions to confirm before/with execution
1. **Overlay freshness (3b / phase 2b):** the read layer (phase 2, done) renders
   overlays from the SQLite seed-fallback snapshot. For *fresh* data, stand up our own
   `social_store` MongoDB (`sentiment_scout.social_history`) + the StockTwits walking
   backfill (`pymongo` + `MONGO_URI` + walk threads — not SQLite writes), or re-point
   `social_store` at Ryan's existing Mongo. (Candles work without any of this.)
2. **Finviz env name (4):** read `FINVIZ_AUTH_TOKEN` in our config, or map it to
   `FINVIZ_TOKEN` in compose?
3. **Carve-out vs whole `dashboard.py`:** stand up a chart-only Flask app (preferred,
   smaller surface) or run the full dashboard as the service?
4. **Grid view (1b note):** in scope for v1 (`/charts-grid` + `grid-image`) or defer?

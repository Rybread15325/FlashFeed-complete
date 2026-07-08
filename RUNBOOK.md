# FlashFeed local run-book

Exact, working sequence to stand up and **fully populate** the FlashFeed dashboard
on the host stack. Every command here was run and verified this session; the
populated counts at the bottom match a real run.

> Scope: local dev on macOS. The Charts page is served by our own `chart-service`;
> everything else by Ryan's Express backend. Data is free/keyless + the Finviz
> token — **no paid sources required** for a working dashboard.

---

## 1. Prerequisites

- **Host mongod on `:27017`** — the canonical store (`feedflash`, plus `flashfeed`
  for chart-service social and `sentiment_scout`). **Do NOT let the compose `mongo`
  bind over it** (see the data-safety note in §2). Containers reach it via
  `host.docker.internal:27017`.
- **Docker** running — needed for `redis`/`kafka` and the `rss-worker` /
  `sentiment-worker` containers (they carry Python deps the host lacks).
- **A valid Finviz Elite token** — kept in `chart-service/.env` as `FINVIZ_TOKEN=`
  (gitignored). Finviz rotates it periodically; if charts/screener go dark, refresh it.
- **Ports free:** `:3001` (Express backend), `:5055` (chart-service), `:5173` (Vite).
  Note `:5050` is the separate sentiment-scout dashboard — leave it; do not reuse.

---

## 2. Operational gotchas (these are REQUIRED steps, learned the hard way)

1. **Launch the Express backend from the REPO ROOT**, not `Infrastructure/server/`.
   `runPythonScript` resolves fetcher paths (`2_Screener/pipeline/...`) **relative to
   `process.cwd()`**. From the wrong cwd every fetcher fails with "Script not found".
   (In Docker the cwd is `/app` = repo root; replicate that on the host.)
2. **The backend gates Finviz on `FINVIZ_AUTH_TOKEN`** (Ryan's name), not `FINVIZ_TOKEN`.
   Set **both** in the backend's env or the screener fetch is skipped
   ("Finviz Elite import skipped — FINVIZ_AUTH_TOKEN not set").
3. **Use `mode=full` for `/api/fetch`.** `fast` mode skips the TradingView screener and
   yields only `cnbc_public_quote` rows with `change_pct=0` and degenerate `SPACEX`-only
   social → **Momentum stays empty**. `full` runs the real Finviz Elite + TradingView
   screeners and targets social at real movers, so Momentum auto-computes.
4. **News ingestion must run via the `rss-worker` container.** `fetch_rss.py` imports
   `psycopg`, which the host `python3` does **not** have — so RSS via `/api/fetch` errors
   (`ModuleNotFoundError: No module named 'psycopg'`). The container has psycopg; use it
   for articles. (This is why `/api/fetch` returns `ok:false` even on success — the one
   failing RSS sub-step flips the flag; screener/social still populate.)
5. **Always pass `--no-deps` to `docker compose run`** for the workers. Without it,
   compose starts its own `mongo` service, which tries to bind `:27017` over the host
   mongod — a data-safety hazard. `--no-deps` + the `host.docker.internal` override keeps
   everything pointed at the one canonical host mongo.

---

## 3. Bring up the stack

```bash
cd ~/dev/flashfeed

# 3a. Infra (conflict-free; NOT mongo — host mongod owns :27017)
docker compose up -d redis zookeeper kafka kafka-init

# 3b. Express backend — FROM REPO ROOT, with the Finviz token under BOTH names
TOK=$(grep '^FINVIZ_TOKEN=' chart-service/.env | cut -d= -f2-)
PORT=3001 MONGODB_URI="mongodb://localhost:27017/feedflash" \
  REDIS_URL="redis://localhost:6379" KAFKA_BOOTSTRAP_SERVERS="localhost:9092" \
  FINVIZ_AUTH_TOKEN="$TOK" FINVIZ_TOKEN="$TOK" \
  nohup node Infrastructure/server/index.js > /tmp/ryan_backend_3001.log 2>&1 &
curl -s http://localhost:3001/api/health          # expect {"status":"ok","db":"connected"}

# 3c. chart-service (Charts page; Finviz candles + live social overlays)
cd ~/dev/flashfeed/chart-service
PORT=5055 nohup ./.venv/bin/python chart_service.py > /tmp/chart_service.log 2>&1 &
curl -s http://localhost:5055/api/health
cd ~/dev/flashfeed

# 3d. Frontend (Vite dev server)
cd ~/dev/flashfeed/app && nohup npm run dev > /tmp/vite_dev.log 2>&1 &
cd ~/dev/flashfeed
# → open http://localhost:5173
```

---

## 4. Populate the data (run IN THIS ORDER)

```bash
cd ~/dev/flashfeed
HOST_MONGO=mongodb://host.docker.internal:27017/feedflash

# 4a. ARTICLES — rss-worker container (free/keyless RSS; has psycopg)
docker compose run --rm --no-deps -e MONGODB_URI=$HOST_MONGO rss-worker

# 4b. SENTIMENT — FinBERT scorer (free; pulls ProsusAI/finbert on first run, CPU-slow)
#     Run AFTER all article ingestion so every article gets a real label.
docker compose run --rm --no-deps -e MONGODB_URI=$HOST_MONGO sentiment-worker

# 4c. SCREENER + SOCIAL — full refresh cycle (Finviz token + free TradingView/StockTwits/Bluesky)
curl -s -X POST "http://localhost:3001/api/fetch?mode=full"

# 4d. MOMENTUM + AI/Overview — no action: they AUTO-COMPUTE from the above
curl -s "http://localhost:3001/api/momentum" | python3 -c "import sys,json;print('momentum tickers:',len(json.load(sys.stdin).get('tickers',[])))"
curl -s "http://localhost:3001/api/ai/scores" | python3 -c "import sys,json;print('ai scores:',len(json.load(sys.stdin).get('scores',[])))"
```

**Ordering dependencies:** Sentiment (4b) after Articles (4a). Momentum/AI (4d)
after Screener+Social (4c). News needs the container (4a), not `/api/fetch`.
Re-run 4b after 4c if you want the screener-added articles scored too (4c can add
articles that land default-`neutral` until the scorer re-runs).

---

## 5. Free-vs-paid source map

| Page | Free? | What populates it | Notes |
|---|---|---|---|
| **News** | ✅ free | `rss-worker` container (4a) | SEC EDGAR ×4, PR Newswire, GlobeNewswire, ACCESS, FDA — all keyless |
| **Sentiment labels** | ✅ free | `sentiment-worker` (FinBERT) (4b) | local model, no token |
| **Screener** | ✅ free | `/api/fetch?mode=full` → Finviz Elite (token) + TradingView screener (free) | Schwab screener = paid, skipped |
| **Social** | ✅ free | `/api/fetch?mode=full` → StockTwits public + Bluesky public | Reddit (needs creds) & X (needs `X_BEARER_TOKEN`; keyless nitter fallback 403s) skip cleanly |
| **Momentum** | ✅ free (computed) | auto from Screener + Social | needs both populated first |
| **AI Top Picks / Overview** | ✅ free (computed) | auto from FinBERT-scored articles | thin until ticker coverage improves |
| **Correlation** | ⚠️ partial-free | `python3 6_Correlation/pipeline/correlation_tracker.py` (yfinance, free) | needs articles w/ ticker + sentiment |
| Benzinga / IBKR / Schwab / X | ❌ paid/gated | token-gated fetchers | optional; not needed for a working dashboard |

---

## 6. Known limiters (honest)

- **Ticker coverage** is the cross-cutting limiter for AI, Correlation, and
  per-ticker Momentum. The inline ticker tagger imports `db_sqlite` (a DS440 module
  not shipped in Ryan's containers), and SEC's `company_tickers.json` returns **403**,
  so most SEC articles land without a ticker. Result: AI/Overview and Momentum are
  **real but thin** (few tickers qualify). Fixing ticker extraction would deepen them.
- **`psycopg` RSS-via-backend gap** — RSS through `/api/fetch` errors on the host
  (no `psycopg`); covered by running the `rss-worker` **container** (step 4a).
- **Correlation** needs tickered+scored articles; with thin ticker coverage its output
  is sparse (collection currently 0 until `correlation_tracker.py` is run).
- **Finviz token rotation** — external; refresh `chart-service/.env` when charts/screener go dark.

---

## 7. Verification (counts from a real, completed run)

After 4a–4c the host `feedflash` DB held:

| Collection | Count |
|---|---|
| `articles` | 442 (FinBERT: 36 bullish / 11 bearish / 395 neutral) |
| `screeners` | 3001 (Finviz Elite + TradingView 2996 + CNBC quotes) |
| `socials` | 367 (StockTwits 330 + Bluesky 37) |
| `prediction_signals` | 1 |
| `correlations` | 0 (run `correlation_tracker.py` to populate) |

Quick check:
```bash
~/dev/flashfeed/chart-service/.venv/bin/python -c "
from pymongo import MongoClient
d=MongoClient('mongodb://localhost:27017')['feedflash']
for c in ['articles','screeners','socials']: print(c, d[c].count_documents({}))
"
```
Then in the UI: News (real articles + sentiment badges), Screener (sector heatmap +
ticker table), Social (multi-platform feed), Momentum (auto-computed movers),
Charts (live Finviz candles + overlays).

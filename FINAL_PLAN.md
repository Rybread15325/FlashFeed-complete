# FINAL_PLAN.md — FlashFeed as the project going forward

Functional audit + port plan. **No code changed; nothing committed except this file.**
Produced by actually standing up the pieces that could run and probing real routes —
not assumed. Date of audit: 2026-06-26.

- App repo: `/Users/amanagrawal/dev/flashfeed` (GitHub `Amansome/sentiment-scout-v2`)
- Source repo (for porting): `/Users/amanagrawal/dev/sentiment-scout`

---

## 0. How this baseline was produced + environment blockers

The documented full-stack path (`docker compose up`) could **not** run cleanly as-is.
Blockers found (all environmental, none in the code):

1. **Docker daemon is down.** Docker CLI v29 is installed but `docker ps` fails — so
   `docker compose up` (Mongo/Redis/Kafka/backend/workers) can't run until Docker
   Desktop is started.
2. **`:3001` is held by an UNRELATED app.** `next-server` (PID 72249) from
   `/Users/amanagrawal/rigor/dashboard` — the "rigor" project, nothing to do with
   FlashFeed. Ryan's Express backend (and the compose `backend`) bind `:3001`, so they
   can't come up until this is freed. **Not killed — flagged for your decision.**
3. **`:27017` has a host mongod** (homebrew). The compose stack ships its own `mongo`
   container on 27017 → port conflict. Pick one Mongo (use the host's, or stop it and
   let compose run its own).
4. **`feedflash` Mongo DB is empty.** The host Mongo has `flashfeed` (our chart-service
   store) and `sentiment_scout` (ours) but **no `feedflash`** — Ryan's ingestion
   pipeline (RSS/news/screener/social/sentiment workers) has **never run here**, so his
   data layer is unpopulated.

To still get a true baseline I ran Ryan's Express backend on an **alternate port
(3009)** against the host Mongo (Redis degraded to "MongoDB only") and probed every
route, and loaded every page in the running Vite dev server (`:5173`).

Currently running (left untouched): Vite `:5173`, our chart-service `:5055`, the
sentiment-scout dashboard `:5050`, host mongod `:27017`, the rigor app `:3001`.

---

## Part 1 — Per-page functional baseline (audited)

**Two states matter:** (A) **right now** — the frontend's `/api` proxy points at `:3001`,
which is the *rigor* app, so every Mongo-backed page gets garbage/404 → renders empty;
(B) **properly stood up** — Ryan's backend on `:3001`, but with the **empty `feedflash`
Mongo**. Backend route probes below are from state B (alt-port 3009). Every route
returned **HTTP 200 (no 500s)** — the code is healthy; the gap is *data*.

| Page (route) | Frontend render | Backend route(s) | Live data? | Verdict |
|---|---|---|---|---|
| **Charts** (`/charts`) | ✅ renders | chart-service `:5055` `/api/sentchart/*` | ✅ **YES — live** Finviz 1-min OHLC + RSI/MACD/Bollinger + live StockTwits density/sentiment overlays | **WORKING** (ours; phases 1–2b) |
| **Overview** (`/`, `/overview`) | ✅ renders shell | `/api/ai/overview`, `/api/stats` | ⚠️ 200 but empty (`top_bullish:0`, `article_count:0`) | renders, **no data** (needs pipeline) |
| **AI / Top Picks** (`/ai`) | ✅ renders shell | `/api/ai/scores`, `/api/ai/overview` | ⚠️ 200, `scores: 0` | renders, **no data** (needs pipeline + AI scoring) |
| **News** (`/news`) | ✅ renders ("0 articles") | `/api/articles`, `/api/stats` | ⚠️ 200, `articles: 0` | renders, **no data** (needs news pipeline) |
| **Screener** (`/screener`) | ✅ renders shell | `/api/screener` | ⚠️ 200, `rows: 0` | renders, **no data** (needs Finviz/TradingView screener workers) |
| **Social** (`/social`) | ✅ renders shell | `/api/social/rolling`, `/api/social/targets` | ⚠️ 200, `rows/tickers: 0` | renders, **no data** (needs social pipeline) |
| **Momentum** (`/momentum`) | ✅ renders shell | `/api/momentum`, `/api/momentum/trending`; mini-charts `/api/charts/:ticker` (Yahoo) | ⚠️ momentum 200 `tickers: 0`; Yahoo charts return live candles, but no rows to show | renders, **no data** (needs pipeline) |
| **Correlation** (`/correlation`) | ✅ renders shell | `/api/correlation` | ⚠️ 200, `results: 0` | renders, **no data** (needs data + run) |
| **Settings** (`/settings`) | ✅ renders | `/api/settings`, `/api/status`, `/api/settings/{connections,sources,keywords}` | ✅ returns config/status (functional) | **WORKING** (config/token mgmt) |

Routes that return **live data even with empty Mongo** (external sources, work today):
`/api/prices/:ticker` (real quote), `/api/market/status` (real), and Ryan's
`/api/charts/:ticker` Yahoo route (19 candles + RSI + **13 "predicted"** points — Ryan
has a prediction overlay on his charts).

**Baseline summary:** the FlashFeed frontend is solid — all 9 pages render with no
crashes. **Only Charts is fully working with live data today** (our chart-service).
Every other page is structurally fine but **starved of data** because Ryan's ingestion
pipeline has never run locally. Nothing is "broken" in the bug sense; the system is
*unpopulated*.

**Known integration gap from the chart port:** our `ChartsPage` renders
`TickerEnrichPanels`, which calls `/api/ticker/<ticker>/enrich`. Ryan's backend has
**no `/api/ticker` route** (0 matches), so those news/social panels under the chart will
404 (they already show a perpetual "Loading…"). Needs an endpoint (in chart-service or
Ryan's backend) or removal.

---

## Part 2 — Capability inventory: what's worth bringing from sentiment-scout

**Headline (honest):** sentiment-scout and FlashFeed share lineage — sentiment-scout
even *vendors* feedflash — and **Ryan already implements, as well or better, essentially
every major sentiment-scout capability except the charts** (which we already ported).
There is very little left worth bringing.

| sentiment-scout capability | What FlashFeed (Ryan) already has | Class |
|---|---|---|
| **Finviz 1-min OHLC charts + density/sentiment overlays + research views + rolling slider** | Ryan had only Yahoo charts (+ a prediction overlay) | **(b) — already PORTED** (phases 1–3, 2b). Done. |
| **Structured news: 8 publishers + SEC EDGAR** | `professor_source_registry.json` = **29 sources** incl. SEC EDGAR Current/8-K/10-Q/10-K, FDA Press/Recalls/MedWatch, PR Newswire, GlobeNewswire, ACCESS Newswire, Finviz News, TradingView News, Benzinga, IBKR | **(a) — Ryan ≥. SKIP.** Ryan's coverage is broader. |
| **TradingView (news + screener)** | `fetch_tradingview_to_mongo.py` + `fetch_tradingview_screener_to_mongo.py` | **(a) — SKIP.** |
| **AI Top Picks ranking** | `/api/ai/scores` + `/api/ai/overview` **plus** a full `/api/prediction/*` ML system (train/signals/features/model/snapshot) | **(a) — Ryan ≥. SKIP.** Ryan goes beyond ranking to directional prediction. |
| **FinBERT / VADER sentiment** | FinBERT (`score_mongo_finbert_gossip.py`), VADER (`sentiment_engine.py`), **and** Gemini (`batch_score_mongo_gemini.py`) | **(a) — Ryan ≥. SKIP.** |
| **Multicap screener** | Finviz Elite + TradingView + Schwab signals + yfinance enricher | **(a) — Ryan ≥. SKIP.** |
| **Correlation engine** (Finviz price × StockTwits, Pearson) | `/api/correlation` + `/api/correlation/post-news` | **(c) — JUDGMENT.** Both exist; compare methodology before deciding. Likely Ryan's stays. |
| **Settings token control** | `/api/settings/{connections,sources,keywords}` | **(c) — JUDGMENT.** Ours adds **Fernet-encrypted at-rest** credentials + a live `validate_finviz_token`. *Only* worth porting if Ryan stores tokens in plaintext and we want encryption-at-rest. Verify Ryan's storage first. |
| **Density/sentiment social methodology** | n/a (ours) | **(b) — already in** via chart-service (phase 2b). |

**Things to bring: essentially none beyond what's done.** The only live candidates are
small/optional judgment calls (encrypted credential storage; correlation methodology),
not new feature areas. **Be explicit:** Ryan owns news, screener, social, AI/prediction,
and sentiment; we owned charts and that's delivered.

**One thing we *removed* that may want restoring:** Ryan's charts had a **prediction
overlay** (the `predicted` series tied to `/api/prediction`). Our chart components
dropped it. If the prediction line is valued, re-adding it to our `CandlestickChart` is a
**(c) judgment** follow-up — it's a FlashFeed capability our port set aside, not a
sentiment-scout port.

---

## Part 3 — Ordering to a finished product

The work is **not "port from sentiment-scout"** — it's **operationalize Ryan's existing
stack** (get its data flowing) + finish the chart integration. Sequenced:

### Phase A — Make the baseline actually run (fix what blocks a working app)
1. **Free `:3001`.** Decide on the unrelated rigor `next-server` (PID 72249): stop it, or
   run FlashFeed's backend on another port and repoint the Vite proxy. *Needs your call —
   I won't kill an out-of-scope process.*
2. **Resolve Mongo.** Either keep the host mongod (point compose/backend at it) or stop it
   and use the compose `mongo`. Don't run both on 27017.
3. **Start Docker + `docker compose up`** (mongo, redis, kafka, backend) — or run the
   Express backend + Python workers locally against the host Mongo (proven to boot:
   `PORT=3001 MONGODB_URI=mongodb://localhost:27017/feedflash node Infrastructure/server/index.js`).
4. **Wire chart-service into compose** properly: set `MONGO_URI=mongodb://mongo:27017`,
   `MONGO_DB=flashfeed`, `FINVIZ_TOKEN` (block already added in phase 2b).
5. **Fix the enrich-panel 404:** add `/api/ticker/<t>/enrich` (to chart-service or Ryan's
   backend) or drop `TickerEnrichPanels` from our ChartsPage.

### Phase B — Populate the data layer (this is the real cost; see dependencies)
6. **Supply API tokens** and run the ingestion pipeline/workers to fill `feedflash`:
   news (RSS + 29-source registry + Benzinga/IBKR), screener (Finviz Elite/TradingView/
   Schwab), social (StockTwits/Bluesky/Reddit/X), then sentiment scoring (FinBERT/VADER/
   Gemini) and AI ranking/prediction. **This is what turns every empty page green.**
7. Verify each page against live data (re-run the Part 1 probe; expect non-zero counts).

### Phase C — Optional ports / reconciliation (small, judgment)
8. Encrypted credentials-at-rest (only if Ryan stores plaintext) — judgment.
9. Correlation methodology reconciliation — judgment.
10. Re-add the chart **prediction overlay** if wanted — judgment.

### Big-ticket dependencies to size before committing
- **The pipeline + tokens are the real lift, not any port.** Lighting up News/Screener/
  Social/AI requires a pile of credentials/access: **Finviz Elite, Benzinga, IBKR, Schwab,
  Reddit, X/Twitter, Gemini/OpenRouter**, plus SEC/FDA/PR feeds (mostly public). Several are
  paid/authed; some social fetchers are already marked `DISABLED` in the repo
  (`fetch_x_twitter_requires_access`, `fetch_bluesky_finance...403_BLOCKED`).
- **Infra:** Docker + Kafka + Redis + Mongo must run together (the compose stack). Kafka
  is the heaviest dependency; confirm it's needed for the pages you care about or run a
  reduced stack.
- **Bringing "structured-news" or "AI picks" from sentiment-scout would require nothing
  new** — Ryan already has them. The dependency is just **running his pipeline with
  tokens**, not porting code.
- **GPU/model weights** for FinBERT (the sentiment worker pulls `ProsusAI/finbert`); fine
  on CPU but slow — size accordingly.

### Bottom line
FlashFeed is a near-complete app whose data layer simply hasn't been run locally. The
finishing work is ~80% **ops/data** (Docker + tokens + pipeline) and ~20% **integration
cleanup** (free :3001, enrich endpoint, optional prediction overlay). The charts — the
one area that was genuinely ours — are already in and working.

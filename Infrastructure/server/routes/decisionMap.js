import { Router } from 'express'
import mongoose from 'mongoose'

const router = Router()

const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX'])
const NON_STOCK_TICKERS = new Set([
  'BTC', 'ETH', 'LTC', 'DOGE', 'SOL', 'ADA', 'XRP', 'BNB', 'DOT', 'AVAX',
  'MATIC', 'SHIB', 'TRX', 'BCH', 'LINK', 'ATOM', 'UNI', 'ETC', 'FIL',
  'USD', 'USDT', 'USDC', 'SPOT',
])

const DEFAULT_THRESHOLDS = Object.freeze({
  minRelativeVolume: Number(process.env.DECISION_MAP_MIN_REL_VOLUME || 1),
  minAbsPriceChange: Number(process.env.DECISION_MAP_MIN_ABS_CHANGE || 0.5),
  positiveSentiment: Number(process.env.DECISION_MAP_POSITIVE_SENTIMENT || 0.12),
  negativeSentiment: Number(process.env.DECISION_MAP_NEGATIVE_SENTIMENT || -0.12),
  priceChange: Number(process.env.DECISION_MAP_PRICE_THRESHOLD || 0.5),
  minActivityScore: Number(process.env.DECISION_MAP_MIN_ACTIVITY_SCORE || 0),
  newsWindowHours: Number(process.env.DECISION_MAP_NEWS_WINDOW_HOURS || 24),
  socialWindowHours: Number(process.env.DECISION_MAP_SOCIAL_WINDOW_HOURS || 24),
})

function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function toNumber(value, fallback = null) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toSec(value) {
  if (!value) return 0
  if (value instanceof Date) return Math.floor(value.getTime() / 1000)
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return n > 1_000_000_000_000 ? Math.floor(n / 1000) : Math.floor(n)
  const ms = Date.parse(String(value))
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

function normalizeTicker(value) {
  const ticker = String(value || '').trim().replace(/^\$/, '').toUpperCase()
  return /^[A-Z][A-Z0-9.-]{0,5}$/.test(ticker) && !NON_STOCK_TICKERS.has(ticker) ? ticker : ''
}

function tickerValues(doc = {}) {
  const out = new Set()
  const push = (value) => {
    if (Array.isArray(value)) return value.forEach(push)
    String(value || '').split(/[,\s]+/).forEach(part => {
      const ticker = normalizeTicker(part)
      if (ticker) out.add(ticker)
    })
  }
  push(doc.ticker)
  push(doc.symbol)
  push(doc.tickers)
  push(doc.symbols)
  push(doc.matched_mover_tickers)
  push(doc.tickers_mentioned)
  const text = `${doc.text || ''} ${doc.content || ''} ${doc.title || ''}`
  for (const match of text.matchAll(/\$([A-Za-z][A-Za-z0-9.-]{0,5})\b/g)) {
    const ticker = normalizeTicker(match[1])
    if (ticker) out.add(ticker)
  }
  return Array.from(out)
}

function sentimentScore(doc = {}) {
  const direct = toNumber(doc.sentiment_score ?? doc.finbert_score ?? doc.vader_score ?? doc.gemini_sentiment, null)
  if (direct != null) return clamp(direct, -1, 1)
  const text = String(doc.sentiment || doc.label || '').toLowerCase()
  if (/bull|positive|buy|beat|raise|approval|award/.test(text)) return 0.65
  if (/bear|negative|sell|miss|cut|reject|offering|bankrupt/.test(text)) return -0.65
  return 0
}

function recencyWeight(eventSec, windowSec) {
  const age = Math.max(0, Math.floor(Date.now() / 1000) - Number(eventSec || 0))
  if (!eventSec || !windowSec) return 0.35
  return clamp(Math.exp(-age / Math.max(3600, windowSec / 2)), 0.1, 1)
}

function classifyCatalyst(doc = {}) {
  const text = `${doc.event_type || ''} ${doc.category || ''} ${doc.title || ''}`.toLowerCase()
  if (/sec|8-k|10-q|10-k|filing|edgar/.test(`${doc.source || ''} ${text}`)) return 'SEC filing'
  if (/fda|approval|clinical|trial|phase|drug|therapy/.test(text)) return 'FDA/clinical'
  if (/earnings|eps|revenue|guidance|quarter/.test(text)) return 'earnings'
  if (/contract|award|partnership|collaboration|customer|order/.test(text)) return 'contract/partnership'
  if (/buyback|dividend|repurchase/.test(text)) return 'capital return'
  if (/offering|dilution|bankrupt|default|delist/.test(text)) return 'financing/risk'
  if (/merger|acquisition|takeover|ipo/.test(text)) return 'corporate action'
  return doc.title ? 'news catalyst' : ''
}

function isSyntheticOrPrivate(row = {}) {
  const text = `${row.ticker || ''} ${row.company || ''} ${row.industry || ''}`.toLowerCase()
  return /etf|2x|3x|daily target|tradr|leverage shares|direxion|proshares|graniteshares|defiance|spacex|private/.test(text)
}

function sourceFilter(universe) {
  const value = String(universe || 'active_finviz').toLowerCase()
  if (value === 'all') return {}
  if (value === 'numeric_all') {
    return {
      quote_source: { $in: ['finviz_elite_screener', 'tradingview_numeric_screener'] },
      $or: [
        { finviz_status: { $exists: false } },
        { finviz_status: { $ne: 'dropped' } },
        { quote_source: 'tradingview_numeric_screener' },
      ],
    }
  }
  if (value === 'tradingview') return { quote_source: 'tradingview_numeric_screener' }
  // active_finviz: prefer finviz_elite_screener but fall back to any screener data
  return {
    $or: [
      { quote_source: 'finviz_elite_screener', finviz_status: { $ne: 'dropped' } },
      { quote_source: { $exists: false } },
      { quote_source: null },
    ],
  }
}

function activeScreenerMatch(query = {}, thresholds) {
  const minRel = Math.max(0, Number(query.min_rel_volume ?? query.minRelativeVolume ?? thresholds.minRelativeVolume))
  const minAbsChange = Math.max(0, Number(query.min_abs_change ?? query.minAbsPriceChange ?? thresholds.minAbsPriceChange))
  const direction = String(query.direction || 'all').toLowerCase()
  const match = {
    ...sourceFilter(query.universe),
    ticker: { $not: /\./ },
    $or: [
      { exchange: { $in: Array.from(US_EXCHANGES) } },
      { exchange: { $exists: false } },
      { exchange: null },
      { exchange: '' },
    ],
    price: { $gt: 0 },
  }
  if (minRel > 0) match.rel_volume = { $gte: minRel }
  if (direction === 'up') match.change_pct = { $gte: minAbsChange }
  else if (direction === 'down') match.change_pct = { $lte: -minAbsChange }
  else if (minAbsChange > 0) match.$expr = { $gte: [{ $abs: { $ifNull: ['$change_pct', 0] } }, minAbsChange] }
  return match
}

function normalizeScreenerRow(doc = {}) {
  const volume = toNumber(doc.volume, 0) || 0
  const avgVolume = toNumber(doc.avg_volume, null)
  const relVolume = toNumber(doc.rel_volume ?? doc.relative_volume, null) ?? (avgVolume ? volume / Math.max(1, avgVolume) : 0)
  return {
    ticker: normalizeTicker(doc.ticker),
    company: doc.company || '',
    price: toNumber(doc.price, null),
    marketCap: toNumber(doc.market_cap, null),
    priceChangePct: toNumber(doc.change_pct ?? doc.change_percent, 0) || 0,
    relativeVolume: toNumber(relVolume, 0) || 0,
    currentVolume: volume,
    averageVolume: avgVolume,
    exchange: doc.exchange || '',
    sector: doc.sector || '',
    industry: doc.industry || '',
    screenerSource: doc.quote_source || doc.screener_source || doc.source || '',
    screenerStatus: doc.finviz_status || null,
    quoteUpdatedAt: toSec(doc.quote_updated_at),
    finvizSeenAt: toSec(doc.finviz_seen_at),
  }
}

async function activeScreenerRows(db, query, thresholds) {
  const limit = Math.max(1, Math.min(600, Number(query.limit || 150)))
  const sortField = String(query.sort || 'activity').toLowerCase()
  const sort = sortField === 'rel_volume'
    ? { relativeVolume: -1 }
    : sortField === 'change'
      ? { priceChangePct: -1 }
      : { _sourcePriority: -1, activitySort: -1 }

  const rows = await db.collection('screeners').aggregate([
    { $match: activeScreenerMatch(query, thresholds) },
    {
      $addFields: {
        _sourcePriority: {
          $switch: {
            branches: [
              { case: { $and: [{ $eq: ['$quote_source', 'finviz_elite_screener'] }, { $in: ['$finviz_status', ['same', 'added', null]] }] }, then: 3 },
              { case: { $eq: ['$quote_source', 'finviz_elite_screener'] }, then: 2 },
              { case: { $eq: ['$quote_source', 'tradingview_numeric_screener'] }, then: 1 },
            ],
            default: 0,
          },
        },
        activitySort: {
          $multiply: [
            { $ln: { $add: [{ $ifNull: ['$rel_volume', 0] }, 1] } },
            { $add: [{ $abs: { $ifNull: ['$change_pct', 0] } }, 1] },
          ],
        },
      },
    },
    { $sort: { ticker: 1, _sourcePriority: -1, quote_updated_at: -1, finviz_seen_at: -1, activitySort: -1 } },
    { $group: { _id: '$ticker', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $sort: sort },
    { $limit: limit },
  ]).toArray()

  return rows.map(normalizeScreenerRow).filter(row => row.ticker)
}

async function articleEvidence(db, tickers, windowHours) {
  const wanted = new Set(tickers)
  const windowSec = Math.max(1, Number(windowHours || 24)) * 3600
  const sinceSec = Math.floor(Date.now() / 1000) - windowSec
  const docs = await db.collection('articles').find({
    $or: [
      { publish_date: { $gte: sinceSec } },
      { fetched_date: { $gte: sinceSec } },
      { detected_at: { $gte: sinceSec } },
      { createdAt: { $gte: new Date(sinceSec * 1000) } },
    ],
  }, {
    projection: {
      ticker: 1, tickers: 1, matched_mover_tickers: 1, tickers_mentioned: 1,
      title: 1, source: 1, sentiment: 1, sentiment_score: 1, ml_confidence: 1,
      event_type: 1, category: 1, article_kind: 1, publish_date: 1, fetched_date: 1, detected_at: 1, url: 1,
    },
  }).sort({ publish_date: -1, fetched_date: -1, detected_at: -1 }).limit(12000).toArray()

  const map = new Map()
  for (const doc of docs) {
    const score = sentimentScore(doc)
    const eventSec = toSec(doc.publish_date) || toSec(doc.fetched_date) || toSec(doc.detected_at)
    const weight = recencyWeight(eventSec, windowSec)
    const catalyst = classifyCatalyst(doc)
    for (const ticker of tickerValues(doc)) {
      if (!wanted.has(ticker)) continue
      const current = map.get(ticker) || {
        count: 0, weightedScore: 0, weight: 0, bullish: 0, bearish: 0,
        latestSec: 0, latestTitles: [], catalysts: new Map(), sources: new Set(),
      }
      current.count += 1
      current.weightedScore += score * weight
      current.weight += weight
      if (score > 0.12) current.bullish += 1
      if (score < -0.12) current.bearish += 1
      current.latestSec = Math.max(current.latestSec, eventSec)
      current.sources.add(doc.source || 'Unknown')
      if (doc.title && current.latestTitles.length < 3) {
        current.latestTitles.push({ title: doc.title, source: doc.source || '', url: doc.url || '', publishedAt: eventSec, sentiment: score })
      }
      if (catalyst) current.catalysts.set(catalyst, (current.catalysts.get(catalyst) || 0) + 1)
      map.set(ticker, current)
    }
  }
  return map
}

async function socialEvidence(db, tickers, windowHours) {
  const wanted = new Set(tickers)
  const windowSec = Math.max(1, Number(windowHours || 24)) * 3600
  const sinceSec = Math.floor(Date.now() / 1000) - windowSec
  const docs = await db.collection('socials').find({
    $or: [
      { timestamp: { $gte: sinceSec } },
      { fetched_at: { $gte: sinceSec } },
      { created_at: { $gte: sinceSec } },
      { detected_at: { $gte: sinceSec } },
    ],
  }, {
    projection: {
      ticker: 1, symbol: 1, tickers_mentioned: 1, text: 1, content: 1, title: 1,
      platform: 1, source: 1, sentiment: 1, sentiment_score: 1, timestamp: 1, fetched_at: 1, created_at: 1, detected_at: 1,
    },
  }).sort({ timestamp: -1, fetched_at: -1, created_at: -1 }).limit(15000).toArray()

  const map = new Map()
  for (const doc of docs) {
    const score = sentimentScore(doc)
    const eventSec = toSec(doc.timestamp) || toSec(doc.fetched_at) || toSec(doc.created_at) || toSec(doc.detected_at)
    const weight = recencyWeight(eventSec, windowSec)
    for (const ticker of tickerValues(doc)) {
      if (!wanted.has(ticker)) continue
      const current = map.get(ticker) || { count: 0, weightedScore: 0, weight: 0, bullish: 0, bearish: 0, platforms: new Set(), latestSec: 0 }
      current.count += 1
      current.weightedScore += score * weight
      current.weight += weight
      if (score > 0.12) current.bullish += 1
      if (score < -0.12) current.bearish += 1
      current.platforms.add(doc.platform || doc.source || 'Unknown')
      current.latestSec = Math.max(current.latestSec, eventSec)
      map.set(ticker, current)
    }
  }
  return map
}

async function rollingVolumeEvidence(db, tickers) {
  const snapshots = await db.collection('finviz_momentum_snapshots')
    .find({}, { projection: { snapshot_sec: 1, rows: 1 } })
    .sort({ snapshot_sec: -1 })
    .limit(12)
    .toArray()
  const wanted = new Set(tickers)
  const map = new Map()
  for (const snapshot of snapshots.reverse()) {
    for (const row of snapshot.rows || []) {
      const ticker = normalizeTicker(row.ticker)
      if (!wanted.has(ticker)) continue
      const current = map.get(ticker) || []
      current.push({ snapshotSec: Number(snapshot.snapshot_sec || 0), volume: toNumber(row.volume, 0) || 0, relVolume: toNumber(row.rel_volume, 0) || 0 })
      map.set(ticker, current)
    }
  }
  const result = new Map()
  for (const [ticker, rows] of map.entries()) {
    const first = rows[0] || {}
    const last = rows[rows.length - 1] || {}
    result.set(ticker, {
      points: rows,
      rollingVolume: toNumber(last.volume, 0) || 0,
      volumeAcceleration: first.volume ? Number(((toNumber(last.volume, 0) || 0) / Math.max(1, first.volume)).toFixed(3)) : toNumber(last.relVolume, 0) || 0,
    })
  }
  return result
}

function quadrantFor(combinedSentiment, priceChangePct, thresholds) {
  const positiveSentiment = Number(thresholds.positiveSentiment)
  const negativeSentiment = Number(thresholds.negativeSentiment)
  const priceThreshold = Number(thresholds.priceChange)
  if (combinedSentiment >= positiveSentiment && priceChangePct >= priceThreshold) {
    return { quadrant: 'Q1', alignmentStatus: 'sentiment/price aligned bullish', aligned: true, direction: 'bullish' }
  }
  if (combinedSentiment <= negativeSentiment && priceChangePct <= -priceThreshold) {
    return { quadrant: 'Q3', alignmentStatus: 'sentiment/price aligned bearish', aligned: true, direction: 'bearish' }
  }
  if (combinedSentiment <= negativeSentiment && priceChangePct >= priceThreshold) {
    return { quadrant: 'Q2', alignmentStatus: 'divergence: negative sentiment but price rising', aligned: false, direction: 'contrarian_up' }
  }
  if (combinedSentiment >= positiveSentiment && priceChangePct <= -priceThreshold) {
    return { quadrant: 'Q4', alignmentStatus: 'divergence: positive sentiment but price falling', aligned: false, direction: 'failed_positive' }
  }
  return { quadrant: 'Neutral', alignmentStatus: 'neutral/mixed', aligned: false, direction: 'mixed' }
}

function scoreRow(row, article, social, volume, thresholds) {
  const newsSentiment = article?.weight ? article.weightedScore / article.weight : 0
  const socialSentiment = social?.weight ? social.weightedScore / social.weight : 0
  const newsCount = article?.count || 0
  const socialCount = social?.count || 0
  const combinedWeight = (newsCount ? 0.62 : 0) + (socialCount ? 0.38 : 0)
  const combinedSentiment = combinedWeight
    ? ((newsSentiment * (newsCount ? 0.62 : 0)) + (socialSentiment * (socialCount ? 0.38 : 0))) / combinedWeight
    : 0
  const quadrant = quadrantFor(combinedSentiment, row.priceChangePct, thresholds)
  const catalystLabel = article?.catalysts?.size
    ? Array.from(article.catalysts.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : ''
  const latestNewsSec = article?.latestSec || 0
  const newsAgeHours = latestNewsSec ? (Math.floor(Date.now() / 1000) - latestNewsSec) / 3600 : null
  const rollingVolume = volume?.rollingVolume || row.currentVolume || 0
  const volumeAcceleration = volume?.volumeAcceleration || row.relativeVolume || 0
  const relVolumeScore = clamp(Math.log1p(row.relativeVolume) / Math.log(8), 0, 1)
  const priceMoveScore = clamp(Math.abs(row.priceChangePct) / 12, 0, 1)
  const volumeScore = clamp(Math.log10(Math.max(1, row.currentVolume)) / 8, 0, 1)
  const activityScore = Math.round((relVolumeScore * 42 + priceMoveScore * 38 + volumeScore * 20) * 100) / 100
  const evidenceScore =
    (quadrant.aligned ? 18 : quadrant.quadrant === 'Neutral' ? 2 : -20) +
    (catalystLabel ? 12 : -18) +
    Math.min(10, newsCount * 2) +
    Math.min(7, socialCount * 0.6) +
    (newsAgeHours != null && newsAgeHours <= 6 ? 4 : newsAgeHours != null && newsAgeHours > 18 ? -6 : 0)
  const convictionScore = Math.round(clamp(activityScore * 0.42 + evidenceScore, 0, 100))
  const riskFlags = []
  const reasons = []
  if (row.relativeVolume < thresholds.minRelativeVolume) riskFlags.push('WEAK_RELATIVE_VOLUME')
  if (Math.abs(row.priceChangePct) < thresholds.minAbsPriceChange) riskFlags.push('LOW_PRICE_ACTIVITY')
  if (!catalystLabel) riskFlags.push('NO_CATALYST')
  if (!newsCount) riskFlags.push('NO_STRUCTURED_NEWS')
  if (!socialCount) riskFlags.push('NO_SOCIAL_CONFIRMATION')
  if (!quadrant.aligned && quadrant.quadrant !== 'Neutral') riskFlags.push('SENTIMENT_PRICE_DIVERGENCE')
  if (newsAgeHours != null && newsAgeHours > 18) riskFlags.push('STALE_NEWS')
  if (row.screenerStatus === 'dropped') riskFlags.push('NOT_ACTIVE_ON_FINVIZ')
  if (isSyntheticOrPrivate(row)) riskFlags.push('SYNTHETIC_OR_PRIVATE_EXPOSURE')
  if (activityScore >= 65) reasons.push('high numerical activity from screener')
  if (quadrant.aligned) reasons.push(quadrant.alignmentStatus)
  if (catalystLabel) reasons.push(`catalyst: ${catalystLabel}`)
  if (socialCount) reasons.push('social confirmation present')
  if (newsCount) reasons.push('structured news present')

  return {
    ...row,
    rollingVolume,
    volumeAcceleration,
    structuredNewsSentiment: Number(newsSentiment.toFixed(3)),
    socialSentiment: Number(socialSentiment.toFixed(3)),
    combinedSentiment: Number(combinedSentiment.toFixed(3)),
    articleCount: newsCount,
    socialCount,
    catalystLabel,
    quadrant: quadrant.quadrant,
    alignmentStatus: quadrant.alignmentStatus,
    activityScore,
    convictionScore,
    riskFlags,
    reasons,
    latestNewsTitles: article?.latestTitles || [],
    newsSources: article ? Array.from(article.sources).slice(0, 8) : [],
    socialPlatforms: social ? Array.from(social.platforms).slice(0, 8) : [],
    lastUpdated: new Date(Math.max(row.quoteUpdatedAt || 0, latestNewsSec || 0, social?.latestSec || 0) * 1000).toISOString(),
    screenerFirst: true,
  }
}

router.get('/', async (req, res) => {
  try {
    const db = mongoose.connection.db
    if (!db) return res.status(503).json({ ok: false, error: 'MongoDB not connected' })

    const thresholds = {
      ...DEFAULT_THRESHOLDS,
      minRelativeVolume: Math.max(0, Number(req.query.min_rel_volume ?? req.query.minRelativeVolume ?? DEFAULT_THRESHOLDS.minRelativeVolume)),
      minAbsPriceChange: Math.max(0, Number(req.query.min_abs_change ?? req.query.minAbsPriceChange ?? DEFAULT_THRESHOLDS.minAbsPriceChange)),
      positiveSentiment: Number(req.query.positive_sentiment ?? DEFAULT_THRESHOLDS.positiveSentiment),
      negativeSentiment: Number(req.query.negative_sentiment ?? DEFAULT_THRESHOLDS.negativeSentiment),
      priceChange: Math.max(0, Number(req.query.price_threshold ?? DEFAULT_THRESHOLDS.priceChange)),
      minActivityScore: Math.max(0, Number(req.query.min_activity_score ?? DEFAULT_THRESHOLDS.minActivityScore)),
      newsWindowHours: Math.max(1, Math.min(168, Number(req.query.news_window_hours ?? DEFAULT_THRESHOLDS.newsWindowHours))),
      socialWindowHours: Math.max(1, Math.min(168, Number(req.query.social_window_hours ?? DEFAULT_THRESHOLDS.socialWindowHours))),
    }

    const rows = await activeScreenerRows(db, req.query, thresholds)
    const tickers = rows.map(row => row.ticker)
    const [articles, socials, volumes] = await Promise.all([
      articleEvidence(db, tickers, thresholds.newsWindowHours),
      socialEvidence(db, tickers, thresholds.socialWindowHours),
      rollingVolumeEvidence(db, tickers),
    ])

    let scored = rows.map(row => scoreRow(row, articles.get(row.ticker), socials.get(row.ticker), volumes.get(row.ticker), thresholds))
    scored = scored.filter(row => row.activityScore >= thresholds.minActivityScore)
    const search = normalizeTicker(req.query.search || req.query.q || '')
    if (search) scored = scored.filter(row => row.ticker === search)
    const alignment = String(req.query.alignment || '').toLowerCase()
    if (alignment === 'aligned') scored = scored.filter(row => row.quadrant === 'Q1' || row.quadrant === 'Q3')
    if (alignment === 'divergence') scored = scored.filter(row => row.quadrant === 'Q2' || row.quadrant === 'Q4')

    const sortBy = String(req.query.orderBy || req.query.sortBy || 'convictionScore')
    const sortDir = String(req.query.orderDir || 'desc').toLowerCase() === 'asc' ? 1 : -1
    scored.sort((a, b) => {
      const av = a[sortBy] ?? 0
      const bv = b[sortBy] ?? 0
      if (typeof av === 'string') return sortDir === 1 ? av.localeCompare(String(bv)) : String(bv).localeCompare(av)
      return sortDir === 1 ? Number(av || 0) - Number(bv || 0) : Number(bv || 0) - Number(av || 0)
    })

    const summary = scored.reduce((acc, row) => {
      acc[row.quadrant] = (acc[row.quadrant] || 0) + 1
      if (row.riskFlags.includes('SENTIMENT_PRICE_DIVERGENCE')) acc.divergence += 1
      if (row.catalystLabel) acc.withCatalyst += 1
      if (row.socialCount) acc.withSocial += 1
      return acc
    }, { Q1: 0, Q2: 0, Q3: 0, Q4: 0, Neutral: 0, divergence: 0, withCatalyst: 0, withSocial: 0 })

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      universe: String(req.query.universe || 'active_finviz'),
      screener_first: true,
      no_fake_rows: true,
      thresholds,
      count: scored.length,
      summary,
      rows: scored,
      methodology: {
        first_step: 'Query current numeric screener rows using price, relative volume, liquidity, exchange, and source freshness.',
        second_step: 'Attach structured news, social evidence, catalysts, and rolling volume evidence only after the screener universe exists.',
        axes: {
          x: 'combinedSentiment',
          y: 'priceChangePct',
          z: 'relativeVolume',
          bubbleSize: 'rollingVolume / volumeAcceleration',
        },
      },
    })
  } catch (err) {
    console.error('GET /api/decision-map failed:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router

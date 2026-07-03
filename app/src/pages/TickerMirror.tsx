'use client'
import { useState } from 'react'
import useSWR from 'swr'
import type { Article, ScreenerRow as SR } from '@/lib/types'
import { CandlestickChart } from './CandlestickChart'
import { TradingViewChart } from '@/components/charts/TradingViewChart'
import { RollingWindowsTable } from './RollingWindowsTable'
import { TickerEnrichPanels } from './TickerEnrichPanels'
import { useTranslatedText } from '@/lib/translation'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type MirrorTab = 'overview' | 'technicals' | 'financials' | 'correlation' | 'news' | 'enrich'
type NewsSubTab = 'news' | 'reddit' | 'twitter'

interface Props {
  ticker: string
  row: SR
  colSpan?: number
  onClose: () => void
  asPanel?: boolean
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—'
  return Number(n).toFixed(digits)
}

function fmtPct(n: number | null | undefined, signed = true) {
  if (n == null || Number.isNaN(n)) return '—'
  const v = Number(n)
  return `${signed && v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

function fmtM(n: number | null | undefined) {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6)  return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3)  return `${(v / 1e3).toFixed(0)}K`
  return v.toFixed(0)
}

function pctColor(n: number | null | undefined) {
  const v = Number(n ?? 0)
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-neutral'
}

function analystColor(a: string | null | undefined) {
  if (!a) return 'text-neutral'
  if (a === 'Buy' || a === 'Strong Buy') return 'text-emerald-400'
  if (a === 'Sell' || a === 'Strong Sell') return 'text-red-400'
  return 'text-yellow-300'
}

function getChartParams(marketCap: number | null | undefined) {
  const cap = marketCap ?? 0
  if (cap >= 10e9)   return { range: '5d', interval: '30m', capLabel: 'Large/Mega' }
  if (cap >= 2e9)    return { range: '3d', interval: '15m', capLabel: 'Mid' }
  if (cap >= 300e6)  return { range: '2d', interval: '5m',  capLabel: 'Small' }
  return { range: '1d', interval: '5m', capLabel: 'Micro' }
}

const SECTOR_COLORS = ['#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#f472b6', '#64748b']

interface PieSlice { label: string; value: number; color: string }

function MiniPie({ title, slices, centerLabel }: { title: string; slices: PieSlice[]; centerLabel?: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const r = 44, cx = 50, cy = 50

  const paths: React.ReactNode[] = []
  if (total > 0) {
    const visible = slices.filter(s => s.value > 0)
    if (visible.length === 1) {
      paths.push(<circle key={visible[0].label} cx={cx} cy={cy} r={r} fill={visible[0].color} />)
    } else {
      let angle = -Math.PI / 2
      for (const s of visible) {
        const sweep = (s.value / total) * Math.PI * 2
        const a1 = angle + sweep
        const x0 = cx + r * Math.cos(angle), y0 = cy + r * Math.sin(angle)
        const x1 = cx + r * Math.cos(a1),    y1 = cy + r * Math.sin(a1)
        paths.push(
          <path
            key={s.label}
            d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`}
            fill={s.color}
            stroke="#0b1220"
            strokeWidth="1"
          />
        )
        angle = a1
      }
    }
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">{title}</div>
      {total === 0 ? (
        <p className="text-xs text-neutral">No data</p>
      ) : (
        <div className="flex items-center gap-3">
          <svg width="88" height="88" viewBox="0 0 100 100" className="shrink-0">{paths}</svg>
          <div className="flex flex-col gap-1 text-[10px] min-w-0">
            {slices.filter(s => s.value > 0).map(s => (
              <div key={s.label} className="flex items-center gap-1.5 min-w-0">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-slate-300 truncate">
                  {s.label} <span className="text-neutral">({s.value} · {((s.value / total) * 100).toFixed(0)}%)</span>
                </span>
              </div>
            ))}
            {centerLabel && <div className="text-[9px] text-slate-600 mt-0.5">{centerLabel}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function SentimentDonut({ bullish, bearish, neutral }: { bullish: number; bearish: number; neutral: number }) {
  const total = bullish + bearish + neutral
  if (total === 0) return <p className="text-xs text-neutral">No sentiment data</p>

  const r = 36, sw = 10, cx = 50, cy = 50
  const circ = 2 * Math.PI * r
  const pBull = bullish / total
  const pNeu  = neutral  / total
  const pBear = bearish  / total
  const bullLen = pBull * circ
  const neuLen  = pNeu  * circ
  const bearLen = pBear * circ

  const arc = (len: number, offset: number, color: string) => (
    <circle
      r={r} cx={cx} cy={cy} fill="none"
      stroke={color} strokeWidth={sw}
      strokeDasharray={`${len} ${circ - len}`}
      strokeDashoffset={-offset}
      transform={`rotate(-90 ${cx} ${cy})`}
      strokeLinecap="butt"
    />
  )

  return (
    <div className="flex items-center gap-4">
      <svg width="100" height="100" viewBox="0 0 100 100" className="shrink-0">
        <circle r={r} cx={cx} cy={cy} fill="none" stroke="#1e293b" strokeWidth={sw} />
        {arc(bullLen, 0, '#10b981')}
        {arc(neuLen, bullLen, '#475569')}
        {arc(bearLen, bullLen + neuLen, '#ef4444')}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">{total}</text>
        <text x={cx} y={cy + 9} textAnchor="middle" fill="#64748b" fontSize="8">articles</text>
      </svg>
      <div className="flex flex-col gap-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-emerald-400">{(pBull * 100).toFixed(0)}% Bull <span className="text-neutral">({bullish})</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
          <span className="text-slate-400">{(pNeu * 100).toFixed(0)}% Neutral <span className="text-neutral">({neutral})</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          <span className="text-red-400">{(pBear * 100).toFixed(0)}% Bear <span className="text-neutral">({bearish})</span></span>
        </div>
      </div>
    </div>
  )
}

function CorrelationGauge({ label, value, description }: { label: string; value: number; description: string }) {
  const pct = Math.max(2, ((value + 1) / 2) * 100)
  const color = value > 0.3 ? '#10b981' : value < -0.3 ? '#ef4444' : '#94a3b8'
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] text-neutral">{label}</span>
        <span className="font-mono text-[11px] font-bold" style={{ color }}>
          {value > 0 ? '+' : ''}{value.toFixed(2)}
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="text-[10px] text-slate-600 mt-0.5">{description}</div>
    </div>
  )
}

function ArticleItem({ article, index }: { article: Article; index: number }) {
  const { translated } = useTranslatedText(article.title)
  const a = article as any
  return (
    <a
      key={article.id || article.article_id || article.url || index}
      href={article.url || '#'}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-2 group"
    >
      <span className={`shrink-0 mt-0.5 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${
        a.fromWeb ? 'bg-amber-500/15 text-amber-400'
        : article.sentiment === 'bullish' ? 'bg-emerald-500/15 text-emerald-400'
        : article.sentiment === 'bearish' ? 'bg-red-500/15 text-red-400'
        : 'bg-slate-600/20 text-slate-400'
      }`}>
        {a.fromWeb ? 'WEB' : (article.sentiment ?? 'N')}
      </span>
      <div className="min-w-0">
        <div className="text-xs text-slate-200 group-hover:text-white leading-snug line-clamp-2">{translated}</div>
        <div className="text-[10px] text-neutral mt-0.5">
          {article.source}
          {article.publish_date
            ? ` · ${new Date(article.publish_date * 1000).toLocaleDateString()}`
            : a.publishedAt
              ? ` · ${new Date(a.publishedAt).toLocaleDateString()}`
              : ''}
        </div>
      </div>
    </a>
  )
}

function TickerMirrorContent({ ticker, row, onClose }: { ticker: string; row: SR; onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<MirrorTab>('overview')
  const [newsSubTab, setNewsSubTab] = useState<NewsSubTab>('news')
  const [grokText, setGrokText] = useState<string | null>(null)
  const [grokLoading, setGrokLoading] = useState(false)
  const { data: aiStatus }  = useSWR('/api/grok/status', fetcher, { revalidateOnFocus: false })
  const { data: keyStats }  = useSWR(`/api/ticker/${ticker}/keystats`, fetcher, { revalidateOnFocus: false })

  // Reads from live keystats first, then falls back to the screener row for that field
  const ks = (key: string) => keyStats?.[key] ?? (row as any)[key] ?? null

  const { range, interval, capLabel } = getChartParams((row as any).market_cap)
  const { data: chartData } = useSWR(`/api/charts/${ticker}?range=${range}&interval=${interval}`, fetcher)
  const { data: newsData } = useSWR(`/api/articles?ticker=${ticker}&limit=10&recent_days=30`, fetcher)
  const { data: webFallbackData } = useSWR(
    newsData && (newsData.articles?.length ?? 0) === 0
      ? `/api/articles/web-fallback?ticker=${ticker}`
      : null,
    fetcher
  )
  const { data: redditData } = useSWR(
    newsSubTab === 'reddit' ? `/api/reddit/posts/${ticker}?limit=8` : null,
    fetcher
  )
  const { data: twitterData } = useSWR(
    newsSubTab === 'twitter' ? `/api/twitter/posts/${ticker}?limit=10` : null,
    fetcher
  )
  const { data: allStocksData } = useSWR('/api/screener?limit=200', fetcher, { revalidateOnFocus: false })

  const allRows: SR[] = Array.isArray(allStocksData) ? allStocksData : allStocksData?.tickers ?? allStocksData?.rows ?? []

  const breadthSlices: PieSlice[] = [
    { label: 'Gainers', value: allRows.filter(r => Number(r.change_pct ?? 0) > 0).length,  color: '#10b981' },
    { label: 'Losers',  value: allRows.filter(r => Number(r.change_pct ?? 0) < 0).length,  color: '#ef4444' },
    { label: 'Flat',    value: allRows.filter(r => Number(r.change_pct ?? 0) === 0).length, color: '#475569' },
  ]

  const sectorCounts = new Map<string, number>()
  for (const r of allRows) {
    const s = (r.sector || 'Other').trim() || 'Other'
    sectorCounts.set(s, (sectorCounts.get(s) ?? 0) + 1)
  }
  const sortedSectors = [...sectorCounts.entries()].sort((a, b) => b[1] - a[1])
  const topSectors = sortedSectors.slice(0, 5)
  const otherCount = sortedSectors.slice(5).reduce((s, [, n]) => s + n, 0)
  const sectorSlices: PieSlice[] = [
    ...topSectors.map(([label, value], i) => ({ label, value, color: SECTOR_COLORS[i] })),
    ...(otherCount > 0 ? [{ label: 'Other', value: otherCount, color: SECTOR_COLORS[5] }] : []),
  ]

  const candles       = chartData?.candles ?? []
  const bollinger     = chartData?.bollinger
  const predicted     = chartData?.predicted ?? []
  const localArticles: Article[] = newsData?.articles ?? []
  const news: Article[]          = localArticles.length > 0 ? localArticles : (webFallbackData?.articles ?? [])
  const isWebFallback = localArticles.length === 0 && (webFallbackData?.articles?.length ?? 0) > 0
  const newsCount     = news.length

  const bullishCount = (row as any).bullish_count ?? 0
  const bearishCount = (row as any).bearish_count ?? 0
  const neutralCount = (row as any).neutral_count ?? 0

  const sentimentScore = row.structured_sentiment ?? 0
  const changePct      = row.change_pct ?? 0
  const density        = row.social_message_density ?? 0

  // Simple directional alignment score for price vs news sentiment
  const priceSentAlign = sentimentScore === 0 ? 0
    : (changePct > 0 && sentimentScore > 0) || (changePct < 0 && sentimentScore < 0)
      ? Math.min(1, Math.abs(sentimentScore) * 2)
      : -Math.min(1, Math.abs(sentimentScore) * 2)

  const absPriceMove    = Math.min(1, Math.abs(changePct) / 10)
  const normalDensity   = Math.min(1, density)
  const priceDensityCorr = ((absPriceMove + normalDensity) / 2) * (changePct >= 0 ? 1 : -1)

  const low52  = ks('low_52w')
  const high52 = ks('high_52w')
  const w52range = low52 != null && high52 != null
    ? `$${Number(low52).toFixed(2)} – $${Number(high52).toFixed(2)}`
    : '—'

  const priceChanges: [string, number | null | undefined][] = [
    ['1D', row.change_pct],
    ['1W', (row as any).perf_week],
    ['1M', (row as any).perf_month],
    ['3M', (row as any).perf_quarter],
    ['1Y', (row as any).perf_year],
  ]

  const SECTION_TABS: { key: MirrorTab; label: string }[] = [
    { key: 'overview',     label: 'Overview' },
    { key: 'technicals',   label: 'Technicals' },
    { key: 'financials',   label: 'Financials' },
    { key: 'correlation',  label: 'Correlation' },
    { key: 'news',         label: `News${newsCount > 0 ? ` (${newsCount})` : ''}` },
    { key: 'enrich',       label: 'Enrich' },
  ]

  const runGrok = async () => {
    setGrokLoading(true)
    setGrokText(null)
    try {
      const resp = await fetch('/api/grok/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          context: [
            `Price: $${row.price?.toFixed(2) ?? '?'}`,
            `Change: ${row.change_pct?.toFixed(2) ?? '?'}%`,
            `Sector: ${row.sector ?? '?'}`,
            `Market Cap: ${fmtM((row as any).market_cap)}`,
            `P/E: ${row.pe_ratio?.toFixed(1) ?? '?'}`,
            `RSI: ${((row as any).rsi ?? 0).toFixed(1)}`,
            `News Sentiment: ${(row.structured_sentiment ?? 0).toFixed(2)}`,
            `Analyst: ${row.analyst ?? '?'}`,
          ].join(', '),
        }),
      })
      const json = await resp.json()
      setGrokText(json.analysis ?? json.error ?? 'No response')
    } catch (e: any) {
      setGrokText(`Error: ${e.message}`)
    } finally {
      setGrokLoading(false)
    }
  }

  return (
    <div className="bg-[#080f1a]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-[#0c1420]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-accent text-sm">{ticker}</span>
          {row.price != null && <span className="font-mono text-white">${row.price.toFixed(2)}</span>}
          {priceChanges.map(([label, val]) => val != null && (
            <span key={label} className="flex items-center gap-0.5">
              <span className="text-[9px] text-slate-500">{label}</span>
              <span className={`font-mono text-[11px] font-medium ${pctColor(val)}`}>
                {(val as number) >= 0 ? '+' : ''}{(val as number).toFixed(1)}%
              </span>
            </span>
          ))}
          {row.company && <span className="text-neutral text-xs hidden lg:inline">{row.company}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runGrok}
            disabled={grokLoading}
            title={aiStatus?.engine === 'grok' ? 'Analyze with Grok (xAI)' : aiStatus?.engine === 'claude' ? 'Analyze with Claude (Anthropic)' : 'AI analysis from local data — add GROK_API_KEY or ANTHROPIC_API_KEY in Railway for LLM analysis'}
            className="text-[11px] px-2 py-1 bg-violet-600/20 border border-violet-500/30 text-violet-300 rounded hover:bg-violet-600/30 disabled:opacity-50 transition-colors"
          >
            {grokLoading ? 'Analyzing…' : aiStatus?.engine === 'grok' ? '✦ Grok' : aiStatus?.engine === 'claude' ? '✦ Claude' : '✦ AI'}
          </button>
          <button onClick={onClose} className="text-neutral hover:text-white text-xl leading-none w-6 h-6 flex items-center justify-center">×</button>
        </div>
      </div>

      {grokText && (
        <div className="mx-3 mt-2 p-3 bg-violet-900/20 border border-violet-500/20 rounded text-xs text-slate-200">
          <span className="text-violet-400 font-semibold mr-1">✦ Grok:</span>{grokText}
        </div>
      )}

      {/* Section tabs */}
      <div className="flex items-center border-b border-border/20 px-4 bg-[#0a1420]">
        {SECTION_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveSection(tab.key)}
            className={`px-3 py-2 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
              activeSection === tab.key
                ? 'border-accent text-white'
                : 'border-transparent text-neutral hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-slate-600 pr-1">{capLabel} Cap · {range}</span>
      </div>

      {/* Overview */}
      {activeSection === 'overview' && (
        <div className="flex divide-x divide-border/20">
          <div className="flex-1 min-w-0 p-3">
            <div className="h-[260px]">
              {candles.length > 0 ? (
                <CandlestickChart candles={candles} bollinger={bollinger} predicted={predicted} newsEvents={[]} />
              ) : (
                <TradingViewChart ticker={ticker} interval={interval} height={260} />
              )}
            </div>
          </div>
          <div className="hidden lg:flex w-[520px] shrink-0 p-3 gap-4 flex-col justify-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide -mb-1">All Screener Stocks</div>
            <div className="flex gap-4">
              <MiniPie title="Market Breadth" slices={breadthSlices} centerLabel={`${allRows.length} stocks`} />
              <MiniPie title="Sector Mix" slices={sectorSlices} />
            </div>
            <div className="flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">{ticker} Article Sentiment</div>
                <SentimentDonut bullish={bullishCount} bearish={bearishCount} neutral={neutralCount} />
              </div>
            </div>
          </div>
          <div className="w-[200px] shrink-0 p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Key Stats</div>
            {([
              ['Market Cap', fmtM(ks('market_cap'))],
              ['P/E', fmt(ks('pe_ratio'), 1)],
              ['52W Range', w52range],
              ['Analyst', ks('analyst') ?? '—'],
              ['Target', ks('target_price') != null ? `$${Number(ks('target_price')).toFixed(2)}` : '—'],
              ['Beta', fmt(ks('beta'), 2)],
              ['Short Float', ks('float_short') != null ? `${Number(ks('float_short')).toFixed(1)}%` : '—'],
              ['Earnings', ks('earnings_date') ?? '—'],
            ] as [string, string][]).map(([l, v]) => (
              <div key={l} className="flex justify-between text-[11px] border-b border-border/10 py-1">
                <span className="text-neutral">{l}</span>
                <span className={`font-mono ${l === 'Analyst' ? analystColor(ks('analyst')) : 'text-white'}`}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Technicals */}
      {activeSection === 'technicals' && (
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-x-6">
          {([
            ['RSI',        fmt((row as any).rsi, 1)],
            ['ATR',        fmt((row as any).atr, 2)],
            ['Beta',       fmt(ks('beta'), 2)],
            ['SMA 20',     fmtPct((row as any).sma20)],
            ['SMA 50',     fmtPct((row as any).sma50)],
            ['SMA 200',    fmtPct((row as any).sma200)],
            ['Gap',        fmtPct((row as any).gap)],
            ['Rel Vol',    (row as any).rel_volume != null ? `${Number((row as any).rel_volume).toFixed(2)}x` : '—'],
            ['Avg Vol',    fmtM((row as any).avg_volume)],
            ['52W High',   high52 != null ? `$${Number(high52).toFixed(2)}` : '—'],
            ['52W Low',    low52  != null ? `$${Number(low52).toFixed(2)}`  : '—'],
            ['Short Float', ks('float_short') != null ? `${Number(ks('float_short')).toFixed(1)}%` : '—'],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} className="flex justify-between text-[11px] border-b border-border/10 py-1.5">
              <span className="text-neutral">{l}</span>
              <span className="font-mono text-white">{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Financials */}
      {activeSection === 'financials' && (
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-x-6">
          {([
            ['Market Cap',    fmtM(ks('market_cap'))],
            ['P/E',           fmt(ks('pe_ratio'), 1)],
            ['Fwd P/E',       fmt(ks('forward_pe'), 1)],
            ['PEG',           fmt((row as any).peg, 2)],
            ['P/S',           fmt((row as any).ps_ratio, 2)],
            ['P/B',           fmt((row as any).pb_ratio, 2)],
            ['EPS Next Y',    fmtPct((row as any).eps_growth_next_y)],
            ['Sales Q/Q',     fmtPct((row as any).sales_growth)],
            ['Gross Margin',  fmtPct((row as any).gross_margin)],
            ['Op. Margin',    fmtPct((row as any).operating_margin)],
            ['ROE',           fmtPct((row as any).roe)],
            ['Dividend',      (row as any).dividend_yield != null ? `${(row as any).dividend_yield.toFixed(2)}%` : '—'],
            ['Inst Own',      (row as any).inst_own != null ? `${(row as any).inst_own.toFixed(1)}%` : '—'],
            ['Insider Own',   (row as any).insider_own != null ? `${(row as any).insider_own.toFixed(1)}%` : '—'],
            ['Debt/Eq',       fmt((row as any).debt_equity, 2)],
            ['Earnings',      ks('earnings_date') ?? '—'],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} className="flex justify-between text-[11px] border-b border-border/10 py-1.5">
              <span className="text-neutral">{l}</span>
              <span className="font-mono text-white">{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Correlation */}
      {activeSection === 'correlation' && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-3">Article Sentiment Distribution</div>
            <SentimentDonut bullish={bullishCount} bearish={bearishCount} neutral={neutralCount} />
            <div className="mt-5 space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Correlation Scores</div>
              <CorrelationGauge
                label="Price ↔ News Sentiment"
                value={priceSentAlign}
                description={priceSentAlign >= 0 ? 'Price aligns with news direction' : 'Price diverges from news sentiment'}
              />
              <CorrelationGauge
                label="Price ↔ Message Density"
                value={priceDensityCorr}
                description={`Density: ${density.toFixed(3)}/min · Move: ${fmtPct(changePct)}`}
              />
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-3">Price Performance</div>
            <div className="space-y-2 mb-5">
              {priceChanges.map(([label, val]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral w-6 shrink-0">{label}</span>
                  <div className="flex-1 h-5 bg-slate-800 rounded overflow-hidden relative">
                    {val != null && (
                      <div
                        className={`absolute top-0 h-full rounded ${Number(val) >= 0 ? 'bg-emerald-600/60' : 'bg-red-600/60'}`}
                        style={{
                          width: `${Math.min(50, Math.abs(Number(val)) * 3)}%`,
                          left: Number(val) >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(Number(val)) * 3)}%`,
                        }}
                      />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-[10px] font-mono font-bold ${pctColor(val)}`}>
                        {val != null ? `${Number(val) >= 0 ? '+' : ''}${Number(val).toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Social Metrics</div>
            {([
              ['ST Sentiment', fmt(row.social_message_sentiment, 2)],
              ['ST Density',   `${(row.social_message_density ?? 0).toFixed(3)}/m`],
              ['ST Messages',  String(row.stocktwits_message_count ?? 0)],
              ['All Social',   fmt(row.social_sentiment, 2)],
              ['All Posts',    String(row.message_count ?? 0)],
            ] as [string, string][]).map(([l, v]) => (
              <div key={l} className="flex justify-between text-[11px] border-b border-border/10 py-1">
                <span className="text-neutral">{l}</span>
                <span className="font-mono text-white">{v}</span>
              </div>
            ))}
            <div className="mt-4">
              <RollingWindowsTable ticker={ticker} />
            </div>
          </div>
        </div>
      )}

      {/* News */}
      {activeSection === 'news' && (
        <div>
          <div className="flex items-center border-b border-border/20 px-4">
            {(['news', 'reddit', 'twitter'] as NewsSubTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setNewsSubTab(tab)}
                className={`px-3 py-2 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
                  newsSubTab === tab ? 'border-accent text-white' : 'border-transparent text-neutral hover:text-white'
                }`}
              >
                {tab === 'news'
                  ? `News${newsCount > 0 ? ` (${newsCount})` : ''}${isWebFallback ? ' · web' : ''}`
                  : tab === 'reddit'
                  ? 'Reddit'
                  : twitterData?.source === 'stocktwits' ? 'StockTwits' : '𝕏'}
              </button>
            ))}
          </div>
          <div className="px-4 py-3">
            {newsSubTab === 'news' && (
              news.length === 0
                ? <div className="text-xs text-neutral">No recent news found for {ticker}.</div>
                : (
                  <>
                    {isWebFallback && (
                      <div className="text-[10px] text-amber-500/70 mb-2">Showing web results — no local articles found</div>
                    )}
                    <div className="flex flex-col gap-2">
                      {news.map((a, i) => (
                        <ArticleItem key={a.id || a.article_id || a.url || i} article={a} index={i} />
                      ))}
                    </div>
                  </>
                )
            )}
            {newsSubTab === 'reddit' && (
              !redditData
                ? <div className="text-xs text-neutral animate-pulse">Loading Reddit posts…</div>
                : (redditData.posts ?? []).length === 0
                  ? (
                    <div className="flex flex-col gap-2 items-start">
                      <span className="text-xs text-neutral">No relevant Reddit posts found for ${ticker}.</span>
                      <a
                        href={`https://www.reddit.com/search/?q=%24${ticker}&sort=new&t=week`}
                        target="_blank" rel="noreferrer"
                        className="text-[11px] text-orange-400 hover:text-orange-300 flex items-center gap-1"
                      >
                        Search Reddit for ${ticker} →
                      </a>
                    </div>
                  )
                  : (
                    <div className="flex flex-col gap-2">
                      {redditData.source === 'pullpush' && (
                        <div className="text-[10px] text-slate-500 mb-1 flex items-center justify-between">
                          <span>Via Pushshift archive</span>
                          <a href={`https://www.reddit.com/search/?q=%24${ticker}&sort=new&t=week`} target="_blank" rel="noreferrer" className="text-orange-400 hover:text-orange-300">More on Reddit →</a>
                        </div>
                      )}
                      {(redditData.posts as any[]).map(p => (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 group">
                          <div className="shrink-0 mt-0.5 flex flex-col items-center min-w-[30px]">
                            <span className="text-orange-400 text-[10px] font-bold leading-none">▲</span>
                            {p.score != null && <span className="text-[10px] text-neutral font-mono">{p.score >= 1000 ? `${(p.score / 1000).toFixed(1)}k` : p.score}</span>}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs text-slate-200 group-hover:text-white leading-snug line-clamp-2">{p.title}</div>
                            <div className="text-[10px] text-neutral mt-0.5">
                              r/{p.subreddit}{p.num_comments != null ? ` · ${p.num_comments} comments` : ''}
                              {p.created_utc ? ` · ${new Date(p.created_utc * 1000).toLocaleDateString()}` : ''}
                            </div>
                            {p.preview && <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{p.preview}</div>}
                          </div>
                        </a>
                      ))}
                    </div>
                  )
            )}

            {newsSubTab === 'twitter' && (
              !twitterData
                ? <div className="text-xs text-neutral animate-pulse">Loading social posts…</div>
                : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      {twitterData.source === 'stocktwits'
                        ? <span className="text-[10px] text-slate-500">StockTwits live feed</span>
                        : <span className="text-[10px] text-slate-500">𝕏 posts</span>
                      }
                      <a
                        href={`https://x.com/search?q=%24${ticker}&src=typed_query&f=live`}
                        target="_blank" rel="noreferrer"
                        className="text-[11px] text-sky-400 hover:text-sky-300"
                      >
                        View ${ticker} on 𝕏 →
                      </a>
                    </div>
                    {(twitterData.posts ?? []).length === 0
                      ? <div className="text-xs text-neutral">No recent posts found for {ticker}.</div>
                      : (
                        <div className="flex flex-col gap-2">
                          {(twitterData.posts as any[]).map(p => {
                            const isSt = twitterData.source === 'stocktwits'
                            return (
                              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 group">
                                <div className="shrink-0 w-7 pt-0.5 flex flex-col items-center gap-0.5">
                                  <span className={`text-[11px] font-bold leading-none ${isSt ? 'text-green-400' : 'text-sky-400'}`}>{isSt ? '𝕊𝕋' : '𝕏'}</span>
                                  {p.likes > 0 && (
                                    <span className="text-[9px] text-neutral font-mono">{p.likes >= 1000 ? `${(p.likes / 1000).toFixed(1)}k` : p.likes}♥</span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs text-slate-200 group-hover:text-white leading-snug line-clamp-3">{p.text}</div>
                                  <div className="text-[10px] text-neutral mt-0.5 flex items-center gap-2">
                                    <span className={isSt ? 'text-green-500' : 'text-sky-500'}>@{p.author}</span>
                                    {p.sentiment && <span className={p.sentiment === 'Bullish' ? 'text-emerald-400' : p.sentiment === 'Bearish' ? 'text-red-400' : 'text-neutral'}>{p.sentiment}</span>}
                                    {p.retweets > 0 && <span>{p.retweets} RT</span>}
                                    {p.replies > 0  && <span>{p.replies} replies</span>}
                                    {p.created_at && <span>{new Date(p.created_at).toLocaleDateString()}</span>}
                                  </div>
                                </div>
                              </a>
                            )
                          })}
                        </div>
                      )
                    }
                  </>
                )
            )}
          </div>
        </div>
      )}

      {/* Enrich */}
      {activeSection === 'enrich' && (
        <div className="px-4 pb-4">
          <TickerEnrichPanels ticker={ticker} />
        </div>
      )}
    </div>
  )
}

export function TickerMirror({ ticker, row, colSpan = 1, onClose, asPanel = false }: Props) {
  if (asPanel) {
    return <TickerMirrorContent ticker={ticker} row={row} onClose={onClose} />
  }
  return (
    <tr>
      <td colSpan={colSpan} className="p-0 border-b border-border">
        <TickerMirrorContent ticker={ticker} row={row} onClose={onClose} />
      </td>
    </tr>
  )
}

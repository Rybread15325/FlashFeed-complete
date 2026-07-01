'use client'
import { useState, useCallback, useEffect } from 'react'
import { CandlestickChart } from './CandlestickChart'
import { TradingViewChart } from '@/components/charts/TradingViewChart'
import { RSIChart } from './RSIChart'
import { MACDChart } from './MACDChart'
import { ResearchChart, type ResearchMode } from './ResearchChart'
import { getAllChartStocks } from '../lib/stocks'
import { ChartsGridPage } from './ChartsGridPage'

interface ChartData {
  candles: Array<{ time: string | number; open: number; high: number; low: number; close: number; volume?: number }>
  bollinger?: { upper: Array<{ time: string | number; value: number }>; lower: Array<{ time: string | number; value: number }> }
  rsi?: Array<{ time: string | number; value: number }>
  macd?: { macd: Array<{ time: string | number; value: number }>; signal: Array<{ time: string | number; value: number }>; histogram: Array<{ time: string | number; value: number }> }
  predicted?: Array<{ time: string | number; value: number }>
  news_events?: Array<{ time: string | number; position?: string; color?: string; shape?: string; text?: string; title?: string; source?: string }>
  prediction_events?: Array<{ time: string | number; title?: string; text?: string; entry_price?: number; label_5m?: { return_pct?: number; direction_correct?: boolean } | null }>
  sentiment?: Array<{ time: string | number; value: number }>
  social_density?: Array<{ time: string | number; value: number; scaled?: number; count?: number; session?: string }>
  source_status?: { price?: string; price_source?: string; price_detail?: string; social?: string; news?: string; predictions?: string }
}

const RANGES    = ['1d', '5d', '1mo', '3mo', '6mo', '1y'] as const
const INTERVALS = ['1m', '5m', '15m', '1h', '1d', '1wk'] as const
const RANGE_LABELS: Record<string, string>    = { '1d': '1 Day', '5d': '5 Days', '1mo': '1 Month', '3mo': '3 Months', '6mo': '6 Months', '1y': '1 Year' }
const INT_LABELS: Record<string, string>      = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '1d': '1d', '1wk': '1wk' }

type View = 'candles' | ResearchMode

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'candles', label: 'Candlestick + Indicators' },
  { key: 'pd',      label: 'Price + Density' },
  { key: 'sent',    label: 'Sentiment Score' },
  { key: 'ds',      label: 'Density vs Sentiment' },
]

const WIN_OPTS: Array<{ key: 'full' | '2h' | '1h'; label: string }> = [
  { key: 'full', label: 'Full' },
  { key: '2h',   label: 'Last 2h' },
  { key: '1h',   label: 'Last 1h' },
]

export function ChartsPage() {
  const [chartsTab, setChartsTab] = useState<'charts' | 'grid'>('charts')
  const [ticker, setTicker]         = useState('AAPL')
  const [range, setRange]           = useState<string>('1d')
  const [interval, setInterval]     = useState<string>('1m')
  const [data, setData]             = useState<ChartData | null>(null)
  const [loading, setLoading]       = useState(false)
  const [activeTicker, setActiveTicker] = useState<string | null>(null)
  const [autoLoaded, setAutoLoaded] = useState(false)
  const [view, setView]             = useState<View>('candles')
  const [win, setWin]               = useState<'full' | '2h' | '1h'>('full')

  const loadChart = useCallback(async (override?: string) => {
    const sym = (typeof override === 'string' ? override : ticker).trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    try {
      const res  = await fetch(`/api/charts/${sym}?range=${range}&interval=${interval}`)
      const json = await res.json()
      setData(json)
      setActiveTicker(sym)
    } finally {
      setLoading(false)
    }
  }, [ticker, range, interval])

  useEffect(() => {
    if (!autoLoaded && !data && !loading) { setAutoLoaded(true); loadChart() }
  }, [autoLoaded, data, loading, loadChart])

  // Adapt ChartData to the number-time format ResearchChart expects
  const researchData = data ? {
    candles:        (data.candles ?? []).map(c => ({ ...c, time: typeof c.time === 'string' ? Math.floor(Date.parse(c.time) / 1000) : Number(c.time) })),
    social_density: (data.social_density ?? []).map(d => ({ ...d, time: typeof d.time === 'string' ? Math.floor(Date.parse(d.time) / 1000) : Number(d.time), value: d.value })),
    sentiment:      (data.sentiment ?? []).map(s => ({ ...s, time: typeof s.time === 'string' ? Math.floor(Date.parse(s.time) / 1000) : Number(s.time) })),
  } : null

  return (
    <div>
      {/* Charts / Charts Grid sub-tabs */}
      <div className="flex items-center gap-1 border-b border-border mb-4">
        {(['charts', 'grid'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setChartsTab(tab)}
            className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              chartsTab === tab
                ? 'text-white border-sky-400'
                : 'text-neutral border-transparent hover:text-white hover:border-slate-600'
            }`}
          >
            {tab === 'charts' ? 'Charts' : 'Charts Grid'}
          </button>
        ))}
      </div>

      {chartsTab === 'grid' && <ChartsGridPage />}
      {chartsTab === 'charts' && <>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <select
          value={getAllChartStocks().includes(ticker) ? ticker : ''}
          onChange={e => { const v = e.target.value; if (v) { setTicker(v); loadChart(v) } }}
          className="bg-bg border border-border text-sm text-neutral rounded px-2 py-2 focus:outline-none focus:border-accent"
        >
          <option value="">Top stocks ▾</option>
          {getAllChartStocks().map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <input
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && loadChart()}
          placeholder="Ticker…"
          className="w-[120px] bg-bg border border-border text-sm text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-accent placeholder:text-slate-600"
        />

        <select value={range} onChange={e => setRange(e.target.value)}
          className="bg-bg border border-border text-sm text-neutral rounded px-2 py-2 focus:outline-none focus:border-accent">
          {RANGES.map(r => <option key={r} value={r}>{RANGE_LABELS[r]}</option>)}
        </select>

        <select value={interval} onChange={e => setInterval(e.target.value)}
          className="bg-bg border border-border text-sm text-neutral rounded px-2 py-2 focus:outline-none focus:border-accent">
          {INTERVALS.map(i => <option key={i} value={i}>{INT_LABELS[i]}</option>)}
        </select>

        <button
          onClick={() => loadChart()}
          disabled={loading || !ticker.trim()}
          className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-sky-400 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Loading…' : 'Load Chart'}
        </button>

        {activeTicker && <span className="text-accent font-mono font-bold text-lg ml-1">{activeTicker}</span>}

        {/* Window selector (research views only) */}
        {view !== 'candles' && (
          <div className="flex items-stretch rounded overflow-hidden border border-border ml-auto">
            {WIN_OPTS.map(w => (
              <button key={w.key} onClick={() => setWin(w.key)}
                className={`px-3 py-1.5 text-xs transition-colors ${win === w.key ? 'bg-accent text-white' : 'bg-surface text-neutral hover:text-white'}`}>
                {w.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-0 mb-3 border-b border-border">
        {VIEWS.map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px ${
              view === v.key ? 'text-white border-accent' : 'text-neutral border-transparent hover:text-white'
            }`}>
            {v.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-neutral pr-2">extended hours · 04:00–20:00 ET</span>
      </div>

      {/* Chart area */}
      {data ? (
        <>
          {view === 'candles' && (
            <div className="space-y-3">
              {data.candles?.length ? (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <Status label="Price"       value={data.source_status?.price ?? 'ok'} />
                  <Status label="Source"      value={data.source_status?.price_source ?? 'market'} />
                  <Status label="Social"      value={data.source_status?.social === 'no_social_posts' ? '0 posts' : (data.source_status?.social ?? 'pending')} />
                  <Status label="News Markers" value={String(data.news_events?.length ?? 0)} />
                  <Status label="Predictions" value={String(data.prediction_events?.length ?? 0)} />
                  <Status label="Bars"        value={String(data.candles?.length ?? 0)} />
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 px-1">Live chart via TradingView · social &amp; prediction overlays require a data fetch</div>
              )}

              {data.candles?.length ? (
                <>
                  <ChartCard title={`${INT_LABELS[interval] ?? interval} Price + Bollinger Bands`} height={300}>
                    <CandlestickChart
                      candles={data.candles as any}
                      bollinger={data.bollinger as any}
                      predicted={data.predicted as any}
                      newsEvents={data.news_events as any}
                      density={data.social_density as any}
                      sentiment={data.sentiment as any}
                    />
                  </ChartCard>
                  <PredictionEvents events={data.prediction_events ?? []} />
                  <ChartCard title="RSI (14)" height={120}>
                    <RSIChart data={data.rsi ?? []} />
                  </ChartCard>
                  <ChartCard title="MACD (12,26,9)" height={120}>
                    <MACDChart data={data.macd} />
                  </ChartCard>
                </>
              ) : (
                <ChartCard title={`${activeTicker ?? ticker} — Price · RSI · MACD (via TradingView)`} height={560}>
                  <TradingViewChart
                    ticker={activeTicker ?? ticker}
                    interval={interval}
                    height={560}
                    studies={['RSI@tv-basicstudies', 'MACD@tv-basicstudies']}
                  />
                </ChartCard>
              )}
            </div>
          )}

          {(view === 'pd' || view === 'sent' || view === 'ds') && (
            <div className="bg-surface border border-border rounded-lg overflow-hidden" style={{ height: 460 }}>
              <ResearchChart
                ticker={activeTicker ?? ticker}
                mode={view}
                data={researchData}
                win={win}
              />
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20 text-neutral text-sm">
          {loading ? 'Loading chart…' : 'Enter a ticker and click Load Chart.'}
        </div>
      )}

      </>}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function eventTime(value: string | number) {
  const sec = typeof value === 'number' ? value : Math.floor(Date.parse(value) / 1000)
  if (!Number.isFinite(sec) || sec <= 0) return '--'
  return new Date(sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function PredictionEvents({ events }: { events: NonNullable<ChartData['prediction_events']> }) {
  if (!events.length) return null
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs text-neutral font-medium uppercase">Prediction Signals</span>
      </div>
      <div className="divide-y divide-border/60">
        {events.slice(-5).map((event, index) => {
          const actual  = event.label_5m?.return_pct
          const correct = event.label_5m?.direction_correct
          return (
            <div key={`${event.time}-${index}`} className="grid grid-cols-[86px_1fr_100px] gap-2 px-3 py-2 text-xs items-center">
              <span className="font-mono text-neutral">{eventTime(event.time)}</span>
              <span className="text-slate-200 truncate">{event.title || event.text || 'Prediction signal'}</span>
              <span className={correct === true ? 'text-emerald-400 font-mono text-right' : correct === false ? 'text-orange-400 font-mono text-right' : 'text-neutral font-mono text-right'}>
                {actual == null ? 'pending' : `${actual > 0 ? '+' : ''}${Number(actual).toFixed(2)}%`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 min-w-0">
      <div className="font-mono text-sm text-white truncate">{value}</div>
      <div className="text-[10px] uppercase text-neutral mt-0.5">{label}</div>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center px-4 text-center text-xs text-neutral">{message}</div>
  )
}

function ChartCard({ title, height, children }: { title: string; height: number; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs text-neutral font-medium uppercase tracking-wide">{title}</span>
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  )
}

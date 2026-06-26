'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import useSWR from 'swr'
import { readView, applyScreenerView } from '@/lib/screenerView'
import type { ScreenerRow } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const TIMEFRAMES: Array<{ key: string; label: string; range: string; interval: string }> = [
  { key: '1m',     label: '1m',     range: '1d',  interval: '1m' },
  { key: '3m',     label: '3m',     range: '1d',  interval: '3m' },
  { key: '5m',     label: '5m',     range: '1d',  interval: '5m' },
  { key: '15m',    label: '15m',    range: '5d',  interval: '15m' },
  { key: '1h',     label: '1h',     range: '1mo', interval: '1h' },
  { key: 'daily',  label: 'Daily',  range: '3mo', interval: '1d' },
  { key: 'weekly', label: 'Weekly', range: '1y',  interval: '1wk' },
]

const REFRESH_OPTS: Array<{ key: string; label: string; ms: number }> = [
  { key: 'off',  label: 'Off',   ms: 0 },
  { key: '10s',  label: '10s',   ms: 10_000 },
  { key: '1min', label: '1 min', ms: 60_000 },
]

const PAGE_SIZE = 12

function Sparkline({ ticker, range, interval }: { ticker: string; range: string; interval: string }) {
  const { data, isLoading } = useSWR(
    `/api/charts/${ticker}?range=${range}&interval=${interval}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[10px] text-slate-600 animate-pulse">Loading…</div>
      </div>
    )
  }

  const candles: Array<{ close: number }> = data?.candles ?? []
  if (candles.length < 2) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[10px] text-slate-600">No data</div>
      </div>
    )
  }

  const closes = candles.map(c => c.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range2 = max - min || 1
  const w = 200
  const h = 60
  const points = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * w
    const y = h - ((c - min) / range2) * h
    return `${x},${y}`
  }).join(' ')

  const first = closes[0]
  const last = closes[closes.length - 1]
  const up = last >= first
  const stroke = up ? '#10b981' : '#ef4444'

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function GridCell({
  row,
  range,
  interval,
}: {
  row: ScreenerRow
  range: string
  interval: string
}) {
  const changePct = row.change_pct ?? 0
  const up = changePct >= 0
  const sentiment = row.avg_sentiment ?? 0
  const sentColor = sentiment > 0.15 ? 'text-emerald-400' : sentiment < -0.15 ? 'text-red-400' : 'text-slate-500'

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col hover:border-accent/50 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/60">
        <span className="font-mono font-bold text-sm text-white">{row.ticker}</span>
        <div className="flex items-center gap-2">
          {row.price != null && (
            <span className="font-mono text-xs text-neutral">${row.price.toFixed(2)}</span>
          )}
          <span className={`font-mono text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>
            {up ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Sparkline */}
      <div className="flex-1 min-h-[64px] p-1">
        <Sparkline ticker={row.ticker} range={range} interval={interval} />
      </div>

      {/* Metrics strip */}
      <div className="flex items-center justify-between px-2 py-1 border-t border-border/60 text-[10px]">
        <span className="text-slate-500 font-mono">
          VOL <span className="text-neutral">{fmtCompact(row.volume)}</span>
        </span>
        <span className={`font-mono ${sentColor}`}>
          SENT {sentiment > 0 ? '+' : ''}{sentiment.toFixed(2)}
        </span>
        <span className="text-slate-500 font-mono">
          ART <span className="text-neutral">{row.news_article_count ?? 0}</span>
        </span>
        <span className="text-slate-500 font-mono">
          SOC <span className="text-neutral">{row.message_count ?? 0}</span>
        </span>
      </div>
    </div>
  )
}

function fmtCompact(n: number | undefined | null): string {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}

export function ChartsGridPage() {
  const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  const view = readView(sp)

  const [tf, setTf] = useState('5m')
  const [refreshKey, setRefreshKey] = useState('off')
  const [page, setPage] = useState(0)

  const { data: screenerData } = useSWR('/api/screener', fetcher, { revalidateOnFocus: false })
  const rawRows: ScreenerRow[] = screenerData?.tickers ?? []
  const filtered = applyScreenerView(rawRows, view)
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const currentTf = TIMEFRAMES.find(t => t.key === tf) ?? TIMEFRAMES[2]
  const refreshMs = REFRESH_OPTS.find(r => r.key === refreshKey)?.ms ?? 0

  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current)
    if (refreshMs > 0) {
      refreshRef.current = setInterval(() => setNonce(n => n + 1), refreshMs)
    }
    return () => { if (refreshRef.current) clearInterval(refreshRef.current) }
  }, [refreshMs])

  const handlePagePrev = useCallback(() => setPage(p => Math.max(0, p - 1)), [])
  const handlePageNext = useCallback(() => setPage(p => Math.min(pageCount - 1, p + 1)), [pageCount])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Timeframe */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500 uppercase mr-1">TF</span>
          {TIMEFRAMES.map(t => (
            <button
              key={t.key}
              onClick={() => { setTf(t.key); setNonce(n => n + 1) }}
              className={`px-2 py-1 text-[11px] rounded transition-colors ${
                tf === t.key ? 'bg-accent text-white' : 'bg-surface border border-border text-neutral hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500 uppercase mr-1">Refresh</span>
          {REFRESH_OPTS.map(r => (
            <button
              key={r.key}
              onClick={() => setRefreshKey(r.key)}
              className={`px-2 py-1 text-[11px] rounded transition-colors ${
                refreshKey === r.key ? 'bg-accent text-white' : 'bg-surface border border-border text-neutral hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="ml-auto text-[11px] text-slate-500">
          {filtered.length} tickers · page {page + 1}/{Math.max(1, pageCount)}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-neutral text-sm">
          No tickers match current screener filters
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {pageRows.map(row => (
            <GridCell
              key={`${row.ticker}-${nonce}`}
              row={row}
              range={currentTf.range}
              interval={currentTf.interval}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={handlePagePrev}
            disabled={page === 0}
            className="px-3 py-1.5 text-xs bg-surface border border-border rounded text-neutral hover:text-white disabled:opacity-40 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-neutral font-mono">{page + 1} / {pageCount}</span>
          <button
            onClick={handlePageNext}
            disabled={page >= pageCount - 1}
            className="px-3 py-1.5 text-xs bg-surface border border-border rounded text-neutral hover:text-white disabled:opacity-40 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

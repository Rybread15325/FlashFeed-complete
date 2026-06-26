import type { ScreenerRow } from '@/lib/types'

export interface ScreenerView {
  search: string
  sector: string
  signal: string
  sortKey: string
  sortDir: 'asc' | 'desc'
  minSentiment: number | null
  maxSentiment: number | null
}

export function readView(sp: URLSearchParams): ScreenerView {
  return {
    search:       sp.get('search') ?? '',
    sector:       sp.get('sector') ?? '',
    signal:       sp.get('signal') ?? '',
    sortKey:      sp.get('sortKey') ?? 'avg_sentiment',
    sortDir:      (sp.get('sortDir') ?? 'desc') as 'asc' | 'desc',
    minSentiment: sp.has('minSent') ? Number(sp.get('minSent')) : null,
    maxSentiment: sp.has('maxSent') ? Number(sp.get('maxSent')) : null,
  }
}

export function applyScreenerView(tickers: ScreenerRow[], view: ScreenerView): ScreenerRow[] {
  let result = [...tickers]

  if (view.search) {
    const q = view.search.toLowerCase()
    result = result.filter(r =>
      r.ticker.toLowerCase().includes(q) ||
      (r.company ?? '').toLowerCase().includes(q)
    )
  }

  if (view.sector) {
    result = result.filter(r => (r.sector ?? '') === view.sector)
  }

  if (view.signal === 'bullish') {
    result = result.filter(r => (r.avg_sentiment ?? 0) > 0.2)
  } else if (view.signal === 'bearish') {
    result = result.filter(r => (r.avg_sentiment ?? 0) < -0.2)
  }

  if (view.minSentiment !== null) {
    result = result.filter(r => (r.avg_sentiment ?? 0) >= view.minSentiment!)
  }
  if (view.maxSentiment !== null) {
    result = result.filter(r => (r.avg_sentiment ?? 0) <= view.maxSentiment!)
  }

  const key = view.sortKey as keyof ScreenerRow
  const dir = view.sortDir === 'asc' ? 1 : -1
  result.sort((a, b) => {
    const av = (a[key] as number | string | undefined) ?? 0
    const bv = (b[key] as number | string | undefined) ?? 0
    if (av < bv) return -dir
    if (av > bv) return dir
    return 0
  })

  return result
}

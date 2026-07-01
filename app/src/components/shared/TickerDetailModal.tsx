import { clsx } from 'clsx'
import type { ScreenerRow } from '@/lib/types'
import { TickerEnrichPanels } from '@/pages/TickerEnrichPanels'

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(decimals)
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}

function pctColor(n: number | null | undefined) {
  if (n == null) return 'text-neutral'
  return n >= 0 ? 'text-emerald-400' : 'text-red-400'
}

function StatCell({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-bg/50 border border-border/60 rounded p-2 min-w-0">
      <div className="text-[10px] text-neutral uppercase tracking-wide truncate">{label}</div>
      <div className={clsx('font-mono text-sm font-medium mt-0.5 truncate', valueClass ?? 'text-white')}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">{title}</div>
      {children}
    </div>
  )
}

export function TickerDetailModal({
  ticker,
  row,
  onClose,
}: {
  ticker: string
  row?: ScreenerRow
  onClose: () => void
}) {
  const changePct = row?.change_pct ?? null
  const price = row?.price ?? null

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 overflow-y-auto py-8 px-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1b2e] border border-border rounded-xl w-full max-w-4xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono font-bold text-2xl text-accent">{ticker}</span>
            {row?.company && (
              <span className="text-neutral text-sm truncate hidden sm:block">{row.company}</span>
            )}
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            {price != null && (
              <span className="font-mono text-xl font-semibold text-white">${fmt(price)}</span>
            )}
            {changePct != null && (
              <span className={clsx('font-mono text-sm font-medium', pctColor(changePct))}>
                {fmtPct(changePct)}
              </span>
            )}
            <button
              onClick={onClose}
              className="text-neutral hover:text-white transition-colors text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Key Stats */}
          <Section title="Key Stats">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              <StatCell label="Market Cap" value={fmtCompact(row?.market_cap)} />
              <StatCell label="Volume" value={fmtCompact(row?.volume)} />
              <StatCell label="Avg Volume" value={fmtCompact(row?.avg_volume)} />
              <StatCell label="52w High" value={row?.high_52w != null ? `$${fmt(row.high_52w)}` : '—'} />
              <StatCell label="52w Low" value={row?.low_52w != null ? `$${fmt(row.low_52w)}` : '—'} />
              <StatCell label="Beta" value={fmt(row?.beta)} />
              <StatCell label="RSI (14)" value={fmt(row?.rsi)} valueClass={
                row?.rsi != null
                  ? row.rsi > 70 ? 'text-red-400 font-mono text-sm font-medium'
                  : row.rsi < 30 ? 'text-emerald-400 font-mono text-sm font-medium'
                  : 'text-white font-mono text-sm font-medium'
                  : undefined
              } />
              <StatCell label="ATR" value={fmt(row?.atr)} />
              <StatCell label="Gap" value={row?.gap != null ? fmtPct(row.gap) : '—'} valueClass={pctColor(row?.gap) + ' font-mono text-sm font-medium'} />
            </div>
          </Section>

          {/* Valuation */}
          <Section title="Valuation">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              <StatCell label="P/E" value={fmt(row?.pe_ratio)} />
              <StatCell label="Fwd P/E" value={fmt(row?.forward_pe)} />
              <StatCell label="PEG" value={fmt(row?.peg)} />
              <StatCell label="P/S" value={fmt(row?.ps_ratio)} />
              <StatCell label="P/B" value={fmt(row?.pb_ratio)} />
              <StatCell label="Div Yield" value={row?.dividend_yield != null ? `${fmt(row.dividend_yield)}%` : '—'} />
              <StatCell label="EPS Gw This Y" value={row?.eps_growth_this_y != null ? fmtPct(row.eps_growth_this_y) : '—'} valueClass={pctColor(row?.eps_growth_this_y) + ' font-mono text-sm font-medium'} />
              <StatCell label="EPS Gw Next Y" value={row?.eps_growth_next_y != null ? fmtPct(row.eps_growth_next_y) : '—'} valueClass={pctColor(row?.eps_growth_next_y) + ' font-mono text-sm font-medium'} />
            </div>
          </Section>

          {/* Fundamentals */}
          <Section title="Fundamentals">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              <StatCell label="Sales Growth" value={row?.sales_growth != null ? fmtPct(row.sales_growth) : '—'} valueClass={pctColor(row?.sales_growth) + ' font-mono text-sm font-medium'} />
              <StatCell label="Gross Margin" value={row?.gross_margin != null ? `${fmt(row.gross_margin)}%` : '—'} />
              <StatCell label="Oper Margin" value={row?.operating_margin != null ? `${fmt(row.operating_margin)}%` : '—'} />
              <StatCell label="ROE" value={row?.roe != null ? `${fmt(row.roe)}%` : '—'} />
              <StatCell label="Debt/Equity" value={fmt(row?.debt_equity)} />
              <StatCell label="Inst Own" value={row?.inst_own != null ? `${fmt(row.inst_own)}%` : '—'} />
              <StatCell label="Insider Own" value={row?.insider_own != null ? `${fmt(row.insider_own)}%` : '—'} />
              <StatCell label="Short Float" value={row?.float_short != null ? `${fmt(row.float_short)}%` : '—'} />
            </div>
          </Section>

          {/* Technical / SMA */}
          <Section title="Technical">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              <StatCell label="SMA 20" value={row?.sma20 != null ? `$${fmt(row.sma20)}` : '—'} />
              <StatCell label="SMA 50" value={row?.sma50 != null ? `$${fmt(row.sma50)}` : '—'} />
              <StatCell label="SMA 200" value={row?.sma200 != null ? `$${fmt(row.sma200)}` : '—'} />
              <StatCell label="Analyst" value={row?.analyst ?? '—'} />
              <StatCell label="Target Price" value={row?.target_price != null ? `$${fmt(row.target_price)}` : '—'} />
              <StatCell label="Earnings Date" value={row?.earnings_date ?? '—'} />
            </div>
          </Section>

          {/* Performance */}
          <Section title="Performance">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <StatCell label="Week" value={fmtPct(row?.perf_week)} valueClass={pctColor(row?.perf_week) + ' font-mono text-sm font-medium'} />
              <StatCell label="Month" value={fmtPct(row?.perf_month)} valueClass={pctColor(row?.perf_month) + ' font-mono text-sm font-medium'} />
              <StatCell label="Quarter" value={fmtPct(row?.perf_quarter)} valueClass={pctColor(row?.perf_quarter) + ' font-mono text-sm font-medium'} />
              <StatCell label="Half Year" value={fmtPct(row?.perf_half)} valueClass={pctColor(row?.perf_half) + ' font-mono text-sm font-medium'} />
              <StatCell label="Year" value={fmtPct(row?.perf_year)} valueClass={pctColor(row?.perf_year) + ' font-mono text-sm font-medium'} />
              <StatCell label="YTD" value={fmtPct(row?.perf_ytd)} valueClass={pctColor(row?.perf_ytd) + ' font-mono text-sm font-medium'} />
            </div>
          </Section>

          {/* Company info */}
          {(row?.sector || row?.industry || row?.exchange || row?.country) && (
            <Section title="Company">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {row?.sector && <StatCell label="Sector" value={row.sector} />}
                {row?.industry && <StatCell label="Industry" value={row.industry} />}
                {row?.exchange && <StatCell label="Exchange" value={row.exchange} />}
                {row?.country && <StatCell label="Country" value={row.country} />}
              </div>
            </Section>
          )}

          {/* News + Social enrichment */}
          <Section title="News & Social">
            <TickerEnrichPanels ticker={ticker} />
          </Section>
        </div>
      </div>
    </div>
  )
}

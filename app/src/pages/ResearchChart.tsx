'use client'
// Research views rendered as pie/doughnut charts — the time-series bar charts
// collapsed into a single block when social data was sparse, so each mode now
// summarizes the same /api/charts data as a distribution instead.
import { useEffect, useRef } from 'react'
import Chart from 'chart.js/auto'

export type ResearchMode = 'pd' | 'sent' | 'ds'

export interface FlashFeedChartData {
  candles:        Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>
  social_density?: Array<{ time: number; value: number; scaled?: number; count?: number; session?: string }>
  sentiment?:      Array<{ time: number; value: number }>
}

// Backend encodes ET wall-clock time as if it were UTC, so read hours as UTC.
function etHour(sec: number): number {
  const d = new Date(sec * 1000)
  return d.getUTCHours() + d.getUTCMinutes() / 60
}

function toLabel(sec: number): string {
  const d = new Date(sec * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

type WinKey = 'full' | '2h' | '1h'

function windowFilter<T extends { time: number }>(items: T[], win: WinKey): T[] {
  if (win === 'full' || items.length === 0) return items
  const last = items[items.length - 1].time
  const cutoff = last - (win === '2h' ? 2 : 1) * 3600
  return items.filter(i => i.time >= cutoff)
}

// Message volume for a density point — prefer explicit count, else the rate value
function msgVolume(d: { value: number; count?: number }): number {
  return d.count != null && Number.isFinite(d.count) ? Number(d.count) : Math.max(0, Number(d.value) || 0)
}

const SESSIONS: Array<{ label: string; from: number; to: number; color: string }> = [
  { label: 'Pre-market (04:00–09:30)',  from: 4,    to: 9.5,  color: '#818cf8' },
  { label: 'Morning (09:30–12:00)',     from: 9.5,  to: 12,   color: '#38bdf8' },
  { label: 'Afternoon (12:00–16:00)',   from: 12,   to: 16,   color: '#fbbf24' },
  { label: 'After-hours (16:00–20:00)', from: 16,   to: 24,   color: '#a78bfa' },
]

const SENT_BUCKETS = [
  { label: 'Bullish', color: '#10b981', test: (v: number) => v > 0.05 },
  { label: 'Neutral', color: '#475569', test: (v: number) => v >= -0.05 && v <= 0.05 },
  { label: 'Bearish', color: '#ef4444', test: (v: number) => v < -0.05 },
]

// Doughnut center text plugin
const centerTextPlugin = {
  id: 'centerText',
  afterDraw(chart: any, _a: any, opts: any) {
    if (!opts?.lines?.length) return
    const { ctx, chartArea } = chart
    if (!chartArea) return
    const cx = (chartArea.left + chartArea.right) / 2
    const cy = (chartArea.top + chartArea.bottom) / 2
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    opts.lines.forEach((line: { text: string; size: number; color: string }, i: number) => {
      ctx.font = `${i === 0 ? 'bold ' : ''}${line.size}px monospace`
      ctx.fillStyle = line.color
      ctx.fillText(line.text, cx, cy + (i - (opts.lines.length - 1) / 2) * 16)
    })
    ctx.restore()
  },
}

function buildConfig(mode: ResearchMode, raw: FlashFeedChartData, win: WinKey): any {
  const candles    = windowFilter(raw.candles ?? [], win)
  const densityPts = windowFilter(raw.social_density ?? [], win)
  const sentPts    = windowFilter(raw.sentiment ?? [], win)

  Chart.defaults.color = '#94a3b8'
  const baseOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    devicePixelRatio: (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 2,
    layout: { padding: 8 },
  }
  const legend = {
    position: 'right' as const,
    labels: { font: { size: 11 }, boxWidth: 14, boxHeight: 14, padding: 10, color: '#cbd5e1' },
  }
  const tooltip = {
    callbacks: {
      label(ctx: any) {
        const total = ctx.dataset.data.reduce((s: number, v: number) => s + (v || 0), 0)
        const v = ctx.parsed
        const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0'
        return ` ${ctx.label}: ${Math.round(v)} (${pct}%)`
      },
    },
  }

  // ── Price + Density: message volume by market session ────────────────────────
  if (mode === 'pd') {
    const totals = SESSIONS.map(s =>
      densityPts.reduce((sum, d) => {
        const h = etHour(d.time)
        return h >= s.from && h < s.to ? sum + msgVolume(d) : sum
      }, 0)
    )
    const totalMsgs = totals.reduce((a, b) => a + b, 0)
    const first = candles[0]?.close, last = candles[candles.length - 1]?.close
    const chg = first != null && last != null && first !== 0 ? ((last - first) / first) * 100 : null
    return {
      type: 'doughnut',
      data: {
        labels: SESSIONS.map(s => s.label),
        datasets: [{
          data: totals,
          backgroundColor: SESSIONS.map(s => s.color),
          borderColor: '#0b1220',
          borderWidth: 2,
        }],
      },
      plugins: [centerTextPlugin],
      options: {
        ...baseOpts,
        cutout: '58%',
        plugins: {
          legend,
          tooltip,
          centerText: {
            lines: [
              { text: `${Math.round(totalMsgs)}`, size: 20, color: '#ffffff' },
              { text: 'messages', size: 10, color: '#64748b' },
              ...(chg != null ? [{ text: `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% px`, size: 11, color: chg >= 0 ? '#10b981' : '#ef4444' }] : []),
            ],
          },
        },
      },
    }
  }

  // ── Sentiment Score: bullish / neutral / bearish share ───────────────────────
  if (mode === 'sent') {
    const counts = SENT_BUCKETS.map(b => sentPts.filter(p => b.test(Number(p.value))).length)
    const total = counts.reduce((a, b) => a + b, 0)
    const avg = total > 0 ? sentPts.reduce((s, p) => s + Number(p.value), 0) / sentPts.length : 0
    return {
      type: 'doughnut',
      data: {
        labels: SENT_BUCKETS.map(b => b.label),
        datasets: [{
          data: counts,
          backgroundColor: SENT_BUCKETS.map(b => b.color),
          borderColor: '#0b1220',
          borderWidth: 2,
        }],
      },
      plugins: [centerTextPlugin],
      options: {
        ...baseOpts,
        cutout: '58%',
        plugins: {
          legend,
          tooltip,
          centerText: {
            lines: [
              { text: `${avg >= 0 ? '+' : ''}${avg.toFixed(2)}`, size: 20, color: avg > 0.05 ? '#10b981' : avg < -0.05 ? '#ef4444' : '#94a3b8' },
              { text: 'avg score', size: 10, color: '#64748b' },
            ],
          },
        },
      },
    }
  }

  // ── Density vs Sentiment: message volume split by sentiment direction ────────
  const sentByLabel = new Map(sentPts.map(s => [toLabel(s.time), Number(s.value)]))
  const volumes = [0, 0, 0] // bullish, neutral, bearish
  for (const d of densityPts) {
    const v = sentByLabel.get(toLabel(d.time))
    const vol = msgVolume(d)
    if (v == null || (v >= -0.05 && v <= 0.05)) volumes[1] += vol
    else if (v > 0.05) volumes[0] += vol
    else volumes[2] += vol
  }
  const totalVol = volumes.reduce((a, b) => a + b, 0)
  return {
    type: 'doughnut',
    data: {
      labels: ['Bullish-window volume', 'Neutral-window volume', 'Bearish-window volume'],
      datasets: [{
        data: volumes,
        backgroundColor: ['#10b981', '#475569', '#ef4444'],
        borderColor: '#0b1220',
        borderWidth: 2,
      }],
    },
    plugins: [centerTextPlugin],
    options: {
      ...baseOpts,
      cutout: '58%',
      plugins: {
        legend,
        tooltip,
        centerText: {
          lines: [
            { text: `${Math.round(totalVol)}`, size: 20, color: '#ffffff' },
            { text: 'messages', size: 10, color: '#64748b' },
          ],
        },
      },
    },
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

const TITLES: Record<ResearchMode, string> = {
  pd:   'Message Volume by Session',
  sent: 'Sentiment Share (−1 Bearish → +1 Bullish)',
  ds:   'Message Volume by Sentiment',
}

interface Props {
  ticker: string
  mode:   ResearchMode
  data:   FlashFeedChartData | null
  win?:   WinKey
}

export function ResearchChart({ ticker, mode, data, win = 'full' }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const chartRef   = useRef<Chart | null>(null)

  const destroyChart = () => {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
  }

  useEffect(() => {
    if (!data || !canvasRef.current) { destroyChart(); return }
    const hasDensity = (data.social_density?.length ?? 0) > 0
    const hasSent    = (data.sentiment?.length ?? 0) > 0
    if ((mode === 'pd' || mode === 'ds') && !hasDensity) return
    if (mode === 'sent' && !hasSent) return

    const timer = window.setTimeout(() => {
      if (!canvasRef.current) return
      destroyChart()
      chartRef.current = new Chart(canvasRef.current, buildConfig(mode, data, win))
    }, 40)
    return () => { window.clearTimeout(timer); destroyChart() }
  }, [data, mode, win])

  useEffect(() => destroyChart, [])

  const noData = !data
  const noDensity = !data?.social_density?.length
  const noSent    = !data?.sentiment?.length

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs text-neutral font-medium uppercase tracking-wide">
          {ticker} — {TITLES[mode]}
        </span>
        {noData && <span className="text-[11px] text-neutral animate-pulse">Loading…</span>}
        {!noData && (mode === 'pd' || mode === 'ds') && noDensity && (
          <span className="text-[11px] text-amber-400">No social density data for this range/interval</span>
        )}
        {!noData && mode === 'sent' && noSent && (
          <span className="text-[11px] text-amber-400">No sentiment data for this range/interval</span>
        )}
      </div>

      <div className="flex-1 min-h-0 p-2" style={{ position: 'relative' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

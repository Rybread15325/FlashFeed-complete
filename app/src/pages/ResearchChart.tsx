'use client'
// Exact Chart.js research charts from Sentiment Scout — adapted to consume
// FlashFeed's existing /api/charts endpoint (which already returns social_density
// and sentiment arrays) instead of the separate /api/sentchart/* endpoints.
import { useEffect, useRef, useState } from 'react'
import Chart from 'chart.js/auto'
import { smoothSame } from '@/lib/chartAgg'

export type ResearchMode = 'pd' | 'sent' | 'ds'

export interface FlashFeedChartData {
  candles:        Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>
  social_density?: Array<{ time: number; value: number; scaled?: number; count?: number; session?: string }>
  sentiment?:      Array<{ time: number; value: number }>
}

// Convert unix seconds to "HH:MM" label — the backend encodes ET time as if
// it were UTC, so reading it as UTC gives the correct ET wall-clock string.
function toLabel(sec: number): string {
  const d = new Date(sec * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

// ── Chart.js plugins (identical to Sentiment Scout originals) ─────────────────

// Red dashed at market open (09:30), purple dashed at market close (16:00)
const marketLinesPlugin = {
  id: 'marketLines',
  afterDatasetsDraw(chart: any) {
    const { ctx, chartArea, scales: { x } } = chart
    if (!chartArea) return
    const labels: string[] = chart.data.labels || []
    ;[['09:30', 'rgba(239,68,68,.75)'], ['16:00', 'rgba(139,92,246,.85)']].forEach(([t, col]) => {
      let i = labels.indexOf(t)
      if (i < 0) i = labels.findIndex(l => l >= t)
      if (i < 0 || labels[0] > t) return
      const px = x.getPixelForValue(i)
      ctx.save()
      ctx.strokeStyle = col; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.moveTo(px, chartArea.top); ctx.lineTo(px, chartArea.bottom); ctx.stroke()
      ctx.restore()
    })
  },
}

// Zero-line for sentiment axes (axhline(0) equivalent)
const zeroLinePlugin = {
  id: 'zeroLine',
  afterDatasetsDraw(chart: any, _a: any, opts: any) {
    if (!opts?.scale) return
    const sc = chart.scales[opts.scale], area = chart.chartArea
    if (!sc || !area) return
    const y = sc.getPixelForValue(0)
    if (y < area.top || y > area.bottom) return
    const ctx = chart.ctx
    ctx.save()
    ctx.strokeStyle = 'rgba(200,200,200,.45)'; ctx.lineWidth = .8
    ctx.beginPath(); ctx.moveTo(area.left, y); ctx.lineTo(area.right, y); ctx.stroke()
    ctx.restore()
  },
}

// High/low price markers on the price series
const hiLoPlugin = {
  id: 'hiLo',
  afterDatasetsDraw(chart: any, _a: any, opts: any) {
    if (!opts?.enabled) return
    const data: (number | null)[] = chart.data.datasets[0].data
    const labels: string[] = chart.data.labels
    let hi = -1, lo = -1
    data.forEach((v, i) => {
      if (v == null) return
      if (hi < 0 || v > (data[hi] as number)) hi = i
      if (lo < 0 || v < (data[lo] as number)) lo = i
    })
    if (hi < 0) return
    const meta = chart.getDatasetMeta(0), ctx = chart.ctx
    const draw = (i: number, col: string, txt: string, dy: number) => {
      const el = meta.data[i]; if (!el) return
      ctx.save()
      ctx.fillStyle = col
      ctx.beginPath(); ctx.arc(el.x, el.y, 4, 0, Math.PI * 2); ctx.fill()
      ctx.font = '9px monospace'; ctx.textAlign = 'left'
      const tx = Math.min(el.x + 8, chart.chartArea.right - 90)
      ctx.fillText(txt, tx, el.y + dy)
      ctx.fillText(labels[i], tx, el.y + dy + 10)
      ctx.restore()
    }
    draw(hi, '#2ea043', `High: $${(data[hi] as number).toFixed(2)}`, -14)
    draw(lo, '#e5534b', `Low: $${(data[lo] as number).toFixed(2)}`, 16)
  },
}

// ── Data helpers ──────────────────────────────────────────────────────────────

type WinKey = 'full' | '2h' | '1h'

function windowFilter<T extends { time: number }>(items: T[], win: WinKey): T[] {
  if (win === 'full' || items.length === 0) return items
  const last = items[items.length - 1].time
  const cutoff = last - (win === '2h' ? 2 : 1) * 3600
  return items.filter(i => i.time >= cutoff)
}

// Build Chart.js config from FlashFeed data (same chart appearance as Sentiment Scout)
function buildConfig(mode: ResearchMode, raw: FlashFeedChartData, win: WinKey, windowMin: number): any {
  const candles  = windowFilter(raw.candles ?? [], win)
  const densityPts = windowFilter(raw.social_density ?? [], win)
  const sentPts  = windowFilter(raw.sentiment ?? [], win)

  const priceByLabel = new Map(candles.map(c => [toLabel(c.time), c.close]))
  const densByLabel  = new Map(densityPts.map(d => [toLabel(d.time), d.value]))
  const sentByLabel  = new Map(sentPts.map(s => [toLabel(s.time), s.value]))

  const allLabels = [...new Set([
    ...candles.map(c => toLabel(c.time)),
    ...densityPts.map(d => toLabel(d.time)),
    ...sentPts.map(s => toLabel(s.time)),
  ])].sort()

  Chart.defaults.color = '#4e5567'
  const baseOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    devicePixelRatio: (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 2,
    interaction: { mode: 'index' as const, intersect: false },
  }

  // ── Price + Density ──────────────────────────────────────────────────────────
  if (mode === 'pd') {
    const labels = allLabels.filter(l => priceByLabel.has(l) || densByLabel.has(l))
    const prices  = labels.map(l => priceByLabel.get(l) ?? null)
    const densArr = densityPts.map(d => d.value)
    const densSm  = smoothSame(densArr, windowMin)
    const densByLabelSm = new Map(densityPts.map((d, i) => [toLabel(d.time), densSm[i]]))
    const dens    = labels.map(l => densByLabel.get(l) ?? null)
    const densSl  = labels.map(l => densByLabelSm.get(l) ?? null)
    const pVals   = prices.filter((v): v is number => v != null)
    const pMin = pVals.length ? Math.min(...pVals) : 0
    const pMax = pVals.length ? Math.max(...pVals) : 1
    const maxDen  = Math.max(...densArr, 1)

    return {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Close price',            data: prices, yAxisID: 'y1', spanGaps: true,
          borderColor: '#2196F3', borderWidth: 1.4, tension: .1, pointRadius: 0,
          fill: { target: { value: pMin } }, backgroundColor: 'rgba(33,150,243,.08)' },
        { label: 'Messages/min', type: 'bar', data: dens, yAxisID: 'y2',
          backgroundColor: 'rgba(144,202,249,.5)', borderWidth: 0, barPercentage: 0.5, categoryPercentage: 0.8 },
        { label: `${windowMin}-min avg density`, data: densSl, yAxisID: 'y2', spanGaps: true,
          borderColor: '#FF9800', borderWidth: 2, tension: .1, pointRadius: 0 },
      ] },
      plugins: [marketLinesPlugin, hiLoPlugin],
      options: { ...baseOpts,
        plugins: {
          legend: { display: true, labels: { font: { size: 9 }, boxWidth: 12 } },
          hiLo: { enabled: true },
        },
        scales: {
          x:  { grid: { color: '#1e2330' }, ticks: { font: { size: 8 }, maxTicksLimit: 16 } },
          y1: { position: 'left',  min: pMin * 0.97, max: pMax * 1.08,
                grid: { color: '#1e2330' }, ticks: { font: { size: 8 }, color: '#2196F3' },
                title: { display: true, text: 'Close Price ($)', color: '#2196F3', font: { size: 10 } } },
          y2: { position: 'right', beginAtZero: true, max: maxDen * 2.5,
                grid: { display: false }, ticks: { font: { size: 8 }, color: '#FF9800' },
                title: { display: true, text: 'Messages per minute', color: '#FF9800', font: { size: 10 } } },
        },
      },
    }
  }

  // ── Sentiment Score ──────────────────────────────────────────────────────────
  if (mode === 'sent') {
    const labels  = allLabels.filter(l => sentByLabel.has(l))
    const raw     = labels.map(l => sentByLabel.get(l) ?? null)
    const rawVals = raw.filter((v): v is number => v != null)
    const smAll   = smoothSame(rawVals, 15)
    let si = 0
    const smooth  = raw.map(v => (v != null ? smAll[si++] ?? null : null))

    return {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Raw score', data: raw, yAxisID: 'ys', spanGaps: true,
          borderColor: 'rgba(160,160,160,.4)', borderWidth: .6, tension: 0, pointRadius: 0,
          fill: { target: 'origin', above: 'rgba(76,175,80,.2)', below: 'rgba(244,67,54,.2)' } },
        { label: '15-min smoothed score', data: smooth, yAxisID: 'ys', spanGaps: true,
          borderColor: '#4CAF50', borderWidth: 2, tension: .1, pointRadius: 0 },
      ] },
      plugins: [marketLinesPlugin, zeroLinePlugin],
      options: { ...baseOpts,
        plugins: {
          legend: { display: true, labels: { font: { size: 9 }, boxWidth: 12 } },
          zeroLine: { scale: 'ys' },
        },
        scales: {
          x:  { grid: { color: '#1e2330' }, ticks: { font: { size: 8 }, maxTicksLimit: 16 } },
          ys: { position: 'left', min: -1.1, max: 1.1,
                grid: { color: '#1e2330' }, ticks: { font: { size: 8 } },
                title: { display: true, text: 'Sentiment Score  (−1 = Bearish | +1 = Bullish)', font: { size: 10 } } },
        },
      },
    }
  }

  // ── Density vs Sentiment ─────────────────────────────────────────────────────
  const labels  = allLabels.filter(l => densByLabel.has(l) || sentByLabel.has(l))
  const densArr = densityPts.map(d => d.value)
  const densSm  = smoothSame(densArr, 15)
  const densByLabelSm = new Map(densityPts.map((d, i) => [toLabel(d.time), densSm[i]]))
  const dens    = labels.map(l => densByLabel.get(l) ?? null)
  const densSlm = labels.map(l => densByLabelSm.get(l) ?? null)
  const sentR   = labels.map(l => sentByLabel.get(l) ?? null)
  const sentVals = sentR.filter((v): v is number => v != null)
  const sentSmAll = smoothSame(sentVals, 15)
  let si = 0
  const sentSm  = sentR.map(v => (v != null ? sentSmAll[si++] ?? null : null))
  const maxDen  = Math.max(...densArr, 1)

  return {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Messages/window', type: 'bar', data: dens, yAxisID: 'y1',
        backgroundColor: 'rgba(33,150,243,.3)', borderWidth: 0, barPercentage: 0.5, categoryPercentage: 0.8 },
      { label: '15-min avg density', data: densSlm, yAxisID: 'y1', spanGaps: true,
        borderColor: '#2196F3', borderWidth: 1.8, tension: .1, pointRadius: 0 },
      { label: 'Sentiment score (smoothed)', data: sentSm, yAxisID: 'ys', spanGaps: true,
        borderColor: '#FF5722', borderWidth: 2, tension: .1, pointRadius: 0,
        fill: { target: 'origin', above: 'rgba(76,175,80,.12)', below: 'rgba(244,67,54,.12)' } },
    ] },
    plugins: [marketLinesPlugin, zeroLinePlugin],
    options: { ...baseOpts,
      plugins: {
        legend: { display: true, labels: { font: { size: 9 }, boxWidth: 12 } },
        zeroLine: { scale: 'ys' },
      },
      scales: {
        x:  { grid: { color: '#1e2330' }, ticks: { font: { size: 8 }, maxTicksLimit: 16 } },
        y1: { position: 'left',  beginAtZero: true, max: maxDen * 2.2,
              grid: { color: '#1e2330' }, ticks: { font: { size: 8 }, color: '#2196F3' },
              title: { display: true, text: 'Messages per 5-min window', color: '#2196F3', font: { size: 10 } } },
        ys: { position: 'right', min: -1.5, max: 1.5,
              grid: { display: false }, ticks: { font: { size: 8 }, color: '#FF5722' },
              title: { display: true, text: 'Sentiment Score  (−1 to +1)', color: '#FF5722', font: { size: 10 } } },
      },
    },
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

const TITLES: Record<ResearchMode, string> = {
  pd:   'Close Price vs Message Density',
  sent: 'Sentiment Score — Smoothed (−1 Bearish → +1 Bullish)',
  ds:   'Message Density vs Sentiment Score',
}

const WIN_MIN = 1, WIN_MAX = 60, WIN_DEFAULT = 15

interface Props {
  ticker: string
  mode:   ResearchMode
  data:   FlashFeedChartData | null
  win?:   WinKey
}

export function ResearchChart({ ticker, mode, data, win = 'full' }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const chartRef   = useRef<Chart | null>(null)
  const [windowMin, setWindowMin] = useState(WIN_DEFAULT)

  const destroyChart = () => {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
  }

  // Rebuild chart when data, mode, window, or rolling-window slider changes
  useEffect(() => {
    if (!data || !canvasRef.current) { destroyChart(); return }
    const hasDensity = (data.social_density?.length ?? 0) > 0
    const hasSent    = (data.sentiment?.length ?? 0) > 0
    if ((mode === 'pd' || mode === 'ds') && !hasDensity) return
    if ((mode === 'sent' || mode === 'ds') && !hasSent)  return

    const timer = window.setTimeout(() => {
      if (!canvasRef.current) return
      destroyChart()
      chartRef.current = new Chart(canvasRef.current, buildConfig(mode, data, win, windowMin))
    }, 40)
    return () => { window.clearTimeout(timer); destroyChart() }
  }, [data, mode, win, windowMin])

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
        {!noData && (mode === 'sent' || mode === 'ds') && noSent && (
          <span className="text-[11px] text-amber-400">No sentiment data for this range/interval</span>
        )}
      </div>

      {mode === 'pd' && (
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-3">
          <label className="text-[11px] text-neutral whitespace-nowrap">
            Rolling window: <span className="text-white font-medium tabular-nums">{windowMin} min</span>
          </label>
          <input
            type="range" min={WIN_MIN} max={WIN_MAX} step={1} value={windowMin}
            onChange={e => setWindowMin(Number(e.target.value))}
            className="flex-1 accent-orange-500 cursor-pointer"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 p-2" style={{ position: 'relative' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

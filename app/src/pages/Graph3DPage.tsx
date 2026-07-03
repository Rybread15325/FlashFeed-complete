'use client'
// 3D bar graph of the screener universe — canvas + manual perspective
// projection (no three.js; keeps the bundle small). Drag to rotate,
// scroll to zoom, hover a bar for details.
import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import type { ScreenerRow } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type Metric = 'change' | 'volume' | 'social' | 'cap'

const METRICS: Array<{ key: Metric; label: string; axis: string }> = [
  { key: 'change', label: 'Change %',    axis: 'bar height = |daily change|' },
  { key: 'volume', label: 'Volume',      axis: 'bar height = share volume' },
  { key: 'social', label: 'Social Buzz', axis: 'bar height = social posts' },
  { key: 'cap',    label: 'Market Cap',  axis: 'bar height = market cap' },
]

interface Bar {
  ticker: string
  gx: number      // grid x
  gz: number      // grid z
  h: number       // normalized height 0..1
  up: boolean     // gainer?
  value: string   // formatted metric value
  change: number
}

function metricValue(r: ScreenerRow, m: Metric): number {
  if (m === 'change') return Math.abs(Number(r.change_pct ?? 0))
  if (m === 'volume') return Number((r as any).volume ?? 0)
  if (m === 'social') return Number((r as any).message_count ?? (r as any).stocktwits_message_count ?? 0)
  return Number((r as any).market_cap ?? 0)
}

function fmtVal(v: number, m: Metric, change: number): string {
  if (m === 'change') return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6)  return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3)  return `${(v / 1e3).toFixed(0)}K`
  return String(Math.round(v))
}

export function Graph3DPage() {
  const { data } = useSWR('/api/screener?limit=200', fetcher, { refreshInterval: 60_000 })
  const [metric, setMetric] = useState<Metric>('change')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const stateRef  = useRef({
    yaw: 0.7, pitch: 0.42, zoom: 1,
    dragging: false, lastX: 0, lastY: 0,
    idleSince: Date.now(),
    mouseX: -1, mouseY: -1,
    bars: [] as Bar[],
    hover: null as Bar | null,
  })

  const rows: ScreenerRow[] = Array.isArray(data) ? data : data?.tickers ?? data?.rows ?? []

  // Build the bar grid whenever data or metric changes
  useEffect(() => {
    const st = stateRef.current
    const ranked = [...rows]
      .filter(r => r.ticker)
      .sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
      .slice(0, 36)
    const side = Math.max(1, Math.ceil(Math.sqrt(ranked.length)))
    const maxV = Math.max(...ranked.map(r => metricValue(r, metric)), 1e-9)
    st.bars = ranked.map((r, i) => {
      const change = Number(r.change_pct ?? 0)
      const v = metricValue(r, metric)
      return {
        ticker: r.ticker,
        gx: (i % side) - (side - 1) / 2,
        gz: Math.floor(i / side) - (side - 1) / 2,
        h: Math.max(0.03, Math.pow(v / maxV, metric === 'cap' || metric === 'volume' ? 0.5 : 0.75)),
        up: change >= 0,
        value: fmtVal(v, metric, change),
        change,
      }
    })
  }, [rows, metric])

  // Render loop + interaction
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const st = stateRef.current
    let raf = 0

    const onDown = (e: MouseEvent) => { st.dragging = true; st.lastX = e.clientX; st.lastY = e.clientY }
    const onUp = () => { st.dragging = false; st.idleSince = Date.now() }
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      st.mouseX = e.clientX - rect.left
      st.mouseY = e.clientY - rect.top
      if (!st.dragging) return
      st.yaw   += (e.clientX - st.lastX) * 0.008
      st.pitch  = Math.min(1.35, Math.max(0.08, st.pitch + (e.clientY - st.lastY) * 0.006))
      st.lastX = e.clientX; st.lastY = e.clientY
      st.idleSince = Date.now()
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      st.zoom = Math.min(2.2, Math.max(0.5, st.zoom * (e.deltaY > 0 ? 0.92 : 1.08)))
      st.idleSince = Date.now()
    }
    const onLeave = () => { st.mouseX = -1; st.mouseY = -1; st.dragging = false }

    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mouseleave', onLeave)

    const draw = () => {
      const W = wrap.clientWidth
      const H = Math.max(420, window.innerHeight - 260)
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr; canvas.height = H * dpr
        canvas.style.width = `${W}px`; canvas.style.height = `${H}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // Auto-rotate after 2.5s idle
      if (!st.dragging && Date.now() - st.idleSince > 2500) st.yaw += 0.0035

      const cy = Math.cos(st.yaw),  sy = Math.sin(st.yaw)
      const cp = Math.cos(st.pitch), sp = Math.sin(st.pitch)
      const scale = Math.min(W, H) * 0.052 * st.zoom
      const camDist = 26
      const cxs = W / 2, cys = H / 2 + H * 0.12

      const project = (x: number, y: number, z: number): [number, number, number] => {
        // yaw around Y, then pitch around X
        const x1 = x * cy - z * sy
        const z1 = x * sy + z * cy
        const y2 = y * cp - z1 * sp
        const z2 = y * sp + z1 * cp
        const persp = camDist / (camDist + z2)
        return [cxs + x1 * scale * persp * 3.2, cys - y2 * scale * persp * 3.2, z2]
      }

      const bars = st.bars
      const side = Math.max(1, Math.ceil(Math.sqrt(bars.length)))
      const ext = (side / 2 + 0.5) * 1.6

      // Floor grid
      ctx.strokeStyle = 'rgba(71,85,105,0.35)'
      ctx.lineWidth = 1
      for (let i = -side / 2 - 0.5; i <= side / 2 + 0.5; i++) {
        const g = i * 1.6
        let [ax, ay] = project(g, 0, -ext); let [bx, by] = project(g, 0, ext)
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
        ;[ax, ay] = project(-ext, 0, g); ;[bx, by] = project(ext, 0, g)
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
      }

      // Depth-sort bars (far first)
      const withDepth = bars.map(b => {
        const [, , depth] = project(b.gx * 1.6, 0, b.gz * 1.6)
        return { b, depth }
      }).sort((a, bb) => bb.depth - a.depth)

      let hover: Bar | null = null
      let hoverPx: [number, number] | null = null

      for (const { b } of withDepth) {
        const X = b.gx * 1.6, Z = b.gz * 1.6
        const hh = b.h * 7.5
        const s = 0.55 // half bar width
        const base = [
          project(X - s, 0, Z - s), project(X + s, 0, Z - s),
          project(X + s, 0, Z + s), project(X - s, 0, Z + s),
        ]
        const top = [
          project(X - s, hh, Z - s), project(X + s, hh, Z - s),
          project(X + s, hh, Z + s), project(X - s, hh, Z + s),
        ]

        const [rC, gC, bC] = b.up ? [16, 185, 129] : [239, 68, 68]
        const face = (pts: Array<[number, number, number]>, alpha: number) => {
          ctx.beginPath()
          ctx.moveTo(pts[0][0], pts[0][1])
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
          ctx.closePath()
          ctx.fillStyle = `rgba(${rC},${gC},${bC},${alpha})`
          ctx.fill()
          ctx.strokeStyle = `rgba(${rC},${gC},${bC},${Math.min(1, alpha + 0.25)})`
          ctx.lineWidth = 0.8
          ctx.stroke()
        }

        // Side faces: draw all four, farthest first — the two facing the
        // camera naturally overdraw the back ones
        const sides: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0]]
        const sideFaces = sides.map(([i, j]) => ({
          pts: [base[i], base[j], top[j], top[i]] as Array<[number, number, number]>,
          depth: (base[i][2] + base[j][2]) / 2,
          shade: 0.38 + 0.18 * (([0, 1].includes(i) ? 1 : 0)),
        })).sort((a, bq) => bq.depth - a.depth)
        for (const f of sideFaces) face(f.pts, f.shade)
        face(top, 0.85)

        // Hover hit test on the top face bounding box
        if (st.mouseX >= 0) {
          const xs = top.map(p => p[0]), ys = top.map(p => p[1])
          if (st.mouseX >= Math.min(...xs) - 2 && st.mouseX <= Math.max(...xs) + 2 &&
              st.mouseY >= Math.min(...ys) - 2 && st.mouseY <= Math.max(...ys) + 2) {
            hover = b
            hoverPx = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys)]
          }
        }

        // Ticker label above the bar
        const lx = (top[0][0] + top[2][0]) / 2
        const ly = Math.min(top[0][1], top[1][1], top[2][1], top[3][1]) - 4
        ctx.font = 'bold 9px monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(226,232,240,0.9)'
        ctx.fillText(b.ticker, lx, ly)
      }

      // Tooltip
      st.hover = hover
      if (hover && hoverPx) {
        const text1 = `${hover.ticker}  ${hover.value}`
        const text2 = `1D ${hover.change >= 0 ? '+' : ''}${hover.change.toFixed(2)}%`
        ctx.font = 'bold 11px monospace'
        const w = Math.max(ctx.measureText(text1).width, ctx.measureText(text2).width) + 16
        const tx = Math.min(Math.max(hoverPx[0] - w / 2, 4), W - w - 4)
        const ty = Math.max(hoverPx[1] - 44, 4)
        ctx.fillStyle = 'rgba(8,15,26,0.92)'
        ctx.strokeStyle = hover.up ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ;(ctx as any).roundRect ? (ctx as any).roundRect(tx, ty, w, 34, 4) : ctx.rect(tx, ty, w, 34)
        ctx.fill(); ctx.stroke()
        ctx.textAlign = 'left'
        ctx.fillStyle = '#fff'
        ctx.fillText(text1, tx + 8, ty + 14)
        ctx.fillStyle = hover.up ? '#10b981' : '#ef4444'
        ctx.fillText(text2, tx + 8, ty + 28)
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const activeMetric = METRICS.find(m => m.key === metric)!

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h1 className="text-sm font-bold text-white uppercase tracking-wide mr-2">3D Market Graph</h1>
        <div className="flex items-stretch rounded overflow-hidden border border-border">
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                metric === m.key ? 'bg-accent text-white' : 'bg-surface text-neutral hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-neutral ml-1">{activeMetric.axis} · green = gainer, red = loser</span>
        <span className="text-[10px] text-slate-600 ml-auto">drag to rotate · scroll to zoom · hover for details</span>
      </div>

      <div ref={wrapRef} className="bg-surface border border-border rounded-lg overflow-hidden">
        {rows.length === 0 ? (
          <div className="h-[420px] flex items-center justify-center text-sm text-neutral animate-pulse">
            Loading screener data…
          </div>
        ) : (
          <canvas ref={canvasRef} className="cursor-grab active:cursor-grabbing block" />
        )}
      </div>
    </div>
  )
}

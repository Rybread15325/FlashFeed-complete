'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import useSWR from 'swr'
import { clsx } from 'clsx'
import * as THREE from 'three'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type DecisionMapRow = {
  ticker: string
  company?: string
  price?: number
  marketCap?: number
  priceChangePct: number
  relativeVolume: number
  currentVolume: number
  rollingVolume: number
  volumeAcceleration: number
  structuredNewsSentiment: number
  socialSentiment: number
  combinedSentiment: number
  articleCount: number
  socialCount: number
  catalystLabel?: string
  quadrant: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Neutral'
  alignmentStatus: string
  activityScore: number
  convictionScore: number
  riskFlags: string[]
  reasons: string[]
  latestNewsTitles: Array<{ title: string; source?: string; publishedAt?: number; sentiment?: number }>
  screenerSource?: string
  screenerStatus?: string | null
  lastUpdated?: string
}

type SortKey = 'convictionScore' | 'activityScore' | 'relativeVolume' | 'priceChangePct' | 'combinedSentiment' | 'ticker'

function compact(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return '--'
  const value = Number(n)
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toFixed(value < 10 ? 2 : 0)
}

function colorForQuadrant(q: string) {
  if (q === 'Q1') return 0x34d399
  if (q === 'Q3') return 0xf87171
  if (q === 'Q2') return 0xfacc15
  if (q === 'Q4') return 0xfb923c
  return 0x94a3b8
}

function dotClass(q: string) {
  if (q === 'Q1') return 'bg-emerald-400'
  if (q === 'Q3') return 'bg-red-400'
  if (q === 'Q2') return 'bg-yellow-300'
  if (q === 'Q4') return 'bg-orange-400'
  return 'bg-slate-400'
}

function labelForQuadrant(q: string) {
  if (q === 'Q1') return 'Sentiment/price aligned bullish'
  if (q === 'Q3') return 'Sentiment/price aligned bearish'
  if (q === 'Q2') return 'Divergence: news not matching price'
  if (q === 'Q4') return 'Divergence: news not moving market'
  return 'Neutral/mixed'
}

function pointPosition(row: DecisionMapRow) {
  const x = Math.max(-1, Math.min(1, Number(row.combinedSentiment || 0))) * 7
  const y = Math.max(-25, Math.min(25, Number(row.priceChangePct || 0))) / 25 * 4.8
  const z = Math.max(0, Math.min(1, Math.log1p(Math.max(0, Number(row.relativeVolume || 0))) / Math.log(150))) * 7
  return new THREE.Vector3(x, y, z)
}

function bubbleSize(row: DecisionMapRow) {
  const volumePart = Math.sqrt(Math.max(1, Number(row.rollingVolume || row.currentVolume || 1))) / 23000
  const accelerationPart = Math.log1p(Math.max(0, Number(row.volumeAcceleration || 0))) / 18
  return Math.max(0.13, Math.min(0.55, 0.13 + volumePart + accelerationPart))
}

function makeLabelSprite(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = '700 22px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'
    ctx.fillRect(20, 7, 120, 34)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)'
    ctx.strokeRect(20.5, 7.5, 119, 33)
    ctx.fillStyle = '#e2e8f0'
    ctx.fillText(text, 80, 25)
  }
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.7, 0.5, 1)
  return sprite
}

function disposeObject(object: THREE.Object3D) {
  object.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) material.forEach(item => item.dispose())
    else material?.dispose()
  })
}

function ThreeDecisionMap({ rows, zoom, resetKey, isLoading }: { rows: DecisionMapRow[]; zoom: number; resetKey: number; isLoading: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef({ theta: -0.7, phi: 1.12, radius: 18, dragging: false, x: 0, y: 0 })
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: DecisionMapRow } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0f172a)
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(host.clientWidth, host.clientHeight)
    host.appendChild(renderer.domElement)

    const group = new THREE.Group()
    scene.add(group)
    scene.add(new THREE.AmbientLight(0xffffff, 0.72))
    const light = new THREE.DirectionalLight(0xffffff, 1.2)
    light.position.set(8, 12, 8)
    scene.add(light)

    const grid = new THREE.GridHelper(16, 16, 0x334155, 0x1e293b)
    grid.position.z = 3.5
    grid.rotation.x = Math.PI / 2
    group.add(grid)

    const axes = new THREE.AxesHelper(7.8)
    group.add(axes)
    const xLabel = makeLabelSprite('Sentiment')
    xLabel.position.set(7.7, -5.6, 0)
    group.add(xLabel)
    const yLabel = makeLabelSprite('Price %')
    yLabel.position.set(-8.5, 4.8, 0)
    group.add(yLabel)
    const zLabel = makeLabelSprite('Rel Vol')
    zLabel.position.set(-8.4, -5.4, 7)
    group.add(zLabel)

    const sphereGeometry = new THREE.SphereGeometry(1, 24, 16)
    const meshes: THREE.Mesh[] = []
    rows.slice(0, 140).forEach((row, index) => {
      const material = new THREE.MeshStandardMaterial({
        color: colorForQuadrant(row.quadrant),
        roughness: 0.42,
        metalness: 0.12,
        emissive: colorForQuadrant(row.quadrant),
        emissiveIntensity: 0.11,
      })
      const mesh = new THREE.Mesh(sphereGeometry, material)
      mesh.position.copy(pointPosition(row))
      const size = bubbleSize(row)
      mesh.scale.setScalar(size)
      mesh.userData.row = row
      group.add(mesh)
      meshes.push(mesh)
      if (index < 28) {
        const label = makeLabelSprite(row.ticker)
        label.position.copy(mesh.position).add(new THREE.Vector3(0, size + 0.32, 0))
        group.add(label)
      }
    })

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    const updateCamera = () => {
      const s = stateRef.current
      const radius = s.radius / Math.max(0.7, zoom)
      camera.position.x = radius * Math.sin(s.phi) * Math.cos(s.theta)
      camera.position.y = radius * Math.cos(s.phi)
      camera.position.z = radius * Math.sin(s.phi) * Math.sin(s.theta)
      camera.lookAt(0, 0, 3)
    }

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }

    const onPointerDown = (event: PointerEvent) => {
      stateRef.current.dragging = true
      stateRef.current.x = event.clientX
      stateRef.current.y = event.clientY
      host.setPointerCapture(event.pointerId)
    }
    const onPointerUp = (event: PointerEvent) => {
      stateRef.current.dragging = false
      try { host.releasePointerCapture(event.pointerId) } catch (_) {}
    }
    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      if (stateRef.current.dragging) {
        const dx = event.clientX - stateRef.current.x
        const dy = event.clientY - stateRef.current.y
        stateRef.current.theta -= dx * 0.008
        stateRef.current.phi = Math.max(0.42, Math.min(2.25, stateRef.current.phi + dy * 0.006))
        stateRef.current.x = event.clientX
        stateRef.current.y = event.clientY
        setTooltip(null)
        updateCamera()
        return
      }

      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(meshes, false)[0]
      if (hit?.object?.userData?.row) setTooltip({ x: event.clientX - rect.left + 12, y: event.clientY - rect.top + 12, row: hit.object.userData.row })
      else setTooltip(null)
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      stateRef.current.radius = Math.max(8, Math.min(34, stateRef.current.radius + event.deltaY * 0.015))
      updateCamera()
    }

    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      renderer.render(scene, camera)
    }

    stateRef.current.theta = -0.7
    stateRef.current.phi = 1.12
    stateRef.current.radius = 18
    resize()
    updateCamera()
    render()

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointerup', onPointerUp)
    host.addEventListener('pointerleave', onPointerUp as EventListener)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointerleave', onPointerUp as EventListener)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('wheel', onWheel)
      disposeObject(group)
      sphereGeometry.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [rows, resetKey, zoom])

  return (
    <div ref={hostRef} className="relative h-[560px] min-h-[420px] overflow-hidden rounded bg-bg border border-border">
      <div className="pointer-events-none absolute left-3 top-3 z-20 rounded border border-border bg-surface/90 px-2 py-1 text-[11px] text-neutral">
        {isLoading ? 'Loading real screener rows...' : `${rows.length} active screener-first rows`}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded border border-border bg-surface/90 px-2 py-1 text-[10px] text-slate-400">
        Drag rotate · wheel zoom · hover inspect
      </div>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-30 max-w-[360px] rounded border border-cyan-500/40 bg-slate-950/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-base font-semibold text-accent">{tooltip.row.ticker}</div>
            <div className="font-mono text-emerald-300">Score {tooltip.row.convictionScore}</div>
          </div>
          <div className="truncate text-slate-300">{tooltip.row.company || tooltip.row.screenerSource}</div>
          <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
            <div><span className="text-neutral">Sent</span><br />{tooltip.row.combinedSentiment.toFixed(2)}</div>
            <div><span className="text-neutral">Chg</span><br />{tooltip.row.priceChangePct.toFixed(2)}%</div>
            <div><span className="text-neutral">RelVol</span><br />{tooltip.row.relativeVolume.toFixed(2)}x</div>
          </div>
          <div className="mt-2 text-slate-300">{tooltip.row.catalystLabel || 'No catalyst'}</div>
          <div className="mt-1 text-[11px] text-neutral">{tooltip.row.latestNewsTitles?.[0]?.title || 'No recent headline'}</div>
        </div>
      )}
    </div>
  )
}

export function DecisionMapPanel() {
  const [minRelVolume, setMinRelVolume] = useState(1)
  const [minAbsChange, setMinAbsChange] = useState(0.5)
  const [minSentiment, setMinSentiment] = useState(0.12)
  const [minActivityScore, setMinActivityScore] = useState(0)
  const [windowHours, setWindowHours] = useState(24)
  const [universe, setUniverse] = useState('active_finviz')
  const [sortKey, setSortKey] = useState<SortKey>('convictionScore')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [zoom, setZoom] = useState(1)
  const [resetKey, setResetKey] = useState(0)

  const params = useMemo(() => new URLSearchParams({
    universe,
    limit: '180',
    min_rel_volume: String(minRelVolume),
    min_abs_change: String(minAbsChange),
    positive_sentiment: String(minSentiment),
    negative_sentiment: String(-minSentiment),
    price_threshold: String(minAbsChange),
    min_activity_score: String(minActivityScore),
    news_window_hours: String(windowHours),
    social_window_hours: String(windowHours),
    sortBy: sortKey,
    orderDir: sortDir,
  }), [minRelVolume, minAbsChange, minSentiment, minActivityScore, windowHours, universe, sortKey, sortDir])

  const { data, isLoading, mutate } = useSWR(`/api/decision-map?${params.toString()}`, fetcher, { refreshInterval: 30_000 })
  const rows: DecisionMapRow[] = data?.rows ?? []

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(String(bv)) : String(bv).localeCompare(av)
      return sortDir === 'asc' ? Number(av || 0) - Number(bv || 0) : Number(bv || 0) - Number(av || 0)
    })
    return copy.slice(0, 40)
  }, [rows, sortDir, sortKey])

  const setSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(v => v === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir(key === 'ticker' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
        <div className="font-semibold">Screener-first active universe</div>
        <div className="mt-1 opacity-80">
          Rows start from current numerical screener activity, then attach structured news, social sentiment, catalysts, and rolling volume. No fake rows are generated.
        </div>
      </div>

      <section className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs uppercase text-neutral font-medium">Three.js Decision Map</div>
            <div className="text-[11px] text-slate-400">X sentiment · Y price change · Z relative volume · bubble rolling volume</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral">
            {['Q1', 'Q2', 'Q3', 'Q4', 'Neutral'].map(q => (
              <span key={q} className="inline-flex items-center gap-1">
                <span className={clsx('h-2 w-2 rounded-full', dotClass(q))} />
                {q}
              </span>
            ))}
            <button onClick={() => mutate()} className="rounded border border-border bg-bg px-2 py-1 text-slate-200 hover:text-white">Refresh</button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-0">
          <div className="border-b xl:border-b-0 xl:border-r border-border p-3 space-y-3">
            <Control label="Min relative volume" value={`${minRelVolume.toFixed(1)}x`}>
              <input type="range" min="0" max="10" step="0.1" value={minRelVolume} onChange={e => setMinRelVolume(Number(e.target.value))} className="w-full" />
            </Control>
            <Control label="Min abs price change" value={`${minAbsChange.toFixed(1)}%`}>
              <input type="range" min="0" max="15" step="0.1" value={minAbsChange} onChange={e => setMinAbsChange(Number(e.target.value))} className="w-full" />
            </Control>
            <Control label="Min sentiment strength" value={minSentiment.toFixed(2)}>
              <input type="range" min="0" max="0.7" step="0.01" value={minSentiment} onChange={e => setMinSentiment(Number(e.target.value))} className="w-full" />
            </Control>
            <Control label="Min activity score" value={minActivityScore.toFixed(0)}>
              <input type="range" min="0" max="100" step="1" value={minActivityScore} onChange={e => setMinActivityScore(Number(e.target.value))} className="w-full" />
            </Control>
            <Control label="News/social window" value={`${windowHours}h`}>
              <select value={windowHours} onChange={e => setWindowHours(Number(e.target.value))} className="w-full bg-bg border border-border rounded px-2 py-1 text-xs text-slate-200">
                <option value={6}>6h</option>
                <option value={12}>12h</option>
                <option value={24}>24h</option>
                <option value={48}>48h</option>
                <option value={72}>72h</option>
              </select>
            </Control>
            <Control label="Universe" value={universe.replace('_', ' ')}>
              <select value={universe} onChange={e => setUniverse(e.target.value)} className="w-full bg-bg border border-border rounded px-2 py-1 text-xs text-slate-200">
                <option value="active_finviz">Active Finviz Elite</option>
                <option value="numeric_all">Finviz + TradingView numeric</option>
                <option value="tradingview">TradingView numeric</option>
              </select>
            </Control>
            <Control label="Zoom" value={`${zoom.toFixed(1)}x`}>
              <input type="range" min="0.7" max="1.8" step="0.05" value={zoom} onChange={e => setZoom(Number(e.target.value))} className="w-full" />
            </Control>
            <button
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-neutral hover:text-white"
              onClick={() => { setZoom(1); setResetKey(v => v + 1) }}
            >
              Reset View
            </button>
          </div>

          <div className="p-3">
            <ThreeDecisionMap rows={rows} zoom={zoom} resetKey={resetKey} isLoading={isLoading} />
          </div>
        </div>
      </section>

      <section className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-xs uppercase text-neutral font-medium">Decision Rows</div>
            <div className="text-[11px] text-slate-400">High activity + catalyst confirmation should rise to the top.</div>
          </div>
          <div className="text-[11px] text-neutral">
            Q1 {data?.summary?.Q1 ?? 0} · Q3 {data?.summary?.Q3 ?? 0} · divergence {data?.summary?.divergence ?? 0}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg/50 border-b border-border">
              <tr>
                {[
                  ['ticker', 'Ticker'],
                  ['priceChangePct', 'Chg%'],
                  ['relativeVolume', 'Rel Vol'],
                  ['combinedSentiment', 'Sent'],
                  ['quadrant', 'Quadrant'],
                  ['activityScore', 'Activity'],
                  ['convictionScore', 'Score'],
                  ['catalystLabel', 'Catalyst'],
                  ['headline', 'Top headline'],
                ].map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => ['ticker', 'priceChangePct', 'relativeVolume', 'combinedSentiment', 'activityScore', 'convictionScore'].includes(key) && setSort(key as SortKey)}
                    className="px-3 py-2 text-left text-[10px] uppercase text-neutral whitespace-nowrap cursor-pointer hover:text-white"
                  >
                    {label}{sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {sortedRows.map(row => (
                <tr key={row.ticker} className="hover:bg-bg/40">
                  <td className="px-3 py-2">
                    <div className="font-mono font-semibold text-accent">{row.ticker}</div>
                    <div className="text-[10px] text-neutral truncate max-w-[160px]">{row.company || row.screenerSource}</div>
                  </td>
                  <td className={clsx('px-3 py-2 font-mono', row.priceChangePct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {row.priceChangePct >= 0 ? '+' : ''}{row.priceChangePct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-200">{row.relativeVolume.toFixed(2)}x</td>
                  <td className={clsx('px-3 py-2 font-mono', row.combinedSentiment >= minSentiment ? 'text-emerald-400' : row.combinedSentiment <= -minSentiment ? 'text-red-400' : 'text-neutral')}>
                    {row.combinedSentiment.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-slate-200">{row.quadrant}</div>
                    <div className="text-[10px] text-neutral">{labelForQuadrant(row.quadrant)}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-200">{row.activityScore.toFixed(0)}</td>
                  <td className="px-3 py-2 font-mono text-emerald-300">{row.convictionScore}</td>
                  <td className="px-3 py-2">
                    <div className="text-slate-200 whitespace-nowrap">{row.catalystLabel || 'No catalyst'}</div>
                    <div className="text-[10px] text-neutral">{row.articleCount} news · {row.socialCount} social</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="max-w-[360px] truncate text-slate-300">{row.latestNewsTitles?.[0]?.title || 'No recent headline'}</div>
                    {row.riskFlags.length > 0 && <div className="mt-1 text-[10px] text-yellow-300 truncate">{row.riskFlags.slice(0, 3).join(', ')}</div>}
                  </td>
                </tr>
              ))}
              {!sortedRows.length && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-neutral">
                    No real screener-first rows match the current thresholds.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Control({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase text-neutral">{label}</span>
        <span className="font-mono text-[11px] text-slate-300">{value}</span>
      </div>
      {children}
    </label>
  )
}

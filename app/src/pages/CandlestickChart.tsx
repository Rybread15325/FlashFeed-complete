import { useEffect, useRef } from 'react'

interface Candle { time: string | number; open: number; high: number; low: number; close: number; volume?: number }
interface SeriesPoint { time: string | number; value: number; scaled?: number; count?: number }
interface BollingerData { upper: SeriesPoint[]; lower: SeriesPoint[] }
interface NewsEvent {
  time: string | number
  position?: string
  color?: string
  shape?: string
  text?: string
  title?: string
  source?: string
}

interface Props {
  candles: Candle[]
  bollinger?: BollingerData
  predicted?: SeriesPoint[]
  density?: SeriesPoint[]
  sentiment?: SeriesPoint[]
  newsEvents?: NewsEvent[]
}

export function CandlestickChart({ candles, bollinger, predicted = [], newsEvents = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return

    let disposed = false
    import('lightweight-charts').then(({ createChart, ColorType, CrosshairMode, CandlestickSeries, LineSeries, createSeriesMarkers }) => {
      if (disposed || !containerRef.current) return

      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#94a3b8',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: '#1e293b' },
          horzLines: { color: '#1e293b' },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: true },
      })
      chartRef.current = chart

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#10b981',
        downColor: '#ef4444',
        borderUpColor: '#10b981',
        borderDownColor: '#ef4444',
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      })
      candleSeries.setData(candles as any)

      if (bollinger) {
        const upperSeries = chart.addSeries(LineSeries, {
          color: 'rgba(139, 92, 246, 0.5)',
          lineWidth: 1,
          lineStyle: 2,
        })
        upperSeries.setData(bollinger.upper as any)

        const lowerSeries = chart.addSeries(LineSeries, {
          color: 'rgba(139, 92, 246, 0.5)',
          lineWidth: 1,
          lineStyle: 2,
        })
        lowerSeries.setData(bollinger.lower as any)
      }

      if (predicted && predicted.length > 0) {
        const predSeries = chart.addSeries(LineSeries, {
          color: '#f59e0b',
          lineWidth: 2,
          lineStyle: 2,
        })
        predSeries.setData(predicted as any)
      }

      if (newsEvents && newsEvents.length > 0) {
        const sorted = [...newsEvents].sort((a, b) => {
          const ta = typeof a.time === 'number' ? a.time : Math.floor(Date.parse(a.time as string) / 1000)
          const tb = typeof b.time === 'number' ? b.time : Math.floor(Date.parse(b.time as string) / 1000)
          return ta - tb
        })
        const markers = sorted.map(ev => {
          const bearish = ev.position === 'aboveBar' || ev.shape === 'arrowDown'
          return {
            time: ev.time,
            position: bearish ? 'aboveBar' : 'belowBar',
            color: ev.color || '#f59e0b',
            shape: bearish ? 'arrowDown' : 'arrowUp',
            text: ev.text || 'N',
          }
        })
        createSeriesMarkers(candleSeries, markers as any)
      }

      chart.timeScale().fitContent()

      const ro = new ResizeObserver(entries => {
        for (const entry of entries) chart.applyOptions({ width: entry.contentRect.width })
      })
      ro.observe(containerRef.current)
      return () => ro.disconnect()
    })

    return () => {
      disposed = true
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }
    }
  }, [candles, bollinger, predicted, newsEvents])

  return <div ref={containerRef} className="w-full h-full" />
}

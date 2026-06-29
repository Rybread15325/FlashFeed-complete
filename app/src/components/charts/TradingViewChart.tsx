import { useEffect, useRef } from 'react'

interface Props {
  ticker: string
  interval?: string  // '1' | '5' | '15' | '30' | '60' | 'D' | 'W'
  height?: number
  hideToolbar?: boolean
}

declare global {
  interface Window { TradingView: any }
}

const intervalMap: Record<string, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '1d': 'D', '1wk': 'W',
}

export function TradingViewChart({ ticker, interval = '1d', height = 260, hideToolbar = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<any>(null)
  const uid = `tv_${ticker.replace(/[^a-zA-Z0-9]/g, '_')}_${Math.random().toString(36).slice(2, 7)}`

  useEffect(() => {
    const tvInterval = intervalMap[interval] ?? 'D'

    const init = () => {
      if (!containerRef.current || !window.TradingView) return
      containerRef.current.innerHTML = `<div id="${uid}" style="height:${height}px;width:100%"></div>`
      widgetRef.current = new window.TradingView.widget({
        container_id: uid,
        symbol: ticker,
        interval: tvInterval,
        width: '100%',
        height,
        theme: 'dark',
        style: '1',
        locale: 'en',
        toolbar_bg: '#0c1a2e',
        hide_side_toolbar: true,
        hide_top_toolbar: hideToolbar,
        allow_symbol_change: false,
        save_image: false,
        details: false,
        withdateranges: !hideToolbar,
        backgroundColor: '#0c1a2e',
        gridColor: 'rgba(255,255,255,0.04)',
      })
    }

    if (window.TradingView) {
      init()
    } else {
      const existing = document.getElementById('tv-script')
      if (!existing) {
        const script = document.createElement('script')
        script.id = 'tv-script'
        script.src = 'https://s3.tradingview.com/tv.js'
        script.async = true
        script.onload = init
        document.head.appendChild(script)
      } else {
        existing.addEventListener('load', init)
      }
    }

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [ticker, interval, height])

  return (
    <div ref={containerRef} style={{ height, width: '100%' }} className="overflow-hidden rounded" />
  )
}

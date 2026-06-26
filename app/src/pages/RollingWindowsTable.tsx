'use client'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface WindowStat {
  window_minutes: number
  message_count: number
  avg_sentiment: number
  bullish_count: number
  bearish_count: number
  neutral_count: number
}

export function RollingWindowsTable({ ticker }: { ticker: string }) {
  const { data, isLoading } = useSWR(
    `/api/social/rolling/windows?ticker=${ticker}`,
    fetcher,
    { refreshInterval: 30_000 }
  )

  if (isLoading) {
    return <div className="text-xs text-neutral animate-pulse py-2">Loading rolling windows…</div>
  }

  const windows: WindowStat[] = data?.windows ?? []
  const hasData = windows.some(w => w.message_count > 0)

  if (!hasData) {
    return <div className="text-xs text-neutral py-2">No social posts in last hour for {ticker}</div>
  }

  function sentColor(v: number) {
    return v > 0.1 ? 'text-emerald-400' : v < -0.1 ? 'text-red-400' : 'text-neutral'
  }

  function sentBar(v: number) {
    const pct = Math.max(2, ((v + 1) / 2) * 100)
    const color = v > 0.1 ? '#10b981' : v < -0.1 ? '#ef4444' : '#475569'
    return (
      <div className="h-1 bg-slate-800 rounded-full overflow-hidden w-full">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    )
  }

  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">
        Rolling Sentiment Windows
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-[9px] text-neutral uppercase border-b border-border/40">
              <th className="text-left pb-1 pr-3 font-normal">Window</th>
              <th className="text-right pb-1 pr-3 font-normal">Posts</th>
              <th className="text-right pb-1 pr-3 font-normal">Avg Sent</th>
              <th className="pb-1 pr-3 font-normal min-w-[60px]"></th>
              <th className="text-right pb-1 pr-2 font-normal text-emerald-500">Bull</th>
              <th className="text-right pb-1 pr-2 font-normal text-red-500">Bear</th>
              <th className="text-right pb-1 font-normal">Neut</th>
            </tr>
          </thead>
          <tbody>
            {windows.map(w => (
              <tr key={w.window_minutes} className="border-b border-border/20 last:border-0">
                <td className="py-1 pr-3 font-mono text-neutral">{w.window_minutes}m</td>
                <td className="text-right py-1 pr-3 font-mono text-white">{w.message_count}</td>
                <td className={`text-right py-1 pr-3 font-mono ${sentColor(w.avg_sentiment)}`}>
                  {w.avg_sentiment > 0 ? '+' : ''}{w.avg_sentiment.toFixed(3)}
                </td>
                <td className="py-1 pr-3 w-[70px]">
                  {sentBar(w.avg_sentiment)}
                </td>
                <td className="text-right py-1 pr-2 text-emerald-400">{w.bullish_count}</td>
                <td className="text-right py-1 pr-2 text-red-400">{w.bearish_count}</td>
                <td className="text-right py-1 text-slate-500">{w.neutral_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

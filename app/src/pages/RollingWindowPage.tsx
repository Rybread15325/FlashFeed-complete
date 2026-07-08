import useSWR from 'swr'
import { useState } from 'react'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const WINDOWS = [
  { label: '5m',  value: '5' },
  { label: '15m', value: '15' },
  { label: '30m', value: '30' },
  { label: '1h',  value: '60' },
  { label: '2h',  value: '120' },
  { label: '24h', value: '1440' },
]

const PLATFORMS = ['all', 'stocktwits', 'reddit', 'twitter', 'bluesky']

interface SocialPost {
  _id: string
  platform: string
  ticker?: string
  symbol?: string
  title?: string
  text?: string
  content?: string
  sentiment_score: number
  sentiment?: string
  url?: string
  author?: string
  fetched_at?: number
}

function sentColor(v: number) {
  return v > 0.1 ? 'text-emerald-400' : v < -0.1 ? 'text-red-400' : 'text-slate-400'
}

function sentLabel(v: number) {
  return v > 0.1 ? 'Bull' : v < -0.1 ? 'Bear' : 'Neut'
}

function sentBg(v: number) {
  return v > 0.1 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
       : v < -0.1 ? 'bg-red-500/10 border-red-500/30 text-red-400'
       : 'bg-slate-700/30 border-slate-600/30 text-slate-400'
}

function platformIcon(p: string) {
  const map: Record<string, string> = {
    StockTwits: 'ST',
    Twitter: 'X',
    Reddit: 'Re',
    Bluesky: 'Bk',
  }
  return map[p] ?? p.slice(0, 2)
}

function platformColor(p: string) {
  const map: Record<string, string> = {
    StockTwits: 'text-orange-400',
    Twitter: 'text-sky-400',
    Reddit: 'text-red-400',
    Bluesky: 'text-blue-400',
  }
  return map[p] ?? 'text-slate-400'
}

function timeAgo(sec?: number) {
  if (!sec) return ''
  const diff = Math.floor(Date.now() / 1000) - sec
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function TickerSummary({ posts }: { posts: SocialPost[] }) {
  const byTicker: Record<string, SocialPost[]> = {}
  for (const p of posts) {
    const t = p.ticker || p.symbol || 'N/A'
    if (!byTicker[t]) byTicker[t] = []
    byTicker[t].push(p)
  }

  const rows = Object.entries(byTicker)
    .map(([ticker, items]) => {
      const avg = items.reduce((s, i) => s + Number(i.sentiment_score || 0), 0) / items.length
      const bull = items.filter(i => Number(i.sentiment_score) > 0.1).length
      const bear = items.filter(i => Number(i.sentiment_score) < -0.1).length
      return { ticker, count: items.length, avg, bull, bear }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  if (!rows.length) return null

  return (
    <div className="mb-4 border border-border rounded-lg bg-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <h2 className="text-white text-sm font-semibold">Top Tickers by Mentions</h2>
        <p className="text-[11px] text-neutral">Most discussed tickers in this window</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[9px] text-neutral uppercase border-b border-border/40">
              <th className="text-left px-3 py-1.5 font-normal">Ticker</th>
              <th className="text-right px-3 py-1.5 font-normal">Posts</th>
              <th className="text-right px-3 py-1.5 font-normal text-emerald-500">Bull</th>
              <th className="text-right px-3 py-1.5 font-normal text-red-500">Bear</th>
              <th className="text-right px-3 py-1.5 font-normal">Avg Sent</th>
              <th className="px-3 py-1.5 min-w-[80px]"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const pct = Math.max(2, ((r.avg + 1) / 2) * 100)
              const barColor = r.avg > 0.1 ? '#10b981' : r.avg < -0.1 ? '#ef4444' : '#475569'
              return (
                <tr key={r.ticker} className="border-b border-border/20 last:border-0 hover:bg-slate-800/30">
                  <td className="px-3 py-1.5 font-mono text-accent font-semibold">{r.ticker}</td>
                  <td className="text-right px-3 py-1.5 text-white font-mono">{r.count}</td>
                  <td className="text-right px-3 py-1.5 text-emerald-400 font-mono">{r.bull}</td>
                  <td className="text-right px-3 py-1.5 text-red-400 font-mono">{r.bear}</td>
                  <td className={`text-right px-3 py-1.5 font-mono ${sentColor(r.avg)}`}>
                    {r.avg > 0 ? '+' : ''}{r.avg.toFixed(3)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden w-full">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function RollingWindowPage() {
  const [window, setWindow] = useState('60')
  const [platform, setPlatform] = useState('all')

  const params = new URLSearchParams({ window_minutes: window, platform, limit: '200' })
  const { data, isLoading } = useSWR(`/api/social/rolling?${params}`, fetcher, { refreshInterval: 30_000 })
  const { data: stats } = useSWR(`/api/social/rolling/stats?window_minutes=${window}`, fetcher, { refreshInterval: 30_000 })

  const posts: SocialPost[] = data?.rows ?? []
  const counts: Record<string, number> = stats?.counts ?? {}
  const total = stats?.total ?? 0

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-white font-semibold text-lg">Rolling Window</h1>
          <p className="text-xs text-neutral mt-0.5">
            Social sentiment feed across all platforms in the selected time window.
          </p>
        </div>
        <span className="text-neutral text-sm">{posts.length} posts</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap bg-surface border border-border rounded-lg px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-neutral uppercase">Window</span>
          <div className="flex gap-1">
            {WINDOWS.map(w => (
              <button
                key={w.value}
                onClick={() => setWindow(w.value)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  window === w.value
                    ? 'bg-accent text-black font-semibold'
                    : 'bg-bg border border-border text-neutral hover:text-white'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 ml-3">
          <span className="text-[10px] text-neutral uppercase">Platform</span>
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value)}
            className="bg-bg border border-border text-xs text-neutral rounded px-1.5 py-1"
          >
            {PLATFORMS.map(p => (
              <option key={p} value={p}>{p === 'all' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Platform stats */}
      {total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {Object.entries(counts).map(([plat, count]) => (
            <div key={plat} className="border border-border rounded-lg bg-surface px-3 py-2">
              <div className={`text-sm font-mono font-semibold ${platformColor(plat)}`}>{platformIcon(plat)} {plat}</div>
              <div className="text-white text-lg font-mono mt-0.5">{count}</div>
              <div className="text-[9px] text-neutral uppercase">posts in {WINDOWS.find(w => w.value === window)?.label ?? window + 'm'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Ticker summary */}
      {posts.length > 0 && <TickerSummary posts={posts} />}

      {/* Posts feed */}
      <div className="border border-border rounded-lg bg-surface overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-white text-sm font-semibold">Social Feed</h2>
            <p className="text-[11px] text-neutral">Recent posts sorted by time</p>
          </div>
        </div>

        {isLoading ? (
          <div className="text-neutral text-sm animate-pulse p-4">Loading social posts…</div>
        ) : posts.length === 0 ? (
          <div className="text-center py-10 text-neutral">
            <div className="text-3xl mb-2">💬</div>
            <div className="text-sm">No social posts in this window</div>
            <div className="text-xs text-neutral/60 mt-1">Data appears once the social pipeline is running</div>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {posts.slice(0, 100).map(post => {
              const body = post.text || post.content || post.title || ''
              const ticker = post.ticker || post.symbol
              const score = Number(post.sentiment_score || 0)
              return (
                <div key={String(post._id)} className="px-3 py-2 hover:bg-slate-800/20 transition-colors">
                  <div className="flex items-start gap-2">
                    <div className={`text-[9px] font-bold mt-0.5 w-6 text-center flex-shrink-0 ${platformColor(post.platform)}`}>
                      {platformIcon(post.platform)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {ticker && (
                          <span className="font-mono text-accent text-xs font-semibold">{ticker}</span>
                        )}
                        <span className={`text-[9px] px-1 py-0.5 rounded border ${sentBg(score)}`}>
                          {sentLabel(score)} {score !== 0 ? (score > 0 ? '+' : '') + score.toFixed(2) : ''}
                        </span>
                        <span className="text-[9px] text-neutral ml-auto">{timeAgo(post.fetched_at)}</span>
                      </div>
                      {body && (
                        <p className="text-xs text-slate-300 mt-0.5 line-clamp-2 leading-snug">{body}</p>
                      )}
                      {post.author && (
                        <span className="text-[9px] text-neutral/60">@{post.author}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface EnrichArticle {
  title: string
  source: string
  publish_date: number
  url?: string
  sentiment?: string
  ai_sentiment_label?: string
  ai_sentiment_score?: number
  ml_confidence?: number
  catalyst?: string
}

interface SocialPlatform {
  sentiment: number
  message_count: number
  bullish_count: number
  bearish_count: number
  density?: number
}

export interface EnrichData {
  ticker: string
  news_alert?: string
  news_alert_count?: number
  news: {
    articles: EnrichArticle[]
    ai?: string
    sources?: string[]
  }
  social: {
    stocktwits?: SocialPlatform
    bluesky?: SocialPlatform
    reddit?: SocialPlatform
    rumor?: boolean
    rumor_keywords?: string[]
  }
}

function fmtTime(ts: number) {
  const d = new Date(ts * 1000)
  const now = Date.now()
  const diffMin = Math.floor((now - ts * 1000) / 60_000)
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
  return d.toLocaleDateString()
}

function SentBadge({ value, label }: { value?: string | null; label?: string }) {
  const v = (value ?? label ?? '').toLowerCase()
  if (v.includes('bull') || v.includes('positive')) {
    return <span className="text-[9px] bg-emerald-900/60 text-emerald-400 px-1 py-0.5 rounded">BULL</span>
  }
  if (v.includes('bear') || v.includes('negative')) {
    return <span className="text-[9px] bg-red-900/60 text-red-400 px-1 py-0.5 rounded">BEAR</span>
  }
  return <span className="text-[9px] bg-slate-700 text-slate-400 px-1 py-0.5 rounded">NEUT</span>
}

function PlatformBlock({ label, data }: { label: string; data?: SocialPlatform }) {
  if (!data) return (
    <div className="bg-[#0c1a2e] rounded p-2">
      <div className="text-[10px] text-slate-500 uppercase mb-1">{label}</div>
      <div className="text-xs text-slate-600">No data</div>
    </div>
  )

  const total = data.message_count || 1
  const bullPct = Math.round((data.bullish_count / total) * 100)
  const bearPct = Math.round((data.bearish_count / total) * 100)
  const sentColor = data.sentiment > 0.15 ? 'text-emerald-400' : data.sentiment < -0.15 ? 'text-red-400' : 'text-neutral'

  return (
    <div className="bg-[#0c1a2e] rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500 uppercase">{label}</span>
        <span className={`text-[11px] font-mono ${sentColor}`}>
          {data.sentiment > 0 ? '+' : ''}{data.sentiment.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] mb-1.5">
        <span className="text-neutral">{data.message_count} posts</span>
        {data.density != null && (
          <span className="text-slate-500">{data.density.toFixed(3)}/m</span>
        )}
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden w-full bg-slate-800">
        <div className="bg-emerald-500" style={{ width: `${bullPct}%` }} />
        <div className="bg-red-500 ml-auto" style={{ width: `${bearPct}%` }} />
      </div>
      <div className="flex justify-between text-[9px] mt-0.5">
        <span className="text-emerald-500">{data.bullish_count} bull</span>
        <span className="text-red-500">{(data.message_count - data.bullish_count - data.bearish_count)} neut</span>
        <span className="text-red-400">{data.bearish_count} bear</span>
      </div>
    </div>
  )
}

export function TickerEnrichPanels({ ticker }: { ticker: string }) {
  const { data, isLoading } = useSWR<{ ok: boolean; data: EnrichData }>(
    `/api/ticker/${ticker}/enrich`,
    fetcher,
    { refreshInterval: 60_000 }
  )

  if (isLoading) {
    return (
      <div className="animate-pulse text-xs text-slate-600 py-4 text-center">
        Loading enrichment data…
      </div>
    )
  }

  const enrich = data?.data
  if (!enrich) {
    return (
      <div className="text-xs text-slate-600 py-4 text-center">
        No enrichment data available for {ticker}
      </div>
    )
  }

  const articles = enrich.news?.articles ?? []
  const social = enrich.social ?? {}

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-3">
      {/* News Panel (2/3 width) */}
      <div className="lg:col-span-2 space-y-2">
        {/* AI Catalyst Banner */}
        {enrich.news?.ai && (
          <div className="bg-sky-950/50 border border-sky-800/50 rounded-lg px-3 py-2 text-xs">
            <div className="text-[10px] text-sky-400 uppercase tracking-wide mb-1 font-medium">
              AI Catalyst Analysis
            </div>
            <div className="text-slate-200 leading-relaxed">{enrich.news.ai}</div>
          </div>
        )}

        {/* Alert badge */}
        {enrich.news_alert && (
          <div className="flex items-center gap-2 bg-amber-950/40 border border-amber-800/40 rounded px-2 py-1.5">
            <span className="text-amber-400 text-[10px]">ALERT</span>
            <span className="text-xs text-amber-200">{enrich.news_alert}</span>
            {enrich.news_alert_count != null && (
              <span className="ml-auto text-[10px] text-amber-500">{enrich.news_alert_count} articles</span>
            )}
          </div>
        )}

        {/* Article list */}
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">
              Latest Articles · {articles.length}
            </span>
          </div>
          {articles.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-600">No articles found</div>
          ) : (
            <div className="divide-y divide-border/40 max-h-[320px] overflow-y-auto">
              {articles.map((a, i) => {
                const sentVal = a.ai_sentiment_label || a.sentiment
                const conf = a.ai_sentiment_score ?? a.ml_confidence
                return (
                  <div key={i} className="px-3 py-2 hover:bg-[#0c1a2e] transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-slate-200 hover:text-sky-300 leading-snug flex-1 line-clamp-2"
                      >
                        {a.title}
                      </a>
                      <div className="flex-shrink-0 flex items-center gap-1">
                        <SentBadge value={sentVal} />
                        {conf != null && (
                          <span className="text-[9px] text-slate-500 font-mono">{(conf * 100).toFixed(0)}%</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-slate-500">
                      <span>{a.source}</span>
                      <span>·</span>
                      <span>{fmtTime(a.publish_date)}</span>
                      {a.catalyst && (
                        <>
                          <span>·</span>
                          <span className="text-sky-500 uppercase">{a.catalyst}</span>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Social Panel (1/3 width) */}
      <div className="space-y-2">
        {/* Rumor detection */}
        {social.rumor && (
          <div className="bg-yellow-950/40 border border-yellow-700/40 rounded-lg px-3 py-2">
            <div className="text-[10px] text-yellow-400 uppercase mb-1 font-medium">Rumor Detected</div>
            {social.rumor_keywords && social.rumor_keywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {social.rumor_keywords.map(kw => (
                  <span key={kw} className="text-[9px] bg-yellow-900/60 text-yellow-300 px-1.5 py-0.5 rounded">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Social Signals</span>
          </div>
          <div className="p-2 space-y-2">
            <PlatformBlock label="Stocktwits" data={social.stocktwits} />
            <PlatformBlock label="Bluesky" data={social.bluesky} />
            <PlatformBlock label="Reddit" data={social.reddit} />
          </div>
        </div>
      </div>
    </div>
  )
}

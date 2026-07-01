import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type PredRow = {
  rank: number
  ticker: string
  company?: string
  price?: number | null
  change_pct?: number
  rel_volume?: number
  ai_rank_score: number
  direction: string
  confidence?: number
  prediction_signal?: {
    direction?: string
    probability_up?: number
    predicted_return_5m?: number
    confidence?: number
    model?: string
  } | null
  evidence?: {
    news_score?: number
    social_sentiment?: number
    social_posts?: number
  }
  reasons?: string[]
}

function ProbBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 bg-slate-700 rounded-full h-1.5">
        <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-emerald-400 text-xs font-medium">{pct}%</span>
    </div>
  )
}

export function PredictionsPage() {
  const { data, isLoading, error, mutate } = useSWR(
    '/api/ai/rankings?window_minutes=480',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 120_000 }
  )

  const allRows: PredRow[] = data?.rows ?? []
  const upRows = allRows.filter(r =>
    r.prediction_signal?.direction === 'up' ||
    (r.prediction_signal?.probability_up ?? 0) >= 0.55
  )
  const watchRows = allRows.filter(r =>
    r.prediction_signal?.direction === 'watch' ||
    ((r.prediction_signal?.probability_up ?? 0) >= 0.45 && (r.prediction_signal?.probability_up ?? 0) < 0.55)
  )

  const modelInfo = data?.model
  const generatedAt = data?.generated_at ? new Date(data.generated_at).toLocaleTimeString() : null

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Predicted Up Tomorrow</h1>
          <p className="text-sm text-slate-400 mt-1">AI-ranked signals indicating expected upward movement</p>
          {generatedAt && (
            <p className="text-xs text-slate-500 mt-0.5">Last updated {generatedAt}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {modelInfo && (
            <div className="text-xs text-slate-400 bg-slate-800 rounded px-3 py-1.5 border border-slate-700">
              Model: <span className="text-white">{modelInfo.status === 'ready' ? `✓ ${modelInfo.samples} samples` : modelInfo.status ?? 'baseline'}</span>
            </div>
          )}
          <button
            onClick={() => mutate()}
            className="px-3 py-1.5 text-xs font-medium bg-sky-500/10 border border-sky-500/30 text-sky-400 rounded hover:bg-sky-500/20 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-12">
          <div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          Loading predictions…
        </div>
      )}

      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded px-4 py-3">
          Failed to load predictions — check that the backend is running.
        </div>
      )}

      {!isLoading && !error && upRows.length === 0 && (
        <div className="text-slate-500 text-sm bg-slate-800/50 border border-slate-700 rounded px-4 py-8 text-center">
          No strong upward prediction signals right now.
          <br />
          <span className="text-xs text-slate-600 mt-1 block">Signals are generated when the market is active and AI data is available.</span>
        </div>
      )}

      {upRows.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            Strong Up Signals — {upRows.length} ticker{upRows.length !== 1 ? 's' : ''}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60">
                <tr className="text-left text-xs text-slate-400">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Ticker</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Change</th>
                  <th className="px-4 py-3 font-medium">Prob Up</th>
                  <th className="px-4 py-3 font-medium">AI Score</th>
                  <th className="px-4 py-3 font-medium">News</th>
                  <th className="px-4 py-3 font-medium">Social</th>
                  <th className="px-4 py-3 font-medium">Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {upRows.map((row) => (
                  <tr key={row.ticker} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-slate-500 text-xs">#{row.rank}</td>
                    <td className="px-4 py-3 font-bold text-sky-400 font-mono">{row.ticker}</td>
                    <td className="px-4 py-3 text-slate-300 truncate max-w-[160px]">{row.company || '—'}</td>
                    <td className="px-4 py-3 text-white font-mono">
                      {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
                    </td>
                    <td className={`px-4 py-3 font-medium ${(row.change_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {row.change_pct != null ? `${row.change_pct >= 0 ? '+' : ''}${row.change_pct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ProbBar value={row.prediction_signal?.probability_up ?? 0} />
                    </td>
                    <td className="px-4 py-3 text-white font-medium">
                      {row.ai_rank_score?.toFixed(2) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {row.evidence?.news_score != null ? row.evidence.news_score.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {row.evidence?.social_posts != null ? `${row.evidence.social_posts} posts` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                        ▲ Up
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {watchRows.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
            Watch — {watchRows.length} ticker{watchRows.length !== 1 ? 's' : ''} near threshold
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60">
                <tr className="text-left text-xs text-slate-400">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Ticker</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Change</th>
                  <th className="px-4 py-3 font-medium">Prob Up</th>
                  <th className="px-4 py-3 font-medium">AI Score</th>
                  <th className="px-4 py-3 font-medium">Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {watchRows.map((row) => (
                  <tr key={row.ticker} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-slate-500 text-xs">#{row.rank}</td>
                    <td className="px-4 py-3 font-bold text-sky-400 font-mono">{row.ticker}</td>
                    <td className="px-4 py-3 text-slate-300 truncate max-w-[160px]">{row.company || '—'}</td>
                    <td className="px-4 py-3 text-white font-mono">
                      {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
                    </td>
                    <td className={`px-4 py-3 font-medium ${(row.change_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {row.change_pct != null ? `${row.change_pct >= 0 ? '+' : ''}${row.change_pct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ProbBar value={row.prediction_signal?.probability_up ?? 0} />
                    </td>
                    <td className="px-4 py-3 text-white font-medium">
                      {row.ai_rank_score?.toFixed(2) ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
                        → Watch
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

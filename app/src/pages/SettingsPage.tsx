import { useEffect, useState } from 'react'
import { getCustomStocks, addCustomStock, removeCustomStock, normalizeTicker } from '../lib/stocks'
import { useLanguage, LANGUAGES } from '../lib/language'

type KeywordRow = {
  keyword: string
  word?: string
  category?: string
  enabled?: boolean
  active?: boolean
  hits?: number
}

type SourceRow = {
  source?: string
  name?: string
  url?: string
  category?: string
  status?: string
  method?: string
  note?: string
  count?: number
  enabled?: boolean
  editable?: boolean
  configured?: boolean
  latest_fetch?: number | string | null
  detail?: string
}

type DiskSnapshot = {
  _id?: string
  saved_at?: string | Date
  expires_at?: string | Date
  articles_count?: number
  social_count?: number
  top_tickers?: string[]
  sentiment?: { bullish?: number; bearish?: number; neutral?: number }
}

type DiskStatus = {
  ok?: boolean
  ttl_days?: number
  snapshot_count?: number
  snapshots?: DiskSnapshot[]
  last_save?: string | Date | null
  article_count?: number
  social_count?: number
}

type ConnectionRow = {
  label: string
  url: string
  token: string
  login: string
}

type ConnectionSettings = Record<string, ConnectionRow>

async function jsonFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`)
  return data
}

export function SettingsPage() {
  const { language, setLanguage } = useLanguage()
  const [translateStatus, setTranslateStatus] = useState<{ google_translate_configured?: boolean } | null>(null)
  const [keywords, setKeywords] = useState<KeywordRow[]>([])
  const [structured, setStructured] = useState<SourceRow[]>([])
  const [customSources, setCustomSources] = useState<SourceRow[]>([])
  const [sourceHealth, setSourceHealth] = useState<{ working_count?: number; ready_count?: number; blocked_count?: number; planned_count?: number; sources?: SourceRow[] }>({})
  const [connections, setConnections] = useState<ConnectionSettings>({})
  const [newKeyword, setNewKeyword] = useState('')
  const [newKeywordCategory, setNewKeywordCategory] = useState('custom')
  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceUrl, setNewSourceUrl] = useState('')
  const [newSourceCategory, setNewSourceCategory] = useState('custom')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [customStocks, setCustomStocks] = useState<string[]>(() => getCustomStocks())
  const [newStock, setNewStock] = useState('')
  const [diskStatus, setDiskStatus] = useState<DiskStatus>({})
  const [diskTtl, setDiskTtl] = useState(3)
  const [diskSaving, setDiskSaving] = useState(false)
  const [diskClearing, setDiskClearing] = useState(false)

  const load = async () => {
    setError(null)
    const [kw, src, conn, health, disk, txStatus] = await Promise.all([
      jsonFetch('/api/settings/keywords'),
      jsonFetch('/api/settings/sources'),
      jsonFetch('/api/settings/connections'),
      jsonFetch('/api/sources/health').catch(() => ({ sources: [] })),
      jsonFetch('/api/disk/status').catch(() => ({})),
      jsonFetch('/api/translate/status').catch(() => ({})),
    ])
    setKeywords(kw.keywords || [])
    setStructured(src.structured || [])
    setCustomSources(src.custom_rss_sources || [])
    setConnections(conn.connections || {})
    setSourceHealth(health || {})
    setDiskStatus(disk || {})
    setDiskTtl(disk?.ttl_days ?? 3)
    setTranslateStatus(txStatus || {})
  }

  useEffect(() => {
    load().catch(e => setError(String(e.message || e)))
  }, [])

  const addKeyword = async () => {
    setError(null); setSaved(null)
    await jsonFetch('/api/settings/keywords', {
      method: 'POST',
      body: JSON.stringify({ keyword: newKeyword, category: newKeywordCategory }),
    })
    setNewKeyword('')
    setSaved('Keyword saved')
    await load()
  }

  const removeKeyword = async (keyword: string) => {
    setError(null); setSaved(null)
    await jsonFetch(`/api/settings/keywords/${encodeURIComponent(keyword)}`, { method: 'DELETE' })
    setSaved('Keyword removed')
    await load()
  }

  const toggleKeyword = async (keyword: string, enabled: boolean) => {
    setError(null); setSaved(null)
    await jsonFetch(`/api/settings/keywords/${encodeURIComponent(keyword)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    })
    await load()
  }

  const addSource = async () => {
    setError(null); setSaved(null)
    await jsonFetch('/api/settings/sources', {
      method: 'POST',
      body: JSON.stringify({ name: newSourceName, url: newSourceUrl, category: newSourceCategory }),
    })
    setNewSourceName('')
    setNewSourceUrl('')
    setSaved('RSS source saved')
    await load()
  }

  const removeSource = async (name: string) => {
    setError(null); setSaved(null)
    await jsonFetch(`/api/settings/sources/${encodeURIComponent(name)}`, { method: 'DELETE' })
    setSaved('RSS source removed')
    await load()
  }

  const toggleSource = async (name: string, enabled: boolean) => {
    setError(null); setSaved(null)
    await jsonFetch(`/api/settings/sources/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    })
    await load()
  }

  const setConnectionField = (key: string, field: keyof ConnectionRow, value: string) => {
    setConnections(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || { label: key, url: '', token: '', login: '' }),
        [field]: value,
      },
    }))
  }

  const saveConnections = async () => {
    setError(null); setSaved(null)
    const data = await jsonFetch('/api/settings/connections', {
      method: 'PATCH',
      body: JSON.stringify({ connections }),
    })
    setConnections(data.connections || connections)
    setSaved('Connection settings saved')
  }

  const saveToDisk = async () => {
    setDiskSaving(true); setError(null); setSaved(null)
    try {
      await jsonFetch('/api/disk/save', { method: 'POST' })
      setSaved('Snapshot saved to disk')
      await load()
    } catch (e) { setError(String((e as Error).message || e)) }
    finally { setDiskSaving(false) }
  }

  const saveDiskSettings = async () => {
    setError(null); setSaved(null)
    try {
      await jsonFetch('/api/disk/settings', { method: 'PATCH', body: JSON.stringify({ ttl_days: diskTtl }) })
      setSaved(`Disk TTL updated to ${diskTtl} day${diskTtl !== 1 ? 's' : ''}`)
      await load()
    } catch (e) { setError(String((e as Error).message || e)) }
  }

  const clearDisk = async () => {
    if (!window.confirm(`Delete all ${diskStatus.snapshot_count ?? 0} disk snapshot(s)? This cannot be undone.`)) return
    setDiskClearing(true); setError(null); setSaved(null)
    try {
      const r = await jsonFetch('/api/disk/clear', { method: 'DELETE' })
      setSaved(`Cleared ${r.deleted ?? 0} snapshot(s) from disk`)
      await load()
    } catch (e) { setError(String((e as Error).message || e)) }
    finally { setDiskClearing(false) }
  }

  const statusClass = (s?: string) => {
    if (!s) return 'text-slate-400 border-slate-600'
    if (s.includes('working') || s.includes('public') || s === 'enabled') return 'text-emerald-400 border-emerald-500/50'
    if (s.includes('ready')) return 'text-sky-400 border-sky-500/50'
    if (s.includes('required') || s.includes('contract')) return 'text-yellow-400 border-yellow-500/50'
    if (s.includes('disabled') || s.includes('invalid')) return 'text-red-400 border-red-500/50'
    return 'text-slate-400 border-slate-600'
  }

  const timeAgo = (value?: number | string | null) => {
    if (!value) return '--'
    const raw = Number(value)
    const ms = Number.isFinite(raw) ? (raw > 1_000_000_000_000 ? raw : raw * 1000) : Date.parse(String(value))
    if (!Number.isFinite(ms)) return '--'
    const diff = Math.max(0, Date.now() - ms)
    if (diff < 60_000) return 'now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return `${Math.floor(diff / 86_400_000)}d ago`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-white font-semibold text-2xl">Settings</h1>
        <p className="text-sm text-neutral mt-1">
          Manage signal keywords and custom RSS sources. Custom keywords filter news articles and appear in article summaries. Licensed sources are listed with their current import status.
        </p>
      </div>

      {error && <div className="border border-red-500/40 bg-red-500/10 text-red-300 rounded-lg p-3 text-sm">{error}</div>}
      {saved && <div className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 rounded-lg p-3 text-sm">{saved}</div>}

      {/* Language Section */}
      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="mb-4">
          <h2 className="text-white font-medium flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Language
          </h2>
          <p className="text-xs text-neutral mt-1">
            Translate news article titles and content. Uses Google Translate when configured, otherwise uses built-in glossary.
            {translateStatus?.google_translate_configured
              ? <span className="text-emerald-400 ml-1">● Google Translate active</span>
              : <span className="text-neutral ml-1">● Add GOOGLE_TRANSLATE_API_KEY to .env for full translation</span>
            }
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => setLanguage(lang.code)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-all ${
                language === lang.code
                  ? 'border-accent bg-accent/10 text-white'
                  : 'border-border text-neutral hover:border-accent/50 hover:text-white'
              }`}
            >
              <span className="text-base leading-none">{lang.flag}</span>
              <div className="min-w-0 text-left">
                <div className="font-medium text-xs leading-tight truncate">{lang.label}</div>
                <div className="text-[10px] text-neutral leading-tight truncate">{lang.nativeLabel}</div>
              </div>
            </button>
          ))}
        </div>
        {language !== 'en' && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-neutral">Active:</span>
            <span className="text-xs text-white font-medium">{LANGUAGES.find(l => l.code === language)?.label || language}</span>
            <button
              onClick={() => setLanguage('en')}
              className="text-xs text-neutral hover:text-white border border-border rounded px-2 py-0.5 ml-auto"
            >
              Reset to English
            </button>
          </div>
        )}
      </section>

      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="mb-3">
          <h2 className="text-white font-medium">Custom Stocks</h2>
          <p className="text-xs text-neutral mt-1">Add your own tickers — they appear at the top of the Charts ticker dropdown. Saved in this browser.</p>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <input
            value={newStock}
            onChange={e => setNewStock(normalizeTicker(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter' && normalizeTicker(newStock)) { setCustomStocks(addCustomStock(newStock)); setNewStock(''); setSaved('Custom stock added — it now appears in the Charts dropdown'); setError(null) } }}
            placeholder="Add ticker (e.g. SHOP)"
            className="w-[180px] bg-bg border border-border text-sm text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-accent placeholder:text-slate-600"
          />
          <button
            onClick={() => { if (normalizeTicker(newStock)) { setCustomStocks(addCustomStock(newStock)); setNewStock(''); setSaved('Custom stock added — it now appears in the Charts dropdown'); setError(null) } }}
            className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-sky-400 transition-colors"
          >Add</button>
        </div>
        {customStocks.length === 0 ? (
          <p className="text-sm text-neutral">No custom stocks yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {customStocks.map(sym => (
              <span key={sym} className="inline-flex items-center gap-2 bg-bg border border-border rounded-full pl-3 pr-2 py-1 text-sm font-mono text-accent">
                {sym}
                <button
                  onClick={() => { setCustomStocks(removeCustomStock(sym)); setSaved('Custom stock removed'); setError(null) }}
                  className="text-neutral hover:text-red-400 leading-none text-base"
                  title={`Remove ${sym}`}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-white font-medium flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>
              </svg>
              Disk Storage
            </h2>
            <p className="text-xs text-neutral mt-1">Snapshots of articles and social posts saved to MongoDB. Kafka and Redis pipelines are unaffected. Auto-deleted after the configured TTL.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={saveToDisk}
              disabled={diskSaving}
              className="px-3 py-1.5 bg-accent text-white text-xs font-medium rounded hover:bg-sky-400 disabled:opacity-50 transition-colors"
            >
              {diskSaving ? 'Saving…' : 'Save Now'}
            </button>
            <button
              onClick={clearDisk}
              disabled={diskClearing || !diskStatus.snapshot_count}
              className="px-3 py-1.5 border border-red-500/40 text-red-300 text-xs font-medium rounded hover:text-red-200 disabled:opacity-40 transition-colors"
            >
              {diskClearing ? 'Clearing…' : 'Clear All'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <DiskMetric label="Snapshots" value={String(diskStatus.snapshot_count ?? 0)} />
          <DiskMetric label="Articles in DB" value={String(diskStatus.article_count ?? 0)} />
          <DiskMetric label="Social in DB" value={String(diskStatus.social_count ?? 0)} />
          <DiskMetric label="Current TTL" value={`${diskStatus.ttl_days ?? 3}d`} tone="text-accent" />
        </div>

        <div className="flex items-center gap-3 mb-4 p-3 bg-bg/40 border border-border rounded-lg">
          <label className="text-sm text-white whitespace-nowrap">Auto-delete after</label>
          <input
            type="range"
            min={1}
            max={30}
            value={diskTtl}
            onChange={e => setDiskTtl(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="text-sm font-mono text-white w-16 text-right">{diskTtl} day{diskTtl !== 1 ? 's' : ''}</span>
          <button
            onClick={saveDiskSettings}
            className="px-3 py-1.5 bg-surface border border-border text-xs text-neutral rounded hover:text-white hover:border-accent transition-colors"
          >
            Apply
          </button>
        </div>

        {(diskStatus.snapshots ?? []).length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            <div className="text-xs text-neutral uppercase tracking-wide mb-1">Recent Snapshots</div>
            {(diskStatus.snapshots ?? []).map((s, i) => {
              const savedAt = s.saved_at ? new Date(s.saved_at) : null
              const expiresAt = s.expires_at ? new Date(s.expires_at) : null
              const msLeft = expiresAt ? expiresAt.getTime() - Date.now() : null
              const daysLeft = msLeft != null ? Math.max(0, Math.ceil(msLeft / 86400000)) : null
              return (
                <div key={String(s._id) || i} className="flex items-center justify-between gap-3 border border-border rounded p-2 bg-bg/40 text-xs">
                  <div>
                    <span className="text-white">{savedAt ? savedAt.toLocaleString() : '--'}</span>
                    {s.top_tickers?.length ? (
                      <span className="text-neutral ml-2">{s.top_tickers.slice(0, 5).join(', ')}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-neutral shrink-0">
                    <span>{s.articles_count ?? 0} articles</span>
                    <span>{s.social_count ?? 0} social</span>
                    {daysLeft != null && <span className={daysLeft <= 1 ? 'text-red-400' : 'text-emerald-400'}>{daysLeft}d left</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!(diskStatus.snapshots ?? []).length && (
          <div className="text-sm text-neutral border border-border rounded p-3 bg-bg/40">
            No disk snapshots yet. Click <strong className="text-white">Save Now</strong> or use the disk button in the top bar to create one.
          </div>
        )}
      </section>

      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-white font-medium">Live Source Health</h2>
            <p className="text-xs text-neutral">Counts and last-seen timestamps from the current MongoDB collections.</p>
          </div>
          <div className="hidden md:grid grid-cols-4 gap-2 text-center">
            <HealthMetric label="Working" value={sourceHealth.working_count ?? 0} tone="text-emerald-300" />
            <HealthMetric label="Ready" value={sourceHealth.ready_count ?? 0} tone="text-sky-300" />
            <HealthMetric label="Blocked" value={sourceHealth.blocked_count ?? 0} tone="text-yellow-300" />
            <HealthMetric label="Planned" value={sourceHealth.planned_count ?? 0} tone="text-neutral" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral border-b border-border">
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Rows</th>
                <th className="py-2 pr-3">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {(sourceHealth.sources || []).slice(0, 12).map(s => (
                <tr key={s.source || s.name} className="border-b border-border/50">
                  <td className="py-2 pr-3 text-white">{s.source || s.name}</td>
                  <td className="py-2 pr-3">
                    <span className={`inline-flex border rounded-full px-2 py-0.5 text-xs ${statusClass(s.status)}`}>
                      {s.status || 'unknown'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-neutral">{s.count ?? 0}</td>
                  <td className="py-2 pr-3 text-neutral">{timeAgo(s.latest_fetch)}</td>
                </tr>
              ))}
              {!(sourceHealth.sources || []).length && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-neutral">Source health has not loaded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-white font-medium">Platform Connections</h2>
            <p className="text-xs text-neutral">URLs and credentials reserved for Finviz, TradingView, TD/Schwab, and Interactive Brokers integrations.</p>
          </div>
          <button
            onClick={saveConnections}
            className="bg-accent text-white rounded px-4 py-2 text-sm"
          >
            Save
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {Object.entries(connections).map(([key, row]) => (
            <div key={key} className="border border-border rounded p-3 bg-bg/40">
              <div className="text-sm text-white mb-2">{row.label}</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  value={row.url}
                  onChange={e => setConnectionField(key, 'url', e.target.value)}
                  placeholder="URL"
                  className="bg-bg border border-border rounded px-3 py-2 text-sm text-white"
                />
                <input
                  value={row.login}
                  onChange={e => setConnectionField(key, 'login', e.target.value)}
                  placeholder="Login"
                  className="bg-bg border border-border rounded px-3 py-2 text-sm text-white"
                />
                <input
                  value={row.token}
                  onChange={e => setConnectionField(key, 'token', e.target.value)}
                  placeholder="Token / API key"
                  type="password"
                  className="bg-bg border border-border rounded px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-white font-medium">Keyword Dictionary</h2>
            <p className="text-xs text-neutral">Used by the news filter and keyword highlighting.</p>
          </div>
          <span className="text-xs text-neutral">{keywords.length} keywords</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-2 mb-4">
          <input
            value={newKeyword}
            onChange={e => setNewKeyword(e.target.value)}
            placeholder="e.g. reverse split"
            className="bg-bg border border-border rounded px-3 py-2 text-sm text-white"
          />
          <input
            value={newKeywordCategory}
            onChange={e => setNewKeywordCategory(e.target.value)}
            placeholder="category"
            className="bg-bg border border-border rounded px-3 py-2 text-sm text-white"
          />
          <button
            onClick={addKeyword}
            disabled={!newKeyword.trim()}
            className="bg-accent text-white rounded px-4 py-2 text-sm disabled:opacity-40"
          >
            Add Keyword
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {keywords.map(k => {
            const kw = k.keyword || k.word || ''
            const enabled = k.enabled !== false && k.active !== false
            return (
              <div key={kw} className="flex items-center justify-between gap-2 border border-border rounded p-2 bg-bg/40">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{kw}</div>
                  <div className="text-[11px] text-neutral">{k.category || 'custom'} · {enabled ? 'enabled' : 'disabled'}</div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => toggleKeyword(kw, !enabled)}
                    className="text-xs border border-border text-neutral rounded px-2 py-1 hover:text-white"
                  >
                    {enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => removeKeyword(kw)}
                    className="text-xs border border-red-500/40 text-red-300 rounded px-2 py-1 hover:text-red-200"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="mb-3">
          <h2 className="text-white font-medium">Add Custom RSS Source</h2>
          <p className="text-xs text-neutral">These are read by the RSS importer on the next fetch run.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_150px_auto] gap-2 mb-4">
          <input
            value={newSourceName}
            onChange={e => setNewSourceName(e.target.value)}
            placeholder="Source name"
            className="bg-bg border border-border rounded px-3 py-2 text-sm text-white"
          />
          <input
            value={newSourceUrl}
            onChange={e => setNewSourceUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            className="bg-bg border border-border rounded px-3 py-2 text-sm text-white"
          />
          <input
            value={newSourceCategory}
            onChange={e => setNewSourceCategory(e.target.value)}
            placeholder="category"
            className="bg-bg border border-border rounded px-3 py-2 text-sm text-white"
          />
          <button
            onClick={addSource}
            disabled={!newSourceName.trim() || !newSourceUrl.trim()}
            className="bg-accent text-white rounded px-4 py-2 text-sm disabled:opacity-40"
          >
            Add Source
          </button>
        </div>

        <div className="space-y-2">
          {customSources.length === 0 ? (
            <div className="text-sm text-neutral border border-border rounded p-3">No custom RSS sources yet.</div>
          ) : customSources.map(s => {
            const name = s.name || s.source || ''
            const enabled = s.enabled !== false
            return (
              <div key={name} className="flex items-center justify-between gap-3 border border-border rounded p-3 bg-bg/40">
                <div className="min-w-0">
                  <div className="text-sm text-white">{name}</div>
                  <div className="text-xs text-neutral truncate">{s.url}</div>
                  <div className="text-[11px] text-neutral">{s.category || 'custom'} · {enabled ? 'enabled' : 'disabled'}</div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => toggleSource(name, !enabled)}
                    className="text-xs border border-border text-neutral rounded px-2 py-1 hover:text-white"
                  >
                    {enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => removeSource(name)}
                    className="text-xs border border-red-500/40 text-red-300 rounded px-2 py-1 hover:text-red-200"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="mb-3">
          <h2 className="text-white font-medium">Professor Structured Sources</h2>
          <p className="text-xs text-neutral">Working sources show article counts. Licensed/API-gated sources stay visible instead of being hidden.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral border-b border-border">
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Method</th>
                <th className="py-2 pr-3 text-right">Articles</th>
              </tr>
            </thead>
            <tbody>
              {structured.map(s => (
                <tr key={s.source || s.name} className="border-b border-border/50">
                  <td className="py-2 pr-3 text-white">{s.source || s.name}</td>
                  <td className="py-2 pr-3">
                    <span className={`inline-flex border rounded-full px-2 py-0.5 text-xs ${statusClass(s.status)}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-neutral">{s.method}</td>
                  <td className="py-2 pr-3 text-right font-mono text-neutral">{s.count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function HealthMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="border border-border rounded px-3 py-2 bg-bg/40 min-w-[78px]">
      <div className={`font-mono text-base ${tone}`}>{value}</div>
      <div className="text-[10px] text-neutral uppercase">{label}</div>
    </div>
  )
}

function DiskMetric({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-border rounded px-3 py-2 bg-bg/40">
      <div className={`font-mono text-lg font-semibold ${tone}`}>{value}</div>
      <div className="text-[10px] text-neutral uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  )
}

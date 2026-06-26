import { useEffect, useState } from 'react'

type HealthState = 'checking' | 'ok' | 'degraded' | 'unreachable'

interface ServiceStatus { ok: boolean; status: string }
interface HealthData {
  ok: boolean
  status: string
  services?: {
    mongo?: ServiceStatus
    redis?: ServiceStatus
    kafka?: ServiceStatus
    disk?: ServiceStatus
  }
}

export function ApiHealthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HealthState>('checking')
  const [health, setHealth] = useState<HealthData | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const check = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        const data: HealthData = await res.json()
        if (!cancelled) {
          setHealth(data)
          setState(data.ok ? 'ok' : 'degraded')
        }
      } catch {
        if (!cancelled) {
          setState('unreachable')
          // Retry every 3 seconds while unreachable
          timer = setTimeout(() => { if (!cancelled) setAttempt(a => a + 1) }, 3000)
        }
      }
    }

    check()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [attempt])

  // Once API is confirmed OK, render the full app + register session beacon
  useEffect(() => {
    if (state !== 'ok') return
    const beacon = () => navigator.sendBeacon('/api/session/save', '')
    window.addEventListener('pagehide', beacon)
    return () => window.removeEventListener('pagehide', beacon)
  }, [state])

  if (state === 'ok' || state === 'degraded') return <>{children}</>

  // Waiting / unreachable screen
  return (
    <div className="min-h-screen bg-[#06101a] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="text-accent font-bold text-2xl tracking-tight">FlashFeed</span>
        </div>

        {state === 'checking' && (
          <>
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-neutral text-sm">Connecting to API…</p>
          </>
        )}

        {state === 'unreachable' && (
          <>
            <div className="border border-red-500/30 bg-red-500/10 rounded-lg p-4">
              <p className="text-red-300 font-medium mb-1">API Unreachable</p>
              <p className="text-neutral text-sm">
                The backend is not responding at <code className="text-accent">localhost:3001</code>.
              </p>
            </div>
            <div className="text-left bg-surface border border-border rounded-lg p-4 space-y-2 text-sm">
              <p className="text-white font-medium">To start the API:</p>
              <code className="block bg-bg/60 rounded px-3 py-2 text-accent text-xs">
                docker compose up -d
              </code>
              <p className="text-neutral text-xs mt-2">Retrying automatically every 3 seconds…</p>
            </div>
            <button
              onClick={() => setAttempt(a => a + 1)}
              className="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-sky-400 transition-colors"
            >
              Retry Now
            </button>
          </>
        )}
      </div>
    </div>
  )
}

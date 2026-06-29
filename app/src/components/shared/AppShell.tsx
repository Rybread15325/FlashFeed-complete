import { useEffect, useState } from 'react'
import { TopBar } from './TopBar'
import { ToastProvider } from '@/components/shared/Toast'

function useGoogleTranslateActive() {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const check = () => {
      const cls = document.documentElement.classList
      setActive(cls.contains('translated-ltr') || cls.contains('translated-rtl'))
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return active
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const gtActive = useGoogleTranslateActive()

  return (
    <ToastProvider>
      <div
        className="flex bg-bg overflow-hidden"
        style={{ height: gtActive ? 'calc(100vh - 40px)' : '100vh', marginTop: gtActive ? 40 : 0 }}
      >
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar />
          <main className="flex-1 overflow-auto p-4 md:p-5">{children}</main>
        </div>
      </div>
    </ToastProvider>
  )
}

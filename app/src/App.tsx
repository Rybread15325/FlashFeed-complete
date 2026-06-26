import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell }        from './components/shared/AppShell'
import { ApiHealthGate }   from './components/shared/ApiHealthGate'
import { OverviewPage }    from './pages/OverviewPage'
import { AIPage }          from './pages/AIPage'
import { NewsPage }        from './pages/NewsPage'
import { ScreenerPage }    from './pages/ScreenerPage'
import SocialPage from './pages/SocialPage'
import { ChartsPage }      from './pages/ChartsPage'
import { ChartsGridPage }  from './pages/ChartsGridPage'
import { MomentumPage }    from './pages/MomentumPage'
import { CorrelationPage } from './pages/CorrelationPage'
import { SettingsPage }    from './pages/SettingsPage'
import { LanguageContext, getStoredLanguage, storeLanguage } from './lib/language'

export default function App() {
  const [language, setLanguageState] = useState<string>(getStoredLanguage)

  const setLanguage = (code: string) => {
    setLanguageState(code)
    storeLanguage(code)
    // Persist to backend (best-effort)
    fetch('/api/settings/language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: code }),
    }).catch(() => {})
  }

  return (
    <ApiHealthGate>
      <LanguageContext.Provider value={{ language, setLanguage }}>
        <AppShell>
          <Routes>
            <Route path="/"            element={<Navigate to="/overview" replace />} />
            <Route path="/overview"    element={<OverviewPage />} />
            <Route path="/ai"          element={<AIPage />} />
            <Route path="/news"        element={<NewsPage />} />
            <Route path="/screener"    element={<ScreenerPage />} />
            <Route path="/social"      element={<SocialPage />} />
            <Route path="/charts"      element={<ChartsPage />} />
            <Route path="/charts-grid" element={<ChartsGridPage />} />
            <Route path="/momentum"    element={<MomentumPage />} />
            <Route path="/correlation" element={<CorrelationPage />} />
            <Route path="/settings"    element={<SettingsPage />} />
          </Routes>
        </AppShell>
      </LanguageContext.Provider>
    </ApiHealthGate>
  )
}

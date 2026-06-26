import { createContext, useContext } from 'react'

export interface Language {
  code: string
  label: string
  nativeLabel: string
  flag: string
}

export const LANGUAGES: Language[] = [
  { code: 'en', label: 'English',    nativeLabel: 'English',    flag: '🇺🇸' },
  { code: 'zh', label: 'Chinese',    nativeLabel: '中文',        flag: '🇨🇳' },
  { code: 'hi', label: 'Hindi',      nativeLabel: 'हिन्दी',      flag: '🇮🇳' },
  { code: 'es', label: 'Spanish',    nativeLabel: 'Español',    flag: '🇪🇸' },
  { code: 'ar', label: 'Arabic',     nativeLabel: 'العربية',     flag: '🇸🇦' },
  { code: 'fr', label: 'French',     nativeLabel: 'Français',   flag: '🇫🇷' },
  { code: 'bn', label: 'Bengali',    nativeLabel: 'বাংলা',       flag: '🇧🇩' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português',  flag: '🇧🇷' },
  { code: 'ru', label: 'Russian',    nativeLabel: 'Русский',    flag: '🇷🇺' },
  { code: 'ja', label: 'Japanese',   nativeLabel: '日本語',      flag: '🇯🇵' },
]

const LS_KEY = 'flashfeed_ui_language'

export function getStoredLanguage(): string {
  try { return localStorage.getItem(LS_KEY) || 'en' } catch { return 'en' }
}

export function storeLanguage(code: string): void {
  try { localStorage.setItem(LS_KEY, code) } catch {}
}

export interface LanguageContextValue {
  language: string
  setLanguage: (code: string) => void
}

export const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => {},
})

export function useLanguage() {
  return useContext(LanguageContext)
}

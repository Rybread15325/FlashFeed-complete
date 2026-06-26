import { useMemo, useState, useEffect } from 'react'
import { useLanguage, LANGUAGES } from './language'

export const DEFAULT_TRANSLATION_LANGUAGE = 'en'

export function getLanguageLabel(language: string) {
  return LANGUAGES.find(l => l.code === language)?.label || language
}

export function useTargetLanguage() {
  const { language } = useLanguage()
  return language || DEFAULT_TRANSLATION_LANGUAGE
}

export function canTranslateText(text: string | undefined | null) {
  const cleaned = String(text || '').trim()
  return Boolean(cleaned)
}

export function useTranslatedText(text: string | undefined | null) {
  const targetLanguage = useTargetLanguage()
  const [translated, setTranslated] = useState('')
  const [source, setSource] = useState('')
  const cleanedText = useMemo(() => String(text || '').trim(), [text])

  useEffect(() => {
    let cancelled = false

    if (!canTranslateText(cleanedText) || targetLanguage === 'en') {
      setTranslated(cleanedText)
      setSource('passthrough')
      return
    }

    const run = async () => {
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanedText, target_language: targetLanguage }),
        })
        const data = await res.json()
        if (!cancelled) {
          setTranslated(data.translated_text || cleanedText)
          setSource(data.provider || '')
        }
      } catch {
        if (!cancelled) {
          setTranslated(cleanedText)
          setSource('')
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [cleanedText, targetLanguage])

  return { translated: translated || cleanedText, source }
}

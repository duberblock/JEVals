'use client'

import { useEffect, useState } from 'react'

import { getDictionary, type Dictionary, type Locale } from '.'

// Locale persistence per plan 15.1: default 'en', stored in localStorage as
// 'jevals-locale', no URL locale segment. The LanguageSelector writes the key
// and broadcasts this event so client components (the shared chrome — header
// and navs — and Principal) re-render in the new locale without a navigation.
export const LOCALE_STORAGE_KEY = 'jevals-locale'
export const LOCALE_CHANGED_EVENT = 'jevals-locale-changed'

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return stored === 'es' ? 'es' : 'en'
  } catch {
    return 'en'
  }
}

export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>('en')

  useEffect(() => {
    const sync = () => setLocale(readStoredLocale())
    sync()
    window.addEventListener(LOCALE_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(LOCALE_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return locale
}

export function useDictionary(): { locale: Locale; dictionary: Dictionary } {
  const locale = useLocale()
  return { locale, dictionary: getDictionary(locale) }
}

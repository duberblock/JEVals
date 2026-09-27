'use client'

import { useEffect, useState } from 'react'

import { getDictionary, type Locale } from '../../lib/i18n'
import { LOCALE_CHANGED_EVENT, LOCALE_STORAGE_KEY } from '../../lib/i18n/use-locale'

export function LanguageSelector() {
  const [locale, setLocale] = useState<Locale>('en')
  const dictionary = getDictionary(locale)

  useEffect(() => {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'en' || stored === 'es') setLocale(stored)
  }, [])

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale)
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale)
    // Broadcast so client components sharing the locale re-render (plan 15.1:
    // preference is local, there is no URL locale segment).
    window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT))
  }

  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <span className="sr-only">{dictionary.language.label}</span>
      {/* §16: min-h-11 keeps a ~44px touch target and text-base a 16px font —
          focusing a sub-16px input makes iOS Safari zoom the page. */}
      <select
        aria-label={dictionary.language.label}
        className="min-h-11 rounded-md border border-input bg-card px-3 py-2 text-base font-medium text-foreground"
        onChange={(event) => changeLocale(event.target.value as Locale)}
        value={locale}
      >
        <option value="en">EN</option>
        <option value="es">ES</option>
      </select>
    </label>
  )
}

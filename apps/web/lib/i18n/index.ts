import { en } from './en'
import { es } from './es'

export type Locale = 'en' | 'es'
export type Dictionary = typeof en

export const dictionaries = { en, es } satisfies Record<Locale, Dictionary>

export function getDictionary(locale: Locale = 'en'): Dictionary {
  return dictionaries[locale]
}

import type { Locale } from './i18n'

// Deterministic display formats for the compare surfaces (plan sections
// 22/27-30). Documented decisions:
//
// - JEV Fidelity renders as a percentage with ONE decimal maximum
//   (0.8125 -> "81.3%", 0.968 -> "96.8%", 1 -> "100%"), localized.
// - Compact leading-dot decimals (".18", ".037", ".5") follow the section 27
//   canonical examples: absolute value, at most `maxFractionDigits` digits,
//   trailing zeros trimmed with one digit kept, ALWAYS a dot — never
//   localized — so they stay consistent with the "Both < .5" / "Crossed .5"
//   phrase family, which keeps its dot in every locale.
// - Compare score values keep the rubric precision of the plan examples
//   ("1.82 -> 1.64"): one-to-two decimals, localized like every other
//   full-precision number in the app.

export function formatFidelityPercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
}

export function formatLeadingDot(value: number, maxFractionDigits: number): string {
  const fixed = Math.abs(value).toFixed(maxFractionDigits)
  const [integer, fraction = ''] = fixed.split('.')
  const trimmed = fraction.replace(/0+$/, '') || '0'
  return integer === '0' ? `.${trimmed}` : `${integer}.${trimmed}`
}

export function formatCompareScore(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value)
}

import { describe, expect, it } from 'vitest'

import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import { getDictionary } from '../../lib/i18n'

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key))
}

describe('i18n dictionaries', () => {
  it('keeps English and Spanish key parity', () => {
    expect(flattenKeys(es).sort()).toEqual(flattenKeys(en).sort())
  })

  it('defaults to English without a URL locale segment', () => {
    expect(getDictionary().nav.principal).toBe('Principal')
  })
})

// P47: the scenario dictionary slice — explicit parity pin for the new keys
// (flattenKeys above already enforces general parity; this documents intent).
describe('i18n scenario slice (P47)', () => {
  it('carries the scenario keys in both dictionaries', () => {
    expect(en.scenario.title).toBe('SCENARIO')
    expect(en.scenario.view).toBe('View scenario')
    expect(en.scenario.copy).toBe('Copy')
    expect(en.scenario.copied).toBe('Copied')
    expect(es.scenario.title).toBe('ESCENARIO')
    expect(es.scenario.view).toBe('Ver escenario')
    expect(es.scenario.copy).toBe('Copiar')
    expect(es.scenario.copied).toBe('Copiado')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SESSION_CASE_KEY,
  clearSessionCase,
  readSessionCase,
  setSessionCase,
} from '../../lib/session-case'

// P45 (R62): the case in consultation persists in sessionStorage under the
// `jevals.execution` key — per tab, surviving same-tab navigation, gone when
// the tab closes. The lib is the ONLY access point (lazy/guarded so SSR and
// private-mode browsers never crash).
describe('session-case lib', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  it('exposes the ruling-mandated storage key', () => {
    expect(SESSION_CASE_KEY).toBe('jevals.execution')
  })

  it('reads back what set wrote, and clear removes it', () => {
    expect(readSessionCase()).toBeNull()

    setSessionCase('run_deadbeefcafe1234')
    expect(window.sessionStorage.getItem(SESSION_CASE_KEY)).toBe('run_deadbeefcafe1234')
    expect(readSessionCase()).toBe('run_deadbeefcafe1234')

    clearSessionCase()
    expect(readSessionCase()).toBeNull()
    expect(window.sessionStorage.getItem(SESSION_CASE_KEY)).toBeNull()
  })

  it('set overwrites the previous case (one case in consultation at a time)', () => {
    setSessionCase('run_first0000001')
    setSessionCase('run_second000002')

    expect(readSessionCase()).toBe('run_second000002')
  })

  // W7: every access is guarded — a missing sessionStorage (SSR/prerender or
  // an embedded context) reads null and writes no-op, never throws.
  it('reads null and no-ops every write when sessionStorage is absent (W7)', () => {
    vi.stubGlobal('sessionStorage', undefined)

    expect(readSessionCase()).toBeNull()
    expect(() => setSessionCase('run_any0000000000')).not.toThrow()
    expect(() => clearSessionCase()).not.toThrow()
  })

  // T1.1 hardening: some browsers throw on sessionStorage ACCESS in private
  // mode — the try/catch keeps the views alive (state degrades to "no case").
  it('never throws when sessionStorage access itself rejects (private mode)', () => {
    const throwing = {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      removeItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    }
    vi.stubGlobal('sessionStorage', throwing)

    expect(() => expect(readSessionCase()).toBeNull()).not.toThrow()
    expect(() => setSessionCase('run_any0000000000')).not.toThrow()
    expect(() => clearSessionCase()).not.toThrow()
  })
})

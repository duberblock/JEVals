// P45 (R62): the case in consultation — the execution_id of the run or case
// the user is currently looking at — persisted in sessionStorage under the
// `jevals.execution` key. Per tab (T1.1): it survives same-tab navigation
// between Principal, Investigación and Operación, and dies with the tab;
// there is deliberately no multi-tab synchronization. Every access is
// guarded (W7): views call these helpers ONLY from effects (never during
// render — SSR/prerender safe), and the helpers themselves tolerate both a
// MISSING sessionStorage (embedded contexts) and one that THROWS on access
// (private-mode browsers) by degrading to "no case" — persistence is
// best-effort and never fatal to the page.

export const SESSION_CASE_KEY = 'jevals.execution'

export function readSessionCase(): string | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null
  try {
    return window.sessionStorage.getItem(SESSION_CASE_KEY)
  } catch {
    return null
  }
}

export function setSessionCase(executionId: string): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    window.sessionStorage.setItem(SESSION_CASE_KEY, executionId)
  } catch {
    // Private mode et al.: the page works without persistence.
  }
}

export function clearSessionCase(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    window.sessionStorage.removeItem(SESSION_CASE_KEY)
  } catch {
    // Same tolerance as above.
  }
}

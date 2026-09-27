import { expect, type Page } from '@playwright/test'

// §79 Phase 10 console hygiene gate: the demo must show a clean browser
// console, so every surface visit is policed for real noise — console
// messages of type 'error' or 'warning' plus uncaught exceptions
// ('pageerror'). Info-level framework orchestration (e.g. the React DevTools
// banner) is deliberately NOT noise under this policy: the gate covers
// error/warning/pageerror only.

export type ConsoleNoiseKind = 'console.error' | 'console.warning' | 'pageerror'

export type ConsoleNoiseRecord = {
  kind: ConsoleNoiseKind
  text: string
  url: string
}

// Genuinely unfixable, framework-origin messages may be exempted here — each
// entry REQUIRES a one-line justification and will be challenged in review.
// Prefer fixing the app at the source over growing this list.
const ALLOWED_NOISE: ReadonlyArray<{ pattern: RegExp; because: string }> = []

function isAllowed(text: string): boolean {
  return ALLOWED_NOISE.some(({ pattern }) => pattern.test(text))
}

// Attach to the page BEFORE the first navigation. Returns the live record
// array — it keeps accumulating as the page emits noise, so callers can slice
// it per surface (sweep) or assert the whole test's noise at the end.
export function collectConsoleNoise(page: Page): ConsoleNoiseRecord[] {
  const records: ConsoleNoiseRecord[] = []
  page.on('console', (message) => {
    const type = message.type()
    if (type !== 'error' && type !== 'warning') return
    const text = message.text()
    if (isAllowed(text)) return
    records.push({
      kind: type === 'error' ? 'console.error' : 'console.warning',
      text,
      // Resource failures (e.g. 404s) report no source location; fall back
      // to the page URL so every record carries a usable URL.
      url: message.location().url || page.url(),
    })
  })
  page.on('pageerror', (error) => {
    if (isAllowed(error.message)) return
    records.push({ kind: 'pageerror', text: error.message, url: page.url() })
  })
  return records
}

// D1 drain window: console/pageerror events travel page -> CDP -> Node
// asynchronously, so a message already emitted by the page may not yet have
// been DISPATCHED to the handlers above at the moment of a synchronous
// assert — escaping the gate (a flaky green). Yielding 100ms of in-page
// event-loop time lets any pending short timers/microtasks fire AND their
// protocol events get delivered before the caller slices/asserts. Call this
// BEFORE every expectNoConsoleNoise (or noise.slice) call site.
export async function drainConsole(page: Page): Promise<void> {
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
}

// D3 documented blind spot: page.on('console') does not observe
// service-worker/worker console messages (the demo ships no SW today).

// Fail (hard by default, softly with { soft: true } so a sweep can report
// every offending surface in one run) listing every offending message.
export function expectNoConsoleNoise(
  records: ConsoleNoiseRecord[],
  where: string,
  options: { soft?: boolean } = {}
): void {
  const listing = records.map((record, index) => `  ${index + 1}. [${record.kind}] ${record.text} — ${record.url}`)
  const asserter = options.soft ? expect.soft : expect
  asserter(
    records,
    `${where}: browser console must be free of errors, warnings and uncaught exceptions. Noise discovered:\n${listing}`
  ).toEqual([])
}

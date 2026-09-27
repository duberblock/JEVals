import { expect, test, type Page } from '@playwright/test'

import {
  collectConsoleNoise,
  type ConsoleNoiseRecord,
  drainConsole,
  expectNoConsoleNoise,
  EXECUTION_ID,
  installHermeticApi,
  SYSTEM_ONE_REQUEST,
} from '../fixtures'

// P45 (docs/plan-mejoras.md §P45) e2e: the case in consultation persists in
// sessionStorage — a run landing sets it, and every screen mounted WITHOUT an
// explicit param consults the SAME case (Principal through the P30 funnel,
// Investigación and Operación as if the param had named it). The explicit
// param always wins and re-sets the session. Hydrating by session is GET
// only (§50) and never rewrites the URL (T1.8). Written from the existing
// spec patterns (streaming.spec.ts); the orchestrator's demo gate owns the
// run.

// §79 Phase 10 console hygiene gate, whole-test scope.
let consoleNoise: ConsoleNoiseRecord[]
let consolePage: Page

test.beforeEach(async ({ page }) => {
  consolePage = page
  consoleNoise = collectConsoleNoise(page)
})

test.afterEach(async () => {
  // D1 drain window (FIRST, before the synchronous assert).
  await drainConsole(consolePage)
  expectNoConsoleNoise(consoleNoise, `session-case · ${test.info().titlePath.join(' › ')}`)
})

test.describe('P45 session case', () => {
  test('a run sets the case in consultation and every screen follows it without a param', async ({ page }) => {
    await installHermeticApi(page)
    await page.goto('/')

    // Run the emulator case: its landing makes it the case in consultation.
    await page.getByRole('textbox', { name: 'Request JSON' }).fill(SYSTEM_ONE_REQUEST)
    await expect(page.getByText('3 QUESTIONS DETECTED')).toBeVisible()
    await page.getByRole('button', { name: 'Run request' }).click()
    const hero = page.getByTestId('hero-result')
    await expect(hero).toBeVisible()
    await expect(hero).toContainText('✓ Run completed · 3 questions')

    // Investigación WITHOUT a param consults the session case (T1.3): the
    // same execution's WHY renders, and the URL stays clean (T1.8 — the
    // session is invisible in the address bar).
    await page.getByRole('link', { name: 'Investigation', exact: true }).click()
    await expect(page).toHaveURL(/\/investigation$/)
    const header = page.getByTestId('investigation-header')
    await expect(header).toBeVisible()
    await expect(header).toContainText('request_type')

    // Operación WITHOUT a param selects the session case (T1.3): the
    // emulator execution (not in the list fixture) owns the central detail,
    // displacing the default most-recent selection — that row stays unmarked.
    await page.getByRole('link', { name: 'Operation', exact: true }).click()
    await expect(page).toHaveURL(/\/operation$/)
    await expect(page.getByTestId('operation-central-header')).toContainText('Execution #run_emu0001a')
    await expect(page.getByTestId('rail-row-run_e2e0001a2b3c')).not.toHaveAttribute('aria-current', 'true')

    // Principal WITHOUT a param hydrates the session case through the P30
    // funnel (the chip communicates the origin; §50: no re-POST ever).
    await page.getByRole('link', { name: 'Principal', exact: true }).click()
    await expect(page.getByTestId('loaded-from-origin')).toContainText('Loaded from execution run_emu0001a')
    await expect(page.getByTestId('hero-result')).toContainText('✓ Run completed · 3 questions')
  })

  test('an explicit param wins over the session and re-sets it (deep links keep working)', async ({ page }) => {
    await installHermeticApi(page)

    // Seed the session with the emulator case, then deep-link another one —
    // the param is the explicit ask, so it wins…
    await page.goto('/')
    await page.evaluate(() => window.sessionStorage.setItem('jevals.execution', 'run_emu0001a2b3c'))
    await page.goto(`/investigation?execution=${EXECUTION_ID}&question=request_type&primitive=choice`)
    const header = page.getByTestId('investigation-header')
    await expect(header).toBeVisible()
    await expect(header).toContainText('request_type')

    // …and its landing RE-SET the session: Operación without a param now
    // selects the deep-linked case, not the seeded one (T1.3).
    await page.getByRole('link', { name: 'Operation', exact: true }).click()
    await expect(page.getByTestId('operation-central-header')).toContainText('Execution #run_e2e0001a')
    await expect(page.getByTestId('rail-row-run_e2e0001a2b3c')).toHaveAttribute('aria-current', 'true')
  })
})

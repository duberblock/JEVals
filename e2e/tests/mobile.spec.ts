import { expect, test, type Page } from '@playwright/test'

import {
  collectConsoleNoise,
  type ConsoleNoiseRecord,
  drainConsole,
  EXECUTION_ID,
  expectNoConsoleNoise,
  installHermeticApi,
  SYSTEM_ONE_REQUEST,
} from '../fixtures'

// §73 "E2E mobile 375 x 667": the twelve-step mobile flow, run in the mobile
// project (viewport 375x667, touch, iPhone-ish user agent). Every API call is
// answered hermetically; visible-text assertions use the EN dictionary (the
// default locale).

// §73 step 12 / §16 gate: no document-level horizontal scroll at 375.
async function expectNoDocumentOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth, `${where}: documentElement.scrollWidth must not exceed window.innerWidth`).toBeLessThanOrEqual(
    innerWidth
  )
}

test.describe('§73 mobile 375x667 twelve-step flow', () => {
  // Clipboard permissions for §73 step 11 (copy analysis bundle).
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  let hermetic: Awaited<ReturnType<typeof installHermeticApi>>
  // §79 Phase 10 console hygiene gate: collected from the start, asserted
  // ONCE at the end of the flow (after step 12) so the collection never
  // complicates the 2s hero-render budget of step 5.
  let consoleNoise: ConsoleNoiseRecord[]

  test.beforeEach(async ({ page }) => {
    hermetic = await installHermeticApi(page)
    consoleNoise = collectConsoleNoise(page)
  })

  test('paste, validate, run, investigate, copy bundle, no overflow', async ({ page }) => {
    // §73 step 1: paste request.
    await page.goto('/')

    // C8/C5 (FASE C): the pre-run workbench is glanceable — provider health
    // chips (§63, fixture says all available → ✓) and the honest empty
    // context bar, before anything runs.
    const chips = page.getByTestId('provider-health-chips')
    await expect(chips).toBeVisible()
    await expect(chips).toContainText('✓')
    await expect(page.getByTestId('execution-context-bar')).toContainText('No active execution')

    await page.getByRole('textbox', { name: 'Request JSON' }).fill(SYSTEM_ONE_REQUEST)

    // §73 step 2: auto-detect primitives — the compact mobile validation line
    // (§19.1) appears…
    const compactLine = page.getByRole('button', { name: /VALID · 3 QUESTIONS/ })
    await expect(compactLine).toBeVisible()
    await expect(compactLine).toContainText('Choice / Score / Noul')

    // …and the Bottom Drawer opens on tap with the per-question primitives.
    await compactLine.tap()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText('request_type')
    await expect(drawer).toContainText('CHOICE')
    await expect(drawer).toContainText('urgency')
    await expect(drawer).toContainText('SCORE')
    await expect(drawer).toContainText('refund_requested')
    await expect(drawer).toContainText('NOUL')
    await drawer.getByRole('button', { name: 'Close' }).tap()
    await expect(drawer).toBeHidden()

    // §73 step 3: select mode — the radio group offers exactly the three
    // canonical modes (emulator is checked by default; compare and evaluate
    // are enabled because the capabilities fixture says all providers run),
    // and the selection is EXERCISED: the run below sends evaluate mode.
    const modes = page.getByRole('radiogroup', { name: 'Execution mode' })
    await expect(modes.getByRole('radio', { name: 'Emulator' })).toBeChecked()
    await expect(modes.getByRole('radio', { name: 'Compare with JEV' })).toBeEnabled()
    await expect(modes.getByRole('radio', { name: 'Evaluate prediction' })).toBeEnabled()
    await modes.getByRole('radio', { name: 'Evaluate prediction' }).tap()
    await expect(modes.getByRole('radio', { name: 'Evaluate prediction' })).toBeChecked()
    // Advanced (§11): the independent LLM prediction rides along — the full
    // fixture snapshot carries its section, so the flow must actually SEND
    // advanced (R2: an independent section without the flag is a pair the
    // real API can never produce).
    const advanced = page.getByRole('checkbox', { name: 'Independent LLM prediction' })
    await expect(advanced).toBeEnabled()
    await advanced.tap()
    await expect(advanced).toBeChecked()

    // §73 step 4: Run in the SELECTED evaluate mode; the hermetic fixture
    // answers a compare-and-evaluate POST with the evaluate snapshot (jev +
    // comparison + ai_evaluation), so the hero assertions below pin the
    // radio -> request -> snapshot wiring. §73 step 5: read the Hero within
    // the §74 two-second budget; the intercepted POST answers instantly, so
    // this pins the RENDER budget, not the network. The POST-body assertion
    // runs AFTER the hero lands (R4: the body check itself must not gate the
    // render-timing measurement).
    const runButton = page.getByRole('button', { name: 'Run request' })
    await expect(runButton).toBeEnabled()
    const startedAt = Date.now()
    await runButton.tap()
    const hero = page.getByTestId('hero-result')
    await expect(hero).toBeVisible({ timeout: 2_000 })
    await expect(hero.getByText('✓ PREDICTION MATCHED JEV')).toBeVisible({ timeout: 2_000 })
    await expect(hero.getByText('JEV Fidelity')).toBeVisible({ timeout: 2_000 })
    expect(Date.now() - startedAt, 'hero headline + fidelity line must render within 2s').toBeLessThanOrEqual(2_000)
    expect(hermetic.lastExecutionBody()?.mode, 'the run must post the selected evaluate mode').toBe(
      'compare-and-evaluate'
    )
    // §11 Advanced exercised end-to-end: the posted body carries the
    // independent flag the snapshot's independent_openai section requires.
    expect(hermetic.lastExecutionBody()?.advanced).toEqual({ independent_openai_prediction: true })
    await expect(hero.getByText('3 / 3 questions aligned')).toBeVisible()

    // §73 step 6: inspect the compact question row (stretched link, §35).
    const results = page.getByTestId('question-results')
    await expect(results).toContainText('request_type')
    await expect(results).toContainText('CHOICE')

    // §73 step 7: open Investigación — the whole row deep-links with the
    // question already focused.
    await results.getByRole('link', { name: 'Inspect request_type' }).tap()
    await expect(page).toHaveURL(
      `/investigation?execution=${EXECUTION_ID}&question=request_type&primitive=choice`
    )

    // §73 step 8: inspect Why — the default view names the result and keeps
    // the focused question + primitive in the header.
    await expect(page.getByTestId('investigation-header')).toHaveText('Investigation · request_type · CHOICE')
    await expect(page.getByText('WHY THIS RESULT?')).toBeVisible()
    await expect(page.getByTestId('why-verdict')).toHaveText('✓ SAME DECISION')
    await expect(page.getByTestId('why-explanation')).toHaveText(
      'Both systems identify the request as billing.'
    )

    // §73 step 9: inspect the exact payload — switch to EVIDENCE and select
    // the exact Request source from the mobile source Bottom Drawer (§43).
    await page.getByTestId('switch-evidence').tap()
    const sourceTrigger = page.getByRole('button', { name: /^Source: / })
    await expect(sourceTrigger).toHaveText('Source: Request ▾')
    await sourceTrigger.tap()
    await page.getByRole('dialog').getByRole('button', { name: 'Request', exact: true }).tap()
    await expect(page.getByText('SYSTEM ONE REQUEST')).toBeVisible()
    await expect(page.getByTestId('evidence-view')).toContainText('I was charged twice on my invoice.')

    // §73 step 10: inspect the AI full exchange — select the AI Evaluation
    // source and expand the collapsed Full LLM Exchange (§45).
    await sourceTrigger.tap()
    await page.getByRole('dialog').getByRole('button', { name: 'AI Evaluation' }).tap()
    await expect(page.getByText('AI EVALUATION', { exact: true })).toBeVisible()
    const expandExchange = page.getByRole('button', { name: 'View full LLM exchange' })
    await expect(expandExchange).toHaveAttribute('aria-expanded', 'false')
    await expandExchange.tap()
    const exchange = page.getByTestId('full-llm-exchange')
    await expect(exchange).toBeVisible()
    await expect(exchange).toContainText('Configuration')
    await expect(exchange).toContainText('System instruction')
    await expect(exchange).toContainText('Raw model response')

    // §73 step 11: copy the analysis bundle (§45.2) and prove the clipboard
    // carries the per-question JSON for the focused question.
    await page.getByRole('button', { name: 'Copy analysis bundle' }).tap()
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
    const bundle = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
      execution_id: string
      question_name: string
    }
    expect(bundle.execution_id).toBe(EXECUTION_ID)
    expect(bundle.question_name).toBe('request_type')

    // §73 step 12: no horizontal overflow — on the investigation view and on
    // Principal (§16 gate).
    await expectNoDocumentOverflow(page, 'investigation at 375x667')
    await page.goto('/')
    await expectNoDocumentOverflow(page, 'principal at 375x667')

    // §79 Phase 10 console hygiene gate: the whole twelve-step flow must
    // leave the browser console free of errors, warnings and uncaught
    // exceptions (asserted once, after the last step). Drain first (D1) so
    // pending CDP events land before the synchronous assert — the drain
    // deliberately lives HERE only, never inside the 2s hero-budget path.
    await drainConsole(page)
    expectNoConsoleNoise(consoleNoise, 'mobile 375x667 twelve-step flow')
  })
})

// P30 (FB3): a recent-row tap hydrates Principal on the 375 viewport — the
// origin chip and the persisted hero land, and the hydrated surface keeps the
// §16 no-document-overflow contract. Compact companion to the desktop-class
// hydration.spec.ts (this file is Chromium-mobile-only by the project matrix).
test.describe('P30 hydration from recents on mobile', () => {
  let consoleNoise: ConsoleNoiseRecord[]
  let consolePage: Page

  test.beforeEach(async ({ page }) => {
    consolePage = page
    await installHermeticApi(page)
    consoleNoise = collectConsoleNoise(page)
  })

  test.afterEach(async () => {
    await drainConsole(consolePage)
    expectNoConsoleNoise(consoleNoise, `mobile hydration · ${test.info().titlePath.join(' › ')}`)
  })

  test('tapping a recent row hydrates Principal: chip + hero, no overflow at 375', async ({ page }) => {
    await page.goto('/')

    const row = page.getByRole('button', { name: 'Load execution run_e2e0001a — Evaluate prediction, Completed' })
    await expect(row).toBeVisible()
    await row.tap()

    await expect(page.getByTestId('loaded-from-origin')).toContainText('Loaded from execution run_e2e0001a')
    await expect(page.getByTestId('hero-result')).toContainText('✓ PREDICTION MATCHED JEV')

    // §16 gate: the hydrated surface introduces no horizontal scroll at 375.
    await expectNoDocumentOverflow(page, 'hydrated principal at 375x667')
  })
})

// P33 (FB6): history on 375 renders as CARDS — the §55 table is hidden below
// lg (hidden lg:block), so mobile never shows the inner horizontal scroll the
// wide table needs. Same row data, same §66 classification, and the same
// /operation deep links the table rows carry (never Investigación).
test.describe('P33 history cards on mobile (FB6)', () => {
  let consoleNoise: ConsoleNoiseRecord[]
  let consolePage: Page

  test.beforeEach(async ({ page }) => {
    consolePage = page
    await installHermeticApi(page)
    consoleNoise = collectConsoleNoise(page)
  })

  test.afterEach(async () => {
    await drainConsole(consolePage)
    expectNoConsoleNoise(consoleNoise, `history cards · ${test.info().titlePath.join(' › ')}`)
  })

  test('P33 history cards on mobile', async ({ page }) => {
    await page.goto('/history')

    // The card list is the mobile layout: one card per executions-list item.
    const cards = page.getByTestId('history-cards')
    await expect(cards).toBeVisible()
    await expect(cards.locator('li')).toHaveCount(5)

    // The §55 table is display:none at 375 (hidden lg:block) — Playwright,
    // unlike jsdom, evaluates the media query for real.
    await expect(page.getByTestId('history-table')).toBeHidden()

    // The first card navigates to Operación for that execution — the real id
    // of the first executions-list.json item (run_e2e0001a2b3c, which the
    // hermetic detail lane serves), exactly like the table row does.
    await cards.locator('li').first().locator('a').tap()
    await expect(page).toHaveURL('/operation?execution=run_e2e0001a2b3c')
  })
})

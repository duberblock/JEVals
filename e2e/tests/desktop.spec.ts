import { expect, test, type Page } from '@playwright/test'

import {
  collectConsoleNoise,
  type ConsoleNoiseRecord,
  COMPARE_ID,
  drainConsole,
  EMULATOR_ID,
  EXECUTION_ID,
  expectNoConsoleNoise,
  installHermeticApi,
  SYSTEM_ONE_REQUEST,
} from '../fixtures'

// §73 "E2E desktop": Principal stays compact, disclosure widgets are closed by
// default, Investigación preserves the question context after a deep link, and
// Operación shows status before telemetry. Runs in the desktop project
// (1280x720) against the hermetic API fixtures; visible text uses the EN
// dictionary (default locale).

// §79 Phase 10 console hygiene gate, whole-test scope: collect from the page
// before anything navigates, assert once after each test finishes.
let consoleNoise: ConsoleNoiseRecord[]
// The page is captured here (not via test.afterEach args, which Playwright
// does not provide) so afterEach can drain it before asserting.
let consolePage: Page

test.beforeEach(async ({ page }) => {
  consolePage = page
  consoleNoise = collectConsoleNoise(page)
})

test.afterEach(async () => {
  // D1 drain window (FIRST, before the synchronous assert): console events
  // the page already emitted may still be in flight over CDP — yield so they
  // land in consoleNoise before the gate runs.
  await drainConsole(consolePage)
  expectNoConsoleNoise(consoleNoise, `desktop · ${test.info().titlePath.join(' › ')}`)
})

test.describe('§73 desktop assertions', () => {
  let hermetic: Awaited<ReturnType<typeof installHermeticApi>>

  test.beforeEach(async ({ page }) => {
    hermetic = await installHermeticApi(page)
  })

  test('Principal remains compact after a run', async ({ page }) => {
    await page.goto('/')

    // C4 (FASE C): prototype header identity — the exact mixed-case 'JEVals'
    // wordmark (ADR-015 ruling 3: real casing preserved, no uppercase —
    // 'JEVALS'/'Jev' must fail) + '// PLAYGROUND'; the prototype's KERNEL
    // chip is banned vocabulary (F5).
    const banner = page.getByRole('banner')
    await expect(banner.getByText('JEVals', { exact: true })).toBeVisible()
    await expect(banner).toContainText('// PLAYGROUND')
    await expect(banner).not.toContainText('KERNEL')
    // ADR-015 follow-up pin (first e2e-touching cycle after the ADR): the
    // REAL release version badge (lib/version.ts, single source package.json)
    // is VISIBLE at desktop widths — hidden-below-sm (640) must never regress
    // into hidden-at-desktop. Regex, not a hardcoded number: the badge tracks
    // package.json and a bump must not break the pin.
    await expect(banner.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible()

    // C8 (FASE C): pre-run provider health (§63) — the fixture says all
    // three providers are available, so the chips carry ✓ (asserting the
    // glyph pins the tri-state wiring, not just the names).
    const chips = page.getByTestId('provider-health-chips')
    await expect(chips).toBeVisible()
    await expect(chips).toContainText('JEV')
    await expect(chips).toContainText('LLM')
    await expect(chips).toContainText('✓')

    // C5 (FASE C): honest idle context bar before any run.
    await expect(page.getByTestId('execution-context-bar')).toContainText('No active execution')

    await page.getByRole('textbox', { name: 'Request JSON' }).fill(SYSTEM_ONE_REQUEST)

    // Desktop (>= lg) renders the detection detail INLINE: the full
    // QUESTIONS DETECTED block with per-question name + primitive is visible
    // and the mobile compact drawer trigger stays hidden (§19.1).
    await expect(page.getByText('3 QUESTIONS DETECTED')).toBeVisible()
    await expect(page.getByText('CHOICE', { exact: true })).toBeVisible()
    await expect(page.getByText('SCORE', { exact: true })).toBeVisible()
    await expect(page.getByText('NOUL', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /VALID · 3 QUESTIONS/ })).toBeHidden()

    // Run in EVALUATE mode (a non-default exercise of the radio) so the rich
    // hero assertions below — JEV Fidelity plus the single AI summary line —
    // stay honest against the evaluate snapshot the hermetic fixture serves.
    const modes = page.getByRole('radiogroup', { name: 'Execution mode' })
    await modes.getByRole('radio', { name: 'Evaluate prediction' }).check()
    await expect(modes.getByRole('radio', { name: 'Evaluate prediction' })).toBeChecked()

    // Run to completed, then assert compactness of the results (§74):
    await page.getByRole('button', { name: 'Run request' }).click()
    const hero = page.getByTestId('hero-result')
    await expect(hero).toBeVisible()
    await expect(hero).toContainText('✓ PREDICTION MATCHED JEV')
    await expect(hero).toContainText('JEV Fidelity')
    // The AI evaluation contributes exactly ONE summary line (§32)…
    await expect(hero).toContainText('Judge: No material divergence') // C10: explicit Judge origin label

    // C5 (FASE C): the context bar carries the REAL persisted snapshot facts
    // in canonical vocabulary — this run posted evaluate mode, so the mode
    // label is the evaluate one (never the prototype's invented RPC/LATENCY
    // telemetry).
    const contextBar = page.getByTestId('execution-context-bar')
    await expect(contextBar).toContainText('Run ID')
    await expect(contextBar).toContainText('Evaluate prediction')

    // …so the structured reasoning block and the Judge's own summary sentence
    // never appear on Principal (no full AI reasoning by default).
    await expect(page.getByTestId('ai-reasoning')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'View AI reasoning' })).toHaveCount(0)
    await expect(page.getByText('Both systems agree on every question')).toHaveCount(0)

    // No full distributions by default (§74): the compact rows show values
    // ('billing', score, P(true)) — never the probability mass of the
    // non-selected criteria.
    const results = page.getByTestId('question-results')
    await expect(results).toContainText('billing → billing')
    await expect(results).toContainText('Same decision')
    await expect(results).not.toContainText('sales')
  })

  // R37 closure finding: with a STORED dark theme the server renders the
  // light icon in ThemeToggle while the client resolves dark — React 19
  // logs a hydration error on every load for such users. The §73 flows
  // never store a theme, so the console gate was blind to it; this pin
  // loads with theme=dark persisted and lets the shared afterEach noise
  // gate hold the mounted-guard honest.
  test('stored dark theme hydrates with a clean console (§73)', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'))
    await page.goto('/')

    await expect(page.getByTestId('provider-health-chips')).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/dark/)
    // The toggle itself must still cycle after the client takeover.
    await page.getByRole('button', { name: 'Toggle theme' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })

  // J1 (dual-review): the DEFAULT emulator mode must render the §74
  // emulator-honest hero — the hermetic fixture answers an emulator POST with
  // an emulator-only snapshot (no jev/comparison/ai_evaluation sections), so
  // this pins both the default radio wiring and the plain hero copy.
  test('default emulator run renders the honest plain hero (§74)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('textbox', { name: 'Request JSON' }).fill(SYSTEM_ONE_REQUEST)

    // The mode radio defaults to Emulator and stays untouched.
    const modes = page.getByRole('radiogroup', { name: 'Execution mode' })
    await expect(modes.getByRole('radio', { name: 'Emulator' })).toBeChecked()

    await page.getByRole('button', { name: 'Run request' }).click()
    const hero = page.getByTestId('hero-result')
    await expect(hero).toBeVisible()
    // hero.completed (EN dictionary), plural form for 3 questions.
    await expect(hero).toContainText('✓ Run completed · 3 questions')
    // Emulator-honest: no JEV Fidelity block and no AI line (§74).
    await expect(hero).not.toContainText('JEV Fidelity')
    await expect(hero).not.toContainText(/Judge:/) // C10: the AI line now carries the Judge prefix
    // The POST carried the default mode and the fixture honored it.
    expect(hermetic.lastExecutionBody()?.mode).toBe('emulator')

    // The question rows still render from the emulator answers (GET-only
    // surfaces untouched): single values, no JEV side.
    const results = page.getByTestId('question-results')
    await expect(results).toContainText('request_type')
    await expect(results).toContainText('CHOICE')
    await expect(results).toContainText('urgency')
    await expect(results).toContainText('refund_requested')
  })

  test('Details are not expanded by default on / and /operation', async ({ page }) => {
    // Principal: any <details> widget on the page starts closed.
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Principal', exact: true })).toBeVisible()
    expect(await page.locator('details[open]').count()).toBe(0)

    // Operación: the logs <details> (§61.5) renders collapsed — the summary
    // trigger is visible, the body is not.
    await page.goto(`/operation?execution=${EXECUTION_ID}`)
    const logs = page.getByTestId('operation-log')
    await expect(logs).toBeAttached()
    await expect(logs).not.toHaveAttribute('open', '')
    await expect(page.getByTestId('operation-log-body')).toBeHidden()
    expect(await page.locator('details[open]').count()).toBe(0)
  })

  test('Investigation preserves the question context after a deep link', async ({ page }) => {
    await page.goto(`/investigation?execution=${EXECUTION_ID}&question=urgency&primitive=score`)
    // §37 header: the deep-linked question (not the first one) stays focused
    // with its primitive segment.
    await expect(page.getByTestId('investigation-header')).toHaveText('Investigation · urgency · SCORE')
    await expect(page.getByText('WHY THIS RESULT?')).toBeVisible()
    // The focused question drives the WHY content (score verdict).
    await expect(page.getByTestId('why-verdict')).toHaveText('✓ SAME LEVEL: high')
  })

  // P34 (FB7): the discrete global strip under the §37 header — the SAME §22
  // derivation as the Principal hero (single-sourced through heroConclusion),
  // plus the run mode and the link to hydrated Principal (/?execution=<id>,
  // the P30 mechanism). §36 intact: secondary context, WHY|EVIDENCE stays
  // the first level. The compare fixture: 3/3 aligned, fidelity 0.95.
  test('Investigation shows the discrete global strip and links to hydrated Principal (P34/FB7)', async ({ page }) => {
    await page.goto(`/investigation?execution=${COMPARE_ID}&question=request_type&primitive=choice`)
    const strip = page.getByTestId('investigation-global-strip')
    await expect(strip).toBeVisible()
    // The exact §22 hero words, same derivation as Principal — never a
    // second one.
    await expect(strip).toContainText('✓ PREDICTION MATCHED JEV')
    await expect(strip).toContainText('95% JEV Fidelity')
    await expect(strip).toContainText('3 / 3 questions aligned')

    // A real link: navigating lands on Principal ALREADY HYDRATED through
    // the P30 mechanism — chip plus hero, no re-run.
    await page.getByRole('link', { name: 'View in Principal' }).click()
    await expect(page).toHaveURL(new RegExp(`\\?execution=${COMPARE_ID}`))
    await expect(page.getByTestId('loaded-from-origin')).toBeVisible()
    await expect(page.getByTestId('hero-result')).toBeVisible()
  })

  // P37/FB10: an emulator-only run frames the Emulator answer as THE result —
  // WHY marks it with an explicit answer label, the no-JEV note is reworded
  // secondary context, and Evidence captions the run-wide Emulator payload.
  test('emulator-only run marks the Emulator answer as THE result (P37/FB10)', async ({ page }) => {
    await page.goto(`/investigation?execution=${EMULATOR_ID}&question=request_type&primitive=choice`)

    await expect(page.getByTestId('why-answer-label')).toHaveText('Emulator answer')
    await expect(page.getByTestId('why-answer-label')).toBeVisible()
    // The secondary reworded note:
    await expect(page.getByText('Emulator-only run: the JEV comparison does not apply.')).toBeVisible()
    // Evidence reframes the run-wide Emulator payload:
    await page.getByTestId('switch-evidence').click()
    await page.getByTestId('source-select').selectOption('emulator')
    await expect(page.getByText('The Emulator answer for this run')).toBeVisible()
  })

  // P38/FB11 (owner ruling): the Noul verdict is COMPOSED — the §27 geometry
  // plus the RESULT direction, derived from the midpoint categories the API
  // persists in the comparison components (single source; the web never
  // re-derives the classification). The ✓ marker comes from the persisted
  // comparison.aligned. 0.5 is ONLY the mathematical midpoint: a probability
  // AT .5 renders "midpoint: direction undefined" — never a side.
  test('Investigation renders the composed noul verdict with direction (P38/FB11)', async ({ page }) => {
    await page.goto(`/investigation?execution=${EXECUTION_ID}&question=refund_requested&primitive=noul`)

    // The fixture: .082/.119 — both strictly below .5 (categories -1/-1),
    // aligned true → ✓ marker, same-direction result.
    await expect(page.getByTestId('why-verdict')).toHaveText('✓ BOTH < .5 — same direction')
    await expect(page.getByTestId('why-explanation')).toContainText(
      'same side of the probability midpoint — same direction'
    )
  })

  // P35/FB8 (§42 amendment, owner ruling / ADR-022): the focused question's
  // OWN §67 reason excerpt replaces the global overall summary inline; the
  // full structured output stays behind the disclosure (§38: the clamp is
  // the boundary between excerpt and full rationale).
  test('Investigation shows the focused question AI reason excerpt inline (P35/FB8)', async ({ page }) => {
    await page.goto(`/investigation?execution=${EXECUTION_ID}&question=request_type&primitive=choice`)
    const block = page.getByTestId('why-ai')
    await expect(block).toBeVisible()
    // The focused question's OWN reason replaces the global summary inline.
    await expect(page.getByTestId('ai-question-excerpt')).toHaveText('Both select billing.')
    await expect(block).not.toContainText('Both systems agree on every question')
    // The full §67 output stays behind the disclosure (§38/§42 amendment).
    await page.getByRole('button', { name: 'View AI reasoning' }).click()
    await expect(page.getByTestId('ai-reasoning')).toBeVisible()
    await expect(page.getByTestId('ai-reasoning')).toContainText('Both select billing.')
  })

  test('Operación shows status before telemetry', async ({ page }) => {
    await page.goto(`/operation?execution=${EXECUTION_ID}`)
    await expect(page.getByTestId('summary-panel')).toBeVisible()

    // §61.1/§72: the STATUS row is the first row of the first-viewport
    // summary, ahead of every telemetry row (DOM order).
    const statusFirst = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="summary-row-"]'))
      const status = document.querySelector<HTMLElement>('[data-testid="summary-row-status"]')
      if (!status || rows.length === 0) return false
      return rows[0] === status
    })
    expect(statusFirst, 'summary-row-status must be the first summary row in DOM order').toBe(true)
    await expect(page.getByTestId('summary-row-status')).toContainText('✓ Completed')
  })
})

test.describe('§73 desktop — history integrity', () => {
  test('history renders each execution exactly once (no StrictMode duplication)', async ({ page }) => {
    await installHermeticApi(page)
    await page.goto('/history')

    // Next dev double-mounts effects under React StrictMode; the initial
    // load must REPLACE, never append (STEP 9 E2E Wave A finding, now fixed
    // and pinned here so it cannot regress).
    const rows = page.locator('table tbody tr')
    await expect(rows).toHaveCount(5)
    const ids = await rows.evaluateAll((cells) =>
      cells.map((row) => row.querySelector('a')?.getAttribute('href'))
    )
    expect(new Set(ids).size, 'every history row must be a unique execution').toBe(ids.length)
  })
})

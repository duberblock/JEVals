import { expect, test, type Page } from '@playwright/test'

import {
  collectConsoleNoise,
  type ConsoleNoiseRecord,
  drainConsole,
  expectNoConsoleNoise,
  EXECUTION_ID,
  installHermeticApi,
} from '../fixtures'

// P30 (FB3, docs/feedback-v1-ux.md) e2e: clicking a recent-executions row
// hydrates Principal with that execution's FULL persisted snapshot (the detail
// fixture served by id) — the hero renders the persisted conclusion, the
// editor gets the request JSON back, the origin chip names the execution, and
// Clear resets the surface. Hydration is read-only: no run POST ever fires
// (§50 — a re-POST would duplicate executions). Written from the existing spec
// patterns (streaming.spec.ts); NOT run in the sandbox (no browsers) — the
// orchestrator's demo gate owns the run.

// §79 Phase 10 console hygiene gate, whole-test scope (same shape as the
// other specs: collect from the page before anything navigates, assert once
// after each test finishes).
let consoleNoise: ConsoleNoiseRecord[]
let consolePage: Page

test.beforeEach(async ({ page }) => {
  consolePage = page
  consoleNoise = collectConsoleNoise(page)
})

test.afterEach(async () => {
  // D1 drain window (FIRST, before the synchronous assert).
  await drainConsole(consolePage)
  expectNoConsoleNoise(consoleNoise, `hydration · ${test.info().titlePath.join(' › ')}`)
})

test.describe('P30 recents hydrate Principal', () => {
  test('a recent row click loads the execution into Principal and Clear resets it', async ({ page }) => {
    const hermetic = await installHermeticApi(page)
    await page.goto('/')

    // The recents list (fixture) renders the compare-and-evaluate row first.
    const row = page.getByRole('button', { name: 'Load execution run_e2e0001a — Evaluate prediction, Completed' })
    await expect(row).toBeVisible()

    // §16: the demoted §35 deep-link keeps a ≥44px pointer target on every
    // viewport (dual-review I6 — the size was CSS-only and unpinned).
    const inspect = page.getByRole('link', {
      name: 'View in Investigation run_e2e0001a — Evaluate prediction, Completed',
    })
    const inspectBox = await inspect.boundingBox()
    expect(inspectBox).not.toBeNull()
    expect(inspectBox!.height).toBeGreaterThanOrEqual(44)
    expect(inspectBox!.width).toBeGreaterThanOrEqual(44)

    // One click hydrates Principal from the detail fixture…
    await row.click()

    // …the hero renders the persisted conclusion with its fidelity…
    const hero = page.getByTestId('hero-result')
    await expect(hero).toBeVisible()
    await expect(hero).toContainText('✓ PREDICTION MATCHED JEV')
    await expect(hero).toContainText('95%')

    // P46 (W3 re-scope): the landing hydration collapsed the input block
    // behind the request disclosure — the one-line summary is the only
    // visible control, and it is honest about the restored request: the live
    // §19.1 verdict's question count plus the snapshot's mode.
    const requestToggle = page.getByTestId('request-toggle')
    await expect(requestToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('textbox', { name: 'Request JSON' })).toHaveCount(0)
    await expect(page.getByTestId('request-summary')).toContainText('3 questions')

    // …the editor got the snapshot's request JSON back — behind the
    // disclosure, so expand at will to see it (the ORIGINAL assertion runs
    // unchanged once the block is open)…
    await requestToggle.click()
    await expect(requestToggle).toHaveAttribute('aria-expanded', 'true')
    const editor = page.getByRole('textbox', { name: 'Request JSON' })
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue(/"state"/)

    // …and the origin chip names the loaded execution (short id).
    const chip = page.getByTestId('loaded-from-origin')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('Loaded from execution run_e2e0001a')

    // §50: hydration NEVER re-runs — no execution POST was made.
    expect(hermetic.lastExecutionBody()).toBeUndefined()

    // Clear resets the whole surface: editor, result, chip. P46: the block is
    // already expanded here (the editor assertion above opened it), and Clear
    // itself re-expands it — the pre-run state has nothing to cede.
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(editor).toHaveValue('')
    await expect(requestToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('hero-result')).toBeHidden()
    await expect(page.getByTestId('loaded-from-origin')).toBeHidden()
  })
})

// P47 (c) e2e: direct investigation entry hydrates from the persisted
// snapshot, and the request's scenario (snapshot.request.state — the
// persisted path the plan pinned) rides ABOVE the §37 header in the ONE
// shared collapsed ScenarioBox. Same fixture string the Principal (b)
// assertions pin in streaming.spec.ts.
test.describe('P47 investigation scenario box', () => {
  test('the scenario rides above the investigation header from the persisted snapshot', async ({ page }) => {
    await installHermeticApi(page)
    await page.goto(`/investigation?execution=${EXECUTION_ID}&question=request_type&primitive=choice`)

    const header = page.getByTestId('investigation-header')
    const box = page.getByTestId('scenario-box')
    await expect(header).toBeVisible()
    await expect(box).toBeVisible()

    // Above the selected question's title: the box's top edge sits above
    // the header's.
    const boxTop = (await box.boundingBox())!.y
    const headerTop = (await header.boundingBox())!.y
    expect(boxTop).toBeLessThan(headerTop)

    // Collapsed by default (§38 idiom); expanding reveals the fixture's
    // exact persisted state.
    const trigger = box.getByRole('button', { name: 'View scenario' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await expect(box.getByTestId('scenario-content')).toContainText('I was charged twice on my invoice.')
  })
})

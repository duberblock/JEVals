import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { EXECUTION_ID, installHermeticApi, SYSTEM_ONE_REQUEST } from '../fixtures'

// A6/C6 closure captures (plan docs/plan.md §FASE A A6 + §FASE C C6): one
// screenshot per canonical surface per viewport against the hermetic
// fixtures, plus the Principal dark-mode variant and the mobile above-the-
// fold crop. The spec is SKIP-BY-DEFAULT — it only runs when
// PARITY_CAPTURE_DIR points at an output directory, so the strict e2e gate
// (demo-gate) never depends on it:
//
//   PARITY_CAPTURE_DIR=/tmp/parity npx playwright test parity-captures \
//     --project=desktop                            # 1280x720
//   PARITY_CAPTURE_DIR=/tmp/parity PARITY_VIEWPORT=375x667 \
//     npx playwright test parity-captures --project=desktop   # mobile size
//
// PARITY_VIEWPORT overrides the viewport from inside the spec (the test
// runner has no --viewport-size flag); files are named by VIEWPORT WIDTH,
// not project. The mobile project's testMatch is mobile.spec.ts only
// (routing lives in the config, per its own rule), so mobile-size captures
// ride the desktop project — an out-of-gate capture concern, never a gate
// routing change.
const CAPTURE_DIR = process.env.PARITY_CAPTURE_DIR
test.skip(!CAPTURE_DIR, 'capture-only spec: set PARITY_CAPTURE_DIR to produce A6 parity captures')

if (process.env.PARITY_VIEWPORT) {
  const [width, height] = process.env.PARITY_VIEWPORT.split('x').map(Number)
  test.use({ viewport: { width, height } })
}

const OUTPUT = CAPTURE_DIR ?? '/tmp/parity-captures'

async function shoot(page: import('@playwright/test').Page, name: string, fullPage: boolean) {
  // web fonts paint late on the dev server; wait for them so the captures
  // show the real typography (A4), not the fallback face.
  await page.evaluate(() => document.fonts.ready)
  const file = path.join(OUTPUT, name)
  await page.screenshot({ fullPage, path: file })
}

function viewportTag(page: import('@playwright/test').Page) {
  return String(page.viewportSize()?.width ?? 0)
}

test('principal — pre-run and post-run (evaluate) captures', async ({ page }) => {
  await installHermeticApi(page)
  const project = viewportTag(page)

  await page.goto('/')
  await expect(page.getByTestId('provider-health-chips')).toBeVisible()
  await expect(page.getByTestId('execution-context-bar')).toContainText('No active execution')
  await shoot(page, `principal-prerun-${project}.png`, true)

  await page.getByRole('textbox', { name: 'Request JSON' }).fill(SYSTEM_ONE_REQUEST)
  const modes = page.getByRole('radiogroup', { name: 'Execution mode' })
  await modes.getByRole('radio', { name: 'Evaluate prediction' }).check()
  await page.getByRole('button', { name: 'Run request' }).click()
  await expect(page.getByTestId('hero-result')).toBeVisible()
  await expect(page.getByTestId('execution-context-bar')).toContainText('Run ID')

  // The C9 completion scroll is SMOOTH (prefers-reduced-motion absent) and
  // the ~1000px travel takes longer than a fixed timeout. R37 round 2: the
  // pin is GEOMETRIC and occlusion-aware — the hero's top must rest at or
  // below the sticky h-14 header (56px); Math.ceil makes it conservative
  // (a fractional 56.4px occlusion cannot round down to a pass). This poll
  // also implies the scroll finished, so no separate scrollY poll exists.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Math.ceil(
              (document.querySelector('[data-testid="hero-result"]') as HTMLElement).getBoundingClientRect().top
            )
        ),
      { timeout: 5_000 }
    )
    .toBeGreaterThanOrEqual(56)

  // Above-the-fold crop (the 3-second glance rule is judged on the first
  // viewport, mobile especially) + the full-page capture for C6 diffs.
  await shoot(page, `principal-postrun-${project}-fold.png`, false)
  await shoot(page, `principal-postrun-${project}.png`, true)
})

test('principal — post-run dark (desktop viewport only)', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1000, 'dark variant captured once, at desktop')
  await installHermeticApi(page)
  // next-themes reads localStorage before hydration; set it before any
  // script of the app runs so no light-theme flash pollutes the capture.
  await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'))

  await page.goto('/')
  await page.getByRole('textbox', { name: 'Request JSON' }).fill(SYSTEM_ONE_REQUEST)
  const modes = page.getByRole('radiogroup', { name: 'Execution mode' })
  await modes.getByRole('radio', { name: 'Evaluate prediction' }).check()
  await page.getByRole('button', { name: 'Run request' }).click()
  await expect(page.getByTestId('hero-result')).toBeVisible()

  await shoot(page, 'principal-postrun-desktop-dark.png', true)
})

test('investigation — WHY capture via the canonical deep link', async ({ page }) => {
  await installHermeticApi(page)

  await page.goto(`/investigation?execution=${EXECUTION_ID}&question=urgency&primitive=score`)
  await expect(page.getByTestId('investigation-header')).toHaveText('Investigation · urgency · SCORE')
  await shoot(page, `investigation-${viewportTag(page)}.png`, true)
})

test('operation — executions browser capture', async ({ page }) => {
  await installHermeticApi(page)

  await page.goto('/operation')
  // 'PREVIOUS EXECUTIONS' is a desktop-only label — anchor on the page
  // heading, which exists at every viewport, then let the fixtures settle.
  await expect(page.getByRole('heading', { name: 'Operation', level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await shoot(page, `operation-${viewportTag(page)}.png`, true)
})

// Ensure the output directory exists before any test writes into it (the
// gate never runs this spec, so the mkdir cannot race the strict suite).
test.beforeAll(() => {
  fs.mkdirSync(OUTPUT, { recursive: true })
})

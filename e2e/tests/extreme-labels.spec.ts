import { expect, test, type Page } from '@playwright/test'

import {
  collectConsoleNoise,
  type ConsoleNoiseRecord,
  drainConsole,
  expectNoConsoleNoise,
  installHermeticApi,
  EXTREME_ID as EXTREME_RUN_ID,
} from '../fixtures'
import { EXTREME_LABEL } from '../../apps/web/tests/component/extreme-labels'

// P36/FB9: the owner's no-spaces worst case, served by the dedicated extreme
// fixture (run_extreme00001), at the narrowest viewport. The label must be
// VISIBLE on WHY and the document must not overflow (§16) — wrap-anywhere +
// min-w-0 hardening across the request-derived surfaces. Runs on the
// desktop+firefox projects (project testMatch routing); the viewport is
// shrunk to the 375x667 mobile baseline because the box the owner reported
// breaking is the mobile one.

// §79 Phase 10 console hygiene gate, whole-test scope (desktop.spec pattern).
let consoleNoise: ConsoleNoiseRecord[]
let consolePage: Page

test.beforeEach(async ({ page }) => {
  consolePage = page
  consoleNoise = collectConsoleNoise(page)
})

test.afterEach(async () => {
  // D1 drain window: pending CDP events land before the synchronous assert.
  await drainConsole(consolePage)
  expectNoConsoleNoise(consoleNoise, `extreme-labels · ${test.info().titlePath.join(' › ')}`)
})

test('extreme no-spaces label renders on WHY at 375x667 without document overflow', async ({ page }) => {
  await installHermeticApi(page)
  await page.setViewportSize({ width: 375, height: 667 })

  await page.goto(
    `/investigation?execution=${EXTREME_RUN_ID}&question=${encodeURIComponent(EXTREME_LABEL)}&primitive=choice`
  )
  await expect(page.getByTestId('why-values')).toBeVisible()

  // The extreme label renders honestly (the Emulator choice value). Scoped
  // to the WHY values block: the question name is ALSO the extreme token, so
  // it matches the question-selector button and the §37 header's joined
  // string too (strict mode would see three). Exact pins the value itself.
  await expect(page.getByTestId('why-values').getByText(EXTREME_LABEL, { exact: true })).toBeVisible()

  // §16 gate (sweep probe pattern): no document-level horizontal scroll.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `extreme label overflowed the 375 viewport by ${overflow}px`).toBeLessThanOrEqual(0)
})

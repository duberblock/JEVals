import { expect, test } from '@playwright/test'

import { collectConsoleNoise, drainConsole, expectNoConsoleNoise, installHermeticApi } from '../fixtures'

// The three canonical navigation sections (plan section 3) render in the
// header navigation on desktop. exact avoids matching the recent-executions
// deep links, whose aria-labels contain the word 'Investigation'.
test('renders the three canonical navigation sections', async ({ page }) => {
  await installHermeticApi(page)
  const noise = collectConsoleNoise(page)
  await page.goto('/')

  await expect(page.getByRole('link', { name: 'Principal', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Investigation', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Operation', exact: true })).toBeVisible()

  // §79 Phase 10 console hygiene gate (whole-test scope). Drain first (D1):
  // pending CDP events must land before the synchronous assert.
  await drainConsole(page)
  expectNoConsoleNoise(noise, 'navigation sections on desktop')
})

// FB4 (R42/P31): /how-it-works is reachable from the header's utility zone —
// OUTSIDE the primary nav, which keeps exactly the three canonical sections
// (plan §3). Desktop breakpoint: the header link is md+ only, mirroring
// MainNav; the mobile access point is Principal's recents empty state.
test('the how-it-works utility link lives in the header outside the primary nav', async ({ page }) => {
  await installHermeticApi(page)
  const noise = collectConsoleNoise(page)
  await page.goto('/')

  // §3 intact: the primary nav still carries EXACTLY three links.
  const primaryNav = page.getByRole('navigation', { name: 'Primary', exact: true })
  await expect(primaryNav.getByRole('link')).toHaveCount(3)

  // The utility link is visible in the header (desktop viewport) and routes
  // to the static page.
  const utilityLink = page.getByRole('link', { name: 'How it works' })
  await expect(utilityLink).toBeVisible()
  await utilityLink.click()
  await expect(page).toHaveURL(/\/how-it-works$/)
  await expect(page.getByRole('heading', { name: 'How it works', exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="how-it-works-steps"] li')).toHaveCount(6)

  // §79 Phase 10 console hygiene gate (whole-test scope). Drain first (D1):
  // pending CDP events must land before the synchronous assert.
  await drainConsole(page)
  expectNoConsoleNoise(noise, 'how-it-works utility link in header')
})

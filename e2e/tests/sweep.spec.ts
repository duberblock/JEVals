import { expect, test, type Locator, type Page } from '@playwright/test'

import { collectConsoleNoise, drainConsole, EXECUTION_ID, expectNoConsoleNoise, installHermeticApi } from '../fixtures'

// §79 Phase 9 breakpoint sweep: 375x667 first, then 640x800, 768x1024,
// 1024x1366, 1280x800, 1536x960 — across the four surfaces. Checks per
// breakpoint: (a) no document-level horizontal overflow (§16 gate), (b)
// navigation visible and singular (bottom nav below md, top nav at >= md),
// (c) a clean browser console for every surface at every viewport (§79
// Phase 10), and at 375 (d) the EN/ES selector is reachable in the header
// and NOT duplicated in the bottom nav (§15.8).

const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 640, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 1366 },
  { width: 1280, height: 800 },
  { width: 1536, height: 960 },
] as const

// Tailwind md breakpoint (768px): MobileNav is md:hidden, MainNav is
// hidden md:flex, so 768 already counts as desktop layout.
const MD = 768

type Surface = {
  name: string
  path: string
  // Something concrete to wait for so overflow is measured on rendered
  // content, not on a loading placeholder.
  ready: (page: Page) => Locator
}

const SURFACES: Surface[] = [
  {
    name: 'principal',
    path: '/',
    ready: (page) => page.getByRole('heading', { name: 'Principal', exact: true }),
  },
  {
    name: 'investigation',
    path: `/investigation?execution=${EXECUTION_ID}&question=request_type&primitive=choice`,
    ready: (page) => page.getByTestId('investigation-header'),
  },
  {
    name: 'operation',
    path: `/operation?execution=${EXECUTION_ID}`,
    ready: (page) => page.getByTestId('operation-central-header'),
  },
  {
    name: 'history',
    path: '/history',
    // P33/FB6 dual layout: the results container is visible at EVERY
    // viewport — below lg the table stays in the DOM but display-none
    // (the cards render), so it can no longer be the ready condition.
    ready: (page) => page.getByTestId('history-results'),
  },
  // FB4 (R42/P31): the static walkthrough. The page must make ZERO fetches —
  // the hermetic API answers 500 to any call, so a stray request would also
  // surface here as console noise (§79 Phase 10 gate).
  {
    name: 'how-it-works',
    path: '/how-it-works',
    ready: (page) => page.getByRole('heading', { name: 'How it works' }),
  },
]

for (const viewport of VIEWPORTS) {
  test(`no overflow and singular navigation at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await installHermeticApi(page)
    const noise = collectConsoleNoise(page)
    // How many noise records were already asserted by a previous surface, so
    // each surface is gated on ITS OWN noise only.
    let noiseSeen = 0
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    for (const surface of SURFACES) {
      await page.goto(surface.path)
      await expect(surface.ready(page), `${surface.name}: surface never became ready`).toBeVisible()

      // D1 drain window: yield so console events this surface emitted during
      // load/render are dispatched over CDP BEFORE the slice below — records
      // arriving during the drain attribute to the surface that produced them.
      await drainConsole(page)

      // (a) §16 gate: no document-level horizontal scroll.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect.soft(overflow, `${surface.name} at ${viewport.width}: horizontal overflow of ${overflow}px`).toBeLessThanOrEqual(0)

      // (b) Navigation is visible and singular at this breakpoint. exact is
      // required: 'Primary' is a substring of 'Mobile primary'.
      const bottomNav = page.getByRole('navigation', { name: 'Mobile primary', exact: true })
      const topNav = page.getByRole('navigation', { name: 'Primary', exact: true })
      if (viewport.width < MD) {
        await expect.soft(bottomNav, `${surface.name} at ${viewport.width}: bottom nav must show below md`).toBeVisible()
        await expect.soft(topNav, `${surface.name} at ${viewport.width}: top nav must hide below md`).toBeHidden()
      } else {
        await expect.soft(topNav, `${surface.name} at ${viewport.width}: top nav must show at >= md`).toBeVisible()
        await expect.soft(bottomNav, `${surface.name} at ${viewport.width}: bottom nav must hide at >= md`).toBeHidden()
      }

      // (c) §79 Phase 10 console hygiene gate: only the noise accumulated by
      // THIS surface visit, soft so one noisy surface cannot hide the rest.
      // slice -> assert -> cursor update with no await in between, so no
      // late-arriving record can slip past the cursor mid-assert.
      expectNoConsoleNoise(
        noise.slice(noiseSeen),
        `${surface.name} at ${viewport.width}x${viewport.height}`,
        { soft: true }
      )
      noiseSeen = noise.length
    }

    // D2 sweep tail: noise arriving after the last surface's slice (e.g. a
    // late timer firing post-drain) must never stay silently unasserted —
    // drain once more and soft-assert everything the cursor hasn't consumed.
    await drainConsole(page)
    expectNoConsoleNoise(noise.slice(noiseSeen), `sweep tail at ${viewport.width}x${viewport.height}`, {
      soft: true,
    })
  })
}

test('§15.8 at 375x667 the EN/ES selector is reachable in the header and not duplicated', async ({ page }) => {
  await installHermeticApi(page)
  const noise = collectConsoleNoise(page)
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Principal', exact: true })).toBeVisible()

  // The selector is visible in the header with both locales offered.
  const languageSelector = page.getByRole('combobox', { name: 'Language' })
  await expect(languageSelector).toBeVisible()
  await expect(languageSelector.locator('option', { hasText: 'EN' })).toBeAttached()
  await expect(languageSelector.locator('option', { hasText: 'ES' })).toBeAttached()

  // The bottom navigation shows the three canonical sections and does NOT
  // duplicate the language controls (§15.8).
  const bottomNav = page.getByRole('navigation', { name: 'Mobile primary', exact: true })
  await expect(bottomNav).toBeVisible()
  await expect(bottomNav.getByRole('combobox')).toHaveCount(0)
  await expect(bottomNav.getByText('EN', { exact: true })).toHaveCount(0)
  await expect(bottomNav).toContainText('Principal')
  await expect(bottomNav).toContainText('Investigation')
  await expect(bottomNav).toContainText('Operation')

  // §79 Phase 10 console hygiene gate (whole-test scope). Drain first (D1):
  // pending CDP events must land before the synchronous assert.
  await drainConsole(page)
  expectNoConsoleNoise(noise, '§15.8 EN/ES selector check at 375x667')
})

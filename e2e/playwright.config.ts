import { defineConfig, devices } from '@playwright/test'

// Three projects (plan section 79 Phase 9 mobile+desktop, Phase 10 second
// engine): the mobile 375x667 baseline first, then desktop on Chromium, then
// desktop-class specs again on Firefox for engine diversity. The web app
// boots via the Next.js dev server; every /api/v1/** call is intercepted
// hermetically by the specs (see fixtures/index.ts).
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  timeout: 60_000,
  retries: 1,
  reporters: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
    navigationTimeout: 30_000
  },
  webServer: {
    command: 'cd ../apps/web && npm run dev -- --hostname 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      // Mobile baseline (plan sections 15.8, 16, 73 "E2E mobile 375x667").
      name: 'mobile',
      testMatch: 'mobile.spec.ts',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      }
    },
    {
      // Desktop assertions (plan section 73 "E2E desktop") plus the Phase 9
      // breakpoint sweep, which loops setViewportSize inside the test.
      name: 'desktop',
      testIgnore: 'mobile.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      // Phase 10 second browser engine: the same desktop-class specs
      // (desktop + navigation + sweep) re-run on Firefox. Firefox is the
      // ruling because it is (a) genuinely independent of Chromium at the
      // engine level — Gecko vs Blink, so rendering/ARIA/console differences
      // surface real demo risk — and (b) fully hermetic offline: the pinned
      // @playwright/test 1.63.0 expects firefox build 1543, which is already
      // in the local Playwright browser cache (no download). WebKit would
      // require a network download and is out of scope.
      //
      // mobile.spec.ts stays Chromium-only and is excluded here via the same
      // project-level testIgnore the desktop project uses: it asserts
      // clipboard context permissions (`browserContext.grantPermissions`),
      // a Chromium-only capability Playwright does not support on Firefox,
      // and it relies on mobile emulation (isMobile/hasTouch), which has no
      // Firefox equivalent. Routing between projects is done ONLY through
      // project-level testMatch/testIgnore — never by editing specs to skip.
      name: 'firefox',
      testIgnore: 'mobile.spec.ts',
      use: {
        browserName: 'firefox',
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 }
      }
    }
  ]
})

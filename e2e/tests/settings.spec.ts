import { expect, test } from '@playwright/test'

import { collectConsoleNoise, drainConsole, expectNoConsoleNoise, installHermeticApi, type ConsoleNoiseRecord } from '../fixtures'
import type { Page } from '@playwright/test'

// The provider-configuration screen: reachable from the header's utility
// zone beside the help link, renders the four integration cards from the
// settings view, and saves through the PUT lane (hermetic route table).
let consoleNoise: ConsoleNoiseRecord[]
let consolePage: Page

test.beforeEach(async ({ page }) => {
  consolePage = page
  consoleNoise = collectConsoleNoise(page)
})

test.afterEach(async () => {
  await drainConsole(consolePage)
  expectNoConsoleNoise(consoleNoise, `settings · ${test.info().titlePath.join(' › ')}`)
})

test.describe('provider settings screen', () => {
  test('the header link opens the four provider cards and a save round-trips', async ({ page }) => {
    await installHermeticApi(page)

    await page.goto('/')
    await page.getByTestId('header-settings-link').click()
    await expect(page).toHaveURL(/\/settings$/)

    const emulator = page.getByTestId('settings-card-emulator')
    await expect(emulator).toBeVisible()
    await expect(page.getByTestId('settings-card-jev')).toBeVisible()
    await expect(page.getByTestId('settings-card-judge')).toBeVisible()
    await expect(page.getByTestId('settings-card-independent')).toBeVisible()
    // Availability honesty + the encrypted-at-rest key status read back.
    await expect(page.getByTestId('settings-emulator-availability')).toContainText('✓ Available')
    await expect(page.getByTestId('settings-emulator-status')).toContainText('encrypted at rest')

    // A save round-trip through the PUT lane (endpoint field → Save).
    const judge = page.getByTestId('settings-card-judge')
    await judge.getByLabel('Endpoint').fill('http://localhost:11434/v1')
    await judge.getByRole('button', { name: 'Save' }).click()
    await expect(judge.getByTestId('settings-judge-status')).toContainText('Saved')
  })
})

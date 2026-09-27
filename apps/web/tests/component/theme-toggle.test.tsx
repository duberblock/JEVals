import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from 'next-themes'

import { ThemeToggle } from '../../components/layout/theme-toggle'
import { en } from '../../lib/i18n/en'

// jsdom does not implement matchMedia; next-themes needs it (test-only stub).
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

describe('ThemeToggle (dark mode wiring)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ''
  })

  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ''
  })

  it('renders an accessible toggle button with sun and moon icons', () => {
    render(<ThemeToggle dictionary={en.theme} />)
    const button = screen.getByRole('button', { name: 'Toggle theme' })
    // lucide icons render as SVGs.
    expect(button.querySelector('svg')).toBeInTheDocument()
  })

  // §16/§72: the toggle is always reachable in the header — its touch target
  // must be ~44px on mobile (size-11 = 2.75rem).
  it('keeps a ~44px touch target on mobile', () => {
    render(<ThemeToggle dictionary={en.theme} />)

    expect(screen.getByRole('button', { name: 'Toggle theme' })).toHaveClass('size-11')
  })

  it('cycles the html element class between light and dark', async () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeToggle dictionary={en.theme} />
      </ThemeProvider>
    )
    await waitFor(() => {
      expect(document.documentElement.classList.contains('light')).toBe(true)
    })

    const button = screen.getByRole('button', { name: 'Toggle theme' })

    act(() => {
      button.click()
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('theme')).toBe('dark')

    act(() => {
      button.click()
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem('theme')).toBe('light')
  })
})

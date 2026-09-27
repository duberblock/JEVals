import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ThemeProvider } from 'next-themes'

// jsdom does not implement matchMedia; next-themes needs it for system theme
// resolution. Browsers always provide it, so stubbing is test-only.
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

describe('ThemeProvider smoke test', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ''
  })

  it('renders its children', () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="system">
        <p>App content</p>
      </ThemeProvider>
    )
    expect(screen.getByText('App content')).toBeInTheDocument()
  })

  it('applies the resolved theme class to the html element', async () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="dark">
        <p>App content</p>
      </ThemeProvider>
    )
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })
})

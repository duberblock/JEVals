import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MobileNav } from '../../components/layout/mobile-nav'
import { LOCALE_CHANGED_EVENT, LOCALE_STORAGE_KEY } from '../../lib/i18n/use-locale'

describe('MobileNav', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('renders the three canonical top-level sections', () => {
    render(<MobileNav />)

    expect(screen.getByRole('link', { name: 'Principal' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Investigation' })).toHaveAttribute('href', '/investigation')
    expect(screen.getByRole('link', { name: 'Operation' })).toHaveAttribute('href', '/operation')
    expect(screen.queryByRole('link', { name: 'History' })).not.toBeInTheDocument()
  })

  // The header's gear/help links are lg-only: this utilities row is the
  // mobile door into Settings and the walkthrough.
  it('exposes Settings and How it works above the primary bar', () => {
    render(<MobileNav />)

    expect(screen.getByTestId('mobile-settings-link')).toHaveAttribute('href', '/settings')
    expect(screen.getByTestId('mobile-settings-link')).toHaveTextContent('Settings')
    expect(screen.getByTestId('mobile-how-it-works-link')).toHaveAttribute('href', '/how-it-works')
    expect(screen.getByTestId('mobile-how-it-works-link')).toHaveTextContent('How it works')
  })

  // J1: the mobile nav follows the reactive locale like the rest of the chrome.
  it('renders in Spanish after the locale switches', () => {
    render(<MobileNav />)

    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    act(() => {
      window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT))
    })

    expect(screen.getByRole('link', { name: 'Investigación' })).toHaveAttribute('href', '/investigation')
    expect(screen.getByRole('link', { name: 'Operación' })).toHaveAttribute('href', '/operation')
    expect(screen.queryByRole('link', { name: 'Investigation' })).not.toBeInTheDocument()
  })

  // §16/§72: bottom-nav links are the primary navigation on mobile — each
  // link must keep a ~44px touch target (min-h-11).
  it('keeps every link at a ~44px touch target', () => {
    render(<MobileNav />)

    // The PRIMARY bar keeps exactly three ~44px targets; the utilities row
    // above rides at min-h-9 (secondary actions).
    const primary = ['Principal', 'Investigation', 'Operation'].map((name) =>
      screen.getByRole('link', { name })
    )
    expect(primary).toHaveLength(3)
    for (const link of primary) {
      expect(link).toHaveClass('min-h-11')
    }
    expect(screen.getByTestId('mobile-settings-link')).toHaveClass('min-h-9')
  })

  // §15.8: the bottom nav carries ONLY the three canonical sections — never a
  // duplicated language control (the header selector stays the only one).
  it('contains no language control — three primary sections plus the two utilities', () => {
    render(<MobileNav />)

    const nav = screen.getByRole('navigation', { name: 'Mobile primary' })
    // 3 canonical primary links + the Settings/How-it-works utilities row
    // (the header's gear/help are lg-only). Still NO language control here.
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
    expect(within(nav).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(nav).queryByText('EN')).not.toBeInTheDocument()
  })
})

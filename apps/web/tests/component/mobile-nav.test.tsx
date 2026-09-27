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

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link).toHaveClass('min-h-11')
    }
  })

  // §15.8: the bottom nav carries ONLY the three canonical sections — never a
  // duplicated language control (the header selector stays the only one).
  it('contains no language control, only the canonical sections', () => {
    render(<MobileNav />)

    const nav = screen.getByRole('navigation', { name: 'Mobile primary' })
    expect(within(nav).getAllByRole('link')).toHaveLength(3)
    expect(within(nav).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(nav).queryByText('EN')).not.toBeInTheDocument()
  })
})

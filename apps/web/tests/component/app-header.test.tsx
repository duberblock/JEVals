import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { AppHeader } from '../../components/layout/app-header'
import { MobileNav } from '../../components/layout/mobile-nav'
import { LOCALE_CHANGED_EVENT, LOCALE_STORAGE_KEY } from '../../lib/i18n/use-locale'

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

function switchLocale(locale: 'en' | 'es') {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  act(() => {
    window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT))
  })
}

// J1 (dual-review): the shared chrome must be locale-reactive through the same
// mechanism as Principal (useDictionary), not the server-default dictionary.
describe('AppHeader (locale-reactive chrome)', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('renders the header chrome in English by default', () => {
    render(<AppHeader />)

    // C4 (FASE C) + FB5 (R40/P32): header identity — the 'JEVals' wordmark
    // plus '// PLAYGROUND' badge. getByText is case-sensitive, so the first
    // assertion also pins that the span preserves the real mixed casing (no
    // uppercase class). FB5 partially supersedes the R36/C4 no-version rule:
    // a REAL release version badge — derived from package.json, the single
    // source — is allowed; invented/pseudo-OS version chrome stays banned.
    expect(screen.getByText('JEVals')).toBeInTheDocument()
    expect(screen.getByText('// PLAYGROUND')).toBeInTheDocument()
    expect(screen.getByText('v1.0.1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Investigation' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Operation' })).toBeInTheDocument()

    // F5 pin: no pseudo-OS status chip vocabulary in the header (the
    // prototype's KERNEL chip is banned; execution context lives in the C5
    // context bar).
    expect(screen.getByRole('banner')).not.toHaveTextContent('KERNEL')
  })

  it('re-renders the header nav in Spanish after the locale switches', () => {
    render(<AppHeader />)

    switchLocale('es')

    expect(screen.getByRole('link', { name: 'Investigación' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Operación' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Investigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Operation' })).not.toBeInTheDocument()
  })

  // P34 (FB7) ELIMINATED the prototype avatar (supersession R36/C4,
  // registered in ADR-021): purely decorative chrome with no owner value.
  // Pin of absence — the glyph exists nowhere: not in the DOM, not in the
  // banner's accessibility tree.
  it('renders no avatar: no user glyph and no image in the accessibility tree', () => {
    render(<AppHeader />)

    expect(document.querySelector('.lucide-user')).toBeNull()
    expect(within(screen.getByRole('banner')).queryAllByRole('img')).toHaveLength(0)
  })
})

// FB4 (R42/P31): /how-it-works lives in the utility zone — OUTSIDE MainNav,
// which keeps exactly the three canonical sections (§3). The link is
// desktop-only by className (hidden … md:inline-flex); jsdom does not apply
// media queries, so the test pins the classes themselves — the responsive
// behavior is covered by the e2e sweep.
describe('AppHeader — how-it-works utility link (FB4)', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('renders the utility link with the page title as its aria-label', () => {
    render(<AppHeader />)

    const link = screen.getByRole('link', { name: 'How it works' })
    expect(link).toHaveAttribute('href', '/how-it-works')
    // Desktop-only pin: the classes carry the decision, not jsdom layout.
    expect(link.className).toContain('hidden')
    expect(link.className).toContain('md:inline-flex')
  })

  it('localizes the utility link aria-label after the locale switches', () => {
    render(<AppHeader />)

    switchLocale('es')

    expect(screen.getByRole('link', { name: 'Cómo funciona' })).toHaveAttribute('href', '/how-it-works')
  })
})

// §15.8 (plan, mobile baseline): exactly ONE language control exists globally
// — the header selector. The mobile bottom nav duplicates sections, never
// controls. Rendered together the way layout.tsx mounts them.
describe('AppHeader — language control singularity (§15.8)', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('renders the language selector exactly once, in the header, with no second control in the mobile nav', () => {
    render(
      <>
        <AppHeader />
        <MobileNav />
      </>
    )

    // One combobox in the whole tree, and it lives inside the header banner.
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(screen.getByRole('combobox').closest('header')).toBe(screen.getByRole('banner'))

    // The mobile nav keeps only the three canonical section links.
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile primary' })
    expect(within(mobileNav).getAllByRole('link')).toHaveLength(3)
    expect(within(mobileNav).queryByRole('combobox')).not.toBeInTheDocument()
  })
})

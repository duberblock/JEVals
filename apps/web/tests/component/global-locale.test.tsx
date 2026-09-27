import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppHeader } from '../../components/layout/app-header'
import { MobileNav } from '../../components/layout/mobile-nav'
import { PrincipalView } from '../../components/principal/principal-view'
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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// J1 regression (plan 15 never-mix rule): after a locale switch, the header
// nav, the mobile nav and the Principal surface must all render Spanish in
// the SAME tree — a mixed-language UI state is the bug being pinned here.
describe('global locale reactivity (never-mix rule)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('switches the chrome and Principal together with no English nav string remaining', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <>
        <AppHeader />
        <main>
          <PrincipalView />
        </main>
        <MobileNav />
      </>
    )

    // English baseline: header nav and Principal copy share one tree.
    expect(screen.getAllByRole('link', { name: 'Investigation' })).toHaveLength(2)
    expect(screen.getByText('Paste a SystemOneRequest to validate it.')).toBeInTheDocument()

    switchLocale('es')

    // Chrome: header nav AND mobile nav are Spanish (one link each).
    expect(screen.getAllByRole('link', { name: 'Investigación' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'Operación' })).toHaveLength(2)
    expect(screen.queryByRole('link', { name: 'Investigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Operation' })).not.toBeInTheDocument()

    // Principal surface in the same tree is Spanish too (R51: formal
    // Latin-American Spanish — usted forms, no voseo).
    expect(screen.getByText('Pegue un SystemOneRequest para validarlo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ejecutar solicitud' })).toBeInTheDocument()
    expect(await screen.findByText('Todavía no hay ejecuciones.')).toBeInTheDocument()
  })
})

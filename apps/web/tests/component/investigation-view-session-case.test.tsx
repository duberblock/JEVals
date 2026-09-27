import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InvestigationView } from '../../components/investigation/investigation-view'
import { compareSnapshot, RUN_ID } from '../fixtures/investigation-snapshot'
import { readSessionCase, SESSION_CASE_KEY } from '../../lib/session-case'

// P45 (R62): Investigación without ?execution= consults the session case as
// if the param had named it (T1.3); a param landing SETS the session; a
// failed session GET discards silently with the session cleared (W6) — no
// banners, no navigation.replace (T1.8).
const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.params,
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

describe('InvestigationView — P45 session case', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the session case on mount without the param — same surface as the deep link, GET only, URL untouched', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, RUN_ID)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByText('Investigation · request_type · CHOICE')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${RUN_ID}`, { method: 'GET' })
    // T1.4: consulting a case never executes anything.
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe('GET')
    }
    // T1.8: hydrating by session never rewrites the URL.
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('SETS the session case when a param hydration lands (the visible case is the one in consultation)', async () => {
    navigation.params = new URLSearchParams(`execution=${RUN_ID}`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(compareSnapshot())))

    render(<InvestigationView />)

    expect(await screen.findByText('Investigation · request_type · CHOICE')).toBeInTheDocument()
    expect(readSessionCase()).toBe(RUN_ID)
  })

  it('the explicit param wins over the session and RE-SETS it on landing', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, 'run_session00002')
    navigation.params = new URLSearchParams(`execution=${RUN_ID}`)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)
    expect(await screen.findByText('Investigation · request_type · CHOICE')).toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${RUN_ID}`, { method: 'GET' })
    expect(readSessionCase()).toBe(RUN_ID)
  })

  it('discards SILENTLY on a 404 session GET — normal empty state, session cleared, no banner, no replace (W6)', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, 'run_gone000000000')
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ detail: 'Execution not found.' }, { status: 404 })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    // The screen's normal empty state (what /investigation without a case
    // shows), never an error/not-found banner.
    expect(await screen.findByText('No execution selected')).toBeInTheDocument()
    expect(screen.queryByText('Execution not found')).not.toBeInTheDocument()
    expect(screen.queryByText(/✗/)).not.toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('discards SILENTLY when the session GET rejects (W6)', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, 'run_gone000000000')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    render(<InvestigationView />)

    expect(await screen.findByText('No execution selected')).toBeInTheDocument()
    expect(screen.queryByText(/✗/)).not.toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
  })

  // Regression pin: W6 silences ONLY session-sourced GETs — an explicit
  // ?execution= deep link that 404s keeps today's honest not-found state and
  // never sets the session (T1.2: failed GETs set nothing).
  it('keeps the not-found banner for an explicit param that 404s, and sets no session', async () => {
    navigation.params = new URLSearchParams('execution=run_missing00001')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'Execution not found.' }, { status: 404 }))
    )

    render(<InvestigationView />)

    expect(await screen.findByText('Execution not found')).toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
  })

  // The session-hydrated case navigates internally exactly like a deep-linked
  // one: the §45.3 mirror carries the case id (user-initiated navigation, not
  // a hydration rewrite).
  it('mirrors internal question navigation with the session case id', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, RUN_ID)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(compareSnapshot())))

    render(<InvestigationView />)
    await screen.findByText('Investigation · request_type · CHOICE')

    fireEvent.click(screen.getByRole('button', { name: 'urgency' }))

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        `/investigation?execution=${RUN_ID}&question=urgency&source=why`,
        { scroll: false }
      )
    })
  })
})

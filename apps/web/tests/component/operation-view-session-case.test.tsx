import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OperationView } from '../../components/operation/operation-view'
import type { ExecutionSnapshot, RecentExecutionItem } from '../../lib/execution-snapshot'
import { readSessionCase, SESSION_CASE_KEY } from '../../lib/session-case'
import { operationalSnapshot, OPERATION_RUN_ID, railItem } from '../fixtures/operation-snapshots'

// P45 (R62): Operación without ?execution= selects the session case as if
// the param had named it (T1.3); a param landing SETS the session; a failed
// session GET discards silently (W6) and the normal selection takes over.
const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.params,
}))

const SECOND_RUN_ID = 'run_08491abcdef99'

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

function routeFetch(listBody: unknown, details: Record<string, ExecutionSnapshot> = {}) {
  return vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/api/v1/executions?')) return jsonResponse(listBody)
    const id = decodeURIComponent(url.replace('/api/v1/executions/', ''))
    const snapshot = details[id]
    if (!snapshot) return jsonResponse({ title: 'Not Found', status: 404 }, { status: 404 })
    return jsonResponse(snapshot)
  })
}

function listWith(...items: RecentExecutionItem[]) {
  return { items, next_cursor: null }
}

describe('OperationView — P45 session case', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('selects the session case on mount without the param — same effect as the deep link, GET only', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, SECOND_RUN_ID)
    const fetchMock = routeFetch(
      listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })),
      {
        [OPERATION_RUN_ID]: operationalSnapshot(),
        [SECOND_RUN_ID]: { ...operationalSnapshot(), execution_id: SECOND_RUN_ID },
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)

    // The SESSION case owns the central view — not the most recent row.
    expect(await screen.findByText('Execution #' + SECOND_RUN_ID.slice(0, 12))).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${SECOND_RUN_ID}`, { method: 'GET' })
    // §61.2/T1.4: consulting a case is read-only.
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe('GET')
    }
    // The rail marks the session case as the current one.
    expect(screen.getByTestId(`rail-row-${SECOND_RUN_ID}`)).toHaveAttribute('aria-current', 'true')
  })

  it('SETS the session case when a param deep link lands', async () => {
    navigation.params = new URLSearchParams(`execution=${OPERATION_RUN_ID}`)
    vi.stubGlobal(
      'fetch',
      routeFetch(listWith(railItem({})), { [OPERATION_RUN_ID]: operationalSnapshot() })
    )

    render(<OperationView />)

    expect(await screen.findByText('Execution #' + OPERATION_RUN_ID.slice(0, 12))).toBeInTheDocument()
    expect(readSessionCase()).toBe(OPERATION_RUN_ID)
  })

  it('the explicit param wins over the session and RE-SETS it on landing', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, SECOND_RUN_ID)
    navigation.params = new URLSearchParams(`execution=${OPERATION_RUN_ID}`)
    const fetchMock = routeFetch(
      listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })),
      {
        [OPERATION_RUN_ID]: operationalSnapshot(),
        [SECOND_RUN_ID]: { ...operationalSnapshot(), execution_id: SECOND_RUN_ID },
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)

    expect(await screen.findByText('Execution #' + OPERATION_RUN_ID.slice(0, 12))).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${OPERATION_RUN_ID}`, { method: 'GET' })
    expect(readSessionCase()).toBe(OPERATION_RUN_ID)
  })

  it('discards SILENTLY when the session case GET 404s — normal selection takes over, session cleared (W6)', async () => {
    // SECOND_RUN_ID has no detail in the routing table: its GET 404s.
    window.sessionStorage.setItem(SESSION_CASE_KEY, SECOND_RUN_ID)
    const fetchMock = routeFetch(listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })), {
      [OPERATION_RUN_ID]: operationalSnapshot(),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)

    // No error surface anywhere (nobody asked for that case explicitly)…
    expect(await screen.findByText('Execution #' + OPERATION_RUN_ID.slice(0, 12))).toBeInTheDocument()
    expect(screen.queryByText('Could not load the execution.')).not.toBeInTheDocument()
    // …the most recent execution owns the normal selection…
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${OPERATION_RUN_ID}`, { method: 'GET' })
    // …and the poisoned session case is dropped.
    expect(readSessionCase()).toBeNull()
  })

  // Regression pin: W6 silences ONLY the session-sourced GET — an explicit
  // deep link that 404s keeps today's honest error state and sets nothing.
  it('keeps the error state for an explicit param that 404s, and sets no session', async () => {
    navigation.params = new URLSearchParams(`execution=${SECOND_RUN_ID}`)
    vi.stubGlobal(
      'fetch',
      routeFetch(listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })), {
        [OPERATION_RUN_ID]: operationalSnapshot(),
      })
    )

    render(<OperationView />)

    expect(await screen.findByText('Could not load the execution.')).toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
  })

  // T1.2 pin ("SETEOS: exactamente estos"): a rail row selection is NOT a
  // seteo — only run landings (Principal) and hydrations that land (recent
  // click, ?execution=) write the session. Selecting B leaves the session
  // untouched; the URL the rail mirrors re-sets it on a later mount instead.
  it('a rail selection does NOT overwrite the session case', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, OPERATION_RUN_ID)
    vi.stubGlobal(
      'fetch',
      routeFetch(
        listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })),
        {
          [OPERATION_RUN_ID]: operationalSnapshot(),
          [SECOND_RUN_ID]: { ...operationalSnapshot(), execution_id: SECOND_RUN_ID },
        }
      )
    )

    render(<OperationView />)
    await screen.findByText('Execution #' + OPERATION_RUN_ID.slice(0, 12))

    fireEvent.click(screen.getByTestId(`rail-row-${SECOND_RUN_ID}`))
    expect(await screen.findByText('Execution #' + SECOND_RUN_ID.slice(0, 12))).toBeInTheDocument()

    expect(readSessionCase()).toBe(OPERATION_RUN_ID)
  })
})

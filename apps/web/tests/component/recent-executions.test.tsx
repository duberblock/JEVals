import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecentExecutions } from '../../components/principal/recent-executions'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'

const items = [
  {
    execution_id: 'run_deadbeefcafe1234',
    created_at: '2026-09-21T10:30:00Z',
    request_hash: 'sha256:abc',
    mode: 'emulator',
    status: 'completed',
    operational_status: 'completed',
    question_count: 3,
    overall_fidelity: null,
    aligned_questions: null,
    semantic_divergence: null,
    duration_ms: 1420,
  },
  {
    execution_id: 'run_0123456789abcdef',
    created_at: '2026-09-20T08:00:00Z',
    request_hash: 'sha256:def',
    mode: 'emulator',
    status: 'failed',
    operational_status: 'failed',
    question_count: 3,
    overall_fidelity: null,
    aligned_questions: null,
    semantic_divergence: null,
    duration_ms: 300,
  },
]

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

function expectedList(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.every(
    (call) => String(call[0]) === '/api/v1/executions?limit=5' && (call[1] as RequestInit).method === 'GET'
  )
}

// P30 (FB3): every row is now a hydration button — onSelect is a required
// prop. The tests that do not assert the callback pass a no-op.
const noopOnSelect = () => {}

describe('RecentExecutions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the latest five executions on mount and renders the compact fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('run_deadbeef')).toBeInTheDocument()
    expect(screen.getByText('run_01234567')).toBeInTheDocument()

    expect(screen.getAllByText('Emulator')).toHaveLength(2)
    expect(screen.getAllByText('Completed')).toHaveLength(1)
    expect(screen.getAllByText('Failed')).toHaveLength(1)
    expect(screen.getAllByText('3')).toHaveLength(2)
    expect(screen.getAllByText('1,420 ms')).toHaveLength(1)

    // Locale-formatted timestamps (section 15.7: current UI locale).
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date('2026-09-21T10:30:00Z')
    )
    expect(screen.getByText(expected)).toBeInTheDocument()

    expect(expectedList(fetchMock)).toBe(true)
  })

  // R38 (ADR-012 adoption debt): the status word uses the semantic success
  // token, never an inline emerald palette class.
  it('colors the completed status word with text-success, not an emerald palette class (R38)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    const completedStatus = await screen.findByText('Completed')
    expect(completedStatus).toHaveClass('text-success')
    expect(completedStatus).not.toHaveClass('text-emerald-600')
    expect(completedStatus).not.toHaveClass('dark:text-emerald-400')
    // The failed row keeps the destructive token — the migration touches only
    // the positive/warning words.
    expect(screen.getByText('Failed')).toHaveClass('text-destructive')
  })

  // R38 dual-review (judge-confirmed): a §66 partial run has §47 status
  // 'completed' (the run itself finished; one leg failed) plus the
  // domain-delivered operational_status 'partial'. The rail and history
  // already classify it as Partial — this surface must not repaint it green.
  it('renders a §66 partial run as Partial with text-warning, not green Completed', async () => {
    const partialItems = [
      { ...items[0], execution_id: 'run_partialabcdef99', operational_status: 'partial' as const },
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: partialItems, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    const partialStatus = await screen.findByText('Partial')
    expect(partialStatus).toHaveClass('text-warning')
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no executions yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('No executions yet.')).toBeInTheDocument()
  })

  it('reloads when the reload token changes after a successful run', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)
    expect(await screen.findByText('No executions yet.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      rerender(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={1} units={en.units} />)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows an honest failure state when the list cannot be loaded', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('Could not load recent executions.')).toBeInTheDocument()
  })

  // F4 (dual-review): mode and status are raw API enums; they must render as
  // localized labels (plan 15.5), never as bare machine values.
  // F12 (dual-review): a problem response (e.g. 401/502 RFC 7807 body) must
  // surface as an error state — never masquerade as an empty history.
  it('shows the error state with the problem title on a 502 problem body, not the empty state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: 'https://jevals.local/problems/api-unreachable',
          title: 'API Unreachable',
          detail: 'The jevals API could not be reached.',
          status: 502,
        },
        { status: 502, headers: { 'content-type': 'application/problem+json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('Could not load recent executions.')).toBeInTheDocument()
    expect(screen.getByText(/API Unreachable/)).toBeInTheDocument()
    expect(screen.queryByText('No executions yet.')).not.toBeInTheDocument()
  })

  it('treats a 200 body without an items array as an error, not as an empty list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ title: 'Unexpected response', detail: 'No items.' }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('Could not load recent executions.')).toBeInTheDocument()
    expect(screen.queryByText('No executions yet.')).not.toBeInTheDocument()
  })

  it('renders localized mode and status labels in Spanish', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={es.recent} locale="es" onSelect={noopOnSelect} reloadToken={0} units={es.units} />)

    expect(await screen.findByText('Completada')).toBeInTheDocument()
    expect(screen.getByText('Fallida')).toBeInTheDocument()
    expect(screen.getAllByText('Emulador')).toHaveLength(2)
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
    expect(screen.queryByText('failed')).not.toBeInTheDocument()
    expect(screen.queryByText('emulator')).not.toBeInTheDocument()
  })

  // W4: compare runs carry overall_fidelity and aligned_questions in the
  // summary; they render with the canonical fidelity format and term
  // (plan sections 15.4/15.5/22), emulator runs render neither.
  it('shows the fidelity percentage and the aligned count for compare runs', async () => {
    const compareItems = [
      {
        execution_id: 'run_compare12345678',
        created_at: '2026-09-21T11:00:00Z',
        request_hash: 'sha256:ghi',
        mode: 'compare',
        status: 'completed',
        operational_status: 'completed',
        question_count: 3,
        overall_fidelity: 0.8125,
        aligned_questions: 2,
        semantic_divergence: null,
        duration_ms: 2100,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: compareItems, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('run_compare1')).toBeInTheDocument()
    expect(screen.getByText('81.3%')).toBeInTheDocument()
    expect(screen.getByText('2 / 3 questions aligned')).toBeInTheDocument()
    expect(screen.getByText('Compare with JEV')).toBeInTheDocument()
  })

  it('hides the fidelity fields entirely for emulator-only runs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('run_deadbeef')).toBeInTheDocument()
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/questions aligned/)).not.toBeInTheDocument()
  })

  it('renders the aligned count with the canonical Spanish term', async () => {
    const compareItems = [
      {
        execution_id: 'run_compare12345678',
        created_at: '2026-09-21T11:00:00Z',
        request_hash: 'sha256:ghi',
        mode: 'compare',
        status: 'completed',
        operational_status: 'completed',
        question_count: 3,
        overall_fidelity: 1,
        aligned_questions: 3,
        semantic_divergence: null,
        duration_ms: 2100,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: compareItems, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={es.recent} locale="es" onSelect={noopOnSelect} reloadToken={0} units={es.units} />)

    expect(await screen.findByText('3 / 3 preguntas alineadas')).toBeInTheDocument()
  })

  // F7 (dual-review): "1 / 1 questions aligned" reads wrong — the singular
  // variant is used when question_count is exactly one.
  it('uses the singular alignment phrase for a one-question compare run', async () => {
    const compareItems = [
      {
        execution_id: 'run_compare12345678',
        created_at: '2026-09-21T11:00:00Z',
        request_hash: 'sha256:ghi',
        mode: 'compare',
        status: 'completed',
        operational_status: 'completed',
        question_count: 1,
        overall_fidelity: 1,
        aligned_questions: 1,
        semantic_divergence: null,
        duration_ms: 2100,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: compareItems, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('1 / 1 question aligned')).toBeInTheDocument()
    expect(screen.queryByText(/questions aligned/)).not.toBeInTheDocument()
  })

  it('renders the Spanish singular alignment phrase for a one-question compare run', async () => {
    const compareItems = [
      {
        execution_id: 'run_compare12345678',
        created_at: '2026-09-21T11:00:00Z',
        request_hash: 'sha256:ghi',
        mode: 'compare',
        status: 'completed',
        operational_status: 'completed',
        question_count: 1,
        overall_fidelity: 1,
        aligned_questions: 1,
        semantic_divergence: null,
        duration_ms: 2100,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: compareItems, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={es.recent} locale="es" onSelect={noopOnSelect} reloadToken={0} units={es.units} />)

    expect(await screen.findByText('1 / 1 pregunta alineada')).toBeInTheDocument()
    expect(screen.queryByText(/preguntas alineadas/)).not.toBeInTheDocument()
  })
})

// W3 (plan 15.4/15.5 + §32): evaluate runs carry semantic_divergence in the
// summary — a compact badge using the canonical "AI Evaluation" vocabulary
// with the localized divergence word; hidden when null.
describe('RecentExecutions — AI Evaluation badge (W3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function evaluateItem(semanticDivergence: string | null) {
    return {
      execution_id: 'run_evaluate1234567',
      created_at: '2026-09-21T12:00:00Z',
      request_hash: 'sha256:jkl',
      mode: 'compare-and-evaluate',
      status: 'completed',
      operational_status: 'completed',
      question_count: 3,
      overall_fidelity: 0.968,
      aligned_questions: 3,
      semantic_divergence: semanticDivergence,
      duration_ms: 2500,
    }
  }

  it('shows the badge with the localized divergence word for each vocabulary value', async () => {
    const cases: Array<[string, string]> = [
      ['none', 'AI Evaluation: none'],
      ['minor', 'AI Evaluation: minor'],
      ['material', 'AI Evaluation: material'],
      ['undetermined', 'AI Evaluation: undetermined'],
    ]
    for (const [divergence, badge] of cases) {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ items: [evaluateItem(divergence)], next_cursor: null })
      )
      vi.stubGlobal('fetch', fetchMock)
      const { unmount } = render(
        <RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />
      )

      expect(await screen.findByText(badge)).toBeInTheDocument()
      unmount()
      vi.unstubAllGlobals()
    }
  })

  it('hides the badge entirely when semantic_divergence is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('run_deadbeef')).toBeInTheDocument()
    expect(screen.queryByText(/AI Evaluation/)).not.toBeInTheDocument()
  })

  it('renders the Spanish badge with the canonical term', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [evaluateItem('minor')], next_cursor: null })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={es.recent} locale="es" onSelect={noopOnSelect} reloadToken={0} units={es.units} />)

    expect(await screen.findByText('Evaluación IA: menor')).toBeInTheDocument()
  })
})

// Wave C (plan §35) + P30 (FB3): each recent-executions row is now a hydration
// BUTTON — clicking it loads that execution into Principal (the aria-label
// composes the same visible row context with the new verb) — plus a SECONDARY
// compact link that keeps the §35 deep link into Investigación. F12
// (dual-review): both accessible names keep the information the sighted row
// shows (short id, mode, status) so screen-reader lists stay equivalent.
describe('RecentExecutions — Investigación deep links (§35)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders each row as a hydration button plus the §35 secondary investigation link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('run_deadbeef')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Load execution run_deadbeef — Emulator, Completed' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load execution run_01234567 — Emulator, Failed' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'View in Investigation run_deadbeef — Emulator, Completed' })
    ).toHaveAttribute('href', '/investigation?execution=run_deadbeefcafe1234')
    expect(
      screen.getByRole('link', { name: 'View in Investigation run_01234567 — Emulator, Failed' })
    ).toHaveAttribute('href', '/investigation?execution=run_0123456789abcdef')
  })

  it('composes the Spanish aria-labels in the localized order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={es.recent} locale="es" onSelect={noopOnSelect} reloadToken={0} units={es.units} />)

    expect(await screen.findByText('run_deadbeef')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cargar ejecución run_deadbeef — Emulador, Completada' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Ver en Investigación run_deadbeef — Emulador, Completada' })
    ).toHaveAttribute('href', '/investigation?execution=run_deadbeefcafe1234')
  })

  // D1 (FB4/P31): the empty state gained exactly ONE link — the how-it-works
  // access point — so the original "no links at all" contract is superseded;
  // the no-buttons half stands unchanged.
  it('renders no buttons in the empty state, with the how-it-works link as its only link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('No executions yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/how-it-works')
  })

  it('renders no buttons or links in the error state', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('Could not load recent executions.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  // P30 (FB3): the row button hydrates Principal with the clicked execution —
  // the exact execution_id rides the callback (never the short id).
  it('calls onSelect with the exact execution_id when the row button is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    const onSelect = vi.fn()

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={onSelect} reloadToken={0} units={en.units} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Load execution run_01234567 — Emulator, Failed' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('run_0123456789abcdef')
  })
})

// FB4 (R42/P31): the empty state is the mobile-friendly access point for
// /how-it-works (the header link is desktop-only). The link uses the recent
// dictionary SLICE — recent.howItWorks — and disappears once rows load.
describe('RecentExecutions — how-it-works empty-state link (FB4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('links to /how-it-works from the empty state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('No executions yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/how-it-works')
  })

  it('renders the localized Spanish link in the empty state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={es.recent} locale="es" onSelect={noopOnSelect} reloadToken={0} units={es.units} />)

    expect(await screen.findByRole('link', { name: 'Cómo funciona' })).toHaveAttribute('href', '/how-it-works')
  })

  it('does not render the how-it-works link when items are loaded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    expect(await screen.findByText('run_deadbeef')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'How it works' })).not.toBeInTheDocument()
  })
})

// §54.1: quick access — a "View history" link below the recent list routes to
// the §55 history view. It renders only when the list actually loaded rows
// (D1/FB4: the empty state now carries the how-it-works link as its only
// link; the error state keeps the no-links contract).
describe('RecentExecutions — View history link (§54.1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('links to /history below the loaded list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={en.recent} locale="en" onSelect={noopOnSelect} reloadToken={0} units={en.units} />)

    const link = await screen.findByRole('link', { name: 'View history' })
    expect(link).toHaveAttribute('href', '/history')
    // Below the list in the DOM (§54.1 wireframe position).
    const list = screen.getByTestId('recent-executions')
    expect(list.contains(link)).toBe(true)
  })

  it('renders the localized Spanish link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RecentExecutions dictionary={es.recent} locale="es" onSelect={noopOnSelect} reloadToken={0} units={es.units} />)

    expect(await screen.findByRole('link', { name: 'Ver historial' })).toHaveAttribute('href', '/history')
  })
})

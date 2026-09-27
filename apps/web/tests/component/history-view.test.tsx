import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HistoryView } from '../../components/operation/history-view'
import type { RecentExecutionItem } from '../../lib/execution-snapshot'
import { OPERATION_RUN_ID, railItem } from '../fixtures/operation-snapshots'
import { EXTREME_LABEL } from './extreme-labels'

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

// §55: when accessed from Operación, columns follow the operational priority
// (Execution, Created, Status, Duration, Mode, Question count) with semantic
// metrics (Fidelity, Aligned) as secondary columns.
describe('HistoryView (§55)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const items: RecentExecutionItem[] = [
    railItem({ overall_fidelity: 0.968, aligned_questions: 3, semantic_divergence: 'none' }),
    railItem({
      execution_id: 'run_08490abcdef77',
      created_at: '2026-09-21T16:03:00Z',
      mode: 'compare',
      status: 'completed',
      // §66 partial classification delivered by the list API (was inferred
      // from the fidelity null).
      operational_status: 'partial',
      overall_fidelity: null,
      aligned_questions: null,
      semantic_divergence: null,
      duration_ms: 310,
    }),
  ]

  it('loads the first page with limit=50 and renders the §55 column priority', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    const headers = await screen.findAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      'Execution',
      'Created',
      'Status',
      'Duration',
      'Mode',
      'Questions',
      'Fidelity',
      'Aligned',
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/executions?limit=50', { method: 'GET' })
  })

  it('links each row to Operación for that execution — opening never re-runs providers (GET only)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    // P33 (FB6): jsdom renders BOTH layouts (§55 table + mobile cards), so
    // table-row link queries scope to the table testid — the cards' links
    // share the short-id accessible names.
    const table = await screen.findByTestId('history-table')
    const link = within(table).getByRole('link', { name: /run_08492/ })
    expect(link).toHaveAttribute('href', `/operation?execution=${OPERATION_RUN_ID}`)
    expect(
      within(table).getByRole('link', { name: /run_08490/ })
    ).toHaveAttribute('href', '/operation?execution=run_08490abcdef77')
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe('GET')
    }
  })

  it('renders operational values and keeps fidelity/aligned as muted secondary cells', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    const table = await screen.findByTestId('history-table')
    const row = within(table).getByRole('link', { name: /run_08492/ }).closest('tr')
    expect(row).not.toBeNull()
    // Operational words first: Completed, duration, mode, question count.
    // (P33: scoped to the table — the cards repeat the duration word.)
    expect(within(table).getByText('2,500 ms')).toBeInTheDocument()
    expect(screen.getAllByText('Evaluate prediction').length).toBeGreaterThanOrEqual(1)
    // Secondary semantic columns render only when the API delivered them.
    expect(screen.getByText('96.8%')).toBeInTheDocument()
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    const fidelityCell = row!.cells[6]
    expect(fidelityCell.className).toContain('text-muted-foreground')
  })

  it('renders the Partial classification for §66 partial rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [items[1]], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    // P33: scoped to the table — the mobile cards also render the §66 word.
    expect(await within(await screen.findByTestId('history-table')).findByText('Partial')).toBeInTheDocument()
  })

  // R38 (ADR-012 adoption debt): the status cell uses the semantic state
  // tokens — Completed success, Partial warning.
  it('colors the status cell text-success on Completed and text-warning on Partial (R38)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    const table = await screen.findByTestId('history-table')
    const completedRow = within(table).getByRole('link', { name: /run_08492/ }).closest('tr')
    const completedCell = completedRow!.cells[2]
    expect(completedCell).toHaveTextContent('Completed')
    expect(completedCell).toHaveClass('text-success')
    expect(completedCell).not.toHaveClass('text-emerald-600')
    expect(completedCell).not.toHaveClass('dark:text-emerald-400')

    const partialRow = within(table).getByRole('link', { name: /run_08490/ }).closest('tr')
    const partialCell = partialRow!.cells[2]
    expect(partialCell).toHaveTextContent('Partial')
    expect(partialCell).toHaveClass('text-warning')
    expect(partialCell).not.toHaveClass('text-amber-600')
    expect(partialCell).not.toHaveClass('dark:text-amber-400')
  })

  it('loads the next page with the delivered cursor and appends the rows', async () => {
    const secondPage = [
      railItem({ execution_id: 'run_08488abcdef55', created_at: '2026-09-20T09:00:00Z' }),
    ]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items, next_cursor: 'cursor-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ items: secondPage, next_cursor: null })
      )
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)
    await screen.findByTestId('history-table')
    expect(screen.queryByRole('link', { name: /run_08488/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    // P33: the appended row is pinned on the TABLE layout (the cards repeat
    // the same run_08488 link for mobile).
    expect(await within(screen.getByTestId('history-table')).findByRole('link', { name: /run_08488/ })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/executions?limit=50&cursor=cursor-1', {
      method: 'GET',
    })
    // The Load more affordance disappears with the last page.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    })
  })

  // J2 (dual-review): paginating must transition synchronously to
  // loading-more so the button unmounts BEFORE the fetch — otherwise a rapid
  // double-click starts two fetches for the same cursor and appends the page
  // twice.
  it('unmounts Load more synchronously, so a rapid double click appends the page exactly once', async () => {
    const secondPage = [
      railItem({ execution_id: 'run_08488abcdef55', created_at: '2026-09-20T09:00:00Z' }),
    ]
    let resolveSecond: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items, next_cursor: 'cursor-1' }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveSecond = resolve
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)
    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    // Only the pagination call carries a cursor; the initial page load does not.
    const cursorCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('cursor=')).length

    // First click; the second page is still in flight, yet the trigger must
    // already be gone (synchronous loading-more transition).
    fireEvent.click(loadMore)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()

    // The rapid second click lands on the detached trigger: no second fetch
    // for the same cursor may ever start.
    fireEvent.click(loadMore)
    expect(cursorCalls()).toBe(1)

    await act(async () => {
      resolveSecond(jsonResponse({ items: secondPage, next_cursor: null }))
    })

    // The cursor page rows appear exactly once (P33: per layout — table and
    // cards each render the appended execution once).
    expect(within(screen.getByTestId('history-table')).getAllByRole('link', { name: /run_08488/ })).toHaveLength(1)
    expect(within(screen.getByTestId('history-cards')).getAllByRole('link', { name: /run_08488/ })).toHaveLength(1)
    expect(cursorCalls()).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2) // initial page + one pagination
  })

  it('hides the Load more button when the first page is the last', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    await screen.findByTestId('history-table')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('renders the empty state for an empty history — never looking like an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    expect(await screen.findByText('No executions yet.')).toBeInTheDocument()
  })

  it('shows the honest error state on an RFC 7807 api-unreachable problem — never an empty list', async () => {
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

    render(<HistoryView />)

    expect(await screen.findByText('Could not load executions.')).toBeInTheDocument()
    expect(screen.getByText(/API Unreachable/)).toBeInTheDocument()
    expect(screen.queryByText('No executions yet.')).not.toBeInTheDocument()
  })

  it('renders the page title and description from the dictionary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument()
    expect(screen.getByText('Browse every persisted execution.')).toBeInTheDocument()
  })
})

describe('HistoryView (§55) — dev StrictMode double-mount', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders each execution exactly once when the initial effect runs twice (StrictMode)', async () => {
    // Next dev runs effects twice under React StrictMode: the initial load
    // must REPLACE, not append — otherwise every row duplicates and React
    // logs duplicate-key warnings (E2E Wave A finding, STEP 9).
    const pageItems: RecentExecutionItem[] = [
      railItem({ overall_fidelity: 0.968, aligned_questions: 3, semantic_divergence: 'none' }),
      railItem({ execution_id: 'run_08490abcdef77', operational_status: 'partial' }),
    ]
    // R5 (dual-review): settle BEFORE asserting. The second mount's response
    // is deferred and only released inside act, so the singularity assertion
    // can never run between the two effects' resolutions (false pass).
    let releaseSecond: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: pageItems, next_cursor: null }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        releaseSecond = resolve
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StrictMode>
        <HistoryView />
      </StrictMode>
    )

    // The first response has been applied…
    await screen.findByTestId('history-table')
    // …and both mounted effects have fired (the second one is pending).
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    // Release the second response and flush: only THEN is the state settled
    // and the exactly-once assertion meaningful.
    await act(async () => {
      releaseSecond(jsonResponse({ items: pageItems, next_cursor: null }))
    })
    // P33: exactly-once is asserted per layout (both the table and the cards
    // render the same items; reviewer round-1 symmetry: the settled state is
    // pinned in BOTH layouts, matching the pagination test's dual assertion).
    const settledTable = screen.getByTestId('history-table')
    expect(within(settledTable).getAllByRole('link', { name: /run_08492/ })).toHaveLength(1)
    expect(within(settledTable).getAllByRole('link', { name: /run_08490/ })).toHaveLength(1)
    const settledCards = screen.getByTestId('history-cards')
    expect(within(settledCards).getAllByRole('link', { name: /run_08492/ })).toHaveLength(1)
    expect(within(settledCards).getAllByRole('link', { name: /run_08490/ })).toHaveLength(1)
  })
})

// P33 (FB6): history on mobile is a card list — the same row data the §55
// table shows (short id, timestamp, §66 status, duration, mode, question
// count) rendered mobile-first with no horizontal scroll. Fidelity/aligned
// stay OUT of the cards (§61.2 applies to lists); the table keeps them as
// secondary columns at >= lg. jsdom renders BOTH layouts (it cannot evaluate
// media queries), so these tests pin the card DOM and the class switches;
// the e2e mobile spec covers real visibility at 375.
describe('HistoryView — P33 cards on mobile (FB6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cardItems: RecentExecutionItem[] = [
    railItem({ overall_fidelity: 0.968, aligned_questions: 3, semantic_divergence: 'none' }),
    railItem({
      execution_id: 'run_08490abcdef77',
      created_at: '2026-09-21T16:03:00Z',
      mode: 'compare',
      status: 'completed',
      // §66 partial classification delivered by the list API.
      operational_status: 'partial',
      overall_fidelity: null,
      aligned_questions: null,
      semantic_divergence: null,
      duration_ms: 310,
    }),
  ]

  it('renders history-cards with one card per item — short id, date, status, duration, mode, questions — inside history-results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: cardItems, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    const cards = await screen.findByTestId('history-cards')
    expect(screen.getByTestId('history-results')).toBeInTheDocument()
    expect(within(cards).getAllByRole('listitem')).toHaveLength(2)

    // Same row data as the table: short id (with the # house prefix), the
    // locale-formatted timestamp, the §66 status word, duration, mode and
    // the question count.
    expect(within(cards).getByText('#run_08492abc')).toBeInTheDocument()
    expect(within(cards).getByText('#run_08490abc')).toBeInTheDocument()
    const expectedDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date('2026-09-21T16:03:00Z')
    )
    expect(within(cards).getByText(expectedDate)).toBeInTheDocument()
    expect(within(cards).getByText('Completed')).toBeInTheDocument()
    expect(within(cards).getByText('Partial')).toBeInTheDocument()
    expect(within(cards).getByText('2,500 ms')).toBeInTheDocument()
    expect(within(cards).getByText('310 ms')).toBeInTheDocument()
    expect(within(cards).getByText('Evaluate prediction')).toBeInTheDocument()
    expect(within(cards).getByText('Compare with JEV')).toBeInTheDocument()
    expect(within(cards).getAllByText('3')).toHaveLength(2)
  })

  // Mirror of the recent-executions aria pattern: the card is one big link,
  // so its accessible name carries the sighted context (short id, mode,
  // §66 status) and it routes to Operación — the same /operation deep link
  // the table rows carry, never Investigación.
  it('links each card to /operation?execution=<id> with the composed aria-label', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: cardItems, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    const cards = await screen.findByTestId('history-cards')
    expect(
      within(cards).getByRole('link', { name: 'Execution run_08492abc — Evaluate prediction, Completed' })
    ).toHaveAttribute('href', `/operation?execution=${OPERATION_RUN_ID}`)
    expect(
      within(cards).getByRole('link', { name: 'Execution run_08490abc — Compare with JEV, Partial' })
    ).toHaveAttribute('href', '/operation?execution=run_08490abcdef77')
  })

  // §61.2: fidelity never renders in list surfaces. The table keeps it as a
  // §55 secondary column — the cards must not repeat it.
  it('keeps the fidelity percentage OUT of the cards (§61.2 applies to lists)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: cardItems, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    const cards = await screen.findByTestId('history-cards')
    expect(within(cards).queryByText('96.8%')).not.toBeInTheDocument()
    // The §55 table still renders its secondary column — the ban is on the
    // card list, not on history's table.
    expect(within(screen.getByTestId('history-table')).getByText('96.8%')).toBeInTheDocument()
  })

  // Mirror of the table's §66 partial test: a partial run reads Partial in
  // the card too — the same railStatus classification, never repainted green.
  it('renders the Partial classification for a §66 partial card with text-warning', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [cardItems[1]], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    const cards = await screen.findByTestId('history-cards')
    const partialStatus = within(cards).getByText('Partial')
    expect(partialStatus).toHaveClass('text-warning')
    expect(within(cards).queryByText('Completed')).not.toBeInTheDocument()
  })

  // Dual-render pin: jsdom cannot evaluate media queries, so the class
  // switches carry the contract — the table branch is hidden below lg, the
  // card branch is hidden at >= lg (the e2e mobile spec covers visibility).
  it('dual-renders: the table wrapper is hidden lg:block and the cards are lg:hidden', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: cardItems, next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    // Both layouts live in the DOM.
    const table = await screen.findByTestId('history-table')
    const cards = screen.getByTestId('history-cards')
    const tableWrapper = table.parentElement
    expect(tableWrapper).not.toBeNull()
    expect(tableWrapper!.className).toContain('hidden')
    expect(tableWrapper!.className).toContain('lg:block')
    expect(cards.className).toContain('lg:hidden')
  })
})

// P36/FB9: a no-spaces request-derived value (here a raw future-mode enum)
// on the mobile cards must wrap — wrap-anywhere + min-w-0 on the card
// spans — never overflow the card (§16).
describe('HistoryView — extreme labels on the cards (P36/FB9)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('wraps a no-spaces mode value on the cards with wrap-anywhere + min-w-0', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [railItem({ mode: EXTREME_LABEL })], next_cursor: null })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<HistoryView />)

    const cards = await screen.findByTestId('history-cards')
    // Raw enum fallback (plan 15.5): the long unknown mode renders verbatim.
    const modeValue = within(cards).getByText(EXTREME_LABEL)
    expect(modeValue).toBeInTheDocument()
    expect(modeValue).toHaveClass('wrap-anywhere')
    expect(modeValue).toHaveClass('min-w-0')
  })
})

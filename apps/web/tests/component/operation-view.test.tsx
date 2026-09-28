import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OperationView } from '../../components/operation/operation-view'
import type { ExecutionSnapshot, RecentExecutionItem } from '../../lib/execution-snapshot'
import {
  independentFailedSnapshot,
  jevFailedSnapshot,
  judgeFailedSnapshot,
  oldSnapshot,
  operationalSnapshot,
  OPERATION_RUN_ID,
  railItem,
} from '../fixtures/operation-snapshots'

// The surface reads its deep-link param from the URL (like Investigación):
// /operation?execution=<id>
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

// Routes GET /api/v1/executions?limit=… to the list body and
// GET /api/v1/executions/{id} to the detail snapshots map.
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

describe('OperationView — loading and selection (§54.2)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads the list (limit=50) and the most recent execution on mount, via GET only', async () => {
    const fetchMock = routeFetch(
      listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })),
      { [OPERATION_RUN_ID]: operationalSnapshot() }
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)

    expect(await screen.findByTestId('summary-row-status')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/executions?limit=50', { method: 'GET' })
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${OPERATION_RUN_ID}`, { method: 'GET' })
    // §72/historical persistence: opening an execution NEVER re-runs providers.
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe('GET')
    }
  })

  it('shows the models the run reports in the info panel (traceable from Operación alone)', async () => {
    const fetchMock = routeFetch(listWith(railItem({})), { [OPERATION_RUN_ID]: operationalSnapshot() })
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)

    const models = await screen.findByTestId('operation-models')
    expect(models.textContent).toBe('jev-emulator · jev-latest · judge-llm · gpt-4o-mini')
  })

  // R3 (dual-review): 16px at ALL widths — an sm:text-sm override would drop
  // below 16px on iPhone SE/8 landscape (667px > sm=640) and re-trigger the
  // iOS focus zoom (§16 no-zoom gate).
  it('keeps the rail search input at 16px on every breakpoint (no sm:text-sm)', async () => {
    const fetchMock = routeFetch(listWith(railItem({})), { [OPERATION_RUN_ID]: operationalSnapshot() })
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)

    const search = await screen.findByTestId('execution-search')
    expect(search).toHaveClass('text-base')
    expect(search).not.toHaveClass('sm:text-sm')
  })

  it('resolves the initial selection from the ?execution= deep link before the list order', async () => {
    navigation.params = new URLSearchParams(`execution=${SECOND_RUN_ID}`)
    const fetchMock = routeFetch(listWith(railItem({})), { [SECOND_RUN_ID]: operationalSnapshot() })
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)

    expect(await screen.findByTestId('summary-row-status')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${SECOND_RUN_ID}`, { method: 'GET' })
  })

  it('selecting another rail row fetches that execution with GET and swaps the central view', async () => {
    const fetchMock = routeFetch(
      listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })),
      {
        [OPERATION_RUN_ID]: operationalSnapshot(),
        [SECOND_RUN_ID]: { ...operationalSnapshot(), execution_id: SECOND_RUN_ID },
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)
    await screen.findByText('3 / 3 processed')

    fireEvent.click(screen.getByTestId(`rail-row-${SECOND_RUN_ID}`))

    expect(await screen.findByText('Execution #' + SECOND_RUN_ID.slice(0, 12))).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${SECOND_RUN_ID}`, { method: 'GET' })
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe('GET')
    }
  })

  it('keeps the deep-link URL in sync when the selection changes', async () => {
    const fetchMock = routeFetch(
      listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })),
      {
        [OPERATION_RUN_ID]: operationalSnapshot(),
        [SECOND_RUN_ID]: { ...operationalSnapshot(), execution_id: SECOND_RUN_ID },
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)
    await screen.findByText('3 / 3 processed')

    fireEvent.click(screen.getByTestId(`rail-row-${SECOND_RUN_ID}`))
    await screen.findByText('Execution #' + SECOND_RUN_ID.slice(0, 12))

    expect(navigation.replace).toHaveBeenCalledWith(`/operation?execution=${SECOND_RUN_ID}`, {
      scroll: false,
    })
  })

  it('shows an honest error state — never an empty rail — when the list is unreachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: 'https://jevals.local/problems/api-unreachable',
          title: 'API Unreachable',
          detail: 'The jevals API could not be reached.',
          status: 502,
        },
        { status: 502 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationView />)

    expect(await screen.findByText('Could not load executions.')).toBeInTheDocument()
    expect(screen.queryByText(/No executions match/)).not.toBeInTheDocument()
  })
})

// §61.1/§72: STATUS FIRST — the status row must precede every telemetry row
// in the DOM. §70: no semantic metrics anywhere on this surface.
describe('OperationView — summary panel (§61.1, §72)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderWithSnapshot(snapshot: ExecutionSnapshot) {
    const fetchMock = routeFetch(listWith(railItem({ execution_id: snapshot.execution_id })), {
      [snapshot.execution_id]: snapshot,
    })
    vi.stubGlobal('fetch', fetchMock)
    return render(<OperationView />)
  }

  it('renders Status before every telemetry row (§72 status before telemetry)', async () => {
    renderWithSnapshot(operationalSnapshot())

    const status = await screen.findByTestId('summary-row-status')
    for (const key of ['summary-row-total-time', 'summary-row-questions', 'summary-row-providers', 'summary-row-ai-evaluation', 'summary-row-persistence']) {
      const row = screen.getByTestId(key)
      expect(status.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('renders the operational rows with localized values', async () => {
    renderWithSnapshot(operationalSnapshot())

    const summary = await screen.findByTestId('summary-panel')
    expect(within(summary).getByText('Status')).toBeInTheDocument()
    expect(within(summary).getByText(/Completed/)).toBeInTheDocument()
    expect(within(summary).getByText('Total time')).toBeInTheDocument()
    expect(within(summary).getByText('2,500 ms')).toBeInTheDocument()
    expect(within(summary).getByText('3 / 3 processed')).toBeInTheDocument()
    expect(within(summary).getByText('3 / 3 completed')).toBeInTheDocument()
    expect(within(summary).getByText('AI Evaluation')).toBeInTheDocument()
    expect(within(summary).getByText('success')).toBeInTheDocument()
    expect(within(summary).getByText('Persistence')).toBeInTheDocument()
    expect(within(summary).getByText(/OK/)).toBeInTheDocument()
  })

  it('never renders semantic metrics in the central summary (§70)', async () => {
    renderWithSnapshot(operationalSnapshot())

    // Wait for the LOADED central column: asserting against the pre-fetch
    // DOM would prove nothing (it is empty by construction).
    await screen.findByTestId('summary-panel')
    const central = screen.getByTestId('operation-central')
    expect(central.textContent).not.toMatch(/%/)
    expect(central.textContent).not.toMatch(/fidelity/i)
    expect(central.textContent).not.toMatch(/divergence/i)
  })

  it('renders the AI Evaluation not-run line when the section is absent', async () => {
    renderWithSnapshot(oldSnapshotWithoutJudge())
    expect(await screen.findByText('not run')).toBeInTheDocument()
  })

  it('marks a failed execution as failed in the summary', async () => {
    const failed = { ...operationalSnapshot(), status: 'failed' }
    renderWithSnapshot(failed)
    expect(await screen.findByTestId('summary-row-status')).toBeInTheDocument()
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1)
  })

  // J2: a §66 partial (here: judge failure, comparison still available) shows
  // the amber Partial classification in the central summary — same §66
  // vocabulary as the rail, exact glyph '◐ Partial'.
  it('shows the Partial classification with the ◐ marker for a §66 judge-failed snapshot (J2)', async () => {
    renderWithSnapshot(judgeFailedSnapshot())

    const summary = await screen.findByTestId('summary-panel')
    expect(within(summary).getByText(/Partial/)).toBeInTheDocument()
    const statusRow = within(summary).getByTestId('summary-row-status')
    expect(statusRow.textContent).toContain('◐ Partial')
    expect(statusRow.textContent).not.toMatch(/[✓✗]/)
  })

  it('shows the Partial classification for a §66 independent-failed snapshot (J2)', async () => {
    renderWithSnapshot(independentFailedSnapshot())
    const summary = await screen.findByTestId('summary-panel')
    expect(within(summary).getByText(/Partial/)).toBeInTheDocument()
  })

  it('keeps a full run Completed and a failed run Failed in the summary (J2)', async () => {
    renderWithSnapshot(operationalSnapshot())
    const summary = await screen.findByTestId('summary-panel')
    const statusRow = within(summary).getByTestId('summary-row-status')
    expect(statusRow.textContent).toContain('✓ Completed')
  })

  // R38 (ADR-012 adoption debt): the status and persistence words use the
  // semantic state tokens — success/warning — never inline palette classes.
  it('colors the status dd text-success on the Completed branch (R38)', async () => {
    renderWithSnapshot(operationalSnapshot())

    const statusRow = await screen.findByTestId('summary-row-status')
    const statusDd = within(statusRow).getByText('✓ Completed')
    expect(statusDd).toHaveClass('text-success')
    expect(statusDd).not.toHaveClass('text-emerald-600')
    expect(statusDd).not.toHaveClass('dark:text-emerald-400')
  })

  it('colors the status dd text-warning on the §66 Partial branch (R38)', async () => {
    renderWithSnapshot(judgeFailedSnapshot())

    const statusRow = await screen.findByTestId('summary-row-status')
    const statusDd = within(statusRow).getByText('◐ Partial')
    expect(statusDd).toHaveClass('text-warning')
    expect(statusDd).not.toHaveClass('text-amber-600')
    expect(statusDd).not.toHaveClass('dark:text-amber-400')
  })

  it('colors the ✓ OK persistence dd text-success (R38)', async () => {
    renderWithSnapshot(operationalSnapshot())

    const summary = await screen.findByTestId('summary-panel')
    const persistenceDd = within(summary).getByText('✓ OK')
    expect(persistenceDd).toHaveClass('text-success')
    expect(persistenceDd).not.toHaveClass('text-emerald-600')
    expect(persistenceDd).not.toHaveClass('dark:text-emerald-400')
  })
})

function oldSnapshotWithoutJudge(): ExecutionSnapshot {
  const snapshot = oldSnapshot()
  return { ...snapshot, ai_evaluation: undefined }
}

// §61.2: operational fields only — fidelity, semantic divergence, AI Judge,
// choice/score/noul are PROHIBITED in the execution navigator.
describe('OperationView — execution rail (§54.2, §61.2)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const items: RecentExecutionItem[] = [
    railItem({ overall_fidelity: 0.968, aligned_questions: 3, semantic_divergence: 'none' }),
    railItem({
      execution_id: SECOND_RUN_ID,
      created_at: '2026-09-21T17:15:00Z',
      mode: 'compare',
      status: 'completed',
      // §66 JEV partial, now DELIVERED by the list API (was inferred from the
      // fidelity null).
      operational_status: 'partial',
      overall_fidelity: null,
      aligned_questions: null,
      semantic_divergence: null,
      duration_ms: 221,
    }),
    railItem({
      execution_id: 'run_08490abcdef77',
      created_at: '2026-09-21T16:03:00Z',
      status: 'failed',
      operational_status: 'failed',
      mode: 'emulator',
      overall_fidelity: null,
      duration_ms: 118,
      question_count: 2,
    }),
    // §66 judge partial delivered by the API: fidelity present, leg failed —
    // classified Partial (was Completed under the old fidelity inference).
    railItem({
      execution_id: 'run_08493abcdef44',
      created_at: '2026-09-21T15:03:00Z',
      status: 'completed',
      operational_status: 'partial',
      mode: 'compare-and-evaluate',
      overall_fidelity: 0.9,
      duration_ms: 400,
    }),
  ]

  function renderRail() {
    const fetchMock = routeFetch(listWith(...items), { [OPERATION_RUN_ID]: operationalSnapshot() })
    vi.stubGlobal('fetch', fetchMock)
    return render(<OperationView />)
  }

  it('renders #shortId, short timestamp, status word, duration and question count per row', async () => {
    renderRail()

    const row = await screen.findByTestId(`rail-row-${OPERATION_RUN_ID}`)
    const expectedTime = new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date('2026-09-21T18:42:00Z'))
    expect(within(row).getByText('#' + OPERATION_RUN_ID.slice(0, 12))).toBeInTheDocument()
    expect(within(row).getByText(expectedTime)).toBeInTheDocument()
    expect(within(row).getByText('Completed')).toBeInTheDocument()
    expect(within(row).getByText('2,500 ms')).toBeInTheDocument()
    expect(within(row).getByText('3q')).toBeInTheDocument()
  })

  it('shows the §66 Partial classification for the delivered JEV-partial row', async () => {
    renderRail()

    expect(within(await screen.findByTestId(`rail-row-${SECOND_RUN_ID}`)).getByText('Partial')).toBeInTheDocument()
  })

  it('shows Partial for a delivered §66 judge-partial row that CARRIES fidelity (new classification)', async () => {
    renderRail()

    expect(within(await screen.findByTestId('rail-row-run_08493abcdef44')).getByText('Partial')).toBeInTheDocument()
  })

  it('shows Failed for a failed row', async () => {
    renderRail()
    expect(
      within(await screen.findByTestId('rail-row-run_08490abcdef77')).getByText('Failed')
    ).toBeInTheDocument()
  })

  it('carries NO fidelity, alignment, divergence, AI Judge or primitive data in the rail (§61.2)', async () => {
    renderRail()
    // Wait for LOADED rows: the rail shell exists pre-fetch, but the
    // prohibition must be pinned against the rendered execution rows.
    await screen.findByTestId(`rail-row-${OPERATION_RUN_ID}`)
    const rail = screen.getByTestId('execution-rail')

    expect(rail.textContent).not.toMatch(/%/)
    expect(rail.textContent).not.toMatch(/align/i)
    expect(rail.textContent).not.toMatch(/diverg/i)
    // §61.2 prohibited surfaces, by their canonical names (word-boundary so
    // the legitimate 'Failed' status word never trips the assertion).
    expect(rail.textContent).not.toMatch(/\bAI\b/i)
    expect(rail.textContent).not.toMatch(/\bAI Judge\b/i)
    expect(rail.textContent).not.toMatch(/\bjudge\b/i)
    expect(rail.textContent).not.toMatch(/\bfidelity\b/i)
    expect(rail.textContent).not.toMatch(/\bchoice\b/i)
    expect(rail.textContent).not.toMatch(/\bscore\b/i)
    expect(rail.textContent).not.toMatch(/\bnoul\b/i)
  })

  it('filters rows by the search query as a case-insensitive id substring', async () => {
    renderRail()
    await screen.findByTestId('execution-rail')

    fireEvent.change(screen.getByLabelText('Search executions'), { target: { value: '08491AB' } })

    const rail = screen.getByTestId('execution-rail')
    expect(rail).toHaveTextContent('#' + SECOND_RUN_ID.slice(0, 12))
    expect(rail.textContent).not.toContain(OPERATION_RUN_ID.slice(0, 12))
  })

  it('filters rows by status, counting partial rows as completed', async () => {
    renderRail()
    await screen.findByTestId('execution-rail')

    fireEvent.click(within(screen.getByTestId('execution-rail')).getAllByRole('button', { name: 'Completed' })[0])

    const rail = screen.getByTestId('execution-rail')
    expect(rail.textContent).not.toContain('run_08490abcdef77'.slice(0, 12))
    expect(rail.textContent).toContain(SECOND_RUN_ID.slice(0, 12))
  })

  it('filters rows by the 7-day range tab', async () => {
    const old = railItem({
      execution_id: 'run_old0000000001',
      created_at: '2026-08-01T10:00:00Z',
    })
    const fetchMock = routeFetch(listWith(old), { [old.execution_id]: operationalSnapshot() })
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationView />)
    await screen.findByTestId('execution-rail')
    expect(screen.getByTestId('execution-rail')).toHaveTextContent(old.execution_id.slice(0, 12))

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))

    await waitFor(() => {
      expect(screen.getByTestId('execution-rail').textContent).not.toContain(old.execution_id.slice(0, 12))
    })
  })

  it('links to the full history with the View more executions link (§54.2)', async () => {
    renderRail()
    const link = await screen.findByRole('link', { name: 'View more executions' })
    expect(link).toHaveAttribute('href', '/history')
  })

  it('shows the empty-filter state when nothing matches', async () => {
    renderRail()
    await screen.findByTestId('execution-rail')

    fireEvent.change(screen.getByLabelText('Search executions'), { target: { value: 'zzz-no-match' } })

    expect(await screen.findByText('No executions match the current filters.')).toBeInTheDocument()
  })

  // R38 (ADR-012 adoption debt): the rail status word uses the semantic state
  // tokens — Partial warning, Completed success.
  it('colors the rail status word text-warning on Partial and text-success on Completed (R38)', async () => {
    renderRail()

    const partialStatus = within(await screen.findByTestId(`rail-row-${SECOND_RUN_ID}`)).getByText('Partial')
    expect(partialStatus).toHaveClass('text-warning')
    expect(partialStatus).not.toHaveClass('text-amber-600')
    expect(partialStatus).not.toHaveClass('dark:text-amber-400')

    const completedStatus = within(screen.getByTestId(`rail-row-${OPERATION_RUN_ID}`)).getByText('Completed')
    expect(completedStatus).toHaveClass('text-success')
    expect(completedStatus).not.toHaveClass('text-emerald-600')
    expect(completedStatus).not.toHaveClass('dark:text-emerald-400')
  })
})

// §61.3: honest flow — parallel group marked structurally, only executed
// components drawn, persistence last as OK.
describe('OperationView — flow diagram (§61.3)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderWithSnapshot(snapshot: ExecutionSnapshot) {
    const fetchMock = routeFetch(listWith(railItem({ execution_id: snapshot.execution_id })), {
      [snapshot.execution_id]: snapshot,
    })
    vi.stubGlobal('fetch', fetchMock)
    return render(<OperationView />)
  }

  it('draws the §65 order with the parallel group visually and semantically marked', async () => {
    const { container } = renderWithSnapshot(operationalSnapshot())

    const flow = await screen.findByTestId('flow-diagram')
    const nodes = Array.from(flow.querySelectorAll('[data-testid^="flow-node-"]'))
    expect(nodes.map((node) => node.getAttribute('data-testid'))).toEqual([
      'flow-node-request_validation',
      'flow-node-emulator',
      'flow-node-jev',
      'flow-node-independent_openai',
      'flow-node-fidelity',
      'flow-node-ai_judge',
      'flow-node-persistence',
    ])

    const parallel = screen.getByTestId('flow-parallel-group')
    expect(parallel).toHaveAttribute('role', 'group')
    expect(parallel).toHaveTextContent('parallel')
    expect(container.textContent).toMatch(/parallel/)

    const persistence = screen.getByTestId('flow-node-persistence')
    expect(persistence.getAttribute('data-status')).toBe('ok')
    expect(nodes[nodes.length - 1]).toBe(persistence)
  })

  it('draws only what ran — a §66 JEV failure omits fidelity and ai_judge', async () => {
    renderWithSnapshot(jevFailedSnapshot())

    const flow = await screen.findByTestId('flow-diagram')
    const keys = Array.from(flow.querySelectorAll('[data-testid^="flow-node-"]')).map((node) =>
      node.getAttribute('data-testid')
    )
    expect(keys).not.toContain('flow-node-fidelity')
    expect(keys).not.toContain('flow-node-ai_judge')
    expect(screen.getByTestId('flow-node-jev').getAttribute('data-status')).toBe('failed')
  })

  it('marks a failed node visibly (never color-only, §72)', async () => {
    renderWithSnapshot(independentFailedSnapshot())
    const node = await screen.findByTestId('flow-node-independent_openai')
    expect(node.getAttribute('data-status')).toBe('failed')
    expect(node.textContent).toMatch(/!/)
  })
})

// §61.4: horizontal bars with ABSOLUTE ms — no pie, no donut, no percentages
// of the total. Old snapshots render the honest not-recorded line.
describe('OperationView — latency bars (§61.4)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderWithSnapshot(snapshot: ExecutionSnapshot) {
    const fetchMock = routeFetch(listWith(railItem({ execution_id: snapshot.execution_id })), {
      [snapshot.execution_id]: snapshot,
    })
    vi.stubGlobal('fetch', fetchMock)
    return render(<OperationView />)
  }

  it('renders horizontal bar rows with absolute ms labels in flow order', async () => {
    const { container } = renderWithSnapshot(operationalSnapshot())

    const bar = await screen.findByTestId('latency-bar-emulator')
    expect(bar).toHaveTextContent('Emulator')
    expect(bar).toHaveTextContent('62 ms')

    const bars = Array.from(container.querySelectorAll('[data-testid^="latency-bar-"]'))
    expect(bars.map((node) => node.getAttribute('data-testid'))).toEqual([
      'latency-bar-request_validation',
      'latency-bar-emulator',
      'latency-bar-jev',
      'latency-bar-independent_openai',
      'latency-bar-fidelity',
      'latency-bar-ai_judge',
    ])

    // Bar fills are horizontal divs sized ∝ ms / max(ms) — never pie/donut.
    const fills = container.querySelectorAll('[data-testid^="latency-fill-"]')
    expect(fills.length).toBe(6)
    for (const fill of Array.from(fills)) {
      const width = (fill as HTMLElement).style.width
      expect(width).toMatch(/^\d+(\.\d+)?%$/)
    }
    const emulatorFill = container.querySelector('[data-testid="latency-fill-emulator"]') as HTMLElement
    const validationFill = container.querySelector('[data-testid="latency-fill-request_validation"]') as HTMLElement
    expect(parseFloat(emulatorFill.style.width)).toBeGreaterThan(parseFloat(validationFill.style.width))

    expect(container.querySelector('[style*="conic"]')).toBeNull()
    expect(container.querySelector('svg circle')).toBeNull()
  })

  it('renders the honest not-recorded line instead of invented bars for old snapshots', async () => {
    const { container } = renderWithSnapshot(oldSnapshot())

    expect(await screen.findByText('Not recorded for this execution.')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-testid^="latency-bar-"]')).toHaveLength(0)
  })
})

// §61.5: logs are secondary and collapsed by default.
describe('OperationView — log panel (§61.5)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the details element collapsed by default and reveals the sanitized lines on demand', async () => {
    const fetchMock = routeFetch(listWith(railItem({})), { [OPERATION_RUN_ID]: operationalSnapshot() })
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationView />)

    const details = await screen.findByTestId('operation-log')
    expect(details.tagName).toBe('DETAILS')
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('View logs')).toBeInTheDocument()

    fireEvent.click(screen.getByText('View logs'))

    const opened = screen.getByTestId('operation-log') as HTMLDetailsElement
    expect(opened.open).toBe(true)
    // §69 completion line carries the operational facts (raw ms, as logged).
    const logBody = screen.getByTestId('operation-log-body')
    expect(logBody.textContent).toContain('compare-and-evaluate')
    expect(logBody.textContent).toContain('question_count=3')
    expect(logBody.textContent).toContain('duration_ms=2500')
    expect(logBody.textContent).toContain('comparison=available')
  })
})

// Info panel: identity + actions. Copy reuses the Investigation CopyButton,
// download reuses the lib/investigation/download.ts blob helper.
describe('OperationView — info panel (§61 wireframe)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (URL as unknown as Record<string, unknown>).createObjectURL
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  })

  function renderLoaded() {
    const fetchMock = routeFetch(listWith(railItem({})), { [OPERATION_RUN_ID]: operationalSnapshot() })
    vi.stubGlobal('fetch', fetchMock)
    return render(<OperationView />)
  }

  it('renders the identity rows with the full execution id, hash, mode and creation date', async () => {
    renderLoaded()

    expect(await screen.findByText('Execution ID')).toBeInTheDocument()
    expect(screen.getByText(OPERATION_RUN_ID)).toBeInTheDocument()
    expect(screen.getByText('Request hash')).toBeInTheDocument()
    expect(
      screen.getByText('sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0')
    ).toBeInTheDocument()
    expect(screen.getByText('Mode')).toBeInTheDocument()
    expect(screen.getByText('Evaluate prediction')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
  })

  it('links to Investigación with the execution deep link', async () => {
    renderLoaded()
    const link = await screen.findByRole('link', { name: 'View in Investigation' })
    expect(link).toHaveAttribute('href', `/investigation?execution=${OPERATION_RUN_ID}`)
  })

  it('copies the full execution id on demand', async () => {
    // Evidence-view pattern: stub the clipboard so the transient Copied
    // label can land in jsdom.
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: clipboardWrite } })

    renderLoaded()
    await screen.findByText('Execution ID')

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })
    expect(clipboardWrite).toHaveBeenCalledWith(OPERATION_RUN_ID)
  })

  it('downloads the snapshot JSON as an execution-named file', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:jevals-op')
    Object.assign(URL, { createObjectURL })
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      downloads.push(this.download)
    })

    renderLoaded()
    fireEvent.click(await screen.findByRole('button', { name: 'Download execution' }))

    expect(downloads).toEqual([`${OPERATION_RUN_ID}.json`])
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })
})

// §61.7: no permanent sidebar on mobile — an Execution #<shortId> ▾ trigger
// above the summary opens a Bottom Drawer with the same navigator + filters.
describe('OperationView — mobile navigator (§61.7)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('opens the execution navigator drawer with current execution, search and previous executions', async () => {
    const fetchMock = routeFetch(
      listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })),
      { [OPERATION_RUN_ID]: operationalSnapshot() }
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationView />)

    const trigger = await screen.findByRole('button', {
      name: `Execution #${OPERATION_RUN_ID.slice(0, 12)} ▾`,
    })
    // The trigger renders as soon as the LIST loads (R1) — wait for the
    // detail summary before the ordering assertion.
    expect(await screen.findByTestId('summary-row-status')).toBeInTheDocument()
    // The trigger sits above the summary in the mobile single column.
    expect(
      trigger.compareDocumentPosition(screen.getByTestId('summary-row-status')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('CURRENT EXECUTION')).toBeInTheDocument()
    const current = within(screen.getByTestId('drawer-current-execution'))
    expect(current.getByText('#' + OPERATION_RUN_ID.slice(0, 12))).toBeInTheDocument()
    expect(within(dialog).getByText('PREVIOUS EXECUTIONS')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Search executions')).toBeInTheDocument()
    expect(within(dialog).getByTestId(`rail-row-${SECOND_RUN_ID}`)).toBeInTheDocument()
  })

  it('selecting an execution from the drawer swaps the central view via GET', async () => {
    const fetchMock = routeFetch(
      listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })),
      {
        [OPERATION_RUN_ID]: operationalSnapshot(),
        [SECOND_RUN_ID]: { ...operationalSnapshot(), execution_id: SECOND_RUN_ID },
      }
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationView />)
    fireEvent.click(
      await screen.findByRole('button', { name: `Execution #${OPERATION_RUN_ID.slice(0, 12)} ▾` })
    )

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByTestId(`rail-row-${SECOND_RUN_ID}`))

    expect(await screen.findByText('Execution #' + SECOND_RUN_ID.slice(0, 12))).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${SECOND_RUN_ID}`, { method: 'GET' })
  })
})

describe('OperationView — empty history (honest idle state)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the no-executions message instead of a perpetual Loading line when the list is empty', async () => {
    const fetchMock = routeFetch(listWith())
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationView />)

    // The idle central column must resolve to the honest empty state, never
    // a "Loading…" that can never finish (no detail fetch will ever fire).
    expect(await screen.findByTestId('operation-empty-history')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    // The rail states the same fact (not just filters + a history link).
    expect(screen.getAllByText('No executions yet.').length).toBeGreaterThan(1)
  })
})

// R1/R3/R4: the navigator must survive detail failures, out-of-order detail
// responses and post-load deep-link changes (§54.2 "never trapped").
describe('OperationView — navigator resilience (R1 stale detail, R3 race, R4 deep link)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // R1: a 404/stale deep link still leaves the mobile user a navigator —
  // the desktop rail is hidden below lg.
  it('renders the mobile drawer trigger when the detail fetch 404s, and it opens with rows (R1)', async () => {
    // routeFetch with no details: every detail GET 404s.
    const fetchMock = routeFetch(listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })))
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationView />)

    expect(await screen.findByText('Could not load the execution.')).toBeInTheDocument()

    const trigger = await screen.findByRole('button', { name: `Execution #${OPERATION_RUN_ID.slice(0, 12)} ▾` })
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId(`rail-row-${SECOND_RUN_ID}`)).toBeInTheDocument()
  })

  it('uses the neutral Select-execution trigger label when no execution id is known (detail error)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/api/v1/executions?')) {
        return jsonResponse(listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })))
      }
      return jsonResponse({ title: 'Internal Server Error', status: 500 }, { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationView />)

    expect(await screen.findByText('Could not load the execution.')).toBeInTheDocument()

    const trigger = screen.getByRole('button', { name: 'Select execution ▾' })
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByTestId('drawer-current-execution')).not.toBeInTheDocument()
    expect(within(dialog).getByText('PREVIOUS EXECUTIONS')).toBeInTheDocument()
    expect(within(dialog).getByTestId(`rail-row-${SECOND_RUN_ID}`)).toBeInTheDocument()
  })

  // R3: rapid A→B clicks resolving out of order must leave the central view
  // on the LAST selection (the URL's id), never on the stale first.
  it('ignores a stale detail response that lands after a newer selection (R3)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/api/v1/executions?')) {
        return jsonResponse(listWith(railItem({}), railItem({ execution_id: SECOND_RUN_ID })))
      }
      const id = decodeURIComponent(url.replace('/api/v1/executions/', ''))
      // The first execution resolves LATE — after B was already selected.
      if (id === OPERATION_RUN_ID) await new Promise((resolve) => setTimeout(resolve, 30))
      return jsonResponse({ ...operationalSnapshot(), execution_id: id })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationView />)

    // The initial (slow) A load is still pending; select B, which resolves
    // immediately.
    fireEvent.click(await screen.findByTestId(`rail-row-${SECOND_RUN_ID}`))
    expect(await screen.findByText('Execution #' + SECOND_RUN_ID.slice(0, 12))).toBeInTheDocument()

    // A lands LAST — the stale response must not swap the central view back.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(screen.getByTestId('operation-central-header').textContent).toBe(
      'Execution #' + SECOND_RUN_ID.slice(0, 12)
    )
  })

  // R4: back/forward changes ?execution= after the initial load; the view
  // must follow the new deep link instead of staying on the old selection.
  it('reloads the deep-linked execution when the URL changes after the initial load (R4)', async () => {
    navigation.params = new URLSearchParams(`execution=${OPERATION_RUN_ID}`)
    const fetchMock = routeFetch(listWith(railItem({})), {
      [OPERATION_RUN_ID]: operationalSnapshot(),
      [SECOND_RUN_ID]: { ...operationalSnapshot(), execution_id: SECOND_RUN_ID },
    })
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(<OperationView />)
    await screen.findByText('Execution #' + OPERATION_RUN_ID.slice(0, 12))

    // Simulate a back/forward navigation to ?execution=<second>.
    navigation.params = new URLSearchParams(`execution=${SECOND_RUN_ID}`)
    rerender(<OperationView />)

    expect(await screen.findByText('Execution #' + SECOND_RUN_ID.slice(0, 12))).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${SECOND_RUN_ID}`, { method: 'GET' })
  })
})

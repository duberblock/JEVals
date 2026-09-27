import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrincipalView } from '../../components/principal/principal-view'
import { SAMPLE_SYSTEM_ONE_REQUEST } from '../../lib/sample-request'

// P46 (R61): the request-block disclosure. PrincipalView reads
// /?execution=<id> through useSearchParams — the same file-wide mock the
// principal-view suites use, with mutable params reset before every test.
const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.params,
}))

beforeEach(() => {
  navigation.params = new URLSearchParams()
})

const VALID_RESPONSE = {
  valid: true,
  questions: [
    { name: 'request_type', primitive: 'choice' },
    { name: 'urgency', primitive: 'score' },
    { name: 'refund_requested', primitive: 'noul' },
  ],
}

// The emulator snapshot the run POST answers with (same shape the
// principal-view suites pin against).
const EXECUTION_SNAPSHOT = {
  execution_id: 'run_deadbeefcafe1234',
  created_at: '2026-09-21T10:30:00Z',
  request_hash: 'sha256:abc',
  mode: 'emulator',
  status: 'completed',
  request: JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST),
  emulator: {
    status: 'success',
    model: 'gpt-4o-mini-flash',
    result: {
      answers: {
        request_type: {
          type: 'choice',
          choice: 'billing',
          confidence: 0.92,
          probabilities: { billing: 0.92, technical: 0.05, sales: 0.03 },
        },
        urgency: { type: 'score', score: 1.5, confidence: 0.6, legend: {}, probabilities: {} },
        refund_requested: { type: 'noul', noul: 0.82 },
      },
      usage: { input_tokens: 120, output_tokens: 40 },
    },
  },
  runtime: { duration_ms: 1420 },
  provenance: { providers: [], versions: {}, timings: {} },
}

// One recent row whose detail snapshot is the emulator request (the mode of
// the LIST item only feeds the row's aria-label).
const RECENT_ITEM = {
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
}

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Manually-resolved promises so tests can hold a run POST open.
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function renderView(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
  return render(<PrincipalView />)
}

async function typeJson(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
    target: { value },
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
}

async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function clickRun() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    await vi.advanceTimersByTimeAsync(0)
  })
}

// Expand-before-assert helper (the W3 re-scoping idiom): the automatic
// collapse owns the state until the user opts back in — every manual edit or
// workbench assertion below an automatic trigger goes through this toggle.
// Idempotent: a no-op when the block is already open.
async function expandRequestBlock() {
  const toggle = screen.getByTestId('request-toggle')
  if (toggle.getAttribute('aria-expanded') === 'true') return
  await act(async () => {
    fireEvent.click(toggle)
    await vi.advanceTimersByTimeAsync(0)
  })
}

// Route the mocked fetch by URL: capabilities, validations POST, executions
// POST (optionally held open), recents LIST and the detail GET by id.
function routeFetch(options: { detailStatus?: number; detailBody?: unknown; detailReject?: boolean } = {}) {
  return vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
    if (input === '/api/v1/capabilities') {
      return jsonOk({ emulator: { available: true }, jev: { available: false }, openai: { available: false } })
    }
    if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
    if (input === '/api/v1/executions' && init?.method === 'POST') {
      return jsonOk(EXECUTION_SNAPSHOT, 201)
    }
    if (input.startsWith('/api/v1/executions/')) {
      if (options.detailReject) throw new TypeError('Failed to fetch')
      return jsonOk(options.detailBody ?? EXECUTION_SNAPSHOT, options.detailStatus ?? 200)
    }
    if (String(input).startsWith('/api/v1/executions')) {
      return jsonOk({ items: [RECENT_ITEM], next_cursor: null })
    }
    throw new Error(`unexpected fetch: ${String(input)}`)
  })
}

async function makeValid(fetchMock: ReturnType<typeof vi.fn>) {
  renderView(fetchMock)
  await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)
  // Scoped to the panel: once valid, the summary line carries the same
  // verdict word (T2.5) — a page-wide getByText would match both.
  expect(within(screen.getByTestId('validation-panel')).getByText('✓ VALID')).toBeInTheDocument()
}

async function hydrateFromRecent() {
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Load execution run_deadbeef — Emulator, Completed' })
    )
    await vi.advanceTimersByTimeAsync(0)
  })
}

// P46 (docs/plan-mejoras.md §P46, rulings T2.1-T2.10): when a run starts or a
// case lands, the ENTIRE input block (editor, validation panel with its
// scenario box, provider chips, mode selector, Advanced, Run/Clear) collapses
// behind the house §38 disclosure — one honest summary line plus the single
// expand affordance. The result owns the surface; expanding is the user's
// choice. The summary carries TWO orthogonal signals: the LIVE §19.1 validity
// of the editor and the B3 "edited" freshness marker (editor diverged from
// the text that produced the current result/hydration) — never mixed.
describe('PrincipalView — request block collapse (P46)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('renders the input block expanded with the house disclosure idiom before any run', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    // Expanded by default: the editor and the full block are in the tree.
    expect(screen.getByRole('textbox', { name: 'Request JSON' })).toBeInTheDocument()
    expect(screen.getByTestId('validation-panel')).toBeInTheDocument()
    expect(screen.getByTestId('request-block')).toBeInTheDocument()

    // §38 idiom (ScenarioBox precedent): ONE toggle button carrying
    // aria-expanded + aria-controls, a region labelled by the trigger — never
    // a native <details>.
    const toggle = screen.getByTestId('request-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle.tagName).toBe('BUTTON')
    const regionId = toggle.getAttribute('aria-controls')
    expect(regionId).toBeTruthy()
    const region = document.getElementById(regionId as string)
    expect(region).not.toBeNull()
    expect(region).toHaveAttribute('role', 'region')
    expect(region).toHaveAttribute('aria-labelledby', toggle.id)

    // §16: the toggle is a primary control of the block — comfortable touch
    // target (the Run button's h-11 idiom, not the xs scenario precedent).
    expect(toggle).toHaveClass('h-11')
  })

  it('collapses the whole input block when the run starts; the result keeps the surface', async () => {
    const post = deferred<Response>()
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') {
        return jsonOk({ emulator: { available: true }, jev: { available: false }, openai: { available: false } })
      }
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') return post.promise
      return jsonOk({ items: [], next_cursor: null })
    })
    await makeValid(fetchMock)

    await clickRun()

    // T2.1: EVERYTHING input-side goes behind the disclosure — editor,
    // validation panel (scenario box included), provider chips, mode
    // selector, Advanced and the Run/Clear row (Run lives INSIDE the
    // collapse; it is blocked during the run anyway).
    expect(screen.queryByRole('textbox', { name: 'Request JSON' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('validation-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provider-health-chips')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Emulator/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Independent LLM prediction' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Running…' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()

    // The ONLY visible control of the collapsed block is the affordance.
    const block = screen.getByTestId('request-block')
    expect(within(block).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
    const collapsedRegion = document.getElementById(
      screen.getByTestId('request-toggle').getAttribute('aria-controls') as string
    )
    expect(collapsedRegion).toBeNull()

    // The result surface is alive while the request block is collapsed.
    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument()

    await act(async () => {
      post.resolve(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })

    // T2.4: landing the result does NOT re-expand — expanding is manual.
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Request JSON' })).not.toBeInTheDocument()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('toggles manually: expand brings the editor back, collapse hides it again', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()

    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')

    await expandRequestBlock()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Request JSON' })).toBeInTheDocument()
    expect(screen.getByTestId('validation-panel')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('request-toggle'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Request JSON' })).not.toBeInTheDocument()
  })

  it('re-collapses on a new run despite a manual expansion (T2.7: the automatic trigger stomps the choice)', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()

    // The user opts back in...
    await expandRequestBlock()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'true')

    // ...but the next run's automatic collapse PISES the manual choice.
    await clickRun()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Request JSON' })).not.toBeInTheDocument()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
  })

  it('Clear re-expands the block and resets the workbench', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')

    // Clear lives INSIDE the collapse: expand, then clear.
    await expandRequestBlock()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe('')
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'true')
    // The honest empty signal replaces the stale verdict in the summary.
    expect(screen.getByTestId('request-summary')).toHaveTextContent('Empty')
  })

  it('collapses on a recent-click hydration that lands', async () => {
    const fetchMock = routeFetch()
    renderView(fetchMock)
    await advance()

    await hydrateFromRecent()

    // The ok branch collapses: editor and panel are behind the disclosure.
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Request JSON' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('validation-panel')).not.toBeInTheDocument()
    // The hydrated result owns the surface.
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByTestId('loaded-from-origin')).toBeInTheDocument()
  })

  it('collapses on a URL ?execution= hydration too (same handler, same ok branch)', async () => {
    navigation.params = new URLSearchParams(`execution=${EXECUTION_SNAPSHOT.execution_id}`)
    const fetchMock = routeFetch()
    renderView(fetchMock)
    await advance()

    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Request JSON' })).not.toBeInTheDocument()
  })

  it('does NOT collapse when the detail GET answers 404 (nothing was loaded)', async () => {
    const fetchMock = routeFetch({
      detailStatus: 404,
      detailBody: {
        title: 'Execution not found',
        detail: 'This execution does not exist or is no longer available.',
        status: 404,
      },
    })
    renderView(fetchMock)
    await advance()

    await hydrateFromRecent()

    expect(screen.getByText('✗ Execution not found')).toBeInTheDocument()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Request JSON' })).toBeInTheDocument()
  })

  it('does NOT collapse when the detail GET rejects (network failure)', async () => {
    const fetchMock = routeFetch({ detailReject: true })
    renderView(fetchMock)
    await advance()

    await hydrateFromRecent()

    expect(screen.getByText('✗ Could not load the execution.')).toBeInTheDocument()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Request JSON' })).toBeInTheDocument()
  })

  it('summary is honest: REQUEST label-caps, live question count, mode — no result data', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()

    const summary = screen.getByTestId('request-summary')
    // Label-caps REQUEST + the live count from the validation verdict + the
    // selected mode label. Nothing from the landed result is duplicated.
    expect(within(summary).getByText('REQUEST')).toBeInTheDocument()
    expect(within(summary).getByText('3 questions')).toBeInTheDocument()
    expect(within(summary).getByText('Emulator')).toBeInTheDocument()
    expect(within(summary).queryByText(/Run completed/)).not.toBeInTheDocument()
  })

  it('summary mirrors the LIVE validity: valid → invalid → checking, never a fabricated count', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()

    const summary = screen.getByTestId('request-summary')
    // Live valid verdict beside the count.
    expect(within(summary).getByText('✓ Valid')).toBeInTheDocument()

    // Edit to a DIFFERENT still-valid request: the §19.1 debounce enters
    // checking — the summary shows the honest checking state and drops the
    // count (it must never invent one while the verdict is pending).
    await expandRequestBlock()
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: '{"questions":{"other_question":{"type":"choice"}}}' },
    })
    expect(within(summary).getByText('Validating…')).toBeInTheDocument()
    expect(within(summary).queryByText(/questions$/)).not.toBeInTheDocument()

    await advance(500)
    expect(within(summary).getByText('✓ Valid')).toBeInTheDocument()

    // Edit to a syntactically broken request: the compact invalid signal
    // replaces the verdict — again without any invented count.
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: '{"state": ' },
    })
    expect(within(summary).getByText('✗ Invalid')).toBeInTheDocument()
    expect(within(summary).queryByText(/questions$/)).not.toBeInTheDocument()

    // T2.6 corner: the edit changed only the summary signals — the block
    // keeps whatever open/closed state the user left it in.
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  it('edited marker lights on a post-landing edit WITHOUT touching the validity signal (W5 orthogonality)', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()

    const summary = screen.getByTestId('request-summary')
    // Fresh run: the editor matches the run text — no marker.
    expect(within(summary).queryByTestId('request-edited')).not.toBeInTheDocument()

    await expandRequestBlock()
    await typeJson('{"questions":{"other_question":{"type":"choice"}}}')

    // A still-VALID divergence: BOTH signals at once — ✓ VALID and the
    // edited marker side by side, visually distinct, never merged.
    expect(within(summary).getByText('✓ Valid')).toBeInTheDocument()
    expect(within(summary).getByTestId('request-edited')).toHaveTextContent('edited')

    // B3 did its job on the result...
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
  })

  it('edited survives the B3 invalidation (an invalid edit keeps the marker beside ✗)', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()

    await expandRequestBlock()
    // An edit that breaks the JSON: the result is gone (B3) but the
    // divergence signal is still TRUE — the marker outlives the result.
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: '{"state": ' },
    })

    const summary = screen.getByTestId('request-summary')
    expect(within(summary).getByText('✗ Invalid')).toBeInTheDocument()
    expect(within(summary).getByTestId('request-edited')).toHaveTextContent('edited')
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
  })

  it('edited resets when a new run starts', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()

    await expandRequestBlock()
    await typeJson('{"questions":{"other_question":{"type":"choice"}}}')
    expect(within(screen.getByTestId('request-summary')).getByTestId('request-edited')).toBeInTheDocument()

    // The new run pins the edited text as its own — the marker resets (and
    // the automatic collapse stomps the manual expansion, T2.7).
    await clickRun()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(within(screen.getByTestId('request-summary')).queryByTestId('request-edited')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('edited resets on a hydration and on Clear', async () => {
    const fetchMock = routeFetch()
    renderView(fetchMock)
    await advance()

    // Hydration #1 lands and collapses; the user edits (marker on).
    await hydrateFromRecent()
    await expandRequestBlock()
    await typeJson('{"questions":{"other_question":{"type":"choice"}}}')
    expect(within(screen.getByTestId('request-summary')).getByTestId('request-edited')).toBeInTheDocument()

    // A new hydration pins its own text — the marker resets.
    await hydrateFromRecent()
    expect(within(screen.getByTestId('request-summary')).queryByTestId('request-edited')).not.toBeInTheDocument()

    // Diverge again, then Clear: the pre-run state carries no marker.
    await expandRequestBlock()
    await typeJson('{"questions":{"yet_another":{"type":"score"}}}')
    expect(within(screen.getByTestId('request-summary')).getByTestId('request-edited')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(within(screen.getByTestId('request-summary')).queryByTestId('request-edited')).not.toBeInTheDocument()
  })

  // Reviewer W1 (R61 dual-review): the delicate producedJsonRef lifetime —
  // a MID-RUN edit lights the marker while the POST is still open (the run
  // belongs to the text it was started with, so the B3 guard holds
  // runJsonRef) and the marker SURVIVES the landing, keeping both truths
  // side by side: the produced result and the divergence from it.
  it('mid-run edit lights the marker in flight and it survives the landing', async () => {
    const post = deferred<Response>()
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') {
        return jsonOk({ emulator: { available: true }, jev: { available: false }, openai: { available: false } })
      }
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') return post.promise
      return jsonOk({ items: [], next_cursor: null })
    })
    await makeValid(fetchMock)
    await clickRun()

    // In flight (the POST is held open): no marker — the editor still
    // matches the text that armed the run.
    expect(within(screen.getByTestId('request-summary')).queryByTestId('request-edited')).not.toBeInTheDocument()

    // The mid-run edit diverges from the produced text: the marker lights
    // IN FLIGHT (T2.5's live signal), the run itself keeps flying.
    await expandRequestBlock()
    await typeJson('{"questions":{"other_question":{"type":"choice"}}}')
    expect(within(screen.getByTestId('request-summary')).getByTestId('request-edited')).toBeInTheDocument()

    // The landing keeps BOTH truths side by side: the produced result AND
    // the marker saying the editor has since diverged from it.
    await act(async () => {
      post.resolve(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(within(screen.getByTestId('request-summary')).getByTestId('request-edited')).toBeInTheDocument()
  })

  // Reviewer W2 (R61 dual-review): the failed detail GET does not collapse
  // on the URL-entry origin either — the recent-click path was pinned, but
  // `?execution=` shares the handler and the plan lists both as triggers
  // (only LANDING cases collapse; nothing was loaded here).
  it('does NOT collapse on a failed ?execution= hydration either (nothing was loaded)', async () => {
    navigation.params = new URLSearchParams(`execution=${EXECUTION_SNAPSHOT.execution_id}`)
    const fetchMock = routeFetch({
      detailStatus: 404,
      detailBody: {
        title: 'Execution not found',
        detail: 'This execution does not exist or is no longer available.',
        status: 404,
      },
    })
    renderView(fetchMock)
    await advance()

    expect(screen.getByText('✗ Execution not found')).toBeInTheDocument()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Request JSON' })).toBeInTheDocument()
  })
})

// P48 (owner 2026-09-26, validating P46/R61): "el request si se collapsa.
// Pero Toda la información queda usando la mitad de la pantalla y la idea es
// colapsar para usar el resto del espacio. Pasar de 2 columnas a 1." The C1
// desktop split (lg:grid-cols-2) becomes CONDITIONAL on the disclosure: a
// collapsed block yields the whole lg row to the results (single full-width
// column, the one-line summary stacked above), an expanded block keeps the
// two-column split (class-set identical to pre-P48). The below-lg mobile
// stacking never changes.
describe('PrincipalView — the collapsed block cedes the full width (P48)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  // Exact-token class matching — substring checks would alias
  // lg:grid-cols-1 against lg:grid-cols-12-style future classes.
  function splitClasses(): string[] {
    return (screen.getByTestId('principal-split').getAttribute('class') ?? '')
      .split(/\s+/)
      .filter(Boolean)
  }

  it('keeps the two-column desktop split while the block is expanded (C1 intact)', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    expect(splitClasses()).toContain('lg:grid-cols-2')
    expect(splitClasses()).not.toContain('lg:grid-cols-1')
    // The layout base never moves: mobile stacks below lg, grid at lg.
    expect(splitClasses()).toContain('flex')
    expect(splitClasses()).toContain('flex-col')
    expect(splitClasses()).toContain('lg:grid')
  })

  it('the run-arming collapse switches the split to ONE full-width column (in flight, not on landing)', async () => {
    const post = deferred<Response>()
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') {
        return jsonOk({ emulator: { available: true }, jev: { available: false }, openai: { available: false } })
      }
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') return post.promise
      return jsonOk({ items: [], next_cursor: null })
    })
    await makeValid(fetchMock)

    await clickRun()

    // The switch rides the COLLAPSE (T2.2's arming moment), so it is already
    // true while the POST is still open — the skeleton owns the full width.
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(splitClasses()).toContain('lg:grid-cols-1')
    expect(splitClasses()).not.toContain('lg:grid-cols-2')
    expect(splitClasses()).toContain('lg:grid')

    await act(async () => {
      post.resolve(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })

    // Landing keeps the single column: the result keeps the whole surface.
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(splitClasses()).toContain('lg:grid-cols-1')
    expect(splitClasses()).not.toContain('lg:grid-cols-2')
  })

  it('manual expand restores the split; a manual collapse yields it again', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()
    expect(splitClasses()).toContain('lg:grid-cols-1')

    await expandRequestBlock()
    expect(splitClasses()).toContain('lg:grid-cols-2')
    expect(splitClasses()).not.toContain('lg:grid-cols-1')

    await act(async () => {
      fireEvent.click(screen.getByTestId('request-toggle'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(splitClasses()).toContain('lg:grid-cols-1')
    expect(splitClasses()).not.toContain('lg:grid-cols-2')
  })

  it('a landing hydration collapses to one column; a failed GET keeps the split', async () => {
    const fetchMock = routeFetch()
    const first = renderView(fetchMock)
    await advance()
    expect(splitClasses()).toContain('lg:grid-cols-2')

    await hydrateFromRecent()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(splitClasses()).toContain('lg:grid-cols-1')
    expect(splitClasses()).not.toContain('lg:grid-cols-2')

    first.unmount()
    const failed = routeFetch({
      detailStatus: 404,
      detailBody: {
        title: 'Execution not found',
        detail: 'This execution does not exist or is no longer available.',
        status: 404,
      },
    })
    // A fresh view over a failing GET: nothing was loaded, the block (and
    // with it the two-column split) stays as the pre-run state leaves it.
    // P45 heads-up (dual-review I6): once session-case persistence lands, a
    // run/hydration in the FIRST mount would leave a session entry this
    // second mount consumes — the vitest.setup.ts per-test sessionStorage
    // clear covers it; keep that in mind if this double-mount ever flakes.
    renderView(failed)
    await advance()
    await hydrateFromRecent()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(splitClasses()).toContain('lg:grid-cols-2')
    expect(splitClasses()).not.toContain('lg:grid-cols-1')
  })

  it('Clear re-expands the block AND the two-column split', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()
    expect(splitClasses()).toContain('lg:grid-cols-1')

    await expandRequestBlock()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(splitClasses()).toContain('lg:grid-cols-2')
    expect(splitClasses()).not.toContain('lg:grid-cols-1')
  })

  // Reviewer I4 (R63 dual-review): the T2.7 stomp, pinned at SPLIT level —
  // the P46 suite pins it for the toggle; the split shares requestOpen, and
  // this pins the mechanical consequence instead of assuming it.
  it('a new run stomps the manual expansion and the split follows (T2.7)', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)
    await clickRun()
    expect(splitClasses()).toContain('lg:grid-cols-1')

    await expandRequestBlock()
    expect(splitClasses()).toContain('lg:grid-cols-2')

    await clickRun()
    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(splitClasses()).toContain('lg:grid-cols-1')
    expect(splitClasses()).not.toContain('lg:grid-cols-2')
  })

  // Reviewer I5 (R63 dual-review): a persisted §66 FAILED snapshot is a
  // loaded case too — the ok branch collapses the block AND yields the
  // width; the surface shows the honest failure banner over one column.
  it('a failed persisted snapshot hydrates collapsed and one-column too (§66)', async () => {
    const fetchMock = routeFetch({ detailBody: { ...EXECUTION_SNAPSHOT, status: 'failed' } })
    renderView(fetchMock)
    await advance()

    await hydrateFromRecent()

    expect(screen.getByTestId('request-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(splitClasses()).toContain('lg:grid-cols-1')
    expect(splitClasses()).not.toContain('lg:grid-cols-2')
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
  })
})

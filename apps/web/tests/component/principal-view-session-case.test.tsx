import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrincipalView } from '../../components/principal/principal-view'
import { readSessionCase, SESSION_CASE_KEY } from '../../lib/session-case'
import { SAMPLE_SYSTEM_ONE_REQUEST } from '../../lib/sample-request'

// P45 (R62): the case in consultation persists in sessionStorage
// (`jevals.execution`) and Principal both WRITES it (run landings and
// hydrations that land, T1.2) and READS it (mount without ?execution=,
// T1.3) through the SAME P30 funnel — never a POST (T1.4), silent on
// failed session GETs (W6), Clear never touches it (T1.5).
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

const COMPARE_SNAPSHOT = {
  ...EXECUTION_SNAPSHOT,
  mode: 'compare',
  emulator: EXECUTION_SNAPSHOT.emulator,
  jev: {
    status: 'success',
    model: 'jev-latest',
    result: {
      answers: {
        request_type: {
          type: 'choice',
          choice: 'billing',
          confidence: 0.9,
          probabilities: { billing: 0.9, technical: 0.06, sales: 0.04 },
        },
        urgency: { type: 'score', score: 1.0, confidence: 0.6, legend: {}, probabilities: {} },
        refund_requested: { type: 'noul', noul: 0.119 },
      },
      usage: { input_tokens: 130, output_tokens: 42 },
    },
  },
  comparison: {
    overall_fidelity: 0.968,
    questions: {},
  },
}

const RECENT_ITEM = {
  execution_id: 'run_deadbeefcafe1234',
  created_at: '2026-09-21T10:30:00Z',
  request_hash: 'sha256:abc',
  mode: 'compare',
  status: 'completed',
  operational_status: 'completed',
  question_count: 3,
  overall_fidelity: 0.968,
  aligned_questions: 3,
  semantic_divergence: null,
  duration_ms: 1420,
}

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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

async function makeValid(fetchMock: ReturnType<typeof vi.fn>) {
  renderView(fetchMock)
  await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)
  expect(screen.getByText('✓ VALID')).toBeInTheDocument()
}

async function clickRun() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function expandRequestBlock() {
  const toggle = screen.getByTestId('request-toggle')
  if (toggle.getAttribute('aria-expanded') === 'true') return
  await act(async () => {
    fireEvent.click(toggle)
    await vi.advanceTimersByTimeAsync(0)
  })
}

function executionPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === '/api/v1/executions' && (call[1] as RequestInit).method === 'POST'
  )
}

function detailCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/v1/executions/'))
}

function routeFetch(
  options: {
    detailBody?: unknown
    detailStatus?: number
    detailReject?: boolean
    postBody?: unknown
    postStatus?: number
  } = {}
) {
  return vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
    if (input === '/api/v1/capabilities') {
      return jsonOk({ emulator: { available: true }, jev: { available: true }, openai: { available: true } })
    }
    if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
    if (input === '/api/v1/executions' && init?.method === 'POST') {
      return jsonOk(options.postBody ?? EXECUTION_SNAPSHOT, options.postStatus ?? 201)
    }
    if (input.startsWith('/api/v1/executions/')) {
      if (options.detailReject) throw new TypeError('Failed to fetch')
      return jsonOk(options.detailBody ?? COMPARE_SNAPSHOT, options.detailStatus ?? 200)
    }
    if (String(input).startsWith('/api/v1/executions')) {
      return jsonOk({ items: [RECENT_ITEM], next_cursor: null })
    }
    throw new Error(`unexpected fetch: ${String(input)}`)
  })
}

// T1.2 (1): the landing of a RUN with a real id sets the session case —
// `final` completed and error/failed WITH execution_id, on every lane. An
// interruption without a terminal (no id anywhere) never sets.
describe('PrincipalView — P45 run landings set the session case (T1.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('sets the session case when a JSON-lane run lands completed', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    expect(readSessionCase()).toBeNull()
    await clickRun()

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(readSessionCase()).toBe('run_deadbeefcafe1234')
    expect(window.sessionStorage.getItem(SESSION_CASE_KEY)).toBe('run_deadbeefcafe1234')
  })

  it('sets the session case when a run fails WITH a persisted execution id', async () => {
    const fetchMock = routeFetch({
      postStatus: 502,
      postBody: {
        title: 'Emulator Unavailable',
        detail: "The emulator could not be reached. Execution 'run_persisted123' was persisted with status 'failed'.",
        status: 502,
        execution_id: 'run_persisted123',
      },
    })
    await makeValid(fetchMock)

    await clickRun()

    expect(screen.getByText('✗ Emulator Unavailable')).toBeInTheDocument()
    // The failed run exists in history — its case IS the case in consultation.
    expect(readSessionCase()).toBe('run_persisted123')
  })

  it('does NOT set the session case when a run fails without an execution id', async () => {
    const fetchMock = routeFetch({
      postStatus: 422,
      postBody: {
        title: 'Unsupported question type',
        detail: "Question 'flag' has unsupported type 'boolean'.",
        status: 422,
      },
    })
    await makeValid(fetchMock)

    await clickRun()

    expect(screen.getByText('✗ Unsupported question type')).toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
  })

  it('does NOT set the session case when the run POST rejects (no id ever existed)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') return jsonOk({ emulator: { available: true } })
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        throw new TypeError('Failed to fetch')
      }
      return jsonOk({ items: [RECENT_ITEM], next_cursor: null })
    })
    await makeValid(fetchMock)

    await clickRun()

    expect(screen.getByText('✗ API Unreachable')).toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
  })

  // SSE lane: the same seteo rules on the stream's terminal frames.
  function sectionFrame(section: string, status: 'success' | 'failed', payload: unknown = {}): string {
    return `event: section\ndata: ${JSON.stringify({ section, status, payload })}\n\n`
  }

  function finalFrame(snapshot: unknown): string {
    return `event: final\ndata: ${JSON.stringify(snapshot)}\n\n`
  }

  function errorFrame(problem: Record<string, unknown>): string {
    return `event: error\ndata: ${JSON.stringify(problem)}\n\n`
  }

  type Pushable = { response: Response; push: (chunk: string) => void; end: () => void }

  function sseResponse(): Pushable {
    const encoder = new TextEncoder()
    const pending: Uint8Array[] = []
    const waiting: Array<{
      resolve: (result: { value?: Uint8Array; done: boolean }) => void
    }> = []
    let closed = false

    const body = {
      getReader: () => ({
        read: async (): Promise<{ value?: Uint8Array; done: boolean }> => {
          if (pending.length > 0) return { value: pending.shift(), done: false }
          if (closed) return { value: undefined, done: true }
          return new Promise<{ value?: Uint8Array; done: boolean }>((resolve) => waiting.push({ resolve }))
        },
        releaseLock: () => {},
      }),
    }

    const response = {
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'text/event-stream; charset=utf-8' }),
      body,
    } as unknown as Response

    return {
      response,
      push: (chunk: string) => {
        const encoded = encoder.encode(chunk)
        const waiter = waiting.shift()
        if (waiter) waiter.resolve({ value: encoded, done: false })
        else pending.push(encoded)
      },
      end: () => {
        closed = true
        for (const waiter of waiting.splice(0)) waiter.resolve({ value: undefined, done: true })
      },
    }
  }

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  // Route everything through routeFetch except the run POST, which hands
  // back the pushable SSE response.
  function routeSseFetch(stream: { response: Response }) {
    const base = routeFetch()
    return vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/executions' && init?.method === 'POST') return stream.response
      return base(input, init)
    })
  }

  it('sets the session case when the SSE final frame lands completed', async () => {
    const stream = sseResponse()
    const fetchMock = routeSseFetch(stream)
    await makeValid(fetchMock)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(finalFrame(EXECUTION_SNAPSHOT))
    await flush()

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(readSessionCase()).toBe('run_deadbeefcafe1234')

    stream.end()
    await flush()
  })

  it('sets the session case when the SSE error frame carries a persisted execution id', async () => {
    const stream = sseResponse()
    const fetchMock = routeSseFetch(stream)
    await makeValid(fetchMock)

    await clickRun()
    stream.push(
      errorFrame({
        title: 'Emulator Unavailable',
        detail: 'The emulator could not be reached.',
        status: 502,
        execution_id: 'run_persisted123',
      })
    )
    await flush()

    expect(screen.getByText('✗ Emulator Unavailable')).toBeInTheDocument()
    expect(readSessionCase()).toBe('run_persisted123')

    stream.end()
    await flush()
  })

  it('does NOT set the session case when the stream interrupts without a terminal frame (T1.2: no id)', async () => {
    const stream = sseResponse()
    const fetchMock = routeSseFetch(stream)
    await makeValid(fetchMock)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.end()
    await flush()

    expect(screen.getByText('✗ Stream interrupted')).toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
  })
})

// T1.2 (2): every hydration WITH an id that LANDS sets the session (the ok
// branch of the P30 funnel — recent clicks and ?execution= alike). Failed
// GETs (404/network) never set: nothing was loaded.
describe('PrincipalView — P45 hydration landings set the session case (T1.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  async function mountAndLandList(fetchMock: ReturnType<typeof vi.fn>) {
    renderView(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  it('sets the session case when a recent click hydration lands', async () => {
    const fetchMock = routeFetch()
    await mountAndLandList(fetchMock)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByTestId('loaded-from-origin')).toBeInTheDocument()
    expect(readSessionCase()).toBe('run_deadbeefcafe1234')
  })

  it('does NOT set the session case when the hydration detail GET 404s', async () => {
    const fetchMock = routeFetch({
      detailStatus: 404,
      detailBody: { title: 'Execution not found', detail: 'Gone.', status: 404 },
    })
    await mountAndLandList(fetchMock)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('✗ Execution not found')).toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
  })

  it('does NOT set the session case when the hydration detail GET rejects', async () => {
    const fetchMock = routeFetch({ detailReject: true })
    await mountAndLandList(fetchMock)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('✗ Could not load the execution.')).toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
  })

  // Reviewer W5 (R62 dual-review): a persisted §66/failed snapshot hydrates
  // through the OK branch (the GET succeeded — the banner is the honest
  // rendering of a failed CASE), so it IS a hydration that landed and SETS
  // the session (T1.2 "toda hidratación con id que aterriza" / T1.10).
  it('sets the session case when a persisted failed snapshot hydrates (§66 is a loaded case)', async () => {
    const fetchMock = routeFetch({
      detailBody: { ...COMPARE_SNAPSHOT, status: 'failed' },
    })
    await mountAndLandList(fetchMock)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    // The honest failure banner lands (§66) — and the failed case becomes
    // the case in consultation: it exists in history.
    expect(screen.getByText('✗ Run failed')).toBeInTheDocument()
    expect(readSessionCase()).toBe('run_deadbeefcafe1234')
  })
})

// T1.3/T1.4/T1.6/T1.9/W6/W7 + T1.5: the consumption side — mounting WITHOUT
// ?execution= hydrates the session case through the SAME P30 funnel (chip
// included, 0 POSTs, W2 guards intact), the param ALWAYS wins and re-sets,
// failed session GETs discard silently with the session cleared, and Clear
// resets the view without touching the session.
describe('PrincipalView — P45 session case consumption (T1.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('hydrates the session case on mount without the param — via the P30 funnel, 0 POSTs', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, 'run_deadbeefcafe1234')
    const fetchMock = routeFetch()
    renderView(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // The same funnel as a recent click: detail GET, restored editor, hero
    // and the loaded-from chip that communicates the origin (T1.8: the URL
    // never changed — the chip speaks).
    expect(detailCalls(fetchMock)).toHaveLength(1)
    expect(detailCalls(fetchMock)[0][0]).toBe('/api/v1/executions/run_deadbeefcafe1234')
    expect(screen.getByTestId('loaded-from-origin')).toHaveTextContent('Loaded from execution run_deadbeef')
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()

    // T1.4: hydrating by session NEVER fires an execution POST.
    expect(executionPosts(fetchMock)).toHaveLength(0)
  })

  it('the explicit ?execution= param wins over the session and RE-SETS it on landing', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, 'run_session00002')
    navigation.params = new URLSearchParams('execution=run_param0000001')
    const fetchMock = routeFetch({
      detailBody: { ...COMPARE_SNAPSHOT, execution_id: 'run_param0000001' },
    })
    renderView(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Param wins: only the param id was fetched.
    expect(detailCalls(fetchMock)).toHaveLength(1)
    expect(detailCalls(fetchMock)[0][0]).toBe('/api/v1/executions/run_param0000001')
    // ...and its landing re-set the session (what is visible is in consultation).
    expect(readSessionCase()).toBe('run_param0000001')
  })

  it('discards SILENTLY when the session case detail GET 404s — no banner, session cleared (W6)', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, 'run_gone000000000')
    const fetchMock = routeFetch({
      detailStatus: 404,
      detailBody: { title: 'Execution not found', detail: 'Gone.', status: 404 },
    })
    renderView(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // No failure banner of any kind (nobody asked for that case explicitly).
    expect(screen.queryByText(/✗/)).not.toBeInTheDocument()
    expect(screen.queryByText('Could not load the execution.')).not.toBeInTheDocument()
    // The normal empty state: no chip, no hero, virgin editor.
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe('')
    // The poisoned session case is dropped.
    expect(readSessionCase()).toBeNull()
    // T1.4 holds even on the failure path.
    expect(executionPosts(fetchMock)).toHaveLength(0)
  })

  it('discards SILENTLY when the session case detail GET rejects (W6)', async () => {
    window.sessionStorage.setItem(SESSION_CASE_KEY, 'run_gone000000000')
    const fetchMock = routeFetch({ detailReject: true })
    renderView(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.queryByText(/✗/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    expect(readSessionCase()).toBeNull()
  })

  // T1.9/W2: a session hydration resolving late must not pisa a run — the
  // session path goes through the SAME funnel, so the imperative guards
  // (runInFlightRef/hydrateEpochRef) drop it exactly like a late recent GET.
  it('drops a late session hydration when a run started while its GET was open (T1.9)', async () => {
    let resolveDetail: (value: Response) => void = () => {}
    let resolvePost: (value: Response) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') return jsonOk({ emulator: { available: true } })
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve
        })
      }
      if (input.startsWith('/api/v1/executions/')) {
        return new Promise<Response>((resolve) => {
          resolveDetail = resolve
        })
      }
      return jsonOk({ items: [RECENT_ITEM], next_cursor: null })
    })
    window.sessionStorage.setItem(SESSION_CASE_KEY, 'run_deadbeefcafe1234')
    await makeValid(fetchMock)

    // The session GET is still open; a run starts (a newer intent).
    await clickRun()
    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument()

    await act(async () => {
      resolveDetail(jsonOk(COMPARE_SNAPSHOT))
      await vi.advanceTimersByTimeAsync(0)
    })

    // The late hydration was dropped: no chip, no compare hero — the run
    // still owns the surface (the skeleton proves it).
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    expect(screen.queryByText('✓ PREDICTION MATCHED JEV')).not.toBeInTheDocument()
    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument()

    await act(async () => {
      resolvePost(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
  })

  // T1.5: Clear resets the editing view, NOT the case in consultation —
  // navigating to Investigación afterwards still shows the same case.
  it('Clear does NOT clear the session case (T1.5)', async () => {
    const fetchMock = routeFetch()
    renderView(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(readSessionCase()).toBe('run_deadbeefcafe1234')

    await expandRequestBlock()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // The view reset (P30 pin) but the session case survived.
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe('')
    expect(readSessionCase()).toBe('run_deadbeefcafe1234')
  })

  // W7: sessionStorage is only touched client-side in effects — a mount
  // without it renders the normal empty state and never crashes.
  it('renders the normal empty state without touching sessionStorage anywhere (W7)', async () => {
    vi.stubGlobal('sessionStorage', undefined)
    const fetchMock = routeFetch()
    renderView(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // No session case exists to read: no detail GET, no chip, no hero — and
    // the page is alive.
    expect(detailCalls(fetchMock)).toHaveLength(0)
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Request JSON' })).toBeInTheDocument()
  })
})

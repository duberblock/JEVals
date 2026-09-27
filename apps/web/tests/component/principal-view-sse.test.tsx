import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrincipalView } from '../../components/principal/principal-view'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import { SAMPLE_SYSTEM_ONE_REQUEST } from '../../lib/sample-request'

// P28 (FB1): the run POST negotiates text/event-stream and consumes the SSE
// lane incrementally — chips flip as section events arrive, `final` reuses
// the completed path verbatim, `error` mirrors the failed branch, and a
// stream interrupted before any terminal frame fails loudly WITHOUT any
// automatic retry (a retry would duplicate executions). The JSON fallback
// lane keeps every non-SSE response on today's exact handling.

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
  jev: {
    status: 'success',
    model: 'jev-latest',
    result: { answers: {}, usage: { input_tokens: 130, output_tokens: 42 } },
  },
  comparison: {
    overall_fidelity: 0.968,
    questions: {},
  },
}

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sectionFrame(section: string, status: 'success' | 'failed', payload: unknown = {}): string {
  return `event: section\ndata: ${JSON.stringify({ section, status, payload })}\n\n`
}

function finalFrame(snapshot: unknown): string {
  return `event: final\ndata: ${JSON.stringify(snapshot)}\n\n`
}

function errorFrame(problem: Record<string, unknown>): string {
  return `event: error\ndata: ${JSON.stringify(problem)}\n\n`
}

// A step-driven SSE response: chunks land only when the test pushes them, so
// intermediate states (chips flipping while the run is still in flight) are
// assertable deterministically. `end()` closes the reader — ending WITHOUT a
// terminal frame exercises the interrupted-stream contract. `abort()` makes
// every pending/future read REJECT (an abortive reset — the most common
// real-world interruption).
type Pushable = {
  response: Response
  push: (chunk: string) => void
  end: () => void
  abort: (error: unknown) => void
}

function sseResponse(): Pushable {
  const encoder = new TextEncoder()
  const pending: Uint8Array[] = []
  const waiting: Array<{
    resolve: (result: { value?: Uint8Array; done: boolean }) => void
    reject: (error: unknown) => void
  }> = []
  let closed = false
  let aborted: unknown = null

  const body = {
    getReader: () => ({
      read: async (): Promise<{ value?: Uint8Array; done: boolean }> => {
        if (aborted !== null) return Promise.reject(aborted)
        if (pending.length > 0) {
          return { value: pending.shift(), done: false }
        }
        if (closed) {
          return { value: undefined, done: true }
        }
        return new Promise<{ value?: Uint8Array; done: boolean }>((resolve, reject) =>
          waiting.push({ resolve, reject })
        )
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
    abort: (error: unknown) => {
      aborted = error
      pending.length = 0
      for (const waiter of waiting.splice(0)) waiter.reject(error)
    },
  }
}

function routeFetch(executionResponse: () => Promise<Response> | Response) {
  return vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
    if (input === '/api/v1/capabilities') {
      return jsonOk({ emulator: { available: true }, jev: { available: true }, openai: { available: true } })
    }
    if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
    if (input === '/api/v1/executions' && init?.method === 'POST') {
      return executionResponse()
    }
    return jsonOk({ items: [], next_cursor: null })
  })
}

async function makeValid(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
  render(<PrincipalView />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
    target: { value: SAMPLE_SYSTEM_ONE_REQUEST },
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(screen.getByText('✓ VALID')).toBeInTheDocument()
}

function executionPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === '/api/v1/executions' && (call[1] as RequestInit).method === 'POST'
  )
}

function listCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    (call) => String(call[0]).startsWith('/api/v1/executions') && (call[1] as RequestInit).method !== 'POST'
  ).length
}

async function clickRun() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

// P46 (R61, W3 supersession): the input block now collapses behind the
// request-block disclosure when a run arms its POST. The SSE pins below
// that assert workbench contents (the Run button, the editor) after a run
// started are re-scoped as expand-before-assert: the collapse fires with the
// run, the disclosure is expanded manually, then the ORIGINAL assertion
// runs unchanged. Idempotent: a no-op when the block is already open (the
// re-collapse only comes from a NEW run arming).
async function expandRequestBlock() {
  const toggle = screen.getByTestId('request-toggle')
  if (toggle.getAttribute('aria-expanded') === 'true') return
  await act(async () => {
    fireEvent.click(toggle)
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('PrincipalView — SSE run lane (P28)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('negotiates text/event-stream on the run POST', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)

    await clickRun()

    const posts = executionPosts(fetchMock)
    expect(posts).toHaveLength(1)
    const headers = new Headers((posts[0] as [string, RequestInit])[1].headers)
    expect(headers.get('accept')).toBe('text/event-stream')
    expect(headers.get('content-type')).toBe('application/json')

    stream.end()
    await flush()
  })

  it('flips the in-flight chips as section events arrive (success and failed)', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)

    await clickRun()

    // Before any event: every chip stays neutral (C11 — no invented states).
    for (const source of ['emulator', 'jev', 'judge', 'independent'] as const) {
      expect(screen.getByTestId(`source-chip-${source}`)).toHaveTextContent('…')
    }

    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    await flush()
    expect(screen.getByTestId('source-chip-emulator')).toHaveTextContent('Emulator✓')
    // Unobserved chips stay neutral while the run continues.
    expect(screen.getByTestId('source-chip-jev')).toHaveTextContent('JEV…')
    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument()

    stream.push(sectionFrame('jev', 'failed', { status: 'failed', error: 'The JEV returned HTTP 503.' }))
    await flush()
    expect(screen.getByTestId('source-chip-jev')).toHaveTextContent('JEV✗')

    // comparison has no chip: the event must flip nothing.
    stream.push(sectionFrame('comparison', 'success', COMPARE_SNAPSHOT.comparison))
    await flush()
    expect(screen.getByTestId('source-chip-judge')).toHaveTextContent('Judge…')
    expect(screen.getByTestId('source-chip-independent')).toHaveTextContent('Independent…')

    // Comment lines (SSE keep-alives) are tolerated and ignored.
    stream.push(': keep-alive\n\n')
    stream.push(finalFrame(COMPARE_SNAPSHOT))
    await flush()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
  })

  it('renders the hero and reloads recents on the final frame (completed path reuse)', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)

    const before = listCalls(fetchMock)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(finalFrame(EXECUTION_SNAPSHOT))
    await flush()

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(screen.getAllByText('1,420 ms').length).toBeGreaterThan(0)
    expect(listCalls(fetchMock)).toBe(before + 1) // recent executions reload token
  })

  it('shows the failed banner with the problem fields on an error frame (no final)', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)

    await clickRun()
    stream.push(sectionFrame('emulator', 'failed', { status: 'failed', error: 'boom' }))
    stream.push(
      errorFrame({
        title: 'Emulator Unavailable',
        detail: "The emulator could not be reached. Execution 'run_persisted123' was persisted with status 'failed'.",
        status: 502,
        execution_id: 'run_persisted123',
      })
    )
    await flush()

    expect(screen.getByText('✗ Emulator Unavailable')).toBeInTheDocument()
    expect(screen.getByText('run_persisted123')).toBeInTheDocument()
    expect(screen.queryByText(/Run completed/)).not.toBeInTheDocument()
    // P46 (W3): the run arming collapsed the input block — expand before the
    // Run re-enabled assertion.
    await expandRequestBlock()
    expect(screen.getByRole('button', { name: 'Run request' })).toBeEnabled()
  })

  it('fails loudly when the stream ends before any terminal frame — and never retries', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    // The reader finishes with NO final/error frame: interrupted stream.
    stream.end()
    await flush()

    // New i18n strings (title + detail), not the generic network fallback.
    expect(screen.getByText('✗ Stream interrupted')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The connection to the jevals API was lost while the run was executing. Check History before running it again.'
      )
    ).toBeInTheDocument()

    // NO automatic retry: exactly one execution POST ever happened, even
    // after the timers advance (a retry would duplicate executions).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(executionPosts(fetchMock)).toHaveLength(1)
  })

  it('classifies a frame the wire truncated mid-JSON as an interrupted stream, not unreachable', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    await flush()
    expect(screen.getByTestId('source-chip-emulator')).toHaveTextContent('Emulator✓')

    // The connection dies MID-FRAME: the final frame arrives truncated and
    // EOF lands without its blank-line terminator. Its JSON never parses.
    stream.push('event: final\ndata: {"status":"comp')
    stream.end()
    await flush()

    // The API answered and the stream OPENED — this is an interruption of a
    // live run (dedicated copy, History pointer), never the API-unreachable
    // copy of a fetch that never got a response.
    expect(screen.getByText('✗ Stream interrupted')).toBeInTheDocument()
    expect(screen.queryByText('✗ API Unreachable')).not.toBeInTheDocument()
    expect(executionPosts(fetchMock)).toHaveLength(1)
  })

  it('classifies an aborted reader (read rejection) as an interrupted stream, not unreachable', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    await flush()
    expect(screen.getByTestId('source-chip-emulator')).toHaveTextContent('Emulator✓')

    // An abortive reset: the pending read REJECTS (the most common transport
    // interruption in practice) instead of resolving done.
    stream.abort(new TypeError('network error'))
    await flush()

    expect(screen.getByText('✗ Stream interrupted')).toBeInTheDocument()
    expect(screen.queryByText('✗ API Unreachable')).not.toBeInTheDocument()
    expect(executionPosts(fetchMock)).toHaveLength(1)
  })

  it('resets the chip progress map on every new run', async () => {
    const first = sseResponse()
    const second = sseResponse()
    let call = 0
    const fetchMock = routeFetch(() => {
      call += 1
      return call === 1 ? first.response : second.response
    })
    await makeValid(fetchMock)

    await clickRun()
    first.push(sectionFrame('emulator', 'failed', { status: 'failed', error: 'x' }))
    await flush()
    // Observed failure flips the chip while the run is still in flight.
    expect(screen.getByTestId('source-chip-emulator')).toHaveTextContent('Emulator✗')
    first.push(errorFrame({ title: 'Emulator Unavailable', detail: 'down', status: 502 }))
    await flush()
    expect(screen.getByText('✗ Emulator Unavailable')).toBeInTheDocument()

    // P46 (W3): the first run collapsed the input block — expand before the
    // second run's click (the second arming re-collapses it, T2.7).
    await expandRequestBlock()
    await clickRun()
    // The second run starts from the neutral in-flight strip again.
    expect(screen.getByTestId('source-chip-emulator')).toHaveTextContent('Emulator…')
    second.push(finalFrame(EXECUTION_SNAPSHOT))
    await flush()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
  })
})

// P39: the §29/§30 facts a compare/evaluate run streams — the SAME values in
// the section payloads and the landed snapshot, so the progressive rows and
// the final rows assert identical strings (parity). Built from this file's
// EXECUTION_SNAPSHOT following the existing fixture pattern (mode + judge
// section on top of the compare legs).
const RUN_JEV_SECTION = {
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
      urgency: { type: 'score', score: 1.0, confidence: 0.6, legend: { '0': 'low', '1': 'medium', '2': 'high' }, probabilities: {} },
      refund_requested: { type: 'noul', noul: 0.119 },
    },
    usage: { input_tokens: 130, output_tokens: 42 },
  },
}

const RUN_COMPARISON_SECTION = {
  overall_fidelity: 0.968,
  questions: {
    request_type: {
      primitive: 'choice',
      fidelity: 0.98,
      aligned: true,
      components: { decision_match: true, confidence_delta: 0.02, distribution_similarity: 0.98 },
    },
    urgency: {
      primitive: 'score',
      fidelity: 0.95,
      aligned: true,
      components: {
        score_delta: 0.5,
        max_score: 2,
        score_similarity: 0.75,
        distribution_similarity: 0.9,
        confidence_delta: 0.0,
        emulator_dominant_level: '1',
        jev_dominant_level: '1',
      },
    },
    refund_requested: {
      primitive: 'noul',
      fidelity: 0.963,
      aligned: true,
      components: { probability_delta: 0.037 },
    },
  },
}

const RUN_JUDGE_SECTION = {
  status: 'success',
  model: 'gpt-4o-mini-flash',
  overall: {
    prediction_quality: 'excellent',
    semantic_divergence: 'none',
    summary: 'The emulator prediction preserves the request semantics in full.',
  },
  questions: {
    request_type: {
      emulator_support: 'strong',
      jev_support: 'strong',
      semantic_divergence: 'none',
      preferred: 'tie',
      reason: 'Both sides chose billing with near-identical confidence.',
    },
  },
  evidence: { input: {}, output_schema: {}, raw_response: '' },
}

const COMPARE_RUN_SNAPSHOT = {
  ...EXECUTION_SNAPSHOT,
  mode: 'compare',
  jev: RUN_JEV_SECTION,
  comparison: RUN_COMPARISON_SECTION,
}

const EVALUATE_RUN_SNAPSHOT = {
  ...COMPARE_RUN_SNAPSHOT,
  mode: 'compare-and-evaluate',
  ai_evaluation: RUN_JUDGE_SECTION,
}

// The staged progressive run: select a mode (capabilities arrive with LLM
// available in routeFetch), run, then land the §65 frames one by one.
async function selectMode(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name }))
    await vi.advanceTimersByTimeAsync(0)
  })
}

// P39: while a LLM leg (the Judge in evaluate mode) is still in flight, the
// deterministic §29/§30 rows render from the accumulated section payloads the
// moment the comparison frame arrives — with the LLM progress bar above
// them, the hero still a skeleton and Run still blocked. The judge frame then
// hides the bar, and the final frame lands the hero with the SAME rows.
describe('PrincipalView — progressive results during the SSE run (P39)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('renders the deterministic rows and the LLM bar while the judge is in flight, then parity on final', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)

    await clickRun()
    const [input, init] = executionPosts(fetchMock)[0] as [string, RequestInit]
    expect(input).toBe('/api/v1/executions')
    expect(JSON.parse(String(init.body)).mode).toBe('compare-and-evaluate')

    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    await flush()
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    await flush()
    // Before the comparison lands there is nothing honest to show as rows.
    expect(screen.queryByTestId('question-results')).not.toBeInTheDocument()

    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()

    // The ~200ms moment: rows with the EXACT fixture strings (values →, Δ,
    // criteria ↔, deterministic verdicts), unlinked (no invented id).
    expect(screen.getByTestId('question-results')).toBeInTheDocument()
    expect(screen.getByText('Question results')).toBeInTheDocument()
    expect(screen.getByText('✓ request_type · CHOICE')).toBeInTheDocument()
    expect(screen.getByText('billing → billing')).toBeInTheDocument()
    expect(screen.getByText('Same decision')).toBeInTheDocument()
    expect(screen.getByText('1.5 → 1.0')).toBeInTheDocument()
    expect(screen.getByText('Δ .5')).toBeInTheDocument()
    expect(screen.getByText('medium ↔ medium')).toBeInTheDocument()
    expect(screen.getByText('.82 → .119')).toBeInTheDocument()
    expect(screen.getByText('Crossed .5')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Inspect request_type' })).not.toBeInTheDocument()

    // P44 supersedes ADR-024 ruling 2's rows-slot bar: the LLM feedback
    // lives ONLY in the CTA surface (P42 determinate progressbar + P43
    // shimmer/spinner/label, same visibility rule) — the rows slot renders
    // rows, nothing else.
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()

    // Blocking on the buttons (W1) while the hero owns the §72 slot. P41
    // supersedes P39's skeleton-here pin: once the comparison lands, the
    // progressive hero (same component as the final) takes the slot.
    // P46 (W3): the run arming collapsed the input block — expand before the
    // mid-flight button assertion.
    await expandRequestBlock()
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled()
    expect(screen.queryByTestId('hero-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()

    // The judge frame lands: the rows stay (the CTA feedback unmounts with
    // its own pending rule — the rows slot never carried a bar again).
    stream.push(sectionFrame('judge', 'success', RUN_JUDGE_SECTION))
    await flush()
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()
    expect(screen.getByText('billing → billing')).toBeInTheDocument()

    // The final lands: hero + the SAME rows (parity), no bar, Run re-enabled.
    // Landed rows deep-link (the snapshot id exists), so the pair values are
    // asserted on their rows like the completed-path tests do.
    stream.push(finalFrame(EVALUATE_RUN_SNAPSHOT))
    await flush()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inspect request_type' }).closest('li')).toHaveTextContent(
      'billing → billing'
    )
    expect(screen.getByRole('link', { name: 'Inspect urgency' }).closest('li')).toHaveTextContent('1.5 → 1.0')
    expect(screen.getByRole('link', { name: 'Inspect refund_requested' }).closest('li')).toHaveTextContent(
      '.82 → .119'
    )
    expect(screen.getByText('Crossed .5')).toBeInTheDocument()
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()
    // P46 (W3): the landed final keeps the input block collapsed — expand
    // before the Run re-enabled assertion.
    await expandRequestBlock()
    expect(screen.getByRole('button', { name: 'Run request' })).toBeEnabled()
  })

  it('keeps the progressive rows when the stream interrupts after the comparison', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()
    expect(screen.getByTestId('question-results')).toBeInTheDocument()
    // P44: the rows slot carries no LLM bar — the CTA surface owns the
    // in-flight feedback (and unmounts it once nothing is in flight).
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()

    // The stream dies with NO terminal frame: the interruption banner lands
    // while the rows that DID arrive stay (real data, never retracted).
    stream.end()
    await flush()

    expect(screen.getByText('✗ Stream interrupted')).toBeInTheDocument()
    expect(screen.getByTestId('question-results')).toBeInTheDocument()
    expect(screen.getByText('billing → billing')).toBeInTheDocument()
    expect(screen.getByText('1.5 → 1.0')).toBeInTheDocument()
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()
  })

  it('renders progressive rows without the LLM bar on a plain compare run (no LLM leg)', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Compare with JEV/)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()

    // No LLM leg is pending after the comparison: rows, never the bar.
    expect(screen.getByTestId('question-results')).toBeInTheDocument()
    expect(screen.getByText('billing → billing')).toBeInTheDocument()
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()

    stream.push(finalFrame(COMPARE_RUN_SNAPSHOT))
    await flush()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getByTestId('question-results')).toBeInTheDocument()
    // Landed rows carry the snapshot id: the pair value is asserted on its
    // row (the JEV side is a link that splits the composed text).
    expect(screen.getByRole('link', { name: 'Inspect request_type' }).closest('li')).toHaveTextContent(
      'billing → billing'
    )
  })

  // P39 dual-review W1 (judge-escalated): the progressive rows belong to the
  // POSTED request. A mid-run edit of the textarea — even a VALID one that
  // renames a question — must never hide or reorder them: the run's facts
  // are the envelope's, not the live editor text. The validation panel may
  // re-detect whatever it wants; the rows stay until the final lands.
  it('keeps the posted request rows when a valid mid-run edit renames a question', async () => {
    const stream = sseResponse()
    // Validations answer by call count: the setup validates the sample;
    // after the mid-run edit the detector reports the RENAMED question.
    let validationCalls = 0
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') {
        return jsonOk({ emulator: { available: true }, jev: { available: true }, openai: { available: true } })
      }
      if (input === '/api/v1/validations') {
        validationCalls += 1
        const renamed = validationCalls <= 1
        return jsonOk({
          valid: true,
          questions: [
            { name: renamed ? 'request_type' : 'ticket_type', primitive: 'choice' },
            { name: 'urgency', primitive: 'score' },
            { name: 'refund_requested', primitive: 'noul' },
          ],
        })
      }
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return stream.response
      }
      return jsonOk({ items: [], next_cursor: null })
    })
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()
    expect(screen.getByText('billing → billing')).toBeInTheDocument()
    expect(screen.getByText('✓ request_type · CHOICE')).toBeInTheDocument()

    // The mid-run edit: a still-valid request whose first question is
    // RENAMED (ticket_type). The §19.1 debounce re-validates it.
    // P46 (W3): the run arming collapsed the input block — the mid-run edit
    // needs the editor back first.
    await expandRequestBlock()
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: SAMPLE_SYSTEM_ONE_REQUEST.replace(/request_type/g, 'ticket_type') },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // The detector now reports ticket_type — but the RUN is the posted
    // request_type: its row must still be exactly where it was.
    expect(screen.getByText('ticket_type')).toBeInTheDocument()
    expect(screen.getByText('✓ request_type · CHOICE')).toBeInTheDocument()
    expect(screen.getByText('billing → billing')).toBeInTheDocument()

    stream.push(sectionFrame('judge', 'success', RUN_JUDGE_SECTION))
    stream.push(finalFrame(EVALUATE_RUN_SNAPSHOT))
    await flush()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    // Parity: the final renders the posted request's rows.
    expect(screen.getByRole('link', { name: 'Inspect request_type' }).closest('li')).toHaveTextContent(
      'billing → billing'
    )
  })
})

// P41: the independent LLM section the advanced option composes — §31
// alignment present only on a successful, alignable prediction.
const RUN_INDEPENDENT_SECTION = {
  status: 'success',
  model: 'gpt-4o-mini-flash',
  result: { answers: {}, usage: { input_tokens: 90, output_tokens: 20 } },
  alignment: { aligned: true, questions: {} },
}

const EVALUATE_ADVANCED_SNAPSHOT = {
  ...EVALUATE_RUN_SNAPSHOT,
  independent_openai: RUN_INDEPENDENT_SECTION,
}

const EMULATOR_ADVANCED_SNAPSHOT = {
  ...EXECUTION_SNAPSHOT,
  independent_openai: RUN_INDEPENDENT_SECTION,
}

// P41: while the LLM legs (the Judge, and the Independent when advanced
// composes) keep flying, the hero slot stops being a skeleton the moment the
// comparison lands — the SAME HeroResult component renders the deterministic
// §22 subset (conclusion, fidelity %, N/M aligned, models, question count)
// with the Inspect CTA VISIBLE BUT DISABLED (no execution id exists mid-run,
// so no link, no duration, no id chip). The §32/§31 LLM lines join only when
// their own sections land; the completed final takes the slot verbatim.
describe('PrincipalView — progressive hero during the SSE run (P41)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('lands the progressive hero with the deterministic facts when the comparison arrives', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    await flush()
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    await flush()
    // Before the comparison: the skeleton still owns the slot (intact, P39).
    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument()

    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()

    // The skeleton is GONE: the progressive hero owns the slot with the
    // EXACT fixture facts — same component and format as the final hero.
    expect(screen.queryByTestId('hero-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getByText('96.8%')).toBeInTheDocument()
    expect(screen.getByText('JEV Fidelity')).toBeInTheDocument()
    expect(screen.getByText('3 / 3 questions aligned')).toBeInTheDocument()
    // FB2 superseded: the emulator's REAL model verbatim, like the JEV's.
    expect(screen.getByText('gpt-4o-mini-flash')).toBeInTheDocument()
    expect(screen.getByText('jev-latest')).toBeInTheDocument()
    expect(screen.getByText('Questions').nextElementSibling).toHaveTextContent('3')

    // CTA visible but disabled: the dictionary label, the accessible reason
    // (title + sr-only), no link — no execution id exists mid-run.
    const cta = screen.getByRole('button', { name: /Inspect in Investigation/ })
    expect(cta).toBeDisabled()
    expect(cta).toHaveAttribute('title', 'Available when the run completes')
    expect(cta).toHaveTextContent('Available when the run completes')
    expect(screen.queryByRole('link', { name: 'Inspect in Investigation' })).not.toBeInTheDocument()
    // Honesty contract: never a duration, never an id chip mid-run.
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('1,420 ms')).not.toBeInTheDocument()
    expect(screen.queryByTestId('execution-id-chip')).not.toBeInTheDocument()

    // Semantic 4/5: the strip keeps its in-flight rendering and the section
    // stays busy while the Judge leg is pending — P44: the feedback is the
    // CTA surface alone; the rows slot never carries a bar.
    expect(screen.getByTestId('source-chip-judge')).toHaveTextContent('Judge…')
    expect(screen.getByTestId('hero-result')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()

    stream.end()
    await flush()
  })

  it('lands each LLM line with its own frame and clears aria-busy when both legs resolve', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)
    // Advanced: the Independent LLM prediction composes with evaluate, so
    // BOTH LLM legs are pending after the comparison.
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Independent LLM prediction' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByTestId('hero-result')).toHaveAttribute('aria-busy', 'true')
    // No LLM line before its section lands (pending is not a verdict).
    expect(screen.queryByText(/Judge:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Independent: /)).not.toBeInTheDocument()

    // The judge frame lands the §32 line — as text, never a link mid-run.
    stream.push(sectionFrame('judge', 'success', RUN_JUDGE_SECTION))
    await flush()
    expect(screen.getByText('Judge: No material divergence')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Judge/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('source-chip-judge')).toHaveTextContent('Judge✓')
    // The independent leg is still pending: busy stays (the CTA surface
    // keeps its feedback — P44: no rows-slot bar anywhere).
    expect(screen.getByTestId('hero-result')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()

    // The independent frame lands the §31 line; both legs resolved, so
    // aria-busy clears and the CTA feedback unmounts — while the final has
    // NOT arrived.
    stream.push(sectionFrame('independent', 'success', RUN_INDEPENDENT_SECTION))
    await flush()
    expect(screen.getByText('Independent: aligned')).toBeInTheDocument()
    expect(screen.getByTestId('source-chip-independent')).toHaveTextContent('Independent✓')
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByTestId('hero-result')).not.toHaveAttribute('aria-busy')
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hero-skeleton')).not.toBeInTheDocument()

    stream.end()
    await flush()
  })

  it('lands the final hero verbatim — parity with the progressive facts, real link CTA, chip and duration', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Independent LLM prediction' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    stream.push(sectionFrame('judge', 'success', RUN_JUDGE_SECTION))
    stream.push(sectionFrame('independent', 'success', RUN_INDEPENDENT_SECTION))
    await flush()
    // The progressive state this test's parity claim starts from.
    expect(screen.getByText('96.8%')).toBeInTheDocument()
    expect(screen.getByText('3 / 3 questions aligned')).toBeInTheDocument()
    expect(screen.getByText('Judge: No material divergence')).toBeInTheDocument()
    expect(screen.getByText('Independent: aligned')).toBeInTheDocument()

    stream.push(finalFrame(EVALUATE_ADVANCED_SNAPSHOT))
    await flush()

    // The completed final takes the slot VERBATIM: the SAME strings.
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getByText('96.8%')).toBeInTheDocument()
    expect(screen.getByText('JEV Fidelity')).toBeInTheDocument()
    expect(screen.getByText('3 / 3 questions aligned')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o-mini-flash')).toBeInTheDocument()
    expect(screen.getByText('jev-latest')).toBeInTheDocument()
    expect(screen.getByText('Judge: No material divergence')).toBeInTheDocument()
    expect(screen.getByText('Independent: aligned')).toBeInTheDocument()

    // The CTA is the real §35 link with the snapshot id, enabled by
    // construction; the id chip and the duration are back.
    const cta = screen.getByRole('link', { name: 'Inspect in Investigation' })
    expect(cta.getAttribute('href')).toMatch(/^\/investigation\?execution=/)
    expect(cta).toHaveAttribute('href', '/investigation?execution=run_deadbeefcafe1234&question=request_type')
    expect(screen.queryByRole('button', { name: /Inspect in Investigation/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('execution-id-chip')).toHaveTextContent('run_deadbeefcafe1234')
    expect(screen.getAllByText('1,420 ms').length).toBeGreaterThan(0)
    // P46 (W3): the landed final keeps the input block collapsed — expand
    // before the Run re-enabled assertion.
    await expandRequestBlock()
    expect(screen.getByRole('button', { name: 'Run request' })).toBeEnabled()
  })

  it('keeps the progressive hero next to the failure banner on a mid-flight error — CTA stays disabled', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()

    // The Judge leg dies mid-flight: the banner speaks, the deterministic
    // facts that DID arrive stay (never retracted) — and no partial evidence
    // is inspectable, so the CTA remains disabled.
    stream.push(
      errorFrame({
        title: 'Judge Unavailable',
        detail: "The Judge could not be reached. Execution 'run_persisted123' was persisted with status 'failed'.",
        status: 502,
        execution_id: 'run_persisted123',
      })
    )
    await flush()

    expect(screen.getByText('✗ Judge Unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getByText('96.8%')).toBeInTheDocument()
    expect(screen.getByText('3 / 3 questions aligned')).toBeInTheDocument()
    const cta = screen.getByRole('button', { name: /Inspect in Investigation/ })
    expect(cta).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Inspect in Investigation' })).not.toBeInTheDocument()
    // Nothing is observably in flight anymore: no bar, no busy state.
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()
    expect(screen.getByTestId('hero-result')).not.toHaveAttribute('aria-busy')
  })

  // The explicit no-regression pin: without a comparison there is no
  // progressive hero — emulator runs (even with the advanced Independent
  // composing) keep the skeleton for the whole run.
  it('keeps the skeleton for the whole run in emulator mode (no comparison ever lands)', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Independent LLM prediction' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    await flush()
    stream.push(sectionFrame('independent', 'success', RUN_INDEPENDENT_SECTION))
    await flush()

    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
    expect(screen.queryByTestId('llm-progress')).not.toBeInTheDocument()

    // The completed final still owns the landing.
    stream.push(finalFrame(EMULATOR_ADVANCED_SNAPSHOT))
    await flush()
    expect(screen.queryByTestId('hero-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
  })
})

// P42: the run-progress bar — a DETERMINISTIC meter next to the progressive
// hero's disabled CTA (the alert the owner asked for: something still runs,
// calibrated to the ~60s response budget). Visibility follows the exact
// LLM-pending rule of aria-busy; the advance is floor(elapsed/600) capped
// at 95 (never 100 before the end); the elapsed seconds sit beside it.
// P44 superseded ADR-024 ruling 2's rows-slot llm-progress bar: this CTA
// surface (with P43's shimmer/spinner/label) is now the ONLY LLM
// in-flight feedback — the rows slot renders rows, nothing else.
describe('PrincipalView — hero CTA run-progress bar (P42)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  async function advanceMs(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  // The staged bar state: evaluate mode, the three deterministic frames in,
  // the Judge leg (and the Independent when `advanced` composes) in flight.
  async function runWithBar(options?: { advanced?: boolean }) {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)
    if (options?.advanced) {
      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Independent LLM prediction' }))
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()
    return { stream }
  }

  it('shows the bar next to the disabled CTA with honest advance and visible seconds', async () => {
    const { stream } = await runWithBar()
    // Let the elapsed clock run past the first second.
    await advanceMs(1000)

    const cta = screen.getByRole('button', { name: /Inspect in Investigation/ })
    expect(cta).toBeDisabled()
    const bar = screen.getByRole('progressbar')
    expect(bar).toBeVisible()
    // Beside the CTA: the two share the CTA's flex row.
    expect(cta.parentElement).toContainElement(bar)
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    const valueNow = Number(bar.getAttribute('aria-valuenow'))
    expect(Number.isInteger(valueNow)).toBe(true)
    expect(valueNow).toBeGreaterThanOrEqual(1)
    expect(valueNow).toBeLessThanOrEqual(95)
    // Accessible name from dictionary.run.llmInProgress — zero new keys.
    expect(bar).toHaveAttribute('aria-label', 'LLM query in progress…')
    // The elapsed seconds beside the bar, `<n> s` in tabular-nums.
    expect(screen.getByText(/\b\d+ s\b/)).toBeInTheDocument()

    stream.end()
    await flush()
  })

  it('advances deterministically with the ~60s budget and clamps at 95, never 100', async () => {
    const { stream } = await runWithBar()

    await advanceMs(30000)
    const at30s = Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))
    expect(at30s).toBeGreaterThanOrEqual(48)
    expect(at30s).toBeLessThanOrEqual(52)

    // Past the 60s budget the bar stays pinned at the honest "still working"
    // 95 — it can NEVER claim 100 before the run resolves.
    await advanceMs(35000)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '95')
    await advanceMs(10000)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '95')

    stream.end()
    await flush()
  })

  it('unmounts the bar (and clears aria-busy) when the LLM legs resolve, before the final', async () => {
    const { stream } = await runWithBar({ advanced: true })
    await advanceMs(1000)
    expect(screen.getByRole('progressbar')).toBeVisible()
    expect(screen.getByTestId('hero-result')).toHaveAttribute('aria-busy', 'true')

    stream.push(sectionFrame('judge', 'success', RUN_JUDGE_SECTION))
    stream.push(sectionFrame('independent', 'success', RUN_INDEPENDENT_SECTION))
    await flush()

    // The final is imminent once every leg resolved: nothing left to alert.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('hero-result')).not.toHaveAttribute('aria-busy')

    stream.end()
    await flush()
  })

  it('never renders the bar on the completed hero — the real §35 link owns the CTA row', async () => {
    const { stream } = await runWithBar()
    await advanceMs(1000)
    expect(screen.getByRole('progressbar')).toBeVisible()

    stream.push(sectionFrame('judge', 'success', RUN_JUDGE_SECTION))
    stream.push(finalFrame(EVALUATE_RUN_SNAPSHOT))
    await flush()

    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inspect in Investigation' })).toBeInTheDocument()

    stream.end()
  })

  it('never renders the bar on an emulator run (no progressive hero exists)', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    await advanceMs(2000)
    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    stream.push(finalFrame(EXECUTION_SNAPSHOT))
    await flush()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('keeps units.seconds a byte-identical proper unit in both dictionaries', () => {
    // Key parity is already forced by the i18n flatten test; the P42 pin is
    // the VALUE — a unit symbol, never a translated word.
    expect(en.units.seconds).toBe('s')
    expect(es.units.seconds).toBe('s')
  })
})

// P43: the hardened CTA feedback — the owner read the P42 determinate bar
// (1%/600ms on a thin track) as STATIC, the disabled grey button gave no
// feedback, and the reason lived only in title/sr-only attributes. Three
// VISIBLE additions to the SAME pending CTA row, none of them touching the
// P42 aria contract (ADR-027): a continuous indeterminate band sliding over
// the honest determinate fill, a spinner inside the disabled button, and the
// in-progress label as visible static text beside the track.
describe('PrincipalView — CTA feedback hardening (P43)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  async function advanceMs(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  // The same staged state P42's runWithBar builds (the helper is local to
  // that describe, so this mirrors it): evaluate mode, the deterministic
  // frames in, the LLM leg(s) in flight — the pending CTA row owns the
  // slot. One second of clock so the meter has visibly advanced.
  async function stagePendingCta(options?: { advanced?: boolean }) {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)
    if (options?.advanced) {
      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Independent LLM prediction' }))
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()
    await advanceMs(1000)
    return { stream }
  }

  it('renders the in-progress label as visible static text in the CTA row', async () => {
    const { stream } = await stagePendingCta()

    const cta = screen.getByRole('button', { name: /Inspect in Investigation/ })
    const label = within(cta.parentElement as HTMLElement).getByText(/LLM query in progress…/)
    // VISIBLE text — not sr-only, not just an aria-label on the meter.
    expect(label).not.toHaveClass('sr-only')
    expect(label).toBeVisible()

    // STATIC: zero per-tick mutation — the label is byte-identical after
    // five more seconds of ticks, while the aria-hidden seconds beside it
    // keep ticking (the P42 dual-review ruling: no live-region churn).
    const labelBefore = label.textContent
    const seconds = screen.getByText(/\b\d+ s\b/)
    expect(seconds).toHaveAttribute('aria-hidden', 'true')
    const secondsBefore = seconds.textContent
    await advanceMs(5000)
    expect(label.textContent).toBe(labelBefore)
    expect(screen.getByText(/\b\d+ s\b/).textContent).not.toBe(secondsBefore)

    stream.end()
    await flush()
  })

  it('slides a continuous indeterminate band over the determinate fill', async () => {
    const { stream } = await stagePendingCta()

    // The band lives INSIDE the meter's track, sibling of the deterministic
    // fill — and the fill keeps its exact width style (the P42 contract).
    const track = screen.getByRole('progressbar')
    const shimmer = within(track).getByTestId('cta-progress-shimmer')
    expect(track.children).toHaveLength(2)
    const fill = shimmer.previousElementSibling as HTMLElement
    expect(fill.style.width).toBe(`${track.getAttribute('aria-valuenow')}%`)
    // The continuous animation is ON the band itself.
    expect(shimmer.getAttribute('class')).toContain('animate-[cta-shimmer')
    // Decorative: the meter carries the semantics; the band only moves.
    expect(shimmer).toHaveAttribute('aria-hidden', 'true')

    // The motion is declared as CSS keyframes in globals.css, so the §72
    // reduced-motion block (pinned by tests/unit/globals-css.test.ts)
    // neutralizes it app-wide — duration 0.01ms + iteration-count 1 freeze
    // the slide for users who opt out of motion. Verified at the source.
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css).toMatch(/@keyframes\s+cta-shimmer\b/)
    expect(css).toContain('animation-iteration-count: 1')

    stream.end()
    await flush()
  })

  it('spins a hidden loader icon inside the disabled button', async () => {
    const { stream } = await stagePendingCta()

    const cta = screen.getByRole('button', { name: /Inspect in Investigation/ })
    expect(cta).toBeDisabled()
    // The spinner sits INSIDE the button next to the CTA text: the button
    // itself communicates activity, silently — aria-hidden because the
    // sr-only reason and the meter already speak for assistive tech.
    const spinner = cta.querySelector('svg')
    if (spinner === null) throw new Error('expected a spinner svg inside the disabled CTA')
    expect(spinner).toHaveAttribute('aria-hidden', 'true')
    expect(spinner.getAttribute('class')).toContain('animate-spin')
    // The accessible name is unchanged by the icon.
    expect(cta).toHaveTextContent('Inspect in Investigation')

    stream.end()
    await flush()
  })

  it('keeps the P42 aria contract intact beside the P43 additions', async () => {
    const { stream } = await stagePendingCta()

    const bar = screen.getByRole('progressbar')
    expect(bar).toBeVisible()
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    const valueNow = Number(bar.getAttribute('aria-valuenow'))
    expect(Number.isInteger(valueNow)).toBe(true)
    expect(valueNow).toBeGreaterThanOrEqual(1)
    expect(valueNow).toBeLessThanOrEqual(95)
    expect(bar).toHaveAttribute('aria-label', 'LLM query in progress…')
    // The meter sits in the CTA's flex row, beside the disabled button.
    const cta = screen.getByRole('button', { name: /Inspect in Investigation/ })
    expect(cta.parentElement).toContainElement(bar)

    stream.end()
    await flush()
  })

  it('unmounts the band, label and loader with the bar — none of it on the final hero', async () => {
    const { stream } = await stagePendingCta({ advanced: true })
    expect(screen.getByTestId('cta-progress-shimmer')).toBeInTheDocument()
    const cta = screen.getByRole('button', { name: /Inspect in Investigation/ })
    expect(within(cta.parentElement as HTMLElement).getByText(/LLM query in progress…/)).toBeInTheDocument()
    expect(cta.querySelector('svg')).not.toBeNull()

    // Both LLM legs resolve while the final has NOT arrived: everything P43
    // added disappears WITH the bar, even though the CTA stays disabled
    // until the final lands.
    stream.push(sectionFrame('judge', 'success', RUN_JUDGE_SECTION))
    stream.push(sectionFrame('independent', 'success', RUN_INDEPENDENT_SECTION))
    await flush()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cta-progress-shimmer')).not.toBeInTheDocument()
    expect(screen.queryByText(/LLM query in progress…/)).not.toBeInTheDocument()
    expect(cta.querySelector('svg')).toBeNull()
    expect(cta).toBeDisabled()

    // The final hero takes the slot: the real §35 link owns the CTA row and
    // none of the P43 surface exists anywhere on the page.
    stream.push(finalFrame(EVALUATE_ADVANCED_SNAPSHOT))
    await flush()
    expect(screen.getByRole('link', { name: 'Inspect in Investigation' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Inspect in Investigation/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cta-progress-shimmer')).not.toBeInTheDocument()
    expect(screen.queryByText(/LLM query in progress…/)).not.toBeInTheDocument()

    stream.end()
  })
})

// The JSON fallback lane: honest degradation when the response is not SSE.
describe('PrincipalView — JSON fallback lane (P28)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('uses the existing JSON handling when the ok response is application/json', async () => {
    const fetchMock = routeFetch(() => jsonOk(EXECUTION_SNAPSHOT, 201))
    await makeValid(fetchMock)

    await clickRun()

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    // The accept header was still sent; the SERVER just answered JSON.
    const headers = new Headers((executionPosts(fetchMock)[0] as [string, RequestInit])[1].headers)
    expect(headers.get('accept')).toBe('text/event-stream')
  })

  it('uses the existing problem handling when the response is not ok (pre-stream JSON errors)', async () => {
    const fetchMock = routeFetch(() =>
      jsonOk(
        {
          title: 'Unsupported question type',
          detail: "Question 'flag' has unsupported type 'boolean'.",
          status: 422,
        },
        422
      )
    )
    await makeValid(fetchMock)

    await clickRun()

    expect(screen.getByText('✗ Unsupported question type')).toBeInTheDocument()
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
  })

  it('falls back to the JSON lane when the response has no headers (defensive mocks)', async () => {
    const bare = {
      ok: true,
      status: 201,
      json: async () => EXECUTION_SNAPSHOT,
    } as unknown as Response
    const fetchMock = routeFetch(() => bare)
    await makeValid(fetchMock)

    await clickRun()

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
  })
})

// P47 (b): the scenario box above "Question results" — progressive↔final
// parity by construction. During the run the source is the POSTED envelope's
// system_one.state (postedRequestRef); when the final lands it becomes the
// persisted snapshot.request.state — the SAME box with the SAME content, so
// the switch of source is invisible. state null = box absent. The entryType
// widening (W2) is exercised with string and array states too.
describe('PrincipalView — scenario box above Question results (P47b)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('shows the box above the progressive rows from the POSTED envelope, then parity on final', async () => {
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()

    // Progressive phase: the box sits ABOVE the rows section, collapsed.
    const results = screen.getByTestId('principal-results')
    const box = within(results).getByTestId('scenario-box')
    const rows = within(results).getByTestId('question-results')
    expect(box.compareDocumentPosition(rows)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    // Expand and capture the progressive content (the posted envelope's state).
    fireEvent.click(within(box).getByRole('button', { name: /View scenario/ }))
    const state = JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST).state
    const progressiveText = within(box).getByTestId('scenario-content').textContent
    expect(progressiveText).toBe(JSON.stringify(state, null, 2))

    // The final lands: the SAME box, still expanded, with the SAME content
    // (parity — the source switch is invisible).
    stream.push(finalFrame(EVALUATE_RUN_SNAPSHOT))
    await flush()
    const landedBox = within(results).getByTestId('scenario-box')
    expect(landedBox).toBe(box)
    expect(within(landedBox).getByTestId('scenario-content').textContent).toBe(progressiveText)

    stream.end()
    await flush()
  })

  it('renders no results box when the request carries state: null (progressive and final)', async () => {
    const nullStateText = SAMPLE_SYSTEM_ONE_REQUEST.replace(/"state":\s*\{[^}]*\}/, '"state": null')
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
    render(<PrincipalView />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: nullStateText },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()

    // Rows render progressively, but no scenario box exists anywhere (the
    // editor's parse AND the posted envelope both carry state: null).
    expect(screen.getByTestId('question-results')).toBeInTheDocument()
    expect(screen.queryByTestId('scenario-box')).not.toBeInTheDocument()

    // The persisted final agrees: null state = absent box.
    stream.push(finalFrame({ ...EVALUATE_RUN_SNAPSHOT, request: JSON.parse(nullStateText) }))
    await flush()
    expect(screen.getByTestId('question-results')).toBeInTheDocument()
    expect(screen.queryByTestId('scenario-box')).not.toBeInTheDocument()

    stream.end()
    await flush()
  })

  it('renders a STRING state through the widened type — progressive parity and final (entryType)', async () => {
    const stringState = 'The customer was charged twice on invoice INV-2026-09.'
    const text = SAMPLE_SYSTEM_ONE_REQUEST.replace(/"state":\s*\{[^}]*\}/, '"state": ' + JSON.stringify(stringState))
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
    render(<PrincipalView />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: text },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await selectMode(/Evaluate prediction/)

    await clickRun()
    stream.push(sectionFrame('emulator', 'success', EXECUTION_SNAPSHOT.emulator))
    stream.push(sectionFrame('jev', 'success', RUN_JEV_SECTION))
    stream.push(sectionFrame('comparison', 'success', RUN_COMPARISON_SECTION))
    await flush()

    // P49 supersession: a string state IS the enunciado — it renders as RAW
    // prose (the P47 JSON-quoted pin is superseded; the scenario-box prose
    // pin owns the behavior — precedent R59/P44 flips). Progressive↔final
    // parity survives: both assertions below still pin the SAME content.
    const results = screen.getByTestId('principal-results')
    const box = within(results).getByTestId('scenario-box')
    fireEvent.click(within(box).getByRole('button', { name: /View scenario/ }))
    expect(within(box).getByTestId('scenario-content').textContent).toBe(stringState)

    stream.push(finalFrame({ ...EVALUATE_RUN_SNAPSHOT, request: JSON.parse(text) }))
    await flush()
    expect(within(results).getByTestId('scenario-content').textContent).toBe(stringState)

    stream.end()
    await flush()
  })

  it('renders an ARRAY state through the widened type on the landed final (entryType)', async () => {
    const arrayState = ['charged twice', 'invoice INV-42']
    const text = SAMPLE_SYSTEM_ONE_REQUEST.replace(
      /"state":\s*\{[^}]*\}/,
      '"state": ' + JSON.stringify(arrayState)
    )
    const stream = sseResponse()
    const fetchMock = routeFetch(() => stream.response)
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
    render(<PrincipalView />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: text },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    // Emulator run: the final snapshot carries the array state.
    await clickRun()
    stream.push(finalFrame({ ...EXECUTION_SNAPSHOT, request: JSON.parse(text) }))
    await flush()

    const results = screen.getByTestId('principal-results')
    const box = within(results).getByTestId('scenario-box')
    fireEvent.click(within(box).getByRole('button', { name: /View scenario/ }))
    expect(within(box).getByTestId('scenario-content').textContent).toBe(JSON.stringify(arrayState, null, 2))

    stream.end()
    await flush()
  })
})

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrincipalView } from '../../components/principal/principal-view'
import { LOCALE_CHANGED_EVENT, LOCALE_STORAGE_KEY } from '../../lib/i18n/use-locale'
import { SAMPLE_SYSTEM_ONE_REQUEST } from '../../lib/sample-request'

// P34 (FB7): Principal reads /?execution=<id> on mount through
// useSearchParams. This file never mocked next/navigation before (no
// component in the tree used it); the mock mirrors investigation-view.test.tsx.
const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.params,
}))

// F6 (dual-review R46): the file-wide mock's params are mutable — reset
// before EVERY test so a future describe appended after the P34 one cannot
// mount with a residual ?execution=<id> from its last test.
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

const INVALID_RESPONSE = {
  valid: false,
  error: {
    title: 'Unsupported question type',
    detail: "Question 'flag' has unsupported type 'boolean'. Supported types: choice, score, noul.",
  },
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

function validationCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((call) => call[0] === '/api/v1/validations')
}

async function typeJson(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
    target: { value },
  })
  // Advance past the debounce (350ms) and flush the fetch promise chain.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
}

// P46 (R61, W3 supersession): the input block now collapses behind the
// request-block disclosure when a run arms its POST or a case lands. The
// pins below that pre-date this behavior assert workbench contents (editor,
// validation, mode, Run/Clear) AFTER such a trigger — each one is re-scoped
// as expand-before-assert: trigger the collapse, expand the disclosure, then
// run the ORIGINAL assertion unchanged. Idempotent: a no-op when the block
// is already open (the re-collapse only comes from a NEW trigger).
async function expandRequestBlock() {
  const toggle = screen.getByTestId('request-toggle')
  if (toggle.getAttribute('aria-expanded') === 'true') return
  await act(async () => {
    fireEvent.click(toggle)
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('PrincipalView — JSON validation flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('validates parseable JSON against the API after the debounce', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/v1/executions')) {
        return jsonOk({ items: [], next_cursor: null })
      }
      return jsonOk(VALID_RESPONSE)
    })
    renderView(fetchMock)

    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: SAMPLE_SYSTEM_ONE_REQUEST },
    })

    expect(validationCalls(fetchMock)).toHaveLength(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(validationCalls(fetchMock)).toHaveLength(1)
    const [input, init] = validationCalls(fetchMock)[0] as [string, RequestInit]
    expect(input).toBe('/api/v1/validations')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toBe(SAMPLE_SYSTEM_ONE_REQUEST)
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')

    expect(screen.getByText('✓ VALID')).toBeInTheDocument()
    expect(screen.getByText('3 QUESTIONS DETECTED')).toBeInTheDocument()
  })

  it('shows the syntax error state without calling the API for malformed JSON', async () => {
    const fetchMock = vi.fn()
    renderView(fetchMock)

    await typeJson('{"state": ')

    expect(validationCalls(fetchMock)).toHaveLength(0)
    expect(screen.getByText('✗ Syntax error')).toBeInTheDocument()
  })

  it('renders the domain error verbatim when the request is invalid', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/v1/executions')) {
        return jsonOk({ items: [], next_cursor: null })
      }
      return jsonOk(INVALID_RESPONSE)
    })
    renderView(fetchMock)

    await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)

    expect(screen.getByText('✗ Unsupported question type')).toBeInTheDocument()
    expect(screen.getByText(INVALID_RESPONSE.error.detail)).toBeInTheDocument()
  })

  it('shows the unreachable state when the API call rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    renderView(fetchMock)

    await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)

    expect(screen.getByText('✗ API Unreachable')).toBeInTheDocument()
  })

  it('revalidates when the JSON changes again', async () => {
    // A Response body can only be consumed once: hand out a fresh one per call.
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/v1/executions')) {
        return jsonOk({ items: [], next_cursor: null })
      }
      return jsonOk(VALID_RESPONSE)
    })
    renderView(fetchMock)

    await typeJson('{"questions":{}}')
    expect(validationCalls(fetchMock)).toHaveLength(1)

    await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)
    expect(validationCalls(fetchMock)).toHaveLength(2)
    expect(screen.getByText('✓ VALID')).toBeInTheDocument()
  })

  // F6 (dual-review): a locale switch must not re-fire the debounced
  // /validations POST (no spurious request, no "checking" flash) — only a
  // JSON change may.
  it('does not re-fire the validation request when only the locale changes', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/v1/executions')) {
        return jsonOk({ items: [], next_cursor: null })
      }
      return jsonOk(VALID_RESPONSE)
    })
    renderView(fetchMock)

    await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)
    expect(validationCalls(fetchMock)).toHaveLength(1)

    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    await act(async () => {
      window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT))
      await vi.advanceTimersByTimeAsync(500)
    })

    // No new POST and no flash of the checking state; the panel merely
    // re-renders its verdict in Spanish.
    expect(validationCalls(fetchMock)).toHaveLength(1)
    expect(screen.queryByText('Validating…')).not.toBeInTheDocument()
    expect(screen.queryByText('Validando…')).not.toBeInTheDocument()
    expect(screen.getByText('✓ VÁLIDO')).toBeInTheDocument()
    expect(screen.getByText('3 PREGUNTAS DETECTADAS')).toBeInTheDocument()
  })

  // F6: pin the out-of-order guard — a slow response for an older edit must
  // not overwrite the verdict of a newer edit.
  it('ignores a stale validation response that resolves after a newer one', async () => {
    const pending: Array<(response: Response) => void> = []
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/v1/executions')) {
        return jsonOk({ items: [], next_cursor: null })
      }
      if (String(input) === '/api/v1/capabilities') {
        return jsonOk({ emulator: { available: true }, jev: { available: false } })
      }
      return new Promise<Response>((resolve) => pending.push(resolve))
    })
    renderView(fetchMock)

    // First edit: its response is held back and will resolve last.
    await typeJson('{"questions":{}}')
    expect(validationCalls(fetchMock)).toHaveLength(1)

    // Second edit: its response resolves first with the valid verdict.
    await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)
    expect(validationCalls(fetchMock)).toHaveLength(2)

    await act(async () => {
      pending[1](jsonOk(VALID_RESPONSE))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ VALID')).toBeInTheDocument()

    // The stale first response arrives afterwards and must be dropped.
    await act(async () => {
      pending[0](jsonOk(INVALID_RESPONSE))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ VALID')).toBeInTheDocument()
    expect(screen.queryByText('✗ Unsupported question type')).not.toBeInTheDocument()
  })
})

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
  // F5: the API snapshot carries the duration under runtime.duration_ms only
  // (top-level duration_ms is gone) — the hero must read the runtime source.
  runtime: { duration_ms: 1420 },
  provenance: { providers: [], versions: {}, timings: {} },
}

// Wave 1 compare snapshot: emulator + jev sections plus the deterministic
// comparison (components exactly as the API sends them).
const COMPARE_SNAPSHOT = {
  ...EXECUTION_SNAPSHOT,
  mode: 'compare',
  // Emulator answers as in EXECUTION_SNAPSHOT, with the noul probability on
  // the same side of .5 as the JEV answer (fixture-consistent alignment).
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
        urgency: {
          type: 'score',
          score: 1.5,
          confidence: 0.6,
          legend: { '0': 'low', '1': 'medium', '2': 'high' },
          probabilities: { '0': 0.1, '1': 0.6, '2': 0.3 },
        },
        refund_requested: { type: 'noul', noul: 0.082 },
      },
      usage: { input_tokens: 120, output_tokens: 40 },
    },
  },
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
        urgency: {
          type: 'score',
          score: 1.0,
          confidence: 0.6,
          legend: { '0': 'low', '1': 'medium', '2': 'high' },
          probabilities: { '0': 0.1, '1': 0.6, '2': 0.3 },
        },
        refund_requested: { type: 'noul', noul: 0.119 },
      },
      usage: { input_tokens: 130, output_tokens: 42 },
    },
  },
  comparison: {
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
  },
}

// Section 66 partial state: JEV failed — completed snapshot, NO comparison.
const JEV_FAILED_SNAPSHOT = {
  ...EXECUTION_SNAPSHOT,
  mode: 'compare',
  jev: { status: 'failed', error: 'The JEV could not be reached.' },
}

// W2: evaluate-run snapshot (§67) — ai_evaluation carries the Judge verdict;
// the Principal hero renders ONLY the overall semantic_divergence line.
const EVALUATE_SNAPSHOT = {
  ...COMPARE_SNAPSHOT,
  mode: 'compare-and-evaluate',
  ai_evaluation: {
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
  },
}

// W3: the §47/§51 independent_openai section — a third prediction plus its
// alignment booleans (ruling 6). Principal renders ONLY the overall line.
const INDEPENDENT_OPENAI_SECTION = {
  status: 'success',
  model: 'gpt-4o-mini-flash',
  result: {
    answers: {
      request_type: { type: 'choice', choice: 'billing', confidence: 0.88, probabilities: {} },
      urgency: { type: 'score', score: 1.2, confidence: 0.5, legend: {}, probabilities: {} },
      refund_requested: { type: 'noul', noul: 0.111 },
    },
    usage: { input_tokens: 100, output_tokens: 30 },
  },
  alignment: {
    aligned: true,
    questions: {
      request_type: { agrees_with_emulator: true, agrees_with_jev: true },
      urgency: { agrees_with_emulator: true, agrees_with_jev: true },
      refund_requested: { agrees_with_emulator: true, agrees_with_jev: true },
    },
  },
  run_config: {},
  llm_attempts: [],
}

// Route the mocked fetch by URL: validations POST, executions POST, recent GET.
function routeFetch(
  options: {
    executionStatus?: number
    executionBody?: unknown
    capabilities?: unknown
    capabilitiesFail?: boolean
  } = {}
) {
  return vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
    if (input === '/api/v1/capabilities') {
      if (options.capabilitiesFail) throw new TypeError('Failed to fetch')
      return jsonOk(
        options.capabilities ?? {
          emulator: { available: true },
          jev: { available: false },
          openai: { available: false },
        }
      )
    }
    if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
    if (input === '/api/v1/executions' && init?.method === 'POST') {
      return jsonOk(options.executionBody ?? EXECUTION_SNAPSHOT, options.executionStatus ?? 201)
    }
    if (String(input).startsWith('/api/v1/executions')) {
      return jsonOk({ items: [], next_cursor: null })
    }
    throw new Error(`unexpected fetch: ${String(input)}`)
  })
}

async function makeValid(fetchMock: ReturnType<typeof vi.fn>) {
  renderView(fetchMock)
  await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)
  expect(screen.getByText('✓ VALID')).toBeInTheDocument()
}

describe('PrincipalView — execution flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('keeps Run disabled while the request is not valid', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonOk({ items: [], next_cursor: null }))
    renderView(fetchMock)

    const run = screen.getByRole('button', { name: 'Run request' })
    expect(run).toBeDisabled()

    await typeJson('{"state": ')
    expect(screen.getByRole('button', { name: 'Run request' })).toBeDisabled()
    expect(validationCalls(fetchMock)).toHaveLength(0)
  })

  it('runs the emulator through the proxy and renders hero plus question rows', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    const run = screen.getByRole('button', { name: 'Run request' })
    expect(run).toBeEnabled()

    await act(async () => {
      fireEvent.click(run)
      await vi.advanceTimersByTimeAsync(0)
    })

    const executionCall = fetchMock.mock.calls.find(
      (call) => call[0] === '/api/v1/executions' && (call[1] as RequestInit).method === 'POST'
    ) as [string, RequestInit]
    expect(executionCall).toBeDefined()
    const body = JSON.parse(String(executionCall[1].body))
    expect(body).toEqual({ system_one: JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST), mode: 'emulator' })

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    // C5: the model and duration now appear in BOTH the hero facts and the
    // context-bar providers/duration segments — assert both occurrences.
    // FB2 (R40/P29) supersedes the raw-model pin: summary surfaces display
    // the emulator's REAL model as the run reported it (FB2 superseded).
    expect(screen.getAllByText('gpt-4o-mini-flash')).toHaveLength(2)
    expect(screen.getAllByText('1,420 ms')).toHaveLength(2)
    expect(screen.getByText('request_type · CHOICE')).toBeInTheDocument()
    expect(screen.getByText('billing')).toBeInTheDocument()
    expect(screen.getByText('urgency · SCORE')).toBeInTheDocument()
    expect(screen.getByText('refund_requested · NOUL')).toBeInTheDocument()
  })

  // W1: capabilities drive mode availability (plan section 63).
  it('fetches capabilities once on mount and keeps Compare with JEV disabled while unavailable', async () => {
    const fetchMock = routeFetch({ capabilities: { emulator: { available: true }, jev: { available: false } } })
    renderView(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const capabilityCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/v1/capabilities')
    expect(capabilityCalls).toHaveLength(1)

    expect(screen.getByRole('radio', { name: /Compare with JEV/ })).toBeDisabled()
    expect(screen.getByText('JEV is not configured.')).toBeInTheDocument()

    // The page is never blocked: Run still works for the emulator mode.
    await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)
    expect(screen.getByRole('button', { name: 'Run request' })).toBeEnabled()
  })

  it('posts the compare mode when JEV is available and Compare with JEV is selected', async () => {
    const fetchMock = routeFetch({ capabilities: { emulator: { available: true }, jev: { available: true } } })
    await makeValid(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const compare = screen.getByRole('radio', { name: /Compare with JEV/ })
    expect(compare).toBeEnabled()
    await act(async () => {
      fireEvent.click(compare)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect((compare as HTMLInputElement).checked).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    const executionCall = fetchMock.mock.calls.find(
      (call) => call[0] === '/api/v1/executions' && (call[1] as RequestInit).method === 'POST'
    ) as [string, RequestInit]
    const body = JSON.parse(String(executionCall[1].body))
    expect(body.mode).toBe('compare')
  })

  it('tolerates a failed capabilities fetch: no crash and Compare with JEV stays disabled', async () => {
    const fetchMock = routeFetch({ capabilitiesFail: true })
    renderView(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('radio', { name: /Compare with JEV/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Emulator/ })).toBeEnabled()
    expect(screen.queryByText(/Unhandled|crash/i)).not.toBeInTheDocument()
  })

  it('renders the full compare surface end to end: matched hero plus two-column rows', async () => {
    const fetchMock = routeFetch({
      capabilities: { emulator: { available: true }, jev: { available: true } },
      executionBody: COMPARE_SNAPSHOT,
    })
    await makeValid(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Compare with JEV/ }))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // Section 22 hero: conclusion first, fidelity percentage, alignment count.
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getByText('96.8%')).toBeInTheDocument()
    expect(screen.getByText('JEV Fidelity')).toBeInTheDocument()
    expect(screen.getByText('3 / 3 questions aligned')).toBeInTheDocument()
    expect(screen.getByText('jev-latest')).toBeInTheDocument()

    // Sections 28-30 rows in request order with both sides. §35/§45.3: with
    // the snapshot id present, each row deep-links into Investigación and the
    // JEV side of the pair is itself a link — the pair text is asserted on
    // the row (full subtree text).
    expect(screen.getByText('✓ request_type · CHOICE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inspect request_type' }).closest('li')).toHaveTextContent(
      'billing → billing'
    )
    expect(screen.getByText('Same decision')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inspect urgency' }).closest('li')).toHaveTextContent('1.5 → 1.0')
    expect(screen.getByRole('link', { name: 'Inspect refund_requested' }).closest('li')).toHaveTextContent(
      '.082 → .119'
    )
    expect(screen.getByText('Both < .5')).toBeInTheDocument()
  })

  // Section 66 partial state: JEV failed -> 201 completed snapshot without a
  // comparison. The hero stays honest (no fidelity numbers) and the question
  // rows fall back to the emulator-only variant.
  it('renders the honest JEV-unavailable hero and emulator rows on a JEV partial failure', async () => {
    const fetchMock = routeFetch({
      capabilities: { emulator: { available: true }, jev: { available: true } },
      executionBody: JEV_FAILED_SNAPSHOT,
    })
    await makeValid(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Compare with JEV/ }))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('✓ Run completed · JEV unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/fidelity/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/aligned/i)).not.toBeInTheDocument()
    // Emulator-only rows: single values, no arrows.
    expect(screen.getByText('request_type · CHOICE')).toBeInTheDocument()
    expect(screen.getByText('refund_requested · NOUL')).toBeInTheDocument()
    expect(screen.queryByText('→')).not.toBeInTheDocument()
  })

  it('disables Run while an execution is in flight', async () => {
    let resolveExecution: (value: Response) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveExecution = resolve
        })
      }
      return jsonOk({ items: [], next_cursor: null })
    })
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // P46 (W3): the run arming collapsed the input block — expand before the
    // mid-flight Run assertion.
    await expandRequestBlock()
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled()

    await act(async () => {
      resolveExecution(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
  })

  it('shows the 422 problem title and detail instead of a hero', async () => {
    const fetchMock = routeFetch({
      executionStatus: 422,
      executionBody: {
        title: 'Unsupported question type',
        detail: "Question 'flag' has unsupported type 'boolean'.",
        status: 422,
      },
    })
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('✗ Unsupported question type')).toBeInTheDocument()
    expect(screen.getByText("Question 'flag' has unsupported type 'boolean'.")).toBeInTheDocument()
    expect(screen.queryByText(/Run completed/)).not.toBeInTheDocument()
  })

  it('surfaces the persisted execution id on a 502 emulator-unavailable problem', async () => {
    const fetchMock = routeFetch({
      executionStatus: 502,
      executionBody: {
        title: 'Emulator Unavailable',
        detail: "The emulator could not be reached. Execution 'run_persisted123' was persisted with status 'failed'.",
        status: 502,
        execution_id: 'run_persisted123',
      },
    })
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('✗ Emulator Unavailable')).toBeInTheDocument()
    // The persisted execution id is surfaced on its own (the problem detail
    // also quotes it inside a longer sentence).
    expect(screen.getByText('run_persisted123')).toBeInTheDocument()
  })

  it('reloads recent executions after a successful run', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    const listCallsBefore = fetchMock.mock.calls.filter(
      (call) => String(call[0]).startsWith('/api/v1/executions') && (call[1] as RequestInit).method !== 'POST'
    ).length
    expect(listCallsBefore).toBe(1) // mount load

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    const listCallsAfter = fetchMock.mock.calls.filter(
      (call) => String(call[0]).startsWith('/api/v1/executions') && (call[1] as RequestInit).method !== 'POST'
    ).length
    expect(listCallsAfter).toBe(2)
  })
})

const OPENAI_CAPABILITIES = {
  emulator: { available: true },
  jev: { available: true },
  openai: { available: true },
}

async function postedBody(fetchMock: ReturnType<typeof vi.fn>) {
  const executionCall = fetchMock.mock.calls.find(
    (call) => call[0] === '/api/v1/executions' && (call[1] as RequestInit).method === 'POST'
  ) as [string, RequestInit]
  expect(executionCall).toBeDefined()
  return JSON.parse(String(executionCall[1].body))
}

// W1: Evaluate prediction is implemented and gated by capabilities.openai; the
// Advanced checkbox (section 11) composes the independent LLM prediction
// with ANY mode via advanced.independent_openai_prediction.
describe('PrincipalView — LLM gating (W1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('keeps Evaluate prediction and the Advanced checkbox disabled with the honest hint when LLM is not configured', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('radio', { name: /Evaluate prediction/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Independent LLM prediction' })).toBeDisabled()
    // One honest hint serves both LLM-gated surfaces.
    expect(screen.getAllByText('No LLM provider is configured.')).toHaveLength(2)
  })

  it('keeps both disabled when the capabilities fetch fails', async () => {
    const fetchMock = routeFetch({ capabilitiesFail: true })
    await makeValid(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('radio', { name: /Evaluate prediction/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Independent LLM prediction' })).toBeDisabled()
    expect(screen.getAllByText('No LLM provider is configured.')).toHaveLength(2)
    // The page is never blocked: the emulator still runs.
    expect(screen.getByRole('radio', { name: /Emulator/ })).toBeEnabled()
  })

  it('enables Evaluate prediction when LLM is available and posts the compare-and-evaluate mode', async () => {
    const fetchMock = routeFetch({ capabilities: OPENAI_CAPABILITIES })
    await makeValid(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const evaluate = screen.getByRole('radio', { name: /Evaluate prediction/ })
    expect(evaluate).toBeEnabled()
    await act(async () => {
      fireEvent.click(evaluate)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect((evaluate as HTMLInputElement).checked).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    const body = await postedBody(fetchMock)
    expect(body.mode).toBe('compare-and-evaluate')
    expect(body).toEqual({ system_one: JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST), mode: 'compare-and-evaluate' })
  })

  it('posts advanced.independent_openai_prediction with the evaluate mode when the checkbox is checked', async () => {
    const fetchMock = routeFetch({ capabilities: OPENAI_CAPABILITIES })
    await makeValid(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Evaluate prediction/ }))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Independent LLM prediction' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }));
      await vi.advanceTimersByTimeAsync(0)
    })

    const body = await postedBody(fetchMock)
    expect(body).toEqual({
      system_one: JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST),
      mode: 'compare-and-evaluate',
      advanced: { independent_openai_prediction: true },
    })
  })

  it('posts advanced.independent_openai_prediction with the emulator mode too (any mode composes)', async () => {
    const fetchMock = routeFetch({ capabilities: OPENAI_CAPABILITIES })
    await makeValid(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // Emulator stays selected; only the Advanced checkbox is toggled.
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Independent LLM prediction' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }));
      await vi.advanceTimersByTimeAsync(0)
    })

    const body = await postedBody(fetchMock)
    expect(body).toEqual({
      system_one: JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST),
      mode: 'emulator',
      advanced: { independent_openai_prediction: true },
    })
  })

  it('omits the advanced key entirely when the checkbox is left unchecked', async () => {
    const fetchMock = routeFetch({ capabilities: OPENAI_CAPABILITIES })
    await makeValid(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }));
      await vi.advanceTimersByTimeAsync(0)
    })

    const body = await postedBody(fetchMock)
    expect(body).toEqual({ system_one: JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST), mode: 'emulator' })
    expect('advanced' in body).toBe(false)
  })
})

// W2 (plan sections 22/32): an evaluate run renders the AI evaluation summary
// line in the hero — ONLY that line; the Judge's reasoning, quality verdict
// and per-question arbitration live in Investigación, not Principal.
describe('PrincipalView — AI evaluation hero line (W2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  async function runEvaluate(executionBody: unknown) {
    const fetchMock = routeFetch({ capabilities: OPENAI_CAPABILITIES, executionBody })
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Evaluate prediction/ }))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  it('renders the AI summary line under the aligned line and nothing else from the Judge', async () => {
    await runEvaluate(EVALUATE_SNAPSHOT)

    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getByText('3 / 3 questions aligned')).toBeInTheDocument()
    expect(screen.getByText('Judge: No material divergence')).toBeInTheDocument()

    // §32 forbidden surface: no reasoning, no quality verdict, no
    // question-level arbitration in Principal.
    expect(screen.queryByText('The emulator prediction preserves the request semantics in full.')).not.toBeInTheDocument()
    expect(screen.queryByText('excellent')).not.toBeInTheDocument()
    expect(screen.queryByText('strong')).not.toBeInTheDocument()
    expect(screen.queryByText('Both sides chose billing with near-identical confidence.')).not.toBeInTheDocument()
  })

  it('renders no AI line when the ai_evaluation section failed (never invent)', async () => {
    await runEvaluate({
      ...EVALUATE_SNAPSHOT,
      ai_evaluation: { status: 'failed', error: 'The Judge could not be reached.' },
    })

    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.queryByText(/Judge:/)).not.toBeInTheDocument()
    // G2/C7: the failed Judge IS visible — through the strip chip.
    expect(screen.getByTestId('source-chip-judge')).toHaveTextContent('Judge✗')
  })

  it('renders no AI line when the ai_evaluation section is absent', async () => {
    const { ai_evaluation: _absent, ...withoutAi } = EVALUATE_SNAPSHOT
    await runEvaluate(withoutAi)

    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.queryByText(/Judge:/)).not.toBeInTheDocument()
  })
})

// W3 (plan sections 22/31): the Independent check is secondary — one
// hero line from the overall alignment; per-question values stay in
// Investigación. It composes with any mode via the Advanced checkbox.
describe('PrincipalView — Independent hero line (W3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  async function runWith(options: { executionBody: unknown; evaluate?: boolean; advanced?: boolean }) {
    const fetchMock = routeFetch({ capabilities: OPENAI_CAPABILITIES, executionBody: options.executionBody })
    await makeValid(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    if (options.evaluate) {
      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: /Evaluate prediction/ }))
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    if (options.advanced) {
      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Independent LLM prediction' }))
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  it('renders the Independent line after the AI line, and no per-question independent values', async () => {
    await runWith({
      executionBody: { ...EVALUATE_SNAPSHOT, independent_openai: INDEPENDENT_OPENAI_SECTION },
      evaluate: true,
      advanced: true,
    })

    expect(screen.getByText('Judge: No material divergence')).toBeInTheDocument()
    expect(screen.getByText('Independent: aligned')).toBeInTheDocument()

    // §31: per-question independent values live in Investigación, not here.
    expect(screen.queryByText('1.2')).not.toBeInTheDocument()
    expect(screen.queryByText('agrees_with_emulator')).not.toBeInTheDocument()
  })

  it('renders no Independent line when the independent run failed (never invent)', async () => {
    await runWith({
      executionBody: {
        ...EVALUATE_SNAPSHOT,
        independent_openai: { status: 'failed', error: 'The independent LLM prediction could not be fetched.' },
      },
      evaluate: true,
      advanced: true,
    })

    expect(screen.queryByText(/Independent:/)).not.toBeInTheDocument()
    // The rest of the hero is unaffected.
    expect(screen.getByText('Judge: No material divergence')).toBeInTheDocument()
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
  })

  it('renders no Independent line when the result is unalignable (no alignment key)', async () => {
    const { alignment: _unalignable, ...unalignable } = INDEPENDENT_OPENAI_SECTION
    await runWith({
      executionBody: { ...EVALUATE_SNAPSHOT, independent_openai: unalignable },
      evaluate: true,
      advanced: true,
    })

    expect(screen.queryByText(/Independent:/)).not.toBeInTheDocument()
  })

  it('renders the Independent line on an emulator run with the advanced option', async () => {
    await runWith({
      executionBody: { ...EXECUTION_SNAPSHOT, independent_openai: INDEPENDENT_OPENAI_SECTION },
      advanced: true,
    })

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(screen.getByText('Independent: aligned')).toBeInTheDocument()
    expect(screen.queryByText(/Judge:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/fidelity/i)).not.toBeInTheDocument()
  })
})

// B3 (Judge F4): the hero asserts fidelity numbers tied to ONE exact request.
// Once the JSON text changes after a run, the old hero/rows would sit next to
// a DIFFERENT request and lie — they must reset to idle until the next run.
describe('PrincipalView — stale results after editing the JSON (B3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('clears the hero and question rows when the JSON changes after a completed run', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByText('request_type · CHOICE')).toBeInTheDocument()

    // P46 (W3): the landed run collapsed the input block — expand before the
    // B3 edit.
    await expandRequestBlock()
    await typeJson('{"questions":{"other_question":{"type":"choice"}}}')

    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
    expect(screen.queryByText(/Run completed/)).not.toBeInTheDocument()
    expect(screen.queryByText('request_type · CHOICE')).not.toBeInTheDocument()
    expect(screen.queryByText('billing')).not.toBeInTheDocument()
  })

  it('keeps the hero and rows while the JSON stays untouched (a locale switch must not clear them)', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // Unrelated re-render (F6 locale switch): jsonText did not change, so the
    // run results survive and merely re-render in Spanish.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    await act(async () => {
      window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT))
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByText('✓ Ejecución completada · 3 preguntas')).toBeInTheDocument()
    expect(screen.getByText('request_type · CHOICE')).toBeInTheDocument()
  })

  it('clears the failure banner when the JSON changes after a failed run', async () => {
    const fetchMock = routeFetch({
      executionStatus: 422,
      executionBody: {
        title: 'Unsupported question type',
        detail: "Question 'flag' has unsupported type 'boolean'.",
        status: 422,
      },
    })
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✗ Unsupported question type')).toBeInTheDocument()

    // P46 (W3): the failed run still collapsed the block at its arming —
    // expand before the B3 edit.
    await expandRequestBlock()
    await typeJson('{"questions":{"other_question":{"type":"choice"}}}')

    expect(screen.queryByText('✗ Unsupported question type')).not.toBeInTheDocument()
    expect(screen.queryByText("Question 'flag' has unsupported type 'boolean'.")).not.toBeInTheDocument()
  })

  // Pinned behavior (least surprising): an edit DURING a run does not cancel
  // it — the in-flight run belongs to the text it was started with, and its
  // result still lands. Only a LATER edit resets it.
  it('still renders the result when the JSON is edited while the run is in flight', async () => {
    let resolveExecution: (value: Response) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveExecution = resolve
        })
      }
      return jsonOk({ items: [], next_cursor: null })
    })
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // P46 (W3): the run arming collapsed the input block — the mid-flight
    // edit needs the editor back first.
    await expandRequestBlock()
    await typeJson('{"questions":{"other_question":{"type":"choice"}}}')

    await act(async () => {
      resolveExecution(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()

    // Once landed, the NEXT edit does reset the now-stale result.
    await typeJson('{"questions":{"yet_another":{"type":"score"}}}')
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
  })

  it('does not resurrect the old result when the JSON returns to the run text after an edit', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // Edit away, then paste the run's original text back: the result was
    // already invalidated — it only comes back with an explicit new run.
    // P46 (W3): the landed run collapsed the input block — expand for the
    // edits and the re-run.
    await expandRequestBlock()
    await typeJson('{"questions":{"other_question":{"type":"choice"}}}')
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()

    await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
    expect(screen.queryByText(/Run completed/)).not.toBeInTheDocument()

    // A new run on the same text brings the results back.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
  })
})

// Wave C (plan §35/§45.3): Principal passes the current execution id down so
// the question rows, the hero AI line and recent executions deep-link into
// Investigación. No run, no links.
describe('PrincipalView — Investigación deep links (§35/§45.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('renders no Inspect links before a run', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    expect(screen.queryByTestId('question-results')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Inspect/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /View in Investigation/ })).not.toBeInTheDocument()
  })

  it('passes the execution id to the question rows after an emulator run', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('link', { name: 'Inspect urgency' })).toHaveAttribute(
      'href',
      '/investigation?execution=run_deadbeefcafe1234&question=urgency&primitive=score'
    )
    expect(screen.getByRole('link', { name: 'Inspect refund_requested' })).toHaveAttribute(
      'href',
      '/investigation?execution=run_deadbeefcafe1234&question=refund_requested&primitive=noul'
    )
  })

  it('passes the execution id and the first question to the hero AI line on an evaluate run', async () => {
    const fetchMock = routeFetch({ executionBody: EVALUATE_SNAPSHOT })
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('link', { name: 'Judge: No material divergence — View in Investigation' })).toHaveAttribute(
      'href',
      '/investigation?execution=run_deadbeefcafe1234&question=request_type&focus=ai'
    )
  })
})

// STEP 9 Wave B (plan §72/§16): the run-result hero must be announced to
// screen readers, and the request input must not trigger iOS zoom on focus.
describe('PrincipalView — accessibility (§72/§16)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('announces the landed run result through a polite live region scoped to the hero', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    // R2 (dual-review): the polite status region is PERMANENTLY MOUNTED and
    // EMPTY before a run — ARIA APG pattern: live regions that mount WITH
    // their content announce inconsistently across screen readers.
    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveAttribute('aria-live', 'polite')
    expect(liveRegion).toBeEmptyDOMElement()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // The hero lands INSIDE the pre-existing region (§72 aria-live for
    // results): the content swap is what gets announced.
    const hero = screen.getByTestId('hero-result')
    expect(liveRegion).toContainElement(hero)

    // Scoped: exactly one live region in the view, wrapping the hero slot
    // only — never the Run button or the inputs (a page-wide region would
    // re-announce unrelated renders).
    // P46 (W3): the landed run collapsed the input block — expand so the
    // Run button exists to make the original scoping claim against.
    await expandRequestBlock()
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(liveRegion).not.toContainElement(screen.getByRole('button', { name: 'Run request' }))
  })

  it('announces FAILED runs too — the failure banner lands inside the live region (§72)', async () => {
    // R2 QUESTION (dual-review): "aria-live para resultados" covers failures;
    // a banner outside the region would announce successes but stay silent
    // on failures.
    const fetchMock = routeFetch({ executionStatus: 502, executionBody: { title: 'Emulator Unavailable', detail: 'The emulator is unreachable.' } })
    await makeValid(fetchMock)

    const liveRegion = screen.getByRole('status')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // The RFC 7807 problem title reaches the banner verbatim.
    const banner = screen.getByText('✗ Emulator Unavailable')
    expect(liveRegion).toContainElement(banner)
  })

  it('renders the request JSON textarea at a 16px+ mobile font (no-zoom gate)', async () => {
    const fetchMock = routeFetch()
    renderView(fetchMock)

    // text-base = 1rem = 16px: an input focused below 16px makes iOS Safari
    // zoom the page (§16 "no zoom requerido").
    expect(screen.getByRole('textbox', { name: 'Request JSON' })).toHaveClass('text-base')
  })
})

// FASE C wave 1 (C1/C3/C9/C11): the desktop workbench/results split, the
// Ctrl+Enter/Cmd+Enter shortcut, mobile result-first ordering after a run,
// and the in-flight hero skeleton with the running source strip.
describe('PrincipalView — FASE C split, shortcut and skeleton (C1/C3/C9/C11)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  function executionPosts(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.filter(
      (call) => call[0] === '/api/v1/executions' && (call[1] as RequestInit).method === 'POST'
    )
  }

  function fireShortcut(modifier: 'ctrlKey' | 'metaKey') {
    fireEvent.keyDown(window, { key: 'Enter', [modifier]: true })
  }

  it('posts the execution on Ctrl+Enter when the request is valid (C3)', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    await act(async () => {
      fireShortcut('ctrlKey')
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(executionPosts(fetchMock)).toHaveLength(1)
    const [input, init] = executionPosts(fetchMock)[0] as [string, RequestInit]
    expect(input).toBe('/api/v1/executions')
    expect(JSON.parse(String(init.body))).toEqual({
      system_one: JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST),
      mode: 'emulator',
    })
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
  })

  it('posts the execution on Cmd+Enter too (mac variant, C3)', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    await act(async () => {
      fireShortcut('metaKey')
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(executionPosts(fetchMock)).toHaveLength(1)
  })

  it('ignores the shortcut while the request is invalid (plan 19.1)', async () => {
    const fetchMock = routeFetch()
    renderView(fetchMock)

    await act(async () => {
      fireShortcut('ctrlKey')
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(executionPosts(fetchMock)).toHaveLength(0)
  })

  it('ignores the shortcut while an execution is already in flight', async () => {
    let resolveExecution: (value: Response) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveExecution = resolve
        })
      }
      return jsonOk({ items: [], next_cursor: null })
    })
    await makeValid(fetchMock)

    await act(async () => {
      fireShortcut('ctrlKey')
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireShortcut('metaKey')
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(executionPosts(fetchMock)).toHaveLength(1)

    await act(async () => {
      resolveExecution(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
  })

  it('pulls the results above the workbench on mobile after a run, never before (C9)', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    const results = screen.getByTestId('principal-results')
    expect(results).not.toHaveClass('order-first')
    expect(results).toContainElement(screen.getByRole('status'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByTestId('principal-results')).toHaveClass('order-first', 'lg:order-none')
    expect(screen.getByTestId('principal-results')).toContainElement(screen.getByTestId('hero-result'))
    expect(screen.getByTestId('principal-workbench')).toBeInTheDocument()
  })

  it('renders the hero skeleton with the four in-flight chips while running (C11)', async () => {
    let resolveExecution: (value: Response) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveExecution = resolve
        })
      }
      return jsonOk({ items: [], next_cursor: null })
    })
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    const skeleton = screen.getByTestId('hero-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toContainElement(skeleton)
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
    for (const source of ['emulator', 'jev', 'judge', 'independent'] as const) {
      expect(screen.getByTestId(`source-chip-${source}`)).toHaveTextContent('…')
    }

    await act(async () => {
      resolveExecution(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByTestId('hero-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
  })
})

// FASE C wave 2 (C5/C8): the canonical execution-context strip under the
// page title (honest idle/running/completed from the SAME summary that
// feeds the hero) and the pre-run provider health chips (tri-state §63 —
// unknown is never ✗, and before the capabilities fetch resolves every
// chip is unknown).
describe('PrincipalView — context bar and provider health (C5/C8)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('shows the honest no-active line before any run', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    const bar = screen.getByTestId('execution-context-bar')
    expect(bar).toHaveTextContent('No active execution')
    expect(bar).not.toHaveTextContent('Run ID')
  })

  it('shows the snapshot context after a completed run: short id, mode label, duration, providers', async () => {
    const fetchMock = routeFetch()
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    const bar = screen.getByTestId('execution-context-bar')
    expect(bar).toHaveTextContent('Run ID')
    expect(bar).toHaveTextContent('run_deadbeef')
    expect(bar).toHaveTextContent('Emulator') // mode label via the recent-executions idiom
    expect(bar).toHaveTextContent('1,420 ms')
    // FB2 superseded (owner 2026-09-27): the providers segment shows the
    // model that ACTUALLY ran — this fixture deliberately uses a confusing
    // 'gpt-4o-mini-flash' emulator model, now displayed verbatim.
    expect(bar).toHaveTextContent('gpt-4o-mini-flash')
    expect(bar).not.toHaveTextContent('No active execution')
  })

  it('keeps the bar honestly idle on a failed run (the banner carries the failure)', async () => {
    const fetchMock = routeFetch({
      executionStatus: 502,
      executionBody: { title: 'Emulator Unavailable', detail: 'The emulator is unreachable.', status: 502 },
    })
    await makeValid(fetchMock)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('✗ Emulator Unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('execution-context-bar')).toHaveTextContent('No active execution')
  })

  it('renders the provider chips unknown before the capabilities fetch resolves, then tri-state', async () => {
    let resolveCapabilities: (value: Response) => void = () => {}
    const gated = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') {
        return new Promise<Response>((resolve) => {
          resolveCapabilities = resolve
        })
      }
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') return jsonOk(EXECUTION_SNAPSHOT, 201)
      return jsonOk({ items: [], next_cursor: null })
    })
    renderView(gated)

    // First paint: capabilities pending — every chip is unknown ('…'), never ✗.
    const chips = screen.getByTestId('provider-health-chips')
    expect(chips).toHaveTextContent('…')
    expect(chips).not.toHaveTextContent('✗')

    await act(async () => {
      resolveCapabilities(jsonOk({ emulator: { available: true }, jev: { available: false } }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(chips).toHaveAttribute('aria-label', 'Emulator available · JEV unavailable · LLM unknown')
    // §63 conservative gating unchanged: explicit false still disables compare.
    expect(screen.getByRole('radio', { name: /Compare with JEV/ })).toBeDisabled()
  })

  it('marks explicitly unavailable providers ✗ from the capabilities fixture', async () => {
    const fetchMock = routeFetch() // default fixture: emulator ✓, jev ✗, openai ✗
    renderView(fetchMock)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const chips = screen.getByTestId('provider-health-chips')
    expect(chips).toHaveTextContent('✓')
    expect(chips).toHaveTextContent('✗')
  })

  // R37 (closure C9 finding): the order-first reorder puts the hero above
  // the workbench in the DOM, but the browser's scroll anchoring keeps the
  // user's scroll position after the run lands — the workbench stays in
  // front of the user and the hero never enters the fold (probe: scrollY
  // 1373 with the hero at y=336). On the stacked (below-lg) layout a
  // completed run must scroll the results into view; smooth scrolling
  // yields to prefers-reduced-motion (§72). The layout mock mirrors the
  // NEGATED-lg query ('not all and (min-width: 1024px)'); scrollIntoView is
  // restore in a finally so a failed assertion cannot leak the mock. The
  // layout mock mirrors the NEGATED-lg query ('not all and (min-width:
  // 1024px)') and leaves prefers-reduced-motion unmatched (smooth allowed).
  function stackLayoutMatchMedia() {
    return vi.fn((query: string) => ({
      matches: query.startsWith('not '),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  it('scrolls the results into view when a run completes on the stacked layout (C9)', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    vi.stubGlobal('matchMedia', stackLayoutMatchMedia())

    try {
      const fetchMock = routeFetch()
      await makeValid(fetchMock)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    } finally {
      // jsdom ships no scrollIntoView — restore the prototype we borrowed.
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  // §72: the yield to prefers-reduced-motion is a stated behavior — pin it.
  it('scrolls with behavior auto when the user prefers reduced motion (C9/§72)', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.startsWith('not ') || query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia
    )

    try {
      const fetchMock = routeFetch()
      await makeValid(fetchMock)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  // The same completed run on the DESKTOP grid must not hijack the scroll:
  // the results are already beside the workbench there.
  it('never scrolls on the desktop layout', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    vi.stubGlobal('matchMedia', matchMedia)

    try {
      const fetchMock = routeFetch()
      await makeValid(fetchMock)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })
})

// P30 (FB3, docs/feedback-v1-ux.md): clicking a recent-executions row hydrates
// Principal with the FULL persisted snapshot — the editor gets the request
// JSON back, the hero/rows render the completed (or failed) result, a chip
// names the execution it was loaded from, and Clear resets the surface.
// Hydration NEVER re-runs the execution (§50: a re-POST would duplicate runs).
describe('PrincipalView — P30 recents hidratan Principal + Clear', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  // One compare row whose detail snapshot is COMPARE_SNAPSHOT (same id as the
  // run fixtures — the aria-label composes the LIST item's mode/status).
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

  // Route the mocked fetch by URL: capabilities, validations POST, executions
  // POST (fresh runs), executions LIST (recents) and executions DETAIL by id
  // (the hydration GET — same route investigation-view uses).
  function routeHydrationFetch(
    options: {
      detailBody?: unknown
      detailStatus?: number
      detailReject?: boolean
      listItems?: unknown[]
      postBody?: unknown
    } = {}
  ) {
    return vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') return jsonOk(OPENAI_CAPABILITIES)
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return jsonOk(options.postBody ?? EXECUTION_SNAPSHOT, 201)
      }
      if (input.startsWith('/api/v1/executions/')) {
        if (options.detailReject) throw new TypeError('Failed to fetch')
        return jsonOk(options.detailBody ?? COMPARE_SNAPSHOT, options.detailStatus ?? 200)
      }
      // The recents list GET carries ?limit=5 — match the prefix like the
      // existing routeFetch does.
      if (String(input).startsWith('/api/v1/executions')) {
        return jsonOk({ items: options.listItems ?? [RECENT_ITEM], next_cursor: null })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    })
  }

  function executionPosts(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.filter(
      (call) => call[0] === '/api/v1/executions' && (call[1] as RequestInit).method === 'POST'
    )
  }

  // Render, let the capabilities + recents list fetches land (so the §63 mode
  // guard never races the restored mode), then click the row hydration button.
  async function hydrateFromRecent(fetchMock: ReturnType<typeof vi.fn>) {
    renderView(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const row = screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
    await act(async () => {
      fireEvent.click(row)
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  it('hydrates Principal from a recent execution: hero, rows, editor and origin chip', async () => {
    const fetchMock = routeHydrationFetch()
    await hydrateFromRecent(fetchMock)

    // The compare hero and the question rows render from the snapshot. The
    // fidelity percentage renders twice: hero + the recents row it came from.
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getAllByText('96.8%')).toHaveLength(2)
    expect(screen.getByTestId('question-results')).toBeInTheDocument()
    // Compare snapshot → two-column rows carry the aligned ✓ prefix.
    expect(screen.getByText('✓ request_type · CHOICE')).toBeInTheDocument()

    // The editor gets the snapshot's request back, pretty-printed.
    // P46 (W3): the landing hydration collapsed the input block — expand
    // before the editor assertion.
    await expandRequestBlock()
    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe(JSON.stringify(COMPARE_SNAPSHOT.request, null, 2))

    // The origin chip names the execution Principal was loaded from.
    const chip = screen.getByTestId('loaded-from-origin')
    expect(chip).toHaveTextContent('Loaded from execution run_deadbeef')
  })

  it('never auto-reruns on hydration: no POST to /api/v1/executions', async () => {
    const fetchMock = routeHydrationFetch()
    await hydrateFromRecent(fetchMock)

    // §50: hydration is a read-only load — a re-POST would duplicate executions.
    expect(executionPosts(fetchMock)).toHaveLength(0)
  })

  it('recalculates §19.1 validation over the hydrated request', async () => {
    const fetchMock = routeHydrationFetch()
    await hydrateFromRecent(fetchMock)

    // The hydration set the editor text, so the debounce fires again — the
    // verdict must reflect the restored request, not a stale one.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // P46 (W3): the landing hydration collapsed the input block — expand
    // before the §19.1 panel assertions.
    await expandRequestBlock()
    expect(screen.getByText('✓ VALID')).toBeInTheDocument()
    expect(screen.getByText('3 QUESTIONS DETECTED')).toBeInTheDocument()
  })

  it('checks the Advanced checkbox when the snapshot carried independent_openai', async () => {
    const fetchMock = routeHydrationFetch({
      detailBody: { ...COMPARE_SNAPSHOT, independent_openai: INDEPENDENT_OPENAI_SECTION },
    })
    await hydrateFromRecent(fetchMock)

    // P46 (W3): the landing hydration collapsed the input block — expand
    // before the Advanced assertion.
    await expandRequestBlock()
    expect(screen.getByRole('checkbox', { name: 'Independent LLM prediction' })).toBeChecked()
  })

  it('leaves the Advanced checkbox unchecked when the snapshot lacks independent_openai', async () => {
    const fetchMock = routeHydrationFetch({ detailBody: COMPARE_SNAPSHOT })
    await hydrateFromRecent(fetchMock)

    // P46 (W3): as above — expand before the Advanced assertion.
    await expandRequestBlock()
    expect(screen.getByRole('checkbox', { name: 'Independent LLM prediction' })).not.toBeChecked()
  })

  it('restores the snapshot mode: compare radio selected after hydration', async () => {
    const fetchMock = routeHydrationFetch()
    await hydrateFromRecent(fetchMock)

    // P46 (W3): the landing hydration collapsed the input block — expand
    // before the mode radio assertions.
    await expandRequestBlock()
    expect(screen.getByRole('radio', { name: /Compare with JEV/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Emulator/ })).not.toBeChecked()
  })

  it('Clear resets the editor, validation, hero, chip and advanced state', async () => {
    const fetchMock = routeHydrationFetch({
      detailBody: { ...COMPARE_SNAPSHOT, independent_openai: INDEPENDENT_OPENAI_SECTION },
    })
    await hydrateFromRecent(fetchMock)
    expect(screen.getByTestId('loaded-from-origin')).toBeInTheDocument()

    // P46 (W3): Clear lives INSIDE the collapsed block after a hydration —
    // expand before clicking it (Clear itself re-expands, T2.3).
    await expandRequestBlock()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe('')
    expect(screen.getByText('Paste a SystemOneRequest to validate it.')).toBeInTheDocument()
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
    expect(screen.queryByText(/Run completed/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Independent LLM prediction' })).not.toBeChecked()
  })

  it('editing the request after hydration drops the hero and the chip (B3)', async () => {
    const fetchMock = routeHydrationFetch()
    await hydrateFromRecent(fetchMock)
    expect(screen.getByTestId('hero-result')).toBeInTheDocument()
    expect(screen.getByTestId('loaded-from-origin')).toBeInTheDocument()

    // P46 (W3): the landing hydration collapsed the input block — expand
    // before the B3 edit.
    await expandRequestBlock()
    await typeJson('{"questions":{"other_question":{"type":"choice"}}}')

    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
  })

  it('renders the failure banner with the execution id and keeps the chip for a failed snapshot', async () => {
    const fetchMock = routeHydrationFetch({ detailBody: { ...COMPARE_SNAPSHOT, status: 'failed' } })
    await hydrateFromRecent(fetchMock)

    expect(screen.getByText('✗ Run failed')).toBeInTheDocument()
    expect(screen.getByText('run_deadbeefcafe1234')).toBeInTheDocument()

    // The editor was still restored — a failed snapshot IS a hydration (and
    // it collapsed the block like any landing case, P46/W3 — expand first).
    await expandRequestBlock()
    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe(JSON.stringify(COMPARE_SNAPSHOT.request, null, 2))
    expect(screen.getByTestId('loaded-from-origin')).toBeInTheDocument()
  })

  it('surfaces the problem title and detail when the detail fetch 404s', async () => {
    const fetchMock = routeHydrationFetch({
      detailStatus: 404,
      detailBody: {
        title: 'Execution not found',
        detail: 'This execution does not exist or is no longer available.',
        status: 404,
      },
    })
    await hydrateFromRecent(fetchMock)

    expect(screen.getByText('✗ Execution not found')).toBeInTheDocument()
    expect(screen.getByText('This execution does not exist or is no longer available.')).toBeInTheDocument()
    // A failed DETAIL load never claims an origin.
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
  })

  it('falls back to loadFailedTitle when the detail fetch rejects', async () => {
    const fetchMock = routeHydrationFetch({ detailReject: true })
    await hydrateFromRecent(fetchMock)

    expect(screen.getByText('✗ Could not load the execution.')).toBeInTheDocument()
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
  })

  it('a fresh run after hydration clears the origin chip', async () => {
    const fetchMock = routeHydrationFetch()
    await hydrateFromRecent(fetchMock)
    expect(screen.getByTestId('loaded-from-origin')).toBeInTheDocument()

    // §19.1 over the restored request, then a fresh run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // P46 (W3): the hydration collapsed the input block — Run lives inside
    // the disclosure, so expand before the fresh run.
    await expandRequestBlock()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    // A fresh run is not "loaded from" anything.
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
  })
})

describe('PrincipalView — P30 hardening (dual-review W1/W2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  // Manually-resolved promises so tests hold the detail GET / run POST open
  // across clicks and resolve them in the adversarial order.
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
      resolve = res
    })
    return { promise, resolve }
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

  function routePendingFetch(options: {
    detail?: Promise<Response>
    detailById?: Record<string, Promise<Response>>
    post?: Promise<Response>
    listItems?: unknown[]
  } = {}) {
    return vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') return jsonOk(OPENAI_CAPABILITIES)
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return options.post ?? jsonOk(EXECUTION_SNAPSHOT, 201)
      }
      if (input.startsWith('/api/v1/executions/')) {
        const pending = options.detailById?.[input.split('/').pop() ?? '']
        return pending ?? options.detail ?? jsonOk(COMPARE_SNAPSHOT)
      }
      if (String(input).startsWith('/api/v1/executions')) {
        return jsonOk({ items: options.listItems ?? [RECENT_ITEM], next_cursor: null })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    })
  }

  async function mount(fetchMock: ReturnType<typeof vi.fn>) {
    renderView(fetchMock)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  it('Clear is disabled while a run is in flight (W1: a mid-run Clear would strand the landing result next to an empty editor)', async () => {
    const post = deferred<Response>()
    const fetchMock = routePendingFetch({ post: post.promise })
    await mount(fetchMock)

    // Hydrate once so the editor holds a valid request, then start a run.
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // P46 (W3): the hydration collapsed the input block — expand before
    // arming the run.
    await expandRequestBlock()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // Mid-flight: Clear must not fire — "cancel" was never its contract and a
    // mid-run Clear would null runJsonRef, making the landing uninvalidable.
    // P46 (W3): the run arming re-collapsed the block — expand before the
    // mid-flight button assertions.
    await expandRequestBlock()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled()

    // The landing re-enables Clear.
    await act(async () => {
      post.resolve(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    // P46 (W3): the landed run keeps the block collapsed — expand for the
    // Clear assertion.
    await expandRequestBlock()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled()
  })

  it('drops a hydration whose detail GET resolves after a fresh run started (W2a: the live run owns the surface)', async () => {
    const detail = deferred<Response>()
    const post = deferred<Response>()
    const fetchMock = routePendingFetch({ detail: detail.promise, post: post.promise })
    await mount(fetchMock)

    // A valid request in the editor (this is what Run will post)…
    await typeJson(JSON.stringify(COMPARE_SNAPSHOT.request))
    // …then a recent click whose GET stays open…
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
    })
    // …and a run starts while that GET is still in flight.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    })

    // The stale hydration resolves LAST: it must be dropped — no chip, no
    // compare hero, and the skeleton proves the run still owns the slot.
    await act(async () => {
      detail.resolve(jsonOk(COMPARE_SNAPSHOT))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    expect(screen.queryByText('✓ PREDICTION MATCHED JEV')).not.toBeInTheDocument()
    expect(screen.getByTestId('hero-skeleton')).toBeInTheDocument()
    // P46 (W3): the run arming collapsed the input block — expand before the
    // editor assertion.
    await expandRequestBlock()
    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe(JSON.stringify(COMPARE_SNAPSHOT.request))

    // The run then lands normally, still with no origin chip.
    await act(async () => {
      post.resolve(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
  })

  it('drops a hydration when the editor changed while the detail GET was pending (W2b: the newer intent wins)', async () => {
    const detail = deferred<Response>()
    const fetchMock = routePendingFetch({ detail: detail.promise })
    await mount(fetchMock)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
    })
    // The user types while the GET is open — restoring the snapshot now would
    // clobber their text.
    await typeJson('{"questions":{"typed_during":{"type":"choice"}}}')

    await act(async () => {
      detail.resolve(jsonOk(COMPARE_SNAPSHOT))
      await vi.advanceTimersByTimeAsync(0)
    })

    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe('{"questions":{"typed_during":{"type":"choice"}}}')
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    expect(screen.queryByText('✓ PREDICTION MATCHED JEV')).not.toBeInTheDocument()
  })

  it('the newest recent click wins when two detail GETs resolve out of order (W2 epoch)', async () => {
    const RECENT_ITEM_B = { ...RECENT_ITEM, execution_id: 'run_ffffaaaabbbb' }
    const detailA = deferred<Response>()
    const detailB = deferred<Response>()
    const fetchMock = routePendingFetch({
      detailById: {
        [RECENT_ITEM.execution_id]: detailA.promise,
        [RECENT_ITEM_B.execution_id]: detailB.promise,
      },
      listItems: [RECENT_ITEM, RECENT_ITEM_B],
    })
    await mount(fetchMock)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_ffffaaaa — Compare with JEV, Completed' })
      )
    })

    // B resolves first and lands…
    await act(async () => {
      detailB.resolve(jsonOk({ ...COMPARE_SNAPSHOT, execution_id: RECENT_ITEM_B.execution_id }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('loaded-from-origin')).toHaveTextContent('Loaded from execution run_ffffaaaa')

    // …then the OLDER A resolves: out-of-order GETs never overwrite the
    // newest click.
    await act(async () => {
      detailA.resolve(jsonOk(COMPARE_SNAPSHOT))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('loaded-from-origin')).toHaveTextContent('Loaded from execution run_ffffaaaa')
  })

  it('drops a hydration that resolves after a run already landed (round-2 residual: a run is a newer intent too)', async () => {
    const detail = deferred<Response>()
    const post = deferred<Response>()
    const fetchMock = routePendingFetch({ detail: detail.promise, post: post.promise })
    await mount(fetchMock)

    await typeJson(JSON.stringify(COMPARE_SNAPSHOT.request))
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
    })
    // The run starts AND lands while the detail GET is still open.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      post.resolve(jsonOk(EXECUTION_SNAPSHOT, 201))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()

    // The slow GET resolving now must NOT overwrite the fresh run's result.
    await act(async () => {
      detail.resolve(jsonOk(COMPARE_SNAPSHOT))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    // P46 (W3): the landed run keeps the input block collapsed — expand
    // before the editor assertion.
    await expandRequestBlock()
    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe(JSON.stringify(COMPARE_SNAPSHOT.request))
  })

  it('drops a hydration that resolves after Clear (round-2 residual: Clear with a virgin editor bumps the epoch, not the text)', async () => {
    const detail = deferred<Response>()
    const fetchMock = routePendingFetch({ detail: detail.promise })
    await mount(fetchMock)

    // Click a recent with a virgin editor, then Clear while the GET is open.
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // The text ref cannot distinguish '' from '' — the epoch must drop it.
    await act(async () => {
      detail.resolve(jsonOk(COMPARE_SNAPSHOT))
      await vi.advanceTimersByTimeAsync(0)
    })
    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe('')
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    expect(screen.queryByText('✓ PREDICTION MATCHED JEV')).not.toBeInTheDocument()
  })
})

// P34 (FB7): URL entry — /?execution=<id> hydrates Principal on mount through
// the SAME P30 handler (guards W2 intact: never clobbers a run, never
// re-POSTs). One-shot: a later locale switch or re-render must not re-fire
// the detail GET (re-hydrating would clobber the user's editing state).
describe('PrincipalView — P34 URL hydration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    navigation.params = new URLSearchParams()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  // Same routing table as the P30 describe: capabilities, validations POST,
  // executions POST (which must NEVER fire here), executions LIST and the
  // DETAIL by id the hydration GET reads.
  function routeUrlHydrationFetch(detailBody: unknown = COMPARE_SNAPSHOT) {
    return vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') return jsonOk(OPENAI_CAPABILITIES)
      if (input === '/api/v1/validations') return jsonOk(VALID_RESPONSE)
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return jsonOk(EXECUTION_SNAPSHOT, 201)
      }
      if (input.startsWith('/api/v1/executions/')) {
        return jsonOk(detailBody)
      }
      if (String(input).startsWith('/api/v1/executions')) {
        return jsonOk({ items: [], next_cursor: null })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    })
  }

  function detailCalls(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/v1/executions/'))
  }

  function executionPosts(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.filter(
      (call) => call[0] === '/api/v1/executions' && (call[1] as RequestInit).method === 'POST'
    )
  }

  async function advance(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('hydrates from /?execution=<id>: editor, origin chip and hero — and never POSTs a run', async () => {
    navigation.params = new URLSearchParams(`execution=${COMPARE_SNAPSHOT.execution_id}`)
    const fetchMock = routeUrlHydrationFetch()
    renderView(fetchMock)
    await advance()

    // The editor gets the snapshot's request back, pretty-printed.
    // P46 (W3): the URL hydration collapsed the input block on landing —
    // expand before the editor assertion.
    await expandRequestBlock()
    const editor = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(editor.value).toBe(JSON.stringify(COMPARE_SNAPSHOT.request, null, 2))
    expect(screen.getByTestId('loaded-from-origin')).toBeVisible()
    expect(screen.getByTestId('hero-result')).toBeVisible()

    // §50: URL hydration is read-only — only capabilities/list/detail fired.
    expect(executionPosts(fetchMock)).toHaveLength(0)
  })

  it('fetches no detail GET and renders no chip without the param', async () => {
    const fetchMock = routeUrlHydrationFetch()
    renderView(fetchMock)
    await advance()

    expect(detailCalls(fetchMock)).toHaveLength(0)
    expect(screen.queryByTestId('loaded-from-origin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hero-result')).not.toBeInTheDocument()
  })

  it('hydrates exactly once: a locale switch after hydration fires no second detail GET', async () => {
    navigation.params = new URLSearchParams(`execution=${COMPARE_SNAPSHOT.execution_id}`)
    const fetchMock = routeUrlHydrationFetch()
    renderView(fetchMock)
    await advance()
    expect(detailCalls(fetchMock)).toHaveLength(1)
    expect(screen.getByTestId('loaded-from-origin')).toBeVisible()

    // A locale switch re-renders the whole tree — the mount-only effect must
    // not re-fire (the one-shot contract of URL entry).
    await act(async () => {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
      window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT))
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(detailCalls(fetchMock)).toHaveLength(1)
  })
})

// P47: the scenario (`state`) becomes visible on Principal through the ONE
// shared ScenarioBox. (a) lives inside the validation panel fed by the LIVE
// editor parse (independent of the /validations API); (b) sits above
// "Question results" with progressive↔final parity — during the run the POSTED
// envelope's system_one.state, once landed/hydrated the persisted
// snapshot.request.state. state null/absent = box ABSENT everywhere.
describe('PrincipalView — scenario visibility (P47a validation panel + P47b hydration)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

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

  // Routes fetch by URL with a FAILING /validations endpoint (P47a live-source
  // pin) or the normal VALID_RESPONSE, plus recents list + detail by id.
  function routeP47Fetch(options: { validationsFail?: boolean; detailBody?: unknown } = {}) {
    return vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === '/api/v1/capabilities') {
        return jsonOk({ emulator: { available: true }, jev: { available: true }, openai: { available: true } })
      }
      if (input === '/api/v1/validations') {
        if (options.validationsFail) {
          return jsonOk(
            { title: 'API Unreachable', detail: 'The jevals API could not be reached.', status: 502 },
            502
          )
        }
        return jsonOk(VALID_RESPONSE)
      }
      if (input === '/api/v1/executions' && init?.method === 'POST') {
        return jsonOk(EXECUTION_SNAPSHOT, 201)
      }
      if (input.startsWith('/api/v1/executions/')) {
        return jsonOk(options.detailBody ?? COMPARE_SNAPSHOT)
      }
      if (String(input).startsWith('/api/v1/executions')) {
        return jsonOk({ items: [RECENT_ITEM], next_cursor: null })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    })
  }

  it('(a) shows the box collapsed under the detected questions while editing the sample', async () => {
    renderView(routeP47Fetch())
    await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)

    const panel = screen.getByTestId('validation-panel')
    const box = within(panel).getByTestId('scenario-box')
    expect(within(box).getByRole('button', { name: /View scenario/ })).toHaveAttribute('aria-expanded', 'false')
    // Under the questions detected: the detection-source line precedes the box.
    const detectionSource = within(panel).getByText('Detection source: questions[name].type')
    expect(detectionSource.compareDocumentPosition(box)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    // Expanding reveals the EXACT sample state, pretty-printed.
    fireEvent.click(within(box).getByRole('button', { name: /View scenario/ }))
    const state = JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST).state
    expect(within(box).getByTestId('scenario-content').textContent).toBe(JSON.stringify(state, null, 2))
  })

  it('(a) renders no box for a valid request whose state is null', async () => {
    renderView(routeP47Fetch())
    await typeJson(
      SAMPLE_SYSTEM_ONE_REQUEST.replace(
        /"state":\s*\{[^}]*\}/,
        '"state": null'
      )
    )

    expect(screen.getByText('✓ VALID')).toBeInTheDocument()
    expect(screen.queryByTestId('scenario-box')).not.toBeInTheDocument()
  })

  it('(a) renders no box while the JSON does not parse (syntax error)', async () => {
    renderView(routeP47Fetch())
    await typeJson('{"state": {"message": "broken"')

    expect(screen.getByText('✗ Syntax error')).toBeInTheDocument()
    expect(screen.queryByTestId('scenario-box')).not.toBeInTheDocument()
  })

  it('(a) keeps the box when the /validations API fails — the source is the live parse', async () => {
    renderView(routeP47Fetch({ validationsFail: true }))
    await typeJson(SAMPLE_SYSTEM_ONE_REQUEST)

    // The panel honestly shows the API problem...
    expect(screen.getByText('✗ API Unreachable')).toBeInTheDocument()
    // ...but the scenario box does NOT depend on that API: the parse is alive.
    const panel = screen.getByTestId('validation-panel')
    expect(within(panel).getByTestId('scenario-box')).toBeInTheDocument()
  })

  it('(b) hydrates the box above Question results from snapshot.request.state', async () => {
    renderView(routeP47Fetch())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    const results = screen.getByTestId('principal-results')
    const box = within(results).getByTestId('scenario-box')
    // Above "Question results": the rows section follows the box in the DOM.
    const rows = within(results).getByTestId('question-results')
    expect(box.compareDocumentPosition(rows)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    // The persisted path (snapshot.request.state) is the landed source — the
    // exact hydrated state, pretty-printed once expanded.
    fireEvent.click(within(box).getByRole('button', { name: /View scenario/ }))
    const state = JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST).state
    expect(within(box).getByTestId('scenario-content').textContent).toBe(JSON.stringify(state, null, 2))
  })

  it('(b) hydrates no box when the snapshot carries state: null', async () => {
    const nullStateSnapshot = {
      ...COMPARE_SNAPSHOT,
      request: { ...COMPARE_SNAPSHOT.request, state: null },
    }
    renderView(routeP47Fetch({ detailBody: nullStateSnapshot }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Load execution run_deadbeef — Compare with JEV, Completed' })
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByTestId('question-results')).toBeInTheDocument()
    expect(screen.queryByTestId('scenario-box')).not.toBeInTheDocument()
  })
})

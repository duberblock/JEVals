import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InvestigationView } from '../../components/investigation/investigation-view'
import { compareSnapshot, emulatorSnapshot, RUN_ID } from '../fixtures/investigation-snapshot'
import { LOCALE_STORAGE_KEY } from '../../lib/i18n/use-locale'
import { EXTREME_LABEL } from './extreme-labels'

// The page reads its contract params (§45.3 deep links) from the URL:
// ?execution=<id>&question=<name>&primitive=<p>&source=<why|...>&focus=ai
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

describe('InvestigationView — page shell (W1)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams(`execution=${RUN_ID}`)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the execution by id and renders the focused question from the URL param', async () => {
    navigation.params = new URLSearchParams(`execution=${RUN_ID}&question=urgency&primitive=score&source=why`)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    // §37 header: Investigation · <question name> · <PRIMITIVE>
    expect(await screen.findByText('Investigation · urgency · SCORE')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/executions/${RUN_ID}`, { method: 'GET' })
  })

  it('defaults to the first question in request order when no question param exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByText('Investigation · request_type · CHOICE')).toBeInTheDocument()
  })

  it('shows the question instructions from the request under the header', async () => {
    navigation.params = new URLSearchParams(`execution=${RUN_ID}&question=request_type`)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByText('Classify this request.')).toBeInTheDocument()
  })

  it('renders the question selector pills when the execution has multiple questions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByText('Investigation · request_type · CHOICE')).toBeInTheDocument()
    const selector = screen.getByTestId('question-selector')
    expect(selector).toHaveTextContent('request_type')
    expect(selector).toHaveTextContent('urgency')
    expect(selector).toHaveTextContent('refund_requested')
  })

  it('switching questions updates the URL params and keeps the execution', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

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

  it('renders an honest not-found state on a 404 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Execution not found.' }, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByText('Execution not found')).toBeInTheDocument()
    expect(screen.queryByText(/Investigation ·/)).not.toBeInTheDocument()
  })

  it('renders the error state with the problem title on a 502 problem body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { title: 'API Unreachable', detail: 'The jevals API could not be reached.', status: 502 },
        { status: 502, headers: { 'content-type': 'application/problem+json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByText('✗ Could not load the execution.')).toBeInTheDocument()
    expect(screen.getByText(/API Unreachable/)).toBeInTheDocument()
  })

  it('renders the error state when the fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByText('✗ Could not load the execution.')).toBeInTheDocument()
  })

  it('renders the missing-execution state and fetches nothing without an execution param', () => {
    navigation.params = new URLSearchParams()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(screen.getByText('No execution selected')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the two-level WHY | EVIDENCE switch (§36) and enters Evidence on the source param', async () => {
    navigation.params = new URLSearchParams(`execution=${RUN_ID}&source=ai`)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByTestId('evidence-view')).toBeInTheDocument()
    expect(screen.getByTestId('switch-why')).toBeInTheDocument()
    expect(screen.getByTestId('switch-evidence')).toBeInTheDocument()
  })

  it('returning to WHY from Evidence updates the URL source param', async () => {
    navigation.params = new URLSearchParams(`execution=${RUN_ID}&question=urgency&source=ai`)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)
    await screen.findByTestId('evidence-view')

    fireEvent.click(screen.getByTestId('switch-why'))

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        `/investigation?execution=${RUN_ID}&question=urgency&source=why`,
        { scroll: false }
      )
    })
  })

  it('switching to Evidence from WHY defaults the source to Request (§45.3)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)
    await screen.findByTestId('why-view')

    fireEvent.click(screen.getByTestId('switch-evidence'))

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        `/investigation?execution=${RUN_ID}&question=request_type&source=request`,
        { scroll: false }
      )
    })
  })

  it('renders an honest single-value layout for an emulator-only run', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(emulatorSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByText('Investigation · request_type · CHOICE')).toBeInTheDocument()
  })
})

// W5: §45.3 focus=ai deep link, §45.7 discipline and the §38 audit at page level.
describe('InvestigationView — focus, layout discipline and §38 audit (W5)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams(`execution=${RUN_ID}`)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('arrives with the AI reasoning expanded when focus=ai is present', async () => {
    navigation.params = new URLSearchParams(`execution=${RUN_ID}&question=urgency&source=why&focus=ai`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(compareSnapshot())))

    render(<InvestigationView />)

    // P35/FB8: the focused question's reason now also renders inline as the
    // clamped excerpt, so findByText matches twice — scope to the disclosure
    // block (the test's intent: focus=ai arrives EXPANDED).
    expect(await screen.findByTestId('ai-reasoning')).toHaveTextContent(/Scores differ but stay in the same band\./)
  })

  it('renders the WHY view without any of the §38 forbidden-by-default content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(compareSnapshot())))

    render(<InvestigationView />)
    await screen.findByTestId('why-view')

    expect(screen.queryByText(/Copy/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Full LLM exchange/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Find/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sha256:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2,500 ms/)).not.toBeInTheDocument()
    expect(screen.queryByText(/{/)).not.toBeInTheDocument()
  })

  it('shows the evidence payload views only after switching away from WHY (§34)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(compareSnapshot())))

    render(<InvestigationView />)
    await screen.findByTestId('why-view')
    expect(screen.queryByText(/Copy analysis bundle/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('switch-evidence'))
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        `/investigation?execution=${RUN_ID}&question=request_type&source=request`,
        { scroll: false }
      )
    })
  })
})

// P36/FB9: a no-spaces question name (the owner's worst case) must render
// in the §37 header and wrap — wrap-anywhere on the h1 — never push the
// header wider than the viewport (§16).
describe('InvestigationView — extreme question name (P36/FB9)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Renames one question across every section that keys by question name
  // (request, answers, comparison, judge, independent alignment) — the
  // §47 snapshot shape the real API persists.
  function renameQuestion(
    snapshot: ReturnType<typeof compareSnapshot>,
    from: string,
    to: string
  ): ReturnType<typeof compareSnapshot> {
    const next = JSON.parse(JSON.stringify(snapshot)) as ReturnType<typeof compareSnapshot>
    const questions = next.request.questions ?? {}
    if (questions[from] !== undefined) {
      // Rebuild via entries so the renamed question KEEPS its position — the
      // first request question is what the page focuses by default.
      next.request.questions = Object.fromEntries(
        Object.entries(questions).map(([key, value]) => (key === from ? [to, value] : [key, value]))
      )
    }
    for (const section of [next.emulator, next.jev]) {
      const answers = section?.result?.answers
      if (answers?.[from] !== undefined) {
        answers[to] = answers[from]
        delete answers[from]
      }
    }
    const comparisonQuestions = next.comparison?.questions
    if (comparisonQuestions?.[from] !== undefined) {
      comparisonQuestions[to] = comparisonQuestions[from]
      delete comparisonQuestions[from]
    }
    const judgeQuestions = next.ai_evaluation?.questions
    if (judgeQuestions?.[from] !== undefined) {
      judgeQuestions[to] = judgeQuestions[from]
      delete judgeQuestions[from]
    }
    const independentAnswers = next.independent_openai?.result?.answers
    if (independentAnswers?.[from] !== undefined) {
      independentAnswers[to] = independentAnswers[from]
      delete independentAnswers[from]
    }
    const alignmentQuestions = next.independent_openai?.alignment?.questions
    if (alignmentQuestions?.[from] !== undefined) {
      alignmentQuestions[to] = alignmentQuestions[from]
      delete alignmentQuestions[from]
    }
    return next
  }

  it('renders the no-spaces question name in the header with wrap-anywhere', async () => {
    navigation.params = new URLSearchParams(`execution=${RUN_ID}`)
    const snapshot = renameQuestion(compareSnapshot(), 'request_type', EXTREME_LABEL)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot)))

    render(<InvestigationView />)

    // (a) honest render: the extreme name is the focused first question.
    // (b) class contract: the h1 wraps instead of overflowing.
    const header = await screen.findByTestId('investigation-header')
    expect(header).toHaveTextContent(`Investigation · ${EXTREME_LABEL} · CHOICE`)
    expect(header).toHaveClass('wrap-anywhere')
  })

  it('lets the question-selector button wrap and shrink under an extreme name (gate finding: 287px overflow at 375)', async () => {
    navigation.params = new URLSearchParams(`execution=${RUN_ID}`)
    const snapshot = renameQuestion(compareSnapshot(), 'request_type', EXTREME_LABEL)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot)))

    render(<InvestigationView />)

    // The ui/button base carries shrink-0 + whitespace-nowrap — a no-spaces
    // question name rendered there cannot wrap NOR shrink and overflows the
    // document (the e2e extreme gate caught what jsdom cannot measure).
    const selector = await screen.findByTestId('question-selector')
    const button = within(selector).getByRole('button', { name: EXTREME_LABEL })
    expect(button).toHaveClass('wrap-anywhere', 'whitespace-normal', 'min-w-0', 'max-w-full')
  })
})

// P34 (FB7): the discrete global strip under the §37 header — the SAME §22
// derivation as the Principal hero (conclusion + JEV Fidelity + N/M aligned,
// single-sourced through heroConclusion) plus the run mode and the link to
// hydrated Principal (/?execution=<id>, the P30 mechanism). §36 intact: the
// strip is secondary context — WHY|EVIDENCE stays the first level.
describe('InvestigationView — global strip (P34/FB7)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams(`execution=${RUN_ID}`)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('renders the strip with the hero derivation: conclusion, fidelity, N/M, mode and the Principal link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    const strip = await screen.findByTestId('investigation-global-strip')
    // The SAME §22 conclusion the hero renders — never a second derivation.
    expect(strip).toHaveTextContent('✓ PREDICTION MATCHED JEV')
    // The fixture: overall fidelity 0.95 → "95%", labeled like the hero.
    expect(strip).toHaveTextContent('95%')
    expect(strip).toHaveTextContent('JEV Fidelity')
    expect(strip).toHaveTextContent('3 / 3 questions aligned')
    // recent.mode label for the fixture's compare-and-evaluate mode.
    expect(strip).toHaveTextContent('Evaluate prediction')
    const link = screen.getByRole('link', { name: 'View in Principal' })
    expect(link).toHaveAttribute('href', `/?execution=${RUN_ID}`)
  })

  it('renders the emulator strip: completed conclusion and mode, without compare-only segments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(emulatorSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    const strip = await screen.findByTestId('investigation-global-strip')
    expect(strip).toHaveTextContent('✓ Run completed · 3 questions')
    expect(strip).toHaveTextContent('Emulator')
    // Hero parity: no comparison → no fidelity/alignment segments at all.
    expect(screen.queryByText(/JEV Fidelity/)).not.toBeInTheDocument()
    expect(screen.queryByText(/questions aligned/)).not.toBeInTheDocument()
  })

  it('renders no strip for a failed snapshot (hero parity: no global summary)', async () => {
    const failedSnapshot = { ...compareSnapshot(), status: 'failed' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(failedSnapshot))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByText('Investigation · request_type · CHOICE')).toBeInTheDocument()
    expect(screen.queryByTestId('investigation-global-strip')).not.toBeInTheDocument()
  })

  it('renders the localized link in Spanish', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    const link = await screen.findByRole('link', { name: 'Ver en Principal' })
    expect(link).toHaveAttribute('href', `/?execution=${RUN_ID}`)
  })

  it('keeps the §37 header pins intact alongside the strip (h1, instructions, selector)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByTestId('investigation-global-strip')).toBeInTheDocument()
    expect(screen.getByTestId('investigation-header')).toHaveTextContent('Investigation · request_type · CHOICE')
    expect(screen.getByText('Classify this request.')).toBeInTheDocument()
    expect(screen.getByTestId('question-selector')).toHaveTextContent('urgency')
  })
})

// P47 (c): the scenario box above the selected question's title — the source
// is the loaded snapshot's persisted request.state; state null/absent = no box
// (never an empty box, never the string "null").
describe('InvestigationView — scenario box above the question title (P47c)', () => {
  beforeEach(() => {
    navigation.replace.mockClear()
    navigation.params = new URLSearchParams(`execution=${RUN_ID}`)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the box above the investigation header with the persisted state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    const header = await screen.findByTestId('investigation-header')
    const box = screen.getByTestId('scenario-box')
    // Above the title: the header FOLLOWS the box in the DOM.
    expect(box.compareDocumentPosition(header)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // Collapsed by default (§38 idiom).
    expect(within(box).getByRole('button', { name: /View scenario/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands to the exact pretty JSON of the snapshot state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(compareSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)
    await screen.findByTestId('investigation-header')

    fireEvent.click(screen.getByRole('button', { name: /View scenario/ }))
    const state = compareSnapshot().request.state
    expect(screen.getByTestId('scenario-content').textContent).toBe(JSON.stringify(state, null, 2))
  })

  it('renders no box when the snapshot carries state: null', async () => {
    const snapshot = compareSnapshot()
    const nullState = { ...snapshot, request: { ...snapshot.request, state: null } }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(nullState))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByTestId('investigation-header')).toBeInTheDocument()
    expect(screen.queryByTestId('scenario-box')).not.toBeInTheDocument()
  })

  it('renders no box when the snapshot request has no state key at all', async () => {
    const snapshot = compareSnapshot()
    const { state: _omitted, ...requestWithoutState } = snapshot.request
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ...snapshot, request: requestWithoutState })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<InvestigationView />)

    expect(await screen.findByTestId('investigation-header')).toBeInTheDocument()
    expect(screen.queryByTestId('scenario-box')).not.toBeInTheDocument()
  })
})

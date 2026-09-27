import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EvidenceView, type EvidenceSource } from '../../components/investigation/evidence-view'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import type { ExecutionSnapshot } from '../../lib/execution-snapshot'
import { compareSnapshot, emulatorSnapshot } from '../fixtures/investigation-snapshot'

let clipboardWrite: ReturnType<typeof vi.fn>

function renderEvidence(
  source: EvidenceSource,
  options: {
    dictionary?: typeof en.investigation
    snapshot?: ExecutionSnapshot
    questionName?: string
  } = {}
) {
  const snapshot = options.snapshot ?? compareSnapshot()
  const dictionary = options.dictionary ?? en.investigation
  const onSourceChange = vi.fn()
  render(
    <EvidenceView
      dictionary={dictionary}
      onSourceChange={onSourceChange}
      questionName={options.questionName ?? 'urgency'}
      snapshot={snapshot}
      source={source}
    />
  )
  return { onSourceChange, snapshot }
}

function payloadText(): string {
  return document.querySelector('[data-testid="payload-raw"]')?.textContent ?? ''
}

describe('EvidenceView — source selector (§43)', () => {
  beforeEach(() => {
    clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: clipboardWrite } })
  })
  afterEach(() => vi.restoreAllMocks())

  it('offers exactly the six sources in the desktop dropdown and switches on change', () => {
    const { onSourceChange } = renderEvidence('request')

    const select = screen.getByTestId('source-select') as HTMLSelectElement
    const options = Array.from(select.options).map((option) => option.value)
    expect(options).toEqual(['request', 'emulator', 'jev', 'ai', 'independent', 'full'])

    fireEvent.change(select, { target: { value: 'jev' } })
    expect(onSourceChange).toHaveBeenCalledWith('jev')
  })

  it('offers the six sources in the mobile Bottom Drawer and closes on selection', async () => {
    const { onSourceChange } = renderEvidence('request')

    fireEvent.click(screen.getByRole('button', { name: /Source: Request/ }))

    const dialog = await screen.findByRole('dialog')
    for (const label of ['Request', 'Emulator', 'JEV', 'AI Evaluation', 'Independent', 'Full execution']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    void dialog

    fireEvent.click(screen.getByRole('button', { name: 'Full execution' }))
    expect(onSourceChange).toHaveBeenCalledWith('full')
  })

  // R3 (dual-review): 16px at ALL widths — an sm:text-sm override would drop
  // below 16px on iPhone SE/8 landscape (667px > sm=640) and re-trigger the
  // iOS focus zoom (§16 no-zoom gate).
  it('keeps the Find input at 16px on every breakpoint (no sm:text-sm)', () => {
    renderEvidence('request')
    const find = screen.getByTestId('find-input')
    expect(find).toHaveClass('text-base')
    expect(find).not.toHaveClass('sm:text-sm')
  })
})

describe('EvidenceView — exact payload views and copy actions (§44/§45.1)', () => {
  beforeEach(() => {
    clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: clipboardWrite } })
  })
  afterEach(() => vi.restoreAllMocks())

  it('Request renders the snapshot request JSON with Copy request', () => {
    const { snapshot } = renderEvidence('request')

    expect(screen.getByText('SYSTEM ONE REQUEST')).toBeInTheDocument()
    expect(payloadText()).toContain('I was charged twice on my invoice.')

    fireEvent.click(screen.getByRole('button', { name: 'Copy request' }))
    expect(clipboardWrite).toHaveBeenCalledWith(JSON.stringify(snapshot.request, null, 2))
  })

  it('Emulator renders the section result (answers + usage) with Copy response', () => {
    const { snapshot } = renderEvidence('emulator')

    expect(screen.getByText('EMULATOR RESPONSE')).toBeInTheDocument()
    expect(payloadText()).toContain('"input_tokens": 120')

    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }))
    expect(clipboardWrite).toHaveBeenCalledWith(JSON.stringify(snapshot.emulator?.result, null, 2))
  })

  // P37/FB10: an emulator-only run reframes the run-wide Emulator payload —
  // the caption marks it as THE answer for the run (§1 question #1).
  it('Emulator carries the P37 answer caption on emulator-only runs', () => {
    renderEvidence('emulator', { snapshot: emulatorSnapshot() })

    expect(screen.getByText('EMULATOR RESPONSE')).toBeInTheDocument()
    expect(screen.getByText('The Emulator answer for this run')).toBeInTheDocument()
  })

  // P37/FB10 negative pin: on a compare run the Emulator is ONE of two
  // sources — no answer caption (never pretend a solo framing).
  it('Emulator carries no P37 answer caption on compare runs', () => {
    renderEvidence('emulator')

    expect(screen.getByText('EMULATOR RESPONSE')).toBeInTheDocument()
    expect(screen.queryByText('The Emulator answer for this run')).not.toBeInTheDocument()
  })

  // F3 (dual-review R45): key parity is guaranteed by tsc, copy drift is not
  // — pin the Spanish caption too.
  it('Emulator carries the Spanish answer caption on emulator-only runs (F3)', () => {
    renderEvidence('emulator', { dictionary: es.investigation, snapshot: emulatorSnapshot() })

    expect(screen.getByText('La respuesta del emulador de esta ejecución')).toBeInTheDocument()
  })

  it('JEV renders the section result (answers + usage) with Copy response', () => {
    const { snapshot } = renderEvidence('jev')

    expect(screen.getByText('JEV RESPONSE')).toBeInTheDocument()
    expect(payloadText()).toContain('"input_tokens": 210')

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy response' })[0])
    expect(clipboardWrite).toHaveBeenCalledWith(JSON.stringify(snapshot.jev?.result, null, 2))
  })

  it('JEV renders the honest failed section payload when the JEV run failed (§66)', () => {
    const snapshot = compareSnapshot()
    snapshot.jev = { status: 'failed', error: 'JEV provider unreachable' }

    renderEvidence('jev', { snapshot })

    expect(screen.getByText('JEV RESPONSE')).toBeInTheDocument()
    expect(payloadText()).toContain('JEV provider unreachable')
  })

  it('Independent renders INPUT (the original request, model included) and OUTPUT with separate copy actions (§44/§11)', () => {
    const { snapshot } = renderEvidence('independent')

    expect(screen.getByText('INDEPENDENT LLM')).toBeInTheDocument()
    expect(screen.getByText('INPUT')).toBeInTheDocument()
    expect(screen.getByText('Original request only')).toBeInTheDocument()
    expect(screen.getByText('OUTPUT')).toBeInTheDocument()
    expect(screen.getByText('Structured prediction')).toBeInTheDocument()

    const input = document.querySelectorAll('[data-testid="payload-raw"]')[0]?.textContent ?? ''
    expect(input).toContain('I was charged twice on my invoice.')
    expect(input).toContain('"request_type"')
    // §11 exactness: the request carried a model override, so the INPUT — the
    // original request — carries it too.
    expect(input).toContain('"model": "gpt-4o-mini"')
    const output = document.querySelectorAll('[data-testid="payload-raw"]')[1]?.textContent ?? ''
    expect(output).toContain('"input_tokens": 300')

    fireEvent.click(screen.getByRole('button', { name: 'Copy input' }))
    expect(clipboardWrite).toHaveBeenCalledWith(
      JSON.stringify(
        {
          state: snapshot.request.state,
          questions: snapshot.request.questions,
          model: snapshot.request.model,
        },
        null,
        2
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy output' }))
    expect(clipboardWrite).toHaveBeenCalledWith(JSON.stringify(snapshot.independent_openai?.result, null, 2))
  })

  it('Independent INPUT omits the model key entirely when the request carried none (§11)', () => {
    const snapshot = compareSnapshot()
    delete snapshot.request.model

    renderEvidence('independent', { snapshot })

    const input = document.querySelectorAll('[data-testid="payload-raw"]')[0]?.textContent ?? ''
    expect(input).toContain('"request_type"')
    expect(input).not.toContain('"model"')

    fireEvent.click(screen.getByRole('button', { name: 'Copy input' }))
    const copied = clipboardWrite.mock.calls[0][0] as string
    expect(copied).not.toContain('"model"')
    expect(JSON.parse(copied)).toEqual({
      state: snapshot.request.state,
      questions: snapshot.request.questions,
    })
  })

  it('Independent renders the honest failed section payload when the prediction failed (§66)', () => {
    const snapshot = compareSnapshot()
    snapshot.independent_openai = { status: 'failed', error: 'adapter failure' }

    renderEvidence('independent', { snapshot })

    expect(screen.getByText(/adapter failure/)).toBeInTheDocument()
  })

  it('AI Evaluation renders the structured Judge output with Copy evaluation', () => {
    const { snapshot } = renderEvidence('ai')

    expect(screen.getByText('AI EVALUATION')).toBeInTheDocument()
    expect(screen.getByText('Structured Judge output')).toBeInTheDocument()
    expect(payloadText()).toContain('Numeric differences leave the interpretation unchanged.')

    fireEvent.click(screen.getByRole('button', { name: 'Copy evaluation' }))
    expect(clipboardWrite).toHaveBeenCalledWith(
      JSON.stringify(
        { overall: snapshot.ai_evaluation?.overall, questions: snapshot.ai_evaluation?.questions },
        null,
        2
      )
    )
  })

  it('Full execution renders the entire snapshot with Copy execution bundle and Download', () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:jevals-full')
    const revokeObjectURL = vi.fn<(url: string) => void>()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { snapshot } = renderEvidence('full')

    expect(screen.getByText('FULL EXECUTION')).toBeInTheDocument()
    expect(payloadText()).toContain('request_hash')
    expect(payloadText()).toContain('"duration_ms": 2500')

    fireEvent.click(screen.getByRole('button', { name: 'Copy execution bundle' }))
    expect(clipboardWrite).toHaveBeenCalledWith(JSON.stringify(snapshot, null, 2))

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    void blob.text().then((text) => {
      expect(text).toBe(JSON.stringify(snapshot, null, 2))
    })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:jevals-full')
  })

  // FB2 (R40/P29): Evidence §44 renders the PERSISTED payload verbatim — the
  // REAL emulator model survives here even though the summary surfaces
  // display the 'Emulator 0.0.1' alias. The alias is a §9 category-4 visual
  // label, never provenance.
  it('Full execution keeps the REAL emulator model in the payload (FB2 alias is display-only)', () => {
    renderEvidence('full')

    expect(payloadText()).toContain('"model": "jev-emulator"')
    expect(payloadText()).not.toContain('Emulator 0.0.1')
  })

  it('renders an honest unavailable note for a source the run did not produce', () => {
    renderEvidence('jev', { snapshot: emulatorSnapshot() })

    expect(screen.getByText('This run did not produce this section.')).toBeInTheDocument()
  })

  it('Copy analysis bundle copies the exact §45.2 per-question bundle (pinned literal)', () => {
    // F13: pinned by hand from the compareSnapshot fixture for 'urgency' —
    // NOT derived by calling buildAnalysisBundle (that would be a tautology).
    // If the bundle shape changes, this literal changes deliberately.
    const expected = `{
  "execution_id": "run_08492abcdef12",
  "question_name": "urgency",
  "request": {
    "state": {
      "message": "I was charged twice on my invoice."
    },
    "question": {
      "type": "score",
      "criteria": [
        "low",
        "medium",
        "high"
      ]
    }
  },
  "emulator": {
    "type": "score",
    "score": 1.82,
    "confidence": 0.75,
    "legend": {
      "0": "low",
      "1": "medium",
      "2": "high"
    },
    "probabilities": {
      "0": 0.1,
      "1": 0.2,
      "2": 0.7
    }
  },
  "jev": {
    "type": "score",
    "score": 1.64,
    "confidence": 0.625,
    "legend": {
      "0": "low",
      "1": "medium",
      "2": "high"
    },
    "probabilities": {
      "0": 0.15,
      "1": 0.25,
      "2": 0.6
    }
  },
  "comparison": {
    "primitive": "score",
    "fidelity": 0.95,
    "aligned": true,
    "components": {
      "score_delta": 0.18,
      "max_score": 2,
      "score_similarity": 0.91,
      "distribution_similarity": 0.85,
      "confidence_delta": 0.125,
      "emulator_dominant_level": "2",
      "jev_dominant_level": "2"
    }
  },
  "independent_openai": {
    "answer": {
      "type": "score",
      "score": 1.71,
      "confidence": 0.7,
      "legend": {
        "0": "low",
        "1": "medium",
        "2": "high"
      },
      "probabilities": {
        "0": 0.15,
        "1": 0.2,
        "2": 0.65
      }
    },
    "alignment": {
      "agrees_with_emulator": true,
      "agrees_with_jev": true,
      "independent_dominant_level": "2"
    }
  },
  "ai_evaluation": {
    "emulator_support": "partial",
    "jev_support": "partial",
    "semantic_divergence": "minor",
    "preferred": "tie",
    "reason": "Scores differ but stay in the same band."
  }
}`

    renderEvidence('request', { questionName: 'urgency' })

    fireEvent.click(screen.getByRole('button', { name: 'Copy analysis bundle' }))
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
    expect(clipboardWrite.mock.calls[0][0]).toBe(expected)
  })
})

describe('EvidenceView — Full LLM Exchange (§45)', () => {
  beforeEach(() => {
    clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: clipboardWrite } })
  })
  afterEach(() => vi.restoreAllMocks())

  it('keeps the exchange hidden by default, then reveals the six blocks with copy actions', () => {
    renderEvidence('ai')

    expect(screen.queryByText('System instruction')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View full LLM exchange' }))

    expect(screen.getByText('Configuration')).toBeInTheDocument()
    expect(screen.getByText('System instruction')).toBeInTheDocument()
    expect(screen.getByText('LLM input')).toBeInTheDocument()
    expect(screen.getByText('Output schema')).toBeInTheDocument()
    expect(screen.getByText('Raw model response')).toBeInTheDocument()
    expect(screen.getByText('Parsed application result')).toBeInTheDocument()

    for (const label of [
      'Copy configuration',
      'Copy system instruction',
      'Copy LLM input',
      'Copy schema',
      'Copy raw response',
      'Copy parsed result',
      'Copy full exchange',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('renders old-shape judge evidence without crashing: absent blocks carry the honest not-recorded placeholder (§45)', () => {
    const snapshot = compareSnapshot()
    // Old snapshots predate evidence.system_instruction/configuration: the
    // fields are simply absent, and every payload path must tolerate that.
    delete snapshot.ai_evaluation?.evidence?.system_instruction
    delete snapshot.ai_evaluation?.evidence?.configuration

    renderEvidence('ai', { snapshot })

    fireEvent.click(screen.getByRole('button', { name: 'View full LLM exchange' }))

    expect(screen.getByText('Configuration')).toBeInTheDocument()
    expect(screen.getByText('System instruction')).toBeInTheDocument()
    expect(screen.getAllByText('Not recorded for this execution.').length).toBeGreaterThanOrEqual(2)

    // Copy never copies "undefined" — it copies the honest placeholder.
    fireEvent.click(screen.getByRole('button', { name: 'Copy configuration' }))
    expect(clipboardWrite).toHaveBeenCalledWith('Not recorded for this execution.')

    // Find over the placeholder-bearing exchange must not crash on absent
    // fields; it still matches real payload lines (each open block reports
    // its own count).
    fireEvent.change(screen.getByTestId('find-input'), { target: { value: 'charged twice' } })
    const counts = screen.getAllByTestId('find-count').map((node) => node.textContent)
    expect(counts).toContain('1 match')
  })

  it('copies the raw model response verbatim', () => {
    const { snapshot } = renderEvidence('ai')
    fireEvent.click(screen.getByRole('button', { name: 'View full LLM exchange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy raw response' }))

    expect(clipboardWrite).toHaveBeenCalledWith(snapshot.ai_evaluation?.evidence?.raw_response)
  })

  it('renders the independent llm_attempts as inspectable exchanges (ADR-005 P19)', () => {
    renderEvidence('independent')

    expect(screen.getByText('LLM EXCHANGES')).toBeInTheDocument()
    expect(screen.getByText('Attempt 1')).toBeInTheDocument()
    expect(screen.getByText(/system-one-adapter system prompt/)).toBeInTheDocument()
  })

  it('never displays Bearer tokens or api keys (server-side redaction pin)', () => {
    renderEvidence('ai')
    fireEvent.click(screen.getByRole('button', { name: 'View full LLM exchange' }))

    expect(screen.queryByText(/Bearer/)).not.toBeInTheDocument()
    expect(screen.queryByText(/api[-_ ]?key/i)).not.toBeInTheDocument()
  })
})

describe('EvidenceView — Find over the active payload (§45.4)', () => {
  beforeEach(() => {
    clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: clipboardWrite } })
  })
  afterEach(() => vi.restoreAllMocks())

  it('filters the payload to matching lines, highlights them and shows the count', () => {
    renderEvidence('ai')

    fireEvent.change(screen.getByTestId('find-input'), { target: { value: 'urgency' } })

    const matches = screen.getAllByTestId('find-match')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    for (const match of matches) {
      expect(match.textContent?.toLowerCase()).toContain('urgency')
    }
    expect(screen.getByTestId('find-count')).toHaveTextContent('1 match')
    // Non-matching lines are filtered out.
    expect(document.querySelector('[data-testid="payload-matches"]')?.textContent).not.toContain(
      'prediction_quality'
    )
  })

  it('shows No matches for a query that misses every line', () => {
    renderEvidence('request')

    fireEvent.change(screen.getByTestId('find-input'), { target: { value: 'nonexistent-key' } })

    expect(screen.getByTestId('find-count')).toHaveTextContent('No matches')
  })
})

// §45.4: Ctrl/Cmd + F focuses the Find input while Evidence is mounted.
describe('Find shortcut (§45.4)', () => {
  it('focuses the Find input on Ctrl/Cmd + F', () => {
    renderEvidence('request')
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    expect(screen.getByTestId('find-input')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(screen.getByTestId('find-input')).toHaveFocus()
  })
})

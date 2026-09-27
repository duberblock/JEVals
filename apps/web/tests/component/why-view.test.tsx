import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WhyView } from '../../components/investigation/why-view'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import type { ExecutionSnapshot } from '../../lib/execution-snapshot'
import { compareSnapshot, emulatorSnapshot } from '../fixtures/investigation-snapshot'
import { EXTREME_LABEL } from './extreme-labels'

function clone(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ExecutionSnapshot
}

function renderWhy(
  snapshot: ExecutionSnapshot,
  questionName: string,
  options: { dictionary?: typeof en.investigation; focusAi?: boolean } = {}
) {
  const onViewEvidence = vi.fn()
  const dictionary = options.dictionary ?? en.investigation
  const focusAi = options.focusAi ?? false
  const view = render(
    <WhyView
      dictionary={dictionary}
      focusAi={focusAi}
      locale="en"
      onViewEvidence={onViewEvidence}
      questionName={questionName}
      snapshot={snapshot}
    />
  )
  const switchQuestion = (next: string) =>
    view.rerender(
      <WhyView
        dictionary={dictionary}
        focusAi={focusAi}
        locale="en"
        onViewEvidence={onViewEvidence}
        questionName={next}
        snapshot={snapshot}
      />
    )
  return { onViewEvidence, switchQuestion }
}

describe('WhyView — per-primitive value blocks (§39)', () => {
  it('renders the Choice aligned block: both values, SAME DECISION and the deterministic WHY text', () => {
    renderWhy(compareSnapshot(), 'request_type')

    expect(screen.getByText('Emulator')).toBeInTheDocument()
    expect(screen.getByText('JEV')).toBeInTheDocument()
    expect(screen.getAllByText('billing')).toHaveLength(2)
    expect(screen.getByTestId('why-verdict')).toHaveTextContent('✓ SAME DECISION')
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'Both systems identify the request as billing.'
    )
  })

  it('renders the Choice diverged block: DIFFERENT DECISION and the diverged WHY text', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.jev!.result!.answers!.request_type = {
      type: 'choice',
      choice: 'technical',
      confidence: 0.5,
      probabilities: { billing: 0.2, technical: 0.6, sales: 0.2 },
    }
    snapshot.comparison!.questions.request_type = {
      primitive: 'choice',
      fidelity: 0.6,
      aligned: false,
      components: { decision_match: false, confidence_delta: 0.375, distribution_similarity: 0.6 },
    }

    renderWhy(snapshot, 'request_type')

    expect(screen.getByText('technical')).toBeInTheDocument()
    expect(screen.getByTestId('why-verdict')).toHaveTextContent('! DIFFERENT DECISION')
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'The sources assign different categorical outcomes.'
    )
  })

  it('renders the Score aligned block: values, Δ, SAME LEVEL and the rubric level', () => {
    renderWhy(compareSnapshot(), 'urgency')

    expect(screen.getByText('1.82')).toBeInTheDocument()
    expect(screen.getByText('1.64')).toBeInTheDocument()
    expect(screen.getByText('Δ .18')).toBeInTheDocument()
    expect(screen.getByTestId('why-verdict')).toHaveTextContent('✓ SAME LEVEL: high')
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'Both values remain in the same rubric level.'
    )
  })

  it('renders the Score diverged block: DIFFERENT LEVEL and both selected levels', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.comparison!.questions.urgency = {
      ...snapshot.comparison!.questions.urgency,
      aligned: false,
      components: {
        score_delta: 1.18,
        max_score: 2,
        score_similarity: 0.41,
        distribution_similarity: 0.4,
        confidence_delta: 0.25,
        emulator_dominant_level: '2',
        jev_dominant_level: '0',
      },
    }

    renderWhy(snapshot, 'urgency')

    expect(screen.getByTestId('why-verdict')).toHaveTextContent('! DIFFERENT LEVEL')
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'The numeric difference changes the resulting rubric level.'
    )
    // §40 Selected shows both sides when they differ.
    expect(screen.getByText('Selected: high → low')).toBeInTheDocument()
  })

  it('renders the Noul block with P(true) labels, leading-dot values, Δ and BOTH < .5', () => {
    renderWhy(compareSnapshot(), 'refund_requested')

    expect(screen.getByText('Emulator P(true)')).toBeInTheDocument()
    expect(screen.getByText('JEV P(true)')).toBeInTheDocument()
    expect(screen.getByText('.082')).toBeInTheDocument()
    expect(screen.getByText('.119')).toBeInTheDocument()
    expect(screen.getByText('Δ .037')).toBeInTheDocument()
    // P38/FB11: the verdict is COMPOSED — §27 geometry plus the RESULT
    // direction, marker from the persisted comparison.aligned.
    expect(screen.getByTestId('why-verdict')).toHaveTextContent('✓ BOTH < .5 — same direction')
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'Both probabilities lie on the same side of the probability midpoint — same direction.'
    )
  })

  it('renders CROSSED .5 when the probabilities fall on opposite sides of the midpoint', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.emulator!.result!.answers!.refund_requested = { type: 'noul', noul: 0.42 }
    snapshot.jev!.result!.answers!.refund_requested = { type: 'noul', noul: 0.61 }
    snapshot.comparison!.questions.refund_requested = {
      primitive: 'noul',
      fidelity: 0.81,
      aligned: false,
      components: {
        probability_delta: 0.19,
        emulator_midpoint_category: -1,
        jev_midpoint_category: 1,
      },
    }

    renderWhy(snapshot, 'refund_requested')

    expect(screen.getByText('Δ .19')).toBeInTheDocument()
    expect(screen.getByTestId('why-verdict')).toHaveTextContent('! CROSSED .5 — opposite directions')
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'The probabilities fall on opposite sides of the probability midpoint — opposite directions.'
    )
  })

  // P38/FB11 (owner ruling): a probability AT .5 now HAS a canonical composed
  // phrase — "midpoint: direction undefined" — because 0.5 is the mathematical
  // midpoint (§27) and direction is genuinely undefined there; what §27 vetoes
  // is naming a SIDE for it, not the honest midpoint statement. The pre-P38
  // "never invent one" silence is superseded for snapshots that carry the
  // persisted categories.
  it('renders the composed midpoint-undefined verdict when a probability sits exactly at .5', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.emulator!.result!.answers!.refund_requested = { type: 'noul', noul: 0.5 }
    snapshot.jev!.result!.answers!.refund_requested = { type: 'noul', noul: 0.7 }
    snapshot.comparison!.questions.refund_requested = {
      primitive: 'noul',
      fidelity: 0.8,
      aligned: false,
      components: {
        probability_delta: 0.2,
        emulator_midpoint_category: 0,
        jev_midpoint_category: 1,
      },
    }

    renderWhy(snapshot, 'refund_requested')

    expect(screen.getByTestId('why-verdict')).toHaveTextContent(
      '! ONE AT .5, ONE > .5 — midpoint: direction undefined'
    )
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'A probability sits exactly at the 0.5 mathematical midpoint — direction undefined.'
    )
  })

  // P38/FB11: above/above with persisted categories (1,1) and aligned true.
  it('renders BOTH > .5 — same direction when both probabilities are strictly above the midpoint', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.emulator!.result!.answers!.refund_requested = { type: 'noul', noul: 0.625 }
    snapshot.jev!.result!.answers!.refund_requested = { type: 'noul', noul: 0.75 }
    snapshot.comparison!.questions.refund_requested = {
      primitive: 'noul',
      fidelity: 0.875,
      aligned: true,
      components: {
        probability_delta: 0.125,
        emulator_midpoint_category: 1,
        jev_midpoint_category: 1,
      },
    }

    renderWhy(snapshot, 'refund_requested')

    expect(screen.getByTestId('why-verdict')).toHaveTextContent('✓ BOTH > .5 — same direction')
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'Both probabilities lie on the same side of the probability midpoint — same direction.'
    )
  })

  // P38/FB11: (0.5, 0.5) — categories (0,0) are the SAME §27 category, so
  // aligned is TRUE and the marker is ✓ (the marker always derives from the
  // persisted comparison.aligned, never from the category signs).
  it('renders ✓ BOTH AT .5 — midpoint undefined when both probabilities sit exactly at .5', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.emulator!.result!.answers!.refund_requested = { type: 'noul', noul: 0.5 }
    snapshot.jev!.result!.answers!.refund_requested = { type: 'noul', noul: 0.5 }
    snapshot.comparison!.questions.refund_requested = {
      primitive: 'noul',
      fidelity: 1,
      aligned: true,
      components: {
        probability_delta: 0,
        emulator_midpoint_category: 0,
        jev_midpoint_category: 0,
      },
    }

    renderWhy(snapshot, 'refund_requested')

    expect(screen.getByTestId('why-verdict')).toHaveTextContent(
      '✓ BOTH AT .5 — midpoint: direction undefined'
    )
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'A probability sits exactly at the 0.5 mathematical midpoint — direction undefined.'
    )
  })

  // P38/FB11: (0.5, <0.5) — categories (0,-1) differ, aligned false.
  it('renders ONE AT .5, ONE < .5 — midpoint undefined for a midpoint/strictly-below pair', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.emulator!.result!.answers!.refund_requested = { type: 'noul', noul: 0.5 }
    snapshot.jev!.result!.answers!.refund_requested = { type: 'noul', noul: 0.25 }
    snapshot.comparison!.questions.refund_requested = {
      primitive: 'noul',
      fidelity: 0.75,
      aligned: false,
      components: {
        probability_delta: 0.25,
        emulator_midpoint_category: 0,
        jev_midpoint_category: -1,
      },
    }

    renderWhy(snapshot, 'refund_requested')

    expect(screen.getByTestId('why-verdict')).toHaveTextContent(
      '! ONE AT .5, ONE < .5 — midpoint: direction undefined'
    )
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'A probability sits exactly at the 0.5 mathematical midpoint — direction undefined.'
    )
  })

  // P38/FB11 legacy fallback: a pre-P38 snapshot carries NO categories — the
  // geometry-only verdict (marker embedded in the legacy key) and the legacy
  // aligned-keyed explanation render exactly as before the change.
  it('renders the legacy geometry-only CROSSED verdict for a snapshot without categories', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.emulator!.result!.answers!.refund_requested = { type: 'noul', noul: 0.42 }
    snapshot.jev!.result!.answers!.refund_requested = { type: 'noul', noul: 0.61 }
    snapshot.comparison!.questions.refund_requested = {
      primitive: 'noul',
      fidelity: 0.81,
      aligned: false,
      components: { probability_delta: 0.19 },
    }

    renderWhy(snapshot, 'refund_requested')

    expect(screen.getByTestId('why-verdict')).toHaveTextContent('! CROSSED .5')
    expect(screen.getByTestId('why-explanation')).toHaveTextContent(
      'The probabilities fall on opposite sides of the probability midpoint.'
    )
  })

  // P38/FB11 legacy fallback at the midpoint: without categories the pre-P38
  // path still renders NO verdict — persisted snapshots never change their
  // rendering (the old pinned behavior).
  it('renders no Noul verdict for a .5 probability on a legacy snapshot without categories', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.emulator!.result!.answers!.refund_requested = { type: 'noul', noul: 0.5 }
    snapshot.jev!.result!.answers!.refund_requested = { type: 'noul', noul: 0.7 }
    snapshot.comparison!.questions.refund_requested = {
      primitive: 'noul',
      fidelity: 0.8,
      aligned: false,
      components: { probability_delta: 0.2 },
    }

    renderWhy(snapshot, 'refund_requested')

    expect(screen.queryByTestId('why-verdict')).not.toBeInTheDocument()
  })
})

// F5 (dual-review): a compare run whose JEV side failed (§66) is NOT an
// emulator-only run — the WHY note must say JEV failed, never claim
// emulator-only.
describe('WhyView — JEV-failed compare run (§66 honest note)', () => {
  it('renders the honest JEV-failure note when the JEV side ran but failed (§66)', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.jev = { status: 'failed', error: 'JEV provider unreachable' }
    snapshot.comparison = undefined

    renderWhy(snapshot, 'request_type')

    // A JEV-failed compare run is NOT an emulator-only run: the note must say
    // the comparison is missing because JEV failed, never claim emulator-only.
    expect(screen.getByText('JEV failed — no comparison is available.')).toBeInTheDocument()
    expect(screen.queryByText('Emulator-only run — there is no JEV side to compare.')).not.toBeInTheDocument()
    expect(screen.queryByTestId('why-verdict')).not.toBeInTheDocument()
  })

  // P37/FB10: a comparison whose JEV side failed is NOT a marked answer — the
  // Emulator side label keeps its muted compare styling and no answer testid
  // exists (§66/§38: never frame a broken comparison as a solo result).
  it('keeps the muted Emulator side label and no marked answer when JEV failed (§66)', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.jev = { status: 'failed', error: 'JEV provider unreachable' }
    snapshot.comparison = undefined

    renderWhy(snapshot, 'request_type')

    expect(screen.queryByTestId('why-answer-label')).not.toBeInTheDocument()
    const label = screen.getByText('Emulator', { exact: true })
    expect(label).toHaveClass('text-muted-foreground')
  })
})

describe('WhyView — emulator-only run (§37 honest single value)', () => {
  it('renders the single Emulator value with no JEV column, Δ, verdict or comparison sections', () => {
    renderWhy(emulatorSnapshot(), 'request_type')

    expect(screen.getByText('Emulator answer')).toBeInTheDocument()
    expect(screen.getAllByText('billing').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('JEV')).not.toBeInTheDocument()
    expect(screen.queryByText(/Δ/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('why-verdict')).not.toBeInTheDocument()
    expect(screen.getByText('Emulator-only run: the JEV comparison does not apply.')).toBeInTheDocument()
    expect(screen.queryByText('Emulator-only run — there is no JEV side to compare.')).not.toBeInTheDocument()
  })

  // P37/FB10: in an emulator-only run the Emulator value IS the product —
  // WHY marks it as THE answer (explicit label + foreground emphasis) instead
  // of framing the run by what it lacks.
  it('marks the Emulator value as THE answer (P37/FB10)', () => {
    renderWhy(emulatorSnapshot(), 'request_type')

    const answerLabel = screen.getByTestId('why-answer-label')
    expect(answerLabel).toHaveTextContent('Emulator answer')
    expect(answerLabel).toHaveClass('text-foreground')
    // P36/FB9 hardening stays intact: the value element keeps wrap-anywhere.
    const value = screen
      .getAllByText('billing')
      .find((element) => element.tagName === 'P' && element.className.includes('text-2xl'))
    expect(value).toBeDefined()
    expect(value).toHaveClass('wrap-anywhere')
    // The no-JEV note is secondary context now — degraded to text-xs.
    expect(screen.getByText('Emulator-only run: the JEV comparison does not apply.')).toHaveClass('text-xs')
    // The solo label replaced the bare side label ('AI Evaluation: not run
    // (Emulator)' is a different full string and never matches exactly).
    expect(screen.queryByText('Emulator')).not.toBeInTheDocument()
  })

  it('marks the Emulator answer with the canonical Spanish label and note (P37/FB10)', () => {
    renderWhy(emulatorSnapshot(), 'request_type', { dictionary: es.investigation })

    expect(screen.getByTestId('why-answer-label')).toHaveTextContent('Respuesta del emulador')
    expect(screen.getByText('Ejecución solo emulador: la comparación con JEV no aplica.')).toBeInTheDocument()
  })

  // P37/FB10 negative pin: a normal compare run has two sides and no single
  // marked answer — the classic side labels render exactly as before.
  it('keeps the two compare side labels and marks no answer on a compare run (P37/FB10)', () => {
    renderWhy(compareSnapshot(), 'request_type')

    expect(screen.queryByTestId('why-answer-label')).not.toBeInTheDocument()
    expect(screen.getByText('Emulator')).toBeInTheDocument()
    expect(screen.getByText('JEV')).toBeInTheDocument()
  })

  // F2 (dual-review R45): a compare run whose JEV succeeded but did not
  // answer the focused question still HAS a JEV section — it is not an
  // emulator-only run. The marked answer stays reserved for runs with no JEV
  // section at all (aligned with Evidence's run-wide mode gate); this edge
  // falls back to the exact pre-P37 muted side label.
  it('marks no answer when the JEV section exists even if it skipped the focused question (F2)', () => {
    const snapshot = clone(compareSnapshot())
    delete snapshot.jev!.result!.answers!.request_type

    renderWhy(snapshot, 'request_type')

    expect(screen.queryByTestId('why-answer-label')).not.toBeInTheDocument()
    const label = screen.getByText('Emulator', { exact: true })
    expect(label).toHaveClass('text-muted-foreground')
    // The note keeps its pre-P37 primary weight in this edge (registered as
    // an ADR-020 follow-up — no third i18n copy for a tolerated data edge).
    expect(screen.getByText('Emulator-only run: the JEV comparison does not apply.')).not.toHaveClass('text-xs')
  })

  // F4 (dual-review R45): the solo answer label composes with the §39 noul
  // probability suffix exactly like the compare side labels do.
  it('composes the solo answer label with the noul P(true) suffix (F4)', () => {
    renderWhy(emulatorSnapshot(), 'refund_requested')

    expect(screen.getByText('Emulator answer P(true)')).toHaveClass('text-foreground')
  })

  // §45.7 question 4: runs without an AI evaluation (emulator/compare modes)
  // render an explicit honest line — "not run" names the mode and never
  // implies failure.
  it('renders the honest AI not-run line with the mode when the section is absent (emulator run)', () => {
    renderWhy(emulatorSnapshot(), 'urgency')

    expect(screen.getByText('AI EVALUATION')).toBeInTheDocument()
    expect(screen.getByText('AI Evaluation: not run (Emulator)')).toBeInTheDocument()
  })

  it('renders the AI not-run line with the compare mode for a compare run without AI', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.ai_evaluation = undefined

    renderWhy(snapshot, 'urgency')

    expect(screen.getByText('AI Evaluation: not run (Evaluate prediction)')).toBeInTheDocument()
  })
})

describe('WhyView — rubric / criteria disclosure (§40)', () => {
  it('shows the compact Choice criteria line with the selected value', () => {
    renderWhy(compareSnapshot(), 'request_type')

    expect(screen.getByText('Criteria: billing · technical · sales')).toBeInTheDocument()
    expect(screen.getByText('Selected: billing')).toBeInTheDocument()
  })

  it('shows both selections when the Choice decision differs', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.jev!.result!.answers!.request_type = {
      type: 'choice',
      choice: 'technical',
      confidence: 0.5,
      probabilities: { billing: 0.2, technical: 0.6, sales: 0.2 },
    }
    snapshot.comparison!.questions.request_type = {
      primitive: 'choice',
      fidelity: 0.6,
      aligned: false,
      components: { decision_match: false, confidence_delta: 0.375, distribution_similarity: 0.6 },
    }

    renderWhy(snapshot, 'request_type')

    expect(screen.getByText('Selected: billing → technical')).toBeInTheDocument()
  })

  it('shows the compact Score rubric line with the selected level', () => {
    renderWhy(compareSnapshot(), 'urgency')

    expect(screen.getByText('Rubric: low · medium · high')).toBeInTheDocument()
    expect(screen.getByText('Selected: high')).toBeInTheDocument()
  })

  it('opens the full criteria detail on demand (desktop disclosure) and closes it again', () => {
    renderWhy(compareSnapshot(), 'request_type')

    expect(screen.queryByText('billing — Billing issue')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('criteria-detail-desktop'))

    expect(screen.getByText('billing — Billing issue')).toBeInTheDocument()
    expect(screen.getByText('technical — Technical issue')).toBeInTheDocument()
    expect(screen.getByText('sales — Sales request')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('criteria-detail-desktop'))
    expect(screen.queryByText('billing — Billing issue')).not.toBeInTheDocument()
  })

  it('opens the full criteria detail on demand (mobile Bottom Drawer)', async () => {
    renderWhy(compareSnapshot(), 'request_type')

    // Desktop disclosure button first, then the mobile Bottom Drawer trigger
    // (both carry the same visible label; the desktop one carries the testid).
    const triggers = screen.getAllByRole('button', { name: 'View criteria >' })
    expect(triggers).toHaveLength(2)
    expect(triggers[0]).toHaveAttribute('data-testid', 'criteria-detail-desktop')

    fireEvent.click(triggers[1])

    expect(await screen.findByText('billing — Billing issue')).toBeInTheDocument()
  })
})

describe('WhyView — AI Evaluation block (§42)', () => {
  // P35/FB8 (§42 amendment, owner ruling / ADR-022): the focused question
  // WITH a §67 entry shows its OWN reason excerpt inline (line-clamp-2) —
  // the global overall summary is replaced. The full reason stays behind
  // View AI reasoning (§38: an excerpt is not the rationale; the clamp is
  // the boundary).
  it('shows the question headline and the focused question reason excerpt, with other reasoning hidden by default', () => {
    renderWhy(compareSnapshot(), 'urgency')

    expect(screen.getByText('Minor divergence · Tie')).toBeInTheDocument()
    const excerpt = screen.getByTestId('ai-question-excerpt')
    expect(excerpt).toHaveTextContent('Scores differ but stay in the same band.')
    expect(excerpt).toHaveClass('line-clamp-2')
    // The global summary no longer renders inline for a focused question
    // with its own §67 entry.
    expect(screen.queryByText('Numeric differences leave the interpretation unchanged.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View AI reasoning' })).toBeInTheDocument()
    // §38 pin: ANOTHER question's reason stays hidden until expanded.
    expect(screen.queryByText('Both select billing.')).not.toBeInTheDocument()
  })

  // P35/FB8 fallback: a focused question WITHOUT a §67 entry keeps today's
  // honest fallback — the global overall summary inline, never an excerpt.
  it('falls back to the overall summary when the focused question has no §67 entry (P35/FB8)', () => {
    const snapshot = clone(compareSnapshot())
    delete snapshot.ai_evaluation!.questions!.urgency

    renderWhy(snapshot, 'urgency')

    expect(screen.queryByTestId('ai-question-excerpt')).not.toBeInTheDocument()
    expect(screen.getByText('Numeric differences leave the interpretation unchanged.')).toBeInTheDocument()
  })

  // P35/FB8 fallback: a whitespace-only reason is NO reason — fallback to
  // the overall summary, never a hollow clamped excerpt.
  it('falls back to the overall summary when the entry reason is whitespace only (P35/FB8)', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.ai_evaluation!.questions!.urgency.reason = '   '

    renderWhy(snapshot, 'urgency')

    expect(screen.queryByTestId('ai-question-excerpt')).not.toBeInTheDocument()
    expect(screen.getByText('Numeric differences leave the interpretation unchanged.')).toBeInTheDocument()
  })

  it('expands the full structured §67 output (overall + per-question reasons) on demand', () => {
    renderWhy(compareSnapshot(), 'urgency')

    fireEvent.click(screen.getByRole('button', { name: 'View AI reasoning' }))

    // P35/FB8: the focused question's reason now ALSO renders inline as the
    // clamped excerpt, so getByText matches twice — scope the expansion pin
    // to the disclosure block (its intent: the full §67 output on demand).
    expect(screen.getByTestId('ai-reasoning')).toHaveTextContent(/Scores differ but stay in the same band\./)
    expect(screen.getByTestId('ai-reasoning')).toHaveTextContent(/Both select billing\./)
    expect(screen.getByText('Prediction quality')).toBeInTheDocument()
    expect(screen.getByText('mixed')).toBeInTheDocument()
  })

  it('starts with the reasoning expanded when focused via focus=ai', () => {
    renderWhy(compareSnapshot(), 'urgency', { focusAi: true })

    // P35/FB8: same excerpt/dd duplication — scope to the disclosure block.
    expect(screen.getByTestId('ai-reasoning')).toHaveTextContent(/Scores differ but stay in the same band\./)
  })

  it('renders an honest unavailable line for a failed Judge section', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.ai_evaluation = { status: 'failed', error: 'LLM unavailable' }

    renderWhy(snapshot, 'urgency')

    expect(screen.getByText('The AI evaluation is unavailable for this run.')).toBeInTheDocument()
    // Distinct §45.7 states: a failed Judge is NOT "not run".
    expect(screen.queryByText(/not run/)).not.toBeInTheDocument()
  })

  // F8 (dual-review): focus=ai scrolls the AI block into view — and only
  // then (a plain WHY arrival never scrolls).
  it('scrolls the AI block into view when focus=ai arrives', () => {
    const scrollIntoView = vi.fn()
    // jsdom ships no scrollIntoView; the component guards on its absence, so
    // the mock both enables and observes the call.
    Element.prototype.scrollIntoView = scrollIntoView

    try {
      renderWhy(compareSnapshot(), 'urgency', { focusAi: true })

      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('never scrolls the AI block into view without focus=ai', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    try {
      renderWhy(compareSnapshot(), 'urgency')

      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  // F9 (dual-review): AI-reasoning expansion and criteria disclosure are
  // keyed per question — switching the focused question resets them.
  it('resets the AI reasoning expansion when the focused question changes', () => {
    const { switchQuestion } = renderWhy(compareSnapshot(), 'urgency')

    fireEvent.click(screen.getByRole('button', { name: 'View AI reasoning' }))
    // P35/FB8: same excerpt/dd duplication — scope to the disclosure block.
    expect(screen.getByTestId('ai-reasoning')).toHaveTextContent(/Scores differ but stay in the same band\./)

    switchQuestion('request_type')

    expect(screen.queryByText('Scores differ but stay in the same band.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View AI reasoning' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('resets the rubric disclosure when the focused question changes', () => {
    const { switchQuestion } = renderWhy(compareSnapshot(), 'urgency')

    fireEvent.click(screen.getByTestId('rubric-detail-desktop'))
    expect(screen.getByText('0 — low')).toBeInTheDocument()

    switchQuestion('request_type')

    expect(screen.queryByText('0 — low')).not.toBeInTheDocument()
    expect(screen.getByText('Selected: billing')).toBeInTheDocument()
  })
})

describe('WhyView — Independent check block (§41)', () => {
  // F6 (dual-review): the level comes from the persisted alignment payload
  // (independent_dominant_level, ADR-006 ruling 2) — never re-derived by a
  // client-side argmax.
  it('shows the LLM value with the dominant level taken from the alignment payload', () => {
    renderWhy(compareSnapshot(), 'urgency')

    expect(screen.getByText('LLM 1.71 · high')).toBeInTheDocument()
    expect(screen.getByText('✓ agrees with both')).toBeInTheDocument()
  })

  it('renders the level-less LLM value for old snapshots without independent_dominant_level', () => {
    const snapshot = clone(compareSnapshot())
    delete snapshot.independent_openai!.alignment!.questions.urgency.independent_dominant_level

    renderWhy(snapshot, 'urgency')

    // Old snapshot: fall back to the value only — never re-derive the argmax.
    expect(screen.getByText('LLM 1.71')).toBeInTheDocument()
    expect(screen.queryByText('LLM 1.71 · high')).not.toBeInTheDocument()
    expect(screen.queryByText('LLM 1.71 · medium')).not.toBeInTheDocument()
  })

  it('renders the Choice independent value without a level', () => {
    renderWhy(compareSnapshot(), 'request_type')

    expect(screen.getByText('LLM billing')).toBeInTheDocument()
  })

  it('renders the Noul independent value as a leading-dot probability', () => {
    renderWhy(compareSnapshot(), 'refund_requested')

    expect(screen.getByText('LLM .081')).toBeInTheDocument()
  })

  it('shows differs-from-JEV when the prediction matches only the Emulator', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.independent_openai!.alignment!.questions.urgency = {
      agrees_with_emulator: true,
      agrees_with_jev: false,
    }

    renderWhy(snapshot, 'urgency')

    expect(screen.getByText('! differs from JEV')).toBeInTheDocument()
  })

  it('shows differs from Emulator/JEV when the prediction matches neither side', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.independent_openai!.alignment!.questions.urgency = {
      agrees_with_emulator: false,
      agrees_with_jev: false,
    }

    renderWhy(snapshot, 'urgency')

    expect(screen.getByText('! differs from Emulator/JEV')).toBeInTheDocument()
  })

  it('adapts the phrasing to the emulator side when only the emulator ran', () => {
    const snapshot = emulatorSnapshot()

    renderWhy(snapshot, 'urgency')

    expect(screen.getByText('✓ agrees with emulator')).toBeInTheDocument()
  })

  it('adapts the phrasing when an emulator-only prediction diverges from the emulator', () => {
    const snapshot = emulatorSnapshot()
    snapshot.independent_openai!.alignment!.questions.urgency = {
      agrees_with_emulator: false,
      agrees_with_jev: null,
    }

    renderWhy(snapshot, 'urgency')

    expect(screen.getByText('! differs from emulator')).toBeInTheDocument()
  })

  it('renders an honest unavailable line for a failed independent section', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.independent_openai = { status: 'failed', error: 'adapter failure' }

    renderWhy(snapshot, 'urgency')

    expect(screen.getByText('The independent check is unavailable for this run.')).toBeInTheDocument()
  })
})

describe('WhyView — VIEW EVIDENCE action and localization', () => {
  it('renders the primary VIEW EVIDENCE action wired to the evidence switch', () => {
    const { onViewEvidence } = renderWhy(compareSnapshot(), 'urgency')

    fireEvent.click(screen.getByRole('button', { name: 'VIEW EVIDENCE' }))
    expect(onViewEvidence).toHaveBeenCalledTimes(1)
  })

  it('renders the canonical Spanish WHY chrome and verdicts', () => {
    renderWhy(compareSnapshot(), 'urgency', { dictionary: es.investigation })

    expect(screen.getByText('¿POR QUÉ ESTE RESULTADO?')).toBeInTheDocument()
    expect(screen.getByTestId('why-verdict')).toHaveTextContent('✓ MISMO NIVEL: high')
    expect(screen.getByRole('button', { name: 'VER EVIDENCIA' })).toBeInTheDocument()
  })
})

// §38 audit: none of the forbidden-by-default content may render in WHY.
describe('WhyView — §38 forbidden-by-default audit', () => {
  it('renders no raw JSON, copy toolbars, LLM internals, telemetry or hashes by default', () => {
    renderWhy(compareSnapshot(), 'urgency')

    expect(screen.queryByText(/Copy/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Full LLM exchange/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sha256:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/ms/)).not.toBeInTheDocument()
    expect(screen.queryByText(/{/)).not.toBeInTheDocument()
    // Full probability distributions and confidences stay out of WHY.
    expect(screen.queryByText('0.75')).not.toBeInTheDocument()
    expect(screen.queryByText('0.7')).not.toBeInTheDocument()
  })
})

// §45.5/§45.6 layout discipline: one column on mobile, two summary columns
// on desktop — VIEW EVIDENCE stays the full-width bottom action on mobile.
describe('WhyView — layout (§45.5/§45.6)', () => {
  it('uses the two-column desktop summary grid and keeps VIEW EVIDENCE as the bottom action', () => {
    renderWhy(compareSnapshot(), 'urgency')

    const columns = screen.getByTestId('why-columns')
    expect(columns.className).toContain('lg:grid-cols-2')

    const button = screen.getByRole('button', { name: 'VIEW EVIDENCE' })
    expect(button.className).toContain('w-full')
    expect(button.className).toContain('sm:w-auto')
  })
})

// R38 (ADR-012 adoption debt): the §39 verdict line and the §41 independent
// phrase use the semantic state tokens — ✓ phrases text-success, non-✓
// phrases text-warning.
describe('WhyView — semantic verdict colors (R38)', () => {
  it('colors the ✓ verdict phrase text-success, not emerald (§39)', () => {
    renderWhy(compareSnapshot(), 'request_type')

    const verdict = screen.getByTestId('why-verdict')
    expect(verdict).toHaveTextContent('✓ SAME DECISION')
    expect(verdict).toHaveClass('text-success')
    expect(verdict).not.toHaveClass('text-emerald-600')
    expect(verdict).not.toHaveClass('dark:text-emerald-400')
  })

  it('colors the non-✓ verdict phrase text-warning, not amber (§39)', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.jev!.result!.answers!.request_type = {
      type: 'choice',
      choice: 'technical',
      confidence: 0.5,
      probabilities: { billing: 0.2, technical: 0.6, sales: 0.2 },
    }
    snapshot.comparison!.questions.request_type = {
      primitive: 'choice',
      fidelity: 0.6,
      aligned: false,
      components: { decision_match: false, confidence_delta: 0.375, distribution_similarity: 0.6 },
    }

    renderWhy(snapshot, 'request_type')

    const verdict = screen.getByTestId('why-verdict')
    expect(verdict).toHaveTextContent('! DIFFERENT DECISION')
    expect(verdict).toHaveClass('text-warning')
    expect(verdict).not.toHaveClass('text-amber-600')
    expect(verdict).not.toHaveClass('dark:text-amber-400')
  })

  it('colors the ✓ independent phrase text-success, not emerald (§41)', () => {
    renderWhy(compareSnapshot(), 'urgency')

    const phrase = screen.getByText('✓ agrees with both')
    expect(phrase).toHaveClass('text-success')
    expect(phrase).not.toHaveClass('text-emerald-600')
    expect(phrase).not.toHaveClass('dark:text-emerald-400')
  })

  it('colors the non-✓ independent phrase text-warning, not amber (§41)', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.independent_openai!.alignment!.questions.urgency = {
      agrees_with_emulator: true,
      agrees_with_jev: false,
    }

    renderWhy(snapshot, 'urgency')

    const phrase = screen.getByText('! differs from JEV')
    expect(phrase).toHaveClass('text-warning')
    expect(phrase).not.toHaveClass('text-amber-600')
    expect(phrase).not.toHaveClass('dark:text-amber-400')
  })
})

// P36/FB9: transversal hardening — the owner's no-spaces worst case
// (`technical_support_gateways…`) must render honestly AND carry
// wrap-anywhere (+ min-w-0 on its flex/grid container) so a real request
// label wraps instead of breaking the WHY box (§16). pre and PayloadBlock
// stay exempt (ADR-008#8: their inner scroll is legitimate).
describe('WhyView — extreme labels hardening (P36/FB9)', () => {
  it('renders the extreme Choice value on both sides with wrap-anywhere values, min-w-0 grid children and a wrapped delta/verdict', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.emulator!.result!.answers!.request_type = {
      type: 'choice',
      choice: EXTREME_LABEL,
      confidence: 0.875,
      probabilities: { [EXTREME_LABEL]: 0.75, technical: 0.125, sales: 0.125 },
    }
    snapshot.jev!.result!.answers!.request_type = {
      type: 'choice',
      choice: EXTREME_LABEL,
      confidence: 0.625,
      probabilities: { [EXTREME_LABEL]: 0.625, technical: 0.125, sales: 0.25 },
    }

    renderWhy(snapshot, 'request_type')

    // (a) honest render: the extreme label is present on BOTH sides, no crash.
    const values = screen
      .getAllByText(EXTREME_LABEL)
      .filter((element) => element.tagName === 'P' && element.className.includes('text-2xl'))
    expect(values).toHaveLength(2)
    // (b) class contract: wrap-anywhere on the value element, min-w-0 on the
    // grid-cols-2 child that carries it (without min-w-0 the child cannot
    // shrink under its min-content and the box breaks).
    for (const value of values) {
      expect(value).toHaveClass('wrap-anywhere')
      expect(value.parentElement).toHaveClass('min-w-0')
    }
    // The verdict line composes the §39 label block — same hardening.
    expect(screen.getByTestId('why-verdict')).toHaveClass('wrap-anywhere')

    // The delta <p> composes noul/score labels the same way — pin it too
    // (separate render on the noul question, whose components carry Δ).
    renderWhy(compareSnapshot(), 'refund_requested')
    expect(screen.getByText('Δ .037')).toHaveClass('wrap-anywhere')
  })

  it('wraps the rubric disclosure compact/selected strings (gate finding: they join the request criteria labels)', () => {
    const snapshot = clone(compareSnapshot())
    // The request's choice criteria become the compact/selected strings —
    // an extreme no-spaces option label lands there verbatim.
    snapshot.request!.questions!.request_type!.criteria = {
      [EXTREME_LABEL]: 'Extreme option label.',
      technical: 'Technical issue',
      sales: 'Sales request',
    }
    renderWhy(snapshot, 'request_type')

    const disclosure = screen.getByTestId('rubric-disclosure')
    expect(disclosure.textContent).toContain(EXTREME_LABEL)
    // The compact/selected <p>s and the disclosure itself must wrap the
    // token (the e2e extreme gate measured a 287px document overflow from
    // exactly these strings before the classes landed).
    for (const p of disclosure.querySelectorAll('p')) {
      expect(p).toHaveClass('wrap-anywhere')
    }
  })

  it('renders the extreme AI reasoning question name with wrap-anywhere and a min-w-0 parent', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.ai_evaluation = {
      ...snapshot.ai_evaluation!,
      questions: {
        ...snapshot.ai_evaluation!.questions,
        [EXTREME_LABEL]: {
          emulator_support: 'strong',
          jev_support: 'strong',
          semantic_divergence: 'none',
          preferred: 'tie',
          reason: 'Both select the extreme label.',
        },
      },
    }

    renderWhy(snapshot, 'request_type')
    fireEvent.click(screen.getByRole('button', { name: 'View AI reasoning' }))

    const name = screen.getByText(EXTREME_LABEL)
    expect(name).toBeInTheDocument()
    expect(name).toHaveClass('wrap-anywhere')
    expect(name.parentElement).toHaveClass('min-w-0')
  })
})

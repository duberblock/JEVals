import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QuestionResults } from '../../components/principal/question-results'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import { EXTREME_LABEL } from './extreme-labels'
import type { EmulatorAnswer, QuestionComparison } from '../../lib/execution-snapshot'

const answers: Record<string, EmulatorAnswer> = {
  request_type: {
    type: 'choice',
    choice: 'billing',
    confidence: 0.92,
    probabilities: { billing: 0.92, technical: 0.05, sales: 0.03 },
  },
  urgency: {
    type: 'score',
    score: 1.8234,
    confidence: 0.64,
    legend: { '0': {}, '1': {}, '2': {} },
    probabilities: { '0': 0.1, '1': 0.3, '2': 0.6 },
  },
  refund_requested: { type: 'noul', noul: 0.082 },
}

describe('QuestionResults', () => {
  it('renders one compact row per question in request order', () => {
    render(<QuestionResults answers={answers} dictionary={en.questions} locale="en" />)

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('request_type')
    expect(rows[1].textContent).toContain('urgency')
    expect(rows[2].textContent).toContain('refund_requested')
  })

  it('shows the selected label and confidence for CHOICE', () => {
    render(<QuestionResults answers={answers} dictionary={en.questions} locale="en" />)

    expect(screen.getByText('request_type · CHOICE')).toBeInTheDocument()
    expect(screen.getByText('billing')).toBeInTheDocument()
    expect(screen.getByText('Confidence 92%')).toBeInTheDocument()
  })

  it('shows the score value for SCORE', () => {
    render(<QuestionResults answers={answers} dictionary={en.questions} locale="en" />)

    expect(screen.getByText('urgency · SCORE')).toBeInTheDocument()
    expect(screen.getByText('1.82')).toBeInTheDocument()
  })

  it('shows P(true) only for NOUL — no confidence, no classification', () => {
    render(<QuestionResults answers={answers} dictionary={en.questions} locale="en" />)

    expect(screen.getByText('refund_requested · NOUL')).toBeInTheDocument()
    expect(screen.getByText('P(true) 0.082')).toBeInTheDocument()
    expect(screen.queryByText(/Triggered|Classification/i)).not.toBeInTheDocument()
  })

  it('does not render full probability distributions', () => {
    render(<QuestionResults answers={answers} dictionary={en.questions} locale="en" />)

    expect(screen.queryByText(/probabilit/i)).not.toBeInTheDocument()
    expect(screen.queryByText('0.03')).not.toBeInTheDocument()
    expect(screen.queryByText('0.6')).not.toBeInTheDocument()
  })
})

// Compare fixtures: snapshot-shaped answers + comparison records per
// primitive (plan sections 28-30; components exactly as the API sends them).
const compareEmulatorAnswers: Record<string, EmulatorAnswer> = {
  request_type: {
    type: 'choice',
    choice: 'billing',
    confidence: 0.92,
    probabilities: { billing: 0.92, technical: 0.05, sales: 0.03 },
  },
  urgency: {
    type: 'score',
    score: 1.82,
    confidence: 0.64,
    legend: { '0': 'low', '1': 'medium', '2': 'high' },
    probabilities: { '0': 0.1, '1': 0.36, '2': 0.54 },
  },
  refund_requested: { type: 'noul', noul: 0.082 },
}

const compareJevAnswers: Record<string, EmulatorAnswer> = {
  request_type: {
    type: 'choice',
    choice: 'billing',
    confidence: 0.88,
    probabilities: { billing: 0.88, technical: 0.08, sales: 0.04 },
  },
  urgency: {
    type: 'score',
    score: 1.64,
    confidence: 0.6,
    legend: { '0': 'low', '1': 'medium', '2': 'high' },
    probabilities: { '0': 0.12, '1': 0.5, '2': 0.38 },
  },
  refund_requested: { type: 'noul', noul: 0.119 },
}

const requestQuestions = {
  request_type: { type: 'choice', criteria: { billing: 'Billing issue', technical: 'Technical issue' } },
  urgency: { type: 'score', criteria: ['low', 'medium', 'high'] },
  refund_requested: { type: 'noul', criteria: { true: 'yes', false: 'no' } },
}

const comparison: Record<string, QuestionComparison> = {
  request_type: {
    primitive: 'choice',
    fidelity: 0.96,
    aligned: true,
    components: { decision_match: true, confidence_delta: 0.04, distribution_similarity: 0.96 },
  },
  urgency: {
    primitive: 'score',
    fidelity: 0.9,
    aligned: false,
    components: {
      score_delta: 0.18,
      max_score: 2,
      score_similarity: 0.91,
      distribution_similarity: 0.89,
      confidence_delta: 0.04,
      emulator_dominant_level: '1',
      jev_dominant_level: '2',
    },
  },
  refund_requested: {
    primitive: 'noul',
    fidelity: 0.963,
    aligned: true,
    components: { probability_delta: 0.037 },
  },
}

function renderCompare(overrides: {
  emulatorAnswers?: Record<string, EmulatorAnswer>
  jevAnswers?: Record<string, EmulatorAnswer>
  comparison?: Record<string, QuestionComparison>
  dictionary?: typeof en.questions
  executionId?: string
  locale?: 'en' | 'es'
  order?: string[]
} = {}) {
  return render(
    <QuestionResults
      answers={overrides.emulatorAnswers ?? compareEmulatorAnswers}
      comparison={overrides.comparison ?? comparison}
      dictionary={overrides.dictionary ?? en.questions}
      executionId={overrides.executionId}
      jevAnswers={overrides.jevAnswers ?? compareJevAnswers}
      locale={overrides.locale ?? 'en'}
      order={overrides.order}
      requestQuestions={requestQuestions}
    />
  )
}

describe('QuestionResults — compare variant (sections 27-30)', () => {
  it('renders CHOICE aligned with the section 28 shape: marker, decisions, Same decision', () => {
    renderCompare()

    expect(screen.getByText('✓ request_type · CHOICE')).toBeInTheDocument()
    expect(screen.getByText('billing → billing')).toBeInTheDocument()
    expect(screen.getByText('Same decision')).toBeInTheDocument()
  })

  it('renders CHOICE diverged with the ! marker and Different decision', () => {
    renderCompare({
      jevAnswers: {
        ...compareJevAnswers,
        request_type: {
          type: 'choice',
          choice: 'technical',
          confidence: 0.88,
          probabilities: { billing: 0.08, technical: 0.88, sales: 0.04 },
        },
      },
      comparison: {
        ...comparison,
        request_type: {
          primitive: 'choice',
          fidelity: 0.5,
          aligned: false,
          components: { decision_match: false, confidence_delta: 0.04, distribution_similarity: 0.5 },
        },
      },
    })

    expect(screen.getByText('! request_type · CHOICE')).toBeInTheDocument()
    expect(screen.getByText('billing → technical')).toBeInTheDocument()
    expect(screen.getByText('Different decision')).toBeInTheDocument()
  })

  it('renders SCORE with both values, the delta, and the dominant rubric levels', () => {
    renderCompare()

    expect(screen.getByText('urgency · SCORE')).toBeInTheDocument()
    expect(screen.getByText('1.82 → 1.64')).toBeInTheDocument()
    expect(screen.getByText('Δ .18')).toBeInTheDocument()
    expect(screen.getByText('medium ↔ high')).toBeInTheDocument()
  })

  it('renders NOUL with the section 27 phrasing when both are below .5', () => {
    renderCompare()

    expect(screen.getByText('refund_requested · NOUL')).toBeInTheDocument()
    expect(screen.getByText('.082 → .119')).toBeInTheDocument()
    expect(screen.getByText('Δ .037')).toBeInTheDocument()
    expect(screen.getByText('Both < .5')).toBeInTheDocument()
  })

  it('renders NOUL Crossed .5 when the sides are opposite', () => {
    renderCompare({
      emulatorAnswers: { ...compareEmulatorAnswers, refund_requested: { type: 'noul', noul: 0.42 } },
      jevAnswers: { ...compareJevAnswers, refund_requested: { type: 'noul', noul: 0.61 } },
      comparison: {
        ...comparison,
        refund_requested: {
          primitive: 'noul',
          fidelity: 0.81,
          aligned: false,
          components: { probability_delta: 0.19 },
        },
      },
    })

    expect(screen.getByText('.42 → .61')).toBeInTheDocument()
    expect(screen.getByText('Δ .19')).toBeInTheDocument()
    expect(screen.getByText('Crossed .5')).toBeInTheDocument()
  })

  it('renders NOUL Both > .5 when both are above .5, with at most three decimals', () => {
    renderCompare({
      emulatorAnswers: { ...compareEmulatorAnswers, refund_requested: { type: 'noul', noul: 0.8125 } },
      jevAnswers: { ...compareJevAnswers, refund_requested: { type: 'noul', noul: 0.9 } },
      comparison: {
        ...comparison,
        refund_requested: {
          primitive: 'noul',
          fidelity: 0.9125,
          aligned: true,
          components: { probability_delta: 0.0875 },
        },
      },
    })

    expect(screen.getByText('.813 → .9')).toBeInTheDocument()
    // The delta follows toFixed on the binary double: 0.0875 sits just below
    // .0875 in binary, so three decimals render .087.
    expect(screen.getByText('Δ .087')).toBeInTheDocument()
    expect(screen.getByText('Both > .5')).toBeInTheDocument()
  })

  it('omits the NOUL side phrase when a probability sits exactly on .5', () => {
    renderCompare({
      emulatorAnswers: { ...compareEmulatorAnswers, refund_requested: { type: 'noul', noul: 0.5 } },
      jevAnswers: { ...compareJevAnswers, refund_requested: { type: 'noul', noul: 0.61 } },
      comparison: {
        ...comparison,
        refund_requested: {
          primitive: 'noul',
          fidelity: 0.89,
          aligned: false,
          components: { probability_delta: 0.11 },
        },
      },
    })

    // No canonical section 27 phrase covers a probability AT the midpoint:
    // render nothing rather than invent one.
    expect(screen.getByText('.5 → .61')).toBeInTheDocument()
    expect(screen.queryByText('Both < .5')).not.toBeInTheDocument()
    expect(screen.queryByText('Both > .5')).not.toBeInTheDocument()
    expect(screen.queryByText('Crossed .5')).not.toBeInTheDocument()
  })

  it('uses the Spanish dictionary for the compare phrases', () => {
    renderCompare({ dictionary: es.questions, locale: 'es' })

    expect(screen.getByText('Misma decisión')).toBeInTheDocument()
    expect(screen.getByText('1,82 → 1,64')).toBeInTheDocument()
    expect(screen.getByText('Ambas < .5')).toBeInTheDocument()
  })

  it('renders the rows in request order', () => {
    renderCompare({ order: ['refund_requested', 'urgency', 'request_type'] })

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('refund_requested')
    expect(rows[1].textContent).toContain('urgency')
    expect(rows[2].textContent).toContain('request_type')
  })

  it('never shows section 27 forbidden business language in compare rows', () => {
    renderCompare()

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/Triggered/i)
    expect(text).not.toMatch(/Classification/i)
    expect(text).not.toMatch(/Verdict/i)
    expect(text).not.toMatch(/threshold/i)
    // No confidence column in the compare variant (sections 28-30).
    expect(screen.queryByText(/Confidence/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/P\(true\)/i)).not.toBeInTheDocument()
  })

  it('falls back to the answer legend when the request carries no score criteria', () => {
    // compareEmulatorAnswers carries legend {0: low, 1: medium, 2: high};
    // without request questions the legend is the rubric source.
    render(
      <QuestionResults
        answers={compareEmulatorAnswers}
        comparison={comparison}
        dictionary={en.questions}
        jevAnswers={compareJevAnswers}
        locale="en"
      />
    )

    expect(screen.getByText('medium ↔ high')).toBeInTheDocument()
  })

  // J3 (dual-review): the JEV side's level must resolve against the JEV
  // answer's legend — passing the emulator answer made the JEV level borrow
  // the emulator's legend text.
  it('resolves the JEV dominant level against the JEV legend when the legends differ', () => {
    render(
      <QuestionResults
        answers={compareEmulatorAnswers}
        comparison={comparison}
        dictionary={en.questions}
        jevAnswers={{
          ...compareJevAnswers,
          urgency: {
            ...compareJevAnswers.urgency,
            type: 'score',
            legend: { '0': 'bajo', '1': 'medio', '2': 'alto' },
          } as (typeof compareJevAnswers)['urgency'],
        }}
        locale="en"
      />
    )

    expect(screen.getByText('medium ↔ alto')).toBeInTheDocument()
  })

  it('renders the raw dominant level when neither request criteria nor legend resolves text', () => {
    const rawLevelComparison: Record<string, QuestionComparison> = {
      urgency: {
        primitive: 'score',
        fidelity: 0.9,
        aligned: true,
        components: {
          score_delta: 0,
          max_score: 2,
          score_similarity: 1,
          distribution_similarity: 1,
          confidence_delta: 0,
          emulator_dominant_level: '1',
          jev_dominant_level: '2',
        },
      },
    }

    render(
      <QuestionResults
        answers={{ urgency: { type: 'score', score: 1, confidence: 0.5, legend: {}, probabilities: {} } }}
        comparison={rawLevelComparison}
        dictionary={en.questions}
        jevAnswers={{ urgency: { type: 'score', score: 2, confidence: 0.5, legend: {}, probabilities: {} } }}
        locale="en"
      />
    )

    expect(screen.getByText('1 ↔ 2')).toBeInTheDocument()
  })
})

// Wave C (plan §35/§45.3): every question row deep-links into Investigación
// with executionId + questionName + primitiveType so the user arrives with
// the question already focused. In compare rows the JEV value and the Δ are
// themselves links to the same WHY URL.
describe('QuestionResults — Investigación deep links (§35/§45.3)', () => {
  const EXECUTION_ID = 'run_deadbeefcafe1234'

  function investigationUrl(question: string, primitive: string) {
    return `/investigation?execution=${EXECUTION_ID}&question=${question}&primitive=${primitive}`
  }

  it('links each emulator row to Investigación with execution, question and primitive', () => {
    render(<QuestionResults answers={answers} dictionary={en.questions} executionId={EXECUTION_ID} locale="en" />)

    expect(screen.getByRole('link', { name: 'Inspect request_type' })).toHaveAttribute(
      'href',
      investigationUrl('request_type', 'choice')
    )
    expect(screen.getByRole('link', { name: 'Inspect urgency' })).toHaveAttribute(
      'href',
      investigationUrl('urgency', 'score')
    )
    expect(screen.getByRole('link', { name: 'Inspect refund_requested' })).toHaveAttribute(
      'href',
      investigationUrl('refund_requested', 'noul')
    )
  })

  it('links each compare row to Investigación with the comparison primitive', () => {
    renderCompare({ executionId: EXECUTION_ID })

    expect(screen.getByRole('link', { name: 'Inspect request_type' })).toHaveAttribute(
      'href',
      investigationUrl('request_type', 'choice')
    )
    expect(screen.getByRole('link', { name: 'Inspect urgency' })).toHaveAttribute(
      'href',
      investigationUrl('urgency', 'score')
    )
    expect(screen.getByRole('link', { name: 'Inspect refund_requested' })).toHaveAttribute(
      'href',
      investigationUrl('refund_requested', 'noul')
    )
  })

  it('keeps the row chevron visual on linked rows', () => {
    renderCompare({ executionId: EXECUTION_ID })

    expect(screen.getAllByText('>')).toHaveLength(3)
  })

  it('makes the JEV score value a link to the same WHY URL', () => {
    renderCompare({ executionId: EXECUTION_ID })

    const jevValue = screen.getByRole('link', { name: '1.64' })
    expect(jevValue).toHaveAttribute('href', investigationUrl('urgency', 'score'))
    // Same destination as the row-level Inspect affordance.
    expect(jevValue.getAttribute('href')).toBe(
      screen.getByRole('link', { name: 'Inspect urgency' }).getAttribute('href')
    )
  })

  it('makes the score Δ a link to the same WHY URL', () => {
    renderCompare({ executionId: EXECUTION_ID })

    expect(screen.getByRole('link', { name: 'Δ .18' })).toHaveAttribute(
      'href',
      investigationUrl('urgency', 'score')
    )
  })

  it('makes the JEV choice decision a link to the same WHY URL', () => {
    renderCompare({ executionId: EXECUTION_ID })

    expect(screen.getByRole('link', { name: 'billing' })).toHaveAttribute(
      'href',
      investigationUrl('request_type', 'choice')
    )
  })

  it('makes the JEV noul value and its Δ links to the same WHY URL', () => {
    renderCompare({ executionId: EXECUTION_ID })

    expect(screen.getByRole('link', { name: '.119' })).toHaveAttribute(
      'href',
      investigationUrl('refund_requested', 'noul')
    )
    expect(screen.getByRole('link', { name: 'Δ .037' })).toHaveAttribute(
      'href',
      investigationUrl('refund_requested', 'noul')
    )
  })

  it('renders no links at all without an execution id (no run)', () => {
    renderCompare()

    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('renders no links without an execution id in the emulator variant either', () => {
    render(<QuestionResults answers={answers} dictionary={en.questions} locale="en" />)

    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('uses the canonical Spanish Inspeccionar term for the accessible label', () => {
    renderCompare({ dictionary: es.questions, executionId: EXECUTION_ID, locale: 'es' })

    expect(screen.getByRole('link', { name: 'Inspeccionar urgency' })).toHaveAttribute(
      'href',
      investigationUrl('urgency', 'score')
    )
  })
})

// P36/FB9: a no-spaces choice value (the owner's worst case) must wrap —
// wrap-anywhere on the value spans, min-w-0 on the row's flex children —
// never overflow the §29 row (§16).
describe('QuestionResults — extreme values (P36/FB9)', () => {
  it('wraps a no-spaces choice value with wrap-anywhere and min-w-0 on the row flex children', () => {
    render(
      <QuestionResults
        answers={{
          request_type: {
            type: 'choice',
            choice: EXTREME_LABEL,
            confidence: 0.92,
            probabilities: { [EXTREME_LABEL]: 0.92, technical: 0.08 },
          },
          urgency: { type: 'score', score: 1.82, confidence: 0.6, legend: {}, probabilities: {} },
          refund_requested: { type: 'noul', noul: 0.082 },
        }}
        dictionary={en.questions}
        locale="en"
      />
    )

    // (a) honest render: the extreme value is present, no crash.
    const choiceValue = screen.getByText(EXTREME_LABEL)
    expect(choiceValue).toBeInTheDocument()
    // (b) class contract: the value spans carry the wrap hardening…
    expect(choiceValue).toHaveClass('wrap-anywhere')
    expect(screen.getByText('1.82')).toHaveClass('wrap-anywhere')
    expect(screen.getByText('P(true) 0.082')).toHaveClass('wrap-anywhere')
    // …and every flex child of the row can shrink below its min-content.
    const row = choiceValue.closest('li')
    expect(row).not.toBeNull()
    for (const child of row!.children) {
      expect(child).toHaveClass('min-w-0')
    }
  })

  // F1 (judge-confirmed): the question NAME is the same request-derived
  // no-spaces token class — the renamed KEY must render with wrap-anywhere
  // on the name span (min-w-0 alone cannot break a ~100-char token).
  it('wraps an extreme no-spaces question NAME with wrap-anywhere on the name span', () => {
    render(
      <QuestionResults
        answers={{
          [EXTREME_LABEL]: {
            type: 'choice',
            choice: 'billing',
            confidence: 0.92,
            probabilities: { billing: 0.92, technical: 0.08 },
          },
        }}
        dictionary={en.questions}
        locale="en"
      />
    )

    const nameSpan = screen.getByText(`${EXTREME_LABEL} · CHOICE`)
    expect(nameSpan).toBeInTheDocument()
    expect(nameSpan).toHaveClass('wrap-anywhere')
    expect(nameSpan).toHaveClass('min-w-0')
  })

  // F2 (judge-confirmed): the score-compare dominant levels carry the
  // request's criteria labels — an extreme label there must wrap too.
  it('wraps extreme dominant criteria labels on the score-compare row with wrap-anywhere + min-w-0', () => {
    render(
      <QuestionResults
        answers={{
          urgency: { type: 'score', score: 1.8, confidence: 0.6, legend: {}, probabilities: {} },
        }}
        comparison={{
          urgency: {
            primitive: 'score',
            fidelity: 0.9,
            aligned: true,
            components: {
              score_delta: 0.2,
              max_score: 3,
              score_similarity: 0.9,
              distribution_similarity: 0.9,
              confidence_delta: 0.05,
              emulator_dominant_level: EXTREME_LABEL,
              jev_dominant_level: EXTREME_LABEL,
            },
          },
        }}
        dictionary={en.questions}
        executionId="run_test"
        jevAnswers={{ urgency: { type: 'score', score: 2.0, confidence: 0.6, legend: {}, probabilities: {} } }}
        locale="en"
        requestQuestions={{
          urgency: { type: 'score', criteria: [EXTREME_LABEL, 'medium', 'high'] },
        }}
      />
    )

    // dominantLevelText renders the extreme token (here via the raw-level
    // last-resort branch — the class contract F2 pins is identical on the
    // criteria-preferred branch), and the dominant span must wrap (F2).
    const dominant = screen.getByText(new RegExp(EXTREME_LABEL))
    expect(dominant).toHaveClass('wrap-anywhere')
    expect(dominant).toHaveClass('min-w-0')
  })
})

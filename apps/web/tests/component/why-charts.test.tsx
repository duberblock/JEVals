import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WhyView } from '../../components/investigation/why-view'
import { QuestionResults } from '../../components/principal/question-results'
import { en } from '../../lib/i18n/en'
import type {
  EmulatorAnswer,
  ExecutionSnapshot,
  QuestionComparison,
  ScoreComponents,
} from '../../lib/execution-snapshot'
import { compareSnapshot, emulatorSnapshot } from '../fixtures/investigation-snapshot'

function clone(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ExecutionSnapshot
}

function renderWhy(snapshot: ExecutionSnapshot, questionName: string) {
  return render(
    <WhyView
      dictionary={en.investigation}
      focusAi={false}
      locale="en"
      onViewEvidence={() => undefined}
      questionName={questionName}
      snapshot={snapshot}
    />
  )
}

describe('WhyView — §33 score rail (B1, ADR-013 ruling 2)', () => {
  it('renders why-rail + score-rail with both values, the Δ line and the independent marker', () => {
    renderWhy(compareSnapshot(), 'urgency')

    expect(screen.getByTestId('why-rail')).toBeInTheDocument()
    const rail = screen.getByTestId('score-rail')
    expect(rail).toHaveAttribute('role', 'img')
    expect(screen.getByText('Emulator 1.82')).toBeInTheDocument()
    expect(screen.getByText('JEV 1.64')).toBeInTheDocument()
    expect(screen.getByText('Δ .18 · 0–2')).toBeInTheDocument()
    expect(screen.getByText('LLM · 1.71')).toBeInTheDocument()
    expect(screen.getByTestId('score-rail-independent')).toBeInTheDocument()
    expect(rail.getAttribute('aria-label')).toContain('Emulator 1.82')
    expect(rail.getAttribute('aria-label')).toContain('LLM 1.71')
  })

  it('renders no independent marker or label when the section is absent', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.independent_openai = undefined

    renderWhy(snapshot, 'urgency')

    expect(screen.getByTestId('score-rail')).toBeInTheDocument()
    expect(screen.queryByTestId('score-rail-independent')).not.toBeInTheDocument()
    expect(screen.queryByText('LLM · 1.71')).not.toBeInTheDocument()
  })

  it('renders no independent marker when the independent run failed', () => {
    const snapshot = clone(compareSnapshot())
    snapshot.independent_openai = { status: 'failed', error: 'adapter failure' }

    renderWhy(snapshot, 'urgency')

    expect(screen.getByTestId('score-rail')).toBeInTheDocument()
    expect(screen.queryByTestId('score-rail-independent')).not.toBeInTheDocument()
  })

  it('renders no rail when the components carry no max_score (honest absence)', () => {
    const snapshot = clone(compareSnapshot())
    // Partial models the honest absence: the key is GONE, not zero — the
    // why-view guard is a typeof check, so deletion is the faithful simulation.
    delete (snapshot.comparison!.questions.urgency.components as Partial<ScoreComponents>).max_score

    renderWhy(snapshot, 'urgency')

    expect(screen.queryByTestId('why-rail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('score-rail')).not.toBeInTheDocument()
  })
})

describe('WhyView — §33 noul rail (B3)', () => {
  it('renders why-rail + noul-rail with leading-dot values, the Δ line and the .5 midpoint', () => {
    renderWhy(compareSnapshot(), 'refund_requested')

    expect(screen.getByTestId('why-rail')).toBeInTheDocument()
    const rail = screen.getByTestId('noul-rail')
    expect(rail).toHaveAttribute('role', 'img')
    expect(screen.getByText('Emulator .082')).toBeInTheDocument()
    expect(screen.getByText('JEV .119')).toBeInTheDocument()
    expect(screen.getByText('Δ .037 · 0–1')).toBeInTheDocument()
    expect(screen.getByText('.5')).toBeInTheDocument()
    expect(screen.getByText('LLM · .081')).toBeInTheDocument()
    expect(rail.getAttribute('aria-label')).toContain('Δ .037')
  })
})

describe('WhyView — §33 choice bars disclosure (B2, §38)', () => {
  it('renders no bars by default — the disclosure stays closed (§38)', () => {
    renderWhy(compareSnapshot(), 'request_type')

    expect(screen.queryByTestId('choice-bars')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'View probabilities' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('reveals the choice bars on demand and closes them again', () => {
    renderWhy(compareSnapshot(), 'request_type')

    const toggle = screen.getByRole('button', { name: 'View probabilities' })
    fireEvent.click(toggle)

    expect(screen.getByTestId('why-probabilities')).toBeInTheDocument()
    const bars = screen.getByTestId('choice-bars')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText('75%')).toHaveLength(2)
    expect(screen.getByText('62.5%')).toBeInTheDocument()
    expect(bars.getAttribute('aria-label')).toContain('billing: Emulator 75%, JEV 62.5%, LLM 75%')

    fireEvent.click(toggle)
    expect(screen.queryByTestId('choice-bars')).not.toBeInTheDocument()
  })

  it('renders no rail for choice questions and nothing chart-like without a JEV side', () => {
    // Two renders in one test accumulate DOM in document.body — unmount
    // between them so the second assertions see only the emulator-only view.
    const compare = renderWhy(compareSnapshot(), 'request_type')
    expect(compare.queryByTestId('why-rail')).not.toBeInTheDocument()
    expect(compare.queryByTestId('score-rail')).not.toBeInTheDocument()
    expect(compare.queryByTestId('noul-rail')).not.toBeInTheDocument()
    compare.unmount()

    const emulatorOnly = renderWhy(emulatorSnapshot(), 'urgency')
    expect(emulatorOnly.queryByTestId('why-rail')).not.toBeInTheDocument()
    expect(emulatorOnly.queryByTestId('why-probabilities')).not.toBeInTheDocument()
  })
})

describe('WhyView — §33 judge verdict badge (B6)', () => {
  it('renders the badge inside the AI block for a successful evaluation', () => {
    renderWhy(compareSnapshot(), 'urgency')

    const badge = screen.getByTestId('judge-badge')
    expect(screen.getByTestId('why-ai')).toContainElement(badge)
    expect(badge).toHaveTextContent('Minor divergence · Tie')
    expect(badge.className).toContain('text-source-judge')
  })
})

// B4 (ADR-013 ruling 4): desktop-only minimal rail in the §29 compare score
// row — positions only, no text, aria-hidden; mobile rendering is untouched.
const emulatorAnswers: Record<string, EmulatorAnswer> = {
  request_type: {
    type: 'choice',
    choice: 'billing',
    confidence: 0.875,
    probabilities: { billing: 0.75, technical: 0.125, sales: 0.125 },
  },
  urgency: {
    type: 'score',
    score: 1.82,
    confidence: 0.75,
    legend: { '0': 'low', '1': 'medium', '2': 'high' },
    probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 },
  },
}

const jevAnswers: Record<string, EmulatorAnswer> = {
  request_type: {
    type: 'choice',
    choice: 'billing',
    confidence: 0.625,
    probabilities: { billing: 0.625, technical: 0.125, sales: 0.25 },
  },
  urgency: {
    type: 'score',
    score: 1.64,
    confidence: 0.625,
    legend: { '0': 'low', '1': 'medium', '2': 'high' },
    probabilities: { '0': 0.15, '1': 0.25, '2': 0.6 },
  },
}

const comparison: Record<string, QuestionComparison> = {
  request_type: {
    primitive: 'choice',
    fidelity: 0.9,
    aligned: true,
    components: { decision_match: true, confidence_delta: 0.25, distribution_similarity: 0.833 },
  },
  urgency: {
    primitive: 'score',
    fidelity: 0.95,
    aligned: true,
    components: {
      score_delta: 0.18,
      max_score: 2,
      score_similarity: 0.91,
      distribution_similarity: 0.85,
      confidence_delta: 0.125,
      emulator_dominant_level: '2',
      jev_dominant_level: '2',
    },
  },
}

function renderCompareRows(overrides: { comparison?: Record<string, QuestionComparison> } = {}) {
  return render(
    <QuestionResults
      answers={emulatorAnswers}
      comparison={overrides.comparison ?? comparison}
      dictionary={en.questions}
      jevAnswers={jevAnswers}
      locale="en"
    />
  )
}

describe('QuestionResults — B4 desktop-only minimal rail (§29/ADR-013 ruling 4)', () => {
  it('renders the minimal rail inside the score compare row, desktop-only and decorative', () => {
    renderCompareRows()

    const rail = screen.getByTestId('score-rail-minimal')
    expect(rail.className).toContain('hidden')
    expect(rail.className).toContain('lg:block')
    expect(rail).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders no minimal rail for the choice row', () => {
    renderCompareRows()

    expect(screen.queryAllByTestId('score-rail-minimal')).toHaveLength(1)
  })

  it('renders no minimal rail when the components carry no max_score (honest absence)', () => {
    const withoutMax = JSON.parse(JSON.stringify(comparison)) as Record<string, QuestionComparison>
    delete (withoutMax.urgency.components as Partial<ScoreComponents>).max_score

    renderCompareRows({ comparison: withoutMax })

    expect(screen.queryByTestId('score-rail-minimal')).not.toBeInTheDocument()
  })
})

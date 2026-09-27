import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ValidationPanel } from '../../components/principal/validation-panel'
import { en } from '../../lib/i18n/en'
import type { EntryState } from '../../lib/execution-snapshot'
import type { ValidationState } from '../../lib/validation-state'

const sampleQuestions = [
  { name: 'request_type', primitive: 'choice' },
  { name: 'urgency', primitive: 'score' },
  { name: 'refund_requested', primitive: 'noul' },
] as const

function renderPanel(state: ValidationState) {
  return render(<ValidationPanel state={state} dictionary={en.principal.validation} />)
}

describe('ValidationPanel', () => {
  it('shows a waiting hint before any JSON is entered', () => {
    renderPanel({ kind: 'empty' })
    expect(screen.getByText('Paste a SystemOneRequest to validate it.')).toBeInTheDocument()
    expect(screen.queryByText('VALID')).not.toBeInTheDocument()
  })

  it('shows a syntax error state with the parse message and never claims VALID', () => {
    renderPanel({ kind: 'syntax-error', message: "Expected property name in JSON at position 1" })
    expect(screen.getByText('✗ Syntax error')).toBeInTheDocument()
    expect(screen.getByText(/Expected property name/)).toBeInTheDocument()
    expect(screen.queryByText('VALID')).not.toBeInTheDocument()
  })

  it('shows a checking state while the debounced validation runs', () => {
    renderPanel({ kind: 'checking' })
    expect(screen.getByText('Validating…')).toBeInTheDocument()
  })

  it('renders VALID with the full QUESTIONS DETECTED detail on desktop', () => {
    renderPanel({ kind: 'valid', questions: [...sampleQuestions] })

    expect(screen.getByText('✓ VALID')).toBeInTheDocument()
    expect(screen.getByText('3 QUESTIONS DETECTED')).toBeInTheDocument()

    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.getByText('request_type')).toBeInTheDocument()
    expect(screen.getByText('CHOICE')).toBeInTheDocument()
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.getByText('urgency')).toBeInTheDocument()
    expect(screen.getByText('SCORE')).toBeInTheDocument()
    expect(screen.getByText('Q3')).toBeInTheDocument()
    expect(screen.getByText('refund_requested')).toBeInTheDocument()
    expect(screen.getByText('NOUL')).toBeInTheDocument()

    expect(screen.getByText('Detection source: questions[name].type')).toBeInTheDocument()
  })

  it('uses the singular form for a single detected question', () => {
    renderPanel({ kind: 'valid', questions: [{ name: 'urgency', primitive: 'score' }] })
    expect(screen.getByText('1 QUESTION DETECTED')).toBeInTheDocument()
  })

  it('adds the per-count summary line when several questions share types', () => {
    renderPanel({
      kind: 'valid',
      questions: [
        { name: 'a', primitive: 'choice' },
        { name: 'b', primitive: 'choice' },
        { name: 'c', primitive: 'score' },
        { name: 'd', primitive: 'noul' },
      ],
    })
    expect(screen.getByText('2 Choice · 1 Score · 1 Noul')).toBeInTheDocument()
  })

  it('renders the mobile compact line that opens the detail drawer', () => {
    renderPanel({ kind: 'valid', questions: [...sampleQuestions] })
    const compact = screen.getByRole('button', {
      name: '✓ VALID · 3 QUESTIONS · Choice / Score / Noul',
    })
    expect(compact).toBeInTheDocument()
  })

  it('replaces VALID with the domain error title and detail when invalid', () => {
    renderPanel({
      kind: 'invalid',
      title: 'Unsupported question type',
      detail: "Question 'x' has unsupported type 'boolean'. Supported types: choice, score, noul.",
    })
    expect(screen.getByText('✗ Unsupported question type')).toBeInTheDocument()
    expect(
      screen.getByText("Question 'x' has unsupported type 'boolean'. Supported types: choice, score, noul.")
    ).toBeInTheDocument()
    expect(screen.queryByText('VALID')).not.toBeInTheDocument()
  })
})

// P47 (a): the scenario box inside the validation panel — under the questions
// detected, fed by the LIVE editor parse (never by the /validations API).
describe('ValidationPanel — scenario box (P47a)', () => {
  const scenarioState: EntryState = { message: 'I was charged twice on my invoice.' }

  function renderPanelWithScenario(state: ValidationState, withScenario: boolean) {
    return render(
      <ValidationPanel
        dictionary={en.principal.validation}
        scenario={en.scenario}
        scenarioState={withScenario ? scenarioState : null}
        state={state}
      />
    )
  }

  it('renders the box under the questions detected when the live parse found a state', () => {
    renderPanelWithScenario({ kind: 'valid', questions: [...sampleQuestions] }, true)

    const panel = screen.getByTestId('validation-panel')
    const box = within(panel).getByTestId('scenario-box')
    // Under the questions detected: the detection-source line (the last
    // QuestionsDetected child) comes BEFORE the box in the DOM.
    const detectionSource = within(panel).getByText('Detection source: questions[name].type')
    expect(detectionSource.compareDocumentPosition(box)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // Collapsed by default (§38 idiom).
    expect(within(box).getByRole('button', { name: /View scenario/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders no box at all when the state is null (absence, never an empty box)', () => {
    renderPanelWithScenario({ kind: 'valid', questions: [...sampleQuestions] }, false)
    expect(screen.queryByTestId('scenario-box')).not.toBeInTheDocument()
  })

  it('renders the box while the API verdict is still pending (checking) — the source is the live parse', () => {
    renderPanelWithScenario({ kind: 'checking' }, true)
    // The box does not wait for /validations: the parse already knows.
    expect(screen.getByText('Validating…')).toBeInTheDocument()
    expect(screen.getByTestId('scenario-box')).toBeInTheDocument()
  })

  it('expands to the exact pretty JSON of the parsed state', () => {
    renderPanelWithScenario({ kind: 'valid', questions: [...sampleQuestions] }, true)
    fireEvent.click(screen.getByRole('button', { name: /View scenario/ }))
    expect(screen.getByTestId('scenario-content').textContent).toBe(JSON.stringify(scenarioState, null, 2))
  })
})

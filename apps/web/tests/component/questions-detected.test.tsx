import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QuestionsDetected } from '../../components/principal/questions-detected'
import { en } from '../../lib/i18n/en'
import { EXTREME_LABEL } from './extreme-labels'

// R38 (ADR-012 adoption debt): the ✓ valid line uses the semantic success
// token, never an inline Tailwind palette class.
describe('QuestionsDetected — semantic state tokens (R38)', () => {
  const questions = [
    { name: 'request_type', primitive: 'choice' as const },
    { name: 'urgency', primitive: 'score' as const },
  ]

  it('colors the ✓ valid line with text-success, not an emerald palette class', () => {
    render(<QuestionsDetected dictionary={en.principal.validation} questions={questions} />)

    const validLine = screen.getByText('✓ VALID')
    expect(validLine).toHaveClass('text-success')
    expect(validLine).not.toHaveClass('text-emerald-600')
    expect(validLine).not.toHaveClass('dark:text-emerald-400')
    // Every other utility in the className string stays intact.
    expect(validLine).toHaveClass('text-sm', 'font-bold')
  })
})

// P36/FB9: the compact panel keeps truncate (R43 panel decision) but GAINS
// title={question.name} so the full no-spaces name is reachable on hover —
// the only truncate surface, per the amended ruling.
describe('QuestionsDetected — extreme name keeps truncate + gains title (P36/FB9)', () => {
  it('keeps truncate on the dd and exposes the full extreme name via title', () => {
    render(
      <QuestionsDetected
        dictionary={en.principal.validation}
        questions={[{ name: EXTREME_LABEL, primitive: 'choice' }]}
      />
    )

    const name = screen.getByText(EXTREME_LABEL)
    expect(name).toBeInTheDocument()
    expect(name).toHaveClass('truncate')
    expect(name).toHaveClass('min-w-0')
    expect(name).toHaveAttribute('title', EXTREME_LABEL)
  })
})

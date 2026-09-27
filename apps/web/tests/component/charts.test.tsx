import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChoiceBars } from '../../components/charts/choice-bars'
import { JudgeBadge } from '../../components/charts/judge-badge'
import { NoulRail } from '../../components/charts/noul-rail'
import { ScoreRail } from '../../components/charts/score-rail'
import { EXTREME_LABEL } from './extreme-labels'

const labels = { emulator: 'Emulator', jev: 'JEV', independent: 'LLM' }

describe('ScoreRail — §33 B1', () => {
  it('renders both source labels with values, the Δ line and the tick scale as visible text', () => {
    render(<ScoreRail delta={0.18} emulatorScore={1.82} jevScore={1.64} labels={labels} locale="en" maxScore={2} />)

    expect(screen.getByText('Emulator 1.82')).toBeInTheDocument()
    expect(screen.getByText('JEV 1.64')).toBeInTheDocument()
    expect(screen.getByText('Δ .18 · 0–2')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('carries role=img with an aria-label spelling out every number', () => {
    render(
      <ScoreRail
        delta={0.18}
        emulatorScore={1.82}
        independentScore={1.71}
        jevScore={1.64}
        labels={labels}
        locale="en"
        maxScore={2}
      />
    )

    const rail = screen.getByTestId('score-rail')
    expect(rail).toHaveAttribute('role', 'img')
    expect(rail.getAttribute('aria-label')).toContain('Emulator 1.82')
    expect(rail.getAttribute('aria-label')).toContain('JEV 1.64')
    expect(rail.getAttribute('aria-label')).toContain('Δ .18')
    expect(rail.getAttribute('aria-label')).toContain('2')
    expect(rail.getAttribute('aria-label')).toContain('LLM 1.71')
  })

  it('positions the markers by value/max with the A7 source hues', () => {
    render(<ScoreRail delta={0.5} emulatorScore={1.5} jevScore={1} labels={labels} locale="en" maxScore={2} />)

    expect(screen.getByTestId('score-rail-emulator')).toHaveStyle({ left: '75%' })
    expect(screen.getByTestId('score-rail-jev')).toHaveStyle({ left: '50%' })
    expect(screen.getByTestId('score-rail-emulator').className).toContain('bg-source-emulator')
    expect(screen.getByTestId('score-rail-jev').className).toContain('bg-source-jev')
  })

  it('shows the independent as a smaller secondary marker with its label', () => {
    render(
      <ScoreRail
        delta={0.11}
        emulatorScore={1.82}
        independentScore={1.71}
        jevScore={1.64}
        labels={labels}
        locale="en"
        maxScore={2}
      />
    )

    expect(screen.getByText('LLM · 1.71')).toBeInTheDocument()
    expect(screen.getByTestId('score-rail-independent').className).toContain('bg-source-independent')
  })

  it('renders no independent marker or label when it did not run', () => {
    render(<ScoreRail delta={0.18} emulatorScore={1.82} jevScore={1.64} labels={labels} locale="en" maxScore={2} />)

    expect(screen.queryByTestId('score-rail-independent')).not.toBeInTheDocument()
    expect(screen.queryByText(/LLM/)).not.toBeInTheDocument()
  })

  it('omits the midpoint tick when maxScore < 2', () => {
    render(<ScoreRail delta={0.2} emulatorScore={0.6} jevScore={0.4} labels={labels} locale="en" maxScore={1} />)

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('0.5')).not.toBeInTheDocument()
  })
})

describe('NoulRail — §33 B3', () => {
  it('renders leading-dot values, the Δ line and the labeled .5 midpoint over the fixed 0..1 range', () => {
    render(<NoulRail delta={0.037} emulatorNoul={0.082} jevNoul={0.119} labels={labels} locale="en" />)

    expect(screen.getByText('Emulator .082')).toBeInTheDocument()
    expect(screen.getByText('JEV .119')).toBeInTheDocument()
    expect(screen.getByText('Δ .037 · 0–1')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('.5')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('carries role=img with the full numeric aria-label', () => {
    render(
      <NoulRail
        delta={0.037}
        emulatorNoul={0.082}
        independentNoul={0.081}
        jevNoul={0.119}
        labels={labels}
        locale="en"
      />
    )

    const rail = screen.getByTestId('noul-rail')
    expect(rail).toHaveAttribute('role', 'img')
    expect(rail.getAttribute('aria-label')).toContain('Emulator .082')
    expect(rail.getAttribute('aria-label')).toContain('JEV .119')
    expect(rail.getAttribute('aria-label')).toContain('Δ .037')
    expect(rail.getAttribute('aria-label')).toContain('LLM .081')
  })

  it('positions the markers over the fixed 0..1 range', () => {
    render(<NoulRail delta={0.25} emulatorNoul={0.75} jevNoul={0.5} labels={labels} locale="en" />)

    expect(screen.getByTestId('noul-rail-emulator')).toHaveStyle({ left: '75%' })
    expect(screen.getByTestId('noul-rail-jev')).toHaveStyle({ left: '50%' })
  })

  it('shows and hides the independent marker with its label', () => {
    const view = render(
      <NoulRail delta={0.037} emulatorNoul={0.082} independentNoul={0.081} jevNoul={0.119} labels={labels} locale="en" />
    )
    expect(screen.getByText('LLM · .081')).toBeInTheDocument()
    expect(screen.getByTestId('noul-rail-independent')).toBeInTheDocument()

    view.unmount()
    render(<NoulRail delta={0.037} emulatorNoul={0.082} jevNoul={0.119} labels={labels} locale="en" />)
    expect(screen.queryByText('LLM · .081')).not.toBeInTheDocument()
    expect(screen.queryByTestId('noul-rail-independent')).not.toBeInTheDocument()
  })
})

describe('ChoiceBars — §33 B2', () => {
  it('renders one row per option with stacked source bars and visible percentages', () => {
    render(
      <ChoiceBars
        emulatorProbabilities={{ billing: 0.75, technical: 0.125 }}
        jevProbabilities={{ billing: 0.625, technical: 0.125 }}
        labels={labels}
        locale="en"
      />
    )

    expect(screen.getByText('billing')).toBeInTheDocument()
    expect(screen.getByText('technical')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('62.5%')).toBeInTheDocument()
    expect(screen.getAllByText('12.5%')).toHaveLength(2)
  })

  it('enumerates every value in the role=img aria-label', () => {
    render(
      <ChoiceBars
        emulatorProbabilities={{ billing: 0.75 }}
        jevProbabilities={{ billing: 0.625 }}
        labels={labels}
        locale="en"
      />
    )

    const bars = screen.getByTestId('choice-bars')
    expect(bars).toHaveAttribute('role', 'img')
    expect(bars.getAttribute('aria-label')).toContain('billing: Emulator 75%, JEV 62.5%')
  })

  it('adds the thinner independent bar and its label when present', () => {
    render(
      <ChoiceBars
        emulatorProbabilities={{ billing: 0.75 }}
        independentProbabilities={{ billing: 0.5 }}
        jevProbabilities={{ billing: 0.625 }}
        labels={labels}
        locale="en"
      />
    )

    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByTestId('choice-bars').getAttribute('aria-label')).toContain('LLM 50%')
  })

  it('skips a side bar when that side carries no probability for the option', () => {
    render(
      <ChoiceBars
        emulatorProbabilities={{ billing: 0.75, technical: 0.125 }}
        jevProbabilities={{ billing: 0.625 }}
        labels={labels}
        locale="en"
      />
    )

    expect(screen.getAllByText('12.5%')).toHaveLength(1)
  })
})

// P36/FB9: a no-spaces option label (the owner's worst case) must render
// honestly AND wrap — wrap-anywhere on the label element, min-w-0 on the
// row that carries it (R34) — never break the bars box (§16).
describe('ChoiceBars — extreme option labels (P36/FB9)', () => {
  it('wraps a no-spaces option label with wrap-anywhere inside the min-w-0 row', () => {
    render(
      <ChoiceBars
        emulatorProbabilities={{ [EXTREME_LABEL]: 0.75 }}
        jevProbabilities={{ [EXTREME_LABEL]: 0.625 }}
        labels={labels}
        locale="en"
      />
    )

    const optionLabel = screen.getByText(EXTREME_LABEL)
    expect(optionLabel).toBeInTheDocument()
    expect(optionLabel).toHaveClass('wrap-anywhere')
    expect(optionLabel.parentElement).toHaveClass('min-w-0')
  })
})

describe('JudgeBadge — §33 B6', () => {
  it('renders the §67 headline with the Judge ink styling', () => {
    render(<JudgeBadge divergence="Minor divergence" preferred="Tie" />)

    const badge = screen.getByTestId('judge-badge')
    expect(badge).toHaveTextContent('Minor divergence · Tie')
    expect(badge.className).toContain('text-source-judge')
    expect(badge.className).toContain('border-source-judge')
    expect(badge.className).toContain('text-label-caps')
  })

  it('renders the divergence alone when no preferred word exists', () => {
    render(<JudgeBadge divergence="Undetermined divergence" preferred="" />)

    expect(screen.getByTestId('judge-badge')).toHaveTextContent('Undetermined divergence')
  })
})

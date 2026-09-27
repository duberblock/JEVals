import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ModeSelector } from '../../components/principal/mode-selector'
import { en } from '../../lib/i18n/en'
import { EXTREME_LABEL } from './extreme-labels'

function renderSelector(availability?: { jevAvailable?: boolean; llmAvailable?: boolean }) {
  return render(
    <ModeSelector
      dictionary={en.mode}
      jevAvailable={availability?.jevAvailable}
      llmAvailable={availability?.llmAvailable}
    />
  )
}

describe('ModeSelector', () => {
  it('renders the three canonical modes with the exact section 20 copy', () => {
    renderSelector()

    expect(screen.getByRole('radio', { name: /Emulator/ })).toHaveAttribute('value', 'emulator')
    expect(screen.getByRole('radio', { name: /Compare with JEV/ })).toHaveAttribute('value', 'compare')
    expect(screen.getByRole('radio', { name: /Evaluate prediction/ })).toHaveAttribute(
      'value',
      'compare-and-evaluate'
    )

    expect(screen.getByText('Run locally')).toBeInTheDocument()
    expect(screen.getByText('Emulator + real JEV')).toBeInTheDocument()
    expect(screen.getByText('Emulator + real JEV + AI evaluation')).toBeInTheDocument()
  })

  it('selects Emulator by default and keeps the gated modes disabled with honest hints', () => {
    renderSelector()

    const emulator = screen.getByRole('radio', { name: /Emulator/ }) as HTMLInputElement
    expect(emulator).toBeChecked()
    expect(screen.getByRole('radio', { name: /Compare with JEV/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Evaluate prediction/ })).toBeDisabled()

    // Each unavailable mode has its own honest hint (plan section 63: never
    // invent availability). The evaluate mode is implemented now — its
    // later-phase hint is gone; LLM configuration gates it.
    expect(screen.getByText('JEV is not configured.')).toBeInTheDocument()
    expect(screen.getByText('No LLM provider is configured.')).toBeInTheDocument()
    expect(screen.queryByText('Coming in a later phase.')).not.toBeInTheDocument()
  })

  it('enables and selects Compare with JEV when the capabilities say JEV is available', () => {
    const onChange = vi.fn()
    render(
      <ModeSelector
        dictionary={en.mode}
        jevAvailable
        onChange={onChange}
        value="emulator"
        llmAvailable={false}
      />
    )

    const compare = screen.getByRole('radio', { name: /Compare with JEV/ })
    expect(compare).toBeEnabled()
    expect(screen.queryByText('JEV is not configured.')).not.toBeInTheDocument()

    fireEvent.click(compare)
    expect(onChange).toHaveBeenCalledWith('compare')

    // Evaluate prediction still follows the LLM capability.
    expect(screen.getByRole('radio', { name: /Evaluate prediction/ })).toBeDisabled()
    expect(screen.getByText('No LLM provider is configured.')).toBeInTheDocument()
  })

  // W1: Evaluate prediction is implemented — selectable iff LLM is
  // configured (capabilities.openai.available).
  it('enables and selects Evaluate prediction when the capabilities say LLM is available', () => {
    const onChange = vi.fn()
    render(
      <ModeSelector dictionary={en.mode} jevAvailable onChange={onChange} value="compare" llmAvailable />
    )

    const evaluate = screen.getByRole('radio', { name: /Evaluate prediction/ })
    expect(evaluate).toBeEnabled()
    expect(screen.queryByText('No LLM provider is configured.')).not.toBeInTheDocument()

    fireEvent.click(evaluate)
    expect(onChange).toHaveBeenCalledWith('compare-and-evaluate')
  })

  it('keeps Evaluate prediction disabled when LLM is unavailable even if JEV is available', () => {
    renderSelector({ jevAvailable: true, llmAvailable: false })

    expect(screen.getByRole('radio', { name: /Compare with JEV/ })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /Evaluate prediction/ })).toBeDisabled()
    expect(screen.getByText('No LLM provider is configured.')).toBeInTheDocument()
  })

  // J1/F7: evaluate runs Emulator + JEV + Judge — it needs BOTH providers.
  // With LLM configured but JEV missing the radio must stay disabled with
  // the JEV hint (the mode cannot run without the real JEV leg).
  it('keeps Evaluate prediction disabled when JEV is unavailable even if LLM is available', () => {
    renderSelector({ jevAvailable: false, llmAvailable: true })

    expect(screen.getByRole('radio', { name: /Compare with JEV/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Evaluate prediction/ })).toBeDisabled()
    // Both JEV-dependent modes show the honest JEV hint.
    expect(screen.getAllByText('JEV is not configured.')).toHaveLength(2)
  })

  it('exposes the execution mode group with a legend', () => {
    renderSelector()
    expect(screen.getByText('Execution mode')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Execution mode' })).toBeInTheDocument()
  })
})

// P36/FB9: a no-spaces mode label must wrap — wrap-anywhere on the title
// span, min-w-0 on the flex-1 label — never overflow the radio row (§16).
describe('ModeSelector — extreme label (P36/FB9)', () => {
  it('wraps a no-spaces mode label with wrap-anywhere and keeps min-w-0 on the flex-1 label', () => {
    render(<ModeSelector dictionary={{ ...en.mode, emulator: EXTREME_LABEL }} />)

    const title = screen.getByText(EXTREME_LABEL)
    expect(title).toHaveAttribute('id', 'execution-mode-emulator')
    expect(title).toHaveClass('wrap-anywhere')
    expect(title.closest('label')).toHaveClass('min-w-0')
  })
})

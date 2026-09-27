import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AdvancedPanel } from '../../components/principal/advanced-panel'
import { en } from '../../lib/i18n/en'

describe('AdvancedPanel', () => {
  it('renders the Independent LLM prediction checkbox under the Advanced label', () => {
    render(<AdvancedPanel dictionary={en.advanced} />)

    expect(screen.getByText('Advanced')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: 'Independent LLM prediction' })
    expect(checkbox).toBeInTheDocument()
  })

  // W1: the option is real now — it stays interactive iff the capabilities
  // say LLM is configured (plan section 63: never invent availability).
  it('keeps the checkbox disabled with the honest hint when LLM is not configured', () => {
    render(<AdvancedPanel dictionary={en.advanced} llmAvailable={false} />)

    expect(screen.getByRole('checkbox', { name: 'Independent LLM prediction' })).toBeDisabled()
    expect(screen.getByText('No LLM provider is configured.')).toBeInTheDocument()
    expect(screen.queryByText('Coming in a later phase.')).not.toBeInTheDocument()
  })

  it('defaults to the disabled state before capabilities arrive', () => {
    render(<AdvancedPanel dictionary={en.advanced} />)

    expect(screen.getByRole('checkbox', { name: 'Independent LLM prediction' })).toBeDisabled()
  })

  it('enables the checkbox when LLM is available and reports the checked change', () => {
    const onChange = vi.fn()
    render(<AdvancedPanel dictionary={en.advanced} onChange={onChange} llmAvailable />)

    const checkbox = screen.getByRole('checkbox', { name: 'Independent LLM prediction' }) as HTMLInputElement
    expect(checkbox).toBeEnabled()
    expect(checkbox).not.toBeChecked()
    expect(screen.queryByText('No LLM provider is configured.')).not.toBeInTheDocument()

    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(false)
    expect(checkbox).not.toBeChecked()
  })

  it('renders the controlled checked state', () => {
    render(<AdvancedPanel checked dictionary={en.advanced} onChange={() => {}} llmAvailable />)

    expect(screen.getByRole('checkbox', { name: 'Independent LLM prediction' })).toBeChecked()
  })
})

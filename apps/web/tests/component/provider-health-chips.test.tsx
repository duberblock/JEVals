import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProviderHealthChips } from '../../components/principal/provider-health-chips'
import { en } from '../../lib/i18n/en'

// C8 (FASE C / §63): pre-run provider health chips. Tri-state semantics —
// the asymmetry is the point: unknown (pending/failed capabilities fetch)
// is NOT an outage and must never render ✗.
function renderChips(states: { emulator: boolean | null; jev: boolean | null; openai: boolean | null }) {
  return render(<ProviderHealthChips dictionary={en.principal.providerHealth} states={states} />)
}

describe('ProviderHealthChips (C8)', () => {
  it('renders ✓ plus the available word for explicitly available providers', () => {
    renderChips({ emulator: true, jev: true, openai: true })

    // R37 round 2: the group role makes the summarizing aria-label reachable
    // to assistive tech (aria-label on a plain div is dropped).
    const chips = screen.getByRole('group', {
      name: 'Emulator available · JEV available · LLM available',
    })
    expect(chips).toHaveAttribute('data-testid', 'provider-health-chips')
    expect(within(chips).getAllByText('✓')).toHaveLength(3)
    expect(within(chips).queryByText('✗')).not.toBeInTheDocument()
    expect(within(chips).getByText('Providers')).toBeInTheDocument()
  })

  it('renders ✗ plus the unavailable word for explicitly unavailable providers', () => {
    renderChips({ emulator: true, jev: false, openai: null })

    const chips = screen.getByRole('group', {
      name: 'Emulator available · JEV unavailable · LLM unknown',
    })
    expect(within(chips).getByText('✗')).toBeInTheDocument()
    expect(chips).not.toHaveTextContent('LLM✗')
  })

  it('renders the unknown glyph for unknown providers and NEVER ✗', () => {
    renderChips({ emulator: null, jev: null, openai: null })

    const chips = screen.getByRole('group', {
      name: 'Emulator unknown · JEV unknown · LLM unknown',
    })
    expect(within(chips).getAllByText('…')).toHaveLength(3)
    expect(within(chips).queryByText('✗')).not.toBeInTheDocument()
  })

  it('renders the three §63 provider names in the canonical order', () => {
    renderChips({ emulator: true, jev: true, openai: true })

    const chips = screen.getByTestId('provider-health-chips')
    const text = chips.textContent ?? ''
    expect(text.indexOf('Emulator')).toBeLessThan(text.indexOf('JEV'))
    expect(text.indexOf('JEV')).toBeLessThan(text.indexOf('LLM'))
  })
})

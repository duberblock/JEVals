import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SourceStatusStrip } from '../../components/principal/source-status-strip'

const labels = { emulator: 'Emulator', jev: 'JEV', judge: 'Judge', independent: 'Independent' }

describe('SourceStatusStrip (C7/C11)', () => {
  it('renders the four canonical chips in order with labels and state glyphs', () => {
    render(
      <SourceStatusStrip
        labels={labels}
        status={{ emulator: 'success', jev: 'failed', judge: null, independent: 'success' }}
      />
    )

    const strip = screen.getByTestId('source-strip')
    expect(
      Array.from(strip.querySelectorAll('[data-testid^="source-chip-"]')).map((chip) =>
        chip.getAttribute('data-testid')
      )
    ).toEqual(['source-chip-emulator', 'source-chip-jev', 'source-chip-judge', 'source-chip-independent'])
    expect(strip).toHaveAttribute(
      'aria-label',
      'Emulator ✓ · JEV ✗ · Judge — · Independent ✓'
    )
    expect(screen.getByTestId('source-chip-emulator')).toHaveTextContent('Emulator✓')
    expect(screen.getByTestId('source-chip-jev')).toHaveTextContent('JEV✗')
    expect(screen.getByTestId('source-chip-judge')).toHaveTextContent('Judge—')
    expect(screen.getByTestId('source-chip-independent')).toHaveTextContent('Independent✓')
  })

  it('renders the failed glyph in the destructive color (a failed leg reads as failure)', () => {
    render(
      <SourceStatusStrip
        labels={labels}
        status={{ emulator: 'success', jev: 'failed', judge: null, independent: null }}
      />
    )

    const failedGlyph = screen.getByTestId('source-chip-jev').querySelector('span:last-child')
    expect(failedGlyph).toHaveTextContent('✗')
    expect(failedGlyph).toHaveClass('text-destructive')
  })

  // G2: the Judge failure is visible here even though the §32 AI summary line
  // itself renders nothing when the Judge failed.
  it('shows the judge chip as failed when the judge leg failed', () => {
    render(
      <SourceStatusStrip
        labels={labels}
        status={{ emulator: 'success', jev: 'success', judge: 'failed', independent: null }}
      />
    )

    expect(screen.getByTestId('source-chip-judge')).toHaveTextContent('Judge✗')
  })

  it('renders not-run chips with a dash, never a failure (honest absence)', () => {
    render(
      <SourceStatusStrip
        labels={labels}
        status={{ emulator: 'success', jev: null, judge: null, independent: null }}
      />
    )

    expect(screen.getByTestId('source-chip-jev')).toHaveTextContent('JEV—')
    expect(screen.getByTestId('source-chip-judge')).toHaveTextContent('Judge—')
    expect(screen.getByTestId('source-chip-independent')).toHaveTextContent('Independent—')
  })

  // P28 (FB1): while running, an OBSERVED status (a §65 section event that
  // already arrived on the SSE stream) renders its observed glyph; chips
  // without an event yet stay neutral. This supersedes the pure-C11 pin (all
  // chips '…' regardless of status) — still no invented states, only
  // observed ones.
  it('renders observed statuses on their chips while running and keeps unobserved chips neutral', () => {
    render(
      <SourceStatusStrip
        labels={labels}
        running
        status={{ emulator: 'success', jev: 'failed', judge: null, independent: null }}
      />
    )

    const strip = screen.getByTestId('source-strip')
    expect(strip).toHaveAttribute('aria-busy', 'true')
    expect(strip).toHaveAttribute('aria-label', 'Emulator ✓ · JEV ✗ · Judge … · Independent …')
    expect(screen.getByTestId('source-chip-emulator')).toHaveTextContent('Emulator✓')
    expect(screen.getByTestId('source-chip-jev')).toHaveTextContent('JEV✗')
    for (const source of ['judge', 'independent'] as const) {
      const chip = screen.getByTestId(`source-chip-${source}`)
      expect(chip).toHaveTextContent('…')
      expect(chip.textContent).not.toMatch(/[✓✗]/)
    }
  })

  it('renders the neutral in-flight glyph on every chip while running when nothing was observed yet (no invented states)', () => {
    render(
      <SourceStatusStrip
        labels={labels}
        running
        status={{ emulator: null, jev: null, judge: null, independent: null }}
      />
    )

    const strip = screen.getByTestId('source-strip')
    expect(strip).toHaveAttribute('aria-busy', 'true')
    expect(strip).toHaveAttribute('aria-label', 'Emulator … · JEV … · Judge … · Independent …')
    for (const source of ['emulator', 'jev', 'judge', 'independent'] as const) {
      const chip = screen.getByTestId(`source-chip-${source}`)
      expect(chip).toHaveTextContent('…')
      expect(chip.textContent).not.toMatch(/[✓✗]/)
    }
  })
})

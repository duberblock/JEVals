import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ExecutionContextBar } from '../../components/principal/execution-context-bar'
import { en } from '../../lib/i18n/en'
import { EXTREME_LABEL } from './extreme-labels'

// C5 (FASE C): canonical context strip — the prototype subheader treatment
// transposed to §15 vocabulary with REAL persisted snapshot facts only.
const baseProps = {
  dictionary: en.principal.contextBar,
  locale: 'en' as const,
  modeLabels: en.recent.mode,
  runningText: en.run.running,
  units: en.units,
}

describe('ExecutionContextBar — honest states (C5)', () => {
  it('renders the honest no-active line and no segment labels when idle', () => {
    render(<ExecutionContextBar {...baseProps} state={{ kind: 'idle' }} />)

    const bar = screen.getByTestId('execution-context-bar')
    expect(bar).toHaveAttribute('aria-label', 'Execution context')
    expect(within(bar).getByText('Execution')).toBeInTheDocument()
    expect(within(bar).getByText('No active execution')).toBeInTheDocument()
    // Absent context is OMITTED, never '—' placeholders.
    expect(within(bar).queryByText('Run ID')).not.toBeInTheDocument()
    expect(within(bar).queryByText('Mode')).not.toBeInTheDocument()
    expect(within(bar).queryByText('Duration')).not.toBeInTheDocument()
    expect(within(bar).queryByText('Providers')).not.toBeInTheDocument()
  })

  it('renders the running copy while a run is in flight', () => {
    render(<ExecutionContextBar {...baseProps} state={{ kind: 'running' }} />)

    expect(screen.getByText('Running…')).toBeInTheDocument()
    expect(screen.queryByText('No active execution')).not.toBeInTheDocument()
  })

  it('renders the persisted segments: short id, mode label, duration with unit, providers joined', () => {
    render(
      <ExecutionContextBar
        {...baseProps}
        state={{
          kind: 'completed',
          summary: {
            executionId: 'run_deadbeefcafe1234',
            mode: 'compare-and-evaluate',
            durationMs: 1420,
            providers: ['gpt-4o-mini', 'jev-latest'],
          },
        }}
      />
    )

    const bar = screen.getByTestId('execution-context-bar')
    expect(within(bar).getByText('run_deadbeef')).toBeInTheDocument() // shortExecutionId (12 chars)
    expect(within(bar).getByText('Evaluate prediction')).toBeInTheDocument() // recent-executions mode idiom
    expect(within(bar).getByText('1,420 ms')).toBeInTheDocument()
    expect(within(bar).getByText('gpt-4o-mini · jev-latest')).toBeInTheDocument()
    expect(within(bar).queryByText('No active execution')).not.toBeInTheDocument()
  })

  it('falls back to the raw mode enum for an unknown future mode (plan 15.5)', () => {
    render(
      <ExecutionContextBar
        {...baseProps}
        state={{
          kind: 'completed',
          summary: { executionId: 'run_08492abcdef12', mode: 'future-mode', durationMs: null, providers: [] },
        }}
      />
    )

    expect(screen.getByText('future-mode')).toBeInTheDocument()
  })

  it('omits the duration and providers segments entirely when absent', () => {
    render(
      <ExecutionContextBar
        {...baseProps}
        state={{ kind: 'completed', summary: { executionId: 'run_08492abcdef12', mode: 'emulator', durationMs: null, providers: [] } }}
      />
    )

    const bar = screen.getByTestId('execution-context-bar')
    expect(within(bar).queryByText('Duration')).not.toBeInTheDocument()
    expect(within(bar).queryByText('Providers')).not.toBeInTheDocument()
    expect(within(bar).queryByText('—')).not.toBeInTheDocument()
  })

  // F5 vocabulary pin (binding, ADR-012 ruling 4): the transposition must
  // leave NO pseudo-OS label anywhere in the bar, in any state.
  it('never renders banned pseudo-OS vocabulary in any state', () => {
    const { unmount } = render(
      <ExecutionContextBar
        {...baseProps}
        state={{
          kind: 'completed',
          summary: { executionId: 'run_08492abcdef12', mode: 'compare', durationMs: 1, providers: ['gpt-4o-mini'] },
        }}
      />
    )
    expect(document.body.textContent ?? '').not.toMatch(/KERNEL|SPECIMEN|RPC::|SYS_STAT|LATENCY/)

    unmount()
    render(<ExecutionContextBar {...baseProps} state={{ kind: 'idle' }} />)
    expect(document.body.textContent ?? '').not.toMatch(/KERNEL|SPECIMEN|RPC::|SYS_STAT|LATENCY/)

    unmount()
    render(<ExecutionContextBar {...baseProps} state={{ kind: 'running' }} />)
    expect(document.body.textContent ?? '').not.toMatch(/KERNEL|SPECIMEN|RPC::|SYS_STAT|LATENCY/)
  })
})

// P36/FB9: no-spaces segment values (raw mode enum fallback, provider model
// strings) must wrap — wrap-anywhere on the value spans, min-w-0 on the
// items-baseline segments — never overflow the C5 bar (§16).
describe('ExecutionContextBar — extreme segment values (P36/FB9)', () => {
  it('wraps no-spaces mode/provider values with wrap-anywhere + min-w-0 segments', () => {
    render(
      <ExecutionContextBar
        {...baseProps}
        state={{
          kind: 'completed',
          summary: {
            executionId: 'run_extreme00001',
            mode: EXTREME_LABEL,
            durationMs: 1420,
            providers: [EXTREME_LABEL],
          },
        }}
      />
    )

    const bar = screen.getByTestId('execution-context-bar')
    // (a) honest render: raw mode enum + provider string, both present.
    const values = within(bar).getAllByText(EXTREME_LABEL)
    expect(values).toHaveLength(2)
    // (b) class contract on every extreme value and its items-baseline parent.
    for (const value of values) {
      expect(value).toHaveClass('wrap-anywhere')
      expect(value.parentElement).toHaveClass('min-w-0')
    }
    // The duration value span carries the same hardening.
    expect(within(bar).getByText('1,420 ms')).toHaveClass('wrap-anywhere')
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ScenarioBox } from '../../components/shared/scenario-box'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import { SAMPLE_SYSTEM_ONE_REQUEST } from '../../lib/sample-request'

// P47: the ONE shared ScenarioBox — the §38 house disclosure idiom (button +
// aria-expanded + region, collapsed by default), label-caps SCENARIO/ESCENARIO
// trigger, pretty monospace JSON with wrap-anywhere and internal scroll. The
// three surfaces (validation panel, Principal results, Investigación header)
// render THIS component — never a second derivation.

const SAMPLE_STATE = JSON.parse(SAMPLE_SYSTEM_ONE_REQUEST).state as {
  message: string
}

describe('ScenarioBox (P47)', () => {
  it('renders collapsed by default with the label-caps trigger and no content', () => {
    render(<ScenarioBox dictionary={en.scenario} state={SAMPLE_STATE} />)

    const trigger = screen.getByRole('button', { name: /View scenario/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // The label-caps title rides the trigger beside the view action.
    expect(trigger).toHaveTextContent('SCENARIO')
    expect(trigger).toHaveTextContent('View scenario')
    // §38: collapsed by default — the content region is not in the DOM.
    expect(screen.queryByTestId('scenario-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('scenario-box')).toBeInTheDocument()
  })

  it('expands on click and shows the exact pretty-printed JSON of the state', () => {
    render(<ScenarioBox dictionary={en.scenario} state={SAMPLE_STATE} />)

    fireEvent.click(screen.getByRole('button', { name: /View scenario/ }))

    const trigger = screen.getByRole('button', { name: /View scenario/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('scenario-content').textContent).toBe(JSON.stringify(SAMPLE_STATE, null, 2))
  })

  // P49 supersedes the P47 pin (string state as quoted JSON): the enunciado
  // is natural language — prose that grows, never a horizontal scrollbar.
  // The old <pre> rendered strings as one JSON line under white-space: pre,
  // where wrap-anywhere was inoperative (precedent R59/P44: pin flips).
  it('renders a string state as prose that grows with the content', () => {
    const enunciado =
      'The customer reports being charged twice for invoice INV-42. ' +
      'The second charge landed three days after the first, for the same 249.90 amount. ' +
      'The bank confirmed both charges settled, so the customer asks for a refund of the duplicate.'
    render(<ScenarioBox dictionary={en.scenario} state={enunciado} />)

    fireEvent.click(screen.getByRole('button', { name: /View scenario/ }))

    const content = screen.getByTestId('scenario-content')
    // The RAW enunciado — no JSON quotes around natural language.
    expect(content.textContent).toBe(enunciado)
    // Prose grows with the content: soft-wrap yes, but NO monospace, NO
    // height cap, NO internal scroll (the §38 collapse is the length manager).
    expect(content.className).toContain('whitespace-pre-wrap')
    expect(content.className).toContain('wrap-anywhere')
    expect(content.className).not.toContain('font-mono')
    expect(content.className).not.toContain('max-h-[40vh]')
    expect(content.className).not.toContain('overflow-auto')
  })

  it('renders an array state as pretty JSON', () => {
    const state = ['charged twice', 'invoice INV-42']
    render(<ScenarioBox dictionary={en.scenario} state={state} />)

    fireEvent.click(screen.getByRole('button', { name: /View scenario/ }))
    expect(screen.getByTestId('scenario-content').textContent).toBe(JSON.stringify(state, null, 2))
  })

  // P49: objects/arrays keep the JSON idiom, but white-space: pre-wrap — the
  // old white-space: pre made wrap-anywhere inoperative, so this long value
  // (the mirror of the bug) overflowed into a horizontal scrollbar.
  it('renders an object state as wrapped JSON (pre-wrap kills the horizontal scroll)', () => {
    const state = {
      message:
        'The customer reports being charged twice for invoice INV-42 — the second charge landed three days after the first, for the same 249.90 amount, and the bank confirmed both charges settled while the refund of the duplicate is still pending.'
    }
    render(<ScenarioBox dictionary={en.scenario} state={state} />)

    fireEvent.click(screen.getByRole('button', { name: /View scenario/ }))

    const content = screen.getByTestId('scenario-content')
    expect(content.textContent).toBe(JSON.stringify(state, null, 2))
    // The pretty-JSON idiom stands: monospace with the height cap and
    // internal scroll — plus pre-wrap so long values finally wrap.
    expect(content.className).toContain('whitespace-pre-wrap')
    expect(content.className).toContain('wrap-anywhere')
    expect(content.className).toContain('font-mono')
    expect(content.className).toContain('max-h-[40vh]')
    expect(content.className).toContain('overflow-auto')
  })

  it('renders the Spanish dictionary labels (ESCENARIO / Ver escenario)', () => {
    render(<ScenarioBox dictionary={es.scenario} state={SAMPLE_STATE} />)

    const trigger = screen.getByRole('button', { name: /Ver escenario/ })
    expect(trigger).toHaveTextContent('ESCENARIO')
  })

  it('carries the copy action from the house idiom inside the revealed region', () => {
    render(<ScenarioBox dictionary={en.scenario} state={SAMPLE_STATE} />)

    // Collapsed: the §38-collapsed row carries NO copy affordance (the
    // page-level WHY audit pins no Copy on arrival).
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()

    // Expanded: the shared CopyButton rides the revealed content region.
    fireEvent.click(screen.getByRole('button', { name: /View scenario/ }))
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('copies the raw enunciado for a string state', async () => {
    // Evidence-view pattern: stub the clipboard so the transient Copied
    // label can land in jsdom.
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: clipboardWrite } })

    const enunciado =
      'The customer reports being charged twice for invoice INV-42. The bank confirmed both charges settled.'
    render(<ScenarioBox dictionary={en.scenario} state={enunciado} />)

    fireEvent.click(screen.getByRole('button', { name: /View scenario/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    // P49: one derivation feeds both surfaces — a string copies the RAW
    // enunciado, never JSON quotes.
    expect(clipboardWrite).toHaveBeenCalledWith(enunciado)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })
})

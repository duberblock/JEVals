import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JsonInput } from '../../components/principal/json-input'
import { en } from '../../lib/i18n/en'
import { SAMPLE_SYSTEM_ONE_REQUEST } from '../../lib/sample-request'

describe('JsonInput', () => {
  let clipboardWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: clipboardWrite } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderInput(value = '', onChange = vi.fn()) {
    render(
      <JsonInput
        value={value}
        onChange={onChange}
        dictionary={en.principal.requestJson}
        sampleJson={SAMPLE_SYSTEM_ONE_REQUEST}
      />
    )
    return { onChange }
  }

  it('renders a paste-friendly monospace textarea with spellcheck disabled', () => {
    renderInput()
    const textarea = screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement
    expect(textarea).toHaveAttribute('spellcheck', 'false')
    expect(textarea.className).toContain('font-mono')
  })

  // R3 (dual-review): 16px at ALL widths — an sm:text-sm override would drop
  // below 16px on iPhone SE/8 landscape (667px > sm=640) and re-trigger the
  // iOS focus zoom the §16 no-zoom gate exists to prevent.
  it('keeps the textarea at 16px on every breakpoint (no sm:text-sm)', () => {
    renderInput()
    const textarea = screen.getByRole('textbox', { name: 'Request JSON' })
    expect(textarea).toHaveClass('text-base')
    expect(textarea).not.toHaveClass('sm:text-sm')
  })

  it('shows Format, Sample and Copy buttons', () => {
    renderInput()
    expect(screen.getByRole('button', { name: 'Format' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sample' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('typing propagates the new text', () => {
    const { onChange } = renderInput()
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: '{"state":{}}' },
    })
    expect(onChange).toHaveBeenCalledWith('{"state":{}}')
  })

  it('Sample loads the canonical plan section 5 request', () => {
    const { onChange } = renderInput()
    fireEvent.click(screen.getByRole('button', { name: 'Sample' }))
    expect(onChange).toHaveBeenCalledWith(SAMPLE_SYSTEM_ONE_REQUEST)
  })

  it('Format pretty-prints parseable JSON', () => {
    const { onChange } = renderInput('{"state":{"message":"hi"}}')
    fireEvent.click(screen.getByRole('button', { name: 'Format' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('{\n  "state": {\n    "message": "hi"\n  }\n}')
  })

  it('Format keeps the text untouched when JSON is syntactically invalid', () => {
    const { onChange } = renderInput('{"state": ')
    fireEvent.click(screen.getByRole('button', { name: 'Format' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Copy writes the current text to the clipboard and confirms', async () => {
    renderInput('{"state":{}}')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(clipboardWrite).toHaveBeenCalledWith('{"state":{}}')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })
})

'use client'

import { useState } from 'react'

import { Button } from '../ui/button'
import type { Dictionary } from '../../lib/i18n'

// JSON input for the SystemOneRequest (plan section 19): paste-friendly
// monospace textarea plus Format / Sample / Copy. No Monaco/CodeMirror in v1.
export function JsonInput({
  value,
  onChange,
  dictionary,
  sampleJson,
}: {
  value: string
  onChange: (next: string) => void
  dictionary: Dictionary['principal']['requestJson']
  sampleJson: string
}) {
  const [copied, setCopied] = useState(false)

  function format() {
    // Pretty-print when parseable; on syntax error keep the text as typed —
    // the validation panel already surfaces the syntax state.
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2))
    } catch {
      // Keep the current text; the panel owns surfacing the error.
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (permissions): silently keep the Copy label.
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold" htmlFor="request-json">
        {dictionary.label}
      </label>
      <textarea
        aria-label={dictionary.label}
        // §16 no-zoom: 16px at ALL widths — an input focused below 16px
        // makes iOS Safari zoom the page, and iPhone SE/8 landscape (667px)
        // is already past the sm breakpoint, so no sm:text-sm override.
        className="min-h-56 w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-base leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        id="request-json"
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={value}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={format} size="lg" type="button" variant="outline">
          {dictionary.format}
        </Button>
        <Button onClick={() => onChange(sampleJson)} size="lg" type="button" variant="outline">
          {dictionary.sample}
        </Button>
        <Button onClick={copy} size="lg" type="button" variant="outline">
          {copied ? dictionary.copied : dictionary.copy}
        </Button>
      </div>
    </div>
  )
}

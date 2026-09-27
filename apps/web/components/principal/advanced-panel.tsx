'use client'

import { useState } from 'react'

import type { Dictionary } from '../../lib/i18n'

// Advanced options (plan section 11): Independent LLM prediction is not a
// fourth main mode — it composes with any execution mode. Interactive iff the
// capabilities endpoint says LLM is configured (section 63: never invent
// availability); disabled keeps the honest hint, never a silent no-op.
export function AdvancedPanel({
  dictionary,
  llmAvailable = false,
  checked,
  onChange,
}: {
  dictionary: Dictionary['advanced']
  llmAvailable?: boolean
  checked?: boolean
  onChange?: (checked: boolean) => void
}) {
  const [internal, setInternal] = useState(false)
  const current = checked ?? internal

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{dictionary.title}</p>
      <div
        className={`flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm ${
          llmAvailable ? '' : 'opacity-60'
        }`}
      >
        <input
          aria-labelledby="independent-openai-title"
          checked={current}
          disabled={!llmAvailable}
          id="independent-openai"
          onChange={() => {
            setInternal(!current)
            onChange?.(!current)
          }}
          type="checkbox"
        />
        <label className="flex-1" htmlFor="independent-openai">
          <span className="block font-medium" id="independent-openai-title">
            {dictionary.independentLlm}
          </span>
        </label>
        {!llmAvailable ? (
          <span className="text-xs text-muted-foreground">{dictionary.llmUnavailable}</span>
        ) : null}
      </div>
    </div>
  )
}

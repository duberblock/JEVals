'use client'

import { useState } from 'react'

import type { Dictionary } from '../../lib/i18n'

export type ExecutionMode = 'emulator' | 'compare' | 'compare-and-evaluate'

// Modes the Run button can post (plan section 10). All three are implemented;
// Evaluate prediction additionally requires LLM (the Judge) to be configured.
export type RunMode = ExecutionMode

// Execution mode radios with the exact copy from plan section 20. Emulator is
// always available; Compare with JEV and Evaluate prediction follow the
// capabilities endpoint (section 63: never invent availability).
export function ModeSelector({
  dictionary,
  jevAvailable = false,
  llmAvailable = false,
  value,
  onChange,
}: {
  dictionary: Dictionary['mode']
  jevAvailable?: boolean
  llmAvailable?: boolean
  value?: ExecutionMode
  onChange?: (mode: RunMode) => void
}) {
  const [internal, setInternal] = useState<RunMode>('emulator')
  const current = value ?? internal

  const modes: Array<{
    value: ExecutionMode
    labelKey: 'emulator' | 'compare' | 'evaluate'
    hintKey: 'emulatorHint' | 'compareHint' | 'evaluateHint'
    available: boolean
    unavailableHint?: string
  }> = [
    { value: 'emulator', labelKey: 'emulator', hintKey: 'emulatorHint', available: true },
    {
      value: 'compare',
      labelKey: 'compare',
      hintKey: 'compareHint',
      available: jevAvailable,
      unavailableHint: dictionary.jevUnavailable,
    },
    {
      value: 'compare-and-evaluate',
      labelKey: 'evaluate',
      hintKey: 'evaluateHint',
      // Evaluate runs Emulator + real JEV + Judge, so it needs BOTH legs
      // (plan section 10); the hint names the first missing one.
      available: llmAvailable && jevAvailable,
      unavailableHint: llmAvailable ? dictionary.jevUnavailable : dictionary.llmUnavailable,
    },
  ]

  return (
    <div aria-labelledby="execution-mode-title" className="space-y-3" role="radiogroup">
      <p className="text-sm font-semibold" id="execution-mode-title">
        {dictionary.title}
      </p>
      <div className="space-y-2">
        {modes.map((mode) => {
          const disabled = !mode.available
          const titleId = `execution-mode-${mode.value}`
          return (
            <div
              className={`flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm ${
                disabled ? 'opacity-60' : ''
              }`}
              key={mode.value}
            >
              <input
                aria-labelledby={titleId}
                checked={current === mode.value}
                disabled={disabled}
                id={`input-${titleId}`}
                name="execution-mode"
                onChange={() => {
                  setInternal(mode.value as RunMode)
                  onChange?.(mode.value as RunMode)
                }}
                type="radio"
                value={mode.value}
              />
              {/* P36/FB9: wrap-anywhere + min-w-0 — long request-derived labels must wrap, never break the box (§16). */}
              <label className="min-w-0 flex-1" htmlFor={`input-${titleId}`}>
                <span className="block wrap-anywhere font-medium" id={titleId}>
                  {dictionary[mode.labelKey]}
                </span>
                <span className="block text-xs text-muted-foreground">{dictionary[mode.hintKey]}</span>
              </label>
              {disabled && mode.unavailableHint ? (
                <span className="text-xs text-muted-foreground">{mode.unavailableHint}</span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

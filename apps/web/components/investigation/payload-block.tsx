'use client'

import { Fragment, useMemo, type ReactNode } from 'react'

import { CopyButton } from './copy-button'
import { fill } from '../../lib/i18n/format'
import type { Dictionary } from '../../lib/i18n'

// Pretty-printed monospace payload with an optional copy action (§44) and
// the §45.4 Find behavior: an active query filters the payload to the
// matching lines, highlights them and reports the match count. No deps.
export function PayloadBlock({
  actions,
  caption,
  copyLabel,
  copiedLabel,
  dictionary,
  query,
  title,
  value,
}: {
  actions?: ReactNode
  caption?: string
  copyLabel?: string
  copiedLabel: string
  dictionary: Dictionary['investigation']
  query: string
  title: string
  value: unknown
}) {
  // F2: old snapshots may lack optional fields (e.g. judge evidence's
  // system_instruction/configuration). An absent value renders the honest
  // localized placeholder — never a crash, never the string "undefined" —
  // so Copy also never copies "undefined".
  const text = useMemo(
    () => (value === undefined ? dictionary.notRecorded : payloadText(value)),
    [dictionary.notRecorded, value]
  )
  const trimmed = query.trim().toLowerCase()
  const active = trimmed.length > 0
  const matching = useMemo(
    () => (active ? text.split('\n').filter((line) => line.toLowerCase().includes(trimmed)) : []),
    [active, text, trimmed]
  )

  return (
    <div className="space-y-2" data-testid="payload-block">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-bold tracking-widest text-muted-foreground">{title}</p>
        {caption ? <span className="text-xs text-muted-foreground">{caption}</span> : null}
        {copyLabel ? <CopyButton copiedLabel={copiedLabel} label={copyLabel} size="xs" value={text} /> : null}
        {actions}
      </div>
      {active ? (
        <div className="space-y-1">
          <pre
            className="max-h-[60vh] overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed"
            data-testid="payload-matches"
          >
            {matching.length > 0
              ? matching.map((line, index) => (
                  <Fragment key={index}>
                    {index > 0 ? '\n' : null}
                    <mark
                      className="rounded bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-900 dark:text-yellow-50"
                      data-testid="find-match"
                    >
                      {line}
                    </mark>
                  </Fragment>
                ))
              : null}
          </pre>
          <p className="text-xs text-muted-foreground" data-testid="find-count">
            {matching.length === 0
              ? dictionary.find.noMatches
              : fill(matching.length === 1 ? dictionary.find.matchesOne : dictionary.find.matches, {
                  count: matching.length,
                })}
          </p>
        </div>
      ) : (
        <pre
          className="max-h-[60vh] overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed"
          data-testid="payload-raw"
        >
          {text}
        </pre>
      )}
    </div>
  )
}

// Strings (e.g. raw model responses) render verbatim; everything else
// pretty-prints as JSON. Undefined (and non-serializable values such as
// functions) degrade to the empty string — callers that need an honest
// placeholder for absent fields handle undefined before calling.
export function payloadText(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? ''
}

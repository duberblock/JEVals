'use client'

import { useId, useState } from 'react'

import { CopyButton } from '../investigation/copy-button'
import { Button } from '../ui/button'
import type { Dictionary } from '../../lib/i18n'
import type { EntryState } from '../../lib/execution-snapshot'

// P47: the ONE shared scenario box (single-source — never a second
// derivation). It renders the request's `state` (the ESCENARIO) behind the
// §38 house disclosure idiom: a button with aria-expanded plus a content
// region, COLLAPSED by default (the "View AI reasoning" precedent). The
// copy action rides the REVEALED content region (the house CopyButton the
// PayloadBlock idiom gives for free) — keeping it out of the collapsed row
// preserves the page-level §38 audit pin (no Copy on the WHY arrival)
// untouched.
// P49 amends the P47 claim that "long values wrap": under white-space: pre
// wrap-anywhere was inoperative, so a string state (one JSON line of
// thousands of chars) landed in a horizontal scrollbar and a natural-language
// enunciado read as monospace JSON behind a 40vh cap. Now strings render as
// PROSE that grows with the content (the §38 collapse is the length manager —
// no height cap, no scroll, no monospace), while objects/arrays keep the
// pretty-JSON monospace idiom with internal scroll (max-h + overflow-auto)
// plus white-space: pre-wrap so wrap-anywhere finally operates on long
// values inside them.
// state null/absent is the CALLER's absence contract: this component only
// ever mounts with a non-null state (NonNullable<EntryState>).
export function ScenarioBox({
  dictionary,
  state,
}: {
  dictionary: Dictionary['scenario']
  state: NonNullable<EntryState>
}) {
  // F9-style per-instance ids: several boxes can live in one tree (the
  // validation panel's and Principal results' on the same page).
  const triggerId = useId()
  const regionId = useId()
  const [open, setOpen] = useState(false)

  // One derivation feeds BOTH display and copy (P49): a string state IS the
  // natural-language enunciado, so it stays raw (JSON-quoting it made the
  // prose unreadable); objects/arrays pretty-print as JSON.
  const isProse = typeof state === 'string'
  const text = isProse ? state : JSON.stringify(state, null, 2)

  return (
    <div className="space-y-1" data-testid="scenario-box">
      <Button
        aria-controls={regionId}
        aria-expanded={open}
        data-testid="scenario-trigger"
        id={triggerId}
        onClick={() => setOpen((value) => !value)}
        size="xs"
        type="button"
        variant="ghost"
      >
        <span className="font-mono uppercase text-label-caps text-muted-foreground">{dictionary.title}</span>
        {dictionary.view}
      </Button>
      {open ? (
        <div aria-labelledby={triggerId} className="space-y-2" id={regionId} role="region">
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton copiedLabel={dictionary.copied} label={dictionary.copy} size="xs" value={text} />
          </div>
          {isProse ? (
            <p
              className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere"
              data-testid="scenario-content"
            >
              {text}
            </p>
          ) : (
            <pre
              className="max-h-[40vh] overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere"
              data-testid="scenario-content"
            >
              {text}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  )
}

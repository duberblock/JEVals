'use client'

import { useId, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import { Button } from '../ui/button'
import { fill } from '../../lib/i18n/format'
import type { Dictionary } from '../../lib/i18n'
import type { ValidationState } from '../../lib/validation-state'

// P46 (R61): the request-block disclosure. When a run starts or a case
// lands, Principal collapses the ENTIRE input block (editor, validation
// panel with its scenario box, provider chips, mode selector, Advanced and
// the Run/Clear row) behind the house §38 disclosure idiom — a button with
// aria-expanded plus a labelled region, NEVER a native <details> (the
// ScenarioBox "View AI reasoning" precedent, scaled to §16: the toggle is a
// primary control of the block, so it gets the h-11 touch-target idiom of
// the Run button rather than the xs scenario one).
// The always-visible summary line is honest about the editor (T2.5/W5): the
// label-caps REQUEST title, the LIVE question count (only while a valid
// verdict exists — never invented during checking/invalid/empty), the
// selected mode, the LIVE §19.1 validity word, and the B3 "edited" freshness
// marker when the editor diverged from the text that produced the current
// result/hydration. Validity and edited are TWO ORTHOGONAL signals with
// deliberately distinct treatments (text vs pill): a valid edit shows ✓ VALID
// AND "edited" at once, an invalid one shows ✗ AND "edited" — the marker
// marks the RESULT stale, never the JSON validity. The marker never carries
// result data (§61.2 spirit): everything here derives from the live editor.
export function RequestBlock({
  children,
  dictionary,
  edited,
  modeLabel,
  onToggle,
  open,
  validation,
}: {
  children: ReactNode
  dictionary: Dictionary['principal']['requestBlock']
  edited: boolean
  modeLabel: string
  onToggle: () => void
  open: boolean
  validation: ValidationState
}) {
  // F9-style per-instance ids (the ScenarioBox idiom): one trigger, one
  // region, wired through aria-controls/aria-labelledby.
  const triggerId = useId()
  const regionId = useId()

  // T2.5 honesty: the count exists ONLY while the live verdict is valid —
  // checking/invalid/empty render their own state word instead, never a
  // fabricated number.
  const questionCount = validation.kind === 'valid' ? validation.questions.length : null

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="request-block">
      {/* The one-line summary IS the toggle (§16: the full-width row is the
          comfortable touch target) — the label and the chevron reflect the
          state; the §72 reduced-motion block freezes the chevron's
          transition globally. */}
      <div data-testid="request-summary">
        <Button
          aria-controls={regionId}
          aria-expanded={open}
          className="h-11 w-full flex-wrap justify-start gap-x-3 gap-y-1 px-3 font-normal whitespace-normal"
          data-testid="request-toggle"
          id={triggerId}
          onClick={onToggle}
          type="button"
          variant="outline"
        >
          <span className="font-mono uppercase text-label-caps text-muted-foreground">{dictionary.title}</span>
          {questionCount !== null ? (
            <span className="text-muted-foreground">{fill(dictionary.questions, { count: questionCount })}</span>
          ) : null}
          <span className="text-muted-foreground">{modeLabel}</span>
          {/* Signal 1 — the LIVE §19.1 validity of the editor. */}
          {validation.kind === 'valid' ? (
            <span className="font-medium text-foreground">✓ {dictionary.validity.valid}</span>
          ) : null}
          {validation.kind === 'invalid' || validation.kind === 'syntax-error' ? (
            <span className="font-medium text-destructive">✗ {dictionary.validity.invalid}</span>
          ) : null}
          {validation.kind === 'checking' ? (
            <span className="text-muted-foreground">{dictionary.validity.checking}</span>
          ) : null}
          {validation.kind === 'empty' ? (
            <span className="text-muted-foreground">{dictionary.validity.empty}</span>
          ) : null}
          {/* Signal 2 — the B3 freshness marker: a visually distinct pill so
              it can never be read as (or merged into) the validity word. It
              survives the B3 invalidation of the result: the divergence is
              still true even though the result is gone. */}
          {edited ? (
            <span
              className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              data-testid="request-edited"
            >
              {dictionary.edited}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">{open ? dictionary.collapse : dictionary.expand}</span>
          <ChevronDown
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform${open ? ' rotate-180' : ''}`}
          />
        </Button>
      </div>
      {open ? (
        <div aria-labelledby={triggerId} className="space-y-6 pt-4" id={regionId} role="region">
          {children}
        </div>
      ) : null}
    </div>
  )
}

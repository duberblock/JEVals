import { shortExecutionId, type ExecutionSummary } from '../../lib/execution-snapshot'
import type { Dictionary, Locale } from '../../lib/i18n'

// C5 (FASE C, ADR-012 ruling 13): canonical execution-context strip under
// the page title — the prototype subheader TREATMENT (band + square dot +
// label-caps lead) with §15 vocabulary (F5 binding: no SPECIMEN / KERNEL /
// RPC:: / LATENCY pseudo-OS labels) over REAL persisted snapshot facts only.
// Honest states: idle says so in one line, running says so, and absent
// segments are omitted entirely — never '—' placeholders, never invented
// zeros. Passive region: NO aria-live, because the §72 hero slot owns
// result announcements (a second live region would re-announce unrelated
// renders).

export type ContextBarState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'completed'; summary: Pick<ExecutionSummary, 'executionId' | 'mode' | 'durationMs' | 'providers'> }

export function ExecutionContextBar({
  dictionary,
  locale,
  modeLabels,
  runningText,
  state,
  units,
}: {
  dictionary: Dictionary['principal']['contextBar']
  locale: Locale
  // Same label map (and idiom) as recent-executions: raw mode enums never
  // reach the UI; unknown future values fall back to the raw enum (plan 15.5).
  modeLabels: Dictionary['recent']['mode']
  // Reuses dictionary.run.running verbatim (identical copy in both locales —
  // no duplicated key just for this bar).
  runningText: string
  state: ContextBarState
  units: Dictionary['units']
}) {
  const labels = modeLabels as Record<string, string>

  return (
    <section
      aria-label={dictionary.ariaLabel}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 px-4 py-2"
      data-testid="execution-context-bar"
    >
      <span className="flex items-center gap-2 font-mono uppercase text-label-caps text-muted-foreground">
        <span aria-hidden="true" className="size-2 bg-primary" />
        {dictionary.label}
      </span>
      {state.kind === 'idle' ? (
        <span className="text-sm text-muted-foreground">{dictionary.noActive}</span>
      ) : null}
      {state.kind === 'running' ? (
        <span className="text-sm text-muted-foreground">{runningText}</span>
      ) : null}
      {state.kind === 'completed' ? (
        <>
          {/* P36/FB9: wrap-anywhere + min-w-0 — long request-derived labels must wrap, never break the box (§16). */}
          <span className="flex items-baseline gap-2">
            <span className="font-mono uppercase text-label-caps text-muted-foreground">{dictionary.runId}</span>
            <span className="border border-border bg-background px-1 font-mono text-sm text-primary">
              {shortExecutionId(state.summary.executionId)}
            </span>
          </span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono uppercase text-label-caps text-muted-foreground">{dictionary.mode}</span>
            <span className="wrap-anywhere text-sm">{labels[state.summary.mode] ?? state.summary.mode}</span>
          </span>
          {state.summary.durationMs !== null ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="font-mono uppercase text-label-caps text-muted-foreground">{dictionary.duration}</span>
              <span className="wrap-anywhere text-sm">
                {new Intl.NumberFormat(locale).format(state.summary.durationMs)} {units.milliseconds}
              </span>
            </span>
          ) : null}
          {state.summary.providers.length > 0 ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="font-mono uppercase text-label-caps text-muted-foreground">{dictionary.providers}</span>
              <span className="wrap-anywhere font-mono text-sm">{state.summary.providers.join(' · ')}</span>
            </span>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

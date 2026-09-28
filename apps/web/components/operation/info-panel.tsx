'use client'

import Link from 'next/link'

import { CopyButton } from '../investigation/copy-button'
import { Button } from '../ui/button'
import { summarizeSnapshot, type ExecutionSnapshot } from '../../lib/execution-snapshot'
import { downloadJson } from '../../lib/investigation/download'
import type { Dictionary, Locale } from '../../lib/i18n'

// §61 wireframe right column: identity of the execution plus the two actions.
// Copy reuses the Investigation CopyButton; "Download execution" reuses the
// Investigation blob helper to save the persisted snapshot verbatim. Both
// action targets are ~44 px tall (§72 touch targets).
export function InfoPanel({
  dictionary,
  locale,
  snapshot,
}: {
  dictionary: Dictionary['operation']
  locale: Locale
  snapshot: ExecutionSnapshot
}) {
  const copy = dictionary.info
  // The run's own model report — every section that ran contributes the
  // model the ENDPOINT reported serving (same line as Principal's context
  // bar), so the run is traceable from Operación alone.
  const models = summarizeSnapshot(snapshot).providers
  // F4/§15.5: raw mode enums render as localized labels; unknown future
  // values fall back to the raw enum so the panel never blanks out.
  const modeLabels = dictionary.mode as Record<string, string>

  return (
    <aside className="space-y-4" data-testid="operation-info">
      <section className="space-y-2">
        <p className="text-xs font-bold tracking-widest text-muted-foreground">{copy.title}</p>
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-muted-foreground">{copy.executionId}</dt>
            <dd className="font-mono text-xs">{snapshot.execution_id}</dd>
            <CopyButton copiedLabel={copy.copied} label={copy.copy} size="xs" value={snapshot.execution_id} />
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-muted-foreground">{copy.requestHash}</dt>
            <dd className="break-all font-mono text-xs">{snapshot.request_hash}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-muted-foreground">{copy.mode}</dt>
            <dd>{modeLabels[snapshot.mode] ?? snapshot.mode}</dd>
          </div>
          {models.length > 0 ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <dt className="text-muted-foreground">{copy.models}</dt>
              <dd className="font-mono text-xs wrap-anywhere" data-testid="operation-models">
                {models.join(' · ')}
              </dd>
            </div>
          ) : null}
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-muted-foreground">{copy.created}</dt>
            <dd>
              {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(snapshot.created_at)
              )}
            </dd>
          </div>
        </dl>
      </section>
      <section className="space-y-2">
        <p className="text-xs font-bold tracking-widest text-muted-foreground">{copy.actions}</p>
        <div className="flex flex-col gap-2">
          {/* §45.3 deep link: Investigación reads the same persisted evidence
              without re-running anything. */}
          <Link
            className="flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
            href={`/investigation?execution=${encodeURIComponent(snapshot.execution_id)}`}
          >
            {copy.viewInInvestigation}
          </Link>
          <Button
            className="h-11"
            onClick={() => downloadJson(`${snapshot.execution_id}.json`, snapshot)}
            type="button"
            variant="outline"
          >
            {copy.download}
          </Button>
        </div>
      </section>
    </aside>
  )
}

'use client'

import { operationalSummary } from '../../lib/operation/derive'
import type { ExecutionSnapshot } from '../../lib/execution-snapshot'
import { fill } from '../../lib/i18n/format'
import type { Dictionary, Locale } from '../../lib/i18n'

// §61.1 first-viewport summary. STATUS FIRST (§72: Operación shows status
// before telemetry) — the DOM order below is the render order and is pinned
// by tests. Semantic metrics never appear here (§70 view boundaries).
export function SummaryPanel({
  dictionary: copy,
  locale,
  snapshot,
  units,
}: {
  dictionary: Dictionary['operation']
  locale: Locale
  snapshot: ExecutionSnapshot
  units: Dictionary['units']
}) {
  const summary = operationalSummary(snapshot)
  const statusWord =
    summary.status === 'failed'
      ? copy.status.failed
      : summary.status === 'partial'
        ? copy.status.partial
        : copy.status.completed
  const formatMs = (ms: number) => `${new Intl.NumberFormat(locale).format(ms)} ${units.milliseconds}`
  const aiWord =
    summary.aiEvaluation === 'success'
      ? copy.summary.aiValue.success
      : summary.aiEvaluation === 'failed'
        ? copy.summary.aiValue.failed
        : copy.summary.aiValue.notRun

  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(8rem,auto)_1fr]" data-testid="summary-panel">
      <div className="contents" data-testid="summary-row-status">
        <dt className="text-xs font-bold tracking-widest text-muted-foreground">{copy.summary.status}</dt>
        <dd
          className={
            summary.status === 'failed'
              ? 'text-sm font-medium text-destructive'
              : summary.status === 'partial'
                // §66 partial: the rail's warning treatment; '◐' — the ✓/✗
                // markers do not fit a run that partly succeeded.
                ? 'text-sm font-medium text-warning'
                : 'text-sm font-medium text-success'
          }
        >
          {summary.status === 'completed' ? '✓ ' : summary.status === 'partial' ? '◐ ' : '✗ '}
          {statusWord}
        </dd>
      </div>
      <div className="contents" data-testid="summary-row-total-time">
        <dt className="text-xs font-bold tracking-widest text-muted-foreground">{copy.summary.totalTime}</dt>
        <dd className="text-sm font-mono">{summary.totalMs !== null ? formatMs(summary.totalMs) : '—'}</dd>
      </div>
      <div className="contents" data-testid="summary-row-questions">
        <dt className="text-xs font-bold tracking-widest text-muted-foreground">{copy.summary.questions}</dt>
        <dd className="text-sm font-mono">
          {fill(copy.summary.questionsValue, {
            processed: summary.questions.processed,
            total: summary.questions.total,
          })}
        </dd>
      </div>
      <div className="contents" data-testid="summary-row-providers">
        <dt className="text-xs font-bold tracking-widest text-muted-foreground">{copy.summary.providers}</dt>
        <dd className="text-sm font-mono">
          {fill(copy.summary.providersValue, {
            completed: summary.providers.completed,
            total: summary.providers.total,
          })}
        </dd>
      </div>
      <div className="contents" data-testid="summary-row-ai-evaluation">
        <dt className="text-xs font-bold tracking-widest text-muted-foreground">{copy.summary.aiEvaluation}</dt>
        <dd className="text-sm">{aiWord}</dd>
      </div>
      <div className="contents" data-testid="summary-row-persistence">
        <dt className="text-xs font-bold tracking-widest text-muted-foreground">{copy.summary.persistence}</dt>
        <dd className="text-sm font-medium text-success">✓ {copy.summary.ok}</dd>
      </div>
    </dl>
  )
}

'use client'

import { operationalLog } from '../../lib/operation/derive'
import type { ExecutionSnapshot } from '../../lib/execution-snapshot'
import type { Dictionary } from '../../lib/i18n'

// §61.5 logs: secondary, collapsed by default (a closed <details> element —
// pinned by tests). The lines are DERIVED from the persisted snapshot only
// (the §69 sanitized operational facts), so no secret can appear here by
// construction. Monospace, secondary styling.
export function LogPanel({
  dictionary,
  snapshot,
}: {
  dictionary: Dictionary['operation']
  snapshot: ExecutionSnapshot
}) {
  const lines = operationalLog(snapshot)
  // §15.5: raw component enums never reach the UI — the derive-level key maps
  // to the same localized label the flow and bars use ('execution' is the
  // §69 completion line's own component).
  const componentLabels = {
    ...dictionary.components,
    execution: dictionary.logs.executionComponent,
  } as Record<string, string>

  return (
    <details className="text-sm" data-testid="operation-log">
      <summary className="cursor-pointer text-xs font-bold tracking-widest text-muted-foreground">
        {dictionary.logs.openLabel}
      </summary>
      <div className="mt-2 space-y-1 rounded-lg bg-muted/40 p-3" data-testid="operation-log-body">
        {lines.map((line, index) => (
          <p className={line.level === 'error' ? 'font-mono text-xs text-destructive' : 'font-mono text-xs text-muted-foreground'} key={index}>
            {line.timestamp} {line.level} [{componentLabels[line.component] ?? line.component}] {line.event} trace={line.traceId}
            {line.mode !== undefined ? ` mode=${line.mode}` : ''}
            {line.questionCount !== undefined ? ` question_count=${line.questionCount}` : ''}
            {line.durationMs !== null ? ` duration_ms=${line.durationMs}` : ''}
            {line.comparison !== undefined ? ` comparison=${line.comparison}` : ''}
            {line.retries !== null ? ` retry=${line.retries}` : ''}
            {line.error !== null ? ` error="${line.error}"` : ''}
          </p>
        ))}
      </div>
    </details>
  )
}

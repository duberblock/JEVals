'use client'

import { flowNodes, type FlowNode } from '../../lib/operation/derive'
import type { ExecutionSnapshot } from '../../lib/execution-snapshot'
import type { Dictionary, Locale } from '../../lib/i18n'

// §61.3 execution flow: a vertical timeline in §65 order. The emulator/JEV/
// independent members run in PARALLEL — they are wrapped in a labelled group
// (border + "parallel" word, role=group) so the diagram never fakes the
// strict sequential arrows the plan forbids. Only components that ran are
// drawn; failed nodes carry a visible "!" marker (§72: never color-only);
// persistence is always drawn last as OK — the served snapshot is the proof.
function FlowNodeRow({
  dictionary,
  locale,
  node,
  units,
}: {
  dictionary: Dictionary['operation']
  locale: Locale
  node: FlowNode
  units: Dictionary['units']
}) {
  const failed = node.status === 'failed'
  return (
    <div data-status={node.status} data-testid={`flow-node-${node.key}`}>
      <span className={failed ? 'font-medium text-destructive' : 'font-medium'}>
        {failed ? '! ' : '✓ '}
        {dictionary.components[node.key]}
      </span>
      {node.durationMs !== null ? (
        <span className="ml-2 font-mono text-xs text-muted-foreground">
          {new Intl.NumberFormat(locale).format(node.durationMs)} {units.milliseconds}
        </span>
      ) : null}
    </div>
  )
}

export function FlowDiagram({
  dictionary,
  locale,
  snapshot,
  units,
}: {
  dictionary: Dictionary['operation']
  locale: Locale
  snapshot: ExecutionSnapshot
  units: Dictionary['units']
}) {
  const nodes = flowNodes(snapshot)

  // Group consecutive parallel members into stages for honest rendering.
  const stages: Array<FlowNode | FlowNode[]> = []
  for (const node of nodes) {
    const last = stages[stages.length - 1]
    if (node.parallel) {
      if (Array.isArray(last)) last.push(node)
      else stages.push([node])
    } else {
      stages.push(node)
    }
  }

  return (
    <section className="space-y-2" data-testid="flow-diagram">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.flow.title}</p>
      <ol className="space-y-1 text-sm">
        {stages.map((stage, index) => (
          <li className="space-y-1" key={index}>
            {index > 0 ? (
              <span aria-hidden="true" className="block pl-3 text-muted-foreground">
                ↓
              </span>
            ) : null}
            {Array.isArray(stage) ? (
              <div
                aria-label={dictionary.flow.parallel}
                className="space-y-1 rounded-lg border border-border bg-muted/40 p-2"
                data-testid="flow-parallel-group"
                role="group"
              >
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {dictionary.flow.parallel}
                </p>
                {stage.map((node) => (
                  <div className="pl-3" key={node.key}>
                    <FlowNodeRow dictionary={dictionary} locale={locale} node={node} units={units} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="pl-3">
                <FlowNodeRow dictionary={dictionary} locale={locale} node={stage} units={units} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

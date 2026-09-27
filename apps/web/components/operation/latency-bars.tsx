'use client'

import { latencyBars } from '../../lib/operation/derive'
import type { ExecutionSnapshot } from '../../lib/execution-snapshot'
import type { Dictionary, Locale } from '../../lib/i18n'

// §61.4 time by component: HORIZONTAL bars only. Width is ∝ ms / max(ms) and
// the label is ALWAYS the absolute milliseconds — never a percentage of the
// total, because parallel components make Σ durations ≠ total duration. Pie
// and donut charts are explicitly forbidden by the plan. Old snapshots (no
// provenance.timings) render the honest "not recorded" line instead of
// invented zeros.
export function LatencyBars({
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
  const bars = latencyBars(snapshot)
  const maxMs = bars.reduce((max, bar) => Math.max(max, bar.ms), 0)

  return (
    <section className="space-y-2" data-testid="latency-bars">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.latency.title}</p>
      {bars.length === 0 ? (
        <p className="text-sm text-muted-foreground">{dictionary.latency.notRecorded}</p>
      ) : (
        <ul className="space-y-1.5">
          {bars.map((bar) => (
            <li className="grid grid-cols-[minmax(9rem,auto)_1fr_auto] items-center gap-3 text-sm" data-testid={`latency-bar-${bar.key}`} key={bar.key}>
              <span className="truncate text-xs">{dictionary.components[bar.key]}</span>
              {/* Horizontal fill: a plain div whose width is a percentage OF
                  THE MAXIMUM, purely proportional — no total is implied. */}
              <span aria-hidden="true" className="h-2 rounded-sm bg-muted">
                <span
                  className="block h-2 rounded-sm bg-foreground/70 dark:bg-foreground/60"
                  data-testid={`latency-fill-${bar.key}`}
                  style={{ width: `${maxMs > 0 ? (bar.ms / maxMs) * 100 : 0}%` }}
                />
              </span>
              <span className="font-mono text-xs tabular-nums">
                {new Intl.NumberFormat(locale).format(bar.ms)} {units.milliseconds}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

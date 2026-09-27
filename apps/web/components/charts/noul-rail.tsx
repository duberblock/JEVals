import { formatLeadingDot } from '../../lib/compare-format'
import type { Locale } from '../../lib/i18n'

type SourceLabels = { emulator: string; jev: string; independent: string }

// Marker position on the fixed 0..1 probability track, rounded to two
// decimals so binary artifacts of the persisted numbers never leak into
// styles.
function positionPercent(value: number): string {
  return `${Number((value * 100).toFixed(2))}%`
}

// §33 noul rail (B3, ADR-013 rulings 2/5/7): the score rail's construction
// over the fixed 0..1 probability range with the labeled .5 midpoint —
// leading-dot values (§27 canonical dot family), Δ and both sources as
// visible text (B5/G9), the Independent as a smaller secondary marker only
// when it ran.
export function NoulRail({
  delta,
  emulatorNoul,
  independentNoul = null,
  jevNoul,
  labels,
  locale,
}: {
  delta: number
  emulatorNoul: number
  independentNoul?: number | null
  jevNoul: number
  labels: SourceLabels
  locale: Locale
}) {
  const tickFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const emulatorValue = formatLeadingDot(emulatorNoul, 3)
  const jevValue = formatLeadingDot(jevNoul, 3)
  const independentValue = independentNoul === null ? null : formatLeadingDot(independentNoul, 3)
  const deltaValue = formatLeadingDot(delta, 3)
  const range = `${tickFormat.format(0)}–${tickFormat.format(1)}`
  const ariaParts = [
    `${labels.emulator} ${emulatorValue}`,
    `${labels.jev} ${jevValue}`,
    `Δ ${deltaValue}`,
    range,
  ]
  if (independentValue) ariaParts.push(`${labels.independent} ${independentValue}`)

  return (
    <div
      aria-label={ariaParts.join(' · ')}
      className="w-full min-w-0 space-y-1"
      data-testid="noul-rail"
      role="img"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-source-emulator" />
        <p className="text-xs font-medium text-source-emulator">{`${labels.emulator} ${emulatorValue}`}</p>
      </div>
      <div className="relative">
        <div className="h-1.5 w-full rounded-full bg-muted" />
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-border"
          style={{ left: positionPercent(0) }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-border"
          style={{ left: '50%' }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-border"
          style={{ left: positionPercent(1) }}
        />
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-source-emulator"
          data-testid="noul-rail-emulator"
          style={{ left: positionPercent(emulatorNoul) }}
        />
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-source-jev"
          data-testid="noul-rail-jev"
          style={{ left: positionPercent(jevNoul) }}
        />
        {independentNoul !== null ? (
          <span
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-source-independent"
            data-testid="noul-rail-independent"
            style={{ left: positionPercent(independentNoul) }}
          />
        ) : null}
      </div>
      <div className="relative h-3 text-label-sm text-muted-foreground">
        <span className="absolute left-0 font-mono">{tickFormat.format(0)}</span>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono">{formatLeadingDot(0.5, 1)}</span>
        <span className="absolute right-0 font-mono">{tickFormat.format(1)}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-source-jev" />
        <p className="text-xs font-medium text-source-jev">{`${labels.jev} ${jevValue}`}</p>
        {independentValue ? (
          <>
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-source-independent" />
            <p className="text-xs text-source-independent">{`${labels.independent} · ${independentValue}`}</p>
          </>
        ) : null}
        <p className="text-label-sm text-muted-foreground">{`Δ ${deltaValue} · ${range}`}</p>
      </div>
    </div>
  )
}

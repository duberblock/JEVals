import { formatCompareScore, formatLeadingDot } from '../../lib/compare-format'
import type { Locale } from '../../lib/i18n'

type SourceLabels = { emulator: string; jev: string; independent: string }

// Marker position on the 0..max track, rounded to two decimals so binary
// artifacts of the persisted numbers never leak into the style attribute.
function positionPercent(value: number, max: number): string {
  return `${Number(((value / max) * 100).toFixed(2))}%`
}

// §33 score rail (B1, ADR-013 rulings 2/5/7): a 0..maxScore track with the
// Emulator and JEV positions, Δ and range as visible text (B5/G9 — never
// hover-only), and the Independent as a smaller secondary marker only when
// it ran. Pure presentation over persisted numbers; the Judge never appears
// here (F2: §67 has no score field — the Judge speaks as a verdict, not as
// a position on a continuum).
export function ScoreRail({
  delta,
  emulatorScore,
  independentScore = null,
  jevScore,
  labels,
  locale,
  maxScore,
}: {
  delta: number
  emulatorScore: number
  independentScore?: number | null
  jevScore: number
  labels: SourceLabels
  locale: Locale
  maxScore: number
}) {
  const tickFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const emulatorValue = formatCompareScore(emulatorScore, locale)
  const jevValue = formatCompareScore(jevScore, locale)
  const independentValue = independentScore === null ? null : formatCompareScore(independentScore, locale)
  const deltaValue = formatLeadingDot(delta, 2)
  const range = `${tickFormat.format(0)}–${tickFormat.format(maxScore)}`
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
      data-testid="score-rail"
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
          style={{ left: positionPercent(0, maxScore) }}
        />
        {maxScore >= 2 ? (
          <span
            aria-hidden="true"
            className="absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-border"
            style={{ left: '50%' }}
          />
        ) : null}
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-border"
          style={{ left: positionPercent(maxScore, maxScore) }}
        />
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-source-emulator"
          data-testid="score-rail-emulator"
          style={{ left: positionPercent(emulatorScore, maxScore) }}
        />
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-source-jev"
          data-testid="score-rail-jev"
          style={{ left: positionPercent(jevScore, maxScore) }}
        />
        {independentScore !== null ? (
          <span
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-source-independent"
            data-testid="score-rail-independent"
            style={{ left: positionPercent(independentScore, maxScore) }}
          />
        ) : null}
      </div>
      <div className="relative h-3 text-label-sm text-muted-foreground">
        <span className="absolute left-0 font-mono">{tickFormat.format(0)}</span>
        {maxScore >= 2 ? (
          <span className="absolute left-1/2 -translate-x-1/2 font-mono">
            {tickFormat.format(maxScore / 2)}
          </span>
        ) : null}
        <span className="absolute right-0 font-mono">{tickFormat.format(maxScore)}</span>
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

import type { Locale } from '../../lib/i18n'

type SourceLabels = { emulator: string; jev: string; independent: string }

// §33 choice probability bars (B2, ADR-013 rulings 3/5/7): per-option rows
// with the Emulator and JEV bars stacked (one hue per source, A7) and every
// percentage as visible text (B5/G9 — never hover-only); the Independent is
// a thinner third bar only when it ran. Pure presentation over the persisted
// probabilities — options follow the emulator answer's own key order, and a
// side without a probability for an option simply renders no bar for it.
export function ChoiceBars({
  emulatorProbabilities,
  independentProbabilities = null,
  jevProbabilities,
  labels,
  locale,
}: {
  emulatorProbabilities: Record<string, number>
  independentProbabilities?: Record<string, number> | null
  jevProbabilities: Record<string, number>
  labels: SourceLabels
  locale: Locale
}) {
  const percentFormat = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const options = Object.keys(emulatorProbabilities)
  const ariaSegments = options
    .map((option) => {
      const sides: string[] = []
      const emulator = emulatorProbabilities[option]
      const jev = jevProbabilities[option]
      const independent = independentProbabilities?.[option]
      if (typeof emulator === 'number') sides.push(`${labels.emulator} ${percentFormat.format(emulator)}`)
      if (typeof jev === 'number') sides.push(`${labels.jev} ${percentFormat.format(jev)}`)
      if (typeof independent === 'number') sides.push(`${labels.independent} ${percentFormat.format(independent)}`)
      return sides.length > 0 ? `${option}: ${sides.join(', ')}` : ''
    })
    .filter((segment) => segment !== '')

  return (
    <div
      aria-label={ariaSegments.join('; ')}
      className="w-full min-w-0 space-y-2"
      data-testid="choice-bars"
      role="img"
    >
      {options.map((option) => {
        const emulator = emulatorProbabilities[option]
        const jev = jevProbabilities[option]
        const independent = independentProbabilities?.[option]
        return (
          <div className="min-w-0 space-y-0.5" key={option}>
            {/* P36/FB9: wrap-anywhere + min-w-0 — long request-derived labels must wrap, never break the box (§16). */}
            <p className="wrap-anywhere font-mono text-xs">{option}</p>
            {typeof emulator === 'number' ? (
              <Bar
                barClassName="h-full bg-source-emulator"
                heightClassName="h-2"
                probability={emulator}
                text={percentFormat.format(emulator)}
                textClassName="text-source-emulator"
              />
            ) : null}
            {typeof jev === 'number' ? (
              <Bar
                barClassName="h-full bg-source-jev"
                heightClassName="h-2"
                probability={jev}
                text={percentFormat.format(jev)}
                textClassName="text-source-jev"
              />
            ) : null}
            {typeof independent === 'number' ? (
              <Bar
                barClassName="h-full bg-source-independent"
                heightClassName="h-1"
                probability={independent}
                text={percentFormat.format(independent)}
                textClassName="text-source-independent"
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// One source bar: a muted track at the side's height with the filled span
// (its width is the persisted probability) and the numeric % label beside it.
function Bar({
  barClassName,
  heightClassName,
  probability,
  text,
  textClassName,
}: {
  barClassName: string
  heightClassName: string
  probability: number
  text: string
  textClassName: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className={`min-w-0 flex-1 overflow-hidden rounded-sm bg-muted ${heightClassName}`}>
        <div className={barClassName} style={{ width: `${probability * 100}%` }} />
      </div>
      <span className={`shrink-0 font-mono text-xs ${textClassName}`}>{text}</span>
    </div>
  )
}

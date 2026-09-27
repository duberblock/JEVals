import type { SourceStatusStrip } from '../../lib/execution-snapshot'

// C7 (plan FASE C / G2, ADR-012 ruling 3): the four canonical sources as
// status chips under the hero conclusion — what ran, what failed, what never
// ran, at a glance. Honest absence: null renders '—' (not run), never a
// disguised failure; a failed JUDGE is visible here even when the §32 AI
// summary line itself stays silent (§66 partial). C11/P28: while the run is
// in flight a chip WITHOUT an observed state shows the neutral in-flight
// glyph, and a chip whose §65 section event already arrived shows that
// OBSERVED success/failed glyph — never an invented state — while the §72
// reduced-motion block neutralizes any animation globally.

const CHIP_ORDER = ['emulator', 'jev', 'judge', 'independent'] as const
type ChipKey = (typeof CHIP_ORDER)[number]

// A7 (ADR-012 ruling 10): one hue per source.
const DOT_CLASS: Record<ChipKey, string> = {
  emulator: 'bg-source-emulator',
  jev: 'bg-source-jev',
  judge: 'bg-source-judge',
  independent: 'bg-source-independent',
}

type ChipState = 'success' | 'failed' | 'not-run' | 'running'

function glyphFor(state: ChipState) {
  if (state === 'running') return '…'
  if (state === 'success') return '✓'
  if (state === 'failed') return '✗'
  return '—'
}

export function SourceStatusStrip({
  labels,
  running = false,
  status,
}: {
  labels: { emulator: string; jev: string; judge: string; independent: string }
  running?: boolean
  status: SourceStatusStrip
}) {
  const chips = CHIP_ORDER.map((key) => {
    // P28: an OBSERVED status wins over the in-flight glyph the moment its
    // section event arrives; null means "no data yet", which renders as the
    // neutral '…' while running and the honest '—' once the run landed.
    const state: ChipState =
      status[key] === null ? (running ? 'running' : 'not-run') : (status[key] as 'success' | 'failed')
    return { key, state, glyph: glyphFor(state) }
  })

  // Plain div + a summarizing aria-label (deliberately NOT role="status": the
  // §72 live region is the parent hero slot's contract — this must not
  // announce on its own renders).
  return (
    <div
      aria-busy={running ? 'true' : undefined}
      aria-label={chips.map((chip) => `${labels[chip.key]} ${chip.glyph}`).join(' · ')}
      className="flex flex-wrap items-center gap-x-4 gap-y-1"
      data-testid="source-strip"
    >
      {chips.map((chip) => (
        <div className="flex items-center gap-1.5" data-testid={`source-chip-${chip.key}`} key={chip.key}>
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[chip.key]}`} />
          <span className="font-mono uppercase text-label-caps text-muted-foreground">{labels[chip.key]}</span>
          <span
            aria-hidden="true"
            className={chip.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}
          >
            {chip.glyph}
          </span>
        </div>
      ))}
    </div>
  )
}

import type { Dictionary } from '../../lib/i18n'

// C8 (FASE C / G1, ADR-012 ruling 14): pre-run provider health chips above
// the mode selector — the §63 capabilities endpoint made glanceable.
// Tri-state semantics: true ✓ / false ✗ / unknown '…'. The asymmetry is the
// point: a pending or failed capabilities fetch is NOT a provider outage,
// so unknown NEVER renders ✗ (never invent availability — or
// unavailability). Mode gating in principal-view stays conservative and
// separate: unknown gates off; these chips only EXPLAIN it. Provider names
// are §63 proper nouns (identical in both locales, hardcoded here), NOT the
// A7 four-source run tokens — health semantics use
// success/destructive/muted-foreground.

const PROVIDERS = [
  { key: 'emulator', name: 'Emulator' },
  { key: 'jev', name: 'JEV' },
  { key: 'openai', name: 'LLM' },
] as const

export type ProviderHealthKey = (typeof PROVIDERS)[number]['key']
export type ProviderHealthStates = { [K in ProviderHealthKey]: boolean | null }

function glyphFor(state: boolean | null) {
  return state === true ? '✓' : state === false ? '✗' : '…'
}

function glyphClass(state: boolean | null) {
  return state === true ? 'text-success' : state === false ? 'text-destructive' : 'text-muted-foreground'
}

function stateWord(state: boolean | null, dictionary: Dictionary['principal']['providerHealth']) {
  return state === true ? dictionary.available : state === false ? dictionary.unavailable : dictionary.unknown
}

export function ProviderHealthChips({
  dictionary,
  states,
}: {
  dictionary: Dictionary['principal']['providerHealth']
  states: ProviderHealthStates
}) {
  // §72 no color-only meaning: one aria-label carries name + state word for
  // every chip (the glyphs themselves stay aria-hidden).
  const ariaLabel = PROVIDERS.map(({ key, name }) => `${name} ${stateWord(states[key], dictionary)}`).join(' · ')

  return (
    // R37 round 2 (judge finding): role="group" makes the aria-label LAWFUL
    // on this container — aria-label on a generic div is dropped by screen
    // readers, which would leave the state words (available/unavailable/
    // unknown) unreachable (the glyphs themselves are aria-hidden).
    <div
      aria-label={ariaLabel}
      className="flex flex-wrap items-center gap-x-4 gap-y-1"
      data-testid="provider-health-chips"
      role="group"
    >
      <span className="font-mono uppercase text-label-caps text-muted-foreground">{dictionary.label}</span>
      {PROVIDERS.map(({ key, name }) => (
        <span className="rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium" key={key}>
          {name}
          <span aria-hidden="true" className={`ml-1 ${glyphClass(states[key])}`}>
            {glyphFor(states[key])}
          </span>
        </span>
      ))}
    </div>
  )
}

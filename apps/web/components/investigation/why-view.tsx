'use client'

import { useEffect, useRef, useState } from 'react'

import { ChoiceBars } from '../charts/choice-bars'
import { JudgeBadge } from '../charts/judge-badge'
import { NoulRail } from '../charts/noul-rail'
import { ScoreRail } from '../charts/score-rail'

import { BottomDrawer } from '../principal/bottom-drawer'
import { Button } from '../ui/button'
import { formatCompareScore, formatLeadingDot } from '../../lib/compare-format'
import type {
  EmulatorAnswer,
  ExecutionSnapshot,
  NoulComponents,
  QuestionComparison,
  ScoreComponents,
} from '../../lib/execution-snapshot'
import { fill } from '../../lib/i18n/format'
import type { Dictionary, Locale } from '../../lib/i18n'

type Primitive = 'choice' | 'score' | 'noul'

// WHY THIS RESULT? (plan sections 37-42) — the default Investigación view:
// explanation first, exact evidence one tap away (§34/§45.7). Desktop uses
// two summary columns (§45.6); mobile stacks them (§45.5).
export function WhyView({
  dictionary,
  focusAi,
  locale,
  onViewEvidence,
  questionName,
  snapshot,
}: {
  dictionary: Dictionary['investigation']
  focusAi: boolean
  locale: Locale
  onViewEvidence: () => void
  questionName: string
  snapshot: ExecutionSnapshot
}) {
  const requestQuestion = snapshot.request?.questions?.[questionName]
  const emulatorAnswer = snapshot.emulator?.result?.answers?.[questionName]
  const jevAnswer = snapshot.jev?.result?.answers?.[questionName]
  const comparison = snapshot.comparison?.questions?.[questionName]
  // §33/ADR-013 ruling 5: the charts carry the Independent as a secondary
  // marker only when it actually ran and succeeded (§68/§41) — a failed or
  // absent section never draws one.
  const independentAnswer =
    snapshot.independent_openai?.status === 'success'
      ? snapshot.independent_openai.result?.answers?.[questionName]
      : undefined
  const primitive: Primitive | null = requestQuestion?.type === 'choice' ||
    requestQuestion?.type === 'score' ||
    requestQuestion?.type === 'noul'
    ? requestQuestion.type
    : (emulatorAnswer?.type as Primitive | undefined) ?? (jevAnswer?.type as Primitive | undefined) ?? null

  return (
    <section className="space-y-4" data-testid="why-view">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.whyTitle}</p>

      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0" data-testid="why-columns">
        {/* LEFT (§45.6): what differed and the deterministic WHY (§39). */}
        <div className="space-y-4">
          <ValuesBlock
            comparison={comparison}
            dictionary={dictionary}
            emulatorAnswer={emulatorAnswer}
            jevAnswer={jevAnswer}
            jevFailed={snapshot.jev?.status === 'failed'}
            jevPresent={snapshot.jev !== undefined}
            locale={locale}
            primitive={primitive}
            requestCriteria={requestQuestion?.criteria}
          />
          <WhyRailBlock
            comparison={comparison}
            dictionary={dictionary}
            emulatorAnswer={emulatorAnswer}
            independentAnswer={independentAnswer}
            jevAnswer={jevAnswer}
            locale={locale}
            primitive={primitive}
          />
          <WhyExplanation
            comparison={comparison}
            dictionary={dictionary}
            emulatorAnswer={emulatorAnswer}
            primitive={primitive}
          />
          <WhyProbabilitiesBlock
            dictionary={dictionary}
            emulatorAnswer={emulatorAnswer}
            independentAnswer={independentAnswer}
            jevAnswer={jevAnswer}
            locale={locale}
            primitive={primitive}
          />
          <CriteriaDisclosure
            comparison={comparison}
            dictionary={dictionary}
            emulatorAnswer={emulatorAnswer}
            jevAnswer={jevAnswer}
            key={questionName}
            primitive={primitive}
            requestCriteria={requestQuestion?.criteria}
          />
        </div>

        {/* RIGHT (§45.6): both summaries — AI Evaluation (§42) above the
            secondary Independent check (§41). No telemetry filling. The AI
            block is keyed per question so its expansion state resets when the
            focused question changes (F9). */}
        <div className="space-y-4">
          <AiBlock
            dictionary={dictionary}
            focusAi={focusAi}
            key={questionName}
            questionName={questionName}
            snapshot={snapshot}
          />
          <IndependentBlock
            dictionary={dictionary}
            locale={locale}
            questionName={questionName}
            requestCriteria={requestQuestion?.criteria}
            snapshot={snapshot}
          />
        </div>
      </div>

      <Button className="h-11 w-full px-6 text-base sm:w-auto" onClick={onViewEvidence} type="button">
        {dictionary.viewEvidence}
      </Button>
    </section>
  )
}

// §37/§39 value block: two columns (Emulator | JEV) with Δ and verdict on
// compare runs; the single honest Emulator value otherwise — no JEV column,
// Δ or verdict is ever invented (§37/§38). Without a JEV side the note is
// honest about WHY: emulator-only runs say so; a JEV that ran and failed
// (§66) says the comparison is unavailable — never "emulator-only" (F5).
// P37/FB10: an HONEST emulator-only run (no JEV section at all) marks the
// Emulator value as THE answer — explicit label with foreground emphasis —
// and the no-JEV note degrades to secondary context, never a lack headline.
// Any run with a JEV section — failed (§66) or succeeded without answering
// this question (F2 dual-review) — keeps the muted side label: a broken or
// partial comparison is not a marked result.
function ValuesBlock({
  comparison,
  dictionary,
  emulatorAnswer,
  jevAnswer,
  jevFailed,
  jevPresent,
  locale,
  primitive,
  requestCriteria,
}: {
  comparison?: QuestionComparison
  dictionary: Dictionary['investigation']
  emulatorAnswer?: EmulatorAnswer
  jevAnswer?: EmulatorAnswer
  jevFailed: boolean
  jevPresent: boolean
  locale: Locale
  primitive: Primitive | null
  requestCriteria?: unknown
}) {
  if (!emulatorAnswer) return null
  const compare = jevAnswer !== undefined && primitive !== null
  // P37/FB10: solo = an honest emulator-only run — NO JEV section at all
  // (section-based like jevFailed; for API snapshots this is equivalent to
  // Evidence's `mode === 'emulator'` gate by construction).
  const solo = !compare && !jevFailed && !jevPresent

  const value = (answer: EmulatorAnswer): string => {
    if (answer.type === 'choice') return answer.choice
    if (answer.type === 'score') return formatCompareScore(answer.score, locale)
    return formatLeadingDot(answer.noul, 3)
  }
  const label = (base: string) => (primitive === 'noul' ? `${base} ${dictionary.probabilityLabel}` : base)

  const delta = compare ? deltaText(comparison) : null
  const verdict = compare
    ? verdictText(comparison, dictionary, primitive, requestCriteria, emulatorAnswer, jevAnswer)
    : null

  return (
    <div className="space-y-3 rounded-lg border border-border p-4" data-testid="why-values">
      {/* P36/FB9: wrap-anywhere + min-w-0 — long request-derived labels must wrap, never break the box (§16). */}
      <div className={compare ? 'grid grid-cols-2 gap-4' : ''}>
        <div className="min-w-0 space-y-1">
          {solo ? (
            <p
              className="text-xs font-bold tracking-widest text-foreground"
              data-testid="why-answer-label"
            >
              {label(dictionary.emulatorAnswerLabel)}
            </p>
          ) : (
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">{label(dictionary.emulatorLabel)}</p>
          )}
          <p className="text-2xl font-bold wrap-anywhere tracking-tight">{value(emulatorAnswer)}</p>
        </div>
        {compare && jevAnswer ? (
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">{label(dictionary.jevLabel)}</p>
            <p className="text-2xl font-bold wrap-anywhere tracking-tight">{value(jevAnswer)}</p>
          </div>
        ) : null}
      </div>
      {delta ? <p className="text-sm font-medium wrap-anywhere text-muted-foreground">{delta}</p> : null}
      {verdict ? (
        <p
          className={`text-sm font-bold wrap-anywhere ${
            verdict.startsWith('✓')
              ? 'text-success'
              : 'text-warning'
          }`}
          data-testid="why-verdict"
        >
          {verdict}
        </p>
      ) : null}
      {!compare ? (
        <p className={solo ? 'text-xs text-muted-foreground' : 'text-sm text-muted-foreground'}>
          {jevFailed ? dictionary.jevFailedNote : dictionary.emulatorOnlyNote}
        </p>
      ) : null}
    </div>
  )
}

function deltaText(comparison: QuestionComparison | undefined): string | null {
  const components = comparison?.components
  if (!components) return null
  if ('score_delta' in components) {
    return `Δ ${formatLeadingDot((components as ScoreComponents).score_delta, 2)}`
  }
  if ('probability_delta' in components) {
    return `Δ ${formatLeadingDot((components as NoulComponents).probability_delta, 3)}`
  }
  return null
}

// §39 verdict line: SAME/DIFFERENT DECISION (choice), SAME LEVEL: <level> /
// DIFFERENT LEVEL (score) and the §27 Noul COMPOSED verdict — geometry plus
// the result direction from the API-persisted midpoint categories (P38/FB11),
// with the legacy geometry-only phrases only for pre-P38 snapshots.
function verdictText(
  comparison: QuestionComparison | undefined,
  dictionary: Dictionary['investigation'],
  primitive: Primitive | null,
  requestCriteria: unknown,
  emulatorAnswer: EmulatorAnswer,
  jevAnswer: EmulatorAnswer
): string | null {
  if (primitive === 'noul' && emulatorAnswer.type === 'noul' && jevAnswer.type === 'noul') {
    return noulCompositeVerdict(comparison, emulatorAnswer.noul, jevAnswer.noul, dictionary)
  }
  if (!comparison) return null
  if (primitive === 'choice') {
    return comparison.aligned ? dictionary.sameDecision : dictionary.differentDecision
  }
  if (primitive === 'score') {
    if (comparison.aligned) {
      const components = comparison.components as ScoreComponents
      return fill(dictionary.sameLevel, {
        level: dominantLevelDisplay(components.emulator_dominant_level, requestCriteria, emulatorAnswer),
      })
    }
    return dictionary.differentLevel
  }
  return null
}

// P38/FB11: the persisted §26/§27 midpoint categories of a noul comparison —
// computed by the API's single-sourced noul_midpoint_category and carried in
// the components. Null when the comparison or its noul components are absent
// or when a pre-P38 snapshot carries no categories (legacy path).
function noulMidpointCategories(
  comparison: QuestionComparison | undefined
): { emulator: number; jev: number } | null {
  const components = comparison?.components
  if (!components || !('probability_delta' in components)) return null
  const noul = components as NoulComponents
  if (noul.emulator_midpoint_category === undefined || noul.jev_midpoint_category === undefined) {
    return null
  }
  return { emulator: noul.emulator_midpoint_category, jev: noul.jev_midpoint_category }
}

// P38/FB11: the §27 Noul verdict is COMPOSED — geometry plus the RESULT
// direction, both derived from the API-persisted midpoint categories, with
// the ✓/! marker derived from the persisted comparison.aligned (never from
// the sign of the categories client-side — the letter of the ruling). 0.5 is
// ONLY the mathematical midpoint (§27): a probability AT .5 renders
// "midpoint: direction undefined", never an invented side.
//
// LEGACY FALLBACK: pre-P38 snapshots (or a question without a comparison)
// carry no categories — the geometry-only noulSideVerdict path renders then,
// including its honest null when a probability sits exactly at .5, so old
// persisted snapshots keep rendering exactly their pre-P38 verdict.
function noulCompositeVerdict(
  comparison: QuestionComparison | undefined,
  emulator: number,
  jev: number,
  dictionary: Dictionary['investigation']
): string | null {
  const categories = noulMidpointCategories(comparison)
  if (!comparison || !categories) {
    return noulSideVerdict(emulator, jev, dictionary)
  }
  const geometry = noulGeometryText(categories.emulator, categories.jev, dictionary)
  const direction = noulDirectionText(categories.emulator, categories.jev, dictionary)
  return `${comparison.aligned ? '✓' : '!'} ${geometry} — ${direction}`
}

// §27 geometry phrase (marker-less — the marker comes from aligned): which of
// the three midpoint categories each probability sits in. The vocabulary
// extension is registered §30/§39; the phrases never name a side for a
// probability AT .5 because it is the midpoint itself.
function noulGeometryText(
  emulator: number,
  jev: number,
  dictionary: Dictionary['investigation']
): string {
  if (emulator === -1 && jev === -1) return dictionary.noulGeometryBothBelow
  if (emulator === 1 && jev === 1) return dictionary.noulGeometryBothAbove
  if ((emulator === -1 && jev === 1) || (emulator === 1 && jev === -1)) return dictionary.noulGeometryCrossed
  if (emulator === 0 && jev === 0) return dictionary.noulGeometryBothAt
  if ((emulator === 0 && jev === -1) || (emulator === -1 && jev === 0)) return dictionary.noulGeometryAtAndBelow
  return dictionary.noulGeometryAtAndAbove
}

// The RESULT direction of the §27 geometry: same category — same direction;
// strictly opposite categories — opposite directions; any probability AT the
// midpoint — direction undefined (0.5 is on NEITHER side, §27).
function noulDirectionText(
  emulator: number,
  jev: number,
  dictionary: Dictionary['investigation']
): string {
  if (emulator === 0 || jev === 0) return dictionary.noulDirectionMidpointUndefined
  return emulator === jev ? dictionary.noulDirectionSame : dictionary.noulDirectionOpposite
}

// §27 side summary (LEGACY path, pre-P38 snapshots): 0.5 is the mathematical
// midpoint, so the phrases only apply when both probabilities are strictly on
// the same side — or strictly on opposite sides. A probability AT .5 has no
// canonical phrase in this vocabulary (§27) and renders no verdict (never
// invent). Snapshots that DO carry the persisted midpoint categories compose
// the P38 verdict instead and do name the midpoint honestly.
function noulSideVerdict(
  emulator: number,
  jev: number,
  dictionary: Dictionary['investigation']
): string | null {
  const below = (value: number) => value < 0.5
  const above = (value: number) => value > 0.5
  if (below(emulator) && below(jev)) return dictionary.bothBelow
  if (above(emulator) && above(jev)) return dictionary.bothAbove
  if ((below(emulator) && above(jev)) || (above(emulator) && below(jev))) return dictionary.crossed
  return null
}

// §39 deterministic WHY text — templated by the app, NEVER the AI's words.
function WhyExplanation({
  comparison,
  dictionary,
  emulatorAnswer,
  primitive,
}: {
  comparison?: QuestionComparison
  dictionary: Dictionary['investigation']
  emulatorAnswer?: EmulatorAnswer
  primitive: Primitive | null
}) {
  if (!comparison || !primitive) return null
  const aligned = comparison.aligned
  let text: string
  if (primitive === 'choice') {
    const choice = emulatorAnswer?.type === 'choice' ? emulatorAnswer.choice : ''
    text = aligned
      ? fill(dictionary.whyChoiceAligned, { value: choice })
      : dictionary.whyChoiceDiverged
  } else if (primitive === 'score') {
    text = aligned ? dictionary.whyScoreAligned : dictionary.whyScoreDiverged
  } else {
    // P38/FB11: with the persisted midpoint categories the explanation names
    // the RESULT — same direction, opposite directions, or the honest
    // midpoint (direction undefined). It NEVER says "same side" when a
    // probability is AT .5 (0.5 is the midpoint itself, §27). Pre-P38
    // snapshots without categories keep the legacy aligned-keyed templates.
    const categories = noulMidpointCategories(comparison)
    if (!categories) {
      text = aligned ? dictionary.whyNoulAligned : dictionary.whyNoulDiverged
    } else if (categories.emulator === 0 || categories.jev === 0) {
      text = dictionary.whyNoulMidpointUndefined
    } else if (categories.emulator === categories.jev) {
      text = dictionary.whyNoulSameDirection
    } else {
      text = dictionary.whyNoulOppositeDirections
    }
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.whyHeading}</p>
      <p className="text-sm" data-testid="why-explanation">
        {text}
      </p>
    </div>
  )
}

// §33/ADR-013 ruling 2: the WHY chart block under the §39 values — ScoreRail
// (B1) for score questions, NoulRail (B3) for noul, compact on both
// viewports with Δ and the canonical source labels visible (B5/G9). The
// scoped §38 override covers exactly this block: it renders only when BOTH
// sides answered AND the comparison components carry the fields it draws —
// no max_score, no rail (honest absence, nothing derived client-side).
function WhyRailBlock({
  comparison,
  dictionary,
  emulatorAnswer,
  independentAnswer,
  jevAnswer,
  locale,
  primitive,
}: {
  comparison?: QuestionComparison
  dictionary: Dictionary['investigation']
  emulatorAnswer?: EmulatorAnswer
  independentAnswer?: EmulatorAnswer
  jevAnswer?: EmulatorAnswer
  locale: Locale
  primitive: Primitive | null
}) {
  if (!emulatorAnswer || !jevAnswer) return null
  const labels = {
    emulator: dictionary.emulatorLabel,
    jev: dictionary.jevLabel,
    independent: dictionary.independentShort,
  }
  const components = comparison?.components
  const scoreComponents = components && 'score_delta' in components ? components : null
  const noulComponents = components && 'probability_delta' in components ? components : null

  if (primitive === 'score' && emulatorAnswer.type === 'score' && jevAnswer.type === 'score') {
    if (!scoreComponents || typeof scoreComponents.max_score !== 'number' || scoreComponents.max_score <= 0) {
      return null
    }
    return (
      <div data-testid="why-rail">
        <ScoreRail
          delta={scoreComponents.score_delta}
          emulatorScore={emulatorAnswer.score}
          independentScore={
            independentAnswer && independentAnswer.type === 'score' ? independentAnswer.score : null
          }
          jevScore={jevAnswer.score}
          labels={labels}
          locale={locale}
          maxScore={scoreComponents.max_score}
        />
      </div>
    )
  }

  if (primitive === 'noul' && emulatorAnswer.type === 'noul' && jevAnswer.type === 'noul') {
    if (!noulComponents || typeof noulComponents.probability_delta !== 'number') return null
    return (
      <div data-testid="why-rail">
        <NoulRail
          delta={noulComponents.probability_delta}
          emulatorNoul={emulatorAnswer.noul}
          independentNoul={
            independentAnswer && independentAnswer.type === 'noul' ? independentAnswer.noul : null
          }
          jevNoul={jevAnswer.noul}
          labels={labels}
          locale={locale}
        />
      </div>
    )
  }

  return null
}

// §33/ADR-013 ruling 3: the choice probability bars (B2) live behind a
// §40-style disclosure AFTER the deterministic WHY — §38's letter holds
// (never open by default); one tap reveals the Emulator/JEV distributions
// plus the Independent's when it ran.
function WhyProbabilitiesBlock({
  dictionary,
  emulatorAnswer,
  independentAnswer,
  jevAnswer,
  locale,
  primitive,
}: {
  dictionary: Dictionary['investigation']
  emulatorAnswer?: EmulatorAnswer
  independentAnswer?: EmulatorAnswer
  jevAnswer?: EmulatorAnswer
  locale: Locale
  primitive: Primitive | null
}) {
  const [open, setOpen] = useState(false)

  if (
    !emulatorAnswer ||
    !jevAnswer ||
    primitive !== 'choice' ||
    emulatorAnswer.type !== 'choice' ||
    jevAnswer.type !== 'choice'
  ) {
    return null
  }

  return (
    <div className="space-y-1" data-testid="why-probabilities">
      <Button
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        size="xs"
        type="button"
        variant="ghost"
      >
        {dictionary.viewProbabilities}
      </Button>
      {open ? (
        <ChoiceBars
          emulatorProbabilities={emulatorAnswer.probabilities}
          independentProbabilities={
            independentAnswer && independentAnswer.type === 'choice' ? independentAnswer.probabilities : null
          }
          jevProbabilities={jevAnswer.probabilities}
          labels={{
            emulator: dictionary.emulatorLabel,
            jev: dictionary.jevLabel,
            independent: dictionary.independentShort,
          }}
          locale={locale}
        />
      ) : null}
    </div>
  )
}

// Dominant rubric level display: the REQUEST criteria array is the canonical
// rubric source (indexed by int(level)); the answer legend is the fallback;
// the raw level key is the last resort.
function dominantLevelDisplay(level: string, requestCriteria: unknown, answer?: EmulatorAnswer): string {
  if (Array.isArray(requestCriteria)) {
    const index = Number.parseInt(level, 10)
    if (Number.isInteger(index) && index >= 0 && index < requestCriteria.length) {
      const text = requestCriteria[index]
      if (typeof text === 'string' && text.trim() !== '') return text
    }
  }
  if (answer?.type === 'score') {
    const legendText = answer.legend[level]
    if (typeof legendText === 'string' && legendText.trim() !== '') return legendText
  }
  return level
}

// §40 rubric/criteria compact disclosure: labels from the request criteria,
// Selected from the delivered dominant/selected values. The full detail opens
// on demand — Bottom Drawer on mobile, inline disclosure on desktop.
function CriteriaDisclosure({
  comparison,
  dictionary,
  emulatorAnswer,
  jevAnswer,
  primitive,
  requestCriteria,
}: {
  comparison?: QuestionComparison
  dictionary: Dictionary['investigation']
  emulatorAnswer?: EmulatorAnswer
  jevAnswer?: EmulatorAnswer
  primitive: Primitive | null
  requestCriteria?: unknown
}) {
  const [open, setOpen] = useState(false)

  if (primitive === 'choice' && requestCriteria && typeof requestCriteria === 'object' && !Array.isArray(requestCriteria)) {
    const entries = Object.entries(requestCriteria as Record<string, unknown>)
    if (entries.length === 0) return null
    const emulatorChoice = emulatorAnswer?.type === 'choice' ? emulatorAnswer.choice : null
    const jevChoice = jevAnswer?.type === 'choice' ? jevAnswer.choice : null
    const selected =
      emulatorChoice && jevChoice && emulatorChoice !== jevChoice
        ? `${emulatorChoice} → ${jevChoice}`
        : emulatorChoice
    return (
      <DisclosureShell
        compact={fill(dictionary.criteriaLabel, { criteria: entries.map(([key]) => key).join(' · ') })}
        detailEntries={entries.map(([key, detail]) => `${key} — ${descriptionText(detail)}`)}
        detailTestId="criteria-detail"
        dictionary={dictionary}
        open={open}
        selected={selected ? fill(dictionary.criteriaSelected, { selected }) : null}
        onToggle={() => setOpen((value) => !value)}
        viewLabel={dictionary.viewCriteria}
      />
    )
  }

  if (primitive === 'score' && Array.isArray(requestCriteria)) {
    const components = comparison?.components
    const emulatorLevel =
      components && 'emulator_dominant_level' in components
        ? dominantLevelDisplay((components as ScoreComponents).emulator_dominant_level, requestCriteria, emulatorAnswer)
        : null
    const jevLevel =
      components && 'jev_dominant_level' in components
        ? dominantLevelDisplay((components as ScoreComponents).jev_dominant_level, requestCriteria, jevAnswer)
        : null
    const selected =
      emulatorLevel && jevLevel && emulatorLevel !== jevLevel ? `${emulatorLevel} → ${jevLevel}` : emulatorLevel
    return (
      <DisclosureShell
        compact={fill(dictionary.rubricLabel, { levels: requestCriteria.map((item) => descriptionText(item)).join(' · ') })}
        detailEntries={requestCriteria.map((item, index) => `${index} — ${descriptionText(item)}`)}
        detailTestId="rubric-detail"
        dictionary={dictionary}
        open={open}
        selected={selected ? fill(dictionary.rubricSelected, { selected }) : null}
        onToggle={() => setOpen((value) => !value)}
        viewLabel={dictionary.viewRubric}
      />
    )
  }

  return null
}

function descriptionText(detail: unknown): string {
  if (typeof detail === 'string') return detail
  return JSON.stringify(detail)
}

function DisclosureShell({
  compact,
  detailEntries,
  detailTestId,
  dictionary,
  open,
  selected,
  onToggle,
  viewLabel,
}: {
  compact: string
  detailEntries: string[]
  detailTestId: string
  dictionary: Dictionary['investigation']
  open: boolean
  selected: string | null
  onToggle: () => void
  viewLabel: string
}) {
  const detail = (
    <ul className="space-y-1 py-1 text-sm text-muted-foreground">
      {detailEntries.map((entry) => (
        // P36/FB9: criteria labels are request-derived no-spaces tokens.
        <li className="wrap-anywhere" key={entry}>
          {entry}
        </li>
      ))}
    </ul>
  )
  return (
    <div className="space-y-1 text-sm" data-testid="rubric-disclosure">
      {/* P36/FB9 (gate finding): the compact/selected strings join the
          request's criteria labels — no-spaces tokens that must wrap. */}
      <p className="font-medium wrap-anywhere">{compact}</p>
      {selected ? <p className="text-muted-foreground wrap-anywhere">{selected}</p> : null}
      <div className="hidden lg:block">
        <Button
          aria-expanded={open}
          data-testid={`${detailTestId}-desktop`}
          onClick={onToggle}
          size="xs"
          type="button"
          variant="ghost"
        >
          {viewLabel}
        </Button>
        {open ? detail : null}
      </div>
      <div className="lg:hidden">
        <BottomDrawer closeLabel={dictionary.close} label={viewLabel} title={compact}>
          {detail}
        </BottomDrawer>
      </div>
    </div>
  )
}

// §42 AI EVALUATION: question headline (`<divergence> · <preferred>`) plus
// the focused question's own §67 reason excerpt (P35/FB8, line-clamp-2) or —
// without a §67 entry — the overall summary line; the full structured §67
// output stays behind `View AI reasoning` (§38 forbids it by default). §45.7
// question 4: runs without an AI evaluation (emulator/compare modes) render
// an explicit honest "not run (mode)" line — absence never implies failure.
function AiBlock({
  dictionary,
  focusAi,
  questionName,
  snapshot,
}: {
  dictionary: Dictionary['investigation']
  focusAi: boolean
  questionName: string
  snapshot: ExecutionSnapshot
}) {
  // §45.3 focus=ai: the deep link arrives expanded.
  const [expanded, setExpanded] = useState(focusAi)
  const aiRef = useRef<HTMLDivElement>(null)
  const evaluation = snapshot.ai_evaluation
  const modeLabels = dictionary.modeLabels as Record<string, string>

  // F8: the focus=ai deep link scrolls the AI block into view — and only
  // then (a plain WHY arrival never scrolls). jsdom ships no scrollIntoView;
  // the typeof guard keeps tests and exotic environments crash-free.
  useEffect(() => {
    if (!focusAi) return
    const element = aiRef.current
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' })
    }
  }, [focusAi])

  if (!evaluation) {
    return (
      <div className="space-y-1 rounded-lg border border-border p-4" data-testid="why-ai" ref={aiRef}>
        <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.aiTitle}</p>
        <p className="text-sm text-muted-foreground">
          {fill(dictionary.aiNotRun, { mode: modeLabels[snapshot.mode] ?? snapshot.mode })}
        </p>
      </div>
    )
  }

  const divergenceWords = dictionary.aiDivergence as Record<string, string>
  const preferredWords = dictionary.aiPreferredWord as Record<string, string>

  if (evaluation.status !== 'success') {
    return (
      <div className="space-y-1 rounded-lg border border-border p-4" data-testid="why-ai" ref={aiRef}>
        <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.aiTitle}</p>
        <p className="text-sm text-muted-foreground">{dictionary.aiUnavailable}</p>
        {evaluation.error ? <p className="text-xs text-muted-foreground">{evaluation.error}</p> : null}
      </div>
    )
  }

  const questionEntry = evaluation.questions?.[questionName]
  const overall = evaluation.overall
  const divergence = questionEntry
    ? divergenceWords[questionEntry.semantic_divergence] ?? questionEntry.semantic_divergence
    : overall
      ? divergenceWords[overall.semantic_divergence] ?? overall.semantic_divergence
      : null
  // The §67 preferred word exists only on per-question verdicts — the
  // overall fallback carries none, and the badge then shows the divergence
  // alone (never an invented preference).
  const preferred = questionEntry ? preferredWords[questionEntry.preferred] ?? questionEntry.preferred : null
  // P35/FB8: the focused question's OWN contextualization — the §67 reason
  // excerpt (line-clamp-2, §42 amendment by owner ruling) replaces the global
  // overall summary when the entry exists. The full reason stays collapsed
  // behind View AI reasoning (§38: an excerpt is not the full rationale; the
  // clamp is the boundary). Without an entry the honest fallback is the
  // overall summary, exactly as before.
  const excerpt =
    questionEntry && questionEntry.reason.trim() !== '' ? questionEntry.reason : null

  return (
    <div className="space-y-2 rounded-lg border border-border p-4" data-testid="why-ai" ref={aiRef}>
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.aiTitle}</p>
      {divergence ? <JudgeBadge divergence={divergence} preferred={preferred ?? ''} /> : null}
      {excerpt ? (
        <p className="text-sm text-muted-foreground line-clamp-2" data-testid="ai-question-excerpt">
          {excerpt}
        </p>
      ) : overall?.summary ? (
        <p className="text-sm text-muted-foreground">{overall.summary}</p>
      ) : null}
      <Button
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        size="sm"
        type="button"
        variant="outline"
      >
        {dictionary.viewAiReasoning}
      </Button>
      {expanded ? (
        <div className="space-y-3 rounded-lg bg-muted/40 p-3" data-testid="ai-reasoning">
          {overall ? (
            <div className="space-y-1">
              <p className="text-xs font-bold">{dictionary.aiOverallLabel}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted-foreground">{dictionary.aiPredictionQuality}</dt>
                <dd>{overall.prediction_quality}</dd>
                <dt className="text-muted-foreground">{dictionary.aiSemanticDivergence}</dt>
                <dd>{overall.semantic_divergence}</dd>
              </dl>
            </div>
          ) : null}
          {Object.entries(evaluation.questions ?? {}).map(([name, entry]) => (
            <div className="min-w-0 space-y-1" key={name}>
              <p className="wrap-anywhere font-mono text-xs font-bold">{name}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted-foreground">{dictionary.aiEmulatorSupport}</dt>
                <dd>{entry.emulator_support}</dd>
                <dt className="text-muted-foreground">{dictionary.aiJevSupport}</dt>
                <dd>{entry.jev_support}</dd>
                <dt className="text-muted-foreground">{dictionary.aiSemanticDivergence}</dt>
                <dd>{entry.semantic_divergence}</dd>
                <dt className="text-muted-foreground">{dictionary.aiPreferred}</dt>
                <dd>{entry.preferred}</dd>
                <dt className="text-muted-foreground">{dictionary.aiReason}</dt>
                <dd>{entry.reason}</dd>
              </dl>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// §41 INDEPENDENT CHECK: one value line plus the alignment phrase from the
// persisted alignment payload; secondary weight, details belong to Evidence.
function IndependentBlock({
  dictionary,
  locale,
  questionName,
  requestCriteria,
  snapshot,
}: {
  dictionary: Dictionary['investigation']
  locale: Locale
  questionName: string
  requestCriteria?: unknown
  snapshot: ExecutionSnapshot
}) {
  const independent = snapshot.independent_openai
  if (!independent) return null

  if (independent.status !== 'success') {
    return (
      <div className="space-y-1 rounded-lg border border-border p-4" data-testid="why-independent">
        <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.independentTitle}</p>
        <p className="text-sm text-muted-foreground">{dictionary.independentUnavailable}</p>
        {independent.error ? <p className="text-xs text-muted-foreground">{independent.error}</p> : null}
      </div>
    )
  }

  const answer = independent.result?.answers?.[questionName]
  const alignment = independent.alignment?.questions?.[questionName]
  // F6 (ADR-006 ruling 2): the §41 level display single-sources the persisted
  // alignment payload's independent_dominant_level — never a client-side
  // argmax over probabilities. Old snapshots without the field render the
  // value level-less rather than re-deriving it.
  const level = alignment?.independent_dominant_level

  const value =
    answer === undefined
      ? null
      : answer.type === 'choice'
        ? `LLM ${answer.choice}`
        : answer.type === 'score'
          ? level !== undefined
            ? `LLM ${formatCompareScore(answer.score, locale)} · ${dominantLevelDisplay(
                level,
                requestCriteria,
                answer
              )}`
            : `LLM ${formatCompareScore(answer.score, locale)}`
          : `LLM ${formatLeadingDot(answer.noul, 3)}`

  const phrase = independentPhrase(dictionary, alignment)

  return (
    <div className="space-y-1 rounded-lg border border-border p-4" data-testid="why-independent">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.independentTitle}</p>
      {value ? <p className="text-sm font-bold">{value}</p> : null}
      {phrase ? (
        <p
          className={`text-sm ${
            phrase.startsWith('✓') ? 'text-success' : 'text-warning'
          }`}
        >
          {phrase}
        </p>
      ) : null}
    </div>
  )
}

function independentPhrase(
  dictionary: Dictionary['investigation'],
  alignment: { agrees_with_emulator: boolean; agrees_with_jev: boolean | null } | undefined
): string | null {
  if (!alignment) return null
  const { agrees_with_emulator: emulatorAgrees, agrees_with_jev: jevAgrees } = alignment
  // Emulator-only runs carry a null JEV flag (never guessed): adapt phrasing.
  if (jevAgrees === null) {
    return emulatorAgrees ? dictionary.agreesEmulatorOnly : dictionary.differsEmulatorOnly
  }
  if (emulatorAgrees && jevAgrees) return dictionary.agreesBoth
  if (emulatorAgrees && !jevAgrees) return dictionary.differsJev
  if (!emulatorAgrees && jevAgrees) return dictionary.differsEmulator
  return dictionary.differsBoth
}

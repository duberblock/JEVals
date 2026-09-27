import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LoaderCircle } from 'lucide-react'

import { SourceStatusStrip } from './source-status-strip'
import { buttonVariants } from '../ui/button'
import { fill } from '../../lib/i18n/format'
import { formatFidelityPercent } from '../../lib/compare-format'
import type { Dictionary, Locale } from '../../lib/i18n'
import type { ExecutionSummary } from '../../lib/execution-snapshot'

// P42: the run-progress bar's tick — ~500ms keeps the seconds counter and
// the 500ms linear width transition in visual lockstep. The interval lives
// INSIDE the hero and runs ONLY while the bar is visible, so the view never
// re-renders per tick.
const RUN_PROGRESS_TICK_MS = 500

// P42: the honest-advance calibration. The owner's budget expectation is
// ~60s for the whole run, so the percent climbs at floor(elapsed/600) — 60s
// would read 100 — and the min() clamp pins it at 95 forever after: the bar
// never claims completion before the run resolves; past the budget it says
// "still working", honestly.
const RUN_PROGRESS_MS_PER_PERCENT = 600
const RUN_PROGRESS_MAX_PERCENT = 95

// §45.3 deep link for the AI summary line: Investigación WHY with the AI
// section focused. The hero is execution-level, so the question param is the
// FIRST request question — the same target Investigación focuses by default.
function investigationAiHref(executionId: string, firstQuestion?: string | null) {
  const params = new URLSearchParams({ execution: executionId })
  if (firstQuestion) params.set('question', firstQuestion)
  params.set('focus', 'ai')
  return `/investigation?${params.toString()}`
}

// C2 (FASE C): the hero Inspect CTA — the result→Investigación navigation is
// one click, into the same target Investigación focuses by default (the
// first request question).
function investigationHref(executionId: string, firstQuestion?: string | null) {
  const params = new URLSearchParams({ execution: executionId })
  if (firstQuestion) params.set('question', firstQuestion)
  return `/investigation?${params.toString()}`
}

// The §22 compare-state flags, single-sourced: the hero and the Investigation
// global strip (P34/FB7) branch on the SAME conditions — hasComparison gates
// every fidelity/alignment segment, jevFailed gates the §66 partial wording.
export function heroCompareState(summary: ExecutionSummary): { hasComparison: boolean; jevFailed: boolean } {
  return {
    hasComparison:
      summary.overallFidelity !== null && summary.alignedQuestions !== null && summary.questionCount > 0,
    jevFailed: summary.jevStatus === 'failed',
  }
}

// The §22 conclusion, single-sourced: the hero and the Investigation global
// strip (P34/FB7) render the SAME derivation — never a second one.
export function heroConclusion(summary: ExecutionSummary, dictionary: Dictionary['hero']): string {
  const { hasComparison, jevFailed } = heroCompareState(summary)
  return hasComparison
    ? summary.alignedQuestions === summary.questionCount
      ? dictionary.matched
      : dictionary.diverged
    : jevFailed
      ? dictionary.jevUnavailable
      : summary.questionCount === 1
        ? fill(dictionary.completedOne, { count: summary.questionCount })
        : fill(dictionary.completed, { count: summary.questionCount })
}

// Hero result (plan sections 21-23): conclusion first. Three variants:
// - compare run with a comparison: the section 22 hero (matched/diverged
//   headline, JEV Fidelity percentage, "N / M questions aligned");
// - compare run whose JEV failed (section 66 partial state): the run
//   completed, honestly flagged JEV-unavailable, with NO fidelity numbers;
// - emulator run: the plain completed conclusion — JEV Fidelity only exists
//   in compare modes, and JEV is a reference implementation, not ground
//   truth, so no accuracy/correctness language ever appears.
// P41: the SAME component renders the PROGRESSIVE hero mid-run — the
// deterministic subset that already landed while the LLM legs keep flying.
// With `pending` set, the honesty contract changes shape, never facts: the
// Inspect CTA is a DISABLED <button> with the accessible reason (no
// execution id exists to link to yet, §50), the desktop id chip does not
// render, the §32 AI line renders as plain text (no href mid-run), the
// source strip keeps its in-flight rendering, and the section carries
// aria-busy while a LLM leg is still unresolved. Everything else —
// conclusion, fidelity, models, lines — is byte-identical to the final hero.
export function HeroResult({
  dictionary,
  firstQuestion,
  locale,
  pending,
  summary,
  units,
  llmInProgressLabel,
}: {
  summary: ExecutionSummary
  dictionary: Dictionary['hero']
  units: Dictionary['units']
  locale: Locale
  firstQuestion?: string | null
  // P41: when set, the hero renders its progressive (mid-run) form.
  // llmPending drives the section's aria-busy: true while a LLM leg the
  // posted envelope expects has not resolved yet, removed once all of them
  // did (even before the final lands).
  // P42: startedAt is the run's wall-clock anchor (Date.now() captured just
  // before the POST — the ~60s budget covers the WHOLE run), feeding the
  // deterministic run-progress bar. The bar mounts under the SAME llmPending
  // rule as aria-busy: it is the visible alert that a LLM leg still runs.
  pending?: { llmPending: boolean; startedAt: number }
  // P42: the run-progress bar's accessible name — dictionary.run.llmInProgress
  // (zero new keys). P44: with the rows-slot llm-progress bar removed, this
  // label and the CTA surface are the ONLY LLM in-flight feedback.
  llmInProgressLabel?: string
}) {
  const progressive = pending !== undefined
  const showRunProgress = pending?.llmPending === true

  // P42: the bar's clock, LOCAL to the hero — the elapsed state re-renders
  // only this component on each ~500ms tick, never the view. The interval is
  // mounted ONLY while the bar is visible and always cleans up after itself.
  const [progressNowMs, setProgressNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!showRunProgress) return
    const timer = window.setInterval(() => setProgressNowMs(Date.now()), RUN_PROGRESS_TICK_MS)
    return () => window.clearInterval(timer)
  }, [showRunProgress])

  // P42: honest elapsed advance from the run's pre-POST anchor. A missing
  // anchor (impossible in practice — executeRequest arms it before every
  // POST) reads as budget-exhausted: pinned at 95, "still working".
  const elapsedMs =
    showRunProgress && pending !== undefined ? Math.max(0, progressNowMs - pending.startedAt) : 0
  const runProgressPercent = Math.min(
    RUN_PROGRESS_MAX_PERCENT,
    Math.floor(elapsedMs / RUN_PROGRESS_MS_PER_PERCENT)
  )
  const elapsedSeconds = Math.floor(elapsedMs / 1000)

  const { hasComparison, jevFailed } = heroCompareState(summary)

  const conclusion = heroConclusion(summary, dictionary)

  const duration = summary.durationMs !== null ? `${new Intl.NumberFormat(locale).format(summary.durationMs)} ${units.milliseconds}` : null

  // §22/§32: the AI evaluation contributes ONE summary line under the
  // questions-aligned line. The §67 vocabulary renders verbatim; an unknown
  // future value falls back to the raw enum (plan 15.5), never a blank hero.
  const divergenceLabels = dictionary.aiDivergence as Record<string, string>
  const aiLine =
    summary.semanticDivergence !== null
      ? divergenceLabels[summary.semanticDivergence] ?? summary.semanticDivergence
      : null

  // §22/§31: the Independent check is SECONDARY — one line from the
  // overall alignment boolean; per-question values belong to Investigación.
  const independentLine =
    summary.independentAligned === null
      ? null
      : summary.independentAligned
        ? dictionary.independentAligned
        : dictionary.independentDiverged

  // P41: the visible AI line text is shared by both forms — mid-run it wraps
  // in a plain <p> (no execution id exists to deep-link to yet); the final
  // keeps the §45.3 link.
  const aiLineText =
    aiLine !== null ? <span className="wrap-anywhere text-source-judge">{aiLine}</span> : null

  // Matched keeps the positive tone; a diverged conclusion or a JEV partial
  // state is a warning, never an error — the run itself completed.
  const allAligned = hasComparison && summary.alignedQuestions === summary.questionCount
  const conclusionClass =
    allAligned || (!hasComparison && !jevFailed)
      ? 'text-success'
      : 'text-warning'

  return (
    <section
      aria-busy={pending?.llmPending ? 'true' : undefined}
      className="space-y-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10"
      data-testid="hero-result"
    >
      {/* P36/FB9: wrap-anywhere + min-w-0 — long request-derived labels must wrap, never break the box (§16). */}
      <p className={`text-xl font-bold wrap-anywhere ${conclusionClass}`}>{conclusion}</p>
      {/* C7 (FASE C): the per-source status strip — what ran, what failed,
          what never ran, straight from the persisted sections. P41: the
          progressive hero keeps the skeleton's strip contract (running): the
          chips flip as the §65 events arrive and the unobserved ones stay
          neutral — pending, never absent. */}
      <SourceStatusStrip labels={dictionary.sourceLabels} running={progressive} status={summary.sources} />
      {/* C2 (FASE C): one-click result→Investigación navigation plus the
          desktop-only execution id chip (F11 decision: mobile hides it).
          P41: mid-run the CTA is present but DISABLED — the same primary
          look as a <button>, with the honest reason as title + sr-only text;
          no href, no navigation, and no id chip until the final lands.
          P42: while a LLM leg is still pending, a DETERMINISTIC run-progress
          bar sits BESIDE the disabled CTA (same flex row) — the alert the
          owner asked for, calibrated to the ~60s response budget. It reuses
          the rows-bar's h-1 track idiom (ADR-024) but answers a DIFFERENT
          question (how long the run has been flying vs. which legs are
          pending), so it stays deterministic and never touches that bar. */}
      <div className="flex flex-wrap items-center gap-2">
        {progressive ? (
          <>
            <button
              className={`${buttonVariants({ variant: 'default' })} h-11 px-6`}
              disabled
              title={dictionary.inspectCtaDisabled}
              type="button"
            >
              {/* P43: a spinning loader INSIDE the disabled button — the
                  button itself communicates activity, not just the row.
                  aria-hidden: the sr-only reason and the meter already
                  speak for assistive tech; the §72 reduced-motion block
                  freezes the spin app-wide (animation neutralized). */}
              {showRunProgress ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
              {dictionary.inspectCta}
              <span className="sr-only">{dictionary.inspectCtaDisabled}</span>
            </button>
            {showRunProgress ? (
              <>
                {/* The meter itself carries the semantics (min/max/now +
                    the rows-bar's LLM in-progress label); the visible
                    seconds beside it are redundant for assistive tech, so
                    they stay aria-hidden — no double announcement. */}
                <div
                  aria-label={llmInProgressLabel}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={runProgressPercent}
                  className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                >
                  {/* §72 reduced-motion: this width transition is
                      INFORMATIVE (it encodes the elapsed advance), so it
                      gets an explicit motion-reduce escape hatch to
                      instant instead of relying on the global pulse block;
                      linear so the motion itself reads as steady progress. */}
                  <div
                    className="h-full rounded-full bg-foreground/50 transition-[width] duration-500 ease-linear motion-reduce:transition-none"
                    style={{ width: `${runProgressPercent}%` }}
                  />
                  {/* P43: the continuous indeterminate band — a shimmer
                      sliding across the track FOREVER while it is mounted,
                      so the thin determinate bar (1%/600ms) can never read
                      as frozen. It rides OVER the honest fill (sibling, not
                      replacement); decorative, so aria-hidden. The keyframes
                      live in globals.css and the §72 reduced-motion block
                      neutralizes the loop app-wide (runs once ≈ frozen). */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-1/3 animate-[cta-shimmer_1.8s_linear_infinite] rounded-full bg-foreground/25"
                    data-testid="cta-progress-shimmer"
                  />
                </div>
                <span aria-hidden="true" className="text-xs tabular-nums text-muted-foreground">
                  {elapsedSeconds} {units.seconds}
                </span>
                {/* P43: the in-progress label as VISIBLE static text beside
                    the button — the state legible at a glance, not only in
                    title/aria attributes. The leading dot separates it from
                    the ticking seconds; the text itself never mutates per
                    tick (the seconds do, still aria-hidden). aria-hidden
                    because the meter's aria-label announces it exactly
                    once — no live-region churn (P42 dual-review ruling). */}
                {llmInProgressLabel !== undefined ? (
                  <span aria-hidden="true" className="text-xs text-muted-foreground">
                    · {llmInProgressLabel}
                  </span>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            {/* A real link styled as the primary button — the Base UI Button
            primitive forces role="button" even when polymorphed onto an <a>,
            which would announce navigation as a button; this keeps the link
            semantics (and native Enter activation) with the button look. */}
            <Link
              className={`${buttonVariants({ variant: 'default' })} h-11 px-6`}
              href={investigationHref(summary.executionId, firstQuestion)}
            >
              {dictionary.inspectCta}
            </Link>
            <span
              className="hidden border-border px-2 py-0.5 font-mono uppercase text-label-caps text-muted-foreground sm:inline-flex"
              data-testid="execution-id-chip"
            >
              {summary.executionId}
            </span>
          </>
        )}
      </div>
      {hasComparison ? (
        <div className="space-y-1">
          <p className="text-4xl font-bold tracking-tight">
            {formatFidelityPercent(summary.overallFidelity ?? 0, locale)}
          </p>
          <p className="text-sm font-medium text-muted-foreground">{dictionary.jevFidelity}</p>
          {/* F7: singular when the TOTAL is exactly one (even if 0 aligned). */}
          <p className="text-sm">
            {fill(summary.questionCount === 1 ? dictionary.questionsAlignedOne : dictionary.questionsAligned, {
              aligned: summary.alignedQuestions ?? 0,
              total: summary.questionCount,
            })}
          </p>
        </div>
      ) : null}
      {/* §45.3: the AI summary line deep-links into Investigación with the AI
          section focused. The visible text stays; the aria-label appends the
          canonical View in Investigation term. P41: mid-run there is no id to
          link to, so the SAME visible text renders as a plain line. */}
      {aiLineText !== null ? (
        progressive ? (
          <p className="text-sm font-medium">{aiLineText}</p>
        ) : (
          <Link
            aria-label={`${aiLine} — ${dictionary.viewInInvestigation}`}
            className="text-sm font-medium"
            href={investigationAiHref(summary.executionId, firstQuestion)}
          >
            {/* C10: explicit origin — the A7 judge ink carries the line; the
              wording itself (the source prefix) lives in the dictionary. */}
            {aiLineText}
          </Link>
        )
      ) : null}
      {independentLine !== null ? (
        <p className="text-sm font-medium wrap-anywhere text-source-independent">{independentLine}</p>
      ) : null}
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div className="flex min-w-0 gap-2">
          <dt className="text-muted-foreground">{dictionary.model}</dt>
          <dd className="wrap-anywhere font-mono">{summary.model}</dd>
        </div>
        {summary.jevModel ? (
          <div className="flex min-w-0 gap-2">
            <dt className="text-muted-foreground">{dictionary.jevModel}</dt>
            <dd className="wrap-anywhere font-mono">{summary.jevModel}</dd>
          </div>
        ) : null}
        {duration !== null ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{dictionary.duration}</dt>
            <dd>{duration}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{dictionary.questions}</dt>
          <dd>{new Intl.NumberFormat(locale).format(summary.questionCount)}</dd>
        </div>
      </dl>
    </section>
  )
}

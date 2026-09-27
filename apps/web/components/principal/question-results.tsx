import Link from 'next/link'
import type { ReactNode } from 'react'

import type { Dictionary, Locale } from '../../lib/i18n'
import { formatCompareScore, formatLeadingDot } from '../../lib/compare-format'
import type { EmulatorAnswer, QuestionComparison } from '../../lib/execution-snapshot'

type RequestQuestions = Record<string, { type?: string; criteria?: unknown }>

// §35 deep link into Investigación: executionId + questionName + primitiveType
// land the user with the question already focused (source defaults to WHY).
function investigationHref(executionId: string, question: string, primitive: string) {
  const params = new URLSearchParams({ execution: executionId, question, primitive })
  return `/investigation?${params.toString()}`
}

// The plan's row chevron: the visual hint that the whole row drills into
// Investigación. Decorative — the row link carries the accessible label.
function RowChevron() {
  return (
    <span aria-hidden="true" className="text-muted-foreground">
      {'>'}
    </span>
  )
}

// §45.3: in compare rows the JEV value and the Δ link to the same WHY URL as
// the row. Without an execution id (no run yet) nothing links: a styled value
// degrades to its span, a bare value renders inline so the composed text
// ("1.82 → 1.64") keeps flowing as a single text run. When linked, the value
// stacks ABOVE the stretched row link (relative z-10) so its own tap target
// wins — otherwise the absolutely-positioned row overlay would swallow it.
function MaybeLink({
  children,
  className,
  href,
}: {
  children: ReactNode
  className?: string
  href: string | null
}) {
  if (href === null) {
    if (className) return <span className={className}>{children}</span>
    return <>{children}</>
  }
  return (
    <Link className={className ? `relative z-10 ${className}` : 'relative z-10'} href={href}>
      {children}
    </Link>
  )
}

// Compact per-question rows (plan sections 28-30). Two variants:
// - compare (a comparison entry + both answers exist): the two-column
//   "emulator → jev" row with the deterministic comparison facts;
// - emulator-only: one minimal line per question — no full probability
//   distributions, no Noul classification, no threshold language (section 27).
// With an execution id every row is a link into Investigación (§35); the
// link needs a completed run, so rows render unlinked when it is absent.
export function QuestionResults({
  answers,
  comparison,
  dictionary,
  executionId,
  jevAnswers,
  locale,
  order,
  requestQuestions,
}: {
  answers: Record<string, EmulatorAnswer>
  comparison?: Record<string, QuestionComparison>
  dictionary: Dictionary['questions']
  executionId?: string
  jevAnswers?: Record<string, EmulatorAnswer>
  locale: Locale
  order?: string[]
  requestQuestions?: RequestQuestions
}) {
  const names = order ?? Object.keys(answers)

  return (
    <section className="space-y-2" data-testid="question-results">
      <p className="text-sm font-semibold">{dictionary.title}</p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {names.map((name) => {
          const answer = answers[name]
          if (!answer) return null
          const questionComparison = comparison?.[name]
          const jevAnswer = jevAnswers?.[name]
          if (questionComparison && jevAnswer) {
            return (
              <CompareRow
                answer={answer}
                comparison={questionComparison}
                dictionary={dictionary}
                executionId={executionId}
                jevAnswer={jevAnswer}
                key={name}
                locale={locale}
                name={name}
                requestQuestion={requestQuestions?.[name]}
              />
            )
          }
          return (
            <EmulatorRow
              answer={answer}
              dictionary={dictionary}
              executionId={executionId}
              key={name}
              locale={locale}
              name={name}
            />
          )
        })}
      </ul>
    </section>
  )
}

// Stretched-link pattern: an anchor absolutely covering the row gives the
// "whole row is a link" affordance while keeping the JEV/Δ anchors as
// siblings (never nested) — they stack above it in the tab/click order.
function RowInspectLink({ href, label }: { href: string; label: string }) {
  return <Link aria-label={label} className="absolute inset-0" href={href} />
}

function EmulatorRow({
  answer,
  dictionary,
  executionId,
  locale,
  name,
}: {
  answer: EmulatorAnswer
  dictionary: Dictionary['questions']
  executionId?: string
  locale: Locale
  name: string
}) {
  const href = executionId ? investigationHref(executionId, name, answer.type) : null
  return (
    <li
      className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-3 text-sm${
        href ? ' relative' : ''
      }`}
    >
      {/* P36/FB9: wrap-anywhere + min-w-0 — long request-derived labels must wrap, never break the box (§16).
          F1 (dual-review): the question NAME is the same no-spaces token class as the values. */}
      <span className="min-w-0 wrap-anywhere font-mono font-medium">
        {name} · {answer.type.toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-3">
        {answer.type === 'choice' ? (
          <>
            <span className="wrap-anywhere font-bold">{answer.choice}</span>
            <span className="text-muted-foreground">
              {dictionary.confidence}{' '}
              {new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
                answer.confidence
              )}
            </span>
          </>
        ) : null}
        {answer.type === 'score' ? (
          <span className="wrap-anywhere font-bold">
            {new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(answer.score)}
          </span>
        ) : null}
        {answer.type === 'noul' ? (
          <span className="wrap-anywhere">
            {dictionary.probability}{' '}
            {new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(answer.noul)}
          </span>
        ) : null}
        {href ? <RowChevron /> : null}
      </span>
      {href ? <RowInspectLink href={href} label={`${dictionary.inspect} ${name}`} /> : null}
    </li>
  )
}

function CompareRow({
  answer,
  comparison,
  dictionary,
  executionId,
  jevAnswer,
  locale,
  name,
  requestQuestion,
}: {
  answer: EmulatorAnswer
  comparison: QuestionComparison
  dictionary: Dictionary['questions']
  executionId?: string
  jevAnswer: EmulatorAnswer
  locale: Locale
  name: string
  requestQuestion?: { type?: string; criteria?: unknown }
}) {
  const marker = comparison.primitive === 'choice' ? (comparison.aligned ? '✓ ' : '! ') : ''
  const primitive = comparison.primitive.toUpperCase()
  const href = executionId ? investigationHref(executionId, name, comparison.primitive) : null

  return (
    <li
      className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-3 text-sm${
        href ? ' relative' : ''
      }`}
    >
      <span className="min-w-0 wrap-anywhere font-mono font-medium">
        {marker}
        {name} · {primitive}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-3">
        {comparison.primitive === 'choice' && answer.type === 'choice' && jevAnswer.type === 'choice' ? (
          <span className="wrap-anywhere font-bold">
            {answer.choice} → <MaybeLink href={href}>{jevAnswer.choice}</MaybeLink>
          </span>
        ) : null}
        {comparison.primitive === 'choice' && answer.type === 'choice' && jevAnswer.type === 'choice' ? (
          <span className="text-muted-foreground">
            {comparison.aligned ? dictionary.sameDecision : dictionary.differentDecision}
          </span>
        ) : null}
        {comparison.primitive === 'score' &&
        answer.type === 'score' &&
        jevAnswer.type === 'score' &&
        comparison.components &&
        'score_delta' in comparison.components ? (
          <>
            <span className="wrap-anywhere font-bold">
              {formatCompareScore(answer.score, locale)} →{' '}
              <MaybeLink href={href}>{formatCompareScore(jevAnswer.score, locale)}</MaybeLink>
            </span>
            <MaybeLink className="text-muted-foreground" href={href}>
              Δ {formatLeadingDot(comparison.components.score_delta, 2)}
            </MaybeLink>
            {/* F2 (dual-review): the dominant levels carry the request's
                criteria labels — same no-spaces token class, same hardening. */}
            <span className="min-w-0 wrap-anywhere text-muted-foreground">
              {dominantLevelText(comparison.components.emulator_dominant_level, requestQuestion, answer)} ↔{' '}
              {dominantLevelText(comparison.components.jev_dominant_level, requestQuestion, jevAnswer)}
            </span>
            {/* B4 (ADR-013 ruling 4): desktop-only glance rail in the §29
                quick row — positions only, the §29 quick values above carry
                the numbers. Mobile rendering stays byte-stable (hidden). */}
            {comparison.components.max_score > 0 ? (
              <div
                aria-hidden="true"
                className="relative hidden h-1 w-36 shrink-0 self-center rounded-full bg-muted lg:block"
                data-testid="score-rail-minimal"
              >
                <span
                  className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-source-jev"
                  style={{ left: `${(jevAnswer.score / comparison.components.max_score) * 100}%` }}
                />
                <span
                  className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-source-emulator"
                  style={{ left: `${(answer.score / comparison.components.max_score) * 100}%` }}
                />
              </div>
            ) : null}
          </>
        ) : null}
        {comparison.primitive === 'noul' && answer.type === 'noul' && jevAnswer.type === 'noul' ? (
          <>
            <span className="wrap-anywhere font-bold">
              {formatLeadingDot(answer.noul, 3)} →{' '}
              <MaybeLink href={href}>{formatLeadingDot(jevAnswer.noul, 3)}</MaybeLink>
            </span>
            {comparison.components && 'probability_delta' in comparison.components ? (
              <MaybeLink className="text-muted-foreground" href={href}>
                Δ {formatLeadingDot(comparison.components.probability_delta, 3)}
              </MaybeLink>
            ) : null}
            <span className="text-muted-foreground">{noulSidePhrase(answer.noul, jevAnswer.noul, dictionary)}</span>
          </>
        ) : null}
        {href ? <RowChevron /> : null}
      </span>
      {href ? <RowInspectLink href={href} label={`${dictionary.inspect} ${name}`} /> : null}
    </li>
  )
}

// Section 27 side summary: 0.5 is the mathematical midpoint, so the phrases
// only apply when both probabilities are strictly on the same side — or
// strictly on opposite sides. A probability AT .5 has no canonical phrase and
// renders nothing (never invent).
function noulSidePhrase(
  emulator: number,
  jev: number,
  dictionary: Dictionary['questions']
): string | null {
  const below = (value: number) => value < 0.5
  const above = (value: number) => value > 0.5
  if (below(emulator) && below(jev)) return dictionary.bothBelow
  if (above(emulator) && above(jev)) return dictionary.bothAbove
  if ((below(emulator) && above(jev)) || (above(emulator) && below(jev))) return dictionary.crossed
  return null
}

// Dominant rubric level display text: the REQUEST criteria array is the
// canonical rubric source (indexed by int(level)); the delivering side's
// answer legend is the fallback (the emulator answer for the emulator level,
// the JEV answer for the JEV level — J3); the raw level key is the last
// resort.
function dominantLevelText(
  level: string,
  requestQuestion: { type?: string; criteria?: unknown } | undefined,
  sideAnswer: EmulatorAnswer
): string {
  const criteria = requestQuestion?.criteria
  if (Array.isArray(criteria)) {
    const index = Number.parseInt(level, 10)
    if (Number.isInteger(index) && index >= 0 && index < criteria.length) {
      const text = criteria[index]
      if (typeof text === 'string' && text.trim() !== '') return text
    }
  }
  if (sideAnswer.type === 'score') {
    const legendText = sideAnswer.legend[level]
    if (typeof legendText === 'string' && legendText.trim() !== '') return legendText
  }
  return level
}

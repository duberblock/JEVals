'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { EvidenceView, isEvidenceSource, type EvidenceSource } from './evidence-view'
import { WhyView } from './why-view'
import { heroCompareState, heroConclusion } from '../principal/hero-result'
import { ScenarioBox } from '../shared/scenario-box'
import { Button } from '../ui/button'
import {
  questionOrder,
  summarizeSnapshot,
  type ExecutionSnapshot,
  type ExecutionSummary,
} from '../../lib/execution-snapshot'
import { fill } from '../../lib/i18n/format'
import { useDictionary } from '../../lib/i18n/use-locale'
import type { Dictionary, Locale } from '../../lib/i18n'
import { clearSessionCase, readSessionCase, setSessionCase } from '../../lib/session-case'
import { formatFidelityPercent } from '../../lib/compare-format'

// Investigación (plan sections 34-45.7). The page is a client component
// reading the §45.3 deep-link contract from the URL:
// /investigation?execution=<id>&question=<name>&primitive=<choice|score|noul>
//   &source=<why|request|emulator|jev|ai|independent|full>&focus=ai
// Defaults: first question in request order; source 'why'. The web renders
// the persisted snapshot — it never re-derives domain semantics.

type ProblemBody = { title?: string; detail?: string }

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; snapshot: ExecutionSnapshot }
  | { kind: 'not-found' }
  | { kind: 'error'; problem?: ProblemBody }
  // P45 (R62): no case to consult — no ?execution= param and no session case
  // (or one that discarded silently, W6). The screen's normal empty state.
  | { kind: 'empty' }

type Primitive = 'choice' | 'score' | 'noul'

// The primitive label comes from the request question's declared type (§7),
// falling back to the delivered answers, then to the URL param — in that
// order of authority. Null renders no primitive segment (never invented).
function derivePrimitive(
  snapshot: ExecutionSnapshot,
  name: string | undefined,
  fallback: string | null
): Primitive | null {
  const declared = name ? snapshot.request?.questions?.[name]?.type : undefined
  if (declared === 'choice' || declared === 'score' || declared === 'noul') return declared
  const answer = (name ? snapshot.emulator?.result?.answers?.[name] : undefined) ??
    (name ? snapshot.jev?.result?.answers?.[name] : undefined)
  if (answer && (answer.type === 'choice' || answer.type === 'score' || answer.type === 'noul')) {
    return answer.type
  }
  if (fallback === 'choice' || fallback === 'score' || fallback === 'noul') return fallback
  return null
}

// §37 header instructions EntryType: strings render directly; any structured
// value renders as small inline pretty JSON (never a collapsed mystery).
function InstructionsText({ value }: { value: unknown }) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    return <p className="max-w-2xl text-sm text-muted-foreground">{value}</p>
  }
  return (
    <pre className="max-w-2xl overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs text-muted-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

// P34 (FB7): the discrete global strip — one secondary line under the §37
// header carrying the case's GLOBAL result: the §22 conclusion, JEV
// Fidelity and N/M (the SAME derivation as the Principal hero through
// heroConclusion/heroCompareState — never a second one, zero new calls: the
// snapshot is already loaded) plus the run mode and the link to hydrated
// Principal (/?execution=<id>, the P30 mechanism). §36 intact: text-xs
// muted context with secondary visual weight — WHY|EVIDENCE stays the first
// level; the strip is never the protagonist.
function GlobalStrip({
  dictionary,
  locale,
  summary,
}: {
  dictionary: Dictionary
  locale: Locale
  summary: ExecutionSummary
}) {
  const copy = dictionary.investigation
  const { hasComparison } = heroCompareState(summary)
  // recent.mode is the shared localized mode-label family; an unknown future
  // mode falls back to the raw enum (plan 15.5), never a blank segment.
  const modeLabels = dictionary.recent.mode as Record<string, string>
  return (
    <p
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      data-testid="investigation-global-strip"
    >
      {/* Static segments need no request-derived wrap (the ADR-019 inventory
          is request-derived labels only); the strip's words are dictionary
          templates and canonical labels. */}
      <span>{heroConclusion(summary, dictionary.hero)}</span>
      {hasComparison ? (
        <span>
          {formatFidelityPercent(summary.overallFidelity ?? 0, locale)} {dictionary.hero.jevFidelity}
        </span>
      ) : null}
      {hasComparison ? (
        // F7: singular when the TOTAL is exactly one (same rule as the hero).
        <span>
          {fill(
            summary.questionCount === 1 ? dictionary.hero.questionsAlignedOne : dictionary.hero.questionsAligned,
            { aligned: summary.alignedQuestions ?? 0, total: summary.questionCount }
          )}
        </span>
      ) : null}
      <span>{modeLabels[summary.mode] ?? summary.mode}</span>
      {/* A real link — navigation semantics into hydrated Principal. */}
      <Link
        className="font-medium underline-offset-4 hover:underline"
        href={`/?execution=${encodeURIComponent(summary.executionId)}`}
      >
        {copy.viewInPrincipal}
      </Link>
    </p>
  )
}

export function InvestigationView() {
  const { locale, dictionary } = useDictionary()
  const copy = dictionary.investigation
  const router = useRouter()
  const searchParams = useSearchParams()

  const executionId = searchParams.get('execution')
  const requestedQuestion = searchParams.get('question')
  const primitiveParam = searchParams.get('primitive')
  const sourceParam = searchParams.get('source')
  const focusParam = searchParams.get('focus')

  // §36: the first level has exactly two states — WHY or one Evidence source.
  const source: 'why' | EvidenceSource = isEvidenceSource(sourceParam) ? sourceParam : 'why'

  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  // P45 (R62, T1.3): the case in consultation stands in for a missing
  // ?execution= param. One-shot at mount (the ref guard), stored in a ref
  // that ONLY effects and event-time callbacks read — never the render
  // (react-hooks/refs). The explicit param ALWAYS wins and never consumes
  // the session. W7: the storage read happens in the effect, never during
  // render.
  const sessionConsumedRef = useRef(false)
  const sessionCaseRef = useRef<string | null>(null)

  useEffect(() => {
    // P45: consume the session case once, only when no param named a case.
    if (!sessionConsumedRef.current) {
      sessionConsumedRef.current = true
      if (!executionId) {
        const stored = readSessionCase()
        if (stored) sessionCaseRef.current = stored
      }
    }
    // With a param, the param's id is the target (today's behavior); without
    // one, the consumed session id — or no case at all.
    const targetId = executionId ?? sessionCaseRef.current
    if (!targetId) {
      setState({ kind: 'empty' })
      return
    }
    // P45 (W6): a session-sourced GET (no param named this case) that fails
    // — 404, any other status, or a network error — discards SILENTLY: no
    // banner, the session entry is cleared and the page falls back to its
    // normal empty state. Param-sourced failures keep today's honest states.
    const fromSession = executionId === null
    let active = true
    async function load(id: string) {
      try {
        const response = await fetch(`/api/v1/executions/${encodeURIComponent(id)}`, {
          method: 'GET',
        })
        if (!active) return
        if (response.status === 404) {
          if (fromSession) {
            discardSessionCase()
            return
          }
          setState({ kind: 'not-found' })
          return
        }
        const data = (await response.json()) as ExecutionSnapshot & ProblemBody
        if (!active) return
        if (!response.ok) {
          if (fromSession) {
            discardSessionCase()
            return
          }
          setState({ kind: 'error', problem: { title: data.title, detail: data.detail } })
          return
        }
        // P45 (T1.2/T1.3): a hydration that LANDS sets the session case —
        // the visible case is the one in consultation (the param's landing
        // re-sets it; the session's own re-set is idempotent).
        setSessionCase(id)
        setState({ kind: 'loaded', snapshot: data })
      } catch {
        if (!active) return
        if (fromSession) {
          discardSessionCase()
          return
        }
        setState({ kind: 'error' })
      }
    }
    function discardSessionCase() {
      clearSessionCase()
      sessionCaseRef.current = null
      setState({ kind: 'empty' })
    }
    setState({ kind: 'loading' })
    void load(targetId)
    return () => {
      active = false
    }
  }, [executionId])

  const snapshot = state.kind === 'loaded' ? state.snapshot : null
  const questions = snapshot ? questionOrder(snapshot) : []
  const focused =
    requestedQuestion !== null && questions.includes(requestedQuestion) ? requestedQuestion : questions[0]
  const primitive = snapshot ? derivePrimitive(snapshot, focused, primitiveParam) : null

  // Internal navigation (§45.3): mirrors the contract params in the URL so
  // every view is shareable. `focus` is a one-shot deep-link affordance and
  // is intentionally dropped on internal navigation. P45: a session-hydrated
  // case mirrors its id exactly like a deep-linked one — the ref read lives
  // in the callback (event time, never render), and this is USER-initiated
  // navigation, not the hydration itself (T1.8 never rewrote the URL).
  const navigate = useCallback(
    (next: { question?: string; source?: 'why' | EvidenceSource }) => {
      const activeExecutionId = executionId ?? sessionCaseRef.current
      if (!activeExecutionId) return
      const params = new URLSearchParams()
      params.set('execution', activeExecutionId)
      const question = next.question ?? focused
      if (question) params.set('question', question)
      params.set('source', next.source ?? source)
      router.replace(`/investigation?${params.toString()}`, { scroll: false })
    },
    [executionId, focused, router, source]
  )

  if (state.kind === 'empty') {
    return (
      <section className="space-y-1 rounded-xl bg-muted/40 p-5 ring-1 ring-foreground/10">
        <p className="text-sm font-bold">{copy.missingExecutionTitle}</p>
        <p className="text-sm text-muted-foreground">{copy.missingExecutionDetail}</p>
      </section>
    )
  }

  if (state.kind === 'loading') {
    return <p className="text-sm text-muted-foreground">{copy.loading}</p>
  }

  if (state.kind === 'not-found') {
    return (
      <section className="space-y-1 rounded-xl bg-muted/40 p-5 ring-1 ring-foreground/10">
        <p className="text-sm font-bold">{copy.notFoundTitle}</p>
        <p className="text-sm text-muted-foreground">{copy.notFoundDetail}</p>
      </section>
    )
  }

  if (state.kind === 'error') {
    return (
      <section className="space-y-1 rounded-xl bg-destructive/5 p-5 ring-1 ring-destructive/20">
        <p className="text-sm font-bold text-destructive">✗ {copy.loadFailed}</p>
        {state.problem?.title ? (
          <p className="text-xs text-muted-foreground">
            {state.problem.title}
            {state.problem.detail ? ` — ${state.problem.detail}` : ''}
          </p>
        ) : null}
      </section>
    )
  }

  if (questions.length === 0) {
    return <p className="text-sm text-muted-foreground">{copy.noQuestions}</p>
  }

  // P34 (FB7): the global strip renders ONLY for completed snapshots (hero
  // parity — a failed run has no global summary; its honesty lives in the
  // §66/status surfaces). summarizeSnapshot already carries questionCount =
  // questionOrder length, and the noQuestions early-return above guarantees
  // the context — no override needed (F3 dual-review: Principal's answers
  // fallback is unreachable here).
  const globalSummary =
    snapshot !== null && snapshot.status === 'completed' ? summarizeSnapshot(snapshot) : null

  const headerParts = [dictionary.nav.investigation, focused]
  if (primitive) headerParts.push(primitive.toUpperCase())

  // P47 (c): the loaded executable's scenario — the persisted
  // snapshot.request.state, rendered ABOVE the selected question's title.
  // Null/absent state renders NO box (never an empty one, never "null").
  const scenarioState = snapshot?.request?.state ?? null

  return (
    <section className="space-y-4">
      {/* P47 (c): the scenario box before the §37 header — the request's
          state sits above the question being investigated. */}
      {scenarioState !== null ? <ScenarioBox dictionary={dictionary.scenario} state={scenarioState} /> : null}
      {/* §37 header: Investigación · <question name> · <PRIMITIVE> + instructions.
          P36/FB9: wrap-anywhere + min-w-0 — long request-derived labels must wrap, never break the box (§16).
          The selector buttons override the ui/button base (shrink-0 +
          whitespace-nowrap): a no-spaces question name rendered there could
          neither wrap nor shrink and overflowed the document (extreme-gate
          finding — 287px at 375). */}
      <header className="space-y-2">
        <h1 className="text-xl font-bold wrap-anywhere tracking-tight" data-testid="investigation-header">
          {headerParts.join(' · ')}
        </h1>
        <InstructionsText value={focused ? snapshot?.request?.questions?.[focused]?.instructions : undefined} />
        {/* P34 (FB7): the discrete global strip — after the h1/InstructionsText,
            before the question selector. Secondary context (§36 intact). */}
        {globalSummary ? (
          <GlobalStrip dictionary={dictionary} locale={locale} summary={globalSummary} />
        ) : null}
        {questions.length > 1 ? (
          <div className="flex flex-wrap gap-2" data-testid="question-selector" role="group">
            {questions.map((name) => (
              <Button
                aria-pressed={name === focused}
                className="max-w-full min-w-0 shrink whitespace-normal wrap-anywhere text-left"
                key={name}
                onClick={() => navigate({ question: name })}
                size="sm"
                type="button"
                variant={name === focused ? 'default' : 'outline'}
              >
                {name}
              </Button>
            ))}
          </div>
        ) : null}
      </header>

      {/* §36: the only first-level navigation — WHY | EVIDENCE */}
      <div className="flex gap-2" role="group">
        <Button
          aria-pressed={source === 'why'}
          data-testid="switch-why"
          onClick={() => navigate({ source: 'why' })}
          size="sm"
          type="button"
          variant={source === 'why' ? 'default' : 'outline'}
        >
          {copy.whyTab}
        </Button>
        <Button
          aria-pressed={source !== 'why'}
          data-testid="switch-evidence"
          onClick={() => {
            if (source === 'why') navigate({ source: 'request' })
          }}
          size="sm"
          type="button"
          variant={source !== 'why' ? 'default' : 'outline'}
        >
          {copy.evidenceTab}
        </Button>
      </div>

      {source === 'why' ? (
        <WhyView
          dictionary={copy}
          focusAi={focusParam === 'ai'}
          locale={locale}
          onViewEvidence={() => navigate({ source: 'request' })}
          questionName={focused ?? ''}
          snapshot={state.snapshot}
        />
      ) : (
        <EvidenceView
          dictionary={copy}
          onSourceChange={(next) => navigate({ source: next })}
          questionName={focused ?? ''}
          snapshot={state.snapshot}
          source={source}
        />
      )}
    </section>
  )
}

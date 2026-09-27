'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { shortExecutionId, type RecentExecutionItem } from '../../lib/execution-snapshot'
import { railStatus } from '../../lib/operation/derive'
import { formatFidelityPercent } from '../../lib/compare-format'
import { fill } from '../../lib/i18n/format'
import type { Dictionary, Locale } from '../../lib/i18n'

type ProblemBody = { title?: string; detail?: string }

type ListState =
  | { kind: 'loading' }
  | { kind: 'loaded'; items: RecentExecutionItem[] }
  | { kind: 'error'; problem?: ProblemBody }

// Recent executions (plan section 18, block 8 — secondary surface). Loads on
// mount and again whenever reloadToken changes (after each successful run).
// Timestamps render with the CURRENT UI locale (plan section 15.7).
// P30 (FB3): the row itself hydrates Principal via onSelect (the primary
// affordance); the §35 Investigación deep link survives as a secondary,
// ≥44px-target compact link per row.
export function RecentExecutions({
  dictionary,
  units,
  locale,
  reloadToken,
  onSelect,
}: {
  dictionary: Dictionary['recent']
  units: Dictionary['units']
  locale: Locale
  reloadToken: number
  onSelect: (executionId: string) => void
}) {
  const [state, setState] = useState<ListState>({ kind: 'loading' })
  // F4: raw API enums render as localized labels; unknown future values fall
  // back to the raw enum so the list never blanks out (plan 15.5).
  const modeLabels = dictionary.mode as Record<string, string>
  const statusLabels = dictionary.status as Record<string, string>
  // §32 badge vocabulary: canonical "AI Evaluation" term + localized §67
  // divergence word. An unknown future enum falls back to the raw value
  // (plan 15.5) so the row never blanks out.
  const divergenceWords = dictionary.semanticDivergence as Record<string, string>

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const response = await fetch('/api/v1/executions?limit=5', { method: 'GET' })
        const data = (await response.json()) as { items?: RecentExecutionItem[] } & ProblemBody
        if (!active) return
        // F12: a non-ok response or a body without an items array (e.g. an
        // RFC 7807 problem) is an error — it must never look like empty history.
        if (!response.ok || !Array.isArray(data.items)) {
          setState({ kind: 'error', problem: { title: data.title, detail: data.detail } })
          return
        }
        setState({ kind: 'loaded', items: data.items })
      } catch {
        if (active) setState({ kind: 'error' })
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [reloadToken])

  return (
    <section className="space-y-2" data-testid="recent-executions">
      <p className="text-sm font-semibold">{dictionary.title}</p>
      {state.kind === 'loading' ? <p className="text-sm text-muted-foreground">{dictionary.loading}</p> : null}
      {state.kind === 'error' ? (
        <div className="space-y-1">
          <p className="text-sm text-destructive">{dictionary.failed}</p>
          {state.problem?.title ? (
            <p className="text-xs text-muted-foreground">
              {state.problem.title}
              {state.problem.detail ? ` — ${state.problem.detail}` : ''}
            </p>
          ) : null}
        </div>
      ) : null}
      {state.kind === 'loaded' && state.items.length === 0 ? (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{dictionary.empty}</p>
          {/* FB4 (P31): the mobile-friendly access point for /how-it-works —
              the header link is desktop-only (see app-header). */}
          <Link className="inline-block text-sm font-medium underline-offset-4 hover:underline" href="/how-it-works">
            {dictionary.howItWorks}
          </Link>
        </div>
      ) : null}
      {state.kind === 'loaded' && state.items.length > 0 ? (
        <>
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {state.items.map((item) => {
            // §66 classification as delivered by the list API — the same
            // railStatus the rail and history use, so a partial run reads
            // identically on every surface (never repainted green here).
            const status = railStatus(item)
            return (
            <li className="flex items-center" key={item.execution_id}>
              <button
                /* P30 (FB3): the row itself hydrates Principal with the full
                   snapshot of that execution (the owner's primary flow). F12:
                   the aria-label keeps the §35 composition — verb, short id,
                   mode, status — so screen-reader button lists keep what the
                   sighted row shows. */
                aria-label={`${dictionary.loadExecution} ${shortExecutionId(item.execution_id)} — ${
                  modeLabels[item.mode] ?? item.mode
                }, ${statusLabels[status] ?? status}`}
                className="flex flex-1 flex-wrap items-baseline gap-x-5 gap-y-1 px-3 py-2.5 text-start"
                onClick={() => onSelect(item.execution_id)}
                type="button"
              >
                <span className="font-mono text-xs">{shortExecutionId(item.execution_id)}</span>
                <span className="text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                    new Date(item.created_at)
                  )}
                </span>
                <span>{modeLabels[item.mode] ?? item.mode}</span>
                <span
                  className={
                    status === 'failed'
                      ? 'font-medium text-destructive'
                      : status === 'partial'
                        ? 'font-medium text-warning'
                        : 'font-medium text-success'
                  }
                >
                  {statusLabels[status] ?? status}
                </span>
                <span className="text-muted-foreground">
                  {new Intl.NumberFormat(locale).format(item.question_count)}
                </span>
                {item.overall_fidelity !== null ? (
                  <span className="font-medium">{formatFidelityPercent(item.overall_fidelity, locale)}</span>
                ) : null}
                {item.semantic_divergence !== null ? (
                  <span className="font-medium">{`${
                    dictionary.semanticDivergence.label
                  }: ${divergenceWords[item.semantic_divergence] ?? item.semantic_divergence}`}</span>
                ) : null}
                {item.aligned_questions !== null ? (
                  <span className="text-muted-foreground">
                    {/* F7: singular when the total is exactly one question. */}
                    {fill(item.question_count === 1 ? dictionary.questionsAlignedOne : dictionary.questionsAligned, {
                      aligned: item.aligned_questions,
                      total: item.question_count,
                    })}
                  </span>
                ) : null}
                {item.duration_ms !== null ? (
                  <span className="text-muted-foreground">
                    {new Intl.NumberFormat(locale).format(item.duration_ms)} {units.milliseconds}
                  </span>
                ) : null}
              </button>
              <Link
                /* §35: the Investigación deep link survives as a SECONDARY
                   per-row affordance (defaults focus the first question).
                   ≥44px target (§16-class touch sizing) with the same F12
                   aria composition the row link always had. */
                aria-label={`${dictionary.viewInInvestigation} ${shortExecutionId(item.execution_id)} — ${
                  modeLabels[item.mode] ?? item.mode
                }, ${statusLabels[status] ?? status}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted-foreground"
                href={`/investigation?execution=${encodeURIComponent(item.execution_id)}`}
              >
                <span aria-hidden="true">↗</span>
              </Link>
            </li>
            )
          })}
        </ul>
        {/* §54.1: quick access to the full §55 history below the recent list. */}
        <Link
          className="inline-block text-sm font-medium underline-offset-4 hover:underline"
          href="/history"
        >
          {dictionary.viewHistory}
        </Link>
        </>
      ) : null}
    </section>
  )
}

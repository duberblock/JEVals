'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '../ui/button'
import type { RecentExecutionItem } from '../../lib/execution-snapshot'
import { shortExecutionId } from '../../lib/execution-snapshot'
import { railStatus } from '../../lib/operation/derive'
import { formatFidelityPercent } from '../../lib/compare-format'
import { fill } from '../../lib/i18n/format'
import { useDictionary } from '../../lib/i18n/use-locale'

// History (§55): the full persisted-execution table. Columns follow the
// Operación priority — Execution, Created, Status, Duration, Mode, Question
// count — with Fidelity and Aligned as secondary (muted) columns. Every row
// deep-links into Operación for that execution; opening history NEVER
// re-executes anything (GET-only, cursor pagination via next_cursor).

type ProblemBody = { title?: string; detail?: string }

type PageState =
  | { kind: 'loading' }
  | { kind: 'loaded'; items: RecentExecutionItem[]; nextCursor: string | null }
  | { kind: 'loading-more'; items: RecentExecutionItem[]; nextCursor: string }
  | { kind: 'error'; problem?: ProblemBody }

export function HistoryView() {
  const { locale, dictionary } = useDictionary()
  const copy = dictionary.history
  const opCopy = dictionary.operation
  const [state, setState] = useState<PageState>({ kind: 'loading' })

  const load = useCallback(async (cursor?: string) => {
    // J2 (dual-review): paginating transitions SYNCHRONOUSLY to loading-more
    // BEFORE the fetch, so the Load more trigger unmounts immediately — a
    // rapid double-click can never start a second fetch for the same cursor
    // and append the page twice. The initial load (no cursor) still starts
    // from the plain loading state.
    if (cursor !== undefined) {
      setState((previous) =>
        previous.kind === 'loaded'
          ? { kind: 'loading-more', items: previous.items, nextCursor: cursor }
          : previous
      )
    }
    const query = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : '?limit=50'
    try {
      const response = await fetch(`/api/v1/executions${query}`, { method: 'GET' })
      const data = (await response.json()) as { items?: RecentExecutionItem[]; next_cursor?: string | null } & ProblemBody
      // An error must never look like empty history (F12 pattern).
      if (!response.ok || !Array.isArray(data.items)) {
        setState({ kind: 'error', problem: { title: data.title, detail: data.detail } })
        return
      }
      setState((previous) => ({
        kind: 'loaded',
        // Append ONLY when paginating (a cursor names the page being fused):
        // the initial load must REPLACE, so a dev StrictMode double-mount of
        // the effect cannot duplicate the first page (E2E Wave A finding).
        items: cursor ? [...(previous.kind === 'loaded' || previous.kind === 'loading-more' ? previous.items : []), ...data.items!] : data.items!,
        nextCursor: data.next_cursor ?? null,
      }))
    } catch {
      setState({ kind: 'error' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const statusWords = opCopy.status as Record<string, string>
  const modeLabels = opCopy.mode as Record<string, string>

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{dictionary.pages.history.title}</h1>
        <p className="max-w-2xl text-muted-foreground">
          {dictionary.pages.history.description}
        </p>
      </div>

      {state.kind === 'loading' ? <p className="text-sm text-muted-foreground">{copy.loadingMore}</p> : null}

      {state.kind === 'error' ? (
        <div className="space-y-1">
          <p className="text-sm text-destructive">{copy.loadFailed}</p>
          {state.problem?.title ? (
            <p className="text-xs text-muted-foreground">
              {state.problem.title}
              {state.problem.detail ? ` — ${state.problem.detail}` : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {(state.kind === 'loaded' || state.kind === 'loading-more') && state.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : null}

      {(state.kind === 'loaded' || state.kind === 'loading-more') && state.items.length > 0 ? (
        <div data-testid="history-results">
          {/* P33 (FB6): dual layout — the §55 table owns ≥ lg; below it, cards
              carry the same row data mobile-first with no horizontal scroll
              (ADR-008#8's sanctioned inner-scroll table is superseded by owner
              preference on mobile). Same data, same §66 classification, same
              /operation navigation — fidelity/aligned stay OUT of the cards
              (§61.2 applies to lists; the table keeps them as secondary §55). */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm" data-testid="history-table">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
                  <th className="px-3 py-2 font-bold" scope="col">
                    {copy.execution}
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    {copy.created}
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    {copy.status}
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    {copy.duration}
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    {copy.mode}
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    {copy.questionCount}
                  </th>
                  {/* §55: semantic metrics stay secondary columns (muted). */}
                  <th className="px-3 py-2 font-bold" scope="col">
                    {copy.fidelity}
                  </th>
                  <th className="px-3 py-2 font-bold" scope="col">
                    {copy.aligned}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {state.items.map((item) => {
                  const status = railStatus(item)
                  return (
                    <tr key={item.execution_id}>
                      <td className="px-3 py-2.5">
                        <Link
                          aria-label={`${copy.execution} ${shortExecutionId(item.execution_id)}`}
                          className="font-mono text-xs underline-offset-4 hover:underline"
                          href={`/operation?execution=${encodeURIComponent(item.execution_id)}`}
                        >
                          #{shortExecutionId(item.execution_id)}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                          new Date(item.created_at)
                        )}
                      </td>
                      <td
                        className={
                          status === 'failed'
                            ? 'px-3 py-2.5 font-medium text-destructive'
                            : status === 'partial'
                              ? 'px-3 py-2.5 font-medium text-warning'
                              : 'px-3 py-2.5 font-medium text-success'
                        }
                      >
                        {statusWords[status] ?? status}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {item.duration_ms !== null
                          ? `${new Intl.NumberFormat(locale).format(item.duration_ms)} ${dictionary.units.milliseconds}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5">{modeLabels[item.mode] ?? item.mode}</td>
                      <td className="px-3 py-2.5">
                        {new Intl.NumberFormat(locale).format(item.question_count)}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {item.overall_fidelity !== null ? formatFidelityPercent(item.overall_fidelity, locale) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {item.aligned_questions !== null
                          ? fill(copy.alignedValue, {
                              aligned: item.aligned_questions,
                              total: item.question_count,
                            })
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm lg:hidden" data-testid="history-cards">
            {/* P36/FB9: wrap-anywhere + min-w-0 — long request-derived labels must wrap, never break the box (§16). */}
            {state.items.map((item) => {
              const status = railStatus(item)
              return (
                <li key={item.execution_id}>
                  <Link
                    aria-label={`${copy.execution} ${shortExecutionId(item.execution_id)} — ${modeLabels[item.mode] ?? item.mode}, ${statusWords[status] ?? status}`}
                    className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-3 py-2.5"
                    href={`/operation?execution=${encodeURIComponent(item.execution_id)}`}
                  >
                    <span className="min-w-0 wrap-anywhere font-mono text-xs">#{shortExecutionId(item.execution_id)}</span>
                    <span className="min-w-0 wrap-anywhere text-muted-foreground">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at))}</span>
                    <span className={`min-w-0 wrap-anywhere ${status === 'failed' ? 'font-medium text-destructive' : status === 'partial' ? 'font-medium text-warning' : 'font-medium text-success'}`}>
                      {statusWords[status] ?? status}
                    </span>
                    <span className="min-w-0 wrap-anywhere font-mono text-xs text-muted-foreground">
                      {item.duration_ms !== null ? `${new Intl.NumberFormat(locale).format(item.duration_ms)} ${dictionary.units.milliseconds}` : '—'}
                    </span>
                    <span className="min-w-0 wrap-anywhere">{modeLabels[item.mode] ?? item.mode}</span>
                    <span className="min-w-0 wrap-anywhere text-muted-foreground">{new Intl.NumberFormat(locale).format(item.question_count)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {state.kind === 'loaded' && state.nextCursor !== null ? (
        <Button
          className="h-11"
          onClick={() => void load(state.nextCursor ?? undefined)}
          type="button"
          variant="outline"
        >
          {copy.loadMore}
        </Button>
      ) : null}
      {state.kind === 'loading-more' ? <p className="text-sm text-muted-foreground">{copy.loadingMore}</p> : null}
    </section>
  )
}

'use client'

import Link from 'next/link'

import { Button } from '../ui/button'
import { shortExecutionId, type RecentExecutionItem } from '../../lib/execution-snapshot'
import {
  applyFilters,
  railStatus,
  type ExecutionFilterRange,
  type ExecutionFilters,
} from '../../lib/operation/derive'
import { fill } from '../../lib/i18n/format'
import type { Dictionary, Locale } from '../../lib/i18n'

// §54.2/§61.2 execution navigator. PROHIBITED in this surface (§61.2):
// fidelity, semantic divergence, AI Judge results, selected Choice, Score
// results, Noul probabilities — only operational fields render. §54.2 rule:
// the rail is always visible on desktop so the user is never trapped in one
// execution.

const RANGE_OPTIONS: Array<{ key: ExecutionFilterRange; label: keyof Dictionary['operation']['rail'] }> = [
  { key: 'all', label: 'rangeAll' },
  { key: 'today', label: 'rangeToday' },
  { key: '7d', label: 'range7d' },
  { key: '30d', label: 'range30d' },
]

// Search + status + range controls, shared 1:1 by the desktop rail and the
// §61.7 mobile drawer so both navigators filter identically.
export function ExecutionFiltersControls({
  dictionary,
  filters,
  onChange,
}: {
  dictionary: Dictionary['operation']
  filters: ExecutionFilters
  onChange: (next: ExecutionFilters) => void
}) {
  const copy = dictionary.rail
  return (
    <div className="space-y-2">
      <input
        aria-label={copy.searchLabel}
        className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-base"
        data-testid="execution-search"
        onChange={(event) => onChange({ ...filters, query: event.target.value })}
        placeholder={copy.searchPlaceholder}
        type="search"
        value={filters.query}
      />
      <div className="flex flex-wrap gap-1" role="group">
        {(['all', 'completed', 'failed'] as const).map((status) => (
          <Button
            aria-pressed={filters.status === status}
            key={status}
            onClick={() => onChange({ ...filters, status })}
            size="sm"
            type="button"
            variant={filters.status === status ? 'default' : 'outline'}
          >
            {status === 'all'
              ? copy.statusAll
              : status === 'completed'
                ? dictionary.status.completed
                : dictionary.status.failed}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1" role="group">
        {RANGE_OPTIONS.map((option) => (
          <Button
            aria-pressed={filters.range === option.key}
            key={option.key}
            onClick={() => onChange({ ...filters, range: option.key })}
            size="sm"
            type="button"
            variant={filters.range === option.key ? 'default' : 'outline'}
          >
            {copy[option.label] as string}
          </Button>
        ))}
      </div>
    </div>
  )
}

// One operational row: #shortId · HH:MM · status word · duration · "3q".
export function ExecutionRowList({
  dictionary,
  filters,
  items,
  locale,
  onSelect,
  selectedId,
  units,
}: {
  dictionary: Dictionary['operation']
  filters: ExecutionFilters
  items: RecentExecutionItem[]
  locale: Locale
  onSelect: (item: RecentExecutionItem) => void
  selectedId: string | null
  units: Dictionary['units']
}) {
  const visible = applyFilters(items, filters)
  const statusWords = dictionary.status as Record<string, string>

  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">{dictionary.rail.empty}</p>
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-sm">
      {visible.map((item) => {
        const status = railStatus(item)
        return (
          <li key={item.execution_id}>
            <button
              aria-current={item.execution_id === selectedId ? 'true' : undefined}
              className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-muted/50 aria-[current=true]:bg-muted"
              data-testid={`rail-row-${item.execution_id}`}
              onClick={() => onSelect(item)}
              type="button"
            >
              <span className="font-mono text-xs">#{shortExecutionId(item.execution_id)}</span>
              <span className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(
                  new Date(item.created_at)
                )}
              </span>
              <span
                className={
                  status === 'failed'
                    ? 'font-medium text-destructive'
                    : status === 'partial'
                      ? 'font-medium text-warning'
                      : 'font-medium text-success'
                }
              >
                {statusWords[status] ?? status}
              </span>
              {item.duration_ms !== null ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {new Intl.NumberFormat(locale).format(item.duration_ms)} {units.milliseconds}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {fill(dictionary.rail.questionCount, { count: item.question_count })}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// Desktop sidebar (§61 wireframe left column). The mobile navigator lives in
// OperationView's Bottom Drawer and reuses the controls above.
export function ExecutionRail({
  dictionary,
  filters,
  listState,
  locale,
  onChangeFilters,
  onSelect,
  selectedId,
  units,
}: {
  dictionary: Dictionary['operation']
  filters: ExecutionFilters
  listState:
    | { kind: 'loading' }
    | { kind: 'loaded'; items: RecentExecutionItem[] }
    | { kind: 'error'; problem?: { title?: string; detail?: string } }
  locale: Locale
  onChangeFilters: (next: ExecutionFilters) => void
  onSelect: (item: RecentExecutionItem) => void
  selectedId: string | null
  units: Dictionary['units']
}) {
  return (
    <aside className="space-y-3" data-testid="execution-rail">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.rail.title}</p>
      <ExecutionFiltersControls dictionary={dictionary} filters={filters} onChange={onChangeFilters} />
      {listState.kind === 'loading' ? (
        <p className="text-sm text-muted-foreground">{dictionary.listLoading}</p>
      ) : null}
      {listState.kind === 'error' ? (
        <div className="space-y-1">
          <p className="text-sm text-destructive">{dictionary.listLoadFailed}</p>
          {listState.problem?.title ? (
            <p className="text-xs text-muted-foreground">
              {listState.problem.title}
              {listState.problem.detail ? ` — ${listState.problem.detail}` : ''}
            </p>
          ) : null}
        </div>
      ) : null}
      {listState.kind === 'loaded' && listState.items.length > 0 ? (
        <ExecutionRowList
          dictionary={dictionary}
          filters={filters}
          items={listState.items}
          locale={locale}
          onSelect={onSelect}
          selectedId={selectedId}
          units={units}
        />
      ) : null}
      {listState.kind === 'loaded' && listState.items.length === 0 ? (
        /* A genuinely empty repository — distinct from "no filter matches"
           (rail.empty inside ExecutionRowList). */
        <p className="text-sm text-muted-foreground">{dictionary.emptyHistory}</p>
      ) : null}
      <Link className="block text-sm font-medium underline-offset-4 hover:underline" href="/history">
        {dictionary.rail.viewMore}
      </Link>
    </aside>
  )
}

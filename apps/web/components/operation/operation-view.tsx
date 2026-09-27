'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { BottomDrawer } from '../principal/bottom-drawer'
import { ExecutionFiltersControls, ExecutionRail, ExecutionRowList } from './execution-rail'
import { FlowDiagram } from './flow-diagram'
import { InfoPanel } from './info-panel'
import { LatencyBars } from './latency-bars'
import { LogPanel } from './log-panel'
import { SummaryPanel } from './summary-panel'
import type { ExecutionSnapshot, RecentExecutionItem } from '../../lib/execution-snapshot'
import { shortExecutionId } from '../../lib/execution-snapshot'
import type { ExecutionFilters } from '../../lib/operation/derive'
import { fill } from '../../lib/i18n/format'
import { useDictionary } from '../../lib/i18n/use-locale'
import { clearSessionCase, readSessionCase, setSessionCase } from '../../lib/session-case'

// Operación (plan sections 54.2, 60-61.7): the operational surface over the
// PERSISTED history. It answers "Did the system execute correctly?" — never
// semantic metrics (§70). Opening an execution only ever GETs the stored
// snapshot: historical open does not rerun providers (§61.2).

type ProblemBody = { title?: string; detail?: string }

type ListState =
  | { kind: 'loading' }
  | { kind: 'loaded'; items: RecentExecutionItem[] }
  | { kind: 'error'; problem?: ProblemBody }

type DetailState =
  | { kind: 'idle' }
  | { kind: 'loading'; executionId: string }
  | { kind: 'loaded'; snapshot: ExecutionSnapshot }
  | { kind: 'not-found'; executionId: string }
  | { kind: 'error'; problem?: ProblemBody }

const NO_FILTERS: ExecutionFilters = { query: '', status: 'all', range: 'all' }

export function OperationView() {
  const { locale, dictionary } = useDictionary()
  const copy = dictionary.operation
  const router = useRouter()
  const searchParams = useSearchParams()
  const deepLinkId = searchParams.get('execution')

  const [listState, setListState] = useState<ListState>({ kind: 'loading' })
  const [detailState, setDetailState] = useState<DetailState>({ kind: 'idle' })
  const [filters, setFilters] = useState<ExecutionFilters>(NO_FILTERS)
  // P45 (W6): bumped when a session-case selection discards silently — the
  // initial-selection effect below watches it so the normal most-recent
  // selection takes over after the case could not be loaded.
  const [selectionEpoch, setSelectionEpoch] = useState(0)

  // Load the navigator list once on mount (§54.2, initial limit 50).
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const response = await fetch('/api/v1/executions?limit=50', { method: 'GET' })
        const data = (await response.json()) as { items?: RecentExecutionItem[] } & ProblemBody
        if (!active) return
        // An error must never look like empty history (F12 pattern).
        if (!response.ok || !Array.isArray(data.items)) {
          setListState({ kind: 'error', problem: { title: data.title, detail: data.detail } })
          return
        }
        setListState({ kind: 'loaded', items: data.items })
      } catch {
        if (active) setListState({ kind: 'error' })
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  // GET the persisted snapshot for one execution — the ONLY way this surface
  // touches an execution (never POST). Rapid selections resolve out of order:
  // only the LATEST call may touch the detail state, so a stale response can
  // never swap the central view away from the URL's execution.
  // P45 (T1.2/T1.3/W6): `remember` marks seteo origins (the deep link and
  // the session case) — a load that LANDS sets the session case. `silent`
  // marks the session-case origin on FAILURE: no error surface, the session
  // entry is cleared and the normal selection takes over instead.
  const loadSequence = useRef(0)
  const loadExecution = useCallback(
    async (executionId: string, options: { silent?: boolean; remember?: boolean } = {}) => {
      const sequence = ++loadSequence.current
      // P45 (W6): the silent discard — nobody asked for the session case
      // explicitly, so its failure speaks nothing and resets the selection.
      const discardSessionCase = () => {
        clearSessionCase()
        setDetailState({ kind: 'idle' })
        setSelectionEpoch((epoch) => epoch + 1)
      }
      setDetailState({ kind: 'loading', executionId })
      try {
        const response = await fetch(`/api/v1/executions/${encodeURIComponent(executionId)}`, {
          method: 'GET',
        })
        if (sequence !== loadSequence.current) return
        if (response.status === 404) {
          if (options.silent) {
            discardSessionCase()
            return
          }
          setDetailState({ kind: 'not-found', executionId })
          return
        }
        const data = (await response.json()) as ExecutionSnapshot & ProblemBody
        if (sequence !== loadSequence.current) return
        if (!response.ok) {
          if (options.silent) {
            discardSessionCase()
            return
          }
          setDetailState({ kind: 'error', problem: { title: data.title, detail: data.detail } })
          return
        }
        // P45 (T1.2): a hydration that LANDS sets the session case (the
        // param's landing re-sets it; the session's own re-set is
        // idempotent). Rail selections deliberately do NOT — T1.2's seteo
        // list is exhaustive.
        if (options.remember) setSessionCase(executionId)
        setDetailState({ kind: 'loaded', snapshot: data })
      } catch {
        if (sequence !== loadSequence.current) return
        if (options.silent) {
          discardSessionCase()
          return
        }
        setDetailState({ kind: 'error' })
      }
    },
    []
  )

  // The ?execution= deep link owns detail loads whenever it names an
  // execution this view has not already loaded — covering both the initial
  // mount and later back/forward navigations. It stays quiet after a rail
  // selection because handleSelect marks the mirrored id as handled.
  const handledDeepLink = useRef<string | null>(null)
  useEffect(() => {
    if (!deepLinkId || deepLinkId === handledDeepLink.current) return
    handledDeepLink.current = deepLinkId
    void loadExecution(deepLinkId, { remember: true })
  }, [deepLinkId, loadExecution])

  // P45 (T1.3): latest-ref view of loadExecution (Principal's
  // selectExecutionRef idiom) — the session consumption below fires through
  // the ref as a stable one-shot, independent of loadExecution's identity.
  const loadExecutionRef = useRef(loadExecution)
  useEffect(() => {
    loadExecutionRef.current = loadExecution
  })

  // P45 (T1.3): without a deep link, the session case selects at mount
  // exactly as if the param had named it — the same loadExecution funnel,
  // GET only, silent on failure (W6). One-shot per mount; the explicit param
  // ALWAYS wins. W7: the storage read lives in the effect, never in render.
  const sessionSelectedRef = useRef(false)
  useEffect(() => {
    if (deepLinkId || sessionSelectedRef.current) return
    sessionSelectedRef.current = true
    const stored = readSessionCase()
    if (stored) void loadExecutionRef.current(stored, { silent: true, remember: true })
  }, [deepLinkId])

  // Initial selection WITHOUT a deep link: the most recent execution once the
  // list arrives. While a session-case selection is in flight the detail
  // state is 'loading', so the idle gate below keeps this quiet.
  useEffect(() => {
    if (deepLinkId) return
    if (detailState.kind === 'idle' && listState.kind === 'loaded' && listState.items.length > 0) {
      void loadExecution(listState.items[0].execution_id)
    }
    // detailState is intentionally not a dependency: this effect only seeds
    // the FIRST selection while the view is still idle. selectionEpoch
    // (P45/W6) re-arms the seeding after a silent session-case discard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId, listState, loadExecution, selectionEpoch])

  // Selecting a rail row swaps the central snapshot and mirrors the deep link
  // in the URL (shareable) without a navigation.
  function handleSelect(item: RecentExecutionItem) {
    // Mark the mirrored id as handled so the deep-link effect above stays
    // quiet when the URL catches up with this selection.
    handledDeepLink.current = item.execution_id
    void loadExecution(item.execution_id)
    router.replace(`/operation?execution=${encodeURIComponent(item.execution_id)}`, { scroll: false })
  }

  const selectedId =
    detailState.kind === 'loaded'
      ? detailState.snapshot.execution_id
      : detailState.kind === 'loading' || detailState.kind === 'not-found'
        ? detailState.executionId
        : null
  const snapshot = detailState.kind === 'loaded' ? detailState.snapshot : null

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{dictionary.pages.operation.title}</h1>
        <p className="max-w-2xl text-muted-foreground">
          {dictionary.pages.operation.description}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)_300px]">
        {/* §61 desktop left column: the always-visible navigator (§54.2 — the
            user is never trapped in one execution). */}
        <div className="hidden lg:block">
          <ExecutionRail
            dictionary={copy}
            filters={filters}
            listState={listState}
            locale={locale}
            onChangeFilters={setFilters}
            onSelect={handleSelect}
            selectedId={selectedId}
            units={dictionary.units}
          />
        </div>

        {/* Central snapshot */}
        <div className="space-y-5" data-testid="operation-central">
          {detailState.kind === 'idle' && listState.kind === 'loaded' && listState.items.length === 0 ? (
            /* Honest idle state: an empty repository is not a load that can
               still finish — no detail fetch will ever arrive. */
            <p className="text-sm text-muted-foreground" data-testid="operation-empty-history">
              {copy.emptyHistory}
            </p>
          ) : detailState.kind === 'idle' || detailState.kind === 'loading' ? (
            <p className="text-sm text-muted-foreground">{copy.loading}</p>
          ) : null}
          {detailState.kind === 'not-found' ? (
            <p className="text-sm text-muted-foreground">{copy.loadFailed}</p>
          ) : null}
          {detailState.kind === 'error' ? (
            <div className="space-y-1">
              <p className="text-sm text-destructive">{copy.loadFailed}</p>
              {detailState.problem?.title ? (
                <p className="text-xs text-muted-foreground">
                  {detailState.problem.title}
                  {detailState.problem.detail ? ` — ${detailState.problem.detail}` : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* §61.7 mobile: single column — the navigator opens from a trigger
              ABOVE the summary; no permanent sidebar. Rendered whenever the
              LIST is loaded, independent of the detail state: a 404/stale
              deep link or a detail error must never trap the mobile user
              (§54.2 — the desktop rail is hidden below lg). */}
          {listState.kind === 'loaded' ? (
            <div className="lg:hidden">
              <BottomDrawer
                closeLabel={copy.mobile.close}
                label={
                  selectedId
                    ? `${fill(copy.mobile.selectExecution, { id: shortExecutionId(selectedId) })} ▾`
                    : `${copy.mobile.selectExecutionFallback} ▾`
                }
                title={copy.mobile.drawerTitle}
              >
                <div className="space-y-3">
                  {selectedId ? (
                    <div className="space-y-1" data-testid="drawer-current-execution">
                      <p className="text-xs font-bold tracking-widest text-muted-foreground">
                        {copy.mobile.currentExecution}
                      </p>
                      <p className="font-mono text-sm">#{shortExecutionId(selectedId)}</p>
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    <p className="text-xs font-bold tracking-widest text-muted-foreground">
                      {copy.mobile.previousExecutions}
                    </p>
                    <ExecutionFiltersControls dictionary={copy} filters={filters} onChange={setFilters} />
                    <ExecutionRowList
                      dictionary={copy}
                      filters={filters}
                      items={listState.items}
                      locale={locale}
                      onSelect={handleSelect}
                      selectedId={selectedId}
                      units={dictionary.units}
                    />
                  </div>
                </div>
              </BottomDrawer>
            </div>
          ) : null}

          {snapshot ? (
            <>
              <h2 className="text-xl font-bold tracking-tight" data-testid="operation-central-header">
                {fill(copy.executionHeading, { id: shortExecutionId(snapshot.execution_id) })}
              </h2>
              <SummaryPanel
                dictionary={copy}
                locale={locale}
                snapshot={snapshot}
                units={dictionary.units}
              />
              <FlowDiagram
                dictionary={copy}
                locale={locale}
                snapshot={snapshot}
                units={dictionary.units}
              />
              <LatencyBars
                dictionary={copy}
                locale={locale}
                snapshot={snapshot}
                units={dictionary.units}
              />
              <LogPanel dictionary={copy} snapshot={snapshot} />
            </>
          ) : null}
        </div>

        {/* §61 right column: identity + actions. On mobile (< lg) the single
            column stacks it after the central panels — that stacked InfoPanel
            is what carries the §61.7 "View in Investigación" action. */}
        {snapshot ? (
          <div className="lg:block">
            <InfoPanel dictionary={copy} locale={locale} snapshot={snapshot} />
          </div>
        ) : null}
      </div>
    </section>
  )
}

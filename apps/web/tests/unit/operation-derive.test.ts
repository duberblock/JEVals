import { describe, expect, it } from 'vitest'

import type { RecentExecutionItem } from '../../lib/execution-snapshot'
import {
  applyFilters,
  flowNodes,
  latencyBars,
  operationalLog,
  operationalSummary,
  railStatus,
  retryInfo,
} from '../../lib/operation/derive'
import { emulatorSnapshot as emulatorOnlySnapshot } from '../fixtures/investigation-snapshot'
import {
  emulatorFailedSnapshot,
  independentFailedSnapshot,
  jevFailedSnapshot,
  judgeFailedSnapshot,
  oldSnapshot,
  operationalSnapshot,
  OPERATION_RUN_ID,
  railItem,
} from '../fixtures/operation-snapshots'

const DAY_MS = 86_400_000

// A fixed "now" for range-filter boundary tests (timezone-independent because
// every candidate date is derived from it in local time).
const NOW = Date.parse('2026-09-21T12:00:00')
function localTodayAt(hour: number, minute = 0): string {
  const base = new Date(NOW)
  base.setHours(hour, minute, 0, 0)
  return base.toISOString()
}
const TODAY_START = new Date(NOW)
TODAY_START.setHours(0, 0, 0, 0)
const YESTERDAY_LATE = new Date(TODAY_START.getTime() - 1).toISOString()

describe('operationalSummary (§61.1)', () => {
  it('summarizes a fully successful compare-and-evaluate run with the independent prediction', () => {
    const summary = operationalSummary(operationalSnapshot())
    expect(summary).toEqual({
      status: 'completed',
      totalMs: 2500,
      questions: { processed: 3, total: 3 },
      providers: { completed: 3, total: 3 },
      aiEvaluation: 'success',
      persistence: 'ok',
    })
  })

  it('maps a failed snapshot status to failed', () => {
    expect(operationalSummary(emulatorFailedSnapshot()).status).toBe('failed')
  })

  // §66 partial classification (J2): a completed run with ANY executed leg
  // failed classifies as partial — the same tally class as the providers
  // count over delivered sections, not a domain recomputation.
  it('classifies a §66 judge failure as partial in the summary', () => {
    expect(operationalSummary(judgeFailedSnapshot()).status).toBe('partial')
  })

  it('classifies a §66 independent failure as partial in the summary', () => {
    expect(operationalSummary(independentFailedSnapshot()).status).toBe('partial')
  })

  it('classifies a §66 JEV failure as partial in the summary', () => {
    expect(operationalSummary(jevFailedSnapshot()).status).toBe('partial')
  })

  it('keeps a fully successful run completed in the summary', () => {
    expect(operationalSummary(operationalSnapshot()).status).toBe('completed')
  })

  it('counts only the answers the emulator actually produced when it succeeded', () => {
    const snapshot = operationalSnapshot()
    snapshot.emulator!.result!.answers = {
      request_type: snapshot.emulator!.result!.answers!.request_type,
    }
    expect(operationalSummary(snapshot).questions).toEqual({ processed: 1, total: 3 })
  })

  it('reports zero processed questions when the emulator failed (never invented)', () => {
    expect(operationalSummary(emulatorFailedSnapshot()).questions).toEqual({ processed: 0, total: 3 })
  })

  it('tallies providers only over present sections (emulator + jev + independent_openai)', () => {
    expect(operationalSummary(operationalSnapshot()).providers).toEqual({ completed: 3, total: 3 })
  })

  // §66 JEV failure: emulator ✓, JEV failed → providers 1 / 2 (the failed
  // section still counts as a provider row), fidelity and judge absent.
  it('counts the failed JEV section in the provider tally (§66)', () => {
    expect(operationalSummary(jevFailedSnapshot()).providers).toEqual({ completed: 1, total: 2 })
  })

  // §66 independent failure: emulator + JEV succeeded, independent failed.
  it('counts the failed independent section in the provider tally (§66)', () => {
    expect(operationalSummary(independentFailedSnapshot()).providers).toEqual({ completed: 2, total: 3 })
  })

  it('never counts ai_evaluation as a provider row (§66 lists it separately)', () => {
    const summary = operationalSummary(operationalSnapshot())
    expect(summary.providers.total).toBe(3)
    expect(summary.aiEvaluation).toBe('success')
  })

  it('reports aiEvaluation failed when the judge section is present and failed (§66)', () => {
    expect(operationalSummary(judgeFailedSnapshot()).aiEvaluation).toBe('failed')
  })

  it("reports aiEvaluation not-run when the section is absent (evaluate-mode absent = not-run)", () => {
    expect(operationalSummary(jevFailedSnapshot()).aiEvaluation).toBe('not-run')
  })

  it('reports null total time when runtime.duration_ms is absent', () => {
    const snapshot = operationalSnapshot()
    delete snapshot.runtime
    expect(operationalSummary(snapshot).totalMs).toBe(null)
  })
})

describe('railStatus (§61.2 — thin mapper over the API-delivered classification)', () => {
  it('maps the delivered failed classification', () => {
    expect(railStatus(railItem({ status: 'failed', operational_status: 'failed' }))).toBe('failed')
  })

  it('maps the delivered completed classification without inferring from fidelity', () => {
    // A compare row without fidelity whose API classification says completed
    // renders completed — the web no longer re-derives the §66 signature.
    expect(railStatus(railItem({ mode: 'compare', overall_fidelity: null, operational_status: 'completed' }))).toBe(
      'completed'
    )
  })

  it('classifies the §66 JEV-failure row as partial (delivered)', () => {
    expect(
      railStatus(railItem({ mode: 'compare', overall_fidelity: null, operational_status: 'partial' }))
    ).toBe('partial')
  })

  it('classifies the §66 independent-failure row as Partial (NEW behavior — was Completed)', () => {
    // The independent leg failed after the comparison succeeded, so the row
    // carries fidelity AND the API partial classification.
    expect(
      railStatus(railItem({ mode: 'compare-and-evaluate', overall_fidelity: 0.95, operational_status: 'partial' }))
    ).toBe('partial')
  })

  it('classifies the §66 judge-failure row as Partial (NEW behavior — was Completed)', () => {
    expect(
      railStatus(railItem({ mode: 'compare-and-evaluate', overall_fidelity: 0.95, operational_status: 'partial' }))
    ).toBe('partial')
  })

  it('keeps an emulator-mode success row completed', () => {
    expect(railStatus(railItem({ mode: 'emulator', overall_fidelity: null, operational_status: 'completed' }))).toBe(
      'completed'
    )
  })
})

describe('flowNodes (§61.3 honest parallel group)', () => {
  it('returns the §65 order with the parallel members structurally marked', () => {
    const nodes = flowNodes(operationalSnapshot())
    expect(nodes.map((node) => node.key)).toEqual([
      'request_validation',
      'emulator',
      'jev',
      'independent_openai',
      'fidelity',
      'ai_judge',
      'persistence',
    ])
    const parallel = nodes.filter((node) => node.parallel)
    expect(parallel.map((node) => node.key)).toEqual(['emulator', 'jev', 'independent_openai'])
  })

  it('marks only the failed component as failed and everything else success', () => {
    const nodes = flowNodes(independentFailedSnapshot())
    expect(nodes.find((node) => node.key === 'independent_openai')?.status).toBe('failed')
    expect(nodes.filter((node) => node.status === 'success').map((node) => node.key)).toEqual([
      'request_validation',
      'emulator',
      'jev',
      'fidelity',
      'ai_judge',
    ])
  })

  it('ends with persistence as ok even for a failed execution', () => {
    const nodes = flowNodes(emulatorFailedSnapshot())
    expect(nodes[nodes.length - 1]).toEqual({
      key: 'persistence',
      ran: true,
      status: 'ok',
      durationMs: null,
      parallel: undefined,
    })
  })

  it('omits fidelity and ai_judge entirely when JEV failed (§66 — never fake skipped nodes)', () => {
    const keys = flowNodes(jevFailedSnapshot()).map((node) => node.key)
    expect(keys).not.toContain('fidelity')
    expect(keys).not.toContain('ai_judge')
    expect(keys).toEqual(['request_validation', 'emulator', 'jev', 'persistence'])
  })

  it('omits the jev node when the section is absent (emulator-mode snapshot)', () => {
    const keys = flowNodes(emulatorOnlySnapshot()).map((node) => node.key)
    expect(keys).not.toContain('jev')
    // The §11 advanced independent prediction still ran in this emulator run.
    expect(keys).toEqual(['request_validation', 'emulator', 'independent_openai', 'persistence'])
  })

  it('carries per-component duration only when the timing is present', () => {
    const byKey = Object.fromEntries(flowNodes(operationalSnapshot()).map((node) => [node.key, node.durationMs]))
    expect(byKey).toEqual({
      request_validation: 12,
      emulator: 62,
      jev: 71,
      independent_openai: 43,
      fidelity: 5,
      ai_judge: 8,
      persistence: null,
    })
  })

  it('returns null durations for every node when timings are absent (old snapshot)', () => {
    const nodes = flowNodes(oldSnapshot())
    expect(nodes.every((node) => node.durationMs === null)).toBe(true)
  })

  it('keeps a failed component timed — failure does not erase latency', () => {
    expect(flowNodes(jevFailedSnapshot()).find((node) => node.key === 'jev')?.durationMs).toBe(120000)
  })
})

describe('latencyBars (§61.4 absolute ms, flow order)', () => {
  it('orders bars in flow order regardless of the timings object order', () => {
    const snapshot = operationalSnapshot()
    snapshot.provenance = {
      timings: {
        ai_judge_ms: 8,
        emulator_ms: 62,
        request_validation_ms: 12,
        fidelity_ms: 5,
        independent_openai_ms: 43,
        jev_ms: 71,
      },
    }
    expect(latencyBars(snapshot)).toEqual([
      { key: 'request_validation', ms: 12 },
      { key: 'emulator', ms: 62 },
      { key: 'jev', ms: 71 },
      { key: 'independent_openai', ms: 43 },
      { key: 'fidelity', ms: 5 },
      { key: 'ai_judge', ms: 8 },
    ])
  })

  it('returns an empty array for old snapshots without timings', () => {
    expect(latencyBars(oldSnapshot())).toEqual([])
  })

  it('omits timings for components that were never invoked (§66 JEV failure)', () => {
    const bars = latencyBars(jevFailedSnapshot())
    expect(bars.map((bar) => bar.key)).toEqual(['request_validation', 'emulator', 'jev'])
  })

  it('ignores malformed timing values instead of rendering them', () => {
    const snapshot = operationalSnapshot()
    snapshot.provenance = { timings: { emulator_ms: -5, jev_ms: Number.NaN } }
    expect(latencyBars(snapshot)).toEqual([])
  })
})

describe('retryInfo (independent only — §61.4 never invent)', () => {
  it('derives zero retries from a single attempt', () => {
    const snapshot = operationalSnapshot()
    expect(retryInfo(snapshot, 'independent_openai')).toEqual({ attempts: 1, retries: 0 })
  })

  it('derives N-1 retries from N attempts', () => {
    expect(retryInfo(independentFailedSnapshot(), 'independent_openai')).toEqual({ attempts: 3, retries: 2 })
  })

  it('returns null attempts when llm_attempts is absent', () => {
    const snapshot = operationalSnapshot()
    snapshot.independent_openai = { status: 'success', model: 'gpt-4o-mini' }
    expect(retryInfo(snapshot, 'independent_openai')).toEqual({ attempts: null, retries: null })
  })

  it('returns null attempts for an EMPTY llm_attempts array — 0 attempts means not computed (§61.4 never invent)', () => {
    const snapshot = operationalSnapshot()
    snapshot.independent_openai = { status: 'success', model: 'gpt-4o-mini', llm_attempts: [] }
    expect(retryInfo(snapshot, 'independent_openai')).toEqual({ attempts: null, retries: null })
  })

  it('returns null for every other component — no retry mechanism exists', () => {
    const snapshot = operationalSnapshot()
    for (const component of ['request_validation', 'emulator', 'jev', 'fidelity', 'ai_judge'] as const) {
      expect(retryInfo(snapshot, component)).toEqual({ attempts: null, retries: null })
    }
  })
})

describe('operationalLog (§61.5 / §69 — derived only from the persisted snapshot)', () => {
  it('opens with a §69 completion line carrying the operational facts', () => {
    const [completion] = operationalLog(operationalSnapshot())
    expect(completion).toMatchObject({
      component: 'execution',
      event: 'completed',
      level: 'info',
      traceId: OPERATION_RUN_ID,
      timestamp: operationalSnapshot().created_at,
      durationMs: 2500,
      mode: 'compare-and-evaluate',
      questionCount: 3,
      comparison: 'available',
    })
  })

  it('reports comparison=unavailable when the JEV side failed (§66)', () => {
    const [completion] = operationalLog(jevFailedSnapshot())
    expect(completion.comparison).toBe('unavailable')
  })

  it('reports comparison=unavailable for runs that never owed one (emulator mode)', () => {
    const snapshot = operationalSnapshot()
    snapshot.mode = 'emulator'
    snapshot.comparison = undefined
    expect(operationalLog(snapshot)[0].comparison).toBe('unavailable')
  })

  it('marks the completion line as error level when the execution failed', () => {
    const [completion] = operationalLog(emulatorFailedSnapshot())
    expect(completion.level).toBe('error')
    expect(completion.event).toBe('failed')
  })

  it('emits one line per invoked component with its duration and the independent retries', () => {
    const lines = operationalLog(operationalSnapshot())
    expect(lines.slice(1).map((line) => line.component)).toEqual([
      'request_validation',
      'emulator',
      'jev',
      'independent_openai',
      'fidelity',
      'ai_judge',
    ])
    expect(lines.find((line) => line.component === 'request_validation')).toMatchObject({
      event: 'success',
      durationMs: 12,
      retries: null,
    })
    expect(lines.find((line) => line.component === 'independent_openai')).toMatchObject({
      event: 'success',
      durationMs: 43,
      retries: 0,
    })
  })

  it('carries the sanitized section error verbatim on failure lines', () => {
    const lines = operationalLog(judgeFailedSnapshot())
    expect(lines.find((line) => line.component === 'ai_judge')).toMatchObject({
      level: 'error',
      event: 'failed',
      durationMs: 400,
      error: 'Judge schema parse failed',
    })
  })

  it('never emits lines for components that did not run (§66 JEV failure)', () => {
    const components = operationalLog(jevFailedSnapshot()).map((line) => line.component)
    expect(components).toEqual(['execution', 'request_validation', 'emulator', 'jev'])
  })

  it('carries no payload beyond the snapshot-derived log fields — no secrets by construction', () => {
    const allowed = new Set([
      'timestamp',
      'level',
      'component',
      'event',
      'traceId',
      'durationMs',
      'retries',
      'error',
      'mode',
      'questionCount',
      'comparison',
    ])
    for (const line of operationalLog(independentFailedSnapshot())) {
      for (const key of Object.keys(line)) {
        expect(allowed.has(key)).toBe(true)
      }
    }
  })

  it('keeps component lines but carries null durations for an old snapshot without timings', () => {
    const lines = operationalLog(oldSnapshot())
    expect(lines.map((line) => line.component)).toEqual([
      'execution',
      'request_validation',
      'emulator',
      'jev',
      'independent_openai',
      'fidelity',
      'ai_judge',
    ])
    // The execution line keeps its runtime duration; only the COMPONENT lines
    // lose theirs (no timings on old snapshots).
    expect(lines[0].durationMs).toBe(2500)
    expect(lines.slice(1).every((line) => line.durationMs === null)).toBe(true)
  })
})

describe('applyFilters', () => {
  const items: RecentExecutionItem[] = [
    railItem({ execution_id: 'run_alpha00000001', status: 'completed', mode: 'compare', overall_fidelity: 0.9 }),
    railItem({ execution_id: 'run_beta000000002', status: 'failed', mode: 'emulator', overall_fidelity: null }),
    // Completed compare without fidelity — partial row (§66).
    railItem({ execution_id: 'run_gamma00000003', status: 'completed', mode: 'compare', overall_fidelity: null }),
  ]
  const noFilters = { query: '', status: 'all' as const, range: 'all' as const }

  it('matches the query as a case-insensitive execution_id substring', () => {
    const filtered = applyFilters(items, { ...noFilters, query: 'ALPHA' }, NOW)
    expect(filtered.map((item) => item.execution_id)).toEqual(['run_alpha00000001'])
  })

  it('keeps every row for a blank query', () => {
    expect(applyFilters(items, { ...noFilters, query: '   ' }, NOW)).toHaveLength(3)
  })

  it('counts partial rows as completed for the status filter', () => {
    const filtered = applyFilters(items, { ...noFilters, status: 'completed' }, NOW)
    expect(filtered.map((item) => item.execution_id)).toEqual(['run_alpha00000001', 'run_gamma00000003'])
  })

  it('filters failed rows only', () => {
    const filtered = applyFilters(items, { ...noFilters, status: 'failed' }, NOW)
    expect(filtered.map((item) => item.execution_id)).toEqual(['run_beta000000002'])
  })

  it('keeps rows created today and excludes the last millisecond of yesterday', () => {
    const today = [railItem({ execution_id: 'run_today00000001', created_at: localTodayAt(0, 0) }), railItem({ execution_id: 'run_today00000002', created_at: localTodayAt(23, 59) })]
    const yesterday = [railItem({ execution_id: 'run_yest000000001', created_at: YESTERDAY_LATE })]
    const filtered = applyFilters([...today, ...yesterday], { ...noFilters, range: 'today' }, NOW)
    expect(filtered.map((item) => item.execution_id)).toEqual(['run_today00000001', 'run_today00000002'])
  })

  it('includes the exact 7-day boundary and excludes one millisecond earlier', () => {
    const edge = railItem({ execution_id: 'run_edge000000001', created_at: new Date(NOW - 7 * DAY_MS).toISOString() })
    const before = railItem({ execution_id: 'run_before00000001', created_at: new Date(NOW - 7 * DAY_MS - 1).toISOString() })
    const filtered = applyFilters([edge, before], { ...noFilters, range: '7d' }, NOW)
    expect(filtered.map((item) => item.execution_id)).toEqual(['run_edge000000001'])
  })

  it('includes the exact 30-day boundary and excludes one millisecond earlier', () => {
    const edge = railItem({ execution_id: 'run_edge000000001', created_at: new Date(NOW - 30 * DAY_MS).toISOString() })
    const before = railItem({ execution_id: 'run_before00000001', created_at: new Date(NOW - 30 * DAY_MS - 1).toISOString() })
    const filtered = applyFilters([edge, before], { ...noFilters, range: '30d' }, NOW)
    expect(filtered.map((item) => item.execution_id)).toEqual(['run_edge000000001'])
  })

  it('keeps rows with unparsable created_at only when no range filter is active (never invent)', () => {
    const broken = railItem({ execution_id: 'run_broken0000001', created_at: 'not-a-date' })
    expect(applyFilters([broken], noFilters, NOW)).toHaveLength(1)
    expect(applyFilters([broken], { ...noFilters, range: 'today' }, NOW)).toHaveLength(0)
  })

  it('combines query, status and range conjunctively', () => {
    const filtered = applyFilters(items, { query: 'gamma', status: 'failed', range: 'all' }, NOW)
    expect(filtered).toEqual([])
  })
})

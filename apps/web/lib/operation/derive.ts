// Pure derivations for the Operación surface (plan sections 60-61.7, 66, 70).
// Every function answers ONLY "did the system execute correctly?" — semantic
// metrics (fidelity, divergence, AI verdicts) belong to Principal/Investigación
// and never appear here (§70 view boundaries). All derivations read the
// persisted snapshot verbatim: nothing is re-run, re-derived or invented.
import type {
  ComponentTimingKey,
  ExecutionSnapshot,
  RecentExecutionItem,
} from '../execution-snapshot'

// Component identity without the timing suffix — shared by flow nodes, bars
// and log lines so one dictionary section labels all three.
export type OperationalComponent =
  | 'request_validation'
  | 'emulator'
  | 'jev'
  | 'independent_openai'
  | 'fidelity'
  | 'ai_judge'

export type FlowNodeKey = OperationalComponent | 'persistence'

const COMPONENT_ORDER: readonly OperationalComponent[] = [
  'request_validation',
  'emulator',
  'jev',
  'independent_openai',
  'fidelity',
  'ai_judge',
]

const TIMING_KEY_BY_COMPONENT: Record<OperationalComponent, ComponentTimingKey> = {
  request_validation: 'request_validation_ms',
  emulator: 'emulator_ms',
  jev: 'jev_ms',
  independent_openai: 'independent_openai_ms',
  fidelity: 'fidelity_ms',
  ai_judge: 'ai_judge_ms',
}

function timingOf(snapshot: ExecutionSnapshot, component: OperationalComponent): number | null {
  const ms = snapshot.provenance?.timings?.[TIMING_KEY_BY_COMPONENT[component]]
  // Negative, fractional-in-bad-way or non-finite values are contract
  // violations — render nothing rather than a bogus bar (never invent).
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : null
}

// §61.1 first-viewport summary. Providers tally over PRESENT sections only
// (emulator, jev, independent_openai); ai_evaluation is NOT a provider row (§66
// lists AI Evaluation separately). Persistence is a status, not a duration:
// the snapshot being rendered IS the persisted evidence.
export type OperationalSummary = {
  status: 'completed' | 'partial' | 'failed'
  totalMs: number | null
  questions: { processed: number; total: number }
  providers: { completed: number; total: number }
  aiEvaluation: 'success' | 'failed' | 'not-run'
  persistence: 'ok'
}

export function operationalSummary(snapshot: ExecutionSnapshot): OperationalSummary {
  const emulator = snapshot.emulator
  const providerSections = [emulator, snapshot.jev, snapshot.independent_openai].filter(
    (section) => section !== undefined
  )
  const aiEvaluation = snapshot.ai_evaluation
  // §66 partial classification — a one-line TALLY over the delivered sections
  // (same class as the providers tally below), NOT a domain recomputation:
  // the classification rule is owned and delivered by the API.
  const anySectionFailed = ([emulator, snapshot.jev, snapshot.independent_openai, aiEvaluation] as const).some(
    (section) => section?.status === 'failed'
  )
  return {
    status:
      snapshot.status === 'failed' ? 'failed' : anySectionFailed ? 'partial' : 'completed',
    totalMs: snapshot.runtime?.duration_ms ?? null,
    questions: {
      total: Object.keys(snapshot.request?.questions ?? {}).length,
      processed:
        emulator?.status === 'success' ? Object.keys(emulator.result?.answers ?? {}).length : 0,
    },
    providers: {
      total: providerSections.length,
      completed: providerSections.filter((section) => section.status === 'success').length,
    },
    aiEvaluation: !aiEvaluation ? 'not-run' : aiEvaluation.status === 'success' ? 'success' : 'failed',
    persistence: 'ok',
  }
}

// §61.2 rail classification. The §66 classification is computed DOMAIN-SIDE
// and DELIVERED by the list API as `operational_status` (failed | partial
// when any executed leg failed | completed) — this is a thin mapper over
// that delivered field: the web renders, never re-derives.
export type RailStatus = 'completed' | 'failed' | 'partial'

export function railStatus(item: RecentExecutionItem): RailStatus {
  return item.operational_status
}

// §61.3/§65 flow: request_validation → parallel[emulator, jev?, independent_openai?]
// → fidelity? → ai_judge? → persistence. Only components that EXECUTED in this
// run appear (absent sections are never faked as skipped nodes). The parallel
// members carry `parallel: true` so the UI groups them instead of drawing a
// strict sequence that never happened.
export type FlowNode = {
  key: FlowNodeKey
  ran: boolean
  status: 'success' | 'failed' | 'ok'
  durationMs: number | null
  parallel?: boolean
}

export function flowNodes(snapshot: ExecutionSnapshot): FlowNode[] {
  const nodes: FlowNode[] = [
    // A persisted snapshot exists ⇒ the request validated successfully.
    {
      key: 'request_validation',
      ran: true,
      status: 'success',
      durationMs: timingOf(snapshot, 'request_validation'),
    },
  ]
  if (snapshot.emulator) {
    nodes.push({
      key: 'emulator',
      ran: true,
      status: snapshot.emulator.status === 'failed' ? 'failed' : 'success',
      durationMs: timingOf(snapshot, 'emulator'),
      parallel: true,
    })
  }
  if (snapshot.jev) {
    nodes.push({
      key: 'jev',
      ran: true,
      status: snapshot.jev.status === 'failed' ? 'failed' : 'success',
      durationMs: timingOf(snapshot, 'jev'),
      parallel: true,
    })
  }
  if (snapshot.independent_openai) {
    nodes.push({
      key: 'independent_openai',
      ran: true,
      status: snapshot.independent_openai.status === 'failed' ? 'failed' : 'success',
      durationMs: timingOf(snapshot, 'independent_openai'),
      parallel: true,
    })
  }
  // A present comparison was computed ⇒ the fidelity step succeeded.
  if (snapshot.comparison) {
    nodes.push({ key: 'fidelity', ran: true, status: 'success', durationMs: timingOf(snapshot, 'fidelity') })
  }
  if (snapshot.ai_evaluation) {
    nodes.push({
      key: 'ai_judge',
      ran: true,
      status: snapshot.ai_evaluation.status === 'failed' ? 'failed' : 'success',
      durationMs: timingOf(snapshot, 'ai_judge'),
    })
  }
  // Always last: the served snapshot is the persisted evidence — status OK,
  // and NEVER a fake duration (no persistence_ms exists in the contract).
  nodes.push({ key: 'persistence', ran: true, status: 'ok', durationMs: null })
  return nodes
}

// §61.4 absolute latency per component in flow order. Old snapshots (no
// timings) yield an empty array — the UI then renders the honest
// "not recorded" line, never invented zeros or percentages of the total.
export type LatencyBar = { key: OperationalComponent; ms: number }

export function latencyBars(snapshot: ExecutionSnapshot): LatencyBar[] {
  const bars: LatencyBar[] = []
  for (const component of COMPONENT_ORDER) {
    const ms = timingOf(snapshot, component)
    if (ms !== null) bars.push({ key: component, ms })
  }
  return bars
}

// Retry data exists ONLY for the independent LLM adapter (its llm_attempts
// are persisted, §45). Every other component has no retry mechanism — null,
// never an invented zero (§61.4 "solo cuando estos datos se calculen
// realmente").
export type RetryInfo = { attempts: number | null; retries: number | null }

export function retryInfo(snapshot: ExecutionSnapshot, component: OperationalComponent): RetryInfo {
  if (component !== 'independent_openai') return { attempts: null, retries: null }
  const attemptsList = snapshot.independent_openai?.llm_attempts
  // An empty attempts array means "not computed" just like an absent one —
  // zero attempts is impossible for a persisted section (§61.4 never invent).
  const attempts = attemptsList && attemptsList.length > 0 ? attemptsList.length : null
  return {
    attempts,
    retries: attempts === null ? null : attempts > 1 ? attempts - 1 : 0,
  }
}

// §61.5/§69 sanitized operational log derived ONLY from the persisted
// snapshot. Fields: timestamp (the snapshot's created_at — the only time the
// repository carries), level, component, event, trace id (= execution_id),
// retry, sanitized error. No secrets can appear: every value comes from these
// fields, and section errors are already sanitized server-side.
export type OperationalLogLine = {
  timestamp: string
  level: 'info' | 'error'
  component: 'execution' | OperationalComponent
  event: 'completed' | 'failed' | 'success'
  traceId: string
  durationMs: number | null
  retries: number | null
  error: string | null
  // §69 completion-line facts (execution line only).
  mode?: string
  questionCount?: number
  comparison?: 'available' | 'unavailable'
}

export function operationalLog(snapshot: ExecutionSnapshot): OperationalLogLine[] {
  const status = snapshot.status === 'failed' ? 'failed' : 'completed'
  const lines: OperationalLogLine[] = [
    {
      timestamp: snapshot.created_at,
      level: status === 'failed' ? 'error' : 'info',
      component: 'execution',
      event: status,
      traceId: snapshot.execution_id,
      durationMs: snapshot.runtime?.duration_ms ?? null,
      retries: null,
      error: null,
      mode: snapshot.mode,
      questionCount: Object.keys(snapshot.request?.questions ?? {}).length,
      comparison: snapshot.comparison ? 'available' : 'unavailable',
    },
  ]
  for (const node of flowNodes(snapshot)) {
    // Persistence is not a component line: the served snapshot IS the
    // persistence evidence and the execution line already carries the §69
    // facts. Everything else that ran gets exactly one line.
    if (node.key === 'persistence') continue
    lines.push(sectionLine(snapshot, node.key, node.status, node.durationMs))
  }
  return lines
}

function sectionLine(
  snapshot: ExecutionSnapshot,
  component: OperationalComponent,
  nodeStatus: 'success' | 'failed' | 'ok',
  durationMs: number | null
): OperationalLogLine {
  const failed = nodeStatus === 'failed'
  const sectionError =
    component === 'emulator'
      ? snapshot.emulator?.error
      : component === 'jev'
        ? snapshot.jev?.error
        : component === 'independent_openai'
          ? snapshot.independent_openai?.error
          : component === 'ai_judge'
            ? snapshot.ai_evaluation?.error
            : undefined
  return {
    timestamp: snapshot.created_at,
    level: failed ? 'error' : 'info',
    component,
    event: failed ? 'failed' : 'success',
    traceId: snapshot.execution_id,
    durationMs,
    retries: retryInfo(snapshot, component).retries,
    error: failed ? (sectionError ?? null) : null,
  }
}

// §54.2 rail filters. The status filter matches the RAW delivered status, so
// §66 partial rows (raw status 'completed' without fidelity) count as
// completed; the rail badge still shows their Partial classification.
export type ExecutionFilterStatus = 'all' | 'completed' | 'failed'
export type ExecutionFilterRange = 'all' | 'today' | '7d' | '30d'
export type ExecutionFilters = { query: string; status: ExecutionFilterStatus; range: ExecutionFilterRange }

export function applyFilters(
  items: RecentExecutionItem[],
  filters: ExecutionFilters,
  now: number = Date.now()
): RecentExecutionItem[] {
  const query = filters.query.trim().toLowerCase()
  return items.filter((item) => {
    if (query !== '' && !item.execution_id.toLowerCase().includes(query)) return false
    if (filters.status !== 'all' && item.status !== filters.status) return false
    if (filters.range !== 'all' && !withinRange(item.created_at, filters.range, now)) return false
    return true
  })
}

function withinRange(createdAt: string, range: 'today' | '7d' | '30d', now: number): boolean {
  const time = Date.parse(createdAt)
  if (Number.isNaN(time)) return false
  if (range === 'today') {
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    return time >= startOfDay.getTime()
  }
  const span = range === '7d' ? 7 * 86_400_000 : 30 * 86_400_000
  return time >= now - span
}

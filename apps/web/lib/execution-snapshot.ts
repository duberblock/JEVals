// Typed view over the persisted execution snapshot returned by
// POST /api/v1/executions (Wave 1 API contract). The web app never re-derives
// domain semantics; it only renders what the snapshot carries.

export type EmulatorAnswer =
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | {
      type: 'score'
      score: number
      confidence: number
      legend: Record<string, unknown>
      probabilities: Record<string, number>
    }
  | { type: 'noul'; noul: number }

// Per-primitive fidelity components of the deterministic comparison (plan
// sections 24-26), delivered by the API snapshot — the web renders, never
// re-derives.
export type ChoiceComponents = {
  decision_match: boolean
  confidence_delta: number
  distribution_similarity: number
}

export type ScoreComponents = {
  score_delta: number
  max_score: number
  score_similarity: number
  distribution_similarity: number
  confidence_delta: number
  emulator_dominant_level: string
  jev_dominant_level: string
}

export type NoulComponents = {
  probability_delta: number
  // P38/FB11: the §26/§27 midpoint category per side (-1 strictly below /
  // 0 exactly at / 1 strictly above the 0.5 mathematical midpoint), computed
  // and persisted by the API (single source) so the web composes the verdict
  // without re-deriving the classification client-side (same pattern as
  // ScoreComponents.emulator_dominant_level / IndependentOpenaiSection's
  // independent_dominant_level, ADR-006 ruling 2). Optional — absent only on
  // pre-P38 persisted snapshots, which render the legacy geometry-only
  // verdict.
  emulator_midpoint_category?: number
  jev_midpoint_category?: number
}

export type QuestionComparison = {
  primitive: 'choice' | 'score' | 'noul'
  fidelity: number
  aligned: boolean
  components: ChoiceComponents | ScoreComponents | NoulComponents
}

export type Comparison = {
  overall_fidelity: number
  questions: Record<string, QuestionComparison>
}

// §67 per-question Judge verdict with its controlled vocabularies
// (support: strong|partial|weak|insufficient; semantic_divergence:
// none|minor|material|undetermined; preferred: emulator|jev|tie|undetermined).
export type JudgeQuestionEvaluation = {
  emulator_support: string
  jev_support: string
  semantic_divergence: string
  preferred: string
  reason: string
}

// §45 Full LLM Exchange evidence persisted next to the parsed §67 answer:
// the exact Judge input document, the strict output schema, the raw model
// response, the system instruction and the request configuration. Secrets
// are excluded by construction server-side — the web renders them verbatim.
export type JudgeEvidence = {
  input?: unknown
  output_schema?: unknown
  raw_response?: string
  system_instruction?: string
  configuration?: unknown
}

// §67 ai_evaluation section of an evaluate run: the Judge's structured
// verdict. overall.semantic_divergence is a closed vocabulary
// (none|minor|material|undetermined); the Principal hero renders ONLY that
// verdict line (§32) — questions/evidence belong to Investigación.
export type AiEvaluationSection = {
  status: string
  model?: string
  overall?: {
    prediction_quality: string
    semantic_divergence: string
    summary: string
  }
  questions?: Record<string, JudgeQuestionEvaluation>
  evidence?: JudgeEvidence
  error?: string
}

// §47/§51 independent_openai section of an advanced run: a third prediction
// (only ever fed the original request — §11 independence rule) plus its
// alignment booleans. The alignment key appears only when the emulator side
// succeeded; a failed or unalignable prediction carries no alignment, and the
// Principal hero then renders no line (§31: never invent).
export type IndependentOpenaiSection = {
  status: string
  model?: string
  result?: { answers?: Record<string, EmulatorAnswer>; usage?: Record<string, number> }
  alignment?: {
    aligned: boolean
    // §41/ADR-006 ruling 2: the API persists the independent's dominant
    // rubric level for score questions so the web renders it verbatim and
    // never re-derives the §26 argmax client-side. Absent on choice/noul
    // questions and on old snapshots (which render level-less).
    questions: Record<
      string,
      { agrees_with_emulator: boolean; agrees_with_jev: boolean | null; independent_dominant_level?: string }
    >
  }
  run_config?: unknown
  // §45: the adapter's per-attempt traces, provider-redacted server-side —
  // the canonical evidence of the independent call's prompts (ADR-005 P19).
  llm_attempts?: Record<string, unknown>[]
  retry_reasons?: unknown
  error?: string
}

// Component latency keys of provenance.timings (Operación §61.4). Each key
// is present only when that component was invoked in the run — present even
// when the component FAILED. Old snapshots carry no timings at all: Operación
// then renders without bars and never invents zeros (ADR-006 philosophy).
// There is deliberately no persistence_ms: a served snapshot IS the persisted
// evidence, so persistence renders as a status, never a fake duration.
export type ComponentTimingKey =
  | 'request_validation_ms'
  | 'emulator_ms'
  | 'jev_ms'
  | 'independent_openai_ms'
  | 'fidelity_ms'
  | 'ai_judge_ms'

// §59 provenance block: provider details (opaque to the web), component
// versions (rendered verbatim, never invented) and the optional timings.
export type ExecutionProvenance = {
  providers?: unknown
  versions?: Record<string, string>
  timings?: Partial<Record<ComponentTimingKey, number>>
}

// P47 (W2): the JSON value vocabulary of the contracts schema
// (packages/contracts/schemas/system-one-request.schema.json $defs/jsonValue)
// — the leaf types state may carry.
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

// P47 (W2): the entryType union the contracts schema defines for
// SystemOneRequest.state — required but nullable, and wider than the object
// the old web type assumed: string | null | array | object. The persisted
// snapshot path is snapshot.request.state; the POST envelope carries it at
// system_one.state (same value, the API persists the interior as `request`).
export type EntryState = string | null | JsonValue[] | Record<string, JsonValue>

export type ExecutionSnapshot = {
  execution_id: string
  created_at: string
  request_hash: string
  mode: string
  status: string
  request: {
    // P47 (W2): widened from Record<string, unknown> to the entryType union —
    // the contract allows string/array/null states and the ScenarioBox
    // renders them all. Null/absent means NO scenario (the box stays away).
    state?: EntryState
    questions?: Record<string, { type?: string; criteria?: unknown; instructions?: unknown }>
    // §11: the request's optional model override. The Independent INPUT is
    // the original request, so it carries the key when present.
    model?: string
  }
  emulator?: {
    status: string
    model?: string
    result?: { answers?: Record<string, EmulatorAnswer>; usage?: Record<string, number> }
    error?: string
  }
  // JEV side of a compare run. A failed JEV (plan section 66) yields
  // status 'failed' with an error message and NO comparison key.
  jev?: {
    status: string
    model?: string
    result?: { answers?: Record<string, EmulatorAnswer>; usage?: Record<string, number> }
    error?: string
  }
  comparison?: Comparison
  ai_evaluation?: AiEvaluationSection
  independent_openai?: IndependentOpenaiSection
  runtime?: { duration_ms?: number }
  provenance?: ExecutionProvenance
}

// C7 (FASE C / G2, ADR-012 ruling 3): per-source run status for the hero
// strip. Null means the section was never persisted for this run (not run) —
// never a disguised failure: a missing jev on an emulator run is no failure,
// and a failed Judge stays visible here even when the §32 AI line renders
// nothing.
export type SourceRunStatus = 'success' | 'failed'
// emulator is nullable like the rest: a COMPLETED snapshot always carries its
// status, but the C11 in-flight strip legitimately has no data for ANY source
// yet (IN_FLIGHT_SOURCES) — null is "sin dato", never a disguised failure.
export type SourceStatusStrip = {
  emulator: SourceRunStatus | null
  jev: SourceRunStatus | null
  judge: SourceRunStatus | null
  independent: SourceRunStatus | null
}

export type ExecutionSummary = {
  executionId: string
  status: 'completed' | 'failed'
  questionCount: number
  durationMs: number | null
  model: string
  // C5 (FASE C): context-bar facts — snapshot.mode verbatim (raw enums are
  // localized at render time, plan 15.5) and the provider models of the
  // sections that ran (emulator, jev, ai_evaluation, independent_openai — in
  // that source order, deduped preserving first occurrence). Sections
  // without a persisted model contribute nothing; nothing is invented.
  mode: string
  providers: string[]
  // Compare-run facts (plan sections 22-26). Null on emulator runs and on
  // JEV partial failures — the UI must not invent them.
  overallFidelity: number | null
  alignedQuestions: number | null
  jevStatus: string | null
  jevModel: string | null
  // §32 AI evaluation verdict (semantic_divergence vocabulary). Null when the
  // section is absent or failed — the hero must not invent a verdict.
  semanticDivergence: string | null
  // §31 Independent overall alignment. Null when the section is absent,
  // failed, or unalignable — the hero renders no line then.
  independentAligned: boolean | null
  // C7: per-source statuses derived strictly from the persisted sections'
  // own status fields (absent → null, never 'failed').
  sources: SourceStatusStrip
}

// C7: a persisted section's own status mapped to the closed vocabulary —
// anything other than 'success' reads as failed (an unknown state never
// renders as success). The emulator is the mandatory leg, so an execution
// without it reads as failed, honestly.
function sourceRunStatus(status: string | undefined): SourceRunStatus {
  return status === 'success' ? 'success' : 'failed'
}

// FB2 (R40/P29, docs/feedback-v1-ux.md §FB2): display version of the alias
// shown on summary surfaces wherever the emulator's MODEL string renders —
// 'Emulator 0.0.1' instead of the raw model (e.g. 'jev-emulator'). This is
// a §9 category-4 "label puramente visual de UI" (owner-approved), NOT
// provenance: Evidence §44, Copy/Download and the persisted payload keep
// the REAL model verbatim. 'Emulator' is a canonical proper noun identical
// in both locales (§15), so composing the label here is locale-independent
// and needs no i18n key. Single source — never duplicate this string.
export const EMULATOR_DISPLAY_VERSION = '0.0.1'

// FB2 (P29): the alias label itself — substituted ONLY when a real emulator
// model exists (an absent/empty model still contributes nothing anywhere).
function emulatorDisplayModel(model: string | undefined): string | undefined {
  return typeof model === 'string' && model !== '' ? `Emulator ${EMULATOR_DISPLAY_VERSION}` : undefined
}

// P41: the mid-run sections a progressive summary derives from — the SSE
// section payloads keyed by their wire names (judge is the snapshot's
// ai_evaluation section, independent its independent_openai). Every key is
// optional: only the sections whose frames already arrived exist, and the
// derivation below derives nothing from the missing ones.
export type ProgressiveSections = {
  emulator?: ExecutionSnapshot['emulator']
  jev?: ExecutionSnapshot['jev']
  comparison?: Comparison
  judge?: AiEvaluationSection
  independent?: IndependentOpenaiSection
}

// P41: the section subset every summary derivation reads. Both
// summarizeSnapshot (a landed snapshot) and progressiveSummary (the sections
// whose frames already arrived, plus the POSTED request) feed the SAME core
// below — the §22 facts, the LLM line guards and the C7 strip statuses are
// derived exactly once (single-source rule; never a second derivation).
type SummarySections = {
  execution_id?: string
  status?: string
  mode?: string
  request?: ExecutionSnapshot['request']
  emulator?: ExecutionSnapshot['emulator']
  jev?: ExecutionSnapshot['jev']
  comparison?: Comparison
  ai_evaluation?: AiEvaluationSection
  independent_openai?: IndependentOpenaiSection
  runtime?: ExecutionSnapshot['runtime']
}

// C5: the models of the sections that ran, in §65 source order (emulator,
// JEV, Judge, Independent). Deduped preserving first occurrence; empty or
// absent models contribute nothing. FB2 (P29): the emulator entry carries
// the display alias — the other sources keep their real models verbatim.
function providerModels(sections: SummarySections): string[] {
  const models = [
    emulatorDisplayModel(sections.emulator?.model),
    sections.jev?.model,
    sections.ai_evaluation?.model,
    sections.independent_openai?.model,
  ]
  return [...new Set(models.filter((model): model is string => typeof model === 'string' && model !== ''))]
}

// Request order: JSON object insertion order of request.questions — shared
// by the landed snapshot and the POSTED envelope (identical shape).
function requestQuestionOrder(request: ExecutionSnapshot['request'] | undefined): string[] {
  return Object.keys(request?.questions ?? {})
}

function deriveSummary(sections: SummarySections): ExecutionSummary {
  const comparison = sections.comparison
  // §32: the verdict exists only for a SUCCESSFUL ai_evaluation with an
  // overall block — a failed Judge (§66 partial) renders no AI line.
  const aiEvaluation = sections.ai_evaluation
  // §31: the aligned/diverged verdict exists only for a SUCCESSFUL
  // independent prediction that carries an alignment block.
  const independent = sections.independent_openai
  return {
    executionId: sections.execution_id ?? '',
    status: sections.status === 'failed' ? 'failed' : 'completed',
    questionCount: requestQuestionOrder(sections.request).length,
    // F5: the API carries the duration under runtime.duration_ms (the
    // top-level duration_ms field is gone). Absent runtime data renders no
    // duration rather than an invented zero.
    durationMs: sections.runtime?.duration_ms ?? null,
    // FB2 (P29): the hero's "Model" row shows the display alias whenever a
    // real emulator model exists; absent model stays '' (renders nothing).
    model: emulatorDisplayModel(sections.emulator?.model) ?? '',
    mode: sections.mode ?? '',
    providers: providerModels(sections),
    // Counting the delivered aligned booleans is a tally, not a re-derivation
    // of the section 26 rule (which stays server-side).
    alignedQuestions: comparison
      ? Object.values(comparison.questions).filter((question) => question.aligned).length
      : null,
    overallFidelity: comparison?.overall_fidelity ?? null,
    jevStatus: sections.jev?.status ?? null,
    jevModel: sections.jev?.model ?? null,
    semanticDivergence:
      aiEvaluation?.status === 'success' && aiEvaluation.overall
        ? aiEvaluation.overall.semantic_divergence
        : null,
    independentAligned:
      independent?.status === 'success' && independent.alignment ? independent.alignment.aligned : null,
    sources: {
      emulator: sourceRunStatus(sections.emulator?.status),
      jev: sections.jev ? sourceRunStatus(sections.jev.status) : null,
      judge: aiEvaluation ? sourceRunStatus(aiEvaluation.status) : null,
      independent: independent ? sourceRunStatus(independent.status) : null,
    },
  }
}

export function summarizeSnapshot(snapshot: ExecutionSnapshot): ExecutionSummary {
  return deriveSummary(snapshot)
}

// P41: the progressive hero's summary — the deterministic subset that already
// landed while the LLM legs (the Judge, the Independent) keep flying.
// Honesty contract: executionId stays '' (no id exists mid-run, §50 — the
// hero renders a disabled CTA, never a link) and durationMs stays null; the
// LLM fields stay null until their sections arrive, through the SAME guards
// summarizeSnapshot uses (shared above, never duplicated). Absent sections
// leave neutral facts — pending is a live observation, never an absence
// statement (only the final snapshot may say a leg did not run).
export function progressiveSummary(
  sections: ProgressiveSections,
  request: ExecutionSnapshot['request']
): ExecutionSummary {
  return deriveSummary({
    request,
    emulator: sections.emulator,
    jev: sections.jev,
    comparison: sections.comparison,
    ai_evaluation: sections.judge,
    independent_openai: sections.independent,
  })
}

// Request order: JSON object insertion order of request.questions.
export function questionOrder(snapshot: ExecutionSnapshot): string[] {
  return requestQuestionOrder(snapshot.request)
}

export function shortExecutionId(executionId: string): string {
  return executionId.slice(0, 12)
}

export type RecentExecutionItem = {
  execution_id: string
  created_at: string
  request_hash: string
  mode: string
  status: string
  // §66 operational VIEW classification DELIVERED by the list API (computed
  // domain-side: partial when any executed leg failed). The web renders it
  // verbatim — 'partial' is never persisted in the §47 status column.
  operational_status: 'completed' | 'partial' | 'failed'
  question_count: number
  overall_fidelity: number | null
  aligned_questions: number | null
  semantic_divergence: string | null
  duration_ms: number | null
}

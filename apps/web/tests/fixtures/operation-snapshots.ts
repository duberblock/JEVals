// Hermetic execution snapshot fixtures for the Operación tests (Wave B step 8).
// Built on the Investigation fixtures so domain rules (§26/§31/§67 shapes)
// stay consistent; the variants here cover the §66 partial-failure matrix and
// the provenance.timings contract (present only for invoked components).
import type { ComponentTimingKey, ExecutionSnapshot } from '../../lib/execution-snapshot'
import { compareSnapshot } from './investigation-snapshot'

export const OPERATION_RUN_ID = 'run_08492abcdef12'

// Full timings for a compare-and-evaluate run with the advanced independent
// prediction: every component ran (§65 order), all succeeded.
export const FULL_TIMINGS: Record<ComponentTimingKey, number> = {
  request_validation_ms: 12,
  emulator_ms: 62,
  jev_ms: 71,
  independent_openai_ms: 43,
  fidelity_ms: 5,
  ai_judge_ms: 8,
}

// Complete operational snapshot: emulator + JEV + independent + comparison +
// judge, all successful, with timings for every invoked component.
export function operationalSnapshot(): ExecutionSnapshot {
  const snapshot = compareSnapshot()
  return {
    ...snapshot,
    provenance: {
      ...(typeof snapshot.provenance === 'object' && snapshot.provenance !== null ? snapshot.provenance : {}),
      timings: FULL_TIMINGS,
    },
  }
}

// Old snapshot: persisted before provenance.timings existed. Renders WITHOUT
// bars and without invented zeros (same degradation philosophy as ADR-006).
export function oldSnapshot(): ExecutionSnapshot {
  const snapshot = compareSnapshot()
  return {
    ...snapshot,
    provenance: { versions: { emulator: '0.9.0' } },
  }
}

// §66 JEV failure: JEV failed, so no comparison (fidelity unavailable) and no
// AI evaluation (the judge never ran — the section is absent, not 'failed').
// No advanced independent prediction in this run (§66 matrix row).
export function jevFailedSnapshot(): ExecutionSnapshot {
  const snapshot = compareSnapshot()
  return {
    ...snapshot,
    mode: 'compare',
    jev: { status: 'failed', model: 'jev-latest', error: 'JEV upstream timeout after 120s' },
    comparison: undefined,
    ai_evaluation: undefined,
    independent_openai: undefined,
    provenance: {
      timings: {
        request_validation_ms: 11,
        emulator_ms: 58,
        // Present even though the component failed (contract rule).
        jev_ms: 120000,
      },
    },
  }
}

// §66 independent failure: emulator + JEV + fidelity + judge available, the
// independent LLM prediction failed with three attempts (2 retries).
export function independentFailedSnapshot(): ExecutionSnapshot {
  const snapshot = compareSnapshot()
  return {
    ...snapshot,
    independent_openai: {
      status: 'failed',
      model: 'gpt-4o-mini',
      error: 'LLM rate limit exceeded',
      llm_attempts: [{ model: 'gpt-4o-mini' }, { model: 'gpt-4o-mini' }, { model: 'gpt-4o-mini' }],
    },
    provenance: {
      timings: {
        request_validation_ms: 12,
        emulator_ms: 62,
        jev_ms: 71,
        independent_openai_ms: 9000,
        fidelity_ms: 5,
        ai_judge_ms: 8,
      },
    },
  }
}

// §66 judge failure: comparison available, ai_evaluation persisted with a
// failed status and a sanitized error.
export function judgeFailedSnapshot(): ExecutionSnapshot {
  const snapshot = compareSnapshot()
  return {
    ...snapshot,
    ai_evaluation: { status: 'failed', model: 'judge-llm', error: 'Judge schema parse failed' },
    provenance: {
      timings: {
        request_validation_ms: 12,
        emulator_ms: 62,
        jev_ms: 71,
        fidelity_ms: 5,
        // The judge was invoked and failed — its timing is still present.
        ai_judge_ms: 400,
      },
    },
  }
}

// Emulator failure: the snapshot status is failed and the emulator section
// carries the failure — no answers were processed.
export function emulatorFailedSnapshot(): ExecutionSnapshot {
  const snapshot = compareSnapshot()
  return {
    ...snapshot,
    status: 'failed',
    mode: 'emulator',
    jev: undefined,
    comparison: undefined,
    ai_evaluation: undefined,
    independent_openai: undefined,
    emulator: { status: 'failed', model: 'jev-emulator', error: 'emulator crashed' },
    provenance: { timings: { request_validation_ms: 10, emulator_ms: 30 } },
  }
}

// RecentExecutionItem list fixtures for the rail / history surfaces. The
// operational_status classification is DELIVERED by the list API (§66
// single-sourced server-side) — fixtures carry it verbatim.
export function railItem(overrides: Partial<import('../../lib/execution-snapshot').RecentExecutionItem> = {}) {
  return {
    execution_id: OPERATION_RUN_ID,
    created_at: '2026-09-21T18:42:00Z',
    request_hash: 'sha256:abc',
    mode: 'compare-and-evaluate',
    status: 'completed',
    operational_status: 'completed' as const,
    question_count: 3,
    overall_fidelity: 0.95,
    aligned_questions: 3,
    semantic_divergence: 'none',
    duration_ms: 2500,
    ...overrides,
  }
}

// Hermetic execution snapshot fixtures for the Investigation tests (Wave B).
// They mirror the shapes the API persists (§47 snapshot, §67 judge output,
// §45 judge evidence, §11/§45 independent run_config + llm_attempts) as seen
// in apps/api/tests/integration/test_evaluate_and_independent_api.py — the web
// only renders, never re-derives, so fixtures must be realistic.
//
// FIXTURE DOMAIN RULES — fixtures MUST satisfy the domain rules the API
// enforces (§26/§31): score agreement means the SAME dominant rubric level
// (argmax over probabilities), so `agrees_with_emulator: true` requires the
// independent probabilities' dominant level to equal the emulator's dominant
// level, and `independent_dominant_level` must be that argmax key. A fixture
// that contradicts these rules pins lies into the tests.
import type { ExecutionSnapshot } from '../../lib/execution-snapshot'

export const RUN_ID = 'run_08492abcdef12'

export const JUDGE_QUESTIONS = {
  request_type: {
    emulator_support: 'strong',
    jev_support: 'strong',
    semantic_divergence: 'none',
    preferred: 'tie',
    reason: 'Both select billing.',
  },
  urgency: {
    emulator_support: 'partial',
    jev_support: 'partial',
    semantic_divergence: 'minor',
    preferred: 'tie',
    reason: 'Scores differ but stay in the same band.',
  },
  refund_requested: {
    emulator_support: 'partial',
    jev_support: 'weak',
    semantic_divergence: 'minor',
    preferred: 'emulator',
    reason: 'Both below .5 with different strength.',
  },
} as const

const JUDGE_ANSWER = {
  overall: {
    prediction_quality: 'mixed',
    semantic_divergence: 'minor',
    summary: 'Numeric differences leave the interpretation unchanged.',
  },
  questions: JUDGE_QUESTIONS,
}

// §45 judge evidence: exact input, schema, raw response, system instruction
// and configuration — all secrets excluded by construction server-side.
const JUDGE_EVIDENCE = {
  input: {
    request: { state: { message: 'I was charged twice on my invoice.' } },
    emulator_result: { model: 'jev-emulator', answers: {}, usage: { input_tokens: 120, output_tokens: 45 } },
    jev_result: { model: 'jev-latest', answers: {}, usage: { input_tokens: 210, output_tokens: 64 } },
    comparison: { overall_fidelity: 0.95, questions: {} },
  },
  output_schema: {
    type: 'object',
    properties: {
      overall: { type: 'object' },
      questions: { type: 'object' },
    },
    required: ['overall', 'questions'],
  },
  raw_response: JSON.stringify(JUDGE_ANSWER, null, 2),
  system_instruction: 'You are the jevals semantic judge. Answer only the §67 schema.',
  configuration: { model: 'judge-llm', temperature: 0, max_tokens: 4096 },
}

const INDEPENDENT_LLM_ATTEMPTS = [
  {
    messages: [
      { role: 'system', content: 'system-one-adapter system prompt' },
      { role: 'user', content: 'I was charged twice on my invoice.' },
    ],
    debug_info: { model_name: 'gpt-4o-mini', finish_reason: 'stop' },
  },
]

// A compare-and-evaluate run with the Advanced independent prediction: every
// question aligned (§26), judge successful (§67), independent aligned with
// both sides (§31/§41).
export function compareSnapshot(): ExecutionSnapshot {
  return {
    execution_id: RUN_ID,
    created_at: '2026-09-20T20:00:00-05:00',
    request_hash: 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0',
    mode: 'compare-and-evaluate',
    status: 'completed',
    request: {
      state: { message: 'I was charged twice on my invoice.' },
      questions: {
        request_type: {
          type: 'choice',
          instructions: 'Classify this request.',
          criteria: {
            billing: 'Billing issue',
            technical: 'Technical issue',
            sales: 'Sales request',
          },
        },
        urgency: { type: 'score', criteria: ['low', 'medium', 'high'] },
        refund_requested: {
          type: 'noul',
          criteria: {
            true: 'The customer requests a refund.',
            false: 'The customer does not request a refund.',
          },
        },
      },
      // §11: the request carried a model override — the Independent INPUT is
      // the original request, so it must include it.
      model: 'gpt-4o-mini',
    },
    emulator: {
      status: 'success',
      model: 'jev-emulator',
      result: {
        answers: {
          request_type: {
            type: 'choice',
            choice: 'billing',
            confidence: 0.875,
            probabilities: { billing: 0.75, technical: 0.125, sales: 0.125 },
          },
          urgency: {
            type: 'score',
            score: 1.82,
            confidence: 0.75,
            legend: { '0': 'low', '1': 'medium', '2': 'high' },
            probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 },
          },
          refund_requested: { type: 'noul', noul: 0.082 },
        },
        usage: { input_tokens: 120, output_tokens: 45 },
      },
    },
    jev: {
      status: 'success',
      model: 'jev-latest',
      result: {
        answers: {
          request_type: {
            type: 'choice',
            choice: 'billing',
            confidence: 0.625,
            probabilities: { billing: 0.625, technical: 0.125, sales: 0.25 },
          },
          urgency: {
            type: 'score',
            score: 1.64,
            confidence: 0.625,
            legend: { '0': 'low', '1': 'medium', '2': 'high' },
            probabilities: { '0': 0.15, '1': 0.25, '2': 0.6 },
          },
          refund_requested: { type: 'noul', noul: 0.119 },
        },
        usage: { input_tokens: 210, output_tokens: 64 },
      },
    },
    comparison: {
      overall_fidelity: 0.95,
      questions: {
        request_type: {
          primitive: 'choice',
          fidelity: 0.9,
          aligned: true,
          components: {
            decision_match: true,
            confidence_delta: 0.25,
            distribution_similarity: 0.833,
          },
        },
        urgency: {
          primitive: 'score',
          fidelity: 0.95,
          aligned: true,
          components: {
            score_delta: 0.18,
            max_score: 2,
            score_similarity: 0.91,
            distribution_similarity: 0.85,
            confidence_delta: 0.125,
            emulator_dominant_level: '2',
            jev_dominant_level: '2',
          },
        },
        refund_requested: {
          primitive: 'noul',
          fidelity: 0.963,
          aligned: true,
          // P38/FB11: the §26/§27 midpoint categories persisted by the API
          // (.082/.119 are both strictly below .5 — category -1 per side).
          components: {
            probability_delta: 0.037,
            emulator_midpoint_category: -1,
            jev_midpoint_category: -1,
          },
        },
      },
    },
    ai_evaluation: {
      status: 'success',
      model: 'judge-llm',
      overall: JUDGE_ANSWER.overall,
      questions: JUDGE_ANSWER.questions,
      evidence: JUDGE_EVIDENCE,
    },
    independent_openai: {
      status: 'success',
      model: 'gpt-4o-mini',
      result: {
        answers: {
          request_type: {
            type: 'choice',
            choice: 'billing',
            confidence: 0.75,
            probabilities: { billing: 0.75, technical: 0.125, sales: 0.125 },
          },
          urgency: {
            type: 'score',
            score: 1.71,
            confidence: 0.7,
            legend: { '0': 'low', '1': 'medium', '2': 'high' },
            // Dominant level '2' (argmax) — equal to the emulator's and JEV's
            // dominant '2', so the agrees_with_emulator/jev booleans below are
            // true under the §26 rule (fixture domain rules, see header).
            probabilities: { '0': 0.15, '1': 0.2, '2': 0.65 },
          },
          refund_requested: { type: 'noul', noul: 0.081 },
        },
        usage: { input_tokens: 300, output_tokens: 80 },
      },
      alignment: {
        aligned: true,
        questions: {
          request_type: { agrees_with_emulator: true, agrees_with_jev: true },
          // §41/ADR-006 ruling 2: the API persists the independent's dominant
          // rubric level (score questions only) so the web renders it verbatim.
          urgency: { agrees_with_emulator: true, agrees_with_jev: true, independent_dominant_level: '2' },
          refund_requested: { agrees_with_emulator: true, agrees_with_jev: true },
        },
      },
      run_config: {
        model: 'gpt-4o-mini',
        base_url: 'https://api.openai.com/v1',
        structured_outputs: true,
        llm_answer_mode: 'probabilities',
        max_retries: 2,
        timeout_seconds: 120.0,
        api: 'chat_completions',
        temperature: null,
      },
      llm_attempts: INDEPENDENT_LLM_ATTEMPTS,
    },
    runtime: { duration_ms: 2500 },
    provenance: { versions: { emulator: '1.0.0', api: '1.0.0' } },
  }
}

// Emulator-mode run with the Advanced independent prediction (§11): no JEV,
// no comparison, no AI evaluation; the independent alignment flags carry a
// null JEV side (never guessed).
export function emulatorSnapshot(): ExecutionSnapshot {
  const snapshot = compareSnapshot()
  return {
    ...snapshot,
    mode: 'emulator',
    request_hash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    jev: undefined,
    comparison: undefined,
    ai_evaluation: undefined,
    independent_openai: {
      ...snapshot.independent_openai!,
      alignment: {
        aligned: true,
        questions: {
          request_type: { agrees_with_emulator: true, agrees_with_jev: null },
          urgency: { agrees_with_emulator: true, agrees_with_jev: null, independent_dominant_level: '2' },
          refund_requested: { agrees_with_emulator: true, agrees_with_jev: null },
        },
      },
    },
  }
}

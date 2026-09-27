import { describe, expect, it } from 'vitest'

import { buildAnalysisBundle } from '../../lib/investigation/analysis-bundle'
import { compareSnapshot, emulatorSnapshot, RUN_ID } from '../fixtures/investigation-snapshot'

describe('buildAnalysisBundle (§45.2)', () => {
  it('builds the exact per-question bundle for a compare-and-evaluate run', () => {
    const snapshot = compareSnapshot()

    const bundle = buildAnalysisBundle(snapshot, 'urgency')

    expect(bundle).toEqual({
      execution_id: RUN_ID,
      question_name: 'urgency',
      request: {
        state: { message: 'I was charged twice on my invoice.' },
        question: { type: 'score', criteria: ['low', 'medium', 'high'] },
      },
      emulator: snapshot.emulator?.result?.answers?.urgency,
      jev: snapshot.jev?.result?.answers?.urgency,
      comparison: snapshot.comparison?.questions.urgency,
      independent_openai: {
        answer: snapshot.independent_openai?.result?.answers?.urgency,
        alignment: snapshot.independent_openai?.alignment?.questions.urgency,
      },
      ai_evaluation: snapshot.ai_evaluation?.questions?.urgency,
    })
  })

  it('omits absent sections entirely for an emulator-only run', () => {
    const bundle = buildAnalysisBundle(emulatorSnapshot(), 'request_type')

    expect(Object.keys(bundle)).toEqual([
      'execution_id',
      'question_name',
      'request',
      'emulator',
      'independent_openai',
    ])
    expect(bundle).not.toHaveProperty('jev')
    expect(bundle).not.toHaveProperty('comparison')
    expect(bundle).not.toHaveProperty('ai_evaluation')
  })

  it('never carries UI state, runtime, hashes or provenance', () => {
    const bundle = buildAnalysisBundle(compareSnapshot(), 'refund_requested')
    const serialized = JSON.stringify(bundle)

    expect(serialized).not.toContain('runtime')
    expect(serialized).not.toContain('request_hash')
    expect(serialized).not.toContain('provenance')
    expect(serialized).not.toContain('created_at')
    expect(serialized).not.toContain('usage')
  })
})

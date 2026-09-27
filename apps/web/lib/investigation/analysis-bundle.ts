// §45.2 Copy analysis bundle: the per-question analysis context as one JSON
// document. Only the run's analysis facts for the focused question are
// included — UI state, runtime memory, hashes, provenance and usage stats are
// excluded by construction (§45.2 exclusion list). Absent sections are
// omitted entirely (never invented as nulls).
import type { ExecutionSnapshot } from '../execution-snapshot'

export type AnalysisBundle = Record<string, unknown>

export function buildAnalysisBundle(snapshot: ExecutionSnapshot, questionName: string): AnalysisBundle {
  const request = snapshot.request ?? {}
  const bundle: AnalysisBundle = {
    execution_id: snapshot.execution_id,
    question_name: questionName,
    request: {
      state: request.state ?? {},
      question: request.questions?.[questionName] ?? {},
    },
  }

  const emulatorAnswer = snapshot.emulator?.result?.answers?.[questionName]
  if (emulatorAnswer !== undefined) bundle.emulator = emulatorAnswer

  const jevAnswer = snapshot.jev?.result?.answers?.[questionName]
  if (jevAnswer !== undefined) bundle.jev = jevAnswer

  const comparison = snapshot.comparison?.questions?.[questionName]
  if (comparison !== undefined) bundle.comparison = comparison

  const independentAnswer = snapshot.independent_openai?.result?.answers?.[questionName]
  const alignment = snapshot.independent_openai?.alignment?.questions?.[questionName]
  if (independentAnswer !== undefined || alignment !== undefined) {
    bundle.independent_openai = {
      ...(independentAnswer !== undefined ? { answer: independentAnswer } : {}),
      ...(alignment !== undefined ? { alignment } : {}),
    }
  }

  const aiQuestion = snapshot.ai_evaluation?.questions?.[questionName]
  if (aiQuestion !== undefined) bundle.ai_evaluation = aiQuestion

  return bundle
}

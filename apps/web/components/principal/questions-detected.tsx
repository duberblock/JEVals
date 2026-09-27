import { fill } from '../../lib/i18n/format'
import type { Dictionary } from '../../lib/i18n'
import type { DetectedQuestion } from '../../lib/validation-state'

// QUESTIONS DETECTED detail (plan 19.1): per-question rows derived exclusively
// from questions[name].type, plus the compact per-count summary when several
// questions share types.
export function QuestionsDetected({
  questions,
  dictionary,
}: {
  questions: DetectedQuestion[]
  dictionary: Dictionary['principal']['validation']
}) {
  const counts = countByPrimitive(questions)
  const hasRepeatedTypes = [...counts.values()].some((count) => count > 1)
  const detectedLine =
    questions.length === 1
      ? fill(dictionary.questionDetectedOne, { count: questions.length })
      : fill(dictionary.questionsDetected, { count: questions.length })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-success">✓ {dictionary.valid}</p>
        <p className="text-sm font-bold tracking-wide">{detectedLine}</p>
      </div>

      {hasRepeatedTypes ? <p className="text-sm text-muted-foreground">{summaryLine(questions)}</p> : null}

      <dl className="space-y-1.5">
        {questions.map((question, index) => (
          <div className="flex items-baseline gap-3 text-sm" key={question.name}>
            <dt className="w-8 shrink-0 text-muted-foreground">Q{index + 1}</dt>
            {/* P36/FB9: wrap-anywhere + min-w-0 — long request-derived labels must wrap, never break the box (§16).
                This panel keeps truncate (compact-panel ruling) and GAINS title so the full name is reachable. */}
            <dd className="min-w-0 flex-1 truncate font-mono" title={question.name}>{question.name}</dd>
            <dd className="shrink-0 font-bold tracking-wide">{question.primitive.toUpperCase()}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-muted-foreground">{dictionary.detectionSource}</p>
    </div>
  )
}

function countByPrimitive(questions: DetectedQuestion[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const question of questions) {
    counts.set(question.primitive, (counts.get(question.primitive) ?? 0) + 1)
  }
  return counts
}

export function summaryLine(questions: DetectedQuestion[]): string {
  // "2 Choice · 2 Score · 1 Noul" in first-appearance order.
  const counts = countByPrimitive(questions)
  const order: string[] = []
  for (const question of questions) {
    if (!order.includes(question.primitive)) order.push(question.primitive)
  }
  const label = (primitive: string) => primitive.charAt(0).toUpperCase() + primitive.slice(1)
  return order.map((primitive) => `${counts.get(primitive)} ${label(primitive)}`).join(' · ')
}

export function uniqueTypeList(questions: DetectedQuestion[]): string {
  // "Choice / Score / Noul" for the mobile compact line (plan 19.1).
  const order: string[] = []
  for (const question of questions) {
    if (!order.includes(question.primitive)) order.push(question.primitive)
  }
  const label = (primitive: string) => primitive.charAt(0).toUpperCase() + primitive.slice(1)
  return order.map(label).join(' / ')
}

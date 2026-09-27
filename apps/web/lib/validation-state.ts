// Shared state machine for the JSON validation / detection panel (plan 19.1).
// The panel is a single visual block: VALID and QUESTIONS DETECTED live
// together, and any failure replaces VALID with the domain error.

export type QuestionPrimitive = 'choice' | 'score' | 'noul'

export type DetectedQuestion = {
  name: string
  primitive: QuestionPrimitive
}

export type ValidationState =
  | { kind: 'empty' }
  | { kind: 'syntax-error'; message: string }
  | { kind: 'checking' }
  | { kind: 'valid'; questions: DetectedQuestion[] }
  | { kind: 'invalid'; title: string; detail: string }

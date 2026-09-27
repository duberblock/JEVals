import { describe, expect, it } from 'vitest'

import type { ExecutionSnapshot } from '../../lib/execution-snapshot'
import { summarizeSnapshot } from '../../lib/execution-snapshot'
import { compareSnapshot } from '../fixtures/investigation-snapshot'
import { emulatorFailedSnapshot, judgeFailedSnapshot, jevFailedSnapshot } from '../fixtures/operation-snapshots'

// C7 (FASE C / G2): the per-source strip derives STRICTLY from the persisted
// sections' own status fields — absent means null (not run), never 'failed'.
describe('summarizeSnapshot — per-source status strip (C7)', () => {
  it('marks all four sources success on a full compare+judge+independent run', () => {
    const summary = summarizeSnapshot(compareSnapshot())

    expect(summary.sources).toEqual({
      emulator: 'success',
      jev: 'success',
      judge: 'success',
      independent: 'success',
    })
  })

  it('marks jev failed on the section 66 partial while judge/independent stay not-run', () => {
    const summary = summarizeSnapshot(jevFailedSnapshot())

    expect(summary.sources).toEqual({
      emulator: 'success',
      jev: 'failed',
      judge: null,
      independent: null,
    })
  })

  it('keeps jev/judge/independent null on an emulator-only run (never failed)', () => {
    const emulatorOnly: ExecutionSnapshot = {
      ...compareSnapshot(),
      mode: 'emulator',
      jev: undefined,
      comparison: undefined,
      ai_evaluation: undefined,
      independent_openai: undefined,
    }

    const summary = summarizeSnapshot(emulatorOnly)

    expect(summary.sources).toEqual({
      emulator: 'success',
      jev: null,
      judge: null,
      independent: null,
    })
  })

  // THE G2 case: a failed Judge renders no §32 AI summary line — the strip is
  // what makes the failure visible on Principal.
  it('marks judge failed when the ai_evaluation section failed', () => {
    const summary = summarizeSnapshot(judgeFailedSnapshot())

    expect(summary.sources.judge).toBe('failed')
    expect(summary.semanticDivergence).toBeNull()
  })

  it('marks the mandatory emulator leg failed when its section failed', () => {
    const summary = summarizeSnapshot(emulatorFailedSnapshot())

    expect(summary.sources.emulator).toBe('failed')
  })
})

// C5 (FASE C): the context bar renders snapshot.mode verbatim and the
// provider models of the sections that ran — collected in source order
// (emulator, jev, ai_evaluation, independent_openai), deduped preserving first
// occurrence, never invented (§63: no names without persisted evidence).
// FB2 (R40/P29) supersedes the raw-emulator pins here: the emulator entry of
// these SUMMARY surfaces shows the display alias 'Emulator 0.0.1' (see the
// FB2 describe below) — the other sources keep their real models.
describe('summarizeSnapshot — context-bar facts (C5)', () => {
  it('carries mode verbatim and collects the provider models in source order', () => {
    const summary = summarizeSnapshot(compareSnapshot())

    expect(summary.mode).toBe('compare-and-evaluate')
    expect(summary.providers).toEqual(['Emulator 0.0.1', 'jev-latest', 'judge-llm', 'gpt-4o-mini'])
  })

  it('dedupes repeated models preserving the first occurrence', () => {
    const base = compareSnapshot()
    const snapshot: ExecutionSnapshot = {
      ...base,
      emulator: { ...base.emulator!, model: 'gpt-4o-mini' },
      jev: { ...base.jev!, model: 'jev-latest' },
      ai_evaluation: { ...base.ai_evaluation!, model: 'gpt-4o-mini' },
    }

    const summary = summarizeSnapshot(snapshot)

    // FB2 (P29): the emulator entry displays the alias regardless of its raw
    // model, so the dedupe now collapses judge/independent (both gpt-4o-mini) —
    // the first-occurrence pin survives with the alias leading the list.
    expect(summary.providers).toEqual(['Emulator 0.0.1', 'jev-latest', 'gpt-4o-mini'])
  })

  it('skips empty model strings and stays empty when no section carried a model', () => {
    const snapshot: ExecutionSnapshot = {
      ...compareSnapshot(),
      emulator: { status: 'success', model: '' },
      jev: undefined,
      comparison: undefined,
      ai_evaluation: undefined,
      independent_openai: undefined,
    }

    const summary = summarizeSnapshot(snapshot)

    expect(summary.providers).toEqual([])
    expect(summary.mode).toBe('compare-and-evaluate')
  })
})

// FB2 (R40/P29, docs/feedback-v1-ux.md §FB2): summary/display surfaces show
// the alias 'Emulator 0.0.1' wherever the emulator's MODEL string renders —
// a §9 category-4 purely visual UI label (owner-approved), not provenance.
// Evidence §44, Copy/Download and the persisted payload keep the REAL model.
describe('summarizeSnapshot — FB2 emulator display alias (P29)', () => {
  it("shows 'Emulator 0.0.1' as the summary model and as the emulator providers entry", () => {
    const summary = summarizeSnapshot(compareSnapshot())

    expect(summary.model).toBe('Emulator 0.0.1')
    expect(summary.providers).toContain('Emulator 0.0.1')
  })

  it('substitutes only when a real emulator model exists — absent model renders nothing', () => {
    const snapshot: ExecutionSnapshot = {
      ...compareSnapshot(),
      emulator: { status: 'success' },
    }

    const summary = summarizeSnapshot(snapshot)

    expect(summary.model).toBe('')
    expect(summary.providers).not.toContain('Emulator 0.0.1')
  })

  it('keeps the REAL jev/judge/independent models untouched (alias is emulator-only)', () => {
    const summary = summarizeSnapshot(compareSnapshot())

    expect(summary.jevModel).toBe('jev-latest')
    expect(summary.providers).toEqual(['Emulator 0.0.1', 'jev-latest', 'judge-llm', 'gpt-4o-mini'])
  })

  it('never mutates the snapshot: the raw payload keeps the real emulator model', () => {
    const snapshot = compareSnapshot()
    summarizeSnapshot(snapshot)

    // Evidence §44 / Copy / Download serialize THIS object — the alias lives
    // only in the summary, never in the persisted payload.
    expect(snapshot.emulator?.model).toBe('jev-emulator')
  })
})

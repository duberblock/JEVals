'use client'

import { BottomDrawer } from './bottom-drawer'
import { QuestionsDetected, uniqueTypeList } from './questions-detected'
import { ScenarioBox } from '../shared/scenario-box'
import { fill } from '../../lib/i18n/format'
import type { Dictionary } from '../../lib/i18n'
import type { EntryState } from '../../lib/execution-snapshot'
import type { ValidationState } from '../../lib/validation-state'

// Validation panel / detection panel (plan 19.1): one visual block where
// VALID and QUESTIONS DETECTED live together. Desktop (>= lg) shows the full
// detail inline; mobile (< lg) collapses to one compact line that opens a
// Bottom Drawer with the same detail.
// P47 (a): the panel also carries the scenario box under the questions
// detected — fed by the LIVE editor parse (scenarioState), NOT by the
// /validations API: the box shows the moment the JSON parses with a non-null
// state, even while the API verdict is still pending or has failed.
export function ValidationPanel({
  scenario,
  scenarioState = null,
  state,
  dictionary,
}: {
  scenario?: Dictionary['scenario']
  scenarioState?: EntryState | null
  state: ValidationState
  dictionary: Dictionary['principal']['validation']
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4" data-testid="validation-panel">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.title}</p>
      {state.kind === 'empty' ? <p className="text-sm text-muted-foreground">{dictionary.waiting}</p> : null}

      {state.kind === 'checking' ? <p className="text-sm text-muted-foreground">{dictionary.checking}</p> : null}

      {state.kind === 'syntax-error' ? (
        <div className="space-y-1">
          <p className="text-sm font-bold text-destructive">✗ {dictionary.syntaxError}</p>
          <p className="font-mono text-xs text-muted-foreground">{state.message}</p>
        </div>
      ) : null}

      {state.kind === 'invalid' ? (
        <div className="space-y-1">
          <p className="text-sm font-bold text-destructive">✗ {state.title}</p>
          <p className="text-sm text-muted-foreground">{state.detail}</p>
        </div>
      ) : null}

      {state.kind === 'valid' ? (
        <>
          <div className="hidden lg:block">
            <QuestionsDetected dictionary={dictionary} questions={state.questions} />
          </div>
          <div className="lg:hidden">
            <BottomDrawer
              closeLabel={dictionary.close}
              label={fill(
                state.questions.length === 1 ? dictionary.mobileSummaryOne : dictionary.mobileSummary,
                { count: state.questions.length, types: uniqueTypeList(state.questions) }
              )}
              title={dictionary.valid}
            >
              <QuestionsDetected dictionary={dictionary} questions={state.questions} />
            </BottomDrawer>
          </div>
        </>
      ) : null}

      {/* P47 (a): the scenario box under the questions detected (under the
          mobile compact line on < lg — the compact line IS that summary).
          Rendered from the LIVE parse alone, so every verdict state above
          (checking, invalid, valid) can sit next to it honestly; null state
          means NO box — never an empty one. */}
      {scenarioState !== null && scenario ? (
        <div className="space-y-1 pt-1">
          <ScenarioBox dictionary={scenario} state={scenarioState} />
        </div>
      ) : null}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { Drawer } from '@base-ui/react/drawer'

import { BottomDrawer } from '../principal/bottom-drawer'
import { Button } from '../ui/button'
import { CopyButton } from './copy-button'
import { FullLlmExchange } from './full-llm-exchange'
import { PayloadBlock } from './payload-block'
import type { ExecutionSnapshot } from '../../lib/execution-snapshot'
import { buildAnalysisBundle } from '../../lib/investigation/analysis-bundle'
import { downloadJson } from '../../lib/investigation/download'
import { fill } from '../../lib/i18n/format'
import type { Dictionary } from '../../lib/i18n'

// The six §43 evidence sources, in canonical order.
export type EvidenceSource = 'request' | 'emulator' | 'jev' | 'ai' | 'independent' | 'full'

export const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  'request',
  'emulator',
  'jev',
  'ai',
  'independent',
  'full',
]

export function isEvidenceSource(value: string | null): value is EvidenceSource {
  return value !== null && (EVIDENCE_SOURCES as readonly string[]).includes(value)
}

// EVIDENCE (plan sections 43-45.4): exact payload inspection with per-source
// copy actions (§45.1), the per-question analysis bundle (§45.2), the Full
// LLM Exchange (§45) and Find (§45.4). Never shown simultaneously with WHY
// explanations (§34).
export function EvidenceView({
  dictionary,
  onSourceChange,
  questionName,
  snapshot,
  source,
}: {
  dictionary: Dictionary['investigation']
  onSourceChange: (source: EvidenceSource) => void
  questionName: string
  snapshot: ExecutionSnapshot
  source: EvidenceSource
}) {
  const [find, setFind] = useState('')
  const findInputRef = useRef<HTMLInputElement>(null)

  // §45.4: Ctrl/Cmd + F focuses the payload Find while Evidence is mounted.
  useEffect(() => {
    function focusFind(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        findInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusFind)
    return () => window.removeEventListener('keydown', focusFind)
  }, [])

  const sources = dictionary.sources as Record<EvidenceSource, string>
  const titles = dictionary.titles as Record<EvidenceSource, string>

  return (
    <section className="space-y-4" data-testid="evidence-view">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.evidenceTab}</p>

      {/* §43 source selector: dropdown on desktop, Bottom Drawer on mobile —
          never six big tabs as primary navigation. */}
      <div className="space-y-2">
        <select
          aria-label={dictionary.sourceLabel}
          className="hidden h-11 rounded-lg border border-input bg-background px-3 text-base lg:block"
          data-testid="source-select"
          id="evidence-source"
          onChange={(event) => onSourceChange(event.target.value as EvidenceSource)}
          value={source}
        >
          {EVIDENCE_SOURCES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {sources[candidate]}
            </option>
          ))}
        </select>
        <div className="lg:hidden">
          <BottomDrawer
            closeLabel={dictionary.close}
            label={`${dictionary.sourceLabel}: ${sources[source]} ▾`}
            title={dictionary.sourceLabel}
          >
            <ul className="space-y-1">
              {EVIDENCE_SOURCES.map((candidate) => (
                <li key={candidate}>
                  <Drawer.Close
                    aria-current={candidate === source ? 'true' : undefined}
                    className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium hover:bg-muted"
                    onClick={() => onSourceChange(candidate)}
                  >
                    {sources[candidate]}
                  </Drawer.Close>
                </li>
              ))}
            </ul>
          </BottomDrawer>
        </div>
      </div>

      {/* §45.4 Find over the active payload + §45.2 Copy analysis bundle. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={dictionary.find.label}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base sm:w-56"
          data-testid="find-input"
          onChange={(event) => setFind(event.target.value)}
          ref={findInputRef}
          placeholder={dictionary.find.label}
          type="search"
          value={find}
        />
        <CopyButton
          copiedLabel={dictionary.copied}
          label={dictionary.copyAnalysisBundle}
          size="sm"
          value={() => JSON.stringify(buildAnalysisBundle(snapshot, questionName), null, 2)}
        />
      </div>

      {source === 'request' ? (
        <PayloadBlock
          copiedLabel={dictionary.copied}
          copyLabel={dictionary.copyRequest}
          dictionary={dictionary}
          query={find}
          title={titles.request}
          value={snapshot.request}
        />
      ) : null}

      {source === 'emulator' ? (
        snapshot.emulator ? (
          <PayloadBlock
            // P37/FB10: an emulator-only run reframes this run-wide payload as
            // THE answer; on a compare run the Emulator is one of two sources
            // and carries no caption.
            caption={snapshot.mode === 'emulator' ? dictionary.emulatorEvidenceCaption : undefined}
            copiedLabel={dictionary.copied}
            copyLabel={dictionary.copyResponse}
            dictionary={dictionary}
            query={find}
            title={titles.emulator}
            value={snapshot.emulator.result ?? snapshot.emulator}
          />
        ) : (
          <UnavailableNote dictionary={dictionary} title={titles.emulator} />
        )
      ) : null}

      {source === 'jev' ? (
        snapshot.jev ? (
          <PayloadBlock
            copiedLabel={dictionary.copied}
            copyLabel={dictionary.copyResponse}
            dictionary={dictionary}
            query={find}
            title={titles.jev}
            value={snapshot.jev.result ?? snapshot.jev}
          />
        ) : (
          <UnavailableNote dictionary={dictionary} title={titles.jev} />
        )
      ) : null}

      {source === 'independent' ? <IndependentPayload dictionary={dictionary} find={find} snapshot={snapshot} /> : null}

      {source === 'ai' ? <AiPayload dictionary={dictionary} find={find} snapshot={snapshot} /> : null}

      {source === 'full' ? (
        <PayloadBlock
          actions={
            <Button
              onClick={() => downloadJson(`${snapshot.execution_id}.json`, snapshot)}
              size="xs"
              type="button"
              variant="outline"
            >
              {dictionary.download}
            </Button>
          }
          copiedLabel={dictionary.copied}
          copyLabel={dictionary.copyExecutionBundle}
          dictionary={dictionary}
          query={find}
          title={titles.full}
          value={snapshot}
        />
      ) : null}
    </section>
  )
}

// §44 Independent: INPUT is the original request only (§11 — the
// prediction was never shown the comparison); OUTPUT is the structured
// prediction. The §45 llm_attempts render as inspectable exchanges.
function IndependentPayload({
  dictionary,
  find,
  snapshot,
}: {
  dictionary: Dictionary['investigation']
  find: string
  snapshot: ExecutionSnapshot
}) {
  const independent = snapshot.independent_openai
  if (!independent) {
    return <UnavailableNote dictionary={dictionary} title={dictionary.titles.independent} />
  }
  // §11: the INPUT is the original request exactly as the prediction saw it —
  // state, questions and the optional model override when the request carried
  // one (the key is omitted when it did not).
  const request = snapshot.request
  const input = {
    state: request?.state ?? {},
    questions: request?.questions ?? {},
    ...(request?.model !== undefined ? { model: request.model } : {}),
  }
  return (
    <div className="space-y-4">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.titles.independent}</p>
      <PayloadBlock
        caption={dictionary.inputCaption}
        copiedLabel={dictionary.copied}
        copyLabel={dictionary.copyInput}
        dictionary={dictionary}
        query={find}
        title={dictionary.inputTitle}
        value={input}
      />
      <PayloadBlock
        caption={dictionary.outputCaption}
        copiedLabel={dictionary.copied}
        copyLabel={dictionary.copyOutput}
        dictionary={dictionary}
        query={find}
        title={dictionary.outputTitle}
        value={independent.result ?? independent}
      />
      {independent.llm_attempts && independent.llm_attempts.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-bold tracking-widest text-muted-foreground">{dictionary.llmExchangesTitle}</p>
          {independent.llm_attempts.map((attempt, index) => (
            <PayloadBlock
              copiedLabel={dictionary.copied}
              dictionary={dictionary}
              key={index}
              query={find}
              title={fill(dictionary.attemptLabel, { index: index + 1 })}
              value={attempt}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// §44 AI Evaluation: the structured Judge output plus the §45 Full LLM
// Exchange behind an explicit reveal.
function AiPayload({
  dictionary,
  find,
  snapshot,
}: {
  dictionary: Dictionary['investigation']
  find: string
  snapshot: ExecutionSnapshot
}) {
  // §45: the exchange never appears expanded by default.
  const [exchangeOpen, setExchangeOpen] = useState(false)
  const evaluation = snapshot.ai_evaluation
  if (!evaluation) {
    return <UnavailableNote dictionary={dictionary} title={dictionary.titles.ai} />
  }
  if (evaluation.status !== 'success') {
    return (
      <PayloadBlock
        copiedLabel={dictionary.copied}
        dictionary={dictionary}
        query={find}
        title={dictionary.titles.ai}
        value={evaluation}
      />
    )
  }
  const structured = {
    overall: evaluation.overall ?? null,
    questions: evaluation.questions ?? null,
  }
  return (
    <div className="space-y-3">
      <PayloadBlock
        caption={dictionary.structuredJudgeOutput}
        copiedLabel={dictionary.copied}
        copyLabel={dictionary.copyEvaluation}
        dictionary={dictionary}
        query={find}
        title={dictionary.titles.ai}
        value={structured}
      />
      {evaluation.evidence ? (
        <>
          <Button
            aria-expanded={exchangeOpen}
            onClick={() => setExchangeOpen((open) => !open)}
            size="sm"
            type="button"
            variant="outline"
          >
            {dictionary.viewFullLlmExchange}
          </Button>
          {exchangeOpen ? (
            <FullLlmExchange
              dictionary={dictionary}
              evidence={evaluation.evidence}
              parsedResult={structured}
              query={find}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function UnavailableNote({ dictionary, title }: { dictionary: Dictionary['investigation']; title: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-bold tracking-widest text-muted-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{dictionary.sourceUnavailable}</p>
    </div>
  )
}

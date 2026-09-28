'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { AdvancedPanel } from './advanced-panel'
import { ExecutionContextBar, type ContextBarState } from './execution-context-bar'
import { HeroResult } from './hero-result'
import { JsonInput } from './json-input'
import { ModeSelector, type RunMode } from './mode-selector'
import { ProviderHealthChips } from './provider-health-chips'
import { QuestionResults } from './question-results'
import { RecentExecutions } from './recent-executions'
import { RequestBlock } from './request-block'
import { SourceStatusStrip } from './source-status-strip'
import { ValidationPanel } from './validation-panel'
import { ScenarioBox } from '../shared/scenario-box'
import { Button } from '../ui/button'
import type {
  AiEvaluationSection,
  Comparison,
  EmulatorAnswer,
  EntryState,
  ExecutionSnapshot,
  ExecutionSummary,
  IndependentOpenaiSection,
  QuestionComparison,
  SourceRunStatus,
  SourceStatusStrip as SourceStatuses,
} from '../../lib/execution-snapshot'
import { progressiveSummary, shortExecutionId, summarizeSnapshot } from '../../lib/execution-snapshot'
import { fill } from '../../lib/i18n/format'
import { useDictionary } from '../../lib/i18n/use-locale'
import { isSseResponse, parseSseFrame, splitSseFrames } from '../../lib/sse'
import { SAMPLE_SYSTEM_ONE_REQUEST } from '../../lib/sample-request'
import { clearSessionCase, readSessionCase, setSessionCase } from '../../lib/session-case'
import type { DetectedQuestion, ValidationState } from '../../lib/validation-state'

// Debounce for the POST /api/v1/validations call (plan section 19: check on edit).
const VALIDATION_DEBOUNCE_MS = 350

// C11 (FASE C): the in-flight strip invents NO per-source states — every chip
// without an observed event renders the neutral in-flight glyph while the run
// resolves. P28 (FB1): chips whose §65 section event already arrived on the
// SSE stream render that OBSERVED state instead (still never invented).
const IN_FLIGHT_SOURCES: SourceStatuses = {
  emulator: null,
  jev: null,
  judge: null,
  independent: null,
}

// P28 (FB1): SSE parsing lives in lib/sse.ts (pure, unit-tested) — frame
// splitting, frame parsing and the lane sniff are shared wire contract.

type SseSectionEvent = { section: string; status: string; payload?: unknown }

// P39: the envelope's system_one of the run in flight — the progressive rows
// read its questions for the score criteria labels (score ↔ descriptions).
// P47: the scenario box (b) reads its state during the run (the same
// envelope, the same single source as the progressive rows).
type PostedSystemOne = { state?: EntryState; questions?: Record<string, { type?: string; criteria?: unknown }> }

// P47 (a): LIVE client-side parse of the editor for the validation panel's
// scenario box — the same jsonText that feeds §19.1. A syntactically valid
// JSON with a non-null state yields the state; anything else (parse failure,
// empty editor, absent or null state) yields null = NO box. This source never
// touches the /validations API: the box shows the moment the JSON parses,
// while the API verdict is still pending or has failed.
function parseLiveScenario(text: string): EntryState | null {
  if (text.trim() === '') return null
  try {
    const parsed = JSON.parse(text) as { state?: EntryState }
    return parsed.state ?? null
  } catch {
    return null
  }
}

// P39: deterministic compare facts accumulated from the SSE section payloads
// — everything the §29/§30 rows need, rendered the moment the comparison
// frame arrives while a LLM leg (the Judge, or the Independent when it
// composes) is still in flight. The pending flags name the LLM legs the
// POSTED envelope expects that have not resolved yet — pending is a live
// observation, never an absence statement (nothing here ever claims a leg
// "did not run": only the final snapshot may say that).
// P41: `summary` carries the progressive HERO facts — the SAME derivation as
// the landed hero (progressiveSummary in lib/execution-snapshot.ts reuses
// summarizeSnapshot's core), rebuilt whenever a section that feeds it lands.
type ProgressiveResult = {
  emulatorAnswers: Record<string, EmulatorAnswer>
  jevAnswers: Record<string, EmulatorAnswer>
  comparisonQuestions: Record<string, QuestionComparison>
  judgePending: boolean
  independentPending: boolean
  summary: ExecutionSummary
}

// P39: a §47 side section's answers — present only when the section arrived
// with a result block carrying answers (never invented, never a re-derivation).
function sectionAnswers(payload: unknown): Record<string, EmulatorAnswer> | null {
  const answers = (payload as { result?: { answers?: Record<string, EmulatorAnswer> } } | undefined)?.result?.answers
  return answers ? answers : null
}

// P41: a section's full payload — the snapshot-shaped JSON its wire name
// carries (emulator/jev/comparison/judge/independent), undefined when the
// frame has not arrived yet.
function sectionPayload<T>(event: SseSectionEvent | undefined): T | undefined {
  return event?.payload as T | undefined
}

// The section names that own a chip (comparison deliberately has none: it is
// not a §47 source section but the deterministic compute over two of them).
type ChipKey = 'emulator' | 'jev' | 'judge' | 'independent'

const CHIP_KEYS: readonly ChipKey[] = ['emulator', 'jev', 'judge', 'independent']

// C7 parity rule, same as the completed state's sourceRunStatus derivation:
// anything other than 'success' reads as failed — an unknown state never
// renders as success (§63: never invent states).
function observedStatus(status: string): SourceRunStatus {
  return status === 'success' ? 'success' : 'failed'
}

type ValidationsResponse =
  | { valid: true; questions: DetectedQuestion[] }
  | { valid: false; error: { title: string; detail: string } }

type ProblemBody = { title?: string; detail?: string }

// GET /api/v1/capabilities subset the page consumes (plan section 63). openai
// available means BOTH the key and the model are configured server-side.
type CapabilitiesResponse = {
  emulator?: { available?: boolean }
  jev?: { available?: boolean }
  openai?: { available?: boolean }
}

// C8 (FASE C): tri-state provider health (§63 extension) for the pre-run
// chips — null = unknown (fetch pending or failed).
type ProviderHealth = { emulator: boolean | null; jev: boolean | null; openai: boolean | null }

// §63 tri-state: only an EXPLICIT available flag reads true/false — a
// missing key or a failed fetch stays unknown (never invented either way).
function triState(available: boolean | undefined): boolean | null {
  return available === true ? true : available === false ? false : null
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'completed'; snapshot: ExecutionSnapshot }
  | { kind: 'failed'; title: string; detail: string; executionId?: string }

export function PrincipalView() {
  const { locale, dictionary } = useDictionary()
  // P34 (FB7): the URL entry param (/?execution=<id>) — read once at mount,
  // never on re-renders (internal recents clicks don't touch the URL).
  const searchParams = useSearchParams()
  const [jsonText, setJsonText] = useState('')
  const [validation, setValidation] = useState<ValidationState>({ kind: 'empty' })
  const [run, setRun] = useState<RunState>({ kind: 'idle' })
  const [recentReloadToken, setRecentReloadToken] = useState(0)
  const [mode, setMode] = useState<RunMode>('emulator')
  // C8 (FASE C): tri-state provider health (§63 extension) — null = unknown
  // (fetch pending or failed), which the chips render as '…' and NEVER as ✗.
  const [capabilities, setCapabilities] = useState<ProviderHealth>({ emulator: null, jev: null, openai: null })
  // Advanced (section 11): the independent LLM prediction composes with any
  // mode; unchecked omits the advanced key from the run body entirely.
  const [independentLlm, setIndependentOpenai] = useState(false)
  // P28 (FB1): observed §65 section states of the run in flight, feeding the
  // C11 in-flight strip. Reset to the neutral map on every new run.
  const [sectionProgress, setSectionProgress] = useState<SourceStatuses>(IN_FLIGHT_SOURCES)
  // P39: progressive rows built from the accumulated section payloads while
  // the LLM legs fly. Reset wherever the observed section map resets (a new
  // run, Clear, a hydration) so no state of a previous run ever survives.
  const [progressiveResult, setProgressiveResult] = useState<ProgressiveResult | null>(null)
  // P39: the posted envelope's system_one of the run in flight (see
  // executeRequest — written before the POST, one parse feeding both the ref
  // and the request body).
  const postedRequestRef = useRef<PostedSystemOne | null>(null)
  // P42: the wall-clock anchor of the run in flight — Date.now() captured
  // just BEFORE the POST (the owner's ~60s budget covers the WHOLE run, not
  // just the post-comparison tail), feeding the progressive hero's
  // deterministic run-progress bar. Nulled wherever the run's surface resets
  // (Clear, hydration, a B3 edit invalidation); a new run re-arms it fresh
  // pre-POST, so no clock of a previous run ever survives into another.
  const runStartedAtRef = useRef<number | null>(null)
  // P30 (FB3): the execution Principal was HYDRATED from (a recent click),
  // driving the "Loaded from execution <short>" chip. Null for every fresh
  // run, after Clear, and once an edit invalidates the hydrated result.
  const [origin, setOrigin] = useState<{ executionId: string } | null>(null)
  // P46 (R61): the request block's disclosure state — LOCAL UI state of
  // PrincipalView (never URL, never storage). EXPANDED by default: with no
  // run and no case there is nothing to cede the surface to. The automatic
  // triggers (a run arming its POST, a hydration landing) set it to false
  // and thereby PISA any prior manual choice (T2.7); only Clear re-expands
  // automatically (T2.3) — landing a result never does (T2.4).
  const [requestOpen, setRequestOpen] = useState(true)
  // P46 (T2.5): the B3 freshness marker of the collapsed summary — TRUE
  // while the live editor diverges from the text that produced the current
  // result/hydration. producedJsonRef deliberately does NOT null out with
  // the B3 invalidation (runJsonRef does): the marker must SURVIVE the death
  // of the result it talks about — the divergence is still true. It re-pins
  // (marker off) on every new run and hydration, and nulls on Clear.
  const producedJsonRef = useRef<string | null>(null)
  const [requestEdited, setRequestEdited] = useState(false)

  useEffect(() => {
    let active = true
    async function loadCapabilities() {
      try {
        const response = await fetch('/api/v1/capabilities')
        const data = (await response.json()) as CapabilitiesResponse
        if (!active) return
        setCapabilities({
          emulator: triState(data.emulator?.available),
          jev: triState(data.jev?.available),
          openai: triState(data.openai?.available),
        })
      } catch {
        // Capabilities are secondary: the page never blocks on them.
      }
    }
    void loadCapabilities()
    return () => {
      active = false
    }
  }, [])

  // Gating derives truthiness (§63 conservative, unchanged): unknown gates
  // modes OFF exactly as the old false-defaulting booleans did.
  const jevAvailable = capabilities.jev === true
  const llmAvailable = capabilities.openai === true

  // Spec guard: if a gated selection was made and the capabilities arrive
  // saying its prerequisite is unavailable, fall back honestly — compare
  // needs JEV, evaluate needs JEV AND LLM, the advanced checkbox needs LLM.
  useEffect(() => {
    if (!jevAvailable && mode === 'compare') setMode('emulator')
    if ((!jevAvailable || !llmAvailable) && mode === 'compare-and-evaluate') setMode('emulator')
    if (!llmAvailable && independentLlm) setIndependentOpenai(false)
  }, [jevAvailable, llmAvailable, mode, independentLlm])

  // Latest-ref view of the dictionary (F6): the debounced validation callback
  // needs the unreachable copy in the CURRENT locale, but the dictionary must
  // stay out of the effect deps — a locale switch must not re-fire a spurious
  // /validations POST (no "checking" flash) when the JSON did not change.
  const dictionaryRef = useRef(dictionary)
  // Written in an effect (not during render) per react-hooks/refs; the
  // debounced callback reads it only after commit, so semantics are unchanged.
  useEffect(() => {
    dictionaryRef.current = dictionary
  }, [dictionary])

  // B3 (Judge F4): the exact jsonText that produced the current run. The
  // hero asserts fidelity numbers tied to that one request, so any later edit
  // must invalidate the rendered result (see handleJsonChange). Null when no
  // run is associated with the current run state.
  const runJsonRef = useRef<string | null>(null)

  // W2 (R41 dual-review): imperative staleness guards for hydration. An
  // effect-mirrored ref only flushes after commit and leaves a micro-window,
  // so these are written SYNCHRONOUSLY: runInFlightRef where the run starts
  // and lands (landRun), jsonTextRef at every setJsonText site, and
  // hydrateEpochRef on every recent click. A detail GET that resolves late
  // re-checks all three and drops itself — the newer intent always wins.
  const runInFlightRef = useRef(false)
  const jsonTextRef = useRef('')
  const hydrateEpochRef = useRef(0)

  // W2: the single funnel for every run landing (all terminal paths of the
  // JSON and SSE lanes) — clears the imperative in-flight flag so a hydration
  // resolving afterwards sees the surface as free again.
  function landRun(next: RunState) {
    runInFlightRef.current = false
    setRun(next)
  }

  // P45 (R62, T1.2): the run-landing arm of the session case — every terminal
  // run landing with a REAL id (a completed snapshot, or a failure whose
  // problem carried the persisted execution_id — emulator/compare/evaluate
  // and §66 partials alike, T1.10) makes that run the case in consultation.
  // Terminal-free interruptions never reach here with an id and set nothing.
  // Used ONLY at run call sites: hydration GET failures also land through
  // landRun, and a failed GET must never set the session (T1.2).
  function landRunRememberingCase(next: RunState) {
    if (next.kind === 'completed' && next.snapshot.execution_id) {
      setSessionCase(next.snapshot.execution_id)
    } else if (next.kind === 'failed' && next.executionId) {
      setSessionCase(next.executionId)
    }
    landRun(next)
  }

  // Client-side syntax check on every change + debounced SDK validation via
  // the API proxy. Syntax errors never hit the server (plan section 19).
  useEffect(() => {
    if (jsonText.trim() === '') {
      setValidation({ kind: 'empty' })
      return
    }

    try {
      JSON.parse(jsonText)
    } catch (error) {
      setValidation({ kind: 'syntax-error', message: error instanceof Error ? error.message : String(error) })
      return
    }

    setValidation({ kind: 'checking' })
    let active = true
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/v1/validations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: jsonText,
        })
        const data = (await response.json()) as ValidationsResponse | ProblemBody
        if (!active) return
        if ('valid' in data && data.valid === true) {
          setValidation({ kind: 'valid', questions: data.questions ?? [] })
        } else if ('valid' in data && data.valid === false) {
          setValidation({ kind: 'invalid', title: data.error.title, detail: data.error.detail })
        } else if (data.title && data.detail) {
          // RFC 7807 problem from the proxy (e.g. 502 API unreachable).
          setValidation({ kind: 'invalid', title: data.title, detail: data.detail })
        } else {
          setValidation({
            kind: 'invalid',
            title: dictionaryRef.current.principal.validation.unreachableTitle,
            detail: dictionaryRef.current.principal.validation.unreachableDetail,
          })
        }
      } catch {
        if (!active) return
        setValidation({
          kind: 'invalid',
          title: dictionaryRef.current.principal.validation.unreachableTitle,
          detail: dictionaryRef.current.principal.validation.unreachableDetail,
        })
      }
    }, VALIDATION_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [jsonText])

  const requestIsValid = validation.kind === 'valid'
  const runInFlight = run.kind === 'running'

  // B3: editing the JSON after a completed/failed run invalidates that run's
  // result — the old hero/rows (or failure banner) must not survive next to a
  // different request. The comparison is by exact text; once invalidated the
  // result only comes back with a new Run (pinned by tests). An edit while a
  // run is in flight does NOT cancel it: the run belongs to the text it was
  // started with, so its result still lands (the textarea stays editable even
  // though the Run button is disabled); only a LATER edit resets it.
  function handleJsonChange(next: string) {
    setJsonText(next)
    jsonTextRef.current = next
    // P46 (T2.6): an edit never expands or collapses the block — it only
    // moves the summary's LIVE signals. The marker compares against the
    // pinned produced text (which B3's nulling of runJsonRef below does NOT
    // touch, so "edited" survives the invalidation).
    setRequestEdited(producedJsonRef.current !== null && producedJsonRef.current !== next)
    const runInvalidated = run.kind !== 'idle' && runJsonRef.current !== null && runJsonRef.current !== next
    if (runInvalidated && run.kind !== 'running') {
      runJsonRef.current = null
      setRun({ kind: 'idle' })
      // P30 (FB3): the chip names the execution the RESULT came from — once
      // the editor diverges, that provenance no longer holds (B3 extended).
      setOrigin(null)
      // P42: the invalidated run's clock dies with its result — the idle
      // surface has nothing in flight to time.
      runStartedAtRef.current = null
    }
  }

  // P30 (FB3): clicking a recent execution hydrates Principal with the full
  // persisted snapshot (GET /api/v1/executions/{id}, the same route
  // Investigación reads). Hydration is read-only — it NEVER re-runs the
  // execution (§50: a re-POST would duplicate executions), so the restored
  // request/mode/advanced state land next to the persisted result as-is.
  // P45 (T1.3/W6): the SAME funnel serves the session-case consumption on
  // mount; `silent` marks that origin — a failed GET then discards quietly
  // (nobody asked for that case explicitly) instead of banner-landing.
  async function handleSelectExecution(executionId: string, options: { silent?: boolean } = {}) {
    // A click on a recent must never clobber a run in flight (its result
    // still belongs to the text it was started with — see handleJsonChange).
    if (run.kind === 'running' || runInFlightRef.current) return
    // P42: the hydration replaces the surface — whichever way the GET lands
    // (snapshot or failure banner), the previous run's clock must not survive
    // it. A fresh run re-arms the anchor pre-POST.
    runStartedAtRef.current = null
    // W2 (R41 dual-review): the hydration may only land if it is still the
    // freshest intent when the GET resolves. The epoch drops out-of-order
    // clicks; the editor snapshot drops typings made while the GET was open;
    // the in-flight flag drops hydrations a fresh run overtook.
    const epoch = ++hydrateEpochRef.current
    const textAtClick = jsonTextRef.current
    const stale = () =>
      runInFlightRef.current || jsonTextRef.current !== textAtClick || hydrateEpochRef.current !== epoch
    try {
      const response = await fetch(`/api/v1/executions/${encodeURIComponent(executionId)}`, { method: 'GET' })
      const data = (await response.json()) as ExecutionSnapshot & ProblemBody
      if (stale()) return
      // Any non-ok detail answer (404 included) is a load failure — the
      // problem's domain title/detail surface verbatim, loadFailedTitle
      // otherwise. No editor/origin state is touched: nothing was loaded.
      if (!response.ok) {
        // P45 (W6): a session-sourced GET that fails discards silently —
        // the screen keeps its normal state and the poisoned session entry
        // is dropped.
        if (options.silent) {
          clearSessionCase()
          return
        }
        landRun({
          kind: 'failed',
          title: data.title ?? dictionary.principal.loadFailedTitle,
          detail: data.detail ?? '',
          executionId,
        })
        return
      }
      const snapshot = data
      const text = JSON.stringify(snapshot.request ?? {}, null, 2)
      // B3 applies to hydrated results too: runJsonRef pins the exact text
      // behind the rendered snapshot, so a later edit invalidates it.
      runJsonRef.current = text
      // P46 (T2.3): a hydration that LANDS is a loaded case — the input
      // block collapses (completed and §66/failed snapshots alike: both are
      // cases) and the produced-text pin resets the summary's edited marker.
      // The failure branches above never reach here (nothing was loaded).
      producedJsonRef.current = text
      setRequestEdited(false)
      setRequestOpen(false)
      // The editor gets the request back; the §19.1 effect recalculates the
      // validation over it on its own (no stale verdict survives).
      setJsonText(text)
      jsonTextRef.current = text
      // Advanced derives from the snapshot (the flag is not persisted as a
      // checkbox state — its §47 section is the evidence it ran).
      setIndependentOpenai(Boolean(snapshot.independent_openai))
      if (snapshot.mode === 'emulator' || snapshot.mode === 'compare' || snapshot.mode === 'compare-and-evaluate') {
        // The §63 capabilities guard above clamps honestly if the mode's
        // prerequisites are unavailable in THIS environment.
        setMode(snapshot.mode)
      }
      setSectionProgress({ ...IN_FLIGHT_SOURCES })
      // P39: a hydration is a fresh surface — no progressive rows of the run
      // it replaces may survive next to the hydrated result.
      setProgressiveResult(null)
      setOrigin({ executionId })
      // P45 (T1.2/T1.3): a hydration WITH an id that lands SETS the session
      // case — recent clicks, ?execution= params and session consumption all
      // land here, so the visible case is always the one in consultation
      // (the param's landing re-sets it; the session's re-set is idempotent).
      setSessionCase(executionId)
      // A persisted §66/failed snapshot hydrates as the honest failure it
      // was — banner plus id, never a repainted hero.
      setRun(
        snapshot.status === 'completed'
          ? { kind: 'completed', snapshot }
          : { kind: 'failed', title: dictionary.hero.failedTitle, detail: '', executionId: snapshot.execution_id }
      )
    } catch {
      if (stale()) return
      // P45 (W6): silent discard for the session-sourced origin — see the
      // !response.ok branch above.
      if (options.silent) {
        clearSessionCase()
        return
      }
      landRun({
        kind: 'failed',
        title: dictionary.principal.loadFailedTitle,
        detail: '',
        executionId,
      })
    }
  }

  // P34 (FB7): URL entry — /?execution=<id> hydrates Principal on mount through
  // the SAME P30 handler (guards W2 intact: never clobbers a run, never
  // re-POSTs). One-shot: URL entry is a fresh mount; internal recents clicks
  // don't touch the URL. Latest-ref idiom (dictionaryRef/executeRequestRef
  // above): the mount effect reads the param and the handler through refs, so
  // a locale switch or any later re-render can never re-fire the detail GET
  // (re-hydrating would clobber the user's editing state).
  // Null-safe read: during prerender passes (and in component tests that
  // mount PrincipalView outside a navigation context) useSearchParams can be
  // null — no params object simply means no URL entry.
  const hydrationIdRef = useRef(searchParams?.get('execution') ?? null)
  const selectExecutionRef = useRef(handleSelectExecution)
  useEffect(() => {
    selectExecutionRef.current = handleSelectExecution
  })
  useEffect(() => {
    const hydrationId = hydrationIdRef.current
    if (hydrationId) {
      void selectExecutionRef.current(hydrationId)
      return
    }
    // P45 (T1.3): no URL param — consult the session case through the SAME
    // handler and ref (one-shot at mount, W2 guards intact by construction,
    // and the landing re-sets the session in the funnel's ok branch). W6: a
    // failed GET discards silently. W7: the storage read lives in the
    // effect, never in render.
    const sessionCase = readSessionCase()
    if (sessionCase) void selectExecutionRef.current(sessionCase, { silent: true })
  }, [])

  // P30 (FB3): Clear resets the workbench to its pre-run state — editor,
  // validation, result and provenance chip. The MODE deliberately stays: the
  // feedback enumerates what Clear resets and mode is not among it.
  // P45 (T1.5): the session case deliberately stays too — Clear resets the
  // EDITING view, not the case in consultation (Investigación/Operación keep
  // showing it after a Clear here).
  function handleClear() {
    setJsonText('')
    jsonTextRef.current = ''
    // Round-2 residual: with a virgin editor the text ref cannot distinguish
    // '' from '' — the epoch bump is what drops a GET resolving after Clear.
    hydrateEpochRef.current++
    setValidation({ kind: 'empty' })
    setRun({ kind: 'idle' })
    runJsonRef.current = null
    setOrigin(null)
    setIndependentOpenai(false)
    setSectionProgress({ ...IN_FLIGHT_SOURCES })
    // P39: Clear wipes the progressive rows with the rest of the result.
    setProgressiveResult(null)
    // P42: ...and the run clock with them — the pre-run state has no run to
    // time.
    runStartedAtRef.current = null
    // P46 (T2.3): Clear is the one automatic re-expansion — the pre-run
    // state has nothing to cede the surface to — and the produced-text pin
    // dies with the surface it described (no produced text, no edited
    // marker).
    producedJsonRef.current = null
    setRequestEdited(false)
    setRequestOpen(true)
  }

  // Plan section 19.1: never execute an invalid request. The Run button posts
  // the SELECTED mode (emulator, or compare when the capabilities allow it).
  async function executeRequest() {
    if (!requestIsValid || runInFlight) return
    runJsonRef.current = jsonText
    runInFlightRef.current = true
    // Round-2 residual: a run is a newer intent than any pending hydration —
    // bump the epoch so a slow GET that resolves after the run LANDS still
    // drops (landRun alone would have freed the in-flight flag).
    hydrateEpochRef.current++
    setRun({ kind: 'running' })
    // P30 (FB3): a fresh run is not "loaded from" anything — the origin chip
    // names the PROVENANCE of the current result, and a new result is the
    // user's own request, not a hydration.
    setOrigin(null)
    // P28: every run starts from the neutral in-flight strip — the observed
    // section map is reset, never carried over from a previous run.
    setSectionProgress({ ...IN_FLIGHT_SOURCES })
    // P39: same for the progressive rows — a new run never inherits the
    // previous run's accumulated sections.
    setProgressiveResult(null)
    try {
      // P39: the posted envelope's system_one, parsed once — the progressive
      // rows need its questions (criteria labels) before any final exists.
      const systemOne = JSON.parse(jsonText) as PostedSystemOne
      postedRequestRef.current = systemOne
      // P42: arm the run's wall-clock anchor RIGHT BEFORE the POST — the
      // ~60s budget the hero's progress bar is calibrated against covers the
      // whole flight (POST, deterministic legs and LLM legs alike).
      runStartedAtRef.current = Date.now()
      // P46 (T2.2/T2.3): the run-arming moment is also the input block's
      // automatic collapse — the result is about to own the surface (the
      // collapse PISES any manual expansion, T2.7) — and the produced-text
      // pin resets the summary's edited marker: this text IS the run.
      producedJsonRef.current = jsonText
      setRequestEdited(false)
      setRequestOpen(false)
      const response = await fetch('/api/v1/executions', {
        method: 'POST',
        // P28 (FB1): negotiate the SSE lane for progressive sections. The
        // server may still answer JSON (pre-stream problems, older API) —
        // the content-type sniff below degrades honestly to today's
        // handling, so the JSON contract stays byte-identical.
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          system_one: systemOne,
          mode,
          // Canonical default: the advanced key is OMITTED when the
          // independent LLM prediction is not requested.
          ...(independentLlm ? { advanced: { independent_openai_prediction: true } } : {}),
        }),
      })
      // Content-type sniff (lib/sse.ts — defensive: some unit mocks carry
      // no headers at all): only an OK text/event-stream response streams;
      // everything else keeps the exact JSON handling below.
      if (isSseResponse(response)) {
        // P39: the LLM legs this envelope expects (the Judge in evaluate
        // mode, the Independent when advanced composes) drive the progress
        // bar's pending flags.
        await consumeRunStream(response, mode === 'compare-and-evaluate', independentLlm)
        return
      }
      const data = (await response.json()) as ExecutionSnapshot & {
        title?: string
        detail?: string
        execution_id?: string
      }
      if (response.ok && data.status === 'completed') {
        landRunRememberingCase({ kind: 'completed', snapshot: data })
        setRecentReloadToken((token) => token + 1)
        return
      }
      // RFC 7807 problem (422/501/502/503) or a failed snapshot: surface the
      // domain title/detail plus the persisted execution id when present.
      // P45 (T1.2): a failed run WITH that id is still a case in history —
      // it becomes the case in consultation (the helper no-ops without one).
      landRunRememberingCase({
        kind: 'failed',
        title: data.title ?? dictionary.hero.failedTitle,
        detail: data.detail ?? '',
        executionId: data.execution_id,
      })
    } catch {
      landRun({
        kind: 'failed',
        title: dictionary.principal.validation.unreachableTitle,
        detail: dictionary.principal.validation.unreachableDetail,
      })
    }
  }

  // P28 (FB1): the SSE run lane. Reads response.body incrementally (getReader
  // + TextDecoder), buffers and splits frames on the blank-line separator,
  // and parses one event + one data line per frame (comment lines starting
  // with ':' are tolerated SSE keep-alives). `section` events feed ONLY the
  // in-flight chip strip (observed states, §63; comparison has no chip);
  // terminal frames reuse the JSON lane's completed/failed logic verbatim.
  // A reader that finishes before any terminal frame means the stream was
  // interrupted: fail loudly with dedicated copy and NEVER retry
  // automatically — §50: the run may still complete server-side, and a
  // retry would duplicate executions.
  // P39: section payloads are no longer discarded — a per-run accumulator
  // retains each arrived section's full JSON, and once the comparison lands
  // with both sides' successful answers the rows render progressively while
  // the LLM legs keep flying (expectsJudge/expectsIndependent name the legs
  // the posted envelope asked for).
  async function consumeRunStream(
    response: Response,
    expectsJudge: boolean,
    expectsIndependent: boolean
  ): Promise<void> {
    const reader = response.body?.getReader()
    if (!reader) {
      landRun({
        kind: 'failed',
        title: dictionary.run.streamInterruptedTitle,
        detail: dictionary.run.streamInterruptedDetail,
      })
      return
    }
    const decoder = new TextDecoder()
    let buffer = ''
    let sawTerminal = false

    // P39: the run's local section accumulator — every arrived section's
    // complete JSON, keyed by its wire name.
    const sectionsRef = new Map<string, SseSectionEvent>()

    // P39: the comparison frame carries the deterministic §29/§30 facts. It
    // fires strictly after both sides succeeded server-side, so when it
    // arrives WITH questions and both the emulator and JEV sections are
    // already accumulated as successful-with-answers, the rows can render
    // NOW — the Judge (and any still-unresolved LLM leg) keeps flying
    // behind the progress bar. Guarded honestly: a missing questions payload
    // or a failed/answerless side means there is nothing true to show (a JEV
    // that fails mid-run never produces a comparison at all — §45.7).
    // P41: the SAME builder now also derives the progressive HERO summary —
    // one derivation (progressiveSummary reuses summarizeSnapshot's core),
    // fed by the sections that already arrived whenever this rebuilds.
    function buildProgressiveResult() {
      const emulatorSection = sectionsRef.get('emulator')
      const jevSection = sectionsRef.get('jev')
      const comparisonPayload = sectionPayload<Comparison>(sectionsRef.get('comparison'))
      const comparisonQuestions = comparisonPayload?.questions
      const emulatorAnswers = sectionAnswers(emulatorSection?.payload)
      const jevAnswers = sectionAnswers(jevSection?.payload)
      if (!comparisonQuestions || !emulatorAnswers || !jevAnswers) return
      if (emulatorSection?.status !== 'success' || jevSection?.status !== 'success') return
      setProgressiveResult({
        emulatorAnswers,
        jevAnswers,
        comparisonQuestions,
        judgePending: expectsJudge && !sectionsRef.has('judge'),
        independentPending: expectsIndependent && !sectionsRef.has('independent'),
        summary: progressiveSummary(
          {
            emulator: sectionPayload<ExecutionSnapshot['emulator']>(emulatorSection),
            jev: sectionPayload<ExecutionSnapshot['jev']>(jevSection),
            comparison: comparisonPayload,
            judge: sectionPayload<AiEvaluationSection>(sectionsRef.get('judge')),
            independent: sectionPayload<IndependentOpenaiSection>(sectionsRef.get('independent')),
          },
          // The POSTED envelope's questions — the run's request, not the
          // live editor text (a mid-run edit must not rewrite the facts).
          postedRequestRef.current ?? {}
        ),
      })
    }

    const handleFrame = (frame: string) => {
      const parsed = parseSseFrame(frame)
      if (parsed === null) return
      const { event: eventName, data } = parsed
      if (eventName === 'section') {
        const section = JSON.parse(data) as SseSectionEvent
        if (CHIP_KEYS.includes(section.section as ChipKey)) {
          const key = section.section as ChipKey
          setSectionProgress((previous) => ({ ...previous, [key]: observedStatus(section.status) }))
        }
        // P39: retain the arrived section's full JSON...
        sectionsRef.set(section.section, section)
        // P41: one builder, three triggers — the comparison lands the rows
        // AND the progressive hero; a LLM leg frame resolves its pending
        // flag and lands its §32/§31 hero line(s). Rebuilding from the SAME
        // accumulator keeps every derivation single-sourced; before the
        // comparison the builder's guard is a no-op (nothing honest to show).
        if (
          section.section === 'comparison' ||
          section.section === 'judge' ||
          section.section === 'independent'
        ) {
          buildProgressiveResult()
        }
        return
      }
      if (eventName === 'final') {
        // sawTerminal means "a terminal frame was PROCESSED", so the parse
        // runs first: a frame the wire truncated mid-JSON throws before the
        // flag flips, and the catch below classifies it as an interruption.
        const envelope = JSON.parse(data) as ExecutionSnapshot & {
          title?: string
          detail?: string
          execution_id?: string
        }
        sawTerminal = true
        // Exactly the JSON lane's completed path (final frames are only sent
        // for runs that are 201/completed today — §66 partials included).
        if (envelope.status === 'completed') {
          landRunRememberingCase({ kind: 'completed', snapshot: envelope })
          setRecentReloadToken((token) => token + 1)
          return
        }
        landRunRememberingCase({
          kind: 'failed',
          title: envelope.title ?? dictionary.hero.failedTitle,
          detail: envelope.detail ?? '',
          executionId: envelope.execution_id,
        })
        return
      }
      if (eventName === 'error') {
        const problem = JSON.parse(data) as ProblemBody & { execution_id?: string }
        sawTerminal = true
        landRunRememberingCase({
          kind: 'failed',
          title: problem.title ?? dictionary.hero.failedTitle,
          detail: problem.detail ?? '',
          executionId: problem.execution_id,
        })
      }
    }

    // Dual-review hardening: a mid-stream transport failure — a frame the
    // wire truncated (its JSON parse throws) or a reader that rejects
    // (abortive reset) — is an INTERRUPTED stream, never an unreachable API:
    // the API answered and the stream opened. §50: the run may still
    // complete server-side, and the client never retries (that would
    // duplicate executions).
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (value) buffer += decoder.decode(value, { stream: true })
        // Complete frames only (lib/sse.ts): a partial frame stays buffered
        // until its blank-line terminator arrives (or the stream ends, below).
        const { frames, remainder } = splitSseFrames(buffer)
        for (const frame of frames) handleFrame(frame)
        buffer = remainder
        if (done) {
          // Flush the decoder's tail; a residual WITHOUT a terminator means
          // the wire died mid-frame — it is still handed to handleFrame so a
          // truncated terminal frame surfaces as an interruption (the catch
          // below) instead of being silently dropped: the honest reading is
          // "the run's outcome never arrived".
          buffer += decoder.decode()
          if (buffer.trim() !== '') handleFrame(buffer)
          break
        }
        if (sawTerminal) {
          // The server closes the stream after the terminal frame; stop
          // reading as soon as it is handled.
          return
        }
      }
    } catch {
      // A terminal frame already landed (completed/failed): an abortive
      // close after it is irrelevant. Otherwise classify as interrupted.
      if (!sawTerminal) {
        landRun({
          kind: 'failed',
          title: dictionary.run.streamInterruptedTitle,
          detail: dictionary.run.streamInterruptedDetail,
        })
      }
      return
    }
    if (!sawTerminal) {
      landRun({
        kind: 'failed',
        title: dictionary.run.streamInterruptedTitle,
        detail: dictionary.run.streamInterruptedDetail,
      })
    }
  }

  // C3 (FASE C): Ctrl+Enter / Cmd+Enter runs the request from either column;
  // preventDefault keeps the stray newline out of the JSON textarea. The
  // latest-ref idiom (as dictionaryRef above) keeps the subscription mounted
  // once while always firing the CURRENT executeRequest — which itself guards
  // validity and in-flight, so the shortcut can never bypass either. The ref
  // effect deliberately has no dep array: executeRequest is recreated every
  // render, and the ref must simply track it.
  const executeRequestRef = useRef(executeRequest)
  useEffect(() => {
    executeRequestRef.current = executeRequest
  })

  useEffect(() => {
    function runFromKeyboard(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void executeRequestRef.current()
      }
    }
    window.addEventListener('keydown', runFromKeyboard)
    return () => window.removeEventListener('keydown', runFromKeyboard)
  }, [])

  // R37 (closure C9 finding): the order-first reorder puts the hero above
  // the workbench in the DOM, but the browser's scroll anchoring keeps the
  // user's scroll position after the run lands — the workbench stays in
  // front of the user and the hero never enters the fold. On the stacked
  // (below-lg) layout a completed run scrolls the results into view;
  // smooth scrolling yields to prefers-reduced-motion (§72). scrollIntoView
  // is feature-detected so jsdom (which never implements it) stays green.
  // The layout query NEGATES Tailwind's lg so fractional widths in
  // (1023, 1024) can never fall between the two mirrors of the breakpoint.
  const resultsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (run.kind !== 'completed') return
    if (typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('not all and (min-width: 1024px)').matches) return
    const results = resultsRef.current
    if (!results || typeof results.scrollIntoView !== 'function') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    results.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [run.kind])

  const completedSnapshot = run.kind === 'completed' ? run.snapshot : null
  const answers: Record<string, EmulatorAnswer> = completedSnapshot?.emulator?.result?.answers ?? {}
  const order = completedSnapshot ? Object.keys(completedSnapshot.request?.questions ?? {}) : []
  // P47 (a): the live parse feeding the validation panel's scenario box —
  // recomputed only when the editor text changes (the same text §19.1 reads).
  const liveScenarioState = useMemo(() => parseLiveScenario(jsonText), [jsonText])
  // P47 (b): progressive↔final parity — the POSTED envelope's state while the
  // progressive rows render (the run's request, not the live editor), the
  // landed/hydrated snapshot's persisted request.state once the final lands.
  // Same box, same content in both phases; the rows' own lifetime gates it.
  const resultsScenario: EntryState | null = completedSnapshot
    ? completedSnapshot.request?.state ?? null
    : progressiveResult && (run.kind === 'running' || run.kind === 'failed')
      ? postedRequestRef.current?.state ?? null
      : null
  // P39 (dual-review W1 fix): the progressive rows belong to the POSTED
  // request — a mid-run edit of the textarea (even a valid one renaming or
  // removing questions) must never hide or reorder them. The posted
  // envelope's questions mirror exactly what the landed path derives from
  // the snapshot's own request; undefined (no captured envelope) keeps
  // QuestionResults' answers-order default.
  const progressiveOrder = postedRequestRef.current
    ? Object.keys(postedRequestRef.current.questions ?? {})
    : undefined

  // C5 (FASE C): ONE summary feeds both the hero and the context bar — the
  // same persisted facts, never a second derivation.
  const summary = completedSnapshot
    ? {
        ...summarizeSnapshot(completedSnapshot),
        questionCount: order.length || Object.keys(answers).length,
      }
    : null

  // C5: passive context strip state — idle covers pre-run AND failed runs (a
  // failed run has no completed snapshot; the §72 banner carries the failure,
  // the bar never invents a partial context).
  const contextBarState: ContextBarState =
    run.kind === 'running'
      ? { kind: 'running' }
      : summary
        ? { kind: 'completed', summary }
        : { kind: 'idle' }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{dictionary.pages.principal.title}</h1>
        <p className="max-w-2xl text-muted-foreground">{dictionary.pages.principal.description}</p>
      </div>

      {/* C5 (FASE C): canonical execution-context strip — under the title,
          above the C1 split. Passive (no aria-live): the §72 hero slot owns
          result announcements; idle covers pre-run AND failed runs. */}
      <ExecutionContextBar
        dictionary={dictionary.principal.contextBar}
        locale={locale}
        modeLabels={dictionary.recent.mode}
        runningText={dictionary.run.running}
        state={contextBarState}
        units={dictionary.units}
      />

      {/* C1 (FASE C): desktop splits the page at the lg/1024px breakpoint —
          workbench left, results right. Mobile stacks in source order
          (workbench first) EXCEPT after a completed run, where C9 pulls the
          results above the fold (order-first; lg:order-none restores the grid
          source order on desktop).
          P48 (enmienda C1): the two-column split is CONDITIONAL on the P46
          disclosure — a collapsed request block yields the whole lg row to
          the results (single full-width column, the one-line summary stacked
          above them); an expanded block keeps the split byte-intact. The
          switch rides the SAME requestOpen state as the collapse itself, so
          the layout moves at the arming/landing moment, not on result
          landing. Below lg nothing changes: the page stacks as always. */}
      <div
        className={`flex flex-col gap-6 lg:grid lg:gap-6${requestOpen ? ' lg:grid-cols-2' : ' lg:grid-cols-1'}`}
        data-testid="principal-split"
      >
        {/* WORKBENCH column: request → validation → mode → advanced → Run.
            P46 (R61): the ENTIRE input block lives behind the request-block
            disclosure — a run arming its POST or a case landing collapses it
            to the one-line summary; the toggle below the collapse is the
            only way back (Clear re-expands too). */}
        <div className="space-y-6" data-testid="principal-workbench">
          <RequestBlock
            dictionary={dictionary.principal.requestBlock}
            edited={requestEdited}
            modeLabel={dictionary.recent.mode[mode]}
            onToggle={() => setRequestOpen((value) => !value)}
            open={requestOpen}
            validation={validation}
          >
            {/* 1. Request JSON */}
            <JsonInput
              dictionary={dictionary.principal.requestJson}
              onChange={handleJsonChange}
              sampleJson={SAMPLE_SYSTEM_ONE_REQUEST}
              value={jsonText}
            />

            <ValidationPanel
              dictionary={dictionary.principal.validation}
              scenario={dictionary.scenario}
              scenarioState={liveScenarioState}
              state={validation}
            />

            {/* C8 (FASE C): pre-run provider health (§63 extension) — sits on
                top of the selector whose availability gating it explains. */}
            <ProviderHealthChips dictionary={dictionary.principal.providerHealth} states={capabilities} />

            {/* 2. Execution mode (section 20; compare/evaluate follow capabilities, section 63) */}
            <ModeSelector
              dictionary={dictionary.mode}
              jevAvailable={jevAvailable}
              onChange={setMode}
              value={mode}
              llmAvailable={llmAvailable}
            />

            {/* 3. Advanced (section 11): composes with any mode, gated by LLM. */}
            <AdvancedPanel
              checked={independentLlm}
              dictionary={dictionary.advanced}
              onChange={setIndependentOpenai}
              llmAvailable={llmAvailable}
            />

            {/* 4. Run (C3: Ctrl+Enter / Cmd+Enter fires it too) + Clear (P30/FB3:
                resets the workbench — editor, validation, result and chip).
                T2.2: Run lives INSIDE the collapse — during the run it is
                blocked anyway; expanding to re-run is a deliberate choice. */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="h-11 w-full px-6 text-base sm:w-auto"
                disabled={!requestIsValid || runInFlight}
                onClick={() => void executeRequest()}
                type="button"
              >
                {runInFlight ? dictionary.run.running : dictionary.run.execute}
              </Button>
              <Button
                className="h-11 px-6 text-base"
                disabled={runInFlight}
                onClick={handleClear}
                type="button"
                variant="outline"
              >
                {dictionary.principal.clear}
              </Button>
            </div>
          </RequestBlock>
        </div>

        {/* RESULTS column: the hero slot (§72) plus the question rows. */}
        <div
          // R37 round 2 (judge finding): scroll-mt-16 (4rem) clears the sticky
          // h-14 header when the C9 completion scroll aligns this container to
          // the scrollport top — without it the hero's first 56px (the
          // conclusion line itself) land occluded under the header.
          className={`space-y-6 scroll-mt-16${completedSnapshot ? ' order-first lg:order-none' : ''}`}
          data-testid="principal-results"
          ref={resultsRef}
        >
          {/* P30 (FB3): static provenance chip — ABOVE and OUTSIDE the §72
              aria-live region (it is context, not an announcement: the hero
              slot owns the result announcement). */}
          {origin ? (
            <p
              className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
              data-testid="loaded-from-origin"
            >
              <span aria-hidden="true">↩</span>
              {fill(dictionary.principal.loadedFrom, { id: shortExecutionId(origin.executionId) })}
            </p>
          ) : null}

          {/* 5. Hero result (sections 21-23): compare snapshot renders the JEV
              Fidelity hero; a JEV partial failure renders the honest unavailable
              state; emulator runs keep the plain completed conclusion.
              §72 aria-live: the polite status region is PERMANENTLY MOUNTED and
              EMPTY until a run lands (ARIA APG pattern — regions that mount
              WITH their content announce inconsistently across screen readers),
              scoped to the hero slot only so screen readers announce the result
              without re-announcing unrelated renders. */}
          <div aria-live="polite" role="status">
            {/* C11/P28: while the run is in flight the slot shows a skeleton
                of the hero's shape — shimmer bars plus the per-source strip
                fed by the observed §65 section states: chips without an
                event yet stay neutral, observed chips flip (never invented);
                no verdicts and no text beyond the sr-only Running (the §72
                reduced-motion block neutralizes the pulse globally).
                P41: the skeleton is the PRE-comparison state only. Once the
                comparison lands, the SAME HeroResult renders the
                deterministic §22 facts mid-run (progressive hero): CTA
                visible-but-disabled (no execution id exists to link to yet),
                the strip keeping its in-flight rendering, aria-busy while a
                LLM leg is pending. It lives under the SAME lifetime
                condition as the progressive rows — a failed mid-flight run
                keeps its arrived facts next to the §72 banner below, and a
                completed snapshot always wins the slot. No additional
                aria-live: the hero renders inside this permanently-mounted
                region and is announced once. */}
            {(run.kind === 'running' || run.kind === 'failed') && progressiveResult ? (
              <HeroResult
                dictionary={dictionary.hero}
                locale={locale}
                pending={{
                  // aria-busy only while a LLM leg is observably in flight;
                  // a failed run has nothing in progress anymore (the banner
                  // speaks).
                  llmPending:
                    run.kind === 'running' &&
                    (progressiveResult.judgePending || progressiveResult.independentPending),
                  // P42: the run's pre-POST anchor; the ?? 0 is a type-level
                  // fallback for an impossible state (executeRequest always
                  // arms the ref before the POST the SSE lane requires) — a
                  // zero anchor reads as budget-exhausted: pinned at 95.
                  startedAt: runStartedAtRef.current ?? 0,
                }}
                summary={progressiveResult.summary}
                units={dictionary.units}
                llmInProgressLabel={dictionary.run.llmInProgress}
              />
            ) : run.kind === 'running' ? (
              <section
                aria-busy="true"
                className="space-y-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10"
                data-testid="hero-skeleton"
              >
                <span className="sr-only">{dictionary.run.running}</span>
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-8 w-1/3 animate-pulse rounded bg-muted" />
                <SourceStatusStrip labels={dictionary.hero.sourceLabels} running status={sectionProgress} />
              </section>
            ) : completedSnapshot && summary ? (
              <HeroResult
                dictionary={dictionary.hero}
                firstQuestion={order[0] ?? null}
                locale={locale}
                summary={summary}
                units={dictionary.units}
              />
            ) : null}
            {/* §72 "aria-live para resultados" covers FAILURES too (R2): the
                banner lands inside the same permanently-mounted region so screen
                readers announce a failed run as reliably as a landed hero. */}
            {run.kind === 'failed' ? (
              <section className="space-y-1 rounded-xl bg-destructive/5 p-5 ring-1 ring-destructive/20">
                <p className="text-sm font-bold text-destructive">✗ {run.title}</p>
                {run.detail ? <p className="text-sm text-muted-foreground">{run.detail}</p> : null}
                {run.executionId ? (
                  <p className="text-xs text-muted-foreground">
                    {dictionary.hero.executionId}: <span className="font-mono">{run.executionId}</span>
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>

          {/* P47 (b): the scenario of the request that produced these results,
              ABOVE "Question results" in both branches — the progressive rows'
              envelope while the run is in flight, the snapshot's persisted
              request.state once landed/hydrated (parity: same box, same
              content, so the source switch is invisible). Null/absent state
              renders NO box — never an empty one. */}
          {resultsScenario !== null ? (
            <ScenarioBox dictionary={dictionary.scenario} state={resultsScenario} />
          ) : null}

          {/* 6. Compact question results (sections 27-30): compare snapshots get
              the two-column rows; emulator-only snapshots keep single values.
              §35: the snapshot id rides along so every row deep-links into
              Investigación with its question already focused.
              P39: while the run is in flight (or failed mid-flight), the SAME
              slot renders the rows progressively from the accumulated section
              payloads — the deterministic facts the user can already see at
              ~200ms while the LLM Judge keeps flying. On a failed run the
              rows that DID arrive stay (real data, never retracted) next to
              the honest failure banner; a completed snapshot always wins. */}
          {completedSnapshot && Object.keys(answers).length > 0 ? (
            <QuestionResults
              answers={answers}
              comparison={completedSnapshot.comparison?.questions}
              dictionary={dictionary.questions}
              executionId={completedSnapshot.execution_id}
              jevAnswers={completedSnapshot.jev?.result?.answers}
              locale={locale}
              order={order}
              requestQuestions={completedSnapshot.request?.questions}
            />
          ) : progressiveResult && (run.kind === 'running' || run.kind === 'failed') ? (
            // P39: rows fed strictly from the accumulated sections — no
            // executionId (the run_… id only exists with the final; the
            // §35 deep-links degrade to plain values, never an invented
            // id) and requestQuestions from the POSTED envelope (the
            // criteria labels). P44 supersedes ADR-024 ruling 2's
            // rows-slot LLM bar: the in-flight feedback lives ONLY in the
            // CTA surface (determinate progressbar + shimmer/spinner/label,
            // the same LLM-pending visibility rule), so this slot renders
            // rows, nothing else.
            <QuestionResults
              answers={progressiveResult.emulatorAnswers}
              comparison={progressiveResult.comparisonQuestions}
              dictionary={dictionary.questions}
              jevAnswers={progressiveResult.jevAnswers}
              locale={locale}
              order={progressiveOrder}
              requestQuestions={postedRequestRef.current?.questions}
            />
          ) : null}

          {/* 7. AI summary: renders nothing in emulator mode — there is no AI
              evaluation data in this phase (plan section 32). */}
        </div>
      </div>

      {/* 8. Recent executions (secondary §54.1 — full width below the split).
          P30 (FB3): a row click hydrates Principal with that execution. */}
      <RecentExecutions
        dictionary={dictionary.recent}
        locale={locale}
        onSelect={(executionId) => void handleSelectExecution(executionId)}
        reloadToken={recentReloadToken}
        units={dictionary.units}
      />
    </section>
  )
}

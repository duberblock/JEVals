'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'

import { CircleHelp } from 'lucide-react'

import { Button } from '../ui/button'
import type { Dictionary } from '../../lib/i18n'
import { useDictionary } from '../../lib/i18n/use-locale'

// The provider-configuration screen: one card per integration — endpoint,
// model and API key — saved through /api/v1/settings. The API never returns
// a key's plaintext (only whether one is set), and keys are stored
// encrypted at rest; this view only ever SENDS what the user types.
//
// Semantics (mirroring the API contract): endpoint/model always save with
// the card's current values (an emptied field clears the UI override and
// falls back to the environment); the key saves only when typed, and the
// explicit Clear button removes a stored one.

type ProviderName = 'emulator' | 'jev' | 'judge' | 'independent'

type ProviderView = {
  endpoint: string | null
  model: string | null
  keySet: boolean
  available: boolean
  configuredHere: { endpoint: boolean; model: boolean; apiKey: boolean }
  sources?: { endpoint: string; model: string; apiKey: string }
  defaultEndpoint?: string
  structuredOutputs?: boolean
}

type SettingsResponse = {
  providers: Record<ProviderName, ProviderView>
}

const PROVIDER_ORDER: ProviderName[] = ['emulator', 'jev', 'judge', 'independent']

type CardState = 'idle' | 'saving' | 'saved' | 'error'

// What each provider genuinely requires to become available (mirrors the
// API's own preconditions): the emulator works out of the box, JEV needs a
// key, and each LLM leg needs key AND model.
// Example models shown as placeholders — they teach the shape without
// inventing values (raw model IDs, identical in both locales).
const MODEL_HINTS: Record<ProviderName, string> = {
  emulator: 'featherless-ai/Qwen3.6-35B-A3B-classifier',
  jev: 'jev-latest',
  judge: 'gpt-5-nano',
  independent: 'gpt-5-nano',
}

// Expected endpoint per provider, shown as the box's placeholder when the
// field is empty — the same values the collapsible guide spells out.
const ENDPOINT_HINTS: Record<ProviderName, string> = {
  emulator: 'https://jevs-jimmy.blockito.cloud/v1/systemone',
  jev: 'https://api.typesafe.ai',
  judge: 'https://api.openai.com/v1',
  independent: 'https://api.openai.com/v1',
}

const REQUIRED: Record<ProviderName, { model: boolean; apiKey: boolean }> = {
  emulator: { model: false, apiKey: false },
  jev: { model: false, apiKey: true },
  judge: { model: true, apiKey: true },
  independent: { model: true, apiKey: true },
}

// Any http(s) URL inside a guide paragraph becomes a clickable anchor. The
// i18n layer stays plain strings; trailing sentence punctuation (.,;:)) is
// kept OUT of the href and rendered as text after the link.
const URL_PATTERN = /https?:\/\/[^\s]+/g
const TRAILING_PUNCTUATION = /[.,;:)\]]+$/

function LinkifiedText({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0]
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    const url = trailing ? raw.slice(0, raw.length - trailing.length) : raw
    const index = match.index ?? 0
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index))
    nodes.push(
      <a
        className="text-primary underline underline-offset-2"
        href={url}
        key={`${url}-${index}`}
        rel="noreferrer"
        target="_blank"
      >
        {url}
      </a>
    )
    lastIndex = index + raw.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return <>{nodes}</>
}


function ProviderCard({
  name,
  view,
  dictionary,
  demo,
  onJudgeCopied,
}: {
  name: ProviderName
  view: ProviderView
  dictionary: Dictionary['settings']
  demo?: { url: string; label: string }
  onJudgeCopied?: (data: SettingsResponse) => void
}) {
  const required = REQUIRED[name]
  const [endpoint, setEndpoint] = useState(view.endpoint ?? '')
  const [structured, setStructured] = useState(view.structuredOutputs ?? true)
  const [model, setModel] = useState(view.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [state, setState] = useState<CardState>('idle')
  const [cleared, setCleared] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'done' | 'error'>('idle')

  async function copyJudge() {
    setCopied('idle')
    try {
      const response = await fetch('/api/v1/settings/copy-judge', { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      // The server moved the values — the boxes must SHOW them: hand the
      // fresh view up so the cards reinitialize from what now IS.
      onJudgeCopied?.((await response.json()) as SettingsResponse)
      setCopied('done')
    } catch {
      setCopied('error')
    }
  }
  const labels = dictionary.providers[name]

  async function save(clearKey: boolean, endpointOverride?: string | null) {
    setState('saving')
    setCleared(clearKey)
    const endpointValue = endpointOverride !== undefined ? endpointOverride : endpoint
    try {
      const response = await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          [name]: {
            endpoint: endpointValue || null,
            model: model || null,
            ...(name === 'independent' || name === 'judge' ? { structured_outputs: structured } : {}),
            ...(clearKey ? { api_key: null } : apiKey ? { api_key: apiKey } : {}),
          },
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setApiKey('')
      setState('saved')
    } catch {
      setState('error')
    }
  }

  const keyStatus = view.configuredHere.apiKey
    ? dictionary.keySetHere
    : view.keySet
      ? dictionary.keySetEnv
      : dictionary.keyNotSet

  return (
    <section className="rounded-lg border border-border p-4" data-testid={`settings-card-${name}`}>
      <div className="mb-3">
        <h2 className="text-base font-semibold">{labels.name}</h2>
        <p className="text-sm text-muted-foreground">{labels.description}</p>
      </div>
      <CardHelp dictionary={dictionary} name={name} />
      {demo ? (
        <div className="mb-3 flex flex-wrap gap-2" data-testid={`settings-${name}-presets`}>
          {(
            [
              [dictionary.presetDefault, view.defaultEndpoint ?? '', view.endpoint === (view.defaultEndpoint ?? null)],
              [dictionary.presetDemo, demo.url, view.endpoint === demo.url],
              [dictionary.presetCustom, '', false],
            ] as Array<[string, string, boolean]>
          ).map(([label, value, active]) => (
            <button
              aria-pressed={active}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                active ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-muted'
              }`}
              key={label}
              onClick={() => {
                if (label === dictionary.presetCustom) {
                  document.getElementById(`settings-${name}-endpoint`)?.focus()
                  return
                }
                if (value) setEndpoint(value)
                else setEndpoint(view.defaultEndpoint ?? '')
                void save(false, value || null)
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor={`settings-${name}-endpoint`}>
            {dictionary.endpoint}
          </label>
          <input
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm"
            id={`settings-${name}-endpoint`}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder={demo?.url ?? ENDPOINT_HINTS[name]}
            type="text"
            value={endpoint}
          />
          {labels.endpointHint ? (
            <p className="text-xs text-muted-foreground">{labels.endpointHint}</p>
          ) : null}
        </div>
        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor={`settings-${name}-model`}>
            {dictionary.model}
            {required.model ? <span aria-hidden="true" className="text-primary"> *</span> : null}
          </label>
          <input
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm"
            id={`settings-${name}-model`}
            onChange={(event) => setModel(event.target.value)}
            placeholder={MODEL_HINTS[name]}
            type="text"
            value={model}
          />
          {labels.modelHint ? (
            <p className="text-xs text-muted-foreground">{labels.modelHint}</p>
          ) : null}
        </div>
        {name === 'independent' || name === 'judge' ? (
          <div className="grid gap-1 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                checked={structured}
                className="size-4"
                data-testid={`settings-${name}-structured`}
                onChange={(event) => setStructured(event.target.checked)}
                type="checkbox"
              />
              {dictionary.structuredOutputs}
            </label>
            <p className="text-xs text-muted-foreground">{dictionary.structuredOutputsHint}</p>
          </div>
        ) : null}
        <div className="grid gap-1 sm:col-span-2">
          <label className="text-sm font-medium" htmlFor={`settings-${name}-api-key`}>
            {dictionary.apiKey}
            {required.apiKey ? <span aria-hidden="true" className="text-primary"> *</span> : null}
          </label>
          <input
            autoComplete="off"
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm"
            id={`settings-${name}-api-key`}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={view.keySet ? '••••••••' : ''}
            type="password"
            value={apiKey}
          />
          {'keyHint' in labels && labels.keyHint ? (
            <p className="text-xs text-muted-foreground">{labels.keyHint}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={state === 'saving'} onClick={() => void save(false)} type="button">
          {state === 'saving' ? dictionary.saving : dictionary.save}
        </Button>
        {name === 'independent' ? (
          <Button disabled={state === 'saving'} onClick={() => void copyJudge()} type="button" variant="outline">
            {dictionary.copyJudge}
          </Button>
        ) : null}
        {view.configuredHere.apiKey ? (
          <Button
            disabled={state === 'saving'}
            onClick={() => void save(true)}
            type="button"
            variant="ghost"
          >
            {dictionary.clearKey}
          </Button>
        ) : null}
        <span aria-live="polite" className="text-sm text-muted-foreground" data-testid={`settings-${name}-status`}>
          {state === 'saved'
            ? cleared
              ? dictionary.keyCleared
              : dictionary.saved
            : state === 'error'
              ? dictionary.saveError
              : copied === 'done'
                ? dictionary.copyJudgeDone
                : copied === 'error'
                  ? dictionary.copyJudgeError
                  : keyStatus}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" data-testid={`settings-${name}-availability`}>
        {view.available ? `✓ ${dictionary.available}` : `✗ ${dictionary.unavailable}`}
      </p>

    </section>
  )
}

function CardHelp({ dictionary, name }: { dictionary: Dictionary['settings']; name: ProviderName }) {
  const [open, setOpen] = useState(false)
  const triggerId = useId()
  const regionId = useId()
  return (
    <div className="mb-3" data-testid={`settings-${name}-help`}>
      <Button
        aria-controls={regionId}
        aria-expanded={open}
        id={triggerId}
        onClick={() => setOpen((value) => !value)}
        size="xs"
        type="button"
        variant="ghost"
      >
        <CircleHelp aria-hidden="true" className="size-4" size={16} />
        {dictionary.guideLinks[name]}
      </Button>
      {open ? (
        <div
          aria-labelledby={triggerId}
          className="mt-2 space-y-3 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground"
          id={regionId}
          role="region"
        >
          {/* The guides arrive as \n\n-separated paragraphs; pre-line renders
              those breaks without markdown, and URLs become links. */}
          {dictionary.help[name].split('\n\n').map((paragraph, index) => (
            <p className="whitespace-pre-line" key={index}>
              <LinkifiedText text={paragraph} />
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function SettingsView() {
  const { dictionary } = useDictionary()
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [failed, setFailed] = useState(false)
  // Bumped after a server-side copy so the cards REMOUNT with the fresh
  // view — their inputs are mount-time state and would otherwise stay stale.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/v1/settings')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as SettingsResponse
        if (!cancelled) setSettings(data)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold" data-testid="settings-title">
        {dictionary.settings.title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{dictionary.settings.subtitle}</p>
      {/* The permanent conceptual line: what each box IS, before any field. */}
      <p
        className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm font-medium"
        data-testid="settings-concept"
      >
        {dictionary.settings.concept}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{dictionary.settings.keysNote}</p>
      <div className="mt-6 grid gap-4">
        {failed ? (
          <p className="text-sm text-destructive" data-testid="settings-error">
            {dictionary.settings.loadError}
          </p>
        ) : settings ? (
          PROVIDER_ORDER.map((name) => (
            <ProviderCard
              dictionary={dictionary.settings}
              demo={
                name === 'emulator'
                  ? {
                      url: dictionary.settings.providers.emulator.demoEndpoint,
                      label: dictionary.settings.providers.emulator.useDemo,
                    }
                  : undefined
              }
              key={`${name}-${refreshTick}`}
              name={name}
              onJudgeCopied={
                name === 'independent'
                  ? (data) => {
                      setSettings(data)
                      setRefreshTick((tick) => tick + 1)
                    }
                  : undefined
              }
              view={settings.providers[name]}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">…</p>
        )}
      </div>
      <CompatibilityBlock dictionary={dictionary.settings} />
    </main>
  )
}

// The tested-providers matrix for the two LLM legs — visible after the
// cards, so "which provider can I use?" answers without opening a guide.
function CompatibilityBlock({ dictionary }: { dictionary: Dictionary['settings'] }) {
  const copy = dictionary.compat
  return (
    <section className="mt-6" data-testid="settings-compat">
      <h2 className="text-base font-semibold">{copy.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy.intro}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">{copy.provider}</th>
              <th className="py-2 pr-3 font-semibold">{copy.endpoint}</th>
              <th className="py-2 pr-3 font-semibold">{copy.model}</th>
              <th className="py-2 font-semibold">{copy.native}</th>
            </tr>
          </thead>
          <tbody>
            {copy.rows.map(([provider, endpoint, model, native]) => (
              <tr className="border-b border-border/60" key={provider}>
                <td className="py-2 pr-3 font-medium">{provider}</td>
                <td className="py-2 pr-3 font-mono text-xs wrap-anywhere">
                  <a
                    className="text-primary underline underline-offset-2"
                    href={endpoint}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {endpoint}
                  </a>
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{model}</td>
                <td className="py-2">{native}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{copy.note}</p>
    </section>
  )
}

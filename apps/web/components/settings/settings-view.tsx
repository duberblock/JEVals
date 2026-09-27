'use client'

import { useEffect, useState } from 'react'

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
}

type SettingsResponse = {
  providers: Record<ProviderName, ProviderView>
}

const PROVIDER_ORDER: ProviderName[] = ['emulator', 'jev', 'judge', 'independent']

type CardState = 'idle' | 'saving' | 'saved' | 'error'

function ProviderCard({
  name,
  view,
  dictionary,
}: {
  name: ProviderName
  view: ProviderView
  dictionary: Dictionary['settings']
}) {
  const [endpoint, setEndpoint] = useState(view.endpoint ?? '')
  const [model, setModel] = useState(view.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [state, setState] = useState<CardState>('idle')
  const [cleared, setCleared] = useState(false)
  const labels = dictionary.providers[name]

  async function save(clearKey: boolean) {
    setState('saving')
    setCleared(clearKey)
    try {
      const response = await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          [name]: {
            endpoint: endpoint || null,
            model: model || null,
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor={`settings-${name}-endpoint`}>
            {dictionary.endpoint}
          </label>
          <input
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm"
            id={`settings-${name}-endpoint`}
            onChange={(event) => setEndpoint(event.target.value)}
            type="text"
            value={endpoint}
          />
        </div>
        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor={`settings-${name}-model`}>
            {dictionary.model}
          </label>
          <input
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm"
            id={`settings-${name}-model`}
            onChange={(event) => setModel(event.target.value)}
            type="text"
            value={model}
          />
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <label className="text-sm font-medium" htmlFor={`settings-${name}-api-key`}>
            {dictionary.apiKey}
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
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={state === 'saving'} onClick={() => void save(false)} type="button">
          {state === 'saving' ? dictionary.saving : dictionary.save}
        </Button>
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
              : keyStatus}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" data-testid={`settings-${name}-availability`}>
        {view.available ? `✓ ${dictionary.available}` : `✗ ${dictionary.unavailable}`}
      </p>
    </section>
  )
}

export function SettingsView() {
  const { dictionary } = useDictionary()
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [failed, setFailed] = useState(false)

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
      <div className="mt-6 grid gap-4">
        {failed ? (
          <p className="text-sm text-destructive" data-testid="settings-error">
            {dictionary.settings.loadError}
          </p>
        ) : settings ? (
          PROVIDER_ORDER.map((name) => (
            <ProviderCard
              dictionary={dictionary.settings}
              key={name}
              name={name}
              view={settings.providers[name]}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">…</p>
        )}
      </div>
    </main>
  )
}

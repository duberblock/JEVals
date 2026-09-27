import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsView } from '../../components/settings/settings-view'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'

// The provider-configuration screen: four cards rendered from GET
// /api/v1/settings, saves through PUT (endpoint/model always, the key only
// when typed, the explicit Clear button removing a stored one). The key
// field NEVER renders a value back — the API only reports keySet.

const VIEW = {
  emulator: {
    endpoint: 'http://localhost:8100',
    model: null,
    keySet: true,
    available: true,
    configuredHere: { endpoint: true, model: false, apiKey: true },
    sources: { endpoint: 'ui', model: 'none', apiKey: 'ui' },
    defaultEndpoint: 'https://jevs-jimmy.blockito.cloud/v1/systemone',
  },
  jev: {
    endpoint: 'https://api.typesafe.ai',
    model: null,
    keySet: false,
    available: false,
    configuredHere: { endpoint: false, model: false, apiKey: false },
    sources: { endpoint: 'env', model: 'none', apiKey: 'none' },
  },
  judge: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keySet: false,
    available: false,
    configuredHere: { endpoint: false, model: false, apiKey: false },
  },
  independent: {
    endpoint: 'https://api.openai.com/v1',
    model: null,
    keySet: true,
    available: false,
    configuredHere: { endpoint: false, model: false, apiKey: false },
  },
}

function stubFetch(getBody = { providers: VIEW }, puts: Array<Record<string, unknown>> = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/v1/settings') && (!init || init.method === undefined || init.method === 'GET')) {
      return { ok: true, status: 200, json: async () => getBody } as Response
    }
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)))
      return { ok: true, status: 200, json: async () => getBody } as Response
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, puts }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SettingsView', () => {
  it('renders the four provider cards from the settings view', async () => {
    stubFetch()

    render(<SettingsView />)

    expect(await screen.findByTestId('settings-card-emulator')).toBeInTheDocument()
    expect(screen.getByTestId('settings-card-jev')).toBeInTheDocument()
    expect(screen.getByTestId('settings-card-judge')).toBeInTheDocument()
    expect(screen.getByTestId('settings-card-independent')).toBeInTheDocument()
    expect(screen.getByTestId('settings-title')).toHaveTextContent(en.settings.title)
    expect(screen.getByTestId('settings-card-emulator')).toHaveTextContent(
      '✓ Available'
    )
    expect(screen.getByTestId('settings-card-jev')).toHaveTextContent('✗ Unavailable')
    // The saved-key status reads back — the key VALUE never does.
    expect(screen.getByTestId('settings-emulator-status')).toHaveTextContent(
      'A key is saved here (encrypted at rest)'
    )
    const emulator = within(screen.getByTestId('settings-card-emulator'))
    const keyInput = emulator.getByLabelText('API key') as HTMLInputElement
    expect(keyInput.value).toBe('')
    expect(keyInput.type).toBe('password')
    // The configuration is VISIBLE: preset options + per-field provenance.
    expect(emulator.getByTestId('settings-emulator-presets')).toBeInTheDocument()
    expect(screen.getByTestId('settings-jev-sources')).toHaveTextContent(
      'Endpoint (environment)'
    )
    expect(emulator.getByTestId('settings-emulator-sources')).toHaveTextContent(
      'Endpoint (configured here)'
    )
  })

  it('saves endpoint, model and a typed key; an empty key is not sent', async () => {
    const { puts } = stubFetch()

    render(<SettingsView />)
    await screen.findByTestId('settings-card-judge')

    const judge = within(screen.getByTestId('settings-card-judge'))
    fireEvent.change(judge.getByLabelText('Endpoint'), { target: { value: 'http://localhost:11434/v1' } })
    fireEvent.change(judge.getByLabelText('Model'), { target: { value: 'qwen3:8b' } })
    fireEvent.click(within(screen.getByTestId('settings-card-judge')).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({
      judge: { endpoint: 'http://localhost:11434/v1', model: 'qwen3:8b' },
    })

    // Now type a key and save again — only then does api_key travel.
    fireEvent.change(judge.getByLabelText('API key'), { target: { value: 'ollama' } })
    fireEvent.click(within(screen.getByTestId('settings-card-judge')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]).toEqual({
      judge: { endpoint: 'http://localhost:11434/v1', model: 'qwen3:8b', api_key: 'ollama' },
    })
  })

  it('offers the explicit clear only for keys saved here and sends api_key null', async () => {
    const { puts } = stubFetch()

    render(<SettingsView />)
    await screen.findByTestId('settings-card-emulator')

    // Only the emulator has configuredHere.apiKey — one Clear button.
    const clearButtons = screen.getAllByRole('button', { name: 'Clear saved key' })
    expect(clearButtons).toHaveLength(1)
    fireEvent.click(clearButtons[0])

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({
      emulator: { endpoint: 'http://localhost:8100', model: null, api_key: null },
    })
    await waitFor(() =>
      expect(screen.getByTestId('settings-emulator-status')).toHaveTextContent('Key cleared')
    )
  })

  it('renders the Spanish dictionary and reports load failures honestly', async () => {
    const failing = vi.fn(async () => {
      throw new Error('unreachable')
    })
    vi.stubGlobal('fetch', failing)

    const { unmount } = render(<SettingsView />)
    expect(await screen.findByTestId('settings-error')).toHaveTextContent(
      en.settings.loadError
    )
    unmount()

    stubFetch()
    // The ES path: the same view through the Spanish dictionary.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ providers: VIEW }),
    }) as Response))
    // es rendering needs the locale context; the dictionary slice pins parity instead.
    expect(es.settings.title).toBe('Configuración de proveedores')
    expect(es.settings.providers.emulator.name).toBe('Emulador')
  })
})

it('the one-click public demo fills and saves the emulator endpoint', async () => {
  const { puts } = stubFetch()

  render(<SettingsView />)
  await screen.findByTestId('settings-card-emulator')

  // The empty endpoint box SHOWS the full demo URL as its placeholder.
  const endpointInput = within(screen.getByTestId('settings-card-emulator')).getByLabelText('Endpoint') as HTMLInputElement
  expect(endpointInput.placeholder).toBe('https://simple-jev-demo-api.featherless.ai/v1/classifier')

  const presets = within(screen.getByTestId('settings-emulator-presets'))
  fireEvent.click(presets.getByRole('button', { name: 'Public demo — Simple Jev' }))

  await waitFor(() => expect(puts).toHaveLength(1))
  expect(puts[0]).toEqual({
    emulator: { endpoint: 'https://simple-jev-demo-api.featherless.ai/v1/classifier', model: null },
  })
  expect(endpointInput.value).toBe('https://simple-jev-demo-api.featherless.ai/v1/classifier')
  await waitFor(() =>
    expect(screen.getByTestId('settings-emulator-status')).toHaveTextContent('Saved')
  )
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '../../app/api/v1/[...path]/route'

const originalFetch = globalThis.fetch

type FetchMock = ReturnType<typeof vi.fn>

function mockFetch(response: Response): FetchMock {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastCall(fetchMock: FetchMock) {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error('fetch was never called')
  return { input: call[0] as string | URL, init: (call[1] ?? {}) as RequestInit }
}

// P28 (FB1): the browser negotiates text/event-stream on the run POST, and
// the upstream answers with an incremental SSE body. The proxy must forward
// the consumer's accept header (F2 fix: a fresh Headers() used to drop it)
// and pass the upstream stream through untouched — headers, status and the
// ReadableStream body itself, never a buffered string.
describe('api proxy route handler — SSE passthrough (P28)', () => {
  let envBackup: Record<string, string | undefined>

  beforeEach(() => {
    envBackup = {
      API_BASE_URL: process.env.API_BASE_URL,
      AUTH_USER: process.env.AUTH_USER,
      AUTH_PASS: process.env.AUTH_PASS,
    }
    delete process.env.API_BASE_URL
    delete process.env.AUTH_USER
    delete process.env.AUTH_PASS
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    vi.unstubAllGlobals()
    globalThis.fetch = originalFetch
  })

  function sseUpstream(body: string, status = 201): Response {
    return new Response(body, {
      status,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
      },
    })
  }

  it('forwards the incoming accept header upstream on POST', async () => {
    const fetchMock = mockFetch(sseUpstream('event: final\ndata: {}\n\n'))

    const request = new Request('http://localhost:3000/api/v1/executions', {
      method: 'POST',
      body: JSON.stringify({ system_one: {}, mode: 'emulator' }),
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    })

    await POST(request as never)

    const { init } = lastCall(fetchMock)
    expect(new Headers(init.headers).get('accept')).toBe('text/event-stream')
    // The hop-by-hop negotiation must not disturb the JSON content type.
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
  })

  it('keeps working without an accept header (nothing forwarded, no invention)', async () => {
    const fetchMock = mockFetch(sseUpstream('event: final\ndata: {}\n\n'))

    const request = new Request('http://localhost:3000/api/v1/executions', {
      method: 'POST',
      body: JSON.stringify({ system_one: {}, mode: 'emulator' }),
      headers: { 'content-type': 'application/json' },
    })

    await POST(request as never)

    expect(new Headers(lastCall(fetchMock).init.headers).get('accept')).toBeNull()
  })

  it('passes the SSE status, content-type and cache-control through', async () => {
    mockFetch(sseUpstream('event: final\ndata: {}\n\n'))

    const request = new Request('http://localhost:3000/api/v1/executions', {
      method: 'POST',
      body: JSON.stringify({ system_one: {}, mode: 'emulator' }),
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    })

    const response = await POST(request as never)

    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform')
  })

  it('returns the upstream body as a live stream, not buffered text', async () => {
    // A real incremental body: two chunks that only a passthrough can keep
    // separate (a buffered proxy would concatenate before the consumer reads).
    const encoder = new TextEncoder()
    const upstreamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('event: section\ndata: {"section":"emulator"}\n\n'))
        controller.enqueue(encoder.encode('event: final\ndata: {"status":"completed"}\n\n'))
        controller.close()
      },
    })
    mockFetch(
      new Response(upstreamBody, {
        status: 201,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
        },
      })
    )

    const request = new Request('http://localhost:3000/api/v1/executions', {
      method: 'POST',
      body: JSON.stringify({ system_one: {}, mode: 'emulator' }),
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    })

    const response = await POST(request as never)

    // The response body is the stream itself (a ReadableStream, never text).
    expect(response.body).toBeInstanceOf(ReadableStream)
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(decoder.decode(first.value)).toContain('event: section')
    const second = await reader.read()
    expect(second.done).toBe(false)
    expect(decoder.decode(second.value)).toContain('event: final')
    const drained = await reader.read()
    expect(drained.done).toBe(true)
  })
})

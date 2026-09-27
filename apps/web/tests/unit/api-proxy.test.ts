// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET, POST } from '../../app/api/v1/[...path]/route'

const originalFetch = globalThis.fetch

type FetchMock = ReturnType<typeof vi.fn>

function mockFetch(response: Response): FetchMock {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

function lastCall(fetchMock: FetchMock) {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error('fetch was never called')
  return { input: call[0] as string | URL, init: (call[1] ?? {}) as RequestInit }
}

describe('api proxy route handler', () => {
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

  it('forwards POST method, path, query, body and content-type to the API base URL', async () => {
    const fetchMock = mockFetch(jsonResponse({ valid: true, questions: [] }, { status: 200 }))

    const body = JSON.stringify({ state: { message: 'hi' }, questions: {} })
    const request = new Request('http://localhost:3000/api/v1/validations?source=web', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request as never)

    const { input, init } = lastCall(fetchMock)
    expect(String(input)).toBe('http://localhost:8000/api/v1/validations?source=web')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toBe(body)
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ valid: true, questions: [] })
  })

  it('forwards GET requests with query strings and no body', async () => {
    const fetchMock = mockFetch(jsonResponse({ items: [], next_cursor: null }))

    const request = new Request('http://localhost:3000/api/v1/executions?limit=5', {
      method: 'GET',
    })

    const response = await GET(request as never)

    const { input, init } = lastCall(fetchMock)
    expect(String(input)).toBe('http://localhost:8000/api/v1/executions?limit=5')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(response.status).toBe(200)
  })

  it('respects a configured API_BASE_URL', async () => {
    process.env.API_BASE_URL = 'http://api.internal:9000/'
    const fetchMock = mockFetch(jsonResponse({ ok: true }))

    await GET(new Request('http://localhost:3000/api/v1/health') as never)

    expect(String(lastCall(fetchMock).input)).toBe('http://api.internal:9000/api/v1/health')
  })

  it('injects a Basic Authorization header when AUTH_USER and AUTH_PASS are set', async () => {
    process.env.AUTH_USER = 'admin'
    process.env.AUTH_PASS = 'secret'
    const fetchMock = mockFetch(jsonResponse({ valid: true }))

    await POST(new Request('http://localhost:3000/api/v1/validations', { method: 'POST', body: '{}' }) as never)

    const authorization = new Headers(lastCall(fetchMock).init.headers).get('authorization')
    expect(authorization).toBe(`Basic ${Buffer.from('admin:secret').toString('base64')}`)
  })

  it('omits the Authorization header when credentials are not configured', async () => {
    const fetchMock = mockFetch(jsonResponse({ valid: true }))

    await POST(new Request('http://localhost:3000/api/v1/validations', { method: 'POST', body: '{}' }) as never)

    expect(new Headers(lastCall(fetchMock).init.headers).get('authorization')).toBeNull()
  })

  it('passes upstream error status and application/problem+json through verbatim', async () => {
    const problem = { title: 'Not Implemented', detail: 'Compare with JEV is planned for a later phase.', status: 501 }
    const fetchMock = mockFetch(
      jsonResponse(problem, {
        status: 501,
        headers: { 'content-type': 'application/problem+json' },
      })
    )

    const request = new Request('http://localhost:3000/api/v1/executions', {
      method: 'POST',
      body: JSON.stringify({ system_one: {}, mode: 'compare' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request as never)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(response.status).toBe(501)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toEqual(problem)
  })

  it('returns a 502 problem when the upstream API cannot be reached', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET(new Request('http://localhost:3000/api/v1/executions?limit=5') as never)

    expect(response.status).toBe(502)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    const problem = await response.json()
    expect(problem.title).toBe('API Unreachable')
    expect(problem.detail).toContain('API')
  })

  // F2: the synthetic 502 must be a complete RFC 7807 problem — including the
  // type URI so clients can branch on the problem identity, not the title.
  it('includes an RFC 7807 type URI in the synthetic 502 problem', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET(new Request('http://localhost:3000/api/v1/executions?limit=5') as never)

    const problem = await response.json()
    expect(problem.type).toBe('https://jevals.local/problems/api-unreachable')
    expect(problem.status).toBe(502)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
  })

  // F2 (ADR-006): the proxy must forward the upstream WWW-Authenticate
  // challenge so the browser sees the real 401 semantics.
  it('forwards the upstream WWW-Authenticate header on a 401', async () => {
    mockFetch(
      jsonResponse({ title: 'Unauthorized', detail: 'Missing or invalid credentials.', status: 401 }, {
        status: 401,
        headers: {
          'content-type': 'application/problem+json',
          'WWW-Authenticate': 'Basic realm="jevals"',
        },
      })
    )

    const response = await GET(new Request('http://localhost:3000/api/v1/executions?limit=5') as never)

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Basic realm="jevals"')
    expect(response.headers.get('content-type')).toBe('application/problem+json')
  })

  // F2 (ADR-006): upstream Cache-Control directives (e.g. no-store) must reach
  // the browser instead of being silently dropped by the proxy.
  it('forwards the upstream Cache-Control header', async () => {
    mockFetch(
      jsonResponse({ items: [], next_cursor: null }, {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      })
    )

    const response = await GET(new Request('http://localhost:3000/api/v1/executions?limit=5') as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

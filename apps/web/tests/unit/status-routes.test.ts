// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET as getHealth } from '../../app/health/route'
import { GET as getReady } from '../../app/ready/route'

const originalFetch = globalThis.fetch

type FetchMock = ReturnType<typeof vi.fn>
type StatusRoute = { name: string; GET: () => Promise<Response>; path: string; body: unknown }

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

// F1 (ADR-011 ruling 3, amended dual-review R1): /health and /ready must be
// served AT THE WEB ORIGIN as pass-through routes to the API's unauthenticated
// probes — same conventions as the /api/v1 catch-all (api-proxy.test.ts).
describe.each([
  { name: 'health', GET: getHealth, path: '/health', body: { status: 'ok' } },
  { name: 'ready', GET: getReady, path: '/ready', body: { status: 'ready' } },
] satisfies StatusRoute[])('status pass-through route ($name)', ({ GET, path, body, name }) => {
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

  it(`forwards the upstream ${path} status and body verbatim with GET`, async () => {
    const fetchMock = mockFetch(jsonResponse(body))

    const response = await GET()

    const { input, init } = lastCall(fetchMock)
    expect(String(input)).toBe(`http://localhost:8000${path}`)
    expect(init.method).toBe('GET')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual(body)
  })

  it('forwards the upstream cache-control (dual-review R2: no heuristic caching)', async () => {
    mockFetch(jsonResponse(body, { headers: { 'cache-control': 'no-store' } }))

    const response = await GET()

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('respects a configured API_BASE_URL', async () => {
    process.env.API_BASE_URL = 'http://api.internal:9000/'
    const fetchMock = mockFetch(jsonResponse(body))

    await GET()

    expect(String(lastCall(fetchMock).input)).toBe(`http://api.internal:9000${path}`)
  })

  it('passes a degraded upstream status through verbatim (ADR-006: health/ready statuses are honest)', async () => {
    const problem = { title: 'Degraded', status: 503 }
    mockFetch(jsonResponse(problem, { status: 503 }))

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual(problem)
  })

  it('returns a 502 problem when the API cannot be reached', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET()

    expect(response.status).toBe(502)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    const problem = await response.json()
    expect(problem.type).toBe('https://jevals.local/problems/api-unreachable')
    expect(problem.title).toBe('API Unreachable')
    expect(problem.status).toBe(502)
  })

  it('never injects an Authorization header — the wrapper owns auth and exempts exactly these two paths', async () => {
    process.env.AUTH_USER = 'admin'
    process.env.AUTH_PASS = 'secret'
    const fetchMock = mockFetch(jsonResponse(body))

    await GET()

    const headers = new Headers(lastCall(fetchMock).init.headers)
    expect(headers.get('authorization')).toBeNull()
    expect([...headers.keys()]).toEqual([])
  })

  it(`requests ${name} uncached (no-store)`, async () => {
    const fetchMock = mockFetch(jsonResponse(body))

    await GET()

    expect(lastCall(fetchMock).init.cache).toBe('no-store')
  })
})

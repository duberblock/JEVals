import { NextResponse, type NextRequest } from 'next/server'

/**
 * Catch-all proxy from the Next.js server to the jevals API (plan §12/§13).
 *
 * The browser cannot reach the FastAPI service directly (separate origin, no
 * CORS), so every /api/v1/* call from the client goes through this handler.
 * Any configured Basic Auth credentials (AUTH_USER/AUTH_PASS) are injected
 * here, server-side, so they never reach the client bundle.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:8000'

function apiBaseUrl(): string {
  return (process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '')
}

function basicAuthHeader(): string | null {
  const user = process.env.AUTH_USER
  const pass = process.env.AUTH_PASS
  if (!user || !pass) return null
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

function upstreamUrl(request: NextRequest): string {
  // The route is mounted at /api/v1/* and the API serves the same paths, so
  // the incoming pathname + query can be forwarded verbatim.
  const incoming = new URL(request.url)
  return `${apiBaseUrl()}${incoming.pathname}${incoming.search}`
}

async function proxy(request: NextRequest, method: 'GET' | 'POST'): Promise<NextResponse> {
  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)

  // P28 (FB1): forward the consumer's accept header so content negotiation
  // with the API survives the hop (a fresh Headers() used to drop it — the
  // run POST's text/event-stream never reached the API). Absent stays
  // absent: the proxy never invents a preference the caller did not send.
  const accept = request.headers.get('accept')
  if (accept) headers.set('accept', accept)

  const authorization = basicAuthHeader()
  if (authorization) headers.set('authorization', authorization)

  let body: string | undefined
  if (method === 'POST') body = await request.text()

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl(request), { method, headers, body, cache: 'no-store' })
  } catch {
    return NextResponse.json(
      {
        type: 'https://jevals.local/problems/api-unreachable',
        title: 'API Unreachable',
        detail: 'The jevals API could not be reached. Verify that the API service is running.',
        status: 502,
      },
      { status: 502, headers: { 'content-type': 'application/problem+json' } }
    )
  }

  // Forward the upstream verdict verbatim: status, body and semantics-relevant
  // headers (ADR-006) — content-type (including application/problem+json),
  // WWW-Authenticate (401 challenges) and Cache-Control directives. The body
  // passes through as the upstream stream itself, so SSE frames stay
  // incremental through this hop (P28) and are never buffered into text.
  const responseHeaders = new Headers()
  for (const name of ['content-type', 'www-authenticate', 'cache-control']) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxy(request, 'GET')
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxy(request, 'POST')
}

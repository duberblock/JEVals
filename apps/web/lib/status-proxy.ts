import { NextResponse } from 'next/server'

/**
 * Server-side pass-through for the API's unauthenticated status probes —
 * the executable half of the ADR-005 exposure contract (ADR-011 ruling 3,
 * amended dual-review R1): /health and /ready must answer AT THE WEB ORIGIN
 * so the deployed stack is probeable through one public origin.
 *
 * Conventions are the /api/v1 catch-all's (app/api/v1/[...path]/route.ts):
 * API_BASE_URL env (server-side only), never cached, upstream status + body
 * forwarded verbatim, and the same honest RFC 7807 502 when the API is
 * unreachable. No auth is added here — the API serves both probes without
 * credentials (PUBLIC_PATHS) and the auth-wrapping origin EXEMPTS exactly
 * these two paths (DEPLOYMENT.md §3). The bodies are tiny status dicts and
 * must never carry snapshot data.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:8000'

function apiBaseUrl(): string {
  return (process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '')
}

function unreachableProblem(): NextResponse {
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

export function statusProxy(path: '/health' | '/ready'): () => Promise<NextResponse> {
  return async function GET(): Promise<NextResponse> {
    let upstream: Response
    try {
      upstream = await fetch(`${apiBaseUrl()}${path}`, { method: 'GET', cache: 'no-store' })
    } catch {
      return unreachableProblem()
    }
    const headers = new Headers()
    const contentType = upstream.headers.get('content-type')
    if (contentType) headers.set('content-type', contentType)
    // Cache-control forwards like the /api/v1 catch-all (dual-review R2):
    // without it an intermediary shared cache could heuristically cache the
    // probe; force-dynamic alone only stops Next's own caching.
    const cacheControl = upstream.headers.get('cache-control')
    if (cacheControl) headers.set('cache-control', cacheControl)
    return new NextResponse(upstream.body, { status: upstream.status, headers })
  }
}

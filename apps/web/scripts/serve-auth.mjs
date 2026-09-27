/**
 * Origin Basic Auth reverse proxy for the jevals Playground deploy (ADR-005).
 *
 * Sits in front of the Next.js server at the deployed origin: every request
 * needs valid Basic credentials EXCEPT exactly `/health` and `/ready`
 * (ADR-005 consequences; the healthcheck contract is healthy = 401 on `/`).
 * Authenticated and exempt requests are streamed to the upstream with the
 * hop-by-hop headers stripped; the `Authorization` header is REMOVED before
 * proxying non-exempt requests. On exempt paths origin credentials terminate
 * at the Next server, which never forwards them onward (lib/status-proxy.ts
 * fetches the API without auth).
 *
 * Each request-target is resolved ONCE against the upstream and the result
 * feeds both the exemption check and the proxy hop: an absolute-form target
 * (`GET http://evil/health`) or a protocol-relative one (`GET //evil/health`)
 * names a different origin and is rejected with 400 — the wrapper must never
 * become an open proxy (R28 dual-review F1).
 *
 * The wrapper owns the process tree (an `exec`-style shape): by default
 * it spawns the local Next server as a child, polls it until ready, and only
 * then starts listening. SIGTERM/SIGINT handlers are installed BEFORE the
 * child is spawned and work during the whole boot window (kill the child if
 * any, then exit — a PID-1 `docker stop` must never hang into SIGKILL); they
 * are forwarded to the child once it exists, and an unexpected child death
 * (or spawn failure) exits non-zero so the restart policy takes over.
 *
 * Node 22 built-ins only — no npm dependencies.
 *
 * Env (CLI entry): AUTH_USER / AUTH_PASS (required, fail closed),
 *   UPSTREAM_URL (default http://127.0.0.1:3000),
 *   UPSTREAM_CMD (space-separated argv with NO quoting support — simple
 *   commands only; `none` = external upstream, no spawn; unset = spawn
 *   `next start` bound to the upstream host/port from cwd),
 *   PORT (default 4173, bound on 0.0.0.0),
 *   UPSTREAM_READY_TIMEOUT_MS (default 120000).
 */
import { spawn } from 'node:child_process'
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import http, { createServer } from 'node:http'
import https from 'node:https'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The only pathnames exempt from origin Basic Auth (exact match). */
export const EXEMPT_PATHS = new Set(['/health', '/ready'])

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const PROBE_INTERVAL_MS = 250
const PROBE_TIMEOUT_MS = 2000

/** Fail-closed error thrown before anything is served. */
export class AuthConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuthConfigError'
  }
}

/** Timing-safe string equality via fixed-length digests (length never leaks). */
function fixedTimeEquals(actual, expected) {
  const digestOf = (value) => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(digestOf(actual), digestOf(expected))
}

/** Validate a Basic Authorization header against the origin credentials. */
export function checkBasicAuth(header, authUser, authPass) {
  if (typeof header !== 'string') return false
  const match = /^Basic\s+(.+)$/i.exec(header.trim())
  if (!match) return false
  let decoded
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8')
  } catch {
    return false
  }
  const separator = decoded.indexOf(':')
  if (separator === -1) return false
  const userOk = fixedTimeEquals(decoded.slice(0, separator), authUser)
  const passOk = fixedTimeEquals(decoded.slice(separator + 1), authPass)
  return userOk && passOk
}

/** Exact pathname match — query strings are ignored, sub-paths are not exempt. */
export function isExemptPath(pathname) {
  return EXEMPT_PATHS.has(pathname)
}

/** Copy headers minus hop-by-hop (plus any named in Connection) and proxy-*. */
function stripHopByHop(headers) {
  const connectionTokens = new Set(
    String(headers.connection ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  )
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower) || lower.startsWith('proxy-') || connectionTokens.has(lower)) {
      continue
    }
    out[name] = value
  }
  return out
}

function sendText(res, status, body) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(body)
}

/** 400 Bad Request, plain text, connection closed (disallowed request-targets). */
function sendBadRequest(res) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
  res.end('Bad Request')
}

/** Stream one request/response pair to the upstream (method, headers, bodies). */
function proxyRequest(req, res, { target, stripAuthorization }) {
  const headers = stripHopByHop(req.headers)
  if (stripAuthorization) delete headers.authorization
  const client = target.protocol === 'https:' ? https : http
  const options = {
    hostname: target.hostname,
    port: target.port || (client === https ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: req.method,
    headers,
    // `agent: false` is deliberate: one isolated connection per forwarded
    // request (internal-tool traffic volumes) — no shared-pool state across
    // proxied requests, so a wedged upstream cannot poison later ones.
    agent: false,
  }
  const upstreamReq = client.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, stripHopByHop(upstreamRes.headers))
    upstreamRes.pipe(res)
    // Client disconnected mid-response: tear down the upstream pair too.
    res.on('close', () => {
      if (!res.writableEnded) {
        upstreamReq.destroy()
        upstreamRes.destroy()
      }
    })
    upstreamRes.on('error', () => res.destroy())
  })
  upstreamReq.on('error', () => sendText(res, 502, 'Bad Gateway'))
  req.on('aborted', () => upstreamReq.destroy())
  req.pipe(upstreamReq)
}

function createRequestListener({ authUser, authPass, upstreamUrl }) {
  return function requestListener(req, res) {
    // Resolve the request-target ONCE against the upstream; both the exemption
    // check and the proxy hop use this target. An absolute-form target
    // (`GET http://evil/health`) or a protocol-relative one (`GET //evil/health`)
    // resolves to a different origin and is rejected here — without this the
    // wrapper is an unauthenticated open proxy/SSRF vector (R28 F1).
    let target
    try {
      target = new URL(req.url, upstreamUrl)
    } catch {
      return sendBadRequest(res)
    }
    if (target.origin !== upstreamUrl.origin) {
      return sendBadRequest(res)
    }
    const exempt = isExemptPath(target.pathname)
    if (!exempt && !checkBasicAuth(req.headers.authorization, authUser, authPass)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="jevals", charset="UTF-8"')
      return sendText(res, 401, 'Unauthorized')
    }
    proxyRequest(req, res, { target, stripAuthorization: !exempt })
  }
}

/**
 * Build the auth-wrapping proxy server. Options override the environment
 * (`authUser`, `authPass`, `upstreamUrl`). Throws AuthConfigError when the
 * credentials are missing — the caller must fail closed. The error names ONLY
 * the actually-missing variable (user first, then pass).
 */
export function createAuthProxy(options = {}) {
  const authUser = options.authUser ?? process.env.AUTH_USER ?? ''
  const authPass = options.authPass ?? process.env.AUTH_PASS ?? ''
  if (!authUser) {
    throw new AuthConfigError(
      'AUTH_USER is required — refusing to serve without origin credentials (fail closed)',
    )
  }
  if (!authPass) {
    throw new AuthConfigError(
      'AUTH_PASS is required — refusing to serve without origin credentials (fail closed)',
    )
  }
  const upstreamUrl = new URL(options.upstreamUrl ?? process.env.UPSTREAM_URL ?? 'http://127.0.0.1:3000')
  return {
    server: createServer(createRequestListener({ authUser, authPass, upstreamUrl })),
    upstreamUrl,
  }
}

function resolveNextBin(cwd) {
  const candidates = [
    join(cwd, 'node_modules', '.bin', 'next'),
    join(cwd, 'node_modules', 'next', 'dist', 'bin', 'next'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** Default UPSTREAM_CMD: `next start` bound to the upstream host/port. */
function defaultUpstreamArgv(upstreamUrl) {
  const bin = resolveNextBin(process.cwd())
  if (!bin) {
    throw new Error('cannot resolve node_modules/.bin/next — run npm ci in apps/web first')
  }
  return [
    process.execPath,
    bin,
    'start',
    '--hostname',
    upstreamUrl.hostname || '127.0.0.1',
    '--port',
    upstreamUrl.port || '3000',
  ]
}

/** UPSTREAM_CMD -> spawn argv, or null when there is nothing to spawn. */
function resolveUpstreamArgv(upstreamUrl) {
  const raw = (process.env.UPSTREAM_CMD ?? '').trim()
  if (raw.toLowerCase() === 'none') return null
  if (raw === '') return defaultUpstreamArgv(upstreamUrl)
  return raw.split(/\s+/)
}

function probeOnce(url) {
  return new Promise((resolveProbe) => {
    let settled = false
    const done = (ok) => {
      if (!settled) {
        settled = true
        resolveProbe(ok)
      }
    }
    const client = url.protocol === 'https:' ? https : http
    const req = client.get(url, (res) => {
      done(true)
      res.destroy()
    })
    req.setTimeout(PROBE_TIMEOUT_MS, () => {
      req.destroy()
      done(false)
    })
    req.on('error', () => done(false))
  })
}

async function waitForUpstream(url, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeOnce(url)) return
    await new Promise((sleep) => setTimeout(sleep, PROBE_INTERVAL_MS))
  }
  throw new Error(`upstream ${url.href} not ready after ${timeoutMs}ms`)
}

/** CLI entry: spawn the upstream, wait for it, listen, own the process tree. */
async function main() {
  const port = Number(process.env.PORT ?? 4173)

  let proxy
  try {
    proxy = createAuthProxy()
  } catch (error) {
    console.error(`[serve-auth] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }

  let upstreamArgv
  try {
    upstreamArgv = resolveUpstreamArgv(proxy.upstreamUrl)
  } catch (error) {
    console.error(`[serve-auth] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }

  let shuttingDown = false
  let child = null

  // Registered BEFORE the child is spawned (R28 F2): this process may run as
  // PID 1, where an unhandled SIGTERM means `docker stop` hangs until SIGKILL
  // and orphans the child. The handler must work during the whole boot window
  // (upstream wait, listen), not only once the server accepts traffic.
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    if (child) {
      child.kill(signal) // exit after the child exits (handler below)
    } else if (proxy.server.listening) {
      proxy.server.closeAllConnections()
      proxy.server.close(() => process.exit(0))
    } else {
      // Boot window with no child (UPSTREAM_CMD=none): nothing is listening.
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  if (upstreamArgv) {
    child = spawn(upstreamArgv[0], upstreamArgv.slice(1), {
      cwd: process.cwd(),
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.once('exit', (code) => {
      if (shuttingDown) process.exit(0)
      console.error(
        `[serve-auth] upstream exited unexpectedly (code=${code ?? 'null'}) — stopping`,
      )
      process.exit(code && code > 0 ? code : 1)
    })
    // Spawn failure (e.g. ENOENT) must exit 1, not leave a child-less wrapper
    // polling an upstream that will never come up.
    child.once('error', (error) => {
      console.error(`[serve-auth] failed to spawn upstream: ${error.message}`)
      process.exit(1)
    })
  }

  try {
    await waitForUpstream(
      proxy.upstreamUrl,
      Number(process.env.UPSTREAM_READY_TIMEOUT_MS ?? 120000),
    )
  } catch (error) {
    console.error(`[serve-auth] ${error instanceof Error ? error.message : String(error)}`)
    if (child) child.kill('SIGTERM')
    process.exit(1)
  }

  proxy.server.listen(port, '0.0.0.0', () => {
    const address = proxy.server.address()
    const boundPort = typeof address === 'object' && address ? address.port : port
    console.log(
      `[serve-auth] listening on 0.0.0.0:${boundPort} -> ${proxy.upstreamUrl.href} (basic auth on; exempt: /health /ready)`,
    )
  })
}

const invokedAsCli =
  import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href
if (invokedAsCli) {
  main().catch((error) => {
    console.error(`[serve-auth] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}

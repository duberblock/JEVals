// @vitest-environment node
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Server, ServerResponse } from 'node:http'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAuthProxy } from '../../scripts/serve-auth.mjs'

// Origin Basic Auth wrapper (ADR-005): real sockets against a real stub
// upstream, pinning what the wrapper forwards. Placeholders stay <16 chars.
const AUTH_USER = 'tester'
const AUTH_PASS = 'secret1'

type Captured = {
  method: string | undefined
  url: string | undefined
  headers: Record<string, string | string[] | undefined>
  body: string
}

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  server.close()
  server.closeAllConnections()
  await once(server, 'close').catch(() => undefined)
}

async function startStubUpstream(
  respond: (res: ServerResponse) => void = (res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  },
): Promise<{ server: Server; port: number; captured: Captured[] }> {
  const captured: Captured[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      captured.push({
        method: req.method,
        url: req.url,
        headers: { ...req.headers },
        body: Buffer.concat(chunks).toString('utf8'),
      })
      respond(res)
    })
  })
  const port = await listen(server)
  return { server, port, captured }
}

async function startProxy(upstreamPort: number) {
  const proxy = createAuthProxy({
    authUser: AUTH_USER,
    authPass: AUTH_PASS,
    upstreamUrl: `http://127.0.0.1:${upstreamPort}`,
  })
  const port = await listen(proxy.server)
  return { proxy, port }
}

type RawResponse = { status: number; body: string }

/** Parse a raw HTTP/1.x response once it is complete (content-length met). */
function parseRawResponse(raw: string): RawResponse | null {
  const separator = raw.indexOf('\r\n\r\n')
  if (separator === -1) return null
  const head = raw.slice(0, separator)
  const body = raw.slice(separator + 4)
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1]
  if (!status) return null
  const contentLength = /content-length:\s*(\d+)/i.exec(head)?.[1]
  if (contentLength && body.length < Number(contentLength)) return null
  return { status: Number(status), body }
}

/**
 * Minimal raw HTTP client over `node:net` — fetch cannot express the
 * absolute-form / protocol-relative request-targets pinned below.
 */
function rawRequest(port: number, request: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const chunks: Buffer[] = []
    let settled = false
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      socket.destroy()
      settle()
    }
    socket.on('connect', () => socket.write(request))
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      const parsed = parseRawResponse(Buffer.concat(chunks).toString('utf8'))
      if (parsed) finish(() => resolve(parsed))
    })
    socket.on('end', () => {
      const parsed = parseRawResponse(Buffer.concat(chunks).toString('utf8'))
      if (parsed) finish(() => resolve(parsed))
      else finish(() => reject(new Error('connection closed mid-response')))
    })
    socket.on('error', (error: Error) => finish(() => reject(error)))
    socket.setTimeout(5000, () => finish(() => reject(new Error('raw request timed out'))))
  })
}

describe('serve-auth origin wrapper', () => {
  let stub: Awaited<ReturnType<typeof startStubUpstream>>
  let proxyPort: number
  let proxyServer: Server

  const origin = (path: string) => `http://127.0.0.1:${proxyPort}${path}`

  beforeEach(async () => {
    stub = await startStubUpstream()
    const started = await startProxy(stub.port)
    proxyServer = started.proxy.server
    proxyPort = started.port
  })

  afterEach(async () => {
    await closeServer(proxyServer)
    await closeServer(stub.server)
  })

  it('answers 401 with the WWW-Authenticate challenge for anonymous /', async () => {
    const response = await fetch(origin('/'))

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Basic realm="jevals", charset="UTF-8"')
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect((await response.text()).length).toBeGreaterThan(0)
    expect(stub.captured).toHaveLength(0)
  })

  it('proxies the method, path, query and body of an authenticated request', async () => {
    const body = JSON.stringify({ state: { message: 'hi' }, questions: {} })
    const response = await fetch(origin('/api/v1/validations?source=web'), {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', authorization: basicAuth(AUTH_USER, AUTH_PASS) },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(stub.captured).toHaveLength(1)
    expect(stub.captured[0].method).toBe('POST')
    expect(stub.captured[0].url).toBe('/api/v1/validations?source=web')
    expect(stub.captured[0].body).toBe(body)
    expect(stub.captured[0].headers['content-type']).toContain('application/json')
  })

  describe.each(['/health', '/ready'])('exempt path %s (anonymous)', (path) => {
    it('is proxied without credentials', async () => {
      const response = await fetch(origin(path))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      expect(stub.captured).toHaveLength(1)
      expect(stub.captured[0].url).toBe(path)
    })

    it('forwards the request untouched, Authorization included', async () => {
      const response = await fetch(origin(path), {
        headers: { authorization: basicAuth(AUTH_USER, AUTH_PASS) },
      })

      expect(response.status).toBe(200)
      expect(stub.captured[0].headers.authorization).toBe(basicAuth(AUTH_USER, AUTH_PASS))
    })
  })

  it('keeps /ready?probe=1 exempt — query strings do not break the exact pathname match', async () => {
    const response = await fetch(origin('/ready?probe=1'))

    expect(response.status).toBe(200)
    expect(stub.captured[0].url).toBe('/ready?probe=1')
  })

  describe.each(['/health/', '/healthz', '/ready/sub'])('non-exempt path %s', (path) => {
    it('still requires credentials (exact-match pinned)', async () => {
      const response = await fetch(origin(path))

      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toBe('Basic realm="jevals", charset="UTF-8"')
      expect(stub.captured).toHaveLength(0)
    })
  })

  it('rejects a wrong password with 401 and never reaches the upstream', async () => {
    const response = await fetch(origin('/'), {
      headers: { authorization: basicAuth(AUTH_USER, 'wrong-pass') },
    })

    expect(response.status).toBe(401)
    expect(stub.captured).toHaveLength(0)
  })

  it('rejects a malformed Authorization header with 401', async () => {
    const response = await fetch(origin('/'), { headers: { authorization: 'Bearer nope' } })

    expect(response.status).toBe(401)
    expect(stub.captured).toHaveLength(0)
  })

  describe('request-target hardening (open-proxy/SSRF)', () => {
    it('rejects an anonymous absolute-form request-target with 400 and never reaches the named host', async () => {
      const evil = await startStubUpstream()
      try {
        const request =
          `GET http://127.0.0.1:${evil.port}/health HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${evil.port}\r\n` +
          `Connection: close\r\n\r\n`
        const response = await rawRequest(proxyPort, request)

        expect(response.status).toBe(400)
        await new Promise((sleep) => setTimeout(sleep, 150))
        expect(evil.captured).toHaveLength(0)
      } finally {
        await closeServer(evil.server)
      }
    })

    it('rejects a protocol-relative request-target with 400 even with valid credentials', async () => {
      const evil = await startStubUpstream()
      try {
        const request =
          `GET //127.0.0.1:${evil.port}/health HTTP/1.1\r\n` +
          `Host: 127.0.0.1\r\n` +
          `Authorization: ${basicAuth(AUTH_USER, AUTH_PASS)}\r\n` +
          `Connection: close\r\n\r\n`
        const response = await rawRequest(proxyPort, request)

        expect(response.status).toBe(400)
        await new Promise((sleep) => setTimeout(sleep, 150))
        expect(evil.captured).toHaveLength(0)
      } finally {
        await closeServer(evil.server)
      }
    })
  })

  it('strips the Authorization header before proxying authenticated requests', async () => {
    await fetch(origin('/'), { headers: { authorization: basicAuth(AUTH_USER, AUTH_PASS) } })

    expect(stub.captured).toHaveLength(1)
    expect(stub.captured[0].headers.authorization).toBeUndefined()
  })

  it('proxies HEAD requests (method pinned)', async () => {
    const response = await fetch(origin('/api/v1/capabilities'), {
      method: 'HEAD',
      headers: { authorization: basicAuth(AUTH_USER, AUTH_PASS) },
    })

    expect(response.status).toBe(200)
    expect(stub.captured).toHaveLength(1)
    expect(stub.captured[0].method).toBe('HEAD')
  })

  it('strips headers named in the Connection token plus Connection itself', async () => {
    const request =
      `GET /api/v1/capabilities HTTP/1.1\r\n` +
      `Host: 127.0.0.1\r\n` +
      `Authorization: ${basicAuth(AUTH_USER, AUTH_PASS)}\r\n` +
      `Connection: x-custom\r\n` +
      `x-custom: v\r\n` +
      `Connection: close\r\n\r\n`
    const response = await rawRequest(proxyPort, request)

    expect(response.status).toBe(200)
    expect(stub.captured).toHaveLength(1)
    const forwarded = stub.captured[0].headers
    // The client's Connection tokens (and every header they name) must not
    // survive the hop. Node's own client adds its hop-control `close` — the
    // pin is that NOTHING from the client's token list is forwarded.
    expect(forwarded['x-custom']).toBeUndefined()
    expect(String(forwarded.connection ?? '').toLowerCase()).not.toContain('x-custom')
  })

  it('passes an upstream non-200 status and body through untouched', async () => {
    const failing = await startStubUpstream((res) => {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('upstream on fire')
    })
    const started = await startProxy(failing.port)
    try {
      const response = await fetch(`http://127.0.0.1:${started.port}/api/v1/capabilities`, {
        headers: { authorization: basicAuth(AUTH_USER, AUTH_PASS) },
      })

      expect(response.status).toBe(503)
      expect(await response.text()).toBe('upstream on fire')
    } finally {
      await closeServer(started.proxy.server)
      await closeServer(failing.server)
    }
  })

  it('answers 502 plain text when the upstream is unreachable', async () => {
    const dead = createServer()
    const deadPort = await listen(dead)
    await closeServer(dead)

    const proxy = createAuthProxy({
      authUser: AUTH_USER,
      authPass: AUTH_PASS,
      upstreamUrl: `http://127.0.0.1:${deadPort}`,
    })
    const port = await listen(proxy.server)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { authorization: basicAuth(AUTH_USER, AUTH_PASS) },
      })

      expect(response.status).toBe(502)
      expect(response.headers.get('content-type')).toContain('text/plain')
    } finally {
      await closeServer(proxy.server)
    }
  })

  it('fails closed at construction when AUTH_USER or AUTH_PASS is missing', () => {
    const backup = {
      AUTH_USER: process.env.AUTH_USER,
      AUTH_PASS: process.env.AUTH_PASS,
    }
    const upstreamUrl = `http://127.0.0.1:${stub.port}`
    const failWith = (): string => {
      try {
        createAuthProxy({ upstreamUrl })
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
      throw new Error('expected createAuthProxy to throw')
    }

    try {
      delete process.env.AUTH_USER
      delete process.env.AUTH_PASS
      const missingBoth = failWith()
      expect(missingBoth).toMatch(/AUTH_USER is required/)
      expect(missingBoth).not.toMatch(/AUTH_PASS/)
      process.env.AUTH_USER = AUTH_USER
      const missingPass = failWith()
      expect(missingPass).toMatch(/AUTH_PASS is required/)
      expect(missingPass).not.toMatch(/AUTH_USER/)
    } finally {
      for (const [key, value] of Object.entries(backup)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

describe('serve-auth CLI lifecycle', () => {
  it(
    'boots, serves 401 anonymously and exits 0 on SIGTERM (UPSTREAM_CMD=none)',
    async () => {
      const stub = await startStubUpstream()
      const child = spawn(process.execPath, ['scripts/serve-auth.mjs'], {
        cwd: new URL('../..', import.meta.url).pathname,
        env: {
          ...process.env,
          PORT: '0',
          UPSTREAM_CMD: 'none',
          UPSTREAM_URL: `http://127.0.0.1:${stub.port}`,
          AUTH_USER,
          AUTH_PASS,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const stdoutLines: string[] = []
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => stdoutLines.push(...chunk.split('\n')))

      try {
        // Wait for the single startup line and recover the ephemeral port.
        const port = await new Promise<number>((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error('no listen line')), 10000)
          child.stdout.on('data', (chunk: string) => {
            // Anchor to the bound-address segment so the greedy match cannot
            // capture the upstream port later in the same line.
            const match = /listening on [^:\s]+:(\d+)/.exec(chunk)
            if (match) {
              clearTimeout(deadline)
              resolve(Number(match[1]))
            }
          })
          child.on('exit', (code) => reject(new Error(`exited early: ${code ?? 'signal'}`)))
        })

        const response = await fetch(`http://127.0.0.1:${port}/`)
        expect(response.status).toBe(401)

        child.kill('SIGTERM')
        const [exitCode] = await once(child, 'exit')
        expect(exitCode).toBe(0)

        const logged = stdoutLines.filter((line) => line.trim().length > 0)
        expect(logged).toHaveLength(1)
        expect(logged[0]).not.toMatch(/authorization|secret1/i)
      } finally {
        // 'exit' is one-shot: only await it when the child is still running.
        if (child.exitCode === null) {
          child.kill('SIGKILL')
          await once(child, 'exit').catch(() => undefined)
        }
        await closeServer(stub.server)
      }
    },
    15000,
  )

  it(
    'fails closed at startup (exit 1) when AUTH_USER/AUTH_PASS are missing',
    async () => {
      const child = spawn(process.execPath, ['scripts/serve-auth.mjs'], {
        cwd: new URL('../..', import.meta.url).pathname,
        env: {
          ...process.env,
          PORT: '0',
          UPSTREAM_CMD: 'none',
          UPSTREAM_URL: 'http://127.0.0.1:9',
          AUTH_USER: '',
          AUTH_PASS: '',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      child.stderr.setEncoding('utf8')
      const stderrChunks: string[] = []
      child.stderr.on('data', (chunk: string) => stderrChunks.push(chunk))

      try {
        const [exitCode] = await once(child, 'exit')
        expect(exitCode).toBe(1)
        expect(stderrChunks.join('')).toMatch(/AUTH_USER/)
      } finally {
        // 'exit' is one-shot: only await it when the child is still running.
        if (child.exitCode === null) {
          child.kill('SIGKILL')
          await once(child, 'exit').catch(() => undefined)
        }
      }
    },
  )

  it(
    'exits non-zero when the upstream child dies unexpectedly (F2 pin)',
    async () => {
      const child = spawn(process.execPath, ['scripts/serve-auth.mjs'], {
        cwd: new URL('../..', import.meta.url).pathname,
        env: {
          ...process.env,
          PORT: '0',
          // Space-separated argv with no quoting support (header contract) —
          // the snippet below deliberately contains no spaces.
          UPSTREAM_CMD: `${process.execPath} -e setTimeout(()=>process.exit(3),200)`,
          UPSTREAM_URL: 'http://127.0.0.1:9',
          UPSTREAM_READY_TIMEOUT_MS: '10000',
          AUTH_USER,
          AUTH_PASS,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      child.stderr.setEncoding('utf8')
      const stderrChunks: string[] = []
      child.stderr.on('data', (chunk: string) => stderrChunks.push(chunk))

      try {
        const [exitCode] = await once(child, 'exit')
        expect(exitCode).toBe(3)
        expect(stderrChunks.join('')).toMatch(/upstream exited unexpectedly \(code=3\)/)
      } finally {
        // 'exit' is one-shot: only await it when the child is still running.
        if (child.exitCode === null) {
          child.kill('SIGKILL')
          await once(child, 'exit').catch(() => undefined)
        }
      }
    },
    15000,
  )
})

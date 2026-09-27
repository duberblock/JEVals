/**
 * Type surface for scripts/serve-auth.mjs (the deploy origin Basic Auth
 * wrapper — ADR-005). The implementation stays plain Node JavaScript: the
 * container runs it directly (`node scripts/serve-auth.mjs`) with no build
 * step, so tests import the .mjs while tsc reads this companion declaration.
 */
import type { Server } from 'node:http'

export interface AuthProxyOptions {
  authUser?: string
  authPass?: string
  upstreamUrl?: string
}

export interface AuthProxy {
  server: Server
  upstreamUrl: URL
}

export declare class AuthConfigError extends Error {
  constructor(message?: string)
}

export declare const EXEMPT_PATHS: Set<string>

export declare function checkBasicAuth(
  header: string | undefined,
  authUser: string,
  authPass: string,
): boolean

export declare function isExemptPath(pathname: string): boolean

export declare function createAuthProxy(options?: AuthProxyOptions): AuthProxy

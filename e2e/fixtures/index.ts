import type { Page, Route } from '@playwright/test'

import capabilities from './capabilities.json'

// The settings view the /settings screen renders: every provider honest,
// one key visibly saved (the plaintext never exists client-side).
const settingsView = {
  providers: {
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
      sources: { endpoint: 'env', model: 'none', apiKey: 'none' },
    },
    independent: {
      endpoint: 'https://api.openai.com/v1',
      model: null,
      keySet: false,
      available: false,
      configuredHere: { endpoint: false, model: false, apiKey: false },
      sources: { endpoint: 'env', model: 'none', apiKey: 'none' },
    },
  },
}
import compareSnapshot from './compare-snapshot.json'
import emulatorSnapshot from './emulator-snapshot.json'
import executionSnapshot from './execution-snapshot.json'
import executionsList from './executions-list.json'
import validation from './validation.json'

// P36/FB9 extreme-label fixture — P36 owns it, P37 reuses.
import executionExtreme from './execution-extreme.json'

// P28 (FB1): SSE lane support — see ./sse.ts.
import { buildSseBody } from './sse'

// §79 Phase 10 console hygiene gate (shared support, re-exported so specs
// keep importing everything from this single entry).
export { collectConsoleNoise, drainConsole, expectNoConsoleNoise } from './console-noise'
export type { ConsoleNoiseRecord } from './console-noise'

// Hermetic API fixtures for the Playwright E2E suite. Every browser call to
// /api/v1/** is intercepted and answered from these JSON files (mirroring the
// apps/web/lib/execution-snapshot.ts types and the API routes' documented
// shapes) — no real jevals API is ever reached.

export const EXECUTION_ID = executionSnapshot.execution_id
export const EMULATOR_ID = emulatorSnapshot.execution_id
export const COMPARE_ID = compareSnapshot.execution_id
// P36/FB9 extreme-label fixture — P36 owns it, P37 reuses.
export const EXTREME_ID = executionExtreme.execution_id

// The canonical three-question SystemOneRequest (same document as the web
// app's Sample button and packages/contracts/fixtures/system-one-request.valid.json).
export const SYSTEM_ONE_REQUEST = `{
  "state": {
    "message": "I was charged twice on my invoice."
  },
  "questions": {
    "request_type": {
      "type": "choice",
      "instructions": "Classify this request.",
      "criteria": {
        "billing": "Billing issue",
        "technical": "Technical issue",
        "sales": "Sales request"
      }
    },
    "urgency": {
      "type": "score",
      "criteria": ["low", "medium", "high"]
    },
    "refund_requested": {
      "type": "noul",
      "criteria": {
        "true": "The customer requests a refund.",
        "false": "The customer does not request a refund."
      }
    }
  }
}`

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

// The most recent POST /api/v1/executions request body, so specs can pin the
// mode radio -> request wiring (fresh-context verification note: the flow
// must EXERCISE a non-default mode, not just assert the radios exist).
export type HermeticApi = {
  lastExecutionBody: () => Record<string, unknown> | undefined
}

// Install the route table for every /api/v1/** call the web app can make:
// capabilities, validations, POST executions (the completed run, answered
// with the real 201 and a snapshot SHAPED BY THE REQUESTED MODE), the
// executions list (recent/operation/history) and the execution detail. Any
// unexpected call answers 500 loudly instead of hitting a real server.
//
// P28 (FB1): the run POST now negotiates text/event-stream, so the POST lane
// content-negotiates exactly like the API — accept includes
// text/event-stream -> SSE frames (section events + final) built from the
// same mode-shaped snapshot; anything else (or options.forceJson, which pins
// the JSON lane for the degradation spec — an upstream that ignores
// negotiation) -> the JSON snapshot, as before.
export async function installHermeticApi(
  page: Page,
  options: { forceJson?: boolean } = {}
): Promise<HermeticApi> {
  let lastExecutionBody: Record<string, unknown> | undefined
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    const method = request.method()

    if (pathname === '/api/v1/capabilities' && method === 'GET') {
      return fulfillJson(route, capabilities)
    }
    if (pathname === '/api/v1/settings' && method === 'GET') {
      return fulfillJson(route, settingsView)
    }
    if (pathname === '/api/v1/settings' && method === 'PUT') {
      return fulfillJson(route, settingsView)
    }
    if (pathname === '/api/v1/validations' && method === 'POST') {
      return fulfillJson(route, validation)
    }
    if (pathname === '/api/v1/executions' && method === 'POST') {
      lastExecutionBody = request.postDataJSON() as Record<string, unknown>
      // The real API answers 201 Created with a mode-shaped snapshot
      // (apps/api §65/§47): emulator -> emulator section only; compare ->
      // emulator + jev + comparison; compare-and-evaluate -> additionally
      // ai_evaluation (+ independent_openai when the advanced option ran, which
      // the full fixture carries). Any other mode is a fixture-table bug:
      // answer 500 loudly instead of serving a fiction.
      const mode = lastExecutionBody.mode
      const snapshot =
        mode === 'emulator'
          ? emulatorSnapshot
          : mode === 'compare'
            ? compareSnapshot
            : mode === 'compare-and-evaluate'
              ? executionSnapshot
              : null
      if (snapshot === null) {
        return fulfillJson(
          route,
          {
            title: 'Unexpected execution mode',
            detail: `POST /api/v1/executions carried mode '${String(mode)}' — no fixture snapshot exists for it.`,
            status: 500,
          },
          500
        )
      }
      const wantsStream =
        !options.forceJson && (request.headers()['accept'] ?? '').includes('text/event-stream')
      if (wantsStream) {
        return route.fulfill({
          status: 201,
          contentType: 'text/event-stream',
          body: buildSseBody(snapshot as Record<string, unknown>),
        })
      }
      return fulfillJson(route, snapshot, 201)
    }
    if (pathname === '/api/v1/executions' && method === 'GET') {
      // The list fixture serves both ?limit=5 (recent) and ?limit=50 (operation
      // and history) — both surfaces render the same delivered items.
      return fulfillJson(route, executionsList)
    }
    const detail = /^\/api\/v1\/executions\/([^/]+)$/.exec(pathname)
    if (detail && method === 'GET') {
      // Each run id serves ITS OWN snapshot, so detail routing stays coherent
      // with whatever mode the spec exercised.
      const id = decodeURIComponent(detail[1])
      if (id === EXECUTION_ID) {
        return fulfillJson(route, executionSnapshot)
      }
      if (id === EMULATOR_ID) {
        return fulfillJson(route, emulatorSnapshot)
      }
      if (id === COMPARE_ID) {
        return fulfillJson(route, compareSnapshot)
      }
      // P36/FB9 extreme-label fixture — P36 owns it, P37 reuses.
      if (id === EXTREME_ID) return fulfillJson(route, executionExtreme)
      return fulfillJson(
        route,
        { title: 'Execution not found', detail: 'This execution does not exist.', status: 404 },
        404
      )
    }
    return fulfillJson(
      route,
      { title: 'Unexpected API call', detail: `${method} ${pathname}`, status: 500 },
      500
    )
  })
  return { lastExecutionBody: () => lastExecutionBody }
}

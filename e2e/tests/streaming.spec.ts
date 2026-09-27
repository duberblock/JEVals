import { createServer, type Server } from 'node:http'

import { expect, test, type Page } from '@playwright/test'

import {
  collectConsoleNoise,
  type ConsoleNoiseRecord,
  drainConsole,
  expectNoConsoleNoise,
  installHermeticApi,
  SYSTEM_ONE_REQUEST,
} from '../fixtures'

// The evaluate-mode fixture snapshot: its §47 sections feed the delayed SSE
// origin below (the same document the JSON lane serves for the mode).
import executionSnapshot from '../fixtures/execution-snapshot.json'

// P28 (FB1) e2e: the run POST negotiates text/event-stream and the hermetic
// route table answers with the SSE lane (section frames + one final frame,
// built from the same mode-shaped snapshot fixtures). (a) the streamed final
// frame renders the SAME result surface the JSON lane renders; (b) when the
// upstream ignores the negotiation and answers JSON anyway, the client
// degrades honestly onto the existing JSON lane. Written from the existing
// spec patterns (desktop.spec.ts); NOT run in the P28 sandbox (no browsers)
// — the orchestrator's e2e gate owns the run.

// §79 Phase 10 console hygiene gate, whole-test scope (same shape as the
// other specs: collect from the page before anything navigates, assert once
// after each test finishes).
let consoleNoise: ConsoleNoiseRecord[]
let consolePage: Page

test.beforeEach(async ({ page }) => {
  consolePage = page
  consoleNoise = collectConsoleNoise(page)
})

test.afterEach(async () => {
  // D1 drain window (FIRST, before the synchronous assert).
  await drainConsole(consolePage)
  expectNoConsoleNoise(consoleNoise, `streaming · ${test.info().titlePath.join(' › ')}`)
})

test.describe('P28 streaming run lane', () => {
  test('a run served over SSE renders the final result like the JSON lane', async ({ page }) => {
    await installHermeticApi(page)
    await page.goto('/')

    await page.getByRole('textbox', { name: 'Request JSON' }).fill(SYSTEM_ONE_REQUEST)
    await expect(page.getByText('3 QUESTIONS DETECTED')).toBeVisible()

    // P47 (a): the editor's LIVE parse already yields the scenario — the
    // validation panel carries the collapsed box under the questions detected,
    // no /validations verdict needed.
    const panelScenario = page.getByTestId('validation-panel').getByTestId('scenario-box')
    await expect(panelScenario).toBeVisible()

    // The default emulator mode: the SSE body carries exactly one section
    // frame (emulator — the snapshot has no jev/judge sections, §47) plus
    // the final envelope; the hero renders from the final frame.
    await page.getByRole('button', { name: 'Run request' }).click()

    // P46: the run's arming collapsed the input block behind the request
    // disclosure — the editor is gone and the one-line summary owns it,
    // while the result surface stays alive underneath.
    const requestToggle = page.getByTestId('request-toggle')
    await expect(requestToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('textbox', { name: 'Request JSON' })).toHaveCount(0)

    const hero = page.getByTestId('hero-result')
    await expect(hero).toBeVisible()
    await expect(hero).toContainText('✓ Run completed · 3 questions')
    await expect(page.getByTestId('question-results')).toBeVisible()

    // P46: landing the result does NOT re-expand (T2.4) — but expanding at
    // will brings the whole input block back, editor included.
    await expect(requestToggle).toHaveAttribute('aria-expanded', 'false')
    await requestToggle.click()
    await expect(requestToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('textbox', { name: 'Request JSON' })).toBeVisible()

    // P47 (b): the results block carries the scenario above the rows — the
    // persisted snapshot.request.state in the shared collapsed ScenarioBox;
    // expanding reveals the fixture's exact state.
    const resultsScenario = page.getByTestId('principal-results').getByTestId('scenario-box')
    await expect(resultsScenario).toBeVisible()
    await resultsScenario.getByRole('button', { name: 'View scenario' }).click()
    await expect(resultsScenario.getByTestId('scenario-content')).toContainText('I was charged twice on my invoice.')

    // The completed strip derives from the final envelope: the emulator chip
    // shows its observed success, the never-run chips stay honest dashes.
    const strip = page.getByTestId('source-strip')
    await expect(strip).toHaveAttribute('aria-label', 'Emulator ✓ · JEV — · Judge — · Independent —')

    // C5: the context bar carries the streamed run's facts like any other.
    const contextBar = page.getByTestId('execution-context-bar')
    await expect(contextBar).toContainText('Run ID')
    await expect(contextBar).toContainText('Emulator')
  })

  test('the client degrades to the JSON lane when the upstream ignores negotiation', async ({ page }) => {
    // forceJson pins the POST lane on the plain JSON snapshot although the
    // client sent accept: text/event-stream — the content-type sniff must
    // route it onto today's JSON handling (honest degradation).
    await installHermeticApi(page, { forceJson: true })
    await page.goto('/')

    await page.getByRole('textbox', { name: 'Request JSON' }).fill(SYSTEM_ONE_REQUEST)
    await expect(page.getByText('3 QUESTIONS DETECTED')).toBeVisible()

    await page.getByRole('button', { name: 'Run request' }).click()

    const hero = page.getByTestId('hero-result')
    await expect(hero).toBeVisible()
    await expect(hero).toContainText('✓ Run completed · 3 questions')
    await expect(page.getByTestId('question-results')).toBeVisible()
  })

  // P39: progressive results over the SSE lane. A single route.fulfill body
  // would deliver every frame in one reader chunk (React paints only the
  // final state), so the delayed frames ride a REAL socket: a tiny local
  // origin streams the §65 frames the deterministic rows need (emulator,
  // jev, comparison, independent — the API's post-P40 publication order)
  // immediately and HOLDS the judge section + final envelope until the spec
  // releases them. The run POST is continued onto it; every other /api/v1
  // call falls back to the hermetic table.
  test('progressive results: rows and the LLM bar land before the judge final', async ({ page }) => {
    const sse = await startDelayedEvaluateSse()
    await installHermeticApi(page)
    // Registered AFTER the hermetic table (later routes win). OPTIONS rides
    // along in case the rewritten URL ever triggers a CORS preflight — the
    // origin answers it with permissive headers.
    await page.route('**/api/v1/executions', (route) => {
      const method = route.request().method()
      if (method === 'POST' || method === 'OPTIONS') {
        return route.continue({ url: `${sse.origin}/api/v1/executions` })
      }
      return route.fallback()
    })

    try {
      await page.goto('/')

      await page.getByRole('textbox', { name: 'Request JSON' }).fill(SYSTEM_ONE_REQUEST)
      await expect(page.getByText('3 QUESTIONS DETECTED')).toBeVisible()

      const modes = page.getByRole('radiogroup', { name: 'Execution mode' })
      await modes.getByRole('radio', { name: 'Evaluate prediction' }).check()
      await page.getByRole('button', { name: 'Run request' }).click()

      // BEFORE the final frame: the deterministic §29/§30 rows are visible
      // with the fixture's exact compare facts, the LLM bar sits above
      // them, and Run stays blocked. P41: the hero slot already renders the
      // PROGRESSIVE hero — the deterministic §22 facts from the arrived
      // sections (fidelity, aligned, models, the independent line — its
      // frame is immediate in the post-P40 order) with the Inspect CTA
      // visible-but-disabled (no executionId exists mid-run, §35); the
      // judge line is still absent (its section is held with the final).
      const rows = page.getByTestId('question-results')
      await expect(rows).toBeVisible()
      await expect(rows).toContainText('Question results')
      await expect(rows).toContainText('billing → billing')
      await expect(rows).toContainText('Same decision')
      await expect(rows).toContainText('1.82 → 1.64')
      await expect(rows).toContainText('Δ .18')
      await expect(rows).toContainText('high ↔ high')
      await expect(rows).toContainText('.082 → .119')
      await expect(rows).toContainText('Both < .5')
      // P44 supersedes ADR-024 ruling 2's rows-slot bar: the LLM feedback
      // lives ONLY in the CTA surface (determinate progressbar + shimmer +
      // spinner + visible label, pinned below) — the rows slot renders
      // rows, nothing else.
      await expect(page.getByTestId('llm-progress')).toHaveCount(0)
      // P47 (b): mid-run the scenario rides above the rows from the POSTED
      // envelope — collapsed by default; expanding reveals the fixture state.
      const scenarioBox = page.getByTestId('principal-results').getByTestId('scenario-box')
      await expect(scenarioBox).toBeVisible()
      await scenarioBox.getByRole('button', { name: 'View scenario' }).click()
      await expect(scenarioBox.getByTestId('scenario-content')).toContainText('I was charged twice on my invoice.')
      const hero = page.getByTestId('hero-result')
      await expect(hero).toBeVisible()
      await expect(hero).toContainText('✓ PREDICTION MATCHED JEV')
      await expect(hero).toContainText('95%')
      await expect(hero).toContainText('JEV Fidelity')
      await expect(hero).toContainText('3 / 3 questions aligned')
      await expect(hero).toContainText('jev-emulator')
      await expect(hero).toContainText('jev-latest')
      await expect(hero).toContainText('Independent: aligned')
      await expect(hero).not.toContainText('Judge:')
      const inspect = page.getByRole('button', { name: 'Inspect in Investigation' })
      await expect(inspect).toBeDisabled()
      await expect(inspect).toHaveAttribute('title', 'Available when the run completes')
      // P46 (W3 re-scope): the run's arming collapsed the input block — Run
      // lives INSIDE the disclosure now, so expand to keep asserting the
      // mid-flight blocking (the original pin runs unchanged once the block
      // is open; the collapse itself is pinned in the JSON-lane test above).
      await page.getByTestId('request-toggle').click()
      await expect(page.getByRole('button', { name: 'Running…' })).toBeDisabled()
      // P42: the determinate activity bar rides the CTA row — progressbar
      // semantics over the owner's ~60s response budget: the value advances
      // with the elapsed time but can never reach 100 before the final
      // (capped at 95 — the budget is an expectation, not a contract).
      const progress = page.getByRole('progressbar')
      await expect(progress).toBeVisible()
      await expect(progress).toHaveAttribute('aria-valuemin', '0')
      await expect(progress).toHaveAttribute('aria-valuemax', '100')
      await expect(progress).toHaveAttribute('aria-label', 'LLM query in progress…')
      const progressValue = Number(await progress.getAttribute('aria-valuenow'))
      expect(progressValue).toBeGreaterThanOrEqual(0)
      expect(progressValue).toBeLessThanOrEqual(95)
      await expect(hero.getByText(/\d+ s/)).toBeVisible()
      // P43: the feedback is unmissable — a continuous indeterminate band
      // slides over the honest determinate fill, the disabled button itself
      // spins a hidden loader, and the in-progress state is VISIBLE text in
      // the CTA row (not just the progressbar's accessible name).
      await expect(page.getByTestId('cta-progress-shimmer')).toBeVisible()
      await expect(inspect.locator('svg')).toBeVisible()
      await expect(hero).toContainText('LLM query in progress…')

      // Release the judge section + final envelope: the bar hides, the hero
      // completes with the judge line, the Inspect CTA becomes the REAL §35
      // link, the activity progressbar unmounts with the progressive hero,
      // and the rows keep their parity with the final snapshot.
      sse.release()
      await expect(hero).toContainText('Judge: No material divergence')
      const inspectLink = page.getByRole('link', { name: 'Inspect in Investigation' })
      await expect(inspectLink).toBeVisible()
      await expect(inspectLink).toHaveAttribute('href', /\/investigation\?execution=/)
      await expect(page.getByRole('progressbar')).toHaveCount(0)
      await expect(page.getByTestId('cta-progress-shimmer')).toHaveCount(0)
      await expect(rows).toContainText('billing → billing')
      await expect(rows).toContainText('1.82 → 1.64')
      await expect(page.getByTestId('llm-progress')).toHaveCount(0)
      // P47 (b) parity: the landed snapshot's persisted request.state renders
      // the SAME expanded box with the same content — the progressive→final
      // source switch is invisible.
      await expect(scenarioBox.getByTestId('scenario-content')).toContainText('I was charged twice on my invoice.')
    } finally {
      sse.release()
      await sse.close()
    }
  })
})

// P49 e2e: a string state is the ENUNCIADO — the owner's report: a long
// scenario landed in a horizontal scrollbar and read as monospace JSON. The
// live-parse panel box now renders it as prose that grows; the pin is a REAL
// layout measurement (jsdom cannot measure): the content element never
// overflows horizontally.
test.describe('P49 scenario prose', () => {
  test('a long string state reads as growing prose with no horizontal scroll', async ({ page }) => {
    await installHermeticApi(page)

    await page.goto('/')

    // The editor's live parse feeds the panel box: a minimal parseable
    // request carrying a long natural-language state (excerpt of the
    // owner's real EnvíoYa case).
    const enunciado =
      'EnvíoYa procesa normalmente 48.000 paquetes al día y hoy espera 71.600 por una campaña comercial. ' +
      'El clasificador principal falló durante 47 minutos y luego operó al 55 % durante 2 h 18 min, generando un backlog de 8.420 paquetes. ' +
      'La capacidad normal del hub es 6.200 paquetes/h, la actual 4.100 y podría subir a 5.400 después de las 14:00.'
    const editor = page.getByRole('textbox', { name: 'Request JSON' })
    await editor.fill(JSON.stringify({ state: enunciado }))

    const panelScenario = page.getByTestId('validation-panel').getByTestId('scenario-box')
    await expect(panelScenario).toBeVisible()
    await panelScenario.getByRole('button', { name: 'View scenario' }).click()

    const content = panelScenario.getByTestId('scenario-content')
    await expect(content).toBeVisible()
    // Raw prose — no JSON quotes around the enunciado.
    await expect(content).toContainText('EnvíoYa procesa normalmente')
    // P49: prose wraps — the box grows, never a horizontal scrollbar.
    const overflow = await content.evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

// P39: the delayed SSE origin described in the progressive-results test.
type DelayedSseOrigin = {
  origin: string
  release: () => void
  close: () => Promise<void>
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function sectionFrame(section: string, payload: unknown): string {
  const status = (payload as { status?: string } | undefined)?.status ?? 'success'
  return sseFrame('section', { section, status, payload })
}

async function startDelayedEvaluateSse(): Promise<DelayedSseOrigin> {
  // §65 publication order after P40 (the API's stream names them): emulator
  // and jev resolve, then comparison lands immediately after the pair, then
  // the independent leg resolves in flight; the judge starts after the
  // comparison (concurrent with the independent); the final envelope closes
  // the run. The mock holds only judge + final, so the bar stays visible on
  // the pending judge exactly like a slow LLM evaluate.
  const immediate =
    sectionFrame('emulator', executionSnapshot.emulator) +
    sectionFrame('jev', executionSnapshot.jev) +
    sectionFrame('comparison', executionSnapshot.comparison) +
    sectionFrame('independent', executionSnapshot.independent_openai)
  const held = sectionFrame('judge', executionSnapshot.ai_evaluation) + sseFrame('final', executionSnapshot)

  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const server: Server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, accept',
      })
      response.end()
      return
    }
    if (request.method !== 'POST' || request.url !== '/api/v1/executions') {
      response.writeHead(500).end('unexpected request')
      return
    }
    request.resume()
    response.writeHead(201, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'access-control-allow-origin': '*',
    })
    response.write(immediate)
    void released.then(() => {
      response.write(held)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('the delayed SSE origin could not obtain a port')
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    release,
    close: () => {
      // Graceful drain FIRST: server.close() stops new connections and, if
      // the browser already consumed the terminal chunk, lets the loop exit
      // naturally. The browser may otherwise still be draining the chunked
      // terminator when a closeAllConnections() destroy would cut the
      // socket mid-response (ERR_INCOMPLETE_CHUNKED_ENCODING in the console
      // gate) — so destroy lingering keep-alive sockets only after a grace
      // window, where they are idle and safe to cut.
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
      void closed.catch(() => {})
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          server.closeAllConnections()
          void closed.then(() => resolve(), () => resolve())
        }, 300)
      })
    },
  }
}

# Architecture

JEVals is a monorepo: a FastAPI service, a Next.js app, shared contracts,
and hermetic end-to-end suites.

```text
apps/api            FastAPI service
  app/domain/         execution pipeline, provider PORTS, persistence
  app/providers/      provider ADAPTERS (emulator, JEV, judge, independent)
  app/api/routes/     HTTP surface (executions, validations, capabilities, settings)
  app/core/           config, crypto (Fernet), security
  alembic/            migrations (SQLite)
apps/web            Next.js app
  components/         Principal / Investigation / Operation / Settings surfaces
  app/api/v1/[...]/   BFF proxy — injects Basic Auth, forwards to the API
  lib/i18n/           EN/ES dictionaries (exact key parity)
packages/contracts  JSON schemas + canonical fixtures (single wire truth)
e2e                 Playwright suites — hermetic, no live providers, no keys
scripts             scan_secrets, smoke_live (LIVE acceptance lane), local_emulator
```

## Execution pipeline

One `SystemOneRequest` (a shared `state` plus `choice` / `score` / `noul`
questions) runs through four legs:

1. **Emulator** (the model under test) — any SystemOne or Simple Jev
   endpoint; the URL decides the protocol.
2. **JEV baseline** (the reference) — typesafe.ai by default; any compatible
   service.
3. **Independent prediction** — an OpenAI-compatible LLM that answers seeing
   ONLY the original request (opt-in, any mode).
4. **Judge** — an OpenAI-compatible LLM that interprets Emulator-vs-JEV
   differences; it receives request + both results + the deterministic
   comparison, and never sees the independent prediction.

The emulator, JEV and independent legs run in parallel; fidelity (per
question, deterministic math) follows the emulator+JEV pair; the Judge runs
last. Every run persists an **immutable snapshot** (request, per-leg
sections with the model each endpoint actually served, comparison, judge
output, timings) — the web renders from snapshots and never re-derives or
re-runs anything.

## Ports and adapters

Domain code depends on provider **ports** (`app/domain/executions/`);
concrete clients (`app/providers/`) are integrations built at the
composition root (`app/api/dependencies.py`). The judge degrades through a
compatibility ladder (strict → guided → prompted) on HTTP 400; the
independent leg falls back from native JSON Schema to prompted mode when
the model returns malformed structure.

## Configuration layering

Environment variables are the deployment pre-seed; the **Settings screen**
(`app/domain/settings/`) stores per-provider overrides (endpoint, model,
API key, native-JSON-Schema flag) in a single-row table. API keys are
encrypted at rest with Fernet — the master key comes from
`SETTINGS_ENCRYPTION_KEY` or an auto-generated `settings.key` beside the
database (gitignored; losing it degrades stored keys to "not configured",
never to a crash). UI values win over the environment; a partial settings
PUT never clears fields it does not mention.

## Gates

`make demo-gate` (secret scan + scripts + contracts + API + web + strict
e2e), `make lint`, `make typecheck-api`. CI mirrors the static gates and
both suites on every push to `main` and pull request.

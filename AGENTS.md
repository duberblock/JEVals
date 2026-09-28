# Instructions for coding agents

Rules for AI coding agents (and disciplined humans in a hurry). Read
[CONTRIBUTING.md](CONTRIBUTING.md) first — it defines the full process; this
file is the operating checklist.

## Before proposing changes

- Run the gates you can: `make lint`, `make typecheck-api`,
  `cd apps/api && uv run pytest -q`, `cd apps/web && npx vitest run && npx tsc --noEmit`.
  The complete local gate is `make demo-gate`.
- Every behavior change ships with tests. The suites are hermetic: never
  introduce network calls or live provider keys into them.
- Never commit secrets, `.env` files, or real API keys — `make secret-scan`
  runs in every gate and will fail the run.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:`, `style:`) with a scope when it clarifies (`feat(settings):`).
- User-facing strings live in the dictionaries
  (`apps/web/lib/i18n/en.ts` and `es.ts`) and must stay in exact key parity
  across both locales.
- Provider configuration is layered: UI settings override environment
  defaults; a partial settings PUT must never clear fields it does not
  mention (`exclude_unset` semantics are a pinned contract).
- §-numbered references in code comments point to the internal design plan —
  keep them when you touch the code they document; do not invent new ones.

## Boundaries

- Do not change public API shapes (execution snapshot sections, settings
  contract, provider protocols) without an issue-first discussion — those
  payloads are persisted evidence; old snapshots must keep rendering.
- Do not weaken the redaction pipeline: provider keys and authorization
  material must never reach logs, persisted snapshots, or API responses.
- Do not edit `apps/web/package-lock.json`, `uv.lock`, or generated fixtures
  by hand — regenerate them.
- Keep pull requests small and single-purpose; big refactors land in stages.

## When an architectural decision is needed

For protocol changes, new providers, or persistence schema moves, propose the
decision in an issue (context, options, recommendation) before implementing —
the same issue-first rule CONTRIBUTING applies to humans applies to you.

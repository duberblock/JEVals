## What problem does this solve?

<!-- Link the issue (Closes #N) or describe the problem in one or two sentences. -->

## What changed?

<!-- The shape of the change: components touched, contracts affected, behavior deltas. -->

## How was it verified?

<!-- Which gates ran? At minimum: make lint, make typecheck-api, the API and web suites you touched. -->

- [ ] `make lint`
- [ ] `make typecheck-api` (mypy)
- [ ] `cd apps/api && uv run pytest -q`
- [ ] `cd apps/web && npx vitest run && npx tsc --noEmit`
- [ ] `make demo-gate` (full gate — required for provider, persistence, or snapshot-contract changes)

## Checklist

- [ ] Tests added or updated with the change (hermetic — no network, no live keys)
- [ ] No secrets, `.env` values, or credentials in the diff
- [ ] User-facing strings added to BOTH locales (`en.ts` / `es.ts`) in key parity
- [ ] Persisted snapshot contract unchanged, or the change is backward compatible with old snapshots

## Breaking changes

<!-- None, or what deployers must do. -->

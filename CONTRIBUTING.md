# Contributing to JEVals

Thanks for your interest in contributing! This guide covers the collaboration
process: reporting bugs, proposing features, setting up a local environment,
and opening pull requests that pass the project's gates.

## Before you start

- Search the [existing issues](../../issues) before opening a new one.
- For large changes (new providers, protocol changes, breaking API moves),
  open an issue or discussion **first** and align on the approach.
- Keep every pull request focused on one goal — mixed concerns are hard to
  review and slow to land.

## Development environment

Prerequisites: Python 3.13+ with [uv](https://docs.astral.sh/uv/), and
Node.js 22+.

```bash
git clone https://github.com/<org>/jevals.git
cd jevals

# API (FastAPI + uv)
cd apps/api
uv sync
cd ../..

# Web (Next.js) + e2e (Playwright)
cd apps/web
npm install
cd ../..

# Local configuration — copy the example and fill what you need.
# Everything works out of the box except the JEV baseline key and the LLM
# (Judge / Independent) credentials; provider settings can also be
# configured at runtime from the app's Settings page.
cp .env.example apps/api/.env
```

Run the stack locally:

```bash
make dev          # API on :8000 (uvicorn --reload) + web on :3000 (next dev)
```

## Repository layout

```text
apps/api            FastAPI service (providers, domain, persistence, routes)
apps/web            Next.js app (Principal / Investigation / Operation / Settings)
packages/contracts  Shared JSON schemas and canonical fixtures
e2e                 Playwright end-to-end suites (hermetic — no live providers)
scripts             Operational scripts (secret scan, smoke, local emulator)
```

The provider architecture is protocol-agnostic: the emulator and the JEV
baseline speak the SystemOne (`…/v1/systemone`) and Simple Jev
(`…/v1/classifier`) protocols; the Judge and the Independent prediction speak
any OpenAI-compatible Chat Completions endpoint. See the in-app Settings
guides for the tested provider matrix.

## Gates

Run these before proposing any change. The full local gate is:

```bash
make demo-gate     # secret scan + contracts + API + web + e2e (hermetic)
```

Faster inner loop:

| Gate | Command |
| --- | --- |
| Lint (web) | `make lint` |
| API typecheck (mypy) | `make typecheck-api` |
| API tests | `cd apps/api && uv run pytest -q` |
| Web tests | `cd apps/web && npx vitest run` |
| Web typecheck | `cd apps/web && npx tsc --noEmit` |
| Everything incl. e2e | `make demo-gate` |

New features and bug fixes ship **with tests** — the suites are hermetic by
design (no network, no live provider keys), so they run anywhere.

## Workflow

1. Branch from `main`:

   ```bash
   git checkout -b feat/short-name
   ```

2. Implement the change and add or update tests.

3. Run the gates (at minimum: lint + typecheck + the suites you touched).

4. Open a pull request that states:
   - the problem it solves,
   - what changed,
   - which gates you ran,
   - any breaking changes.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(settings): add per-provider structured-outputs toggle
fix(api): the LLM judge climbs a compatibility ladder on HTTP 400
docs: translate author.md to English
```

Types in use: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`.

## Security and secrets

- **Never commit API keys, `.env` files, or credentials** — the secret
  scanner (`make secret-scan`) runs in every gate.
- Keys configured through the app's Settings page are stored **encrypted at
  rest**; plaintext keys never leave the process that uses them.
- Report vulnerabilities privately — see [SECURITY.md](SECURITY.md), never
  a public issue.

## Code style

- Python: type-annotated, mypy-strict on `app/`; comments explain *why*
  (constraints, contract references), not *what*.
- TypeScript/React: functional components, typed props, no `any` where a
  type can express the contract.
- Both locales (EN/ES) must stay in parity for every user-facing string —
  dictionary keys exist in both files or in neither.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).

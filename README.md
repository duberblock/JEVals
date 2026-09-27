# JEVals

**JEVals** is a self-contained playground for evaluating structured judgment
requests against LLM providers — validate a `SystemOneRequest` payload, run
it through an emulator and real providers (a JEV baseline via
[typesafe.ai](https://typesafe.ai), an independent answer and a judge via any
OpenAI-compatible endpoint), compare the results, and inspect every execution
from three web screens.

- **Principal** — edit a request, validate it, run it (streaming progress),
  and read the comparison: per-question verdicts, fidelity, sources.
- **Investigation** — the WHY behind an execution: evidence, payloads, and
  the full LLM exchange per question.
- **Operation** — a browser over the persisted execution history.

## Quickstart (local development)

Requirements: Python 3.13+ with [uv](https://docs.astral.sh/uv/), Node.js 22+.

```sh
cp .env.example .env
make install-api install-web
make dev
```

`make dev` starts both apps with live reload:

- FastAPI API on <http://localhost:8000> (401 without credentials;
  `/health` and `/ready` are open)
- Next.js web on <http://localhost:3000>

In local development the API runs in pass-through mode (no auth enforcement,
no provider calls required): request validation, the web UI, and the test
suites all work offline.

### What needs a provider

Running executions (beyond validation) talks to external services, configured
through environment variables (see `.env.example`):

| Variable | What it enables |
| --- | --- |
| `EMULATOR_URL` | the deterministic emulator evaluation |
| `TYPESAFE_API_KEY` | the JEV baseline (typesafe.ai) |
| `OPENAI_API_KEY` | the independent answer + the judge (LLM) |

Anything unset is reported honestly by the API's `capabilities` endpoint —
the UI shows unavailable sources as unavailable; nothing is invented.

### Running fully local (no cloud keys)

Both provider legs can run on your machine:

- **Emulator — [Simple Jev](https://simple-jev.featherless.ai/)**, an
  open-source structured-decision classifier (agent-facing docs:
  [skills.md](https://simple-jev.featherless.ai/skills.md)). It shares the
  same question taxonomy (choice / score / noul over a state context), and
  the repo ships a tiny stdlib-only adapter that speaks the emulator
  contract and forwards to its classifier API:

  ```sh
  python3 scripts/local_emulator.py --port 8100
  # then set EMULATOR_URL=http://localhost:8100
  ```

  The adapter defaults to the public demo endpoint — no key needed, limited
  to 2k tokens of context and 2 req/s (fine for trying the app, not for
  load). For production limits get a key at featherless.ai and run
  `FEATHERLESS_API_KEY=… python3 scripts/local_emulator.py --base https://api.featherless.ai`.

- **Judge + independent — [Ollama](https://ollama.com)** (or any local
  OpenAI-compatible server):

  ```sh
  ollama pull qwen3:8b   # any chat model you like
  ```

  ```sh
  OPENAI_API_KEY=ollama            # any non-empty value; Ollama ignores it
  OPENAI_BASE_URL=http://localhost:11434/v1
  OPENAI_MODEL=qwen3:8b
  OPENAI_STRUCTURED_OUTPUTS=false  # prompted-schema mode: any chat model works
  ```

Only the JEV baseline keeps requiring a `TYPESAFE_API_KEY` — leave it unset
and that source stays honestly unavailable.

## Quickstart (Docker)

```sh
docker compose up --build
```

Builds both apps from the local source, applies database migrations before
serving, and persists SQLite data in `./data`. The API enforces Basic Auth
(default `playground`/`playground` — override `AUTH_USER`/`AUTH_PASS`); the
web app proxies `/api/v1` to it and injects the credentials server-side.
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the self-hosting notes.

## Tests

```sh
make demo-gate
```

One command, fast gates first: the working-tree secret scan and script
tests, then contract + API + web unit suites, then the strict end-to-end
suite (Chromium + Firefox). Focused runs: `make test-api`, `make test-web`,
`make test-e2e`.

## Repository layout

```text
apps/api             FastAPI service: validation, execution, persistence
apps/web             Next.js app: Principal / Investigation / Operation
packages/contracts   JSON Schemas + problem-types contract shared by both
e2e                  Playwright end-to-end suite (hermetic API fixtures)
infra/docker         Container images for the api and web services
scripts              dev loop, secret scan, live smoke tooling
docs                 architecture + self-hosting notes
vendor/types.ts      vendored TypeSafe SDK wire contract (MIT, verbatim)
```

## Naming

- `jevals` — the app and this repository (lowercase, canonical).
- `JEVals` — the header display brand (real casing preserved, never
  uppercased to `JEVALS`).
- `JEV` — reserved for the typesafe.ai platform; as a run SOURCE label
  ("JEV" chip, rail marker, evidence section) it keeps its canonical
  meaning. The emulator's summary display reads `Emulator 0.0.1` — a visual
  alias only; evidence and payloads keep the real reported model.

## License

[MIT](LICENSE) — © Duber López ([author.md](author.md)).

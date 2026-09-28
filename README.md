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

### Configuring providers from the app

The **Settings** screen (the gear icon in the header, beside the help link)
configures the four integrations without touching any file: endpoint,
model and API key for the emulator, the JEV baseline, the judge and the
independent prediction — each independently, the two LLM legs being plain
OpenAI-compatible endpoints. Keys are stored **encrypted at rest** (Fernet;
set `SETTINGS_ENCRYPTION_KEY` or a `settings.key` file is generated beside
the database). Values saved here override the environment; clearing a field
falls back to it.

### Running fully local (no cloud keys)

Both provider legs can run on your machine:

- **Emulator — works out of the box**: the default endpoint is a hosted
  SystemOne service (the exact URL is shown in the app's Settings).
  Two one-step alternatives: the **Use the public demo** button in the
  settings card fills the free [Simple Jev](https://simple-jev.featherless.ai/)
  demo (`https://simple-jev-demo-api.featherless.ai/v1/classifier` — no
  key; limits: 2k tokens of context, 2 req/s; agent-facing docs:
  [skills.md](https://simple-jev.featherless.ai/skills.md)), or paste any
  **full endpoint URL** (`…/v1/systemone` or `…/v1/classifier` — the URL
  IS the protocol choice, the API posts exactly what you paste). For
  Simple Jev production limits get a key at featherless.ai and use
  `https://api.featherless.ai/v1/classifier` with it. Whichever endpoint
  is active receives the scenario text on every execution.

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
  meaning. Summary surfaces show the model each leg actually ran, exactly
  as the endpoint reported it.

## Contributing

Issues, pull requests, the local gates and the collaboration process live in
[CONTRIBUTING.md](CONTRIBUTING.md). Coding agents should also read
[AGENTS.md](AGENTS.md). For help, see [SUPPORT.md](SUPPORT.md); to report a
vulnerability, follow [SECURITY.md](SECURITY.md) — never a public issue.

## License

[MIT](LICENSE) — © Duber López ([author.md](author.md)).

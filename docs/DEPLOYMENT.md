# Running and self-hosting

Two ways to run JEVals on your side: local development (hot reload, no
containers) or the Docker Compose stack (builds from source, closer to a
self-hosted deployment).

## 1. Local development

```sh
cp .env.example apps/api/.env   # optional — provider credentials go in Settings
make install-api install-web
make dev
```

- API: <http://localhost:8000> — development posture: auth pass-through,
  no provider configuration required for validation and the UI.
- Web: <http://localhost:3000>.

Port overrides: `API_PORT`, `WEB_PORT` (see `scripts/dev.sh`).

## 2. Docker Compose

```sh
docker compose up --build
```

What the stack does:

- Builds both images from the local source (`infra/docker/*.Dockerfile`).
- Applies database migrations (`alembic upgrade head`) before the API
  serves — idempotent on every boot.
- Persists SQLite in the `./data` bind mount. **Back that directory up**;
  do not store the database in an image layer.
- Containers run as non-root (API uid 1000 `jevals`, web `node`). On Linux
  hosts, the `./data` bind mount must be writable by uid 1000
  (`chown -R 1000:1000 data`); macOS and Windows file sharing maps
  permissions transparently.
- Enforces Basic Auth at the API (`AUTH_REQUIRED=true`, fail closed: a
  missing configuration can never serve authenticated paths unauthenticated;
  `/health` and `/ready` stay open).
- The web app never holds provider credentials: it proxies `/api/v1` to the
  API and injects the Basic Auth credentials server-side.

Credentials default to `playground`/`playground`. Override before exposing:

```sh
AUTH_USER=... AUTH_PASS=... docker compose up --build
```

(or put them in a `.env` file next to `compose.yml` — gitignored).

### Exposing the stack beyond localhost

The API is designed to sit behind the web origin or a reverse proxy:

- Terminate TLS in front (any reverse proxy works; if a proxy fronts the
  SSE execution stream it must not buffer `text/event-stream` — the API
  sends `no-transform` and a keep-alive cadence to defend against
  intermediaries that would).
- The web app ships an optional auth-wrapping origin server
  (`apps/web/scripts/serve-auth.mjs`, `npm run serve:auth`) that puts the
  whole origin — not just the API — behind the same Basic Auth with exactly
  `/health` + `/ready` exempt. Use it when the web port is reachable by
  strangers.

## 3. Configuration

### Providers — the Settings screen

Once the stack is up, configure the four providers (emulator, JEV baseline,
judge, independent) from the app's **Settings** screen: endpoint, model and
API key per card, keys encrypted at rest. Values take effect immediately —
no restart, no redeploy. The emulator works against its hosted default with
zero configuration; only the JEV baseline (a typesafe.ai key) and the LLM
legs (an OpenAI-compatible provider) need credentials.

### Deployment variables

Canonical names mirror `apps/api/app/core/config.py` (`.env.example` keeps
only these essentials):

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | SQLite location | `sqlite:///./jevals.db` (dev) |
| `AUTH_USER` / `AUTH_PASS` | origin Basic Auth credentials | required when `AUTH_REQUIRED=true` |
| `AUTH_REQUIRED` | API fail-closed auth posture | unset = dev pass-through |
| `SETTINGS_ENCRYPTION_KEY` | master key for credentials saved via the Settings UI | unset → `settings.key` file beside the DB (survives redeploys via the `./data` volume) |
| `API_PORT` | local API port (`dev`) | `8000` |
| `MAX_EXECUTION_REQUEST_BYTES` / `MAX_CONCURRENT_EXECUTIONS` / `MAX_EXECUTIONS_PER_MINUTE` | execution admission control (body cap / in-flight / rate; `<= 0` disables) | `1048576` / `2` / `10` |


### Env pre-seed (optional, advanced)

The provider variables still exist in `config.py` — `EMULATOR_URL`,
`EMULATOR_API_KEY`, `EMULATOR_MODEL`, `TYPESAFE_*`, `OPENAI_*`
(`OPENAI_STRUCTURED_OUTPUTS` included) and the per-leg `JUDGE_*` /
`INDEPENDENT_*` overrides — for hosts that must come up pre-configured.
`compose.yml` no longer passes them through; add the lines you need to its
`api.environment` block. Anything saved in Settings overrides them, and
clearing a saved field falls back to them.

Availability is always reported honestly: the `capabilities` endpoint lists
which sources can run, and the UI renders unavailable sources as
unavailable.

Both provider legs can also run without any private infrastructure — the
emulator accepts a Simple Jev classifier URL directly (the public demo
needs no key; the API auto-detects the protocol) and the judge/independent
legs accept Ollama or any local OpenAI-compatible server; see the README's
"Running fully local" section. `scripts/local_emulator.py` remains as an
optional standalone adapter for private classifier deployments.

## 4. Verifying a deployment

`scripts/smoke_live.py` runs the acceptance lane against any deployed
origin (it performs real provider calls — only point it at an origin you
control and are willing to pay for):

```sh
make smoke-live SMOKE_ARGS="--base-url https://your.origin --auth-user me --auth-pass ..."
```

## 5. Release version policy

The header displays `v{version}` derived from `apps/web/package.json` — the
single source (`apps/web/lib/version.ts`; no second version constant). The
displayed version must match the CHANGELOG/release being deployed; bumping
`package.json` is a release step performed before or during the cut, never
after deploy. Invented or pseudo-OS version numbers stay banned.

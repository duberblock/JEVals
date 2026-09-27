.PHONY: dev test test-contracts test-api test-web test-e2e test-e2e-strict demo-gate lint typecheck-api install-api install-web secret-scan test-scripts smoke-live

API_DIR := apps/api
WEB_DIR := apps/web

install-api:
	cd $(API_DIR) && uv sync

install-web:
	cd $(WEB_DIR) && npm install

dev:
	./scripts/dev.sh

test: test-contracts test-api test-web

test-contracts:
	cd $(API_DIR) && uv run pytest tests/unit/test_contract_fixtures.py

test-api:
	cd $(API_DIR) && uv run pytest

test-web:
	cd $(WEB_DIR) && npm test

test-e2e:
	cd e2e && npm test

# Demo-gate lane: retries are disabled so an intermittent console-noise
# failure cannot be masked by a passing retry (npm test keeps the dev
# default from playwright.config.ts, which allows 1 retry for iteration).
test-e2e-strict:
	cd e2e && npx playwright test --retries=0

# One-command demo gate: script-gate tests and the working-tree secret scan,
# then contract tests + API + web units, then the E2E suite run STRICT
# (mobile 375x667 + desktop on Chromium, then the desktop-class specs again
# on Firefox; --retries=0 so a flaky pass-through can never hide a genuine
# failure). Fast gates first so a failure surfaces in seconds, not after the
# slowest suite.
demo-gate: test-scripts secret-scan test test-e2e-strict

lint:
	cd $(WEB_DIR) && npm run lint

# Static type gate for the API: mypy defaults + check_untyped_defs scoped to
# app/. Like lint, this is a static-quality gate and stays OUTSIDE
# demo-gate, which proves runtime demo readiness.
typecheck-api:
	cd $(API_DIR) && uv run mypy app

secret-scan:
	python3 scripts/scan_secrets.py

test-scripts:
	cd scripts && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v

# Deployment acceptance lane: LIVE gate against a deployed origin — the
# online counterpart of demo-gate (which stays hermetic). Never runs in
# demo-gate; needs a real deployment + credentials (and performs real
# provider calls). Make cannot take flags directly, so pass the script's
# arguments through SMOKE_ARGS, e.g.:
#   make smoke-live SMOKE_ARGS="--base-url https://jevals.example.org --auth-user me --auth-pass ..."
# or export SMOKE_AUTH_USER/SMOKE_AUTH_PASS and pass only --base-url.
smoke-live:
	python3 scripts/smoke_live.py $(SMOKE_ARGS)

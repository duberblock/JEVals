#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  if [[ -n "${WEB_PID:-}" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

cd "$ROOT_DIR/apps/api"
uv run uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" --reload &
API_PID=$!

cd "$ROOT_DIR/apps/web"
npm run dev -- --hostname 0.0.0.0 --port "$WEB_PORT" &
WEB_PID=$!

while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done

wait "$API_PID" "$WEB_PID"

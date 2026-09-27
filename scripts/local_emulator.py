#!/usr/bin/env python3
"""Local emulator adapter: /v1/systemone backed by Simple Jev.

The API's emulator leg POSTs the SystemOneRequest to
``{EMULATOR_URL}/v1/systemone`` and expects a SystemOneResult. Simple Jev
(https://simple-jev.featherless.ai/ — open-source structured-decision
classifier, agent docs at https://simple-jev.featherless.ai/skills.md)
exposes the same question taxonomy (choice / score / noul over a
state-or-messages context) at ``POST /v1/classifier`` but requires a
``model`` and wraps usage differently. This adapter bridges the two so a
fully local JEVals run needs no private emulator deployment:

    python3 scripts/local_emulator.py --port 8100
    # then: EMULATOR_URL=http://localhost:8100

Defaults to the public demo endpoint (no key, 2k-token context, 2 req/s —
fine for trying the app; not for load). For production limits set
FEATHERLESS_API_KEY and --base https://api.featherless.ai (Bearer auth is
added automatically; per the Simple Jev docs never fall back to the demo
endpoint on auth errors).

Stdlib only — no dependencies, run it with plain python3.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

DEFAULT_MODEL = "featherless-ai/Qwen3.6-35B-A3B-classifier"
DEMO_BASE = "https://simple-jev-demo-api.featherless.ai"
PROD_BASE = "https://api.featherless.ai"
CLASSIFIER_PATH = "/v1/classifier"
TIMEOUT_SECONDS = 60.0

# The result contract forbids extras (SystemOneResult uses extra="forbid"),
# so answers are reduced to exactly the keys each type allows.
_ANSWER_KEYS = {
    "noul": {"type", "noul"},
    "choice": {"type", "choice", "confidence", "probabilities"},
    "score": {"type", "score", "confidence", "legend", "probabilities"},
}


def build_classifier_request(systemone: dict[str, Any], default_model: str) -> dict[str, Any]:
    """Map a SystemOneRequest onto the Simple Jev classifier request.

    ``model`` is REQUIRED by Simple Jev and optional on the systemone
    request, so the default model fills the gap. ``state`` and
    ``questions`` (choice / score / noul with instructions + criteria)
    share the same shapes on both sides and pass through untouched.
    """
    if "state" not in systemone or "questions" not in systemone:
        raise ValueError("the systemone request needs 'state' and 'questions'")
    return {
        "model": systemone.get("model") or default_model,
        "state": systemone["state"],
        "questions": systemone["questions"],
    }


def normalize_answer(answer: dict[str, Any]) -> dict[str, Any]:
    """Reduce one Simple Jev answer to the SystemOneResult answer shape."""
    answer_type = answer.get("type")
    allowed = _ANSWER_KEYS.get(answer_type)
    if allowed is None:
        raise ValueError(f"unsupported answer type: {answer_type!r}")
    missing = allowed - set(answer)
    if missing:
        raise ValueError(f"{answer_type} answer is missing {sorted(missing)}")
    return {key: answer[key] for key in allowed}


def build_systemone_result(classifier: dict[str, Any]) -> dict[str, Any]:
    """Map the classifier response onto the SystemOneResult contract."""
    answers = classifier.get("answers")
    if not isinstance(answers, dict) or not answers:
        raise ValueError("the classifier response has no answers")
    usage = classifier.get("usage") or {}
    return {
        "model": classifier["model"],
        "answers": {name: normalize_answer(a) for name, a in answers.items()},
        "usage": {
            "input_tokens": int(usage.get("input_tokens", 0) or 0),
            "output_tokens": int(usage.get("output_tokens", 0) or 0),
        },
    }


def post_classifier(base: str, api_key: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    """POST one classifier request; returns the parsed JSON or raises."""
    request = urllib.request.Request(
        base.rstrip("/") + CLASSIFIER_PATH,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            # The demo host rejects the default Python-urllib UA (403) —
            # identify honestly instead.
            "User-Agent": "jevals-local-emulator/1.0",
        },
        method="POST",
    )
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


class _Handler(BaseHTTPRequestHandler):
    base: str = DEMO_BASE
    api_key: str | None = None
    default_model: str = DEFAULT_MODEL

    def do_GET(self) -> None:  # noqa: N802 — http.server naming
        if self.path == "/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 — http.server naming
        if self.path != "/v1/systemone":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            systemone = json.loads(self.rfile.read(length).decode("utf-8"))
            payload = build_classifier_request(systemone, self.default_model)
            classifier = post_classifier(self.base, self.api_key, payload)
            self._send(200, build_systemone_result(classifier))
        except ValueError as error:
            self._send(400, {"error": str(error)})
        except urllib.error.HTTPError as error:
            # Upstream said no: surface status only (per the Simple Jev
            # error guidance — never fabricate results, never loop).
            self._send(502, {"error": f"upstream HTTP {error.code}"})
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            self._send(502, {"error": f"upstream unreachable: {error}"})

    def _send(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        sys.stderr.write(f"local-emulator {self.address_string()} {format % args}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8100)
    parser.add_argument(
        "--base",
        default=os.environ.get("SIMPLE_JEV_BASE", DEMO_BASE),
        help=f"Simple Jev API base (default: {DEMO_BASE}; production: {PROD_BASE})",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("SIMPLE_JEV_MODEL", DEFAULT_MODEL),
        help=f"classifier model injected when the request carries none (default: {DEFAULT_MODEL})",
    )
    args = parser.parse_args(argv)

    _Handler.base = args.base
    _Handler.default_model = args.model
    _Handler.api_key = os.environ.get("FEATHERLESS_API_KEY")

    server = ThreadingHTTPServer(("127.0.0.1", args.port), _Handler)
    print(
        f"local emulator on http://127.0.0.1:{args.port} "
        f"(EMULATOR_URL=http://localhost:{args.port}) -> {args.base}{CLASSIFIER_PATH} "
        f"model={args.model} auth={'bearer' if _Handler.api_key else 'none'}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

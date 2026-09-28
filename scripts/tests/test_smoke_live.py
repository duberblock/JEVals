"""Tests for scripts/smoke_live.py — stdlib unittest only (no pytest).

Hermetic: every test spins a ThreadingHTTPServer stub on 127.0.0.1:0 that
imitates the deployed stack per ADR-005 — 401 without Basic credentials on
everything except the unauthenticated /health and /ready, the §63
capabilities matrix, the §64 execution envelope, and §47 detail snapshots.
No real network egress; no real credentials (all placeholders are <16 chars
so the repository secret scanner stays green by construction).
"""

import base64
import contextlib
import io
import json
import os
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import smoke_live  # noqa: E402

# Short placeholder credentials (the scanner fires on quoted assignments
# >= 16 chars, and these double as "obviously not real" markers).
STUB_USER = "smoke-u1"
STUB_PASS = "smoke-p1"

EMU_ID = "run-smoke-emu"
CMP_ID = "run-smoke-cmp"
FULL_ID = "run-smoke-full"

CHECK_NAMES = (
    "origin-auth",
    "health",
    "ready",
    "capabilities",
    "emulator-run",
    "jev-compare",
    "openai-evaluate",
)


def all_caps():
    """The fully configured §63 matrix (mirrors test_capabilities_api.py)."""
    return {
        "emulator": {"available": True},
        "jev": {"available": True},
        "openai": {"available": True, "models": ["gpt-4o-mini"]},
        "default_model": "gpt-4o-mini",
    }


def emu_snapshot():
    return {
        "execution_id": EMU_ID,
        "mode": "emulator",
        "status": "completed",
        "emulator": {"status": "success", "model": "jev-emulator"},
    }


def cmp_snapshot(jev_status="success"):
    return {
        "execution_id": CMP_ID,
        "mode": "compare",
        "status": "completed",
        "emulator": {"status": "success", "model": "jev-emulator"},
        "jev": {"status": jev_status, "model": "jev-latest"},
        "comparison": {"overall_fidelity": 0.9},
    }


def full_snapshot(structured_outputs=True):
    """The §47 compare-and-evaluate snapshot; the independent section carries
    the §45 run configuration that the P23 mode verification reads."""
    snapshot = cmp_snapshot()
    snapshot.update(
        {
            "execution_id": FULL_ID,
            "mode": "compare-and-evaluate",
            "ai_evaluation": {"status": "success", "model": "judge-llm"},
            "independent_openai": {
                "status": "success",
                "model": "gpt-4o-mini",
                "run_config": {
                    "model": "gpt-4o-mini",
                    "structured_outputs": structured_outputs,
                    "api": "chat_completions",
                },
                "llm_attempts": [
                    {"messages": [], "debug_info": {"model_name": "gpt-4o-mini"}}
                ],
            },
        }
    )
    return snapshot


class _State:
    """The stub origin's configurable world (per-test mutations land here)."""

    def __init__(self):
        self.user = STUB_USER
        self.value = STUB_PASS
        # 200 here simulates the BROKEN auth boundary (ADR-005 ruling 2).
        self.anon_root_status = 401
        # True answers GET / with a cross-origin 302 (redirect policy probe).
        self.redirect_root = False
        self.health_status = 200
        self.health_sleep = 0.0  # seconds; >0 simulates a slow /health
        self.ready_status = 200
        self.caps_status = 200
        self.caps = all_caps()
        self.posts_sleep = 0.0  # seconds; >0 simulates a slow execution POST
        # mode -> (status, body) for POST /api/v1/executions.
        self.posts = {
            "emulator": (201, emu_snapshot()),
            "compare": (201, cmp_snapshot()),
            "compare-and-evaluate": (201, full_snapshot()),
        }
        # execution_id -> (status, body) for GET /api/v1/executions/{id}.
        self.details = {FULL_ID: (200, full_snapshot())}
        # (method, path, auth_header_present, parsed_json_body_or_None)
        self.seen = []
        # Parallel to seen: the User-Agent of every request (UA contract).
        self.user_agents = []


class _Handler(BaseHTTPRequestHandler):
    """Implements the deployed-origin contract the smoke gate probes."""

    @property
    def state(self) -> _State:
        return self.server.state  # noqa: SLF001 - the stub's own seam

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization") or ""
        scheme, _, blob = header.partition(" ")
        if scheme.lower() != "basic" or not blob:
            return False
        try:
            decoded = base64.b64decode(blob, validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return False
        user, sep, value = decoded.partition(":")
        return bool(sep) and user == self.state.user and value == self.state.value

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        media = "application/problem+json" if status >= 400 else "application/json"
        self.send_header("Content-Type", media)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _unauthorized(self) -> None:
        self._send(401, {"title": "Unauthorized", "status": 401,
                         "type": "https://jevals.local/problems/unauthorized"})

    def _record(self, body=None) -> None:
        self.state.seen.append(
            (self.command, self.path,
             self.headers.get("Authorization") is not None, body)
        )
        self.state.user_agents.append(self.headers.get("User-Agent"))

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        state = self.state
        self._record()
        if self.path == "/":
            if state.redirect_root:
                # A misrouted origin: answer with a cross-origin redirect and
                # count on the gate refusing to follow it.
                self.send_response(302)
                self.send_header("Location", "https://elsewhere.example.org/login")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if state.anon_root_status == 200:
                return self._send(200, {"hello": "jevals"})
            if not self._authorized():
                return self._unauthorized()
            return self._send(200, {"hello": "jevals"})
        if self.path == "/health":
            if state.health_sleep:
                time.sleep(state.health_sleep)
            if state.health_status != 200:
                return self._send(state.health_status,
                                  {"title": "Degraded", "status": state.health_status})
            return self._send(200, {"status": "ok"})
        if self.path == "/ready":
            if state.ready_status != 200:
                return self._send(state.ready_status,
                                  {"title": "Not Ready", "status": state.ready_status})
            return self._send(200, {"status": "ready"})
        if self.path == "/api/v1/capabilities":
            if not self._authorized():
                return self._unauthorized()
            if state.caps_status != 200:
                return self._send(state.caps_status,
                                  {"title": "Capabilities Broken", "status": state.caps_status})
            return self._send(200, state.caps)
        prefix = "/api/v1/executions/"
        if self.path.startswith(prefix):
            if not self._authorized():
                return self._unauthorized()
            status, payload = state.details.get(
                self.path[len(prefix):],
                (404, {"title": "Not Found", "status": 404}),
            )
            return self._send(status, payload)
        return self._send(404, {"title": "Not Found", "status": 404})

    def do_POST(self) -> None:  # noqa: N802 - http.server naming
        state = self.state
        if state.posts_sleep:
            time.sleep(state.posts_sleep)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8"))
        except ValueError:
            body = None
        self._record(body)
        if self.path != "/api/v1/executions":
            return self._send(404, {"title": "Not Found", "status": 404})
        if not self._authorized():
            return self._unauthorized()
        if not isinstance(body, dict):
            return self._send(400, {"title": "Invalid JSON", "status": 400})
        status, payload = state.posts.get(
            str(body.get("mode")),
            (500, {"title": "Unexpected mode", "status": 500}),
        )
        return self._send(status, payload)

    def log_message(self, format, *args):  # noqa: A002 - http.server signature
        pass  # keep the unittest output readable


class _StubServer:
    """A running stub origin; ``base_url`` wires --base-url to it."""

    def __init__(self):
        self.state = _State()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.httpd.daemon_threads = True
        self.httpd.state = self.state
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base_url(self) -> str:
        host, port = self.httpd.server_address[:2]
        return f"http://{host}:{port}"

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)


class SmokeLiveTestCase(unittest.TestCase):
    """Common harness: one stub origin, isolated SMOKE_* env, main() runner."""

    def setUp(self):
        self.stub = _StubServer()
        self.addCleanup(self.stub.close)
        # Isolate the credential env fallbacks per test (nothing leaks in,
        # nothing leaks out to the developer's shell).
        self._saved_env = {
            name: os.environ.get(name)
            for name in (smoke_live.USER_ENV_NAME, smoke_live.PASS_ENV_NAME)
        }
        for name in self._saved_env:
            os.environ.pop(name, None)
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for name, value in self._saved_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def run_main(self, *extra):
        """Invoke the gate exactly like the CLI would; capture both streams."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = smoke_live.main(list(extra))
        return code, out.getvalue(), err.getvalue()

    def happy_args(self):
        return (
            "--base-url", self.stub.base_url,
            "--auth-user", STUB_USER,
            "--auth-pass", STUB_PASS,
        )


class HappyPathTestCase(SmokeLiveTestCase):
    """Everything configured and healthy: 7 PASS lines, exit 0."""

    def test_all_checks_pass_with_one_line_each_and_exit_0(self):
        code, out, err = self.run_main(*self.happy_args())

        self.assertEqual(code, 0, err or out)
        for name in CHECK_NAMES:
            self.assertEqual(out.count(f"PASS {name} —"), 1, out)
        self.assertNotIn("FAIL", out)
        self.assertNotIn("SKIP", out)
        self.assertNotIn("WARNING", out)
        # The auth boundary both ways: 401 anonymous, 200 credentialed.
        self.assertIn("401 without credentials, 200 with credentials", out)
        # The §63 matrix line is printed and honest.
        self.assertIn("matrix: emulator=yes jev=yes openai=yes (gpt-4o-mini)", out)
        # P23 strict default: the mode is reported and no WARNING fires.
        self.assertIn("structured outputs: strict json_schema", out)
        # Exactly one final verdict line, verbatim (DEPLOYMENT.md §7).
        self.assertIn("SMOKE-LIVE: PASS — 7 checks (0 failed, 0 skipped)", out)
        self.assertEqual(out.count("SMOKE-LIVE:"), 1)

    def test_every_request_carries_the_honest_user_agent(self):
        # Cloudflare's Browser Integrity Check blocks the stdlib Python-urllib
        # UA (Error 1010) before the origin; every outbound request must
        # identify as the tool, never as a browser.
        code, out, err = self.run_main(*self.happy_args())
        self.assertEqual(code, 0, err or out)
        agents = self.stub.state.user_agents
        self.assertTrue(agents, "the gate made no requests")
        self.assertEqual(
            set(agents), {smoke_live.USER_AGENT},
            "every outbound request must carry the honest User-Agent",
        )

    def test_the_canonical_envelope_is_posted_verbatim(self):
        code, out, _ = self.run_main(*self.happy_args())
        self.assertEqual(code, 0, out)

        posts = [entry for entry in self.stub.state.seen if entry[0] == "POST"]
        self.assertEqual(
            sorted(body.get("mode") for _, _, _, body in posts),
            ["compare", "compare-and-evaluate", "emulator"],
        )
        for _, path, _, body in posts:
            self.assertEqual(path, "/api/v1/executions")
            # The pinned canonical SystemOneRequest rides in system_one.
            self.assertEqual(body["system_one"], smoke_live.CANONICAL_SYSTEM_ONE)
        # The advanced flag is exactly the mobile-E2E-pinned shape, only on
        # the compare-and-evaluate run.
        advanced = [
            body.get("advanced")
            for _, _, _, body in posts
            if body.get("mode") == "compare-and-evaluate"
        ]
        self.assertEqual(advanced, [{"independent_openai_prediction": True}])
        for _, _, _, body in posts:
            if body.get("mode") != "compare-and-evaluate":
                self.assertNotIn("advanced", body)

    def test_auth_is_applied_only_where_the_origin_requires_it(self):
        code, out, _ = self.run_main(*self.happy_args())
        self.assertEqual(code, 0, out)

        seen = {(method, path): auth for method, path, auth, _ in self.stub.state.seen}
        # Internal healthcheck paths stay unauthenticated (PRD §6)...
        self.assertIs(seen[("GET", "/health")], False)
        self.assertIs(seen[("GET", "/ready")], False)
        # ...while the ADR-005 probe and every /api/v1 call carries the header.
        for (method, path), auth in seen.items():
            if path.startswith("/api/v1") or path == "/":
                self.assertIs(auth, True, (method, path))
        # The anonymous boundary probe precedes the credentialed one.
        self.assertIs(seen[("GET", "/")], True)  # the recorded credentialed retry


class OriginAuthFailureTestCase(SmokeLiveTestCase):
    def test_open_origin_means_the_auth_boundary_is_broken(self):
        # ADR-005 ruling 2: GET / without credentials MUST answer 401. A 200
        # is the loudest deployment bug the gate can find.
        self.stub.state.anon_root_status = 200

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 1)
        self.assertEqual(out.count("FAIL origin-auth —"), 1)
        self.assertIn("Basic Auth boundary is broken", out)
        # Fail-fast (no paid calls): the anonymous probe is the ONLY request
        # the stub ever sees — no /api/v1 call, no health/ready probe.
        self.assertEqual(len(self.stub.state.seen), 1)
        self.assertFalse(
            any(entry[1].startswith("/api/v1") for entry in self.stub.state.seen))
        self.assertIn(
            "ABORT: origin auth failed — remaining checks not run (no paid calls)",
            out,
        )
        self.assertIn("SMOKE-LIVE: FAIL — 1 failed, 0 skipped", out)

    def test_missing_credentials_when_the_origin_demands_them(self):
        code, out, _ = self.run_main("--base-url", self.stub.base_url)

        self.assertEqual(code, 1)
        self.assertEqual(out.count("FAIL origin-auth —"), 1)
        self.assertIn("--auth-user", out)
        self.assertIn("SMOKE_AUTH_USER", out)
        # Abort before anything else: only the anonymous 401 was served.
        self.assertEqual(len(self.stub.state.seen), 1)
        self.assertIn("ABORT: origin auth failed", out)

    def test_rejected_credentials_fail_the_check(self):
        # 401 WITH credentials supplied: the origin answered the pair with
        # another challenge, so the gate must not proceed quietly.
        code, out, _ = self.run_main(
            "--base-url", self.stub.base_url,
            "--auth-user", STUB_USER, "--auth-pass", "smoke-bad",
        )

        self.assertEqual(code, 1)
        self.assertIn("FAIL origin-auth —", out)
        self.assertIn("credentialed GET / returned HTTP 401", out)
        # Abort: the two boundary probes are the only traffic (no /api/v1).
        self.assertEqual(len(self.stub.state.seen), 2)
        self.assertFalse(
            any(entry[1].startswith("/api/v1") for entry in self.stub.state.seen))
        self.assertIn("ABORT: origin auth failed", out)


class EndpointFailureTestCase(SmokeLiveTestCase):
    def test_health_non_200_fails_and_exits_1(self):
        self.stub.state.health_status = 503

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 1)
        self.assertEqual(out.count("FAIL health —"), 1)
        self.assertIn("HTTP 503 (Degraded)", out)  # problem status + title only
        # The verdict line counts the failure (and only one verdict line).
        self.assertIn("SMOKE-LIVE: FAIL — 1 failed, 0 skipped", out)
        self.assertEqual(out.count("SMOKE-LIVE:"), 1)

    def test_ready_non_200_fails_and_exits_1(self):
        self.stub.state.ready_status = 503

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 1)
        self.assertEqual(out.count("FAIL ready —"), 1)

    def test_capabilities_non_200_fails_and_provider_checks_skip(self):
        self.stub.state.caps_status = 503

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 1)
        self.assertEqual(out.count("FAIL capabilities —"), 1)
        # Without the matrix the provider checks cannot know availability:
        # they skip loudly (still exit 1 because capabilities itself failed).
        self.assertEqual(out.count("SKIP "), 3)
        self.assertIn("availability unknown", out)
        self.assertIn("SMOKE-LIVE: FAIL — 1 failed, 3 skipped", out)


class CapabilitiesDrivenSkipTestCase(SmokeLiveTestCase):
    """§63 unavailability drives SKIP vs FAIL per --require."""

    def test_openai_unavailable_skips_and_exits_0_by_default(self):
        caps = all_caps()
        caps["openai"] = {"available": False, "models": []}
        self.stub.state.caps = caps

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("SKIP openai-evaluate —"), 1)
        self.assertIn(
            "SKIPPED LLM — not configured at this deployment "
            "(no LLM provider in Settings or OPENAI_*); full acceptance = --require all",
            out,
        )
        for name in CHECK_NAMES:
            if name != "openai-evaluate":
                self.assertEqual(out.count(f"PASS {name} —"), 1, out)
        self.assertNotIn("FAIL", out)
        # A skip under --require configured still passes the run, honestly.
        self.assertIn("SMOKE-LIVE: PASS — 7 checks (0 failed, 1 skipped)", out)

    def test_openai_unavailable_under_require_all_is_a_failure(self):
        caps = all_caps()
        caps["openai"] = {"available": False, "models": []}
        self.stub.state.caps = caps

        code, out, _ = self.run_main(*self.happy_args(), "--require", "all")

        self.assertEqual(code, 1)
        self.assertEqual(out.count("FAIL openai-evaluate —"), 1)
        self.assertIn("--require all: a skip is a failure", out)
        self.assertNotIn("SKIP openai-evaluate", out)

    def test_emulator_unavailable_skips_with_its_own_note(self):
        caps = all_caps()
        caps["emulator"] = {"available": False}
        self.stub.state.caps = caps

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("SKIP emulator-run —"), 1)
        self.assertIn("SKIPPED emulator — not configured", out)
        self.assertIn("no Emulator endpoint in Settings or EMULATOR_URL", out)
        self.assertIn("PASS jev-compare —", out)
        self.assertIn("PASS openai-evaluate —", out)


class ProviderFailureTestCase(SmokeLiveTestCase):
    """Configured per §63 but the run itself fails: always a FAIL."""

    def test_503_problem_is_reported_as_status_and_title_only(self):
        self.stub.state.posts["compare-and-evaluate"] = (
            503,
            {
                "title": "LLM Not Configured",
                "status": 503,
                "type": "https://jevals.local/problems/llm-not-configured",
                # A problem `detail` may echo request content: it must NEVER
                # reach the smoke output.
                "detail": "carries-request-derived-content",
            },
        )

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 1)
        self.assertEqual(out.count("FAIL openai-evaluate —"), 1)
        self.assertIn("HTTP 503 (LLM Not Configured)", out)
        self.assertNotIn("carries-request-derived-content", out)

    def test_partial_201_with_a_failed_section_fails(self):
        # §66: a provider failure mid-run is a PARTIAL 201 — the snapshot's
        # section says failed. The gate must catch exactly that shape.
        self.stub.state.posts["compare"] = (201, cmp_snapshot(jev_status="failed"))

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 1)
        self.assertEqual(out.count("FAIL jev-compare —"), 1)
        self.assertIn("the jev section did not complete", out)
        self.assertIn("jev='failed'", out)

    def test_non_201_success_status_is_a_failure(self):
        self.stub.state.posts["emulator"] = (200, emu_snapshot())

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 1)
        self.assertIn("FAIL emulator-run —", out)
        self.assertIn("expected 201", out)


class P23StructuredOutputsTestCase(SmokeLiveTestCase):
    """The §45 evidence drives the P23 mode report; WARNING never fails."""

    def test_prompted_fallback_mode_prints_a_warning_but_passes(self):
        self.stub.state.posts["compare-and-evaluate"] = (201, full_snapshot(False))
        self.stub.state.details[FULL_ID] = (200, full_snapshot(False))

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 0, out)
        self.assertEqual(
            out.count("WARNING: P23 fallback active (prompted schema mode)"), 1)
        self.assertEqual(out.count("PASS openai-evaluate —"), 1)
        self.assertIn("structured outputs: prompted schema (P23 fallback)", out)

    def test_strict_json_schema_is_the_reported_default_without_warning(self):
        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 0, out)
        self.assertNotIn("WARNING", out)
        self.assertIn("structured outputs: strict json_schema", out)

    def test_missing_evidence_field_reports_an_honest_unknown(self):
        snapshot = full_snapshot()
        snapshot["independent_openai"]["run_config"] = {"model": "gpt-4o-mini"}
        self.stub.state.posts["compare-and-evaluate"] = (201, snapshot)
        self.stub.state.details[FULL_ID] = (200, snapshot)

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 0, out)
        self.assertIn("WARNING: P23 mode not reported", out)
        self.assertIn("not reported by the evidence", out)
        self.assertEqual(out.count("PASS openai-evaluate —"), 1)

    def test_unreachable_execution_detail_fails_the_check(self):
        # The 201 body cannot be trusted alone for P23: no detail, no proof.
        self.stub.state.details = {}

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 1)
        self.assertIn("FAIL openai-evaluate —", out)
        self.assertIn("cannot verify the structured-outputs mode", out)


class CredentialsHandlingTestCase(SmokeLiveTestCase):
    def test_flags_win_over_the_environment(self):
        os.environ[smoke_live.USER_ENV_NAME] = "env-u9"
        os.environ[smoke_live.PASS_ENV_NAME] = "env-p9"

        code, out, err = self.run_main(*self.happy_args())

        self.assertEqual(code, 0, err or out)
        for name in CHECK_NAMES:
            self.assertEqual(out.count(f"PASS {name} —"), 1, out)

    def test_environment_credentials_are_used_when_flags_are_absent(self):
        os.environ[smoke_live.USER_ENV_NAME] = STUB_USER
        os.environ[smoke_live.PASS_ENV_NAME] = STUB_PASS

        code, out, _ = self.run_main("--base-url", self.stub.base_url)

        self.assertEqual(code, 0, out)
        self.assertIn("PASS origin-auth —", out)

    def test_credentials_never_appear_in_any_output_stream(self):
        # Distinctive pair, deliberately REJECTED by the stub so the run
        # exercises failure paths (the most likely place a leak could fire).
        user, value = "smoke-u7", "smoke-p7"
        encoded = base64.b64encode(f"{user}:{value}".encode()).decode("ascii")

        code, out, err = self.run_main(
            "--base-url", self.stub.base_url,
            "--auth-user", user, "--auth-pass", value,
        )

        self.assertEqual(code, 1)
        for stream in (out, err):
            self.assertNotIn(user, stream)
            self.assertNotIn(value, stream)
            self.assertNotIn(encoded, stream)
            self.assertNotIn("Authorization", stream)


class OperationalErrorTestCase(SmokeLiveTestCase):
    def test_missing_base_url_is_an_operational_error(self):
        code, out, err = self.run_main()

        self.assertEqual(code, 2)
        self.assertIn("--base-url is required", err)
        self.assertNotIn("PASS", out)

    def test_unreachable_origin_is_an_operational_error_with_origin_only(self):
        # Port 1 on the loopback interface: connection refused, immediately.
        code, out, err = self.run_main(
            "--base-url", "http://127.0.0.1:1",
            "--auth-user", STUB_USER, "--auth-pass", STUB_PASS,
        )

        self.assertEqual(code, 2)
        self.assertIn("origin unreachable", err)
        self.assertIn("http://127.0.0.1:1", err)
        self.assertNotIn("PASS", out)

    def test_invalid_require_choice_exits_2(self):
        with contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                smoke_live.main(["--base-url", "http://127.0.0.1:1",
                                 "--require", "bogus"])
        self.assertEqual(raised.exception.code, 2)

    def test_non_positive_timeout_is_rejected(self):
        code, _, err = self.run_main(
            "--base-url", self.stub.base_url, "--timeout", "0")

        self.assertEqual(code, 2)
        self.assertIn("must be positive", err)

    def test_unreachable_origin_with_userinfo_prints_host_and_port_only(self):
        # A --base-url carrying userinfo (https://u:p@host style) must never
        # echo those credentials to stderr: the operational error renders
        # scheme + hostname + port ONLY.
        code, out, err = self.run_main(
            "--base-url", "http://smoke-u5:smoke-p5@127.0.0.1:1",
            "--auth-user", STUB_USER, "--auth-pass", STUB_PASS,
        )

        self.assertEqual(code, 2)
        self.assertIn("origin unreachable", err)
        self.assertIn("http://127.0.0.1:1", err)
        self.assertNotIn("smoke-u5", err)
        self.assertNotIn("smoke-p5", err)
        self.assertNotIn("smoke-u5:smoke-p5@", err)
        self.assertNotIn("PASS", out)


class RunTimeoutTestCase(SmokeLiveTestCase):
    """An execution POST that exceeds --run-timeout is that check's FAIL
    (exit 1); GET-infrastructure timeouts stay operational (exit 2)."""

    def test_execution_post_exceeding_run_timeout_fails_the_check(self):
        # The provider runs are slow but the per-execution budget is tiny:
        # every POST blows the budget and each check FAILs on its own POST.
        self.stub.state.posts_sleep = 1.0

        code, out, err = self.run_main(*self.happy_args(), "--run-timeout", "0.2")

        self.assertEqual(code, 1)
        self.assertEqual(out.count("exceeded --run-timeout"), 3)
        self.assertIn("FAIL emulator-run —", out)
        self.assertIn("FAIL jev-compare —", out)
        self.assertIn("FAIL openai-evaluate —", out)
        self.assertIn("SMOKE-LIVE: FAIL — 3 failed, 0 skipped", out)
        # A POST timeout is a check failure, NOT an operational error.
        self.assertNotIn("origin unreachable", err)

    def test_get_infra_timeout_stays_an_operational_error(self):
        # /health slower than the GET budget: infrastructure, not a check
        # verdict — the run must exit 2 and print no verdict line.
        self.stub.state.health_sleep = 1.0

        code, out, err = self.run_main(*self.happy_args(), "--timeout", "0.2")

        self.assertEqual(code, 2)
        self.assertIn("origin unreachable", err)
        self.assertIn("PASS origin-auth —", out)
        self.assertNotIn("SMOKE-LIVE:", out)

    def test_run_timeout_default_covers_the_api_worst_case(self):
        # 300 s LLM retry budget + 120 s judge after the parallel phase +
        # slack: a slow-but-healthy run must fit the default budget.
        self.assertGreaterEqual(smoke_live.DEFAULT_RUN_TIMEOUT_SECONDS, 450)


class RedirectPolicyTestCase(SmokeLiveTestCase):
    """A 3xx is never followed (Authorization must not travel cross-origin);
    the check that saw it FAILs naming the redirect."""

    def test_redirect_on_root_fails_without_following(self):
        self.stub.state.redirect_root = True

        code, out, _ = self.run_main(*self.happy_args())

        self.assertEqual(code, 1)
        self.assertEqual(out.count("FAIL origin-auth —"), 1)
        self.assertIn("redirected (3xx)", out)
        self.assertIn("auth boundary broken or origin misrouted", out)
        # No follow: the stub served exactly ONE request — the anonymous
        # probe — and nothing was re-sent anywhere (not even to itself).
        self.assertEqual(len(self.stub.state.seen), 1)
        method, path, auth, _ = self.stub.state.seen[0]
        self.assertEqual((method, path), ("GET", "/"))
        self.assertIs(auth, False)
        # The failed auth check aborts the rest of the run.
        self.assertIn("ABORT: origin auth failed", out)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Live deployment smoke gate (ADR-011 acceptance lane, CHANGELOG R19/R20/R24).

ONE command for the deferred deployment acceptance: prove a deployed origin
behaves per ADR-005 (Basic Auth boundary, unauthenticated /health + /ready)
and that the three execution modes run against real providers — the online
counterpart of the hermetic demo-gate. Never runs inside demo-gate.

Checks, in order (one ``PASS|FAIL|SKIP <name> — <detail>`` line each):
  1. origin-auth    GET / with NO credentials expects 401 (a 200 means the
                    auth layer is broken, ADR-005 ruling 2), then 200 WITH
                    credentials.
  2. health         GET /health expects 200 (unauthenticated, PRD §6).
  3. ready          GET /ready expects 200.
  4. capabilities   GET /api/v1/capabilities expects 200; prints the honest
                    availability matrix (§63) that then DRIVES checks 5-7.
  5. emulator-run   POST /api/v1/executions mode=emulator on the canonical
                    SystemOneRequest; expects 201 + completed snapshot.
  6. jev-compare    POST mode=compare; expects 201 with the jev section
                    completed — this IS the real-JEV smoke (R20).
  7. openai-evaluate   POST mode=compare-and-evaluate with
                    advanced.independent_openai_prediction=true (the flag the
                    mobile E2E pins); expects 201 with the independent_openai +
                    ai_evaluation sections completed, then fetches the
                    execution detail and reports the structured-outputs MODE
                    the run actually used (P23): strict json_schema by
                    default, prompted schema = the sanctioned fallback, which
                    prints a WARNING line and never fails the check.

Skip/require semantics:
  * ``--require configured`` (default): a provider check MUST PASS when
    capabilities report it available; when unavailable it SKIPs and the run
    can still exit 0 (with a loud note naming the missing configuration).
  * ``--require all``: any SKIP becomes a FAIL.

Fail-fast: when check 1 (origin-auth) FAILS, the run prints one ABORT line
and stops immediately — checks 2-7 are not run at all, so a broken auth
boundary can never trigger paid provider calls.

Verdict line: every COMPLETED run ends with exactly one final line, either
``SMOKE-LIVE: PASS — <n> checks (0 failed, <m> skipped)`` or
``SMOKE-LIVE: FAIL — <n> failed, <m> skipped`` (operational errors exit 2
before any verdict is printed).

Timeouts: an execution POST that exceeds ``--run-timeout`` is that check's
FAIL ("exceeded --run-timeout"); GET-infrastructure timeouts stay
operational (exit 2). Redirects are NEVER followed — urllib would re-send
the Authorization header cross-origin — so any 3xx FAILs the check that
saw it.

Exit codes: 0 = every executed check passed (skips allowed per --require),
1 = at least one FAIL, 2 = operational error (missing --base-url, origin
unreachable, invalid arguments).

Credentials: ``--auth-user``/``--auth-pass`` win over the ``SMOKE_AUTH_USER``/
``SMOKE_AUTH_PASS`` environment variables. Credentials are NEVER printed:
HTTP error bodies are surfaced as RFC 7807 ``status + title`` only and
operational errors carry the failing URL's ORIGIN alone.

Stdlib only; runs with bare python3 (no third-party dependencies).
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.client import HTTPException
from typing import Any, Dict, List, Optional, Tuple

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_OPERATIONAL = 2

# Credential environment fallbacks (flags win over env).
USER_ENV_NAME = "SMOKE_AUTH_USER"
PASS_ENV_NAME = "SMOKE_AUTH_PASS"

# GET budget; POST budget for one execution run. The run budget must cover
# the API's own worst case, because the API — not this script — owns the
# real provider timeouts: the LLM retry budget alone is 300 s
# (INDEPENDENT_OPENAI_RETRY_BUDGET_SECONDS, providers/independent_openai.py) and
# the judge then gets up to 120 s AFTER the parallel phase, so a
# slow-but-healthy run needs 300 + 120 + slack = 450 s. A POST that still
# exceeds the budget FAILS its check (see _run_mode); it is not an
# operational error.
DEFAULT_TIMEOUT_SECONDS = 10
DEFAULT_RUN_TIMEOUT_SECONDS = 450

REQUIRE_CHOICES = ("configured", "all")

# The canonical three-question SystemOneRequest — verbatim the contract
# fixture packages/contracts/fixtures/system-one-request.valid.json (the same
# document the web app's Sample button sends and the e2e suite pins as
# SYSTEM_ONE_REQUEST in e2e/fixtures/index.ts). Wrapped in the §64 envelope
# {"system_one", "mode"[, "advanced"]} exactly as the contract fixtures
# system-one-execution-request.*.json and the apps/api integration suite do.
CANONICAL_SYSTEM_ONE = {
    "state": {
        "message": "I was charged twice on my invoice.",
    },
    "questions": {
        "request_type": {
            "type": "choice",
            "instructions": "Classify this request.",
            "criteria": {
                "billing": "Billing issue",
                "technical": "Technical issue",
                "sales": "Sales request",
            },
        },
        "urgency": {
            "type": "score",
            "criteria": ["low", "medium", "high"],
        },
        "refund_requested": {
            "type": "noul",
            "criteria": {
                "true": "The customer requests a refund.",
                "false": "The customer does not request a refund.",
            },
        },
    },
}

# The advanced envelope flag pinned by the mobile E2E posted-body assertion
# (e2e/tests/mobile.spec.ts: advanced.independent_openai_prediction).
ADVANCED_INDEPENDENT = {"independent_openai_prediction": True}

# Loud skip notes (default --require only): name the configuration the §63
# capabilities matrix lacks, so the operator knows what to inject.
SKIP_NOTES = {
    "emulator": "SKIPPED emulator — not configured at this deployment "
                "(EMULATOR_URL absent?)",
    "jev": "SKIPPED jev — not configured at this deployment "
           "(TYPESAFE_API_KEY absent?)",
    "openai": "SKIPPED LLM — not configured at this deployment "
           "(OPENAI_API_KEY absent?); full acceptance = --require all",
}

# Fail-fast line after a FAILED origin-auth check: nothing else runs, so a
# broken auth boundary can never trigger paid provider calls.
ABORT_LINE = "ABORT: origin auth failed — remaining checks not run (no paid calls)"

Credentials = Tuple[str, str]

# Honest client identity on every outbound request. Cloudflare's Browser
# Integrity Check rejects the stdlib "Python-urllib/x.y" User-Agent with
# Error 1010 BEFORE the origin sees anything — this tool is a client, not
# a browser, and says so (no browser spoofing).
USER_AGENT = "jevals-smoke-live/1.0"


def _sanitize_origin(url: str) -> str:
    """Render scheme + hostname + port ONLY for an arbitrary --base-url.

    The URL may carry userinfo (``https://user:pass@host``); operational
    errors print the origin verbatim, so the username/password halves must
    be dropped here or they would leak to stderr.
    """
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    if ":" in host:  # IPv6 literals lose their brackets in .hostname
        host = f"[{host}]"
    if parts.port is not None:
        host = f"{host}:{parts.port}"
    return f"{parts.scheme}://{host}"


class OperationalError(Exception):
    """Origin-level failure (DNS, refused, timeout): exit 2, origin only."""

    def __init__(self, url: str, reason: Any) -> None:
        self.origin = _sanitize_origin(url)
        self.reason = reason
        # Timeout vs refused/DNS/protocol: callers treat a timeout on an
        # execution POST as that check's FAIL; every other transport failure
        # stays an operational error (exit 2). socket.timeout IS
        # TimeoutError on Python 3.10+ and its subclass before that, so one
        # isinstance covers both the connect phase (URLError.reason) and the
        # read phase (raised directly, caught as OSError).
        self.is_timeout = isinstance(reason, socket.timeout)
        super().__init__(f"{self.origin}: {reason}")


class HttpResult:
    """One HTTP exchange: status plus a best-effort parsed JSON body."""

    __slots__ = ("status", "body")

    def __init__(self, status: int, body: Any) -> None:
        self.status = status
        self.body = body

    def problem_title(self) -> Optional[str]:
        """RFC 7807 title when the body is a problem+json object, else None.

        Deliberately the ONLY part of an error body ever printed: `detail`
        can echo request content, so it stays out of the output.
        """
        if isinstance(self.body, dict):
            title = self.body.get("title")
            if isinstance(title, str) and title:
                return title
        return None

    def problem_note(self) -> str:
        """Compact ``HTTP <status> (<title>)`` rendering, title optional."""
        if 300 <= self.status < 400:
            # Redirects are never followed (see _NoRedirectHandler), so a 3xx
            # reaching a check means the origin misrouted us or the auth
            # boundary is broken — name it loudly.
            return (f"HTTP {self.status} redirected (3xx) — auth boundary "
                    "broken or origin misrouted")
        title = self.problem_title()
        return f"HTTP {self.status} ({title})" if title else f"HTTP {self.status}"


def _basic_header(credentials: Credentials) -> str:
    """The Basic Authorization header value for the supplied credentials."""
    raw = ":".join(credentials).encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _parse_json(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        return None


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Redirects are never followed: the stdlib would transparently re-send
    the request — Authorization header included — to whatever host the
    Location points at. Any 3xx therefore surfaces as an HTTPError and FAILs
    the check that saw it, instead of silently crossing the auth boundary."""

    def redirect_request(  # type: ignore[override]
        self, request: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


# Built once: the default handlers plus the no-redirect policy.
_OPENER = urllib.request.build_opener(_NoRedirectHandler)


def fetch(
    method: str,
    url: str,
    *,
    timeout: float,
    credentials: Optional[Credentials] = None,
    payload: Optional[dict] = None,
) -> HttpResult:
    """Perform one HTTP request, mapping transport failures to exit 2.

    HTTP error statuses are NOT exceptions here: every check owns its own
    status expectations. Only transport-level failure (unreachable origin,
    DNS, timeout, truncated response) becomes OperationalError.
    """
    data = None
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if credentials is not None:
        headers["Authorization"] = _basic_header(credentials)
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            return HttpResult(response.status, _parse_json(response.read()))
    except urllib.error.HTTPError as error:
        try:
            body = _parse_json(error.read())
        except Exception:  # noqa: BLE001 - a body read must never mask the status
            body = None
        return HttpResult(error.code, body)
    except urllib.error.URLError as error:
        raise OperationalError(url, error.reason) from None
    except (HTTPException, OSError) as error:
        # Read-phase timeouts, dropped connections, malformed statuses.
        raise OperationalError(url, error) from None


class SmokeGate:
    """The seven ordered checks against one deployed origin."""

    def __init__(
        self,
        base_url: str,
        credentials: Optional[Credentials],
        timeout: float,
        run_timeout: float,
        require: str,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.credentials = credentials
        self.timeout = timeout
        self.run_timeout = run_timeout
        self.require = require
        # Set by check_capabilities; stays None when that check failed, so
        # provider checks know availability is unknown rather than false.
        self.capabilities: Optional[Dict[str, Any]] = None
        # Verdict-line tallies: every result line flows through _report, so
        # the counts cannot drift from what was printed.
        self.executed = 0
        self.failures = 0
        self.skips = 0

    # -- plumbing ----------------------------------------------------------

    def _url(self, path: str) -> str:
        return self.base_url + path

    def _get(self, path: str, *, with_credentials: bool = True) -> HttpResult:
        return fetch(
            "GET",
            self._url(path),
            timeout=self.timeout,
            credentials=self.credentials if with_credentials else None,
        )

    def _post_execution(self, mode: str, *, advanced: Optional[dict] = None) -> HttpResult:
        payload: Dict[str, Any] = {"system_one": CANONICAL_SYSTEM_ONE, "mode": mode}
        if advanced is not None:
            payload["advanced"] = advanced
        return fetch(
            "POST",
            self._url("/api/v1/executions"),
            timeout=self.run_timeout,
            credentials=self.credentials,
            payload=payload,
        )

    def _report(self, state: str, name: str, detail: str) -> None:
        print(f"{state} {name} — {detail}")
        if state == "FAIL":
            self.failures += 1
        elif state == "SKIP":
            self.skips += 1

    def _skip_or_fail(self, name: str, provider: str, reason: str) -> bool:
        """Unavailability per §63: SKIP under --require configured, FAIL under all."""
        if self.require == "all":
            self._report("FAIL", name, f"{reason} (--require all: a skip is a failure)")
            return False
        self._report("SKIP", name, reason)
        print(SKIP_NOTES[provider])
        return True

    @staticmethod
    def _section_status(body: Any, section: str) -> Optional[str]:
        if isinstance(body, dict):
            entry = body.get(section)
            if isinstance(entry, dict):
                value = entry.get("status")
                if isinstance(value, str):
                    return value
        return None

    # -- checks 1-4: the origin itself --------------------------------------

    def check_origin_auth(self) -> bool:
        anonymous = self._get("/", with_credentials=False)
        if anonymous.status != 401:
            # ADR-005 ruling 2: healthy = 401 unauthenticated. A 200 means
            # the auth boundary is not enforcing — the loudest possible bug.
            self._report(
                "FAIL",
                "origin-auth",
                f"GET / without credentials returned {anonymous.problem_note()} "
                "(expected 401: the Basic Auth boundary is broken, ADR-005)",
            )
            return False
        if self.credentials is None:
            self._report(
                "FAIL",
                "origin-auth",
                "origin requires credentials but none were supplied — pass "
                f"--auth-user/--auth-pass (or {USER_ENV_NAME}/{PASS_ENV_NAME})",
            )
            return False
        authorized = self._get("/", with_credentials=True)
        if authorized.status != 200:
            self._report(
                "FAIL",
                "origin-auth",
                "401 without credentials, but the credentialed GET / returned "
                f"{authorized.problem_note()} (expected 200)",
            )
            return False
        self._report("PASS", "origin-auth", "401 without credentials, 200 with credentials")
        return True

    def _check_public_endpoint(self, name: str, path: str) -> bool:
        result = self._get(path, with_credentials=False)
        if result.status == 200:
            self._report("PASS", name, "200 (unauthenticated)")
            return True
        self._report("FAIL", name, f"returned {result.problem_note()} (expected 200)")
        return False

    def check_health(self) -> bool:
        return self._check_public_endpoint("health", "/health")

    def check_ready(self) -> bool:
        return self._check_public_endpoint("ready", "/ready")

    def check_capabilities(self) -> bool:
        result = self._get("/api/v1/capabilities")
        if result.status != 200:
            self._report("FAIL", "capabilities", f"returned {result.problem_note()} (expected 200)")
            return False
        body = result.body if isinstance(result.body, dict) else {}
        self.capabilities = body
        matrix = []
        for provider in ("emulator", "jev", "openai"):
            entry = body.get(provider)
            available = bool(entry.get("available")) if isinstance(entry, dict) else False
            cell = f"{provider}={'yes' if available else 'no'}"
            if isinstance(entry, dict):
                models = entry.get("models")
                if isinstance(models, list) and models:
                    cell += f" ({', '.join(str(m) for m in models)})"
            matrix.append(cell)
        default_model = body.get("default_model")
        suffix = f" default_model={default_model}" if default_model else ""
        self._report("PASS", "capabilities", "honest availability reported (§63)")
        print(f"  matrix: {' '.join(matrix)}{suffix}")
        return True

    # -- checks 5-7: real execution runs -------------------------------------

    def _run_mode(
        self,
        name: str,
        provider: str,
        mode: str,
        sections: List[str],
        *,
        advanced: Optional[dict] = None,
        report_pass: bool = True,
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """Shared body of checks 5-7.

        Returns ``(ok, body)``: ok is True for PASS and for SKIP (a skip is
        not a failure under the default --require), False only for FAIL;
        body is the 201 snapshot dict on PASS and None otherwise. Every
        outcome prints its own exactly-one result line here, except a PASS
        when ``report_pass`` is False — for callers (check 7) that append
        their own verification before printing the single PASS line.
        """
        if self.capabilities is None:
            ok = self._skip_or_fail(
                name, provider, "availability unknown — the capabilities check failed")
            return (ok, None)
        entry = self.capabilities.get(provider)
        available = bool(entry.get("available")) if isinstance(entry, dict) else False
        if not available:
            ok = self._skip_or_fail(
                name, provider, f"{provider} unavailable per capabilities (§63)")
            return (ok, None)

        try:
            result = self._post_execution(mode, advanced=advanced)
        except OperationalError as error:
            if not error.is_timeout:
                raise  # refused/DNS/protocol: origin-level, exit 2
            # A timeout on the EXECUTION POST is this check's verdict: the
            # run exceeded --run-timeout (GET-infra timeouts stay exit 2).
            self._report(
                "FAIL",
                name,
                f"mode '{mode}' exceeded --run-timeout ({self.run_timeout:g} s) — "
                "the API did not finish within the per-execution budget",
            )
            return (False, None)
        if result.status != 201:
            # Unconfigured provider = 503 problem; upstream provider failure
            # = 5xx problem (§65/§66). The §66 PARTIAL case is a 201 whose
            # section says failed — handled below.
            self._report(
                "FAIL",
                name,
                f"mode '{mode}' returned {result.problem_note()} (expected 201)",
            )
            return (False, None)
        body = result.body if isinstance(result.body, dict) else {}
        overall = body.get("status")
        for section in sections:
            section_status = self._section_status(body, section)
            if section_status != "success":
                where = f"the {section} section" if isinstance(body.get(section), dict) else "the run"
                self._report(
                    "FAIL",
                    name,
                    f"201 but {where} did not complete "
                    f"({section}={section_status!r}, overall={overall!r})",
                )
                return (False, None)
        execution_id = body.get("execution_id")
        if report_pass:
            detail = f"execution {execution_id} completed"
            if overall != "completed":
                detail = (
                    f"execution {execution_id} overall={overall!r} "
                    "(requested sections completed)"
                )
            self._report("PASS", name, detail)
        return (True, body)

    def check_emulator_run(self) -> bool:
        ok, _ = self._run_mode("emulator-run", "emulator", "emulator", ["emulator"])
        return ok

    def check_jev_compare(self) -> bool:
        # The real-JEV smoke (R20): compare mode exercises the emulator AND
        # the live typesafe.ai JEV; the jev section is the one under test.
        ok, _ = self._run_mode("jev-compare", "jev", "compare", ["emulator", "jev"])
        return ok

    def check_openai_evaluate(self) -> bool:
        ok, body = self._run_mode(
            "openai-evaluate",
            "openai",
            "compare-and-evaluate",
            ["emulator", "jev", "independent_openai", "ai_evaluation"],
            advanced=ADVANCED_INDEPENDENT,
            # The single PASS line waits until the P23 evidence below has
            # been read, so the check reports exactly one result line.
            report_pass=False,
        )
        if not ok:
            return False
        if body is None:
            return True  # skipped (capabilities said the LLM provider unavailable)
        # P23 verification: the structured-outputs MODE this run actually
        # used, read from the PERSISTED §45 evidence — the detail endpoint's
        # independent_openai.run_config.structured_outputs (bool: True = strict
        # json_schema, False = prompted schema fallback). A WARNING never
        # fails the check: prompted fallback is the sanctioned P23 mode.
        execution_id = body.get("execution_id")
        detail = self._get(f"/api/v1/executions/{execution_id}")
        if detail.status != 200:
            self._report(
                "FAIL",
                "openai-evaluate",
                f"cannot verify the structured-outputs mode: the execution "
                f"detail returned {detail.problem_note()} (expected 200)",
            )
            return False
        snapshot = detail.body if isinstance(detail.body, dict) else {}
        section = snapshot.get("independent_openai")
        run_config = section.get("run_config") if isinstance(section, dict) else None
        mode_used = run_config.get("structured_outputs") if isinstance(run_config, dict) else None
        if mode_used is True:
            self._report(
                "PASS",
                "openai-evaluate",
                f"execution {execution_id}: independent + ai_evaluation completed; "
                "structured outputs: strict json_schema",
            )
            return True
        if mode_used is False:
            print("WARNING: P23 fallback active (prompted schema mode)")
            self._report(
                "PASS",
                "openai-evaluate",
                f"execution {execution_id}: independent + ai_evaluation completed; "
                "structured outputs: prompted schema (P23 fallback)",
            )
            return True
        print("WARNING: P23 mode not reported — run_config.structured_outputs absent from the evidence")
        self._report(
            "PASS",
            "openai-evaluate",
            f"execution {execution_id}: independent + ai_evaluation completed; "
            "structured outputs: not reported by the evidence",
        )
        return True

    # -- orchestration -------------------------------------------------------

    def _print_verdict(self) -> None:
        """The exactly-one final line every completed run ends with."""
        if self.failures:
            print(f"SMOKE-LIVE: FAIL — {self.failures} failed, {self.skips} skipped")
        else:
            print(
                f"SMOKE-LIVE: PASS — {self.executed} checks "
                f"(0 failed, {self.skips} skipped)"
            )

    def run(self) -> int:
        self.executed += 1
        if not self.check_origin_auth():
            # Fail-fast: with the auth boundary broken there is nothing left
            # to prove, and checks 5-7 would spend paid provider calls
            # through an unauthorized origin.
            print(ABORT_LINE)
            self._print_verdict()
            return EXIT_FAIL
        for step in (
            self.check_health,
            self.check_ready,
            self.check_capabilities,
            self.check_emulator_run,
            self.check_jev_compare,
            self.check_openai_evaluate,
        ):
            self.executed += 1
            step()
        self._print_verdict()
        return EXIT_FAIL if self.failures else EXIT_OK


def _resolve_credentials(args: argparse.Namespace) -> Optional[Credentials]:
    """Flags win over the SMOKE_AUTH_* environment variables.

    Credentials exist only when BOTH halves are present: a lone user or lone
    value would produce a header the origin must reject anyway.
    """
    user = args.auth_user if args.auth_user is not None else os.environ.get(USER_ENV_NAME)
    value = args.auth_pass if args.auth_pass is not None else os.environ.get(PASS_ENV_NAME)
    if user and value:
        return (user, value)
    return None


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="smoke_live.py",
        description="Live deployment acceptance gate (ADR-011): ADR-005 auth boundary, "
        "health/ready, capabilities, and real emulator/JEV/LLM execution runs.",
        epilog="Credentials: --auth-user/--auth-pass, or the "
        f"{USER_ENV_NAME}/{PASS_ENV_NAME} environment variables (flags win). "
        "Exit codes: 0 all executed checks passed, 1 at least one FAIL, "
        "2 operational error.",
    )
    parser.add_argument("--base-url", default=None,
                        help="deployed origin, e.g. https://jevals.example.org (required)")
    parser.add_argument("--auth-user", default=None,
                        help=f"Basic Auth user (default: ${USER_ENV_NAME})")
    parser.add_argument("--auth-pass", default=None,
                        help=f"Basic Auth value (default: ${PASS_ENV_NAME})")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS,
                        help=f"per-GET budget in seconds (default: {DEFAULT_TIMEOUT_SECONDS})")
    parser.add_argument("--run-timeout", type=float, default=DEFAULT_RUN_TIMEOUT_SECONDS,
                        help=f"per-execution POST budget in seconds "
                        f"(default: {DEFAULT_RUN_TIMEOUT_SECONDS})")
    parser.add_argument("--require", choices=REQUIRE_CHOICES, default="configured",
                        help="'configured': unavailable providers SKIP (exit 0 possible); "
                        "'all': every SKIP is a FAIL (default: configured)")
    args = parser.parse_args(argv)

    if not args.base_url:
        parser.print_usage(sys.stderr)
        print("error: --base-url is required (the deployed origin, "
              "e.g. https://jevals.example.org)", file=sys.stderr)
        return EXIT_OPERATIONAL
    if args.timeout <= 0 or args.run_timeout <= 0:
        print("error: --timeout and --run-timeout must be positive", file=sys.stderr)
        return EXIT_OPERATIONAL

    gate = SmokeGate(
        args.base_url,
        _resolve_credentials(args),
        args.timeout,
        args.run_timeout,
        args.require,
    )
    try:
        return gate.run()
    except OperationalError as error:
        # Origin-level failure: report the ORIGIN only (never the full URL,
        # never headers) plus the transport reason.
        print(f"error: origin unreachable: {error.origin} ({error.reason})", file=sys.stderr)
        return EXIT_OPERATIONAL


if __name__ == "__main__":
    sys.exit(main())

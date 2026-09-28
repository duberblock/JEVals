#!/usr/bin/env python3
"""Secret scanner for this repository's working tree.

Demo-hardening gate (Plan Phase 10, section 79): prove that no secrets sit
in the files a demo would ship. Provider secrets live only in the
gitignored local env files.

Contract:
  * No input by default: candidates come from ``git ls-files`` (tracked)
    plus ``git ls-files --others --exclude-standard`` (untracked, not
    gitignored), both run at the repository root found by walking up from
    this script. In short: the working
    tree minus ignored files, so brand-new files are audited before their
    first commit. ``--root PATH`` overrides the root (used by the
    integration tests against a temp git repo).
  * Skips non-text candidates: binaries by extension (including ``.pyc``)
    and any file larger than MAX_FILE_BYTES; a ``skipped N files
    (binary/oversize)`` line reports those lanes. Lock files are text and
    are scanned.
  * Exit codes: 0 clean ("clean: N files scanned, 0 findings"), 1 findings,
    2 usage/operational errors (git missing, not a git repo, ...).
  * Never prints a full secret: snippets are redacted to their first 8 chars.

Stdlib only; runs with bare python3 (no third-party dependencies).
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple

Finding = Tuple[str, int, str, str]  # (path, line number, rule name, matched snippet)

# File extensions that are never scanned (images, icons, fonts, bytecode).
BINARY_SUFFIXES = {
    ".png", ".ico", ".jpg", ".jpeg", ".gif", ".webp",
    ".woff", ".woff2", ".ttf", ".otf", ".pyc",
}

# Files above this size are skipped. The largest tracked text files are lock
# files of a few hundred KB, so 2 MB leaves ample headroom while capping cost.
MAX_FILE_BYTES = 2 * 1024 * 1024

# Quoted values that are obviously placeholders (compared case-insensitively
# after stripping). Applies to the generic assignment rules only.
ALLOWED_LITERALS = {
    "test",
    "changeme",
    "placeholder",
    "redacted",
    "your-api-key-here",
    "not-a-secret",
    "example-api-key-value",
}

# (rule name, compiled regex). The lookbehind guards keep signal high:
# e.g. "risk-assessment" must not fire the OpenAI-key rule.
#
# Both generic assignment rules name their value capture group "value" so
# scan_text applies the placeholder exemption uniformly to whichever rule
# matched. The unquoted variant exists because real leaks show up as bare
# `KEY=value` (.env) and `key: value` (YAML) lines; its charset excludes
# spaces so prose can never satisfy the 16-char minimum.
RULES: List[Tuple[str, re.Pattern]] = [
    ("PEM_PRIVATE_KEY",
     re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("OPENAI_API_KEY",
     re.compile(r"(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}")),
    ("GITHUB_TOKEN",
     re.compile(r"(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{36}(?![A-Za-z0-9])")),
    ("AWS_ACCESS_KEY_ID",
     re.compile(r"(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])")),
    ("GOOGLE_API_KEY",
     re.compile(r"(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}")),
    ("SLACK_TOKEN",
     re.compile(r"(?<![A-Za-z0-9_-])xox[baprs]-[A-Za-z0-9-]{10,}")),
    # Fernet ciphertext (provider keys stored by the settings UI, and any
    # dumped credential): version+timestamp bytes always urlsafe-base64 to
    # the literal prefix "gAAAAAB" followed by 100+ base64url characters.
    # The raw 44-char master KEY is too generic to pattern-match — the
    # gitignored *.key files and 0600 permissions cover that half.
    ("FERNET_TOKEN",
     re.compile(r"(?<![A-Za-z0-9_-])gAAAAAB[A-Za-z0-9_-]{100,}")),
    ("GENERIC_SECRET_ASSIGNMENT",
     re.compile(r"(?i)(api_key|apikey|secret|password|passwd|token)"
                r"\s*[:=]\s*(['\"])(?P<value>[^'\"]{16,})\2")),
    ("GENERIC_SECRET_ASSIGNMENT_UNQUOTED",
     re.compile(r"(?i)(api_key|apikey|secret|password|passwd|token)"
                r"\s*[:=]\s*(?P<value>[A-Za-z0-9_\-./+=]{16,})")),
]

# Explicit exemptions, matched with re.search against "path:line:snippet".
# Every entry must carry a justification and stay reviewable. The unquoted
# generic rule (E1) surfaced code-only matches below: Python keyword
# arguments and tuple unpacking whose right-hand side is an identifier or
# call expression, never a secret literal.
ALLOWLIST: List[Tuple[re.Pattern, str]] = [
    # Domain fixture, not a credential: "secret" is the user's secret *state*
    # sentence used by unit tests of the evaluation domain.
    (re.compile(r"(test_execution_completion_logging|test_scan_secrets)\.py:\d+:"
                r"(STATE_)?SECRET\s*=\s*['\"]I was charged"),
     "Domain fixture: user secret-state sentence in a unit test (and its copy in the scanner self-tests), not a credential."),
    # Constructor keyword arguments wiring settings *variables* (never
    # literals) into the provider clients.
    (re.compile(r"dependencies\.py:\d+:api_key=settings\."),
     "Code: keyword argument passes a settings variable to a client constructor; the value is an identifier, not a secret."),
    # Tuple unpacking via str.partition in Basic-auth verification.
    (re.compile(r"security\.py:\d+:(token = authorization|password = decoded)\.partition"),
     "Code: str.partition unpacking of an incoming header; the value is an attribute access, not a secret."),
    # Test helper that *builds* a Basic-auth header from its parameters.
    (re.compile(r"(test_execution_history_api|test_auth)\.py:\d+:token = base64\.b64encode"),
     "Code: test helper encoding caller-supplied arguments; the value is a function call, not a secret."),
    # Self-referential fixtures: the scanner's own unittests must contain
    # canonical (synthetic) examples of every rule they assert on. Anchored
    # to the canonical VALUES, never to the path alone: a genuine secret
    # pasted into the test file that does not contain one of these
    # fragments still fires. Extending the tests with a new canonical
    # example means deliberately extending this entry — the loud scan
    # failure is what forces the decision.
    # NOTE: the ghp_/AKIA/xoxb- fragments below are split across string
    # literals on purpose — contiguous, this very entry would fire the
    # GITHUB/AWS/SLACK rules on the scanner's own source line.
    (re.compile(r"(?:playground/)?scripts/tests/test_scan_secrets\.py:\d+:"
                r".*(BEGIN RSA PRIVATE KEY|sk-Abc123|sk-abcdefghij"
                r"|ghp_" r"abcdefghijklmnopqrstuvwxyz0123456789"
                r"|AKIA" r"0123456789ABCDEF|xox" r"b-1234567890"
                r"|super-secret-value-123456|correct-horse-battery-staple"
                r"|abcdefghijklmnopqrstuvwxyz|abcDEFG123456789"
                r"|gAAAAAB)"),
     "Scanner self-tests: canonical synthetic examples for the rule-set unittests, not credentials."),
]


def find_repo_root() -> Path:
    """Locate the repository root by walking up from this script."""
    for root in Path(__file__).resolve().parents:
        if (root / ".git").exists():
            return root
    raise RuntimeError("repository root not found above this script (no .git)")


def is_placeholder(value: str) -> bool:
    """True when a matched value is obviously a placeholder, not a secret."""
    v = value.strip().lower()
    if v in ALLOWED_LITERALS:
        return True
    # Template forms: ${VAR}, {{ var }}, <your-key>.
    return (
        (v.startswith("${") and v.endswith("}"))
        or (v.startswith("{{") and v.endswith("}}"))
        or (v.startswith("<") and v.endswith(">"))
    )


def is_allowed(path: str, lineno: int, snippet: str) -> Optional[str]:
    """Return the justification when a finding is explicitly allowlisted."""
    key = f"{path}:{lineno}:{snippet}"
    for pattern, reason in ALLOWLIST:
        if pattern.search(key):
            return reason
    return None


def redact(snippet: str) -> str:
    """Truncate a snippet to its first 8 chars so no full secret is printed."""
    return snippet[:8] + "…" if len(snippet) > 8 else snippet


def format_finding(finding: Finding) -> str:
    path, lineno, rule_name, snippet = finding
    return f"{path}:{lineno}: {rule_name}: {redact(snippet)}"


def scan_text(text: str, path: str) -> List[Finding]:
    """Scan one file's content and return the findings for it."""
    findings: List[Finding] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for rule_name, regex in RULES:
            for match in regex.finditer(line):
                # Rules that name a "value" group get the uniform
                # placeholder exemption; the snippet is the whole match.
                if "value" in regex.groupindex and is_placeholder(
                        match.group("value")):
                    continue
                snippet = match.group(0)
                if is_allowed(path, lineno, snippet) is not None:
                    continue
                findings.append((path, lineno, rule_name, snippet))
    return findings


def is_scannable(path: Path) -> bool:
    """True when a file is a candidate for scanning (text, not oversized)."""
    if not path.is_file() or path.suffix.lower() in BINARY_SUFFIXES:
        return False
    try:
        return path.stat().st_size <= MAX_FILE_BYTES
    except OSError:
        return False


def scan_file(path: Path, display: Optional[str] = None) -> Optional[List[Finding]]:
    """Scan one file; returns None when the file is skipped."""
    if not is_scannable(path):
        return None
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        print(f"warning: cannot read {path}: {exc}", file=sys.stderr)
        return None
    return scan_text(text, display or str(path))


def _git_ls_files(root: Path, extra_args: List[str]) -> List[str]:
    """Run one ``git ls-files`` listing under root and return its names."""
    cmd = ["git", "-C", str(root), "ls-files", "-z", *extra_args]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=False)
    except FileNotFoundError:
        raise RuntimeError(f"git is not available on PATH ({cmd[0]})") from None
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"git ls-files failed under {root}: {detail}")
    return [n for n in proc.stdout.decode("utf-8", "replace").split("\0") if n]


def candidate_files(root: Path) -> List[Tuple[Path, str]]:
    """List the scan candidates under root as (absolute path, relative name).

    Candidates are the working tree minus ignored files: the git-tracked
    listing (``git ls-files``) plus untracked-but-not-ignored files
    (``git ls-files --others --exclude-standard``), so a brand-new file is
    audited before it ever reaches a commit. Names are deduplicated
    defensively (a listing cannot overlap today, but merging must stay
    correct if that ever changes).
    """
    names: List[str] = []
    seen = set()
    listings = (
        _git_ls_files(root, []),
        _git_ls_files(root, ["--others", "--exclude-standard"]),
    )
    for listing in listings:
        for name in listing:
            if name not in seen:
                seen.add(name)
                names.append(name)
    return [(root / name, name) for name in names]


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Scan the working tree (tracked + untracked, not ignored) for secrets.")
    parser.add_argument(
        "--root", type=Path, default=None,
        help="repository root (default: two levels above this script)",
    )
    args = parser.parse_args(argv)

    try:
        root = args.root.resolve() if args.root else find_repo_root()
        files = candidate_files(root)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    findings: List[Finding] = []
    scanned = 0
    skipped = 0
    for path, name in files:
        result = scan_file(path, display=name)
        if result is None:
            skipped += 1
            continue
        scanned += 1
        findings.extend(result)

    for finding in findings:
        print(format_finding(finding))
    if findings:
        print(f"{scanned} files scanned, {len(findings)} findings", file=sys.stderr)
        if skipped:
            print(f"skipped {skipped} files (binary/oversize)", file=sys.stderr)
        return 1
    if skipped:
        print(f"skipped {skipped} files (binary/oversize)")
    print(f"clean: {scanned} files scanned, 0 findings")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Tests for scripts/scan_secrets.py — stdlib unittest only (no pytest).

Covers: the rule set, placeholder/allowlist decision logic, redaction,
the file-walking path without git (temp fake tree), and one integration
test against a real temp git repository.
"""

import contextlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import scan_secrets  # noqa: E402


class RuleSetTestCase(unittest.TestCase):
    """Each rule fires on its canonical example; clean text does not fire."""

    CANONICAL_EXAMPLES = [
        ("PEM_PRIVATE_KEY", "-----BEGIN RSA PRIVATE KEY-----"),
        ("OPENAI_API_KEY", 'x = "sk-Abc123Def456Ghi789Jkl01Mno"'),
        ("GITHUB_TOKEN", "x = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'"),
        ("AWS_ACCESS_KEY_ID", "x = AKIA0123456789ABCDEF"),
        ("GOOGLE_API_KEY", "x = AIza" + "a" * 35),
        ("SLACK_TOKEN", "x = xoxb-1234567890abcdefghijklmnop"),
        ("GENERIC_SECRET_ASSIGNMENT", 'api_key = "super-secret-value-123456"'),
        ("GENERIC_SECRET_ASSIGNMENT_UNQUOTED",
         "SERVICE_SECRET=correct-horse-battery-staple"),
    ]

    def test_canonical_examples_fire(self):
        for rule_name, line in self.CANONICAL_EXAMPLES:
            with self.subTest(rule=rule_name):
                rules = {f[2] for f in scan_secrets.scan_text(line, "synthetic.txt")}
                self.assertIn(rule_name, rules)

    def test_clean_text_has_no_findings(self):
        text = "def add(a, b):\n    return a + b\n"
        self.assertEqual(scan_secrets.scan_text(text, "clean.py"), [])

    def test_lookbehind_guard_blocks_embedded_matches(self):
        # "risk-assessment-..." embeds "sk-..." inside a word: must not fire.
        text = "risk-assessment-allocation-strategy-planning"
        self.assertEqual(scan_secrets.scan_text(text, "doc.md"), [])

    def test_short_values_do_not_fire(self):
        # Mirrors the real tree: api_key="llm-secret-key" (14 chars) is below
        # the 16-char threshold of the generic assignment rule.
        self.assertEqual(scan_secrets.scan_text('api_key="llm-secret-key"', "t.py"), [])

    def test_placeholders_do_not_fire(self):
        cases = [
            'api_key = "your-api-key-here"',
            'password = "${SERVICE_PASSWORD_PLACEHOLDER}"',
            'token = "{{ secrets.api_token }}"',
        ]
        for line in cases:
            with self.subTest(line=line):
                self.assertEqual(scan_secrets.scan_text(line, "t.py"), [])

    def test_line_numbers_are_reported(self):
        text = "first\nsecond\napi_key = \"abcdefghijklmnopqrstuvwxyz\"\n"
        findings = scan_secrets.scan_text(text, "t.py")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0][1], 3)

    def test_multiple_rules_can_fire_on_one_line(self):
        line = 'token = "sk-abcdefghij1234567890ABCDEF"'
        rules = {f[2] for f in scan_secrets.scan_text(line, "t.py")}
        self.assertEqual(rules, {"OPENAI_API_KEY", "GENERIC_SECRET_ASSIGNMENT"})


class UnquotedAssignmentTestCase(unittest.TestCase):
    """E1: unquoted secret assignments (.env and YAML style) must fire.

    Values are restricted to a dense charset with no spaces so ordinary
    prose never matches; placeholders stay exempt exactly as for the
    quoted rule.
    """

    def test_env_style_assignment_fires(self):
        # .env style: KEY=value with no quotes and no spaces.
        findings = scan_secrets.scan_text(
            "SERVICE_SECRET=correct-horse-battery-staple\n", ".env")
        self.assertEqual([f[2] for f in findings],
                         ["GENERIC_SECRET_ASSIGNMENT_UNQUOTED"])

    def test_yaml_style_assignment_fires(self):
        # YAML style: key: value.
        findings = scan_secrets.scan_text(
            "password: correct-horse-battery-staple\n", "config.yaml")
        self.assertEqual([f[2] for f in findings],
                         ["GENERIC_SECRET_ASSIGNMENT_UNQUOTED"])

    def test_colon_separator_without_space_fires(self):
        findings = scan_secrets.scan_text(
            "passwd:correct-horse-battery-staple\n", "t.txt")
        self.assertEqual([f[2] for f in findings],
                         ["GENERIC_SECRET_ASSIGNMENT_UNQUOTED"])

    def test_quoted_values_fire_only_the_quoted_rule(self):
        # The quote character is outside the unquoted charset, so a quoted
        # assignment must produce exactly one finding, not two.
        findings = scan_secrets.scan_text(
            'api_key = "super-secret-value-123456"', "t.py")
        self.assertEqual([f[2] for f in findings],
                         ["GENERIC_SECRET_ASSIGNMENT"])

    def test_short_unquoted_values_do_not_fire(self):
        self.assertEqual(
            scan_secrets.scan_text("secret=llm-secret-key\n", ".env"), [])

    def test_unquoted_placeholders_do_not_fire(self):
        cases = [
            "password: your-api-key-here",
            "token=changeme",
            "passwd:placeholder",
        ]
        for line in cases:
            with self.subTest(line=line):
                self.assertEqual(scan_secrets.scan_text(line, "t.yaml"), [])

    def test_prose_with_key_words_does_not_fire(self):
        # Spaces are not in the value charset, so human sentences are safe.
        cases = [
            "The secret password is very long and quite descriptive here\n",
            "rotate the token: then restart every affected service\n",
        ]
        for line in cases:
            with self.subTest(line=line):
                self.assertEqual(scan_secrets.scan_text(line, "doc.md"), [])

    def test_long_pathlike_unquoted_value_fires(self):
        # Charset deliberately includes . / + = so base64/JWT-ish values
        # and long paths assigned to secret-ish keys are caught.
        findings = scan_secrets.scan_text(
            "api_key=abcDEFG123456789+/==.xz\n", ".env")
        self.assertEqual([f[2] for f in findings],
                         ["GENERIC_SECRET_ASSIGNMENT_UNQUOTED"])


class AllowlistTestCase(unittest.TestCase):
    """The allowlist suppresses exactly what it justifies, nothing else."""

    FIXTURE_TEXT = 'STATE_SECRET = "I was charged twice on my invoice."\n'
    FIXTURE_PATH = "apps/api/tests/unit/test_execution_completion_logging.py"

    def test_allowlisted_fixture_passes(self):
        self.assertEqual(scan_secrets.scan_text(self.FIXTURE_TEXT, self.FIXTURE_PATH), [])

    def test_same_content_elsewhere_still_fires(self):
        findings = scan_secrets.scan_text(self.FIXTURE_TEXT, "some/other/file.py")
        self.assertEqual([f[2] for f in findings], ["GENERIC_SECRET_ASSIGNMENT"])

    def test_allowlist_entries_have_justifications(self):
        for pattern, reason in scan_secrets.ALLOWLIST:
            self.assertTrue(reason.strip(), f"entry {pattern.pattern!r} lacks a reason")


class RedactionTestCase(unittest.TestCase):
    def test_redact_truncates_to_eight_chars(self):
        self.assertEqual(scan_secrets.redact("SECRET = \"super-secret-value-123456\""), "SECRET =…")

    def test_redact_keeps_short_strings(self):
        self.assertEqual(scan_secrets.redact("short"), "short")

    def test_finding_lines_never_contain_full_secret(self):
        findings = scan_secrets.scan_text('api_key = "abcdefghijklmnopqrstuvwxyz"', "t.py")
        rendered = scan_secrets.format_finding(findings[0])
        self.assertIn("api_key", rendered)
        self.assertNotIn("abcdefghijklmnop", rendered)


class ScannableFileTestCase(unittest.TestCase):
    """File-level decision logic exercised on a temp tree, no git involved."""

    def test_binary_suffixes_are_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            png = Path(tmp) / "logo.png"
            png.write_text('api_key = "abcdefghijklmnopqrstuvwxyz"')
            self.assertFalse(scan_secrets.is_scannable(png))
            self.assertIsNone(scan_secrets.scan_file(png))

    def test_lock_files_are_scannable(self):
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "package-lock.json"
            lock.write_text("{}")
            self.assertTrue(scan_secrets.is_scannable(lock))

    def test_oversize_files_are_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            big = Path(tmp) / "big.txt"
            big.write_text("a" * (scan_secrets.MAX_FILE_BYTES + 1))
            self.assertFalse(scan_secrets.is_scannable(big))
            self.assertIsNone(scan_secrets.scan_file(big))

    def test_compiled_pyc_files_are_skipped(self):
        # E4: .pyc is in BINARY_SUFFIXES so stray compiled bytecode can
        # never become a candidate even if it somehow escapes .gitignore.
        with tempfile.TemporaryDirectory() as tmp:
            pyc = Path(tmp) / "test_scan_secrets.cpython-313.pyc"
            pyc.write_text('api_key = "abcdefghijklmnopqrstuvwxyz"')
            self.assertFalse(scan_secrets.is_scannable(pyc))
            self.assertIsNone(scan_secrets.scan_file(pyc))

    def test_fake_tree_scan_without_git(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "clean.txt").write_text("just normal words\n")
            (tmp_path / "dirty.txt").write_text('api_key = "abcdefghijklmnopqrstuvwxyz"\n')
            (tmp_path / "pic.png").write_text('api_key = "abcdefghijklmnopqrstuvwxyz"')
            results = {}
            for path in sorted(p for p in tmp_path.iterdir() if p.is_file()):
                results[path.name] = scan_secrets.scan_file(path)
            self.assertEqual(results["clean.txt"], [])
            self.assertIsNone(results["pic.png"])
            dirty = results["dirty.txt"]
            self.assertEqual(len(dirty), 1)
            self.assertEqual(dirty[0][2], "GENERIC_SECRET_ASSIGNMENT")


class RepoRootTestCase(unittest.TestCase):
    def test_repo_root_is_the_git_root_above_the_script(self):
        root = scan_secrets.find_repo_root()
        self.assertTrue((root / ".git").exists())
        self.assertTrue((root / "Makefile").exists())


class ExitCodesTestCase(unittest.TestCase):
    def test_non_git_root_is_operational_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = scan_secrets.main(["--root", tmp])
        self.assertEqual(code, 2)


def _git_available() -> bool:
    try:
        subprocess.run(["git", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@unittest.skipUnless(_git_available(), "git is not on PATH")
class TempGitRepoTestCase(unittest.TestCase):
    """Integration: run main() against a real temp git repository."""

    def _run_git(self, *args, cwd):
        proc = subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t",
             "-c", "commit.gpgsign=false", *args],
            cwd=str(cwd), capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def _make_repo(self, files):
        holder = tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        root = Path(holder.name)
        self._run_git("init", cwd=root)
        for name, content in files.items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        self._run_git("add", "-A", cwd=root)
        self._run_git("commit", "-m", "init", cwd=root)
        return root

    def test_dirty_repo_exits_one(self):
        root = self._make_repo({
            "dirty.py": 'token = "abcdefghijklmnopqrstuvwxyz012345"\n',
            "clean.py": "print('hi')\n",
        })
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = scan_secrets.main(["--root", str(root)])
        self.assertEqual(code, 1)
        self.assertIn("dirty.py:1: GENERIC_SECRET_ASSIGNMENT", out.getvalue())
        # The full secret value must never be printed.
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", out.getvalue())

    def test_clean_repo_exits_zero(self):
        root = self._make_repo({"ok.py": "print('hi')\n"})
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = scan_secrets.main(["--root", str(root)])
        self.assertEqual(code, 0)
        self.assertIn("clean: 1 files scanned, 0 findings", out.getvalue())

    def test_untracked_dirty_file_is_found(self):
        # E2: candidates are the working tree minus ignored files, so a
        # brand-new (never committed) file must be audited too.
        root = self._make_repo({"ok.py": "print('hi')\n"})
        (root / "fresh.py").write_text("SERVICE_SECRET=correct-horse-battery-staple\n")
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = scan_secrets.main(["--root", str(root)])
        self.assertEqual(code, 1)
        self.assertIn("fresh.py:1: GENERIC_SECRET_ASSIGNMENT_UNQUOTED",
                      out.getvalue())

    def test_gitignored_files_are_not_candidates(self):
        # Ignored paths (.gitignore rules) stay out of the candidate set.
        root = self._make_repo({
            "ok.py": "print('hi')\n",
            ".gitignore": "ignored/\n",
        })
        ignored_dir = root / "ignored"
        ignored_dir.mkdir()
        (ignored_dir / "dirty.py").write_text(
            'token = "abcdefghijklmnopqrstuvwxyz012345"\n')
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = scan_secrets.main(["--root", str(root)])
        self.assertEqual(code, 0)
        self.assertNotIn("dirty.py", out.getvalue())

    def test_skip_summary_printed_on_clean_path(self):
        # E3: silent skip lanes must be visible; the skip line shares the
        # stream of the clean summary (stdout).
        root = self._make_repo({"ok.py": "print('hi')\n"})
        (root / "logo.png").write_text('api_key = "abcdefghijklmnopqrstuvwxyz"')
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = scan_secrets.main(["--root", str(root)])
        self.assertEqual(code, 0)
        self.assertIn("clean: 1 files scanned, 0 findings", out.getvalue())
        self.assertIn("skipped 1 files (binary/oversize)", out.getvalue())

    def test_skip_summary_printed_on_findings_path(self):
        # E3: findings go to stdout, the counters to stderr; the skip line
        # follows the findings-path counters on stderr.
        root = self._make_repo({
            "dirty.py": 'token = "abcdefghijklmnopqrstuvwxyz012345"\n',
        })
        (root / "logo.png").write_text('api_key = "abcdefghijklmnopqrstuvwxyz"')
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = scan_secrets.main(["--root", str(root)])
        self.assertEqual(code, 1)
        self.assertIn("1 files scanned, 1 findings", err.getvalue())
        self.assertIn("skipped 1 files (binary/oversize)", err.getvalue())


if __name__ == "__main__":
    unittest.main()

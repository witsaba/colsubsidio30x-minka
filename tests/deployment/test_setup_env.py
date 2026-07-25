"""`scripts/setup-env.sh` builds the single root `.env` (REQ-UCD-10).

The script is the only supported way to produce a `.env`, so these tests treat
it as an interface: what it asks, what it writes, what it refuses to print, and
what it does to answers that are already there. Every run here targets a
temporary env file, so the developer's real `.env` is never touched.
"""

from __future__ import annotations

import os
import re
import stat
import subprocess
from pathlib import Path

import pytest

from .compose_text import (
    ENV_EXAMPLE_PATH,
    SECRET_NAME,
    SETUP_SCRIPT_PATH,
    env_example_entries,
)

#: Recognisable enough that finding it in stdout is unambiguous, shaped like a
#: real key so nothing can dismiss it as "obviously a placeholder".
SENTINEL_SECRET = "dg-live-SENTINEL0123456789abcdefXYZ"


def run_setup(
    *args: str,
    stdin: str = "",
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    environment = {**os.environ, **(env or {})}
    return subprocess.run(
        ["bash", str(SETUP_SCRIPT_PATH), *args],
        input=stdin,
        capture_output=True,
        text=True,
        env=environment,
        cwd=SETUP_SCRIPT_PATH.parent.parent,
    )


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if match := re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line.strip()):
            values[match.group(1)] = match.group(2)
    return values


@pytest.fixture
def env_path(tmp_path: Path) -> Path:
    return tmp_path / ".env"


def test_the_script_is_executable() -> None:
    assert SETUP_SCRIPT_PATH.is_file(), f"missing {SETUP_SCRIPT_PATH}"
    mode = SETUP_SCRIPT_PATH.stat().st_mode
    assert mode & stat.S_IXUSR, "setup-env.sh must be executable"


class TestNonInteractive:
    """`--defaults` is what a fresh clone, a CI job or a test harness runs."""

    def test_writes_every_documented_variable(self, env_path: Path) -> None:
        result = run_setup("--defaults", "--env-file", str(env_path))
        assert result.returncode == 0, result.stderr
        written = parse_env(env_path)
        documented = env_example_entries(
            ENV_EXAMPLE_PATH.read_text(encoding="utf-8")
        )
        assert set(written) == set(documented)

    def test_carries_the_template_defaults_through(self, env_path: Path) -> None:
        run_setup("--defaults", "--env-file", str(env_path))
        written = parse_env(env_path)
        documented = env_example_entries(
            ENV_EXAMPLE_PATH.read_text(encoding="utf-8")
        )
        assert written == documented

    def test_asks_nothing(self, env_path: Path) -> None:
        """No prompt may block a non-interactive run waiting on stdin."""
        result = run_setup("--defaults", "--env-file", str(env_path), stdin="")
        assert result.returncode == 0, result.stderr

    def test_takes_a_value_from_the_environment(self, env_path: Path) -> None:
        """So CI can inject a secret without a terminal."""
        run_setup(
            "--defaults",
            "--env-file",
            str(env_path),
            env={"DEEPGRAM_API_KEY": SENTINEL_SECRET},
        )
        assert parse_env(env_path)["DEEPGRAM_API_KEY"] == SENTINEL_SECRET


class TestInteractivePrompts:
    """One question per variable, in template order, with its help text."""

    def answers(self, *values: str) -> str:
        documented = env_example_entries(
            ENV_EXAMPLE_PATH.read_text(encoding="utf-8")
        )
        given = list(values) + [""] * (len(documented) - len(values))
        return "".join(f"{value}\n" for value in given)

    def test_asks_for_every_variable_by_name(self, env_path: Path) -> None:
        result = run_setup("--env-file", str(env_path), stdin=self.answers())
        assert result.returncode == 0, result.stderr
        for name in env_example_entries(
            ENV_EXAMPLE_PATH.read_text(encoding="utf-8")
        ):
            assert name in result.stdout, f"never asked about {name}"

    def test_shows_the_help_text_from_the_template(self, env_path: Path) -> None:
        result = run_setup("--env-file", str(env_path), stdin=self.answers())
        assert "Deepgram API key" in result.stdout

    def test_an_empty_answer_keeps_the_default(self, env_path: Path) -> None:
        run_setup("--env-file", str(env_path), stdin=self.answers())
        assert parse_env(env_path)["STT_VENDOR"] == "deepgram"

    def test_an_answer_replaces_the_default(self, env_path: Path) -> None:
        run_setup(
            "--env-file",
            str(env_path),
            stdin=self.answers(SENTINEL_SECRET),
        )
        assert parse_env(env_path)["DEEPGRAM_API_KEY"] == SENTINEL_SECRET

    def test_never_echoes_a_secret_it_was_given(self, env_path: Path) -> None:
        """A key pasted into a terminal must not survive in the scrollback."""
        result = run_setup(
            "--env-file",
            str(env_path),
            stdin=self.answers(SENTINEL_SECRET),
        )
        assert SENTINEL_SECRET not in result.stdout
        assert SENTINEL_SECRET not in result.stderr

    def test_confirms_a_secret_was_captured_without_revealing_it(
        self, env_path: Path
    ) -> None:
        result = run_setup(
            "--env-file",
            str(env_path),
            stdin=self.answers(SENTINEL_SECRET),
        )
        assert re.search(r"\*{3,}", result.stdout), (
            "a secret answer must be acknowledged, masked"
        )

    def test_secret_prompts_do_not_print_the_stored_value(
        self, env_path: Path
    ) -> None:
        """Re-running over an existing .env must not leak what is in it."""
        run_setup(
            "--env-file", str(env_path), stdin=self.answers(SENTINEL_SECRET)
        )
        result = run_setup("--env-file", str(env_path), stdin=self.answers())
        assert SENTINEL_SECRET not in result.stdout


class TestRerun:
    """Running it again is how an operator changes one answer."""

    def test_keeps_the_answers_already_given(self, env_path: Path) -> None:
        run_setup(
            "--defaults",
            "--env-file",
            str(env_path),
            env={"DEEPGRAM_API_KEY": SENTINEL_SECRET},
        )
        run_setup("--defaults", "--env-file", str(env_path))
        assert parse_env(env_path)["DEEPGRAM_API_KEY"] == SENTINEL_SECRET

    def test_adds_a_variable_a_new_service_introduced(
        self, env_path: Path, tmp_path: Path
    ) -> None:
        run_setup("--defaults", "--env-file", str(env_path))
        extended = tmp_path / "extended.example"
        extended.write_text(
            ENV_EXAMPLE_PATH.read_text(encoding="utf-8")
            + "\n# Port the frontend listens on.\nFRONTEND_PORT=3000\n",
            encoding="utf-8",
        )
        result = run_setup(
            "--defaults",
            "--env-file",
            str(env_path),
            "--template",
            str(extended),
        )
        assert result.returncode == 0, result.stderr
        assert parse_env(env_path)["FRONTEND_PORT"] == "3000"

    def test_drops_a_variable_the_template_no_longer_documents(
        self, env_path: Path, tmp_path: Path
    ) -> None:
        env_path.write_text("GONE_VARIABLE=1\n", encoding="utf-8")
        run_setup("--defaults", "--env-file", str(env_path))
        assert "GONE_VARIABLE" not in parse_env(env_path)

    def test_backs_up_the_previous_file(self, env_path: Path) -> None:
        run_setup(
            "--defaults",
            "--env-file",
            str(env_path),
            env={"DEEPGRAM_API_KEY": SENTINEL_SECRET},
        )
        run_setup("--defaults", "--env-file", str(env_path))
        backups = list(env_path.parent.glob(".env.bak*"))
        assert backups, "the previous .env must be recoverable"


class TestFileSafety:
    def test_the_written_file_is_not_world_readable(self, env_path: Path) -> None:
        run_setup("--defaults", "--env-file", str(env_path))
        mode = stat.S_IMODE(env_path.stat().st_mode)
        assert mode & (stat.S_IRWXG | stat.S_IRWXO) == 0, oct(mode)

    def test_a_missing_template_fails_loudly(
        self, env_path: Path, tmp_path: Path
    ) -> None:
        result = run_setup(
            "--defaults",
            "--env-file",
            str(env_path),
            "--template",
            str(tmp_path / "absent.example"),
        )
        assert result.returncode != 0
        assert "absent.example" in result.stderr

    def test_an_unknown_flag_fails_loudly(self, env_path: Path) -> None:
        result = run_setup("--defaults", "--env-file", str(env_path), "--wat")
        assert result.returncode != 0
        assert "--wat" in result.stderr


class TestReadiness:
    """The script's other job: say whether the stack will actually come up."""

    def test_warns_when_the_active_vendor_key_is_missing(
        self, env_path: Path
    ) -> None:
        result = run_setup("--defaults", "--env-file", str(env_path))
        combined = result.stdout + result.stderr
        assert "DEEPGRAM_API_KEY" in combined
        assert re.search(r"(?i)stt.*(will not|won't|cannot|fail)", combined), (
            "an operator must learn that stt cannot boot before they run up"
        )

    def test_is_quiet_when_the_active_vendor_key_is_present(
        self, env_path: Path
    ) -> None:
        result = run_setup(
            "--defaults",
            "--env-file",
            str(env_path),
            env={"DEEPGRAM_API_KEY": SENTINEL_SECRET},
        )
        combined = result.stdout + result.stderr
        assert not re.search(r"(?i)will not|won't boot", combined)

    def test_reads_the_active_vendor_rather_than_assuming_deepgram(
        self, env_path: Path
    ) -> None:
        result = run_setup(
            "--defaults",
            "--env-file",
            str(env_path),
            env={"STT_VENDOR": "groq", "GROQ_API_KEY": SENTINEL_SECRET},
        )
        combined = result.stdout + result.stderr
        assert not re.search(r"(?i)will not|won't boot", combined)

    def test_every_secret_named_in_the_template_is_treated_as_one(self) -> None:
        """Regression guard: the script's masking is name-driven, so a new
        credential must be caught by the same convention the tests use."""
        script = SETUP_SCRIPT_PATH.read_text(encoding="utf-8")
        assert "_API_KEY" in script and "_TOKEN" in script and "_SECRET" in script
        documented = env_example_entries(
            ENV_EXAMPLE_PATH.read_text(encoding="utf-8")
        )
        assert any(SECRET_NAME.search(name) for name in documented)

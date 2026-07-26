"""Benchmark artifacts helpers (REQ-BMK-11, REQ-BMK-12).

This suite covers:

* Threat-matrix tests for ``git -C <repo> check-ignore`` (Task 2.2, RED).
* Atomic write / fingerprint contracts (Task 2.3, RED).
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

# RED import surface: ``benchmarks.artifacts`` must provide these symbols.
from benchmarks import artifacts  # noqa: E402,F401
from benchmarks.artifacts import (  # noqa: E402,F401
    atomic_write_text,
    assert_path_ignored,
    config_fingerprint,
)


# --- helpers ----------------------------------------------------------------


def _init_git_repo(repo_root: Path) -> None:
    """Create a real git repo so ``git -C`` returns deterministic codes."""
    repo_root.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "-C", str(repo_root), "init", "--quiet"], check=True
    )
    subprocess.run(
        ["git", "-C", str(repo_root), "config", "user.email", "x@x"],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(repo_root), "config", "user.name", "x"],
        check=True,
        capture_output=True,
    )


# --- threat-matrix: git check-ignore (Task 2.2 RED) ------------------------


def test_absolute_path_under_ignored_root_passes(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    _init_git_repo(repo_root)
    (repo_root / ".gitignore").write_text("BD_Pruebas/\n", encoding="utf-8")
    bd = repo_root / "BD_Pruebas"
    bd.mkdir()
    (bd / "results.json").write_text("{}", encoding="utf-8")
    inside = repo_root / "BD_Pruebas" / "results.json"
    assert_path_ignored(inside, repo_root)


def test_absolute_path_outside_ignored_root_raises(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    _init_git_repo(repo_root)
    (repo_root / ".gitignore").write_text("BD_Pruebas/\n", encoding="utf-8")
    stray = tmp_path / "results.json"
    stray.write_text("{}", encoding="utf-8")
    with pytest.raises(RuntimeError):
        assert_path_ignored(stray, repo_root)


def test_relative_path_is_resolved_against_repo_root(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    _init_git_repo(repo_root)
    (repo_root / ".gitignore").write_text("BD_Pruebas/\n", encoding="utf-8")
    bd = repo_root / "BD_Pruebas"
    bd.mkdir()
    (bd / "results.json").write_text("{}", encoding="utf-8")
    # The caller is "inside" the repo root (the directory holding
    # ``.gitignore``); relative paths resolve against that anchor.
    assert_path_ignored(
        Path("BD_Pruebas/results.json"), repo_root, cwd=repo_root
    )


def test_path_outside_the_repo_is_rejected(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    _init_git_repo(repo_root)
    (repo_root / ".gitignore").write_text("BD_Pruebas/\n", encoding="utf-8")
    stray = tmp_path / "outside.json"
    stray.write_text("{}", encoding="utf-8")
    with pytest.raises(RuntimeError):
        assert_path_ignored(stray, repo_root)


def test_git_failure_aborts(monkeypatch, tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    _init_git_repo(repo_root)
    (repo_root / ".gitignore").write_text("BD_Pruebas/\n", encoding="utf-8")
    bd = repo_root / "BD_Pruebas"
    bd.mkdir()
    (bd / "results.json").write_text("{}", encoding="utf-8")

    def _raise(*args, **kwargs):
        raise RuntimeError("simulated git timeout")

    monkeypatch.setattr("subprocess.run", _raise)
    with pytest.raises(RuntimeError):
        assert_path_ignored(repo_root / "BD_Pruebas" / "results.json", repo_root)


def test_check_ignore_does_not_invoke_shell(monkeypatch, tmp_path: Path) -> None:
    """The guard MUST call ``git`` via ``subprocess.run`` with a list argv."""
    repo_root = tmp_path / "repo"
    _init_git_repo(repo_root)
    (repo_root / ".gitignore").write_text("BD_Pruebas/\n", encoding="utf-8")
    bd = repo_root / "BD_Pruebas"
    bd.mkdir()
    (bd / "results.json").write_text("{}", encoding="utf-8")
    captured: dict = {}

    def _fake_run(*args, **kwargs):
        captured["args"] = args[0]
        captured["shell"] = kwargs.get("shell")
        return subprocess.CompletedProcess(
            args=args[0], returncode=0, stdout="", stderr=""
        )

    monkeypatch.setattr("subprocess.run", _fake_run)
    assert_path_ignored(repo_root / "BD_Pruebas" / "results.json", repo_root)
    assert captured["shell"] in (None, False)
    assert isinstance(captured["args"], list)
    assert captured["args"][0] == "git"
    assert "--" in captured["args"]


def test_unignored_absolute_path_aborts(tmp_path: Path) -> None:
    """If git says the path is NOT ignored, the guard refuses the write."""
    repo_root = tmp_path / "repo"
    _init_git_repo(repo_root)
    stray = repo_root / "results.json"
    stray.write_text("{}", encoding="utf-8")
    with pytest.raises(RuntimeError):
        assert_path_ignored(stray, repo_root)


# --- atomic writes (Task 2.2 / 2.3 contract) -------------------------------


def test_atomic_write_text_uses_replace_strategy(tmp_path: Path) -> None:
    target = tmp_path / "out.json"
    atomic_write_text(target, "v1")
    assert target.read_text(encoding="utf-8") == "v1"
    atomic_write_text(target, "v2")
    assert target.read_text(encoding="utf-8") == "v2"


def test_atomic_write_text_replaces_partial_state(tmp_path: Path) -> None:
    target = tmp_path / "out.json"
    target.write_text("stale", encoding="utf-8")
    atomic_write_text(target, "fresh")
    assert target.read_text(encoding="utf-8") == "fresh"
    leftovers = list(tmp_path.glob("out.json.*"))
    assert not leftovers


# --- config fingerprint (Task 2.3 RED) -------------------------------------


def test_config_fingerprint_is_a_64_char_hex_hash() -> None:
    fingerprint = config_fingerprint(
        corpus_path=Path("BD_Pruebas"),
        base_url="http://localhost:8001",
        concurrency=4,
        normalizer_version="stt-es-v1",
    )
    assert isinstance(fingerprint, str)
    assert len(fingerprint) == 64
    assert all(c in "0123456789abcdef" for c in fingerprint)


def test_config_fingerprint_changes_with_settings() -> None:
    base = config_fingerprint(
        corpus_path=Path("c"),
        base_url="http://x:1",
        concurrency=4,
        normalizer_version="stt-es-v1",
    )
    changed_concurrency = config_fingerprint(
        corpus_path=Path("c"),
        base_url="http://x:1",
        concurrency=2,
        normalizer_version="stt-es-v1",
    )
    changed_corpus = config_fingerprint(
        corpus_path=Path("c2"),
        base_url="http://x:1",
        concurrency=4,
        normalizer_version="stt-es-v1",
    )
    changed_version = config_fingerprint(
        corpus_path=Path("c"),
        base_url="http://x:1",
        concurrency=4,
        normalizer_version="stt-es-v2",
    )
    assert base != changed_concurrency
    assert base != changed_corpus
    assert base != changed_version


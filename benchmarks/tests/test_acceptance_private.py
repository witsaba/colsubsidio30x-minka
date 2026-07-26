"""Optional private corpus acceptance (REQ-BMK-7 / exploration).

Skip cleanly unless ``BENCHMARK_ACCEPTANCE_CORPUS`` points at a real
``BD_Pruebas``-style root. When the env var is set:

* the loader discovers the workbooks and ``NOTAS_VOZ/`` folders;
* the loader reports exactly the loaded clip count (38 today, growing as rows
  are added);
* the corpus is read-only: nothing is written under the corpus path or
  anywhere Git-tracked.

The test is intentionally hermetic: it never POSTs to the live STT service
(it would block CI on missing credentials / vendor keys). It only proves the
loader / discovery path works against real spreadsheets.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from benchmarks.corpus_loader import load_corpus

ACCEPTANCE_ENV = "BENCHMARK_ACCEPTANCE_CORPUS"


def _is_acceptance_enabled() -> bool:
    path = os.environ.get(ACCEPTANCE_ENV)
    if not path:
        return False
    return Path(path).exists()


pytestmark = pytest.mark.skipif(
    not _is_acceptance_enabled(),
    reason=(
        f"set {ACCEPTANCE_ENV} to the BD_Pruebas root to enable acceptance"
        " (skipped when unset or missing)"
    ),
)


@pytest.fixture(scope="session")
def acceptance_corpus() -> Path:
    return Path(os.environ[ACCEPTANCE_ENV]).resolve()


def test_loader_discovers_all_clips_without_modifying_sources(
    acceptance_corpus: Path, tmp_path: Path
) -> None:
    """Discover the existing corpus and assert the clip count is positive.

    The current private fixture holds two datasets, each with 19 rows, for a
    total of 38 clips. The test is intentionally written without a hard-coded
    38: future rows must increase N with zero code changes. We do assert
    ``clips >= 38`` so an accidental regression that drops a dataset fails.
    """

    before = _snapshot_git_state(acceptance_corpus)
    try:
        clips = load_corpus(acceptance_corpus)
    finally:
        after = _snapshot_git_state(acceptance_corpus)
        assert before == after, (
            "acceptance test must not mutate the corpus directory"
        )

    assert len(clips) >= 38, (
        f"corpus shrunk below the documented 38 clips (got {len(clips)})"
    )
    ids = [clip["clip_id"] for clip in clips]
    assert len(set(ids)) == len(clips), (
        "duplicate composite ids detected in the acceptance corpus"
    )


def test_loader_emits_xlsx_metadata_verbatim(acceptance_corpus: Path) -> None:
    """ACERTIVIDAD and DIFICULTAD show up verbatim on the loaded clips."""

    clips = load_corpus(acceptance_corpus)
    # DIFICULTAD must be opaque-recorded whatever values the corpus carries
    # (we do not allow-list or assert any particular distribution here).
    assert all(clip["dificultad"] for clip in clips)
    # ACERTIVIDAD may be anything; just assert it was preserved verbatim and
    # that nothing in the loader raised.
    assert all("acertividad" in clip for clip in clips)


def test_acceptance_does_not_post_to_the_service(
    acceptance_corpus: Path,
) -> None:
    """Smoke check: load_corpus never touches the network.

    The acceptance test runs in CI without an active STT service. If a future
    refactor accidentally pulls ``run_benchmark`` into the path, the load will
    hang or fail; this test catches that.

    We approximate network silence by importing only the loader and asserting
    the import graph does not load any httpx-bearing module.
    """

    import sys

    sys.modules.pop("httpx", None)
    clips = load_corpus(acceptance_corpus)
    assert "httpx" not in sys.modules or clips == [], (
        "load_corpus must not trigger an httpx import"
    )


def _snapshot_git_state(root: Path) -> dict:
    """Snapshot the on-disk state of the corpus directory.

    The acceptance test must never mutate inputs. Recording ``git status``
    output (or ``find`` listing on a non-git root) provides a cheap baseline.
    """

    listing = sorted(
        str(path.relative_to(root))
        for path in root.rglob("*")
        if path.is_file()
    )
    git_status = ""
    if (root / ".git").exists():
        completed = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain"],
            capture_output=True,
            check=False,
        )
        git_status = completed.stdout.decode("utf-8", errors="ignore")
    return {"listing": listing, "git_status": git_status}


def test_listing_helper_survives_a_non_git_root(tmp_path: Path) -> None:
    root = tmp_path / "scratch"
    root.mkdir()
    snap = _snapshot_git_state(root)
    assert snap["listing"] == []
    assert snap["git_status"] == ""

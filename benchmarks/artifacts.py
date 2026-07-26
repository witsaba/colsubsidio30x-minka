"""Benchmark output safety + reproducibility helpers (REQ-BMK-12, REQ-BMK-11).

This module owns the two privacy-critical side effects of the runner:

* Refusal to write transcript-bearing output anywhere that is not under the
  repository-level ignore rules (``benchmarks/.gitignore`` and root
  ``.gitignore``). The guard is fail-closed and shell-free so a quoting bug
  cannot silently turn the check into a directory traversal.
* Atomic, crash-safe writes through ``os.replace`` so a partial run never
  leaves a half-written ``results.json`` that subsequent reporting would
  score as if it were the canonical evidence set.

The ``config_fingerprint`` helper is the only piece of v2 metadata the runner
trusts across re-runs: it is a SHA-256 over the non-secret benchmark settings
(corpus path, base URL, concurrency, normalizer version) so two reporting runs
can detect when their inputs diverged.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Mapping


class OutputPathError(RuntimeError):
    """The supplied output target is not under a git-ignored location."""


def _git_check_ignore(repo_root: Path, target: Path) -> int:
    """Run ``git -C <repo> check-ignore --quiet -- <rel>`` and return its exit code.

    No shell: the argv is a list, ``shell=False`` (default), ``check=False`` so
    we can read the return code without risk of the sandbox swallowing a typo.
    A raised subprocess exception is re-raised as :class:`OutputPathError`
    because the caller treats any non-zero / failed invocation as fatal.
    """

    args = [
        "git",
        "-C",
        str(repo_root),
        "check-ignore",
        "--quiet",
        "--",
        str(target),
    ]
    try:
        completed = subprocess.run(args, capture_output=True, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise OutputPathError(
            f"git check-ignore could not be executed: {exc}"
        ) from exc
    return completed.returncode


def assert_path_ignored(
    target: Path,
    repo_root: Path,
    *,
    cwd: Path | None = None,
) -> Path:
    """Ensure ``target`` is covered by ``.gitignore`` rules under ``repo_root``.

    The target path may be absolute or relative; a relative path is resolved
    against ``cwd`` first (defaulting to the current working directory). After
    resolution the path MUST live below ``repo_root`` — escape attempts fail
    closed before any subprocess is spawned.

    Returns the resolved absolute path on success. Raises
    :class:`OutputPathError` when:

    * the resolved path escapes the repo;
    * ``git`` says the path is not ignored (returncode 1);
    * ``git`` itself fails with a non-zero exit code other than 0/1 (sandbox
      issues, missing VCS configuration).
    """

    repo_root = Path(repo_root).resolve()
    if not repo_root.exists():
        raise OutputPathError(f"repo_root does not exist: {repo_root}")

    if not Path(target).is_absolute():
        anchor = Path(cwd) if cwd else Path.cwd()
        target = (anchor / target).resolve()
    else:
        target = Path(target).resolve()

    try:
        target.relative_to(repo_root)
    except ValueError:
        raise OutputPathError(
            f"output target escapes the repo: {target} is outside {repo_root}"
        ) from None

    exit_code = _git_check_ignore(repo_root, target)
    if exit_code == 0:
        return target
    if exit_code == 1:
        raise OutputPathError(
            f"output target is not gitignored: {target} (run "
            f"`git -C {repo_root} check-ignore -- {target}` to inspect)"
        )
    raise OutputPathError(
        f"git check-ignore failed with exit code {exit_code} for {target}"
    )


def atomic_write_text(target: Path, content: str) -> None:
    """Write ``content`` to ``target`` atomically through ``os.replace``.

    The replacement is the canonical POSIX "write to temp + rename" idiom: a
    partially-written file can never be observed as the canonical target. The
    sibling ``.tmp`` file is unlinked in the happy path; a raised exception
    during the write leaves the target untouched.
    """

    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    try:
        with tmp.open("w", encoding="utf-8") as handle:
            handle.write(content)
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def config_fingerprint(
    *,
    corpus_path: Path | str,
    base_url: str,
    concurrency: int,
    normalizer_version: str,
) -> str:
    """Stable SHA-256 over the non-secret benchmark settings.

    Two runs whose inputs differ in any of ``corpus_path``/``base_url``/
    ``concurrency``/``normalizer_version`` produce different fingerprints; two
    runs whose inputs match exactly reproduce the same fingerprint byte-for-
    byte. Vendor secrets, audio bytes, and per-clip labels MUST never be
    included here.
    """

    payload = {
        "corpus_path": str(Path(corpus_path).resolve())
        if Path(corpus_path).exists()
        else str(corpus_path),
        "base_url": base_url,
        "concurrency": int(concurrency),
        "normalizer_version": normalizer_version,
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode(
        "utf-8"
    )
    return hashlib.sha256(encoded).hexdigest()


def relative_under(target: Path, root: Path) -> str:
    """Return the posix-relative path of ``target`` under ``root``.

    Raises :class:`OutputPathError` when ``target`` does not live below
    ``root`` — used by the runner to render a safe ``--output`` even when the
    caller supplied an absolute ignored path.
    """

    target = Path(target).resolve()
    root = Path(root).resolve()
    try:
        return target.relative_to(root).as_posix()
    except ValueError:
        raise OutputPathError(
            f"target {target} is not under repo root {root}"
        ) from None


def fingerprint_settings(settings: Mapping[str, object]) -> str:
    """Helper that hashes an arbitrary settings mapping (debug / inspect)."""

    encoded = json.dumps(
        dict(settings), sort_keys=True, ensure_ascii=False, default=str
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()

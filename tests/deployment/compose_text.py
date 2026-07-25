"""Minimal text helpers for reading the root Compose file.

PyYAML is not a project dependency, and adding one only to read a file we
already own would break the "no dependency without a measured need" rule the
services follow. The *parsed* contract is asserted in `test_compose_config.py`
through `docker compose config`, which is the authority on how Compose reads
the file; everything here is deliberately about the committed text.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_PATH = REPO_ROOT / "docker-compose.yml"
ENV_EXAMPLE_PATH = REPO_ROOT / ".env.example"
SETUP_SCRIPT_PATH = REPO_ROOT / "scripts" / "setup-env.sh"

#: A variable whose *value* must never be committed. Any new service adding a
#: credential inherits the guard by naming it conventionally.
SECRET_NAME = re.compile(r"(_API_KEY|_SECRET|_TOKEN|_PASSWORD|_KEY)$")

#: `${NAME}`, `${NAME:-default}`, `${NAME-default}`.
INTERPOLATION = re.compile(r"\$\{([A-Z][A-Z0-9_]*)(?::?-[^}]*)?\}")


def service_blocks(compose_text: str) -> dict[str, str]:
    """Split the top-level `services:` mapping into `{name: block_text}`.

    Relies only on indentation, which Compose files must respect anyway: a
    service key sits at two spaces, its body deeper than that.
    """
    lines = compose_text.splitlines()
    try:
        start = next(
            index
            for index, line in enumerate(lines)
            if line.rstrip() == "services:"
        )
    except StopIteration:  # pragma: no cover - guarded by its own test
        return {}

    blocks: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines[start + 1 :]:
        if line.strip() and not line.startswith(" "):
            break  # back to a top-level key: the services mapping ended
        match = re.fullmatch(r"  ([A-Za-z0-9_-]+):\s*", line.rstrip())
        if match:
            current = match.group(1)
            blocks[current] = []
        elif current is not None:
            blocks[current].append(line)
    return {name: "\n".join(body) for name, body in blocks.items()}


def host_ports(block: str) -> list[str]:
    """Published host ports of one service block, as written."""
    return re.findall(r'^\s*-\s*"?(\d+):\d+"?\s*$', block, flags=re.MULTILINE)


def env_example_entries(text: str) -> dict[str, str]:
    """`{NAME: default}` for every assignment in a dotenv-style template."""
    entries: dict[str, str] = {}
    for line in text.splitlines():
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line.strip())
        if match:
            entries[match.group(1)] = match.group(2)
    return entries


def env_example_help(text: str) -> dict[str, str]:
    """`{NAME: comment}` — the comment block directly above each assignment.

    This is what `scripts/setup-env.sh` reads back to the operator, so an
    undocumented variable is a prompt with no question in it.
    """
    help_text: dict[str, str] = {}
    pending: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            pending.append(stripped.lstrip("#").strip())
        elif match := re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", stripped):
            help_text[match.group(1)] = " ".join(p for p in pending if p)
            pending = []
        else:
            pending = []
    return help_text

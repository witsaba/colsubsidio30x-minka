"""The root Compose file is the project's only deployment surface.

Covers REQ-UCD-1 (sole canonical surface), REQ-UCD-3 (preserved per-service
contracts), REQ-UCD-4 (no cross-service ordering), REQ-UCD-5 (secret-safe env
workflow), REQ-UCD-8 (service-local files removed) and REQ-UCD-9 (the checklist
every future service must satisfy).

These run without a Docker daemon on purpose: they are the guarantee that
survives in CI, where no daemon exists.
"""

from __future__ import annotations

import re
import subprocess

import pytest

from .compose_text import (
    COMPOSE_PATH,
    ENV_EXAMPLE_PATH,
    INTERPOLATION,
    REPO_ROOT,
    SECRET_NAME,
    env_example_entries,
    env_example_help,
    host_ports,
    service_blocks,
)

#: Ports already taken. A new service colliding with one of these would make
#: `docker compose up` fail at bind time, long after review.
RESERVED_PORTS = {
    "8001": "stt",
    "8002": "matcher",
    "8003": "product_identification",
    # Not the next sequential port on purpose: 4321 is Astro's own default and
    # is already written into frontend/README.md, the frontend's tests and the
    # manual verification steps. Renumbering it would silently break all three.
    "4321": "frontend",
}

#: Every service the root file is expected to define. Spelled out rather than
#: read back from the file, so *forgetting* to add one here is what fails.
#: `redis` publishes no port, so it is absent from EXPECTED_PORTS above; it is
#: still a service the file must define.
EXPECTED_SERVICES = {
    "stt",
    "matcher",
    "product_identification",
    "frontend",
    "redis",
}

#: A value that looks like a real credential rather than a placeholder: a long
#: unbroken run of key-ish characters.
CREDENTIAL_SHAPED = re.compile(r"[A-Za-z0-9_\-]{24,}")

#: `image: name:tag`. The tag is mandatory and `latest` is not a tag: an
#: unpinned upstream image makes the same commit deploy different bytes.
PINNED_IMAGE = re.compile(r"^\s+image:\s+(\S+):(?!latest\s*$)([\w.\-]+)\s*$", re.MULTILINE)


def is_image_pinned_infrastructure(block: str) -> bool:
    """Backing services we run rather than build (Redis, and whatever follows).

    The per-service checklist of REQ-UCD-9 was written for the HTTP services
    this repository *builds*: an explicit build context, and a probe against its
    own `GET /health`. A pinned upstream image satisfies the same two intents by
    other means — reproducible bytes come from the tag instead of the context,
    and liveness comes from the image's own CLI instead of an HTTP endpoint it
    does not serve. The exemption is deliberately narrow: it applies only when
    the service declares no `build:` at all and pins an explicit, non-`latest`
    tag, so it can never be used to smuggle an unpinned or half-built service
    past the checklist.
    """
    return "build:" not in block and bool(PINNED_IMAGE.search(block))


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.splitlines()


@pytest.fixture(scope="module")
def compose() -> str:
    assert COMPOSE_PATH.is_file(), f"missing {COMPOSE_PATH}"
    return COMPOSE_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def env_example() -> str:
    assert ENV_EXAMPLE_PATH.is_file(), f"missing {ENV_EXAMPLE_PATH}"
    return ENV_EXAMPLE_PATH.read_text(encoding="utf-8")


class TestSoleSurface:
    """REQ-UCD-1 / REQ-UCD-8: one Compose file, and it is at the root."""

    def test_exactly_one_compose_file_is_tracked(self) -> None:
        found = [
            path
            for path in tracked_files()
            if re.fullmatch(
                r"(.*/)?(docker-)?compose(\.[\w-]+)?\.ya?ml", path
            )
        ]
        assert found == ["docker-compose.yml"], (
            "the root file is the only deployment surface; "
            f"also found {[p for p in found if p != 'docker-compose.yml']}"
        )

    def test_no_compose_file_survives_under_services(self) -> None:
        leftovers = [path for path in tracked_files() if path.startswith("services/")
                     and re.search(r"(docker-)?compose(\.[\w-]+)?\.ya?ml$", path)]
        assert leftovers == [], leftovers

    def test_the_root_file_defines_every_service(self, compose: str) -> None:
        assert set(service_blocks(compose)) == EXPECTED_SERVICES

    def test_the_project_name_is_pinned(self, compose: str) -> None:
        """Otherwise Compose names the project after the directory, and the
        same stack started from a git worktree becomes a second set of
        containers fighting over the same host ports."""
        assert re.search(r"^name:\s+\S+", compose, re.MULTILINE)

    def test_operator_docs_never_point_at_a_service_local_compose(self) -> None:
        offenders = []
        for path in tracked_files():
            if not path.endswith((".md", ".yaml", ".yml")):
                continue
            if path.startswith("openspec/changes/"):
                continue  # historical SDD records, not operator instructions
            text = (REPO_ROOT / path).read_text(encoding="utf-8")
            if "-f services/" in text or "cd services/stt && docker compose" in text:
                offenders.append(path)
        assert offenders == [], offenders


class TestPerServiceContract:
    """REQ-UCD-3 / REQ-UCD-9: the checklist every service must satisfy."""

    def test_every_service_builds_from_an_explicit_context(
        self, compose: str
    ) -> None:
        for name, block in service_blocks(compose).items():
            if is_image_pinned_infrastructure(block):
                continue  # reproducible by tag rather than by context
            assert "build:" in block, f"{name} has no build stanza"
            assert re.search(r"^\s+context:\s+\S+", block, re.MULTILINE), name
            assert re.search(r"^\s+dockerfile:\s+\S+", block, re.MULTILINE), name

    def test_every_service_probes_its_own_health_endpoint(
        self, compose: str
    ) -> None:
        for name, block in service_blocks(compose).items():
            assert "healthcheck:" in block, f"{name} has no healthcheck"
            if is_image_pinned_infrastructure(block):
                continue  # probed through its own CLI, see the redis test below
            published = host_ports(block)
            assert published, f"{name} publishes no host port"
            probe = re.search(r"http://localhost:(\d+)/health", block)
            assert probe, f"{name} does not probe /health"

    def test_the_exempt_infrastructure_is_pinned_and_probed_by_its_cli(
        self, compose: str
    ) -> None:
        """The exemption is not a hole: whatever takes it still has to prove
        reproducible bytes and a real liveness probe, just by other means."""
        exempt = {
            name: block
            for name, block in service_blocks(compose).items()
            if is_image_pinned_infrastructure(block)
        }
        assert set(exempt) == {"redis"}, sorted(exempt)
        redis = exempt["redis"]
        assert "image: redis:7.4-alpine" in redis
        assert '"redis-cli", "ping"' in redis

    def test_the_redis_cache_publishes_no_host_port(self, compose: str) -> None:
        """Nothing outside the Compose network has business reaching the
        snapshot cache; `docker compose exec redis redis-cli` is the debug
        path. It also keeps 6379 free on a host already running one."""
        assert host_ports(service_blocks(compose)["redis"]) == []

    def test_the_redis_cache_persists_nothing(self, compose: str) -> None:
        """A pure cache: a cold start rebuilds the snapshot from Supabase, so
        an on-disk copy would only add a stale-data failure mode."""
        redis = service_blocks(compose)["redis"]
        assert '"--save", ""' in redis
        assert '"--appendonly", "no"' in redis
        assert "volumes:" not in redis

    def test_every_service_grants_its_healthcheck_a_start_period(
        self, compose: str
    ) -> None:
        """A slow boot must not be read as an unhealthy service."""
        for name, block in service_blocks(compose).items():
            assert re.search(r"^\s+start_period:\s+\d+s", block, re.MULTILINE), name

    def test_every_service_restarts_unless_stopped(self, compose: str) -> None:
        for name, block in service_blocks(compose).items():
            assert "restart: unless-stopped" in block, name

    def test_host_ports_never_collide(self, compose: str) -> None:
        seen: dict[str, str] = {}
        for name, block in service_blocks(compose).items():
            for port in host_ports(block):
                owner = seen.setdefault(port, name)
                assert owner == name, f"host port {port} claimed by {owner} and {name}"
                reserved = RESERVED_PORTS.get(port)
                assert reserved in (None, name), (
                    f"host port {port} is reserved for {reserved}, claimed by {name}"
                )

    def test_the_matcher_declares_no_catalogue_mount(self, compose: str) -> None:
        """REQ-CSS-1 / REQ-UCD-3. The catalogue now comes from Supabase over
        the network, so a host bind mount is not merely unused: leaving it
        would keep a stale SQLite file on the deployment contract and let an
        operator believe the matcher still reads it."""
        matcher = service_blocks(compose)["matcher"]
        assert "./data:/data" not in matcher
        assert "volumes:" not in matcher
        assert "CATALOGUE_DB" not in compose

    def test_the_matcher_receives_the_supabase_and_redis_variables(
        self, compose: str
    ) -> None:
        """REQ-UCD-3 / REQ-UCD-12. The catalogue is unreachable without these
        four, so a rename or a dropped line is a boot failure, not a default."""
        matcher = service_blocks(compose)["matcher"]
        assert "SUPABASE_URL: ${SUPABASE_URL:-}" in matcher
        assert "SUPABASE_KEY: ${SUPABASE_KEY:-}" in matcher
        assert "REDIS_URL: ${REDIS_URL:-redis://redis:6379/0}" in matcher
        assert (
            "CATALOGUE_CACHE_TTL_SECONDS: ${CATALOGUE_CACHE_TTL_SECONDS:-10800}"
            in matcher
        )

    def test_the_matcher_reaches_redis_by_its_service_name(
        self, compose: str
    ) -> None:
        """`localhost` is the right default for a developer running the app on
        their own machine, and the wrong one inside a container, where Redis is
        a sibling on the Compose network. The two defaults differ on purpose."""
        matcher = service_blocks(compose)["matcher"]
        assignment = re.search(r"^\s+REDIS_URL:\s*(.+)$", matcher, re.MULTILINE)
        assert assignment, "the matcher declares no REDIS_URL"
        assert assignment.group(1).strip() == "${REDIS_URL:-redis://redis:6379/0}"

    def test_the_matcher_builds_from_the_repository_root(
        self, compose: str
    ) -> None:
        matcher = service_blocks(compose)["matcher"]
        assert re.search(r"^\s+context:\s+\.\s*$", matcher, re.MULTILINE)
        assert "dockerfile: services/matcher/Dockerfile" in matcher

    def test_the_stt_builds_from_its_own_directory(self, compose: str) -> None:
        stt = service_blocks(compose)["stt"]
        assert re.search(r"^\s+context:\s+\./services/stt\s*$", stt, re.MULTILINE)

    def test_the_frontend_builds_from_its_own_directory(self, compose: str) -> None:
        frontend = service_blocks(compose)["frontend"]
        assert re.search(r"^\s+context:\s+\./frontend\s*$", frontend, re.MULTILINE)

    def test_the_frontend_reaches_the_services_by_their_compose_names(
        self, compose: str
    ) -> None:
        """frontend/.env.example points at `localhost` because it documents
        `npm run dev` on the host. Inside Compose `localhost` is the frontend's
        own container, so the upstream bases must be the service names on the
        default project network — a container-internal fact, fixed here rather
        than asked of the operator (the CATALOGUE_DB precedent)."""
        frontend = service_blocks(compose)["frontend"]
        assert "STT_BASE_URL: http://stt:8001" in frontend
        assert "MATCHER_BASE_URL: http://matcher:8002" in frontend
        assert (
            "EXTRACTOR_BASE_URL: http://product_identification:8003" in frontend
        )

    def test_the_frontend_binds_every_interface(self, compose: str) -> None:
        """The Node adapter defaults to 127.0.0.1, which no published port can
        reach from outside the container."""
        frontend = service_blocks(compose)["frontend"]
        assert "HOST: 0.0.0.0" in frontend


class TestNoCrossServiceOrdering:
    """REQ-UCD-4: services start, stop and fail independently."""

    def test_no_service_declares_depends_on(self, compose: str) -> None:
        for name, block in service_blocks(compose).items():
            assert "depends_on" not in block, (
                f"{name} declares depends_on; services must be independent"
            )

    def test_redis_is_coupled_to_nothing(self, compose: str) -> None:
        """REQ-UCD-12. Redis is a *soft* cache dependency of the matcher: the
        matcher boots without it through Supabase and keeps serving if it dies,
        so the independence promise survives. A `depends_on` here would trade
        that for a start-order guarantee nothing actually needs."""
        blocks = service_blocks(compose)
        assert "redis" in blocks
        assert "depends_on" not in blocks["redis"]
        for name, block in blocks.items():
            assert not re.search(r"depends_on[\s\S]*redis", block), name

    def test_no_custom_network_couples_the_services(self, compose: str) -> None:
        assert not re.search(r"^networks:", compose, re.MULTILINE)


class TestSecretSafeEnvWorkflow:
    """REQ-UCD-5: one template, one ignored `.env`, no committed credential."""

    def test_every_interpolated_variable_is_documented(
        self, compose: str, env_example: str
    ) -> None:
        documented = set(env_example_entries(env_example))
        referenced = set(INTERPOLATION.findall(compose))
        assert referenced <= documented, sorted(referenced - documented)

    def test_every_documented_variable_is_actually_used(
        self, compose: str, env_example: str
    ) -> None:
        """A stale variable is a question the setup script asks for nothing."""
        referenced = set(INTERPOLATION.findall(compose))
        documented = set(env_example_entries(env_example))
        assert documented <= referenced, sorted(documented - referenced)

    def test_every_variable_carries_help_text(self, env_example: str) -> None:
        missing = [
            name
            for name, text in env_example_help(env_example).items()
            if not text
        ]
        assert missing == [], missing

    def test_template_defaults_match_the_compose_defaults(
        self, compose: str, env_example: str
    ) -> None:
        """Two places state a default; a silent divergence between them would
        make `.env` and a bare `docker compose up` behave differently."""
        documented = env_example_entries(env_example)
        for name, fallback in re.findall(
            r"\$\{([A-Z][A-Z0-9_]*):-([^}]*)\}", compose
        ):
            assert documented.get(name, "") == fallback, name

    def test_secret_variables_ship_blank(self, env_example: str) -> None:
        offenders = {
            name: value
            for name, value in env_example_entries(env_example).items()
            if SECRET_NAME.search(name) and value
        }
        assert offenders == {}, sorted(offenders)

    def test_no_committed_file_carries_a_credential_shaped_default(
        self, env_example: str
    ) -> None:
        for name, value in env_example_entries(env_example).items():
            assert not CREDENTIAL_SHAPED.fullmatch(value), name

    def test_the_compose_file_interpolates_rather_than_hardcoding_secrets(
        self, compose: str
    ) -> None:
        for line in compose.splitlines():
            match = re.fullmatch(r"\s+([A-Z][A-Z0-9_]*):\s*(.+?)\s*", line)
            if match and SECRET_NAME.search(match.group(1)):
                assert match.group(2).startswith("${"), line

    def test_the_local_env_file_is_git_ignored(self) -> None:
        ignored = subprocess.run(
            ["git", "check-ignore", "-q", ".env"],
            cwd=REPO_ROOT,
            check=False,
        )
        assert ignored.returncode == 0, ".env must be listed in .gitignore"

    def test_no_env_file_is_tracked(self) -> None:
        tracked = [
            path
            for path in tracked_files()
            if path == ".env" or path.endswith("/.env")
        ]
        assert tracked == [], tracked

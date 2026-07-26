#!/usr/bin/env bash
#
# Start the stack and prove it actually works.
#
#   ./scripts/smoke-compose.sh              # every service
#   ./scripts/smoke-compose.sh matcher      # one of them
#   ./scripts/smoke-compose.sh --plan       # what would run, without a daemon
#   ./scripts/smoke-compose.sh --ephemeral  # up, check, then tear down again
#
# `docker compose up -d` returns before anything is healthy, so "it started"
# and "it works" are different claims. This waits for the healthcheck and then
# asks each service's /health endpoint itself.
#
# A stage that cannot run is SKIPPED with the reason named — never dropped in
# silence, because a stack that never came up would otherwise read as green.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(dirname "$script_dir")
compose_file="$repo_root/docker-compose.yml"

timeout_s=120
plan_only=0
ephemeral=0
requested=()

die() {
  printf 'smoke-compose: %s\n' "$1" >&2
  exit "${2:-1}"
}

usage() {
  cat <<'USAGE'
Usage: scripts/smoke-compose.sh [options] [service...]

  --plan            Print what would run and what would be skipped, then exit.
                    Needs no Docker daemon.
  --ephemeral       Tear the stack down again when the checks finish.
  --timeout N       Seconds to wait for a service to become healthy (120).
  -h, --help        Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan) plan_only=1; shift ;;
    --ephemeral) ephemeral=1; shift ;;
    --timeout) [[ $# -ge 2 ]] || die "--timeout needs a number"; timeout_s="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    --*) die "unknown option: $1" 2 ;;
    *) requested+=("$1"); shift ;;
  esac
done

[[ -f "$compose_file" ]] || die "compose file not found: $compose_file"

# ---------------------------------------------------------------------------
# Read the services and their published ports straight out of the Compose file,
# so a service added there is picked up here with no second edit.
# ---------------------------------------------------------------------------
services=()
declare -A port_of=()
current=""
while IFS= read -r line; do
  if [[ "$line" =~ ^\ \ ([A-Za-z0-9_-]+):[[:space:]]*$ ]]; then
    current=${BASH_REMATCH[1]}
    services+=("$current")
  elif [[ -n "$current" && "$line" =~ \"([0-9]+):[0-9]+\" ]]; then
    [[ -n "${port_of[$current]:-}" ]] || port_of["$current"]=${BASH_REMATCH[1]}
  fi
done < <(sed -n '/^services:/,$p' "$compose_file")

((${#services[@]})) || die "no services found in $compose_file"

if ((${#requested[@]})); then
  for name in "${requested[@]}"; do
    [[ " ${services[*]} " == *" $name "* ]] \
      || die "unknown service: $name (compose defines: ${services[*]})"
  done
  targets=("${requested[@]}")
else
  targets=("${services[@]}")
fi

# ---------------------------------------------------------------------------
# Effective configuration: the root .env, overridden by the environment, the
# same precedence Compose itself applies.
# ---------------------------------------------------------------------------
declare -A conf=()
if [[ -f "$repo_root/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *=* ]] || continue
    key=${line%%=*}
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    conf["$key"]=${line#*=}
  done <"$repo_root/.env"
fi
setting() {
  # An exported variable wins even when it is empty — exactly what Compose
  # does when it interpolates — so a test (or an operator) can blank one out
  # without the root .env silently filling it back in.
  local name=$1
  if [[ -n "${!name+x}" ]]; then printf '%s' "${!name}"
  else printf '%s' "${conf[$name]:-}"; fi
}

# ---------------------------------------------------------------------------
# Preconditions. A service with one defines `preflight_<service>`: it prints the
# reason it cannot run and returns non-zero, or stays quiet and returns 0.
# Most services need nothing here and simply define no function.
# ---------------------------------------------------------------------------
preflight_stt() {
  local vendor key_name
  vendor=$(setting STT_VENDOR); vendor=${vendor:-deepgram}
  case "$vendor" in
    deepgram) key_name=DEEPGRAM_API_KEY ;;
    groq) key_name=GROQ_API_KEY ;;
    elevenlabs)
      printf 'STT_VENDOR=elevenlabs is backup-only and is rejected at boot'
      return 1 ;;
    *) printf 'STT_VENDOR=%s is not a vendor this service knows' "$vendor"; return 1 ;;
  esac
  if [[ -z "$(setting "$key_name")" ]]; then
    printf '%s is empty and STT_VENDOR=%s' "$key_name" "$vendor"
    return 1
  fi
  return 0
}

preflight_matcher() {
  # The catalogue is read from Supabase at boot, not from a committed file, so
  # the matcher cannot become healthy without these two. Starting it anyway
  # would recreate a healthy container into a crash loop.
  # SUPABASE_SECRET_KEY is the host-side name: docker-compose.yml feeds it to
  # the container as SUPABASE_KEY, so the host variable is what must be set.
  local missing=()
  [[ -n "$(setting SUPABASE_URL)" ]] || missing+=(SUPABASE_URL)
  [[ -n "$(setting SUPABASE_SECRET_KEY)" ]] || missing+=(SUPABASE_SECRET_KEY)
  if ((${#missing[@]})); then
    printf '%s is empty and the catalogue is read from Supabase' "${missing[*]}"
    return 1
  fi
  return 0
}

runnable=()
declare -A skip_reason=()
for name in "${targets[@]}"; do
  reason=""
  if declare -F "preflight_$name" >/dev/null; then
    reason=$("preflight_$name") || skip_reason["$name"]=$reason
  fi
  [[ -n "${skip_reason[$name]:-}" ]] || runnable+=("$name")
done

report_skips() {
  for name in "${targets[@]}"; do
    [[ -n "${skip_reason[$name]:-}" ]] \
      && printf 'SKIP %s: %s\n' "$name" "${skip_reason[$name]}"
  done
  return 0
}

if ((plan_only)); then
  printf 'Plan (%s):\n' "${compose_file#"$repo_root/"}"
  for name in "${targets[@]}"; do
    if [[ -n "${skip_reason[$name]:-}" ]]; then
      printf '  SKIP %s (port %s): %s\n' \
        "$name" "${port_of[$name]:-?}" "${skip_reason[$name]}"
    else
      printf '  %s -> http://localhost:%s/health\n' "$name" "${port_of[$name]:-?}"
    fi
  done
  exit 0
fi

# ---------------------------------------------------------------------------
# From here on a daemon is needed. Its absence is a skip, not a failure: the
# daemon-free contracts in tests/deployment already cover the file itself.
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  printf 'SKIP all: the docker CLI is not installed\n'
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  printf 'SKIP all: no reachable docker daemon\n'
  exit 0
fi

report_skips
if ((${#runnable[@]} == 0)); then
  printf 'Nothing left to check.\n'
  exit 0
fi

cd "$repo_root"
if ((ephemeral)); then
  trap 'docker compose down --remove-orphans >/dev/null 2>&1 || true' EXIT
fi

printf 'Starting: %s\n' "${runnable[*]}"
if ! docker compose up -d --wait --wait-timeout "$timeout_s" "${runnable[@]}"; then
  printf '\nsmoke-compose: not every service became healthy within %ss\n' \
    "$timeout_s" >&2
  for name in "${runnable[@]}"; do
    printf '\n--- %s (last 20 lines) ---\n' "$name" >&2
    docker compose logs --tail 20 "$name" >&2 || true
  done
  exit 1
fi

failed=0
for name in "${runnable[@]}"; do
  port=${port_of[$name]:-}
  if [[ -z "$port" ]]; then
    printf 'SKIP %s: it publishes no host port to probe\n' "$name"
    continue
  fi
  if body=$(curl -fsS -m 10 "http://localhost:$port/health"); then
    printf 'OK   %s :%s %s\n' "$name" "$port" "$body"
  else
    printf 'FAIL %s :%s /health did not answer\n' "$name" "$port" >&2
    failed=1
  fi
done

exit "$failed"

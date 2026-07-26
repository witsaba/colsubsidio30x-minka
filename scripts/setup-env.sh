#!/usr/bin/env bash
#
# Build the single root .env that docker-compose.yml reads.
#
#   ./scripts/setup-env.sh              # ask about every variable
#   ./scripts/setup-env.sh --defaults   # ask nothing; take defaults
#
# .env.example is the only source of truth for what exists: this script asks
# one question per variable it documents, using the comment above it as the
# question. A new service is therefore added by editing .env.example alone.
#
# Answers already in .env win over the template, so re-running is how you
# change one value without retyping the rest. Secrets are read without echo and
# only ever acknowledged masked, so a key never lands in the terminal
# scrollback.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(dirname "$script_dir")

template="$repo_root/.env.example"
env_file="$repo_root/.env"
interactive=1

usage() {
  cat <<'USAGE'
Usage: scripts/setup-env.sh [options]

  --defaults           Do not ask anything: keep existing answers, then the
                       exported environment, then the template default.
  --env-file PATH      File to write (default: .env at the repository root).
  --template PATH      Template to read (default: .env.example).
  -h, --help           Show this help.
USAGE
}

die() {
  printf 'setup-env: %s\n' "$1" >&2
  exit "${2:-1}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --defaults) interactive=0; shift ;;
    --env-file) [[ $# -ge 2 ]] || die "--env-file needs a path"; env_file="$2"; shift 2 ;;
    --template) [[ $# -ge 2 ]] || die "--template needs a path"; template="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" 2 ;;
  esac
done

[[ -f "$template" ]] || die "template not found: $template"

# A variable is a secret if its name says so. Name-driven on purpose: a new
# service inherits the masking by following the convention, with nothing to
# register here. tests/deployment/test_setup_env.py holds the same list.
is_secret() {
  case "$1" in
    *_API_KEY|*_SECRET|*_TOKEN|*_PASSWORD|*_KEY) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Read the template: order, defaults, and the comment block above each entry.
# ---------------------------------------------------------------------------
names=()
declare -A default_of=()
declare -A help_of=()
pending=""

while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    '#'*)
      text=${line#\#}
      text=${text# }
      # A rule of dashes separates sections; it is decoration, not help.
      if [[ "$text" =~ ^-+$ ]]; then
        pending=""
      elif [[ -n "$text" ]]; then
        pending="${pending:+$pending }$text"
      fi
      ;;
    [A-Z]*=*)
      name=${line%%=*}
      if [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
        names+=("$name")
        default_of["$name"]=${line#*=}
        help_of["$name"]=$pending
      fi
      pending=""
      ;;
    *) pending="" ;;
  esac
done <"$template"

((${#names[@]})) || die "template documents no variables: $template"

# ---------------------------------------------------------------------------
# Read what is already answered. Existing file wins over the environment, so a
# re-run never silently reverts a value to whatever a shell happens to export.
# ---------------------------------------------------------------------------
declare -A value_of=()
for name in "${names[@]}"; do
  if [[ -n "${!name+set}" ]]; then
    value_of["$name"]=${!name}
  else
    value_of["$name"]=${default_of[$name]}
  fi
done

if [[ -f "$env_file" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *=* ]] || continue
    name=${line%%=*}
    name=${name//[[:space:]]/}
    [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    [[ -n "${default_of[$name]+set}" ]] || continue  # dropped by the template
    value_of["$name"]=${line#*=}
  done <"$env_file"
fi

# ---------------------------------------------------------------------------
# Ask.
# ---------------------------------------------------------------------------
if ((interactive)); then
  printf '\nFilling in %s from %s.\n' "$env_file" "${template#"$repo_root/"}"
  printf 'Press Enter to keep the value in brackets.\n'
  section=""
  for name in "${names[@]}"; do
    current=${value_of[$name]}
    printf '\n'
    [[ -n "${help_of[$name]}" ]] && printf '  %s\n' "${help_of[$name]}"
    if is_secret "$name"; then
      shown=$([[ -n "$current" ]] && printf '********' || printf 'empty')
      printf '  %s [%s]: ' "$name" "$shown"
      IFS= read -r -s answer || answer=""
      printf '\n'
      if [[ -n "$answer" ]]; then
        value_of["$name"]=$answer
        printf '  %s = ********\n' "$name"
      fi
    else
      printf '  %s [%s]: ' "$name" "${current:-empty}"
      IFS= read -r answer || answer=""
      [[ -n "$answer" ]] && value_of["$name"]=$answer
    fi
  done
  printf '\n'
fi

# ---------------------------------------------------------------------------
# Write. The template's comments come along, so the generated file explains
# itself, and the previous answers stay recoverable.
# ---------------------------------------------------------------------------
if [[ -f "$env_file" ]]; then
  backup="$env_file.bak.$(date +%Y%m%d-%H%M%S)"
  cp -p "$env_file" "$backup"
  printf 'Previous file kept at %s\n' "$backup"
fi

target_dir=$(dirname "$env_file")
[[ -d "$target_dir" ]] || die "directory not found: $target_dir"
tmp_file=$(mktemp "$target_dir/.env.tmp.XXXXXX")
# The file is about to hold credentials: never let it exist group- or
# world-readable, not even for the moment between write and move.
chmod 600 "$tmp_file"
trap 'rm -f "$tmp_file"' EXIT

{
  printf '# Generated by scripts/setup-env.sh from %s.\n' "${template#"$repo_root/"}"
  printf '# Re-run that script to change a value. Never commit this file.\n'
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == [A-Z]*=* ]]; then
      name=${line%%=*}
      if [[ -n "${default_of[$name]+set}" ]]; then
        printf '%s=%s\n' "$name" "${value_of[$name]}"
        continue
      fi
    fi
    printf '%s\n' "$line"
  done <"$template"
} >"$tmp_file"

mv "$tmp_file" "$env_file"
trap - EXIT
chmod 600 "$env_file"
printf 'Wrote %s\n' "$env_file"

# ---------------------------------------------------------------------------
# Say whether the stack will actually come up, while the operator is still here
# to fix it. `docker compose up` would otherwise report it as a crash loop.
# ---------------------------------------------------------------------------
# A publishable key in the secret slot is the one credential mistake this stack
# cannot survive and cannot report: the `anon` role holds zero table privileges
# by design (RLS targets `authenticated`, and the server routes rely on
# service-role bypass), so PostgREST answers 401 — which the frontend routes
# degrade into an empty list. The operator sees "no plans assigned" instead of
# "wrong key". Checked here by prefix, while there is still someone to tell.
supabase_key=${value_of[SUPABASE_SECRET_KEY]:-}
if [[ -z "$supabase_key" ]]; then
  printf 'WARNING: frontend will not boot and matcher will crash-loop - SUPABASE_SECRET_KEY is empty. Copy it from Supabase: Project Settings > API Keys > Secret keys > default (reveal, then copy).\n' >&2
elif [[ "$supabase_key" == sb_publishable_* ]]; then
  printf 'WARNING: SUPABASE_SECRET_KEY holds a PUBLISHABLE key (sb_publishable_...). Every database read will return empty rather than fail loudly. Use the SECRET key (sb_secret_...) from Project Settings > API Keys > Secret keys.\n' >&2
elif [[ "$supabase_key" != sb_secret_* ]]; then
  printf 'WARNING: SUPABASE_SECRET_KEY does not look like a Supabase secret key (expected an sb_secret_ prefix).\n' >&2
fi

vendor=${value_of[STT_VENDOR]:-}
if [[ -n "$vendor" ]]; then
  key_name=""
  case "$vendor" in
    deepgram) key_name=DEEPGRAM_API_KEY ;;
    groq) key_name=GROQ_API_KEY ;;
    elevenlabs)
      printf 'WARNING: stt will not boot - STT_VENDOR=elevenlabs is backup-only. Set STT_VENDOR=deepgram or groq and STT_FALLBACK_VENDOR=elevenlabs.\n' >&2
      ;;
  esac
  if [[ -n "$key_name" && -z "${value_of[$key_name]:-}" ]]; then
    printf 'WARNING: stt will not boot - %s is empty and STT_VENDOR=%s. Re-run this script, or start only the other services.\n' \
      "$key_name" "$vendor" >&2
  fi
fi

printf '\nNext: docker compose up --build   (then docker compose ps for health)\n'

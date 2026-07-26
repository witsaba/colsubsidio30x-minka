#!/usr/bin/env bash
#
# Prove the extraction path really works, end to end, before the demo.
#
#   ./scripts/smoke-extract.sh
#   ./scripts/smoke-extract.sh "tres kilos de lechuga batavia"
#
# Two legs, in this order:
#
#   1. the extractor itself   POST :8003/api/v1/extract
#   2. the frontend proxy     POST :4321/api/extract
#
# Leg 1 is the one that matters on the demo host: it is the only check in this
# repo that actually spends a Vertex/Gemini call, so it is what catches missing
# or expired GCP credentials. `smoke-compose.sh` cannot cover this — it is
# health-only by design, and a service with dead credentials is still healthy.
#
# Leg 2 proves the same-origin route reaches the service under its Compose name.
#
# Why a failure here is not fatal to the demo, and why you should still fix it:
# the browser falls back to the offline mock per utterance, so a broken
# extractor degrades to canned extraction rather than a broken count — SILENTLY,
# with no indicator on screen. This script is the only thing that will tell you.
#
# Owner: Braejan. Run it on the demo host the morning of the presentation.
set -euo pipefail

extractor_base=${EXTRACTOR_BASE_URL:-http://localhost:8003}
frontend_base=${FRONTEND_BASE_URL:-http://localhost:4321}
transcription=${1:-"tres kilos de lechuga batavia y dos cajas de tomate chonto"}

die() {
  printf 'smoke-extract: %s\n' "$1" >&2
  exit "${2:-1}"
}

command -v curl >/dev/null 2>&1 || die "curl is required"

payload=$(printf '{"transcription": "%s"}' "$transcription")

# Echo the body and the status on separate lines so a non-JSON gateway page is
# still readable instead of being swallowed by a parser.
call() {
  local label=$1 url=$2 body status
  printf '\n== %s\n   POST %s\n' "$label" "$url"

  body=$(mktemp)
  status=$(curl -sS -o "$body" -w '%{http_code}' \
    --max-time 90 \
    -H 'content-type: application/json' \
    -d "$payload" \
    "$url") || {
    rm -f "$body"
    die "$label: the request itself failed (service down, or wrong host)"
  }

  printf '   HTTP %s\n' "$status"
  sed 's/^/   /' "$body"
  printf '\n'

  if [ "$status" != "200" ]; then
    rm -f "$body"
    die "$label: expected HTTP 200, got $status"
  fi

  # `validated_inventory` is the only field the frontend consumes, so its
  # presence — not a 200 alone — is what "this works" means here.
  grep -q '"validated_inventory"' "$body" || {
    rm -f "$body"
    die "$label: 200 without a validated_inventory field; the contract drifted"
  }

  rm -f "$body"
}

printf 'smoke-extract: transcription = %s\n' "$transcription"

call "extractor (spends a real Gemini call)" "$extractor_base/api/v1/extract"
call "frontend proxy" "$frontend_base/api/extract"

printf '\nsmoke-extract: both legs answered 200 with a validated_inventory.\n'

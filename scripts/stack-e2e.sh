#!/usr/bin/env bash
# End-to-end check for the running compose stack: save the CI fixture page
# through the API and wait until the link reaches `enriched`. Fails when the
# link fails or the wait times out. Needs curl and jq, the stack up with the
# `ci` compose profile, and FETCH_ALLOWED_HOSTS=fixture in the stack's .env.
set -euo pipefail

api="${API_URL:-http://localhost:3000}"
key="stack-e2e-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}"

link_id=$(curl -fsS -X POST "$api/links" \
  -H 'content-type: application/json' \
  -H "Idempotency-Key: $key" \
  -d '{"url": "http://fixture/"}' | jq -re '.id')

for _ in $(seq 1 30); do
  status=$(curl -fsS "$api/links/$link_id" | jq -re '.status')
  echo "link $link_id status: $status"
  case "$status" in
    enriched) exit 0 ;;
    failed) echo 'link failed instead of enriched' >&2; exit 1 ;;
  esac
  sleep 2
done
echo 'timed out waiting for enriched' >&2
exit 1

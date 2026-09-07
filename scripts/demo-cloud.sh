#!/usr/bin/env bash
# Scripted demo of the contract-v2 product loop against the cloud environment:
# save real links, wait for enrichment, show the tags / evidence / deadline
# contrast, then terminally fail a job and recover it with the runbook requeue.
# See docs/demo.md for what each step proves.
#
# Required:
#   BASE_URL      the ALB URL (terraform output -raw api_url)
#   API_KEY       the link-route key (terraform output -raw api_key)
#   DATABASE_URL  operator connection to RDS, used for enrichment inspection
#                 and the requeue (needs the operator_cidr SG rule; the value
#                 is the `libpq` key of the revisit-demo/database-url secret)
# Optional URL overrides: DEADLINE_URL, EVERGREEN_URL, FAILING_URL.
# Needs curl, jq, and psql.
set -euo pipefail

: "${BASE_URL:?set BASE_URL to the deployed API URL}"
: "${API_KEY:?set API_KEY (terraform output -raw api_key)}"
: "${DATABASE_URL:?set DATABASE_URL to the operator RDS connection string}"

# A page whose value is tied to concrete dates, and one that is evergreen.
deadline_url="${DEADLINE_URL:-https://endoflife.date/python}"
evergreen_url="${EVERGREEN_URL:-https://www.paulgraham.com/greatwork.html}"
# An image: the fetcher rejects it terminally as unsupported_content_type.
failing_url="${FAILING_URL:-https://www.python.org/static/img/python-logo.png}"

run_id="demo-$(date +%s)"

step() { printf '\n=== %s ===\n' "$*"; }

save() { # save <url> <key-suffix> -> link id
  curl -fsS -X POST "$BASE_URL/links" \
    -H 'content-type: application/json' \
    -H "x-api-key: $API_KEY" \
    -H "Idempotency-Key: $run_id-$2" \
    -d "{\"url\": \"$1\"}" | jq -re '.id'
}

wait_for() { # wait_for <link-id> <wanted-status> [attempts]
  local id="$1" wanted="$2" attempts="${3:-60}" status
  for _ in $(seq 1 "$attempts"); do
    status=$(curl -fsS "$BASE_URL/links/$id" -H "x-api-key: $API_KEY" | jq -re '.status')
    echo "  link $id: $status"
    [ "$status" = "$wanted" ] && return 0
    if [ "$status" = "failed" ] && [ "$wanted" = "enriched" ]; then
      echo "  link failed while waiting for enriched" >&2
      return 1
    fi
    sleep 5
  done
  echo "  timed out waiting for $wanted" >&2
  return 1
}

# The API deliberately exposes only the link row (no enrichment endpoint yet),
# so inspection reads the stored enrichment directly — which doubles as the
# proof that evidence resolves to stored extracted text.
show_enrichment() { # show_enrichment <link-id>
  psql "$DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align <<SQL | jq .
SELECT jsonb_build_object(
  'tags',     e.result->'tags',
  'summary',  e.result->'summary',
  'deadline', e.result->'deadline',
  'evidence_resolves',
    (SELECT bool_and(position((item->>'quote') IN cv.extracted_text) > 0)
     FROM jsonb_array_elements(e.result->'evidence') AS item),
  'evidence', e.result->'evidence'
)
FROM enrichments e
JOIN content_versions cv ON cv.id = e.content_version_id
WHERE e.link_id = '$1'
ORDER BY e.created_at DESC
LIMIT 1;
SQL
}

step "1. Save a page whose value is date-bound: $deadline_url"
deadline_id=$(save "$deadline_url" deadline)
wait_for "$deadline_id" enriched

step "2. Its enrichment: tags, resolvable evidence, and a populated deadline"
show_enrichment "$deadline_id"

step "3. Save an evergreen page: $evergreen_url"
evergreen_id=$(save "$evergreen_url" evergreen)
wait_for "$evergreen_id" enriched

step "4. Its enrichment: tags and evidence, deadline null (nothing invented)"
show_enrichment "$evergreen_id"

step "5. Save a link the fetcher must reject: $failing_url"
failing_id=$(save "$failing_url" failing)
wait_for "$failing_id" failed

step "6. The failure is observable: last_error in the queue, error_code in CloudWatch"
psql "$DATABASE_URL" --no-psqlrc --quiet <<SQL
SELECT j.status, j.attempts, j.last_error
FROM enrichment_jobs j WHERE j.link_id = '$failing_id';
SQL
echo "CloudWatch: the 'job failed' event and the JobFailedByCode metric carry the same error_code."

step "7. Recover with the runbook requeue (scoped to this link)"
# Same statement as docs/runbook.md, scoped to the demo link.
psql "$DATABASE_URL" --no-psqlrc --quiet <<SQL
WITH requeued AS (
  UPDATE enrichment_jobs
  SET status = 'pending', available_at = now(), attempts = 0,
      last_error = NULL, locked_until = NULL, locked_by = NULL, updated_at = now()
  WHERE status = 'failed' AND link_id = '$failing_id'
  RETURNING link_id
)
UPDATE links SET status = 'pending', updated_at = now()
WHERE id IN (SELECT link_id FROM requeued);
SQL

step "8. The requeued job reprocesses to a terminal state again"
# The cause (unsupported content type) is permanent, so it fails again: the
# point is the operational path — failed jobs are recoverable by requeue.
wait_for "$failing_id" failed

step "Demo complete"
echo "deadline case:  $BASE_URL/links/$deadline_id"
echo "evergreen case: $BASE_URL/links/$evergreen_id"
echo "recovered case: $BASE_URL/links/$failing_id"

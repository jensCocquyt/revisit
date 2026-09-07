# Cloud demo walkthrough

`scripts/demo-cloud.sh` runs the full contract-v2 product loop against the
deployed environment. This document maps each step to what it proves. The
build spec's original demo wording ("show `none` and `revisit`") predates
contract v2 — the v1 recommended-action enums no longer exist, and the v2
contrast that replaces them is **deadline present vs deadline absent**.

## Setup

```bash
cd terraform/stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET" -backend-config="region=eu-west-1"
export BASE_URL=$(terraform output -raw api_url)
export API_KEY=$(terraform output -raw api_key)
export DATABASE_URL=$(aws secretsmanager get-secret-value \
  --secret-id revisit-demo/database-url --query SecretString --output text | jq -re .libpq)
cd ../..
./scripts/demo-cloud.sh
```

`DATABASE_URL` requires the environment to have been deployed with your
address in the `operator_cidr` dispatch input (see the runbook's cloud
recovery section).

## What each step proves

| Step | What happens | What it proves |
|---|---|---|
| 1–2 | Save a date-bound page (default: a software end-of-life tracker), wait for `enriched`, show the stored enrichment | The full cloud path works: API key accepted, link + job created transactionally, worker claimed the job, fetched safely, called Bedrock with its task role, persisted idempotently. The `deadline` carries `date`, `reason`, and an evidence-backed `source`; the `evidence_resolves` field in the output is computed by matching every quote against the stored extracted text — evidence is shown only because it resolves. |
| 3–4 | Save an evergreen essay, show its enrichment | The model does not invent urgency: `deadline` is null when the page ties value to no concrete date. Tags are still assigned from the closed vocabulary. |
| 5–6 | Save an image URL, wait for `failed`, show the job row | The failure taxonomy in production: the fetcher rejects the content type terminally (`unsupported_content_type`), `last_error` carries the stable code, and the same code is visible in CloudWatch as the `JobFailedByCode` metric and on the `revisit-demo` dashboard. |
| 7–8 | Run the runbook requeue scoped to the failed link, watch it reprocess | Operational recovery works against RDS exactly as documented: the job returns to `pending` with a fresh retry budget, a worker reclaims it, and it reaches a terminal state again. The cause here is permanent (an image is never enrichable), so it fails again — the point is the recovery path, which in a real incident (transient DNS, model quota) converges on `enriched`. |

Inspection in steps 2, 4, and 6 reads the database directly: the API
deliberately exposes only the link row so far (no enrichment read endpoint —
a deliberate MVP deferral), and the SQL join against `content_versions` is
also what makes evidence resolution checkable rather than asserted.

## Bruno against the cloud

`bruno/environments/cloud.bru` carries `baseUrl` and `apiKey`. Fill both in
from the terraform outputs, select the cloud environment, and the same three
requests (health, save, get) run against the deployed API:

```bash
cd bruno
npx @usebruno/cli run --env cloud
```

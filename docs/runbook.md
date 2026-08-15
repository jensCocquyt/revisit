# Operations runbook

Operational procedures for the Revisit stack. Recovery is deliberately SQL-only:
there is no DLQ service and no admin API. Connect with `psql "$DATABASE_URL"`.

## Inspecting failed enrichment jobs

A job that exhausted its retries (or hit a terminal error such as a blocked
destination) has status `failed`, and its link is marked `failed` too. `last_error`
holds a stable error code, a colon, and safe diagnostic detail — for example
`blocked_url: ...`, `fetch_timeout: ...`, `empty_content: ...`,
`enrich_error: ...`, `invalid_model_output: ...`.

List recent failures:

```sql
SELECT j.id AS job_id, j.link_id, l.url, j.attempts, j.last_error, j.updated_at
FROM enrichment_jobs j
JOIN links l ON l.id = j.link_id
WHERE j.status = 'failed'
ORDER BY j.updated_at DESC
LIMIT 50;
```

Inspect one job by `link_id` (swap the predicate to `j.id = '...'` for a `job_id`):

```sql
SELECT j.id AS job_id, j.status, j.attempts, j.last_error,
       j.available_at, j.locked_until, j.locked_by,
       j.created_at, j.updated_at, j.completed_at
FROM enrichment_jobs j
WHERE j.link_id = '<link-id>';
```

The worker also logs every failure as single-line JSON with `job_id`, `link_id`,
`attempt`, and `error_code` fields, so `grep`ing worker logs for an `error_code`
gives failure counts without any metrics infrastructure.

## Requeueing failed jobs

Requeue when the underlying cause is fixed (destination reachable again, model
quota restored, bug deployed). The statement below resets every `failed` job to a
claimable state; to target one job, add `AND id = '<job-id>'` (or
`AND link_id = '<link-id>'`) to the inner `WHERE` clause.

`attempts` is reset to 0 deliberately: a manual requeue is an operator's judgment
that the cause is fixed, so the job gets a full fresh retry budget. Preserving the
old count would make the first transient hiccup after requeue terminal.

This exact block is extracted and executed by
`apps/worker/tests/test_runbook_int.py` — keep the `-- runbook:requeue` marker
line in place so the documented SQL stays proven.

```sql
-- runbook:requeue
WITH requeued AS (
  UPDATE enrichment_jobs
  SET status = 'pending',
      available_at = now(),
      attempts = 0,
      last_error = NULL,
      locked_until = NULL,
      locked_by = NULL,
      updated_at = now()
  WHERE status = 'failed'
  RETURNING link_id
)
UPDATE links
SET status = 'pending', updated_at = now()
WHERE id IN (SELECT link_id FROM requeued);
```

A running worker picks the job up on its next poll (`available_at` is now).
Persistence is idempotent, so requeueing a job whose content has not changed
simply converges on the already-stored result.

## GitHub → AWS OIDC prerequisite for the Bedrock eval workflow

`.github/workflows/eval.yml` (manual dispatch only) runs the eval set against
Bedrock. It authenticates by assuming an IAM role via GitHub's OIDC provider —
no long-lived AWS keys are stored in the repository. One-time AWS setup:

1. **Create the OIDC identity provider** (skip if the account already has it):
   IAM → Identity providers → Add provider → OpenID Connect, with provider URL
   `https://token.actions.githubusercontent.com` and audience `sts.amazonaws.com`.

2. **Create the IAM role** the workflow assumes. Trust policy, pinned to this
   repository (replace the account id):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
           },
           "StringLike": {
             "token.actions.githubusercontent.com:sub": "repo:jensCocquyt/revisit:*"
           }
         }
       }
     ]
   }
   ```

3. **Attach a permissions policy that allows `bedrock:InvokeModel` only**:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "bedrock:InvokeModel",
         "Resource": "*"
       }
     ]
   }
   ```

   Narrow `Resource` to the specific model ARNs you evaluate if you want a
   tighter scope.

4. **Set the repository variable**: repo Settings → Secrets and variables →
   Actions → Variables → `AWS_EVAL_ROLE_ARN` = the role's ARN. The workflow
   fails fast with a pointer to this section when the variable is unset.

The merge-gating CI workflow (`ci.yml`) never uses any of this: it stays fully
offline and credential-free.

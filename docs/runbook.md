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

`.github/workflows/eval.yml` runs the eval set against Bedrock — on manual
dispatch, on a weekly schedule, and on pushes to `main` that touch the eval
set or the enrichers. Scheduled and push runs read the model id from the
`BEDROCK_MODEL_ID` repository variable; dispatch inputs override it. It is
never a required check. It authenticates by assuming an IAM role via GitHub's
OIDC provider — no long-lived AWS keys are stored in the repository. One-time
AWS setup:

1. **Create the OIDC identity provider** (skip if the account already has it):
   IAM → Identity providers → Add provider → OpenID Connect, with provider URL
   `https://token.actions.githubusercontent.com` and audience `sts.amazonaws.com`.

2. **Create the IAM role** the workflow assumes. Trust policy, pinned to this
   repository (replace the account id). GitHub's OIDC `sub` claim embeds
   immutable account and repository ids (`repo:<owner>@<owner-id>/<repo>@<repo-id>:...`),
   so the condition must use the id-embedded form — the plain
   `repo:<owner>/<repo>:*` pattern from older guides no longer matches. Read
   the exact `sub` from a failed attempt's CloudTrail `AssumeRoleWithWebIdentity`
   event (`userIdentity.userName`) if in doubt:

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
             "token.actions.githubusercontent.com:sub": "repo:jensCocquyt@3635860/revisit@1324237451:*"
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

   **First-invoke Marketplace subscription:** Bedrock's model-access page is
   retired; Anthropic models are Marketplace-served and auto-subscribe on the
   account's first invocation — but that first call must come from a principal
   allowed to subscribe. If the eval fails everywhere with
   `AccessDeniedException: Model access is denied ...`, temporarily attach a
   second inline policy allowing `aws-marketplace:Subscribe` and
   `aws-marketplace:ViewSubscriptions` (Resource `*`), run the workflow once,
   wait a few minutes for the subscription to activate (calls are denied while
   it is pending), then run again and remove the policy. The subscription is
   account-wide and sticky.

4. **Set the repository variable**: repo Settings → Secrets and variables →
   Actions → Variables → `AWS_EVAL_ROLE_ARN` = the role's ARN. The workflow
   fails fast with a pointer to this section when the variable is unset.

## Bootstrap and deploy role

`terraform/bootstrap` holds the durable prerequisites of the cloud demo
environment; `terraform/stack` holds the environment itself (ephemeral by
design — `terraform destroy` → `apply` round-trips cleanly). Bootstrap is
applied once by a human with their own credentials, because a deploy role
cannot create the state bucket its own state would live in. It creates:

- the S3 state bucket for the stack root (versioned, encrypted, private —
  demo state contains the generated database password and API key);
- the three ECR repositories (`revisit/api`, `revisit/worker`,
  `revisit/migrate`), kept outside the stack root so destroying the
  environment never deletes images;
- the `revisit-demo-deploy` IAM role that `.github/workflows/deploy.yml`
  assumes via the same OIDC provider and id-embedded `sub` claim documented
  above.

```bash
cd terraform/bootstrap
terraform init
terraform apply -var 'state_bucket_name=<globally-unique-name>'
```

Bootstrap uses local state, and that state is deliberately not committed;
the resources are few, cheap, and re-importable. After applying, set the
repository variables the deploy workflow requires: `AWS_DEPLOY_ROLE_ARN` and
`TF_STATE_BUCKET` (both terraform outputs), plus `BEDROCK_MODEL_ID`.

The deploy role's policy is service-scoped, not action-scoped: full access to
the services the stack root manages, with resource scoping where it is cheap
(IAM restricted to the `/revisit-demo/` role path, S3 to the state bucket).
A true least-action policy for a Terraform apply role is unmaintainable; the
honest trade-off is documented scoping plus no long-lived credentials.

**Bedrock Marketplace first-invoke:** the worker task role
(`bedrock:InvokeModel` only) is subject to the same first-invoke Marketplace
subscription gotcha described in step 3 above. If the account has already run
the eval workflow once, the subscription is account-wide and sticky and the
worker needs nothing; otherwise apply the same temporary-policy workaround to
the worker task role, or run the eval once first.

## Recovery against the cloud database

The requeue procedure above is identical in the cloud — only the connection
differs. RDS accepts 5432 solely from the task security groups and the
`operator_cidr` supplied at deploy time (a `deploy.yml` dispatch input), so
recovery requires having deployed with your address in that variable.

The connection string is the `libpq` key of the `revisit-demo/database-url`
secret:

```bash
aws secretsmanager get-secret-value --secret-id revisit-demo/database-url \
  --query SecretString --output text | jq -re .libpq
```

Use it as `psql "$DATABASE_URL"` and run the same inspection and requeue SQL.
The `error_code` values documented above are also CloudWatch metrics in the
cloud (`Revisit/JobFailedByCode` on the `revisit-demo` dashboard), so failure
counts need no log grepping there.

The merge-gating CI workflow (`ci.yml`) never uses any of this: it stays fully
offline and credential-free.

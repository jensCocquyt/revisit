# Step 2: online, with a single-user sign-in

## Goal

Use Revisit from the phone and the laptop over the internet, signed in with the owner's Google account, for close to $0 a month. Done when it runs on AWS, every merge to `main` deploys it, and saving and searching links, text and screenshots works from the phone.

## Out of scope

A custom domain, more than one user, a sign-out button, copying the local items to the cloud, a staging environment, a browser extension or share target, "more like this", PDFs.

## Decisions

- **Hosting:** one Lambda function (Node 24, arm64) behind a Function URL, which comes with HTTPS and needs no domain. It serves the web app and the API, and runs the processing. Every always-on option costs $12 or more a month: App Runner is closed to new customers, Fargate needs a load balancer, a virtual machine needs a public IPv4 address and a domain, and the cheapest managed Postgres on AWS is about $15.
- **Database:** Neon free plan in London (`aws-eu-west-2`), Postgres 18 with pgvector and pg_trgm, compute fixed at 0.25 CU so a burst cannot use up the monthly hours. It sleeps after 5 idle minutes and wakes in a few hundred milliseconds. The app uses Neon's pooled URL with a 10 s connect timeout and closes its connection before each Lambda run ends, because a frozen instance keeps its connections open and may keep Neon awake; migrations use the direct URL.
- **Images:** in S3 instead of Postgres, since Neon's free storage is 1 GB. A Lambda request is capped at 6 MB, so the browser uploads straight to S3 with a presigned POST limited to 10 MB, and the server checks the type from the file's bytes before saving the item. Images are shown through short-lived presigned links.
- **Sign-in:** Google over OpenID Connect with `openid-client` (authorization code with PKCE). Only the owner's verified email gets in. A signed `HttpOnly`, `Secure`, `SameSite=Lax` session cookie lasts 30 days. Everything except `/auth/*` needs the session: pages redirect to Google, `/api` answers 401 and the web app then goes to sign-in. Requests without a session stop before they touch Neon or Bedrock, so strangers hitting the public URL cost nothing.
- **Secrets and settings:** in Parameter Store under `/revisit/`, written by hand with the AWS CLI, so secrets never enter Terraform state or the repo. Lambda reads them once per cold start; locally they come from `.env`.
- **Infrastructure:** Terraform in `infra/bootstrap` (state bucket, deploy role) and `infra/app` (the rest), applied by the owner from the laptop. State lives in S3 with S3's own lock file; the bootstrap state moves into its own bucket after the first apply. Account-specific values stay in git-ignored files.
- **Deploy:** after CI passes on `main`, a GitHub Actions job assumes the deploy role through OIDC, updates the function code (about 40 MB zipped, under the 50 MB direct upload limit), waits for the update and runs the migrations. The deploy role can only update and invoke this one function.
- **Old AWS setup:** torn down before anything new is applied. The hand-made GitHub OIDC provider stays and is reused.
- **Cost:** about $0 to $1 a month. Lambda, Parameter Store, the schedule and logs stay inside the always-free allowances; S3 and Bedrock are cents. Neon: about 2 hours awake a day plus the sweeps is roughly 20 of the 100 free CU-hours a month.

## Processing

- Saving still inserts the item as `pending` and answers at once. `wake()` becomes async and the route awaits it, because Lambda freezes after the response.
- Locally the in-process loop stays.
- On Lambda, `wake()` invokes the same function asynchronously with `{ task: "process" }`; that run claims and processes items until none are pending.
- The account allows 10 concurrent runs and cannot reserve any, so runs can overlap. Claiming uses `FOR UPDATE SKIP LOCKED` and stamps `claimed_at`, so two runs never take the same item and a duplicate invoke finds nothing to do.
- Each run first returns items stuck in `processing` for over 10 minutes to `pending`. Resetting every `processing` item at startup stays local only.
- A schedule starts a run every 6 hours, so a crashed run never leaves an item stuck for long.

## Data

- `items` gains `image_key` and `claimed_at`; the `image` column goes.
- The local instance becomes dev only. Screenshots saved there before this step keep their text and stay searchable, but their image no longer shows.

## Resources

`infra/bootstrap`:
- S3 bucket for Terraform state: versioned, encrypted, no public access.
- Deploy role, trusted only for GitHub Actions runs of this repository on `main`.
- Monthly AWS budget of $5 that emails the owner when actual or forecast cost passes it; the address comes from the git-ignored variables file.

`infra/app`:
- Lambda function `revisit`: Node 24, arm64, 1024 MB, 5 minute timeout; one handler for web requests and the `process` and `migrate` tasks.
- Function URL with auth type `NONE` (the app checks the session); AWS provider 6.28 or later, which adds both invoke permissions a public URL now needs.
- Execution role: write logs, invoke the two Bedrock models, read and write the images bucket, read `/revisit/` parameters, invoke the function itself.
- Images bucket: private, encrypted, uploads not saved within a day expire, CORS for the Function URL.
- Dev images bucket for local runs, CORS for localhost.
- EventBridge Scheduler schedule every 6 hours, with a role that may invoke the function.
- CloudWatch log group with 14 days of retention.

Outside AWS, set up by hand: the Neon project and the Google OAuth client.

## Setup order

This becomes the runbook in the README.

1. Tear down the old bootstrap: restore its files from git history, check that `s3://revisit-links/demo` holds no live stack, review `terraform plan -destroy` together, empty the versioned bucket and the registries, destroy. Delete the hand-made Bedrock eval role too; the eval runs from the laptop, so nothing uses it.
2. Apply `infra/bootstrap` and move its state into the new bucket.
3. Create the Neon project.
4. Apply `infra/app` and note the Function URL.
5. Create the Google OAuth client with redirects for the Function URL and localhost.
6. Write the parameters with the AWS CLI.
7. Set the deploy role as a GitHub variable, merge to deploy, test from the phone.

Recreating the Function URL changes its address: update the Google redirect and `/revisit/app-url` afterwards.

The AWS account stays on the Free plan for now. That plan ends on 2027-02-15 ($133 of credits left), and AWS then closes the account and deletes its data 90 days later, so move it to the Paid plan before that date; the credits carry over.

## Proof

- Sign-in tests: no session gets a redirect or 401; a valid cookie passes; a tampered or expired cookie fails; the callback turns away another account and an unverified email, with the token exchange faked.
- Upload tests with a fake image store: missing object, too large, not an image, valid; deleting an item deletes its image.
- Processing tests: two overlapping runs process each item exactly once; stuck items return to `pending`.
- Eval rerun, since processing changes: at least 18 of 20 queries find their item in the top 5.
- After the first deploy, from the phone: sign in, save a link, text and a screenshot (which proves the arm64 build of sharp), find each by search.

## Slices

### 2a. Sign in with Google, locally
- [ ] Google OAuth client with a localhost redirect (by hand)
- [ ] `/auth/login`, `/auth/callback`, session cookie, owner check
- [ ] Session required everywhere else; the web app handles 401; Vite forwards `/auth`
- [ ] `.env.example`, README, the `LISTEN_HOST` comment
- [ ] Google settings in your own `.env` before the local instance restarts, or it turns every request away
- [ ] Tests

### 2b. Ready for Lambda
- [ ] Old bootstrap torn down; `infra/bootstrap`; `infra/app` with the two image buckets
- [ ] Images in S3: presigned upload, type check, presigned image links, delete; migration
- [ ] Claiming with `SKIP LOCKED` and `claimed_at`, stuck-item reset, async `wake()`
- [ ] Lambda handler for web requests, `process` and `migrate`; settings from Parameter Store
- [ ] README "Running it" and `.env.example`: the dev bucket and image settings
- [ ] Eval rerun

### 2c. Online
- [ ] `infra/app`: function, URL, roles, schedule, log group
- [ ] Zip with the linux arm64 build of sharp; deploy job; migrations after deploy
- [ ] Neon, Google redirect and parameters (by hand); first deploy; phone test
- [ ] README run and deploy sections; CLAUDE.md "Shape"

## Open questions

- Claude 5.5 on Bedrock is still "not available for this account". Once granted, set `SCREENSHOT_MODEL_ID=eu.anthropic.claude-haiku-5-5` and rerun the eval.

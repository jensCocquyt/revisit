# Revisit

## MVP 1 build specification

A pragmatic, production-aware vertical slice for saving links, understanding why they matter, and deciding what should happen next.

**Core stack:** API-first · TypeScript API · Python worker · PostgreSQL-backed jobs · Grounded AI

> **Product promise**
> Save a link, understand why it matters, decide what should happen next, and keep the path open to bring it back at the right moment.

## Product flow

1. **Capture** - URL with an optional note or goal.
2. **Understand** - Summary, takeaway, topics, grouping, and evidence.
3. **Decide** - Why the link was saved and what should happen next.
4. **Resurface** - Notify the user at the right moment.

MVP 1 delivers steps 1-3, including a grounded suggestion for when and why a link should return. MVP 2 closes the resurfacing loop.

## Final architecture decision

A TypeScript API and Python enrichment worker share one PostgreSQL database. A durable job table acts as the queue.

MVP 1 does **not** introduce a message broker, relay, separate queue datastore, object storage, or vector pipeline. These are added only when a measured requirement justifies them.

---

## 1. Product scope

MVP 1 is not a generic URL summarizer. Its core intelligence is understanding the user's reason for saving a link and recommending what should happen next.

### What the API accepts

- A URL.
- An optional note explaining why it was saved.
- An optional goal, for example `interview preparation`.
- An `Idempotency-Key` header for safe retries.

### What the AI returns

- A summary and one-line key takeaway.
- Topics and a suggested group.
- Save intent and recommended action.
- An optional revisit reason and suggested date.
- Verified evidence from the extracted content.

### Save intent: why was it saved?

Save intent describes the user's original reason for keeping the link. It is relatively stable.

| Value | Meaning |
|---|---|
| `reference` | Material worth keeping for future lookup. It does not require near-term attention. |
| `read_later` | Content the user intends to read or review when time permits. |
| `time_sensitive` | Content whose usefulness decreases if it is ignored for too long. |

### Recommended action: what should happen next?

Recommended action describes the next step. It can change as context changes.

| Value | Meaning | Example |
|---|---|---|
| `none` | No follow-up is needed. Keep the link as searchable reference material. | Stable framework documentation saved for future lookup. |
| `read_soon` | Read or review it in the near term while it remains relevant. No concrete external task is implied. | An article useful for an upcoming technical discussion. |
| `action` | The content implies a concrete task or decision. | Apply for a role, contact someone, change a configuration, or compare a product before buying. |
| `revisit` | Return at a later date or in a specific context. The result must include both the reason and suggested timing. | Recheck an announcement when a release date approaches. |

`none` is an expected result. The system should not manufacture reminders merely because a link was saved.

### Output purposes

| Output | Purpose |
|---|---|
| Understanding | Return a summary, takeaway, topics, and suggested group. |
| Decision | Classify the save intent and choose the appropriate recommended action. |
| Revisit suggestion | Only when justified, explain why and suggest when the link should return. |
| Verified evidence | Resolve important claims to exact offsets in stored extracted content. |

### Explicitly deferred

- Actual reminder scheduling and delivery.
- Browser extension, mobile share target, and frontend.
- Production multi-user authentication.
- SQS, a relay process, and a separate DLQ service.
- Object storage and permanent raw HTML retention.
- Embeddings, pgvector, and semantic similarity.

> **Scope rule**
> Build only what demonstrates the product and the engineering decisions. Document the scaling path, but do not pre-build it.

---

## 2. High-level architecture

PostgreSQL owns business state and the durable work queue. The API and worker are independently deployable containers, but MVP 1 has only three runtime components.

```text
Client
  |
  | POST /links
  v
TypeScript API
  - Hono container
  - validation and normalization
  - idempotency handling
  - atomic link + job creation
  |
  | one PostgreSQL transaction
  v
PostgreSQL
  - links
  - enrichment_jobs
  - enrichments
  - content_versions
  - idempotency_keys
  |
  | poll and claim
  v
Python worker
  - claim processing lease
  - safe fetch and extraction
  - Bedrock behind an AI seam
  - evidence verification
  - idempotent persistence
```

### Local environment

Docker Compose runs:

- TypeScript API.
- Python worker.
- PostgreSQL.

The deterministic AI stub is the default, so the complete offline flow works without cloud credentials.

### Cloud environment

- ECS Fargate runs one API service and one worker service.
- RDS PostgreSQL stores all durable state.
- Bedrock provides the real model.
- CloudWatch stores logs and a small set of operational metrics.

### Why no broker?

PostgreSQL already provides:

- Durable storage.
- Atomic link and job creation.
- Row locking and processing leases.
- Retry scheduling.
- Enough throughput for MVP 1.

A broker becomes justified when measured bursts, database contention, isolation needs, or independent consumer scaling make the additional component valuable.

---

## 3. Processing and correctness model

The job table is a small, explicit queue. It is not called an outbox because nothing is relayed to another system.

### Atomic submission

```sql
BEGIN;

INSERT INTO links (..., status)
VALUES (..., 'pending');

INSERT INTO enrichment_jobs
  (link_id, status, attempts, available_at)
VALUES
  (..., 'pending', 0, NOW());

COMMIT;
```

The API returns after the transaction commits. A failed transaction creates neither row.

### Job fields

| Field | Purpose |
|---|---|
| `status` | `pending`, `processing`, `completed`, or `failed`. |
| `attempts` | Number of completed processing attempts. |
| `available_at` | Next time the job may be claimed. |
| `locked_until` | Processing lease expiry. |
| `locked_by` | Worker instance holding the lease. |
| `last_error` | Stable error code plus safe diagnostic detail. |
| `completed_at` | Completion timestamp. |

### Claiming

The worker uses `FOR UPDATE SKIP LOCKED` to select one eligible job, marks it as `processing` with a lease, and commits the claim transaction.

The worker never holds a database transaction open while fetching a page or calling the model.

### Correctness guarantees

1. Link and job are created atomically.
2. Only one worker holds a valid lease for a job at a time.
3. Processing is at least once, not exactly once.
4. Expired leases become claimable again.
5. Result persistence is idempotent.
6. Failed jobs remain visible and can be manually requeued.

### Request idempotency

The idempotency key is stored with a hash of the normalized request.

- Same key and same request: return the original link.
- Same key and different request: return `409 Conflict`.

### Worker idempotency

Enrichments use a unique key such as:

```text
(link_id, content_hash, prompt_version)
```

A retry may repeat a model call, but it cannot create conflicting final results.

### Retry policy

Transient failures use bounded exponential backoff. After three attempts, the job and link become `failed`. A documented SQL statement or admin command can requeue the job.

### Terminal failures

The following fail immediately:

- Blocked destinations.
- Unsupported content types.
- Size-limit violations.
- Invalid or unsafe URLs.

The following may retry:

- Timeouts.
- Rate limits.
- Upstream `5xx` responses.
- Invalid model output.

---

## 4. End-to-end flow

1. **Capture**  
   `POST /links` receives the URL, optional note or goal, and idempotency key. The API validates and normalizes the request and creates a correlation ID.

2. **Commit atomically**  
   One PostgreSQL transaction inserts the link as `pending` and one `enrichment_job`. The API returns `201 Created` with the link ID.

3. **Claim**  
   The Python worker polls eligible jobs, claims one using `FOR UPDATE SKIP LOCKED`, writes a processing lease, and commits the claim transaction.

4. **Fetch safely**  
   Resolve the destination, block unsafe address ranges, revalidate redirects, and enforce time, size, and content-type limits.

5. **Extract**  
   Extract readable text and metadata, calculate a content hash, and store the cleaned content in PostgreSQL. Raw HTML is not retained by default.

6. **Understand**  
   One structured Bedrock call returns summary, takeaway, topics, suggested group, save intent, recommended action, optional revisit suggestion, and evidence.

7. **Verify and persist**  
   Evidence offsets are resolved against stored content. Unsupported evidence is removed. The worker idempotently stores the enrichment and marks the job complete.

8. **Observe**  
   `GET /links/:id` shows `pending`, `enriched`, or `failed`. `GET /links` filters by status, intent, action, topic, and group.

### Failure behavior

| Failure | Result |
|---|---|
| Database transaction fails | Neither link nor job exists; the API returns an error. |
| Worker crashes after claiming | The lease expires and another worker can claim the job. |
| Worker crashes after Bedrock succeeds | The job may repeat and incur another model call; idempotent persistence prevents conflicting results. |
| Page is blocked, unsupported, or too large | The job fails immediately with a stable failure reason. |
| Network or upstream service is temporarily unavailable | The job returns to `pending` with backoff and a future `available_at`. |
| Model output fails schema validation | The attempt is recorded and retried; after the retry limit the job becomes `failed`. |
| Evidence cannot be resolved | The unsupported item is dropped; the enrichment may still succeed and the drop count is logged. |

> **Operational stance**
> Failed work is visible in PostgreSQL and logs. Recovery is deliberately simple: inspect by correlation ID, fix the cause, and requeue the job. MVP 1 does not need a separate DLQ service.

---

## 5. AI, security, and proof

The important engineering work is safe ingestion, typed outputs, grounded evidence, deterministic tests, and an honest evaluation loop.

### Safe URL fetching

- Allow HTTP and HTTPS only.
- Resolve DNS before connecting.
- Block loopback, private, link-local, multicast, and cloud metadata ranges.
- Revalidate every redirect target.
- Limit redirect count, response size, duration, and content types.

### Untrusted content

Page text is data, never instructions.

- System instructions remain separate from extracted content.
- User note and goal remain separate from extracted content.
- MVP 1 does not execute arbitrary page JavaScript.

### Structured contract

The model returns strict typed JSON. Persist:

- Model ID.
- Prompt version.
- Latency.
- Token usage.
- Validation failures.

The deterministic stub implements the same contract as the real model.

### Grounded evidence

Evidence contains:

- A short quote.
- Start and end offsets.
- A reference to a versioned extracted-content record.

The worker verifies every evidence item before returning it. Unresolvable evidence is removed rather than guessed.

### Evaluation set

| Measure | What it proves |
|---|---|
| Schema validity | Every response matches the versioned result contract. |
| Save-intent accuracy | Classification matches labels for reference, read-later, and time-sensitive examples. |
| Recommended-action quality | The model chooses `none`, `read_soon`, `action`, or `revisit` sensibly. |
| False-revisit rate | The model does not manufacture reminders for links that do not need one. |
| Evidence resolution rate | Returned claims map to stored source text. |
| Latency and estimated cost | Prompt and model changes remain operationally visible. |

### Test strategy

CI uses fixed content snapshots and the deterministic stub for repeatability.

A small labelled set of roughly 15 varied URLs runs against the real model through a manual or release workflow. Its report is reviewed before prompt or model changes are accepted.

### Basic observability

- Structured logs with correlation ID, link ID, and job ID.
- Pending-job count and oldest pending-job age.
- Completed and failed job counts.
- Extraction and model latency.
- Token usage and estimated model cost.
- Evidence-drop and schema-validation counts.

Distributed tracing and a large alarm catalogue are intentionally deferred.

---

## 6. Pull request plan

Each PR is reviewable, keeps `main` green, and moves the product vertically.

### PR 1 - Foundation

- TypeScript API and Python worker workspaces.
- Docker Compose with PostgreSQL.
- Migrations for core tables.
- Versioned contracts and deterministic AI stub.
- Formatting, linting, unit tests, and GitHub Actions.

**Merge gate:** one command starts a healthy local stack and CI is green.

### PR 2 - Save and process offline

- `POST /links`, `GET /links/:id`, and request idempotency.
- Atomic link and enrichment-job transaction.
- Worker polling, short claim transaction, lease, retries, and stale-lease recovery.
- Stub enrichment and status write-back.

**Merge gate:** submit, poll, and enrich works end to end without an API key.

### PR 3 - Real enrichment

- SSRF-guarded fetching and content limits.
- Readable-text extraction, hashing, and versioned content storage.
- Bedrock structured output behind the existing AI seam.
- Save intent, recommended action, revisit suggestion, and evidence verification.

**Merge gate:** varied live pages produce typed, grounded results.

### PR 4 - Proof and resilience

- Integration tests for the complete stub path.
- Tests for duplicate processing, expired leases, retries, terminal failures, and request replay.
- Labelled evaluation set and repeatable report.
- Structured logs, basic metrics, and a requeue runbook.

**Merge gate:** failures are reproducible, visible, and recoverable.

### PR 5 - Cloud deployment and demo

- Terraform for ECS Fargate API and worker services.
- RDS PostgreSQL, Secrets Manager, IAM, and CloudWatch.
- Swagger UI, OpenAPI examples, and a small Postman collection.
- README with local and cloud run instructions.
- Architecture decisions and deliberate omissions.
- Demo: save, enrich, inspect evidence, show `none` and `revisit`, then recover a failure.

**Merge gate:** provision from zero and complete the full demo against the cloud URL.

### MVP 1 definition of done

A URL and optional context can be submitted through the API and asynchronously processed into a grounded analysis that explains:

- What it is.
- Why it matters.
- Where it belongs.
- Whether it should be ignored, read soon, acted on, or revisited later.

> **Delivery principle**
> Each PR leaves a demonstrable, working system. Infrastructure and resilience are added only after the offline product flow is proven.

---

## 7. Evolution path

The MVP stays deliberately small. Changes are triggered by measured product or operational needs, not by speculation.

| Capability | Add when | Likely change |
|---|---|---|
| Message broker | Bursts, database contention, isolation, or independent consumer scaling become measured problems. | Publish jobs to SQS and retain idempotent consumer behavior. |
| Object storage | Content size, retention, or download requirements outgrow PostgreSQL. | Move versioned source content to S3. |
| Related items | Similarity becomes a user-facing feature. | Add embeddings and pgvector with an explicit model and versioning strategy. |
| Resurfacing | Users can approve or edit revisit suggestions. | Add scheduling, due-item delivery, and feedback. |

### Architectural position

This is a production-aware vertical slice, not a production-complete platform. Every MVP 1 component exists because MVP 1 uses it. Future components are introduced only when a concrete requirement justifies them.

### Final stack

- Hono TypeScript API.
- Python enrichment worker.
- PostgreSQL.
- Bedrock.
- Docker Compose.
- ECS Fargate.
- RDS.
- Terraform.
- GitHub Actions.
- CloudWatch.

### Next product increment

Let the user approve, change, or dismiss a `revisit` recommendation. Only approved recommendations become scheduled reminders.

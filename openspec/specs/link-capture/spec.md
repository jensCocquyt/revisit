# link-capture Specification

## Purpose
Submitting a link with optional context and retrieving it by ID: request validation, idempotent submission via the Idempotency-Key header, atomic link + enrichment-job creation, the stored representation exposed by the API, OpenAPI documentation, and the Bruno collection that tracks the API surface.
## Requirements
### Requirement: Submit a link
The API SHALL accept `POST /links` with a JSON body containing `url` (required), `note` (optional), and `goal` (optional), and an `Idempotency-Key` header (required). On success it SHALL respond `201 Created` with the stored link representation, including its generated ID and `pending` status.

#### Scenario: Save a valid link
- **GIVEN** a running API with a reachable database
- **WHEN** a client sends `POST /links` with a valid `http` or `https` URL, an optional note and goal, and a new `Idempotency-Key`
- **THEN** the response is `201 Created`
- **AND** the body contains the link's ID, URL, note, goal, `status: "pending"`, and creation timestamp

#### Scenario: Unknown body fields are rejected
- **WHEN** a client sends `POST /links` with a body containing a field other than `url`, `note`, or `goal`
- **THEN** the response is `400 Bad Request` and no database records are created

### Requirement: Atomic link and job creation
A committed link SHALL always have exactly one initial enrichment job, created in the same PostgreSQL transaction as the link. If the transaction fails, neither row SHALL exist. No enrichment processing runs in the API request path.

#### Scenario: Both rows commit together
- **WHEN** `POST /links` succeeds
- **THEN** the database contains exactly one new `links` row with status `pending`
- **AND** exactly one `enrichment_jobs` row for that link with status `pending`, `attempts` 0, and an `available_at` that is not in the future

#### Scenario: Failure creates neither row
- **GIVEN** the database rejects the enrichment-job insert inside the submission transaction
- **WHEN** a client sends an otherwise valid `POST /links`
- **THEN** the response is a `5xx` error
- **AND** the database contains no new link row and no new job row for that request

### Requirement: Request validation
The API SHALL validate submissions before touching the database. Invalid requests SHALL receive a `4xx` response with a JSON error body and SHALL NOT create any database records. A URL is valid only if it parses as an absolute `http` or `https` URL. Field length limits: `url` at most 2048 characters, `note` at most 2000 characters, `goal` at most 200 characters.

#### Scenario: Missing URL
- **WHEN** a client sends `POST /links` without a `url` field
- **THEN** the response is `400 Bad Request` and no rows are created

#### Scenario: Invalid URL scheme
- **WHEN** a client sends `POST /links` with a URL such as `ftp://example.com` or `not a url`
- **THEN** the response is `400 Bad Request` and no rows are created

#### Scenario: Over-limit field length
- **WHEN** a client sends `POST /links` with a `note` longer than 2000 characters or a `goal` longer than 200 characters
- **THEN** the response is `400 Bad Request` and no rows are created

#### Scenario: Missing Idempotency-Key header
- **WHEN** a client sends `POST /links` without an `Idempotency-Key` header
- **THEN** the response is `400 Bad Request` and no rows are created

### Requirement: Idempotent submission
The API SHALL store each `Idempotency-Key` with a hash of the normalized request. Replaying the same key with the same request SHALL return the original link and create no additional links, jobs, or idempotency rows. The same key with a different request SHALL return `409 Conflict`. This SHALL hold under concurrent duplicate submissions.

#### Scenario: Replay returns the original link
- **GIVEN** a link was created with a given `Idempotency-Key`
- **WHEN** the identical request is sent again with the same key
- **THEN** the response returns the original link with status `2xx`
- **AND** the database contains no additional link or job rows

#### Scenario: Key reuse with a different request conflicts
- **GIVEN** a link was created with a given `Idempotency-Key`
- **WHEN** a request with the same key but a different URL, note, or goal is sent
- **THEN** the response is `409 Conflict` and no rows are created

#### Scenario: Concurrent duplicate submissions
- **WHEN** two identical `POST /links` requests with the same `Idempotency-Key` race
- **THEN** exactly one link and one job exist afterwards
- **AND** both clients receive the same link

### Requirement: Retrieve a link
The API SHALL serve `GET /links/:id` returning the current stored representation of the link, including its status, plus two facets derived from its latest contract-valid enrichment: `tags` (the enrichment's tag list) and `deadline` (the enrichment's deadline date as an ISO date string, or `null`). A link with no enrichment, or whose latest stored result fails contract validation, SHALL carry `tags: []` and `deadline: null`. The same representation SHALL be returned by `POST /links` and by every item of `GET /links`.

#### Scenario: Fetch an existing link
- **GIVEN** a link was created via `POST /links`
- **WHEN** a client sends `GET /links/:id` with that link's ID
- **THEN** the response is `200 OK` with the stored URL, note, goal, `status: "pending"`, `tags: []`, and `deadline: null`

#### Scenario: Fetch an enriched link
- **GIVEN** a link whose latest enrichment carries tags `["python", "eol"]` and a deadline dated `2027-10-31`
- **WHEN** a client sends `GET /links/:id`
- **THEN** the response carries `status: "enriched"`, `tags: ["python", "eol"]`, and `deadline: "2027-10-31"`

#### Scenario: Facets follow the latest enrichment
- **GIVEN** a link with an older enrichment tagged `["python"]` and a newer one tagged `["rust"]` without a deadline
- **WHEN** a client sends `GET /links/:id`
- **THEN** the response carries `tags: ["rust"]` and `deadline: null`

#### Scenario: Unknown link ID
- **WHEN** a client sends `GET /links/:id` with a well-formed UUID that matches no link
- **THEN** the response is `404 Not Found`

#### Scenario: Malformed link ID
- **WHEN** a client sends `GET /links/:id` with an ID that is not a valid UUID
- **THEN** the response is a `4xx` error, not a `5xx` error

### Requirement: API documentation
All endpoints SHALL be described in an OpenAPI document served by the API, with request and response schemas derived from the same validation definitions the handlers use. The enrichment result schema in the document SHALL be the API's contract definition itself, so the documented shape and the served shape cannot diverge.

#### Scenario: OpenAPI document lists the endpoints
- **WHEN** a client fetches the OpenAPI document
- **THEN** it describes `POST /links`, `GET /links`, `GET /links/:id`, and `GET /links/:id/enrichment`, including the `Idempotency-Key` header requirement, the list query parameters (`status`, `tag`, `limit`, `cursor`), the `tags` and `deadline` fields of the link representation, the `EnrichmentResult` component, and the error responses

#### Scenario: Read routes declare the API-key scheme
- **WHEN** a client fetches the OpenAPI document
- **THEN** `GET /links` and `GET /links/:id/enrichment` declare the `ApiKey` security requirement like the existing link routes, and `GET /health` declares none

### Requirement: Bruno collection stays in sync with the API
The repository SHALL contain a Bruno collection importable into Bruno that covers every endpoint the API serves (health, save, list, retrieve, enrichment), parameterized by environment for the base URL and API key. Each request SHALL carry a `docs` block explaining what it exercises and, for requests whose outcome depends on the worker, how to run it against the cloud environment. The test suite SHALL fail when the collection and the API's documented routes diverge in either direction.

#### Scenario: Collection is importable and covers the API
- **GIVEN** the repository's Bruno collection directory
- **WHEN** a user imports it into Bruno and runs it against a locally running stack
- **THEN** it contains runnable requests for `GET /health`, `POST /links` (with `Idempotency-Key` header and example body), `GET /links` (with `limit` and filter parameters), `GET /links/:id`, and `GET /links/:id/enrichment`, the last two using the id captured from "Save link"

#### Scenario: Drift fails the test suite
- **WHEN** an API route exists that has no corresponding request in the collection, or the collection contains a request for a route the API does not serve
- **THEN** the API test suite fails, identifying the missing or stale request


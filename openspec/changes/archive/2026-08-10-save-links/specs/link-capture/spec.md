# link-capture

## ADDED Requirements

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
The API SHALL serve `GET /links/:id` returning the current stored representation of the link, including its status.

#### Scenario: Fetch an existing link
- **GIVEN** a link was created via `POST /links`
- **WHEN** a client sends `GET /links/:id` with that link's ID
- **THEN** the response is `200 OK` with the stored URL, note, goal, and `status: "pending"`

#### Scenario: Unknown link ID
- **WHEN** a client sends `GET /links/:id` with a well-formed UUID that matches no link
- **THEN** the response is `404 Not Found`

#### Scenario: Malformed link ID
- **WHEN** a client sends `GET /links/:id` with an ID that is not a valid UUID
- **THEN** the response is a `4xx` error, not a `5xx` error

### Requirement: API documentation
Both endpoints SHALL be described in an OpenAPI document served by the API, with request and response schemas derived from the same validation definitions the handlers use.

#### Scenario: OpenAPI document lists the endpoints
- **WHEN** a client fetches the OpenAPI document
- **THEN** it describes `POST /links` and `GET /links/:id`, including the `Idempotency-Key` header requirement and the error responses

### Requirement: Bruno collection stays in sync with the API
The repository SHALL contain a Bruno collection importable into Bruno that covers every endpoint the API serves (health, save, retrieve), parameterized by environment for the local base URL. The test suite SHALL fail when the collection and the API's documented routes diverge in either direction.

#### Scenario: Collection is importable and covers the API
- **GIVEN** the repository's Bruno collection directory
- **WHEN** a user imports it into Bruno and runs it against a locally running stack
- **THEN** it contains runnable requests for `GET /health`, `POST /links` (with `Idempotency-Key` header and example body), and `GET /links/:id`

#### Scenario: Drift fails the test suite
- **WHEN** an API route exists that has no corresponding request in the collection, or the collection contains a request for a route the API does not serve
- **THEN** the API test suite fails, identifying the missing or stale request

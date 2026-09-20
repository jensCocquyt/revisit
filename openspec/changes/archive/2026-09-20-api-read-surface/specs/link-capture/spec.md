## MODIFIED Requirements

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

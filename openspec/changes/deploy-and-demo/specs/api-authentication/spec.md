# api-authentication Delta

## ADDED Requirements

### Requirement: Static API key guards the public API when configured
When the `API_KEY` environment variable is set, the API SHALL reject requests to link endpoints whose `x-api-key` header does not equal it with `401 {"error": "unauthorized"}`, before any request processing. `GET /health`, `GET /openapi.json`, and `GET /docs` SHALL remain unauthenticated (health checks and the demonstration surface). The OpenAPI document SHALL declare the key as an `apiKey` security scheme so Swagger UI can send it. This is spend protection for a public demo endpoint, not authentication; multi-user auth remains deferred.

#### Scenario: Missing key is rejected
- **GIVEN** the API runs with `API_KEY` set
- **WHEN** a request hits `POST /links` or `GET /links/:id` without a valid `x-api-key` header
- **THEN** the API responds `401 {"error": "unauthorized"}` and no link or job is created

#### Scenario: Valid key passes through
- **GIVEN** the API runs with `API_KEY` set
- **WHEN** a request carries the matching `x-api-key` header
- **THEN** the request behaves exactly as before this change, including idempotency semantics

#### Scenario: Health stays open
- **GIVEN** the API runs with `API_KEY` set
- **WHEN** `GET /health` is requested without a key
- **THEN** it responds normally, so load balancer health checks need no credentials

#### Scenario: Unset key disables enforcement
- **GIVEN** the API runs without `API_KEY` (local compose, existing tests)
- **WHEN** any request arrives without a key header
- **THEN** behavior is unchanged from before this change

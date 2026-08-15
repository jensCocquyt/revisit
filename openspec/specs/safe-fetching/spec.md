# safe-fetching Specification

## Purpose
SSRF-guarded fetching of saved link URLs: scheme allowlisting, pre-connect DNS resolution with address-range blocking, per-hop redirect revalidation, response limits (size, duration, content type), the narrow test/CI host allowlist, and offline testability via an injectable resolver.

## Requirements
### Requirement: Only HTTP and HTTPS URLs are fetched
The worker SHALL fetch only `http` and `https` URLs. Any other scheme, or a URL that cannot be parsed, SHALL be classified as a terminal failure with a stable error code and SHALL NOT be retried.

#### Scenario: Non-HTTP scheme is rejected
- **GIVEN** a claimed job for a link whose URL is `ftp://example.com/file`
- **WHEN** the worker processes it
- **THEN** the job and link become `failed` on the first attempt with `last_error` starting with a stable invalid-URL code

#### Scenario: Unparseable URL is rejected
- **GIVEN** a link whose URL cannot be parsed as an absolute HTTP(S) URL
- **WHEN** the worker processes its job
- **THEN** the job fails terminally with the stable invalid-URL code and `attempts` shows a single attempt

### Requirement: Destination addresses are resolved and validated before connecting
Before connecting, the worker SHALL resolve the destination hostname via DNS and validate every resolved address. If any resolved address is loopback, private, link-local, multicast, unspecified, or a cloud-metadata address (including `169.254.169.254`), the fetch SHALL be classified as a blocked destination — a terminal failure with a stable error code, never retried. Hostnames that fail to resolve SHALL be treated as a transient failure.

#### Scenario: Cloud metadata endpoint is blocked
- **GIVEN** a link whose URL is `http://169.254.169.254/latest/meta-data/`
- **WHEN** the worker processes its job
- **THEN** no connection is attempted, and the job and link become `failed` immediately with `last_error` starting with a stable blocked-destination code

#### Scenario: Hostname resolving to a private address is blocked
- **GIVEN** a hostname that resolves to `10.0.0.5`
- **WHEN** the worker fetches it
- **THEN** the fetch is classified as a blocked destination and fails terminally without connecting

#### Scenario: Hostname resolving to loopback is blocked
- **GIVEN** a hostname that resolves to `127.0.0.1` or `::1`
- **WHEN** the worker fetches it
- **THEN** the fetch is classified as a blocked destination and fails terminally

#### Scenario: DNS resolution failure is transient
- **GIVEN** a hostname that does not resolve
- **WHEN** the worker fetches it
- **THEN** the failure is classified as transient and the job is rescheduled with backoff

### Requirement: Every redirect target is revalidated
The worker SHALL follow redirects manually, applying the same scheme and resolved-address validation to every redirect target before connecting to it. Exceeding the configured maximum number of redirects SHALL be a terminal failure with a stable error code.

#### Scenario: Redirect to a blocked address is caught
- **GIVEN** a public URL that responds with a redirect to `http://169.254.169.254/`
- **WHEN** the worker fetches it
- **THEN** the redirect target is validated, the fetch is classified as a blocked destination, and the job fails terminally

#### Scenario: Redirect chain over the limit fails terminally
- **GIVEN** a URL whose redirect chain exceeds the configured redirect limit
- **WHEN** the worker fetches it
- **THEN** the fetch fails terminally with a stable redirect-limit error code

#### Scenario: Valid redirect chain within the limit succeeds
- **GIVEN** a public URL that redirects once to another public URL serving HTML
- **WHEN** the worker fetches it
- **THEN** the final response body is returned for extraction

### Requirement: Response limits are enforced
The worker SHALL enforce a maximum response size, a total fetch duration limit, and an allowlist of response content types. A response exceeding the size limit or carrying a disallowed content type SHALL be a terminal failure with a stable error code. Exceeding the duration limit SHALL be a transient failure.

#### Scenario: Oversized response fails terminally
- **GIVEN** a response whose body exceeds the configured maximum size
- **WHEN** the worker fetches it
- **THEN** the fetch is aborted and the job fails terminally with a stable size-limit error code

#### Scenario: Disallowed content type fails terminally
- **GIVEN** a response with content type `application/pdf`
- **WHEN** the worker fetches it
- **THEN** the job fails terminally with a stable unsupported-content-type error code

#### Scenario: Timeout is transient
- **GIVEN** a fetch that exceeds the configured duration limit
- **WHEN** the worker handles the failure
- **THEN** the failure is classified as transient and the job is rescheduled with backoff

### Requirement: Upstream HTTP errors are transient
Non-success HTTP responses — including `429` rate limits, `5xx` server errors, and other non-redirect, non-success statuses — and connection-level errors SHALL be classified as transient failures, subject to the existing bounded-backoff retry policy and terminal after the configured maximum attempts.

#### Scenario: Rate limit retries
- **GIVEN** a fetch that receives `429 Too Many Requests`
- **WHEN** the worker handles the failure
- **THEN** the job returns to `pending` with backoff and a stable fetch-error code in `last_error`

#### Scenario: Upstream 5xx retries
- **GIVEN** a fetch that receives `503 Service Unavailable`
- **WHEN** the worker handles the failure
- **THEN** the failure is classified as transient and the job is rescheduled

### Requirement: Fetch limits are configurable with safe defaults
Redirect limit, maximum response size, fetch duration, and the content-type allowlist SHALL be configurable via environment variables with working defaults documented in `.env.example` and wired through Docker Compose. A host allowlist environment variable, empty by default, SHALL let named hostnames bypass the resolved-address blocklist (scheme and limit checks still apply) so an in-network fixture can be fetched in tests and CI. Address-range blocking itself SHALL NOT be otherwise disableable.

#### Scenario: Defaults are safe without configuration
- **WHEN** the worker starts from an unedited `.env.example`
- **THEN** fetching enforces the default limits and blocks private and metadata address ranges

#### Scenario: Allowlisted host bypasses only the address check
- **GIVEN** the host allowlist contains `fixture`
- **WHEN** the worker fetches `http://fixture/` resolving to a private compose address
- **THEN** the fetch proceeds, while size, duration, redirect, and content-type limits still apply

### Requirement: The SSRF guard is testable without network access
Address validation SHALL depend on an injectable DNS resolver so the guard's decisions are unit-testable offline, without performing real DNS lookups or connections.

#### Scenario: Guard matrix runs offline
- **WHEN** the worker test suite exercises blocked and allowed address cases with a fake resolver
- **THEN** the tests pass with no network access

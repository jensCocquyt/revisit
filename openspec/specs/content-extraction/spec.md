# content-extraction Specification

## Purpose
Deterministic extraction of readable text and metadata from fetched pages, and its storage as content-hashed versioned records in `content_versions` with idempotent dedupe on `(link_id, content_hash)`.

## Requirements
### Requirement: Readable text and metadata are extracted deterministically
The worker SHALL extract readable text and available metadata (at minimum the page title when present) from fetched HTML. Extraction SHALL be deterministic: the same HTML input produces byte-identical extracted text. Raw HTML SHALL NOT be persisted.

#### Scenario: Extraction is deterministic
- **GIVEN** a fixed HTML snapshot
- **WHEN** it is extracted twice
- **THEN** both runs produce identical extracted text, title, and metadata

#### Scenario: Boilerplate is not the content
- **GIVEN** an HTML snapshot with navigation, scripts, and an article body
- **WHEN** it is extracted
- **THEN** the extracted text contains the article body and not the script contents

### Requirement: Empty extraction is a terminal failure
When extraction yields no readable text, the job SHALL fail terminally with a stable error code, because retrying the same page cannot produce content.

#### Scenario: Contentless page fails terminally
- **GIVEN** a fetched page from which no readable text can be extracted
- **WHEN** the worker processes the job
- **THEN** the job and link become `failed` on that attempt with a stable empty-content error code

### Requirement: Extracted content is stored as a versioned record
The worker SHALL compute `content_hash` as a SHA-256 over the extracted text and store the extracted text, title, and metadata as a `content_versions` row keyed by `(link_id, content_hash)`, committed in a short transaction before enrichment begins. Storage SHALL be idempotent: when a row for `(link_id, content_hash)` already exists, the existing row is reused and no duplicate is created.

#### Scenario: Content version is created
- **GIVEN** a link whose page is fetched and extracted for the first time
- **WHEN** the worker processes the job
- **THEN** a `content_versions` row exists for the link containing the extracted text, its SHA-256 `content_hash`, and the title

#### Scenario: Identical re-fetch reuses the existing version
- **GIVEN** a link that already has a `content_versions` row for the current content
- **WHEN** the job is processed again and the fetch yields identical extracted text
- **THEN** exactly one `content_versions` row exists for `(link_id, content_hash)` and the enrichment references it

#### Scenario: Changed content creates a new version
- **GIVEN** a link with an existing `content_versions` row
- **WHEN** a re-fetch yields different extracted text
- **THEN** a second `content_versions` row exists for the link with the new `content_hash`

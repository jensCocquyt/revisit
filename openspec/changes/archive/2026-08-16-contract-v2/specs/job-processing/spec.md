# job-processing Specification (delta)

## MODIFIED Requirements

### Requirement: Evidence is verified against stored content before persistence
Before persisting a result, the worker SHALL verify each evidence item — including a deadline's `source` item — against the stored extracted text: an item resolves only if its quote appears verbatim in the text, and its offsets SHALL be normalized to the verbatim match location. Evidence items whose quote does not appear verbatim SHALL be dropped, not corrected by guesswork. If a deadline's `source` quote does not resolve, the entire `deadline` SHALL be dropped — a date without resolvable page support is never persisted. Dropped evidence counts and dropped deadlines SHALL be logged. Dropping evidence or a deadline SHALL NOT by itself fail the enrichment.

#### Scenario: Mismatched offsets are repaired from the verbatim quote
- **GIVEN** an enricher result containing an evidence item whose quote appears in the extracted text but whose offsets point elsewhere
- **WHEN** the worker verifies evidence
- **THEN** the persisted item's offsets identify the verbatim occurrence of the quote in the stored text

#### Scenario: Unresolvable evidence is dropped and counted
- **GIVEN** a result with three evidence items, one of which quotes text not present in the stored content
- **WHEN** the worker verifies evidence
- **THEN** the persisted result contains the two resolvable items, and a log entry records one dropped item

#### Scenario: Unresolvable deadline source drops the deadline
- **GIVEN** a result asserting a deadline whose `source` quote does not appear in the stored extracted text
- **WHEN** the worker verifies evidence
- **THEN** the persisted result has no `deadline`, and a log entry records the dropped deadline

#### Scenario: Persisted evidence resolves exactly
- **WHEN** any enrichment is persisted
- **THEN** every evidence item's — and any deadline source's — `[start_offset, end_offset)` slice of the stored extracted text equals its quote

## ADDED Requirements

### Requirement: Tag vocabulary is read before enrichment
Before invoking the enricher, the worker SHALL read the library's existing tag vocabulary from stored enrichments — distinct tags ordered by frequency, capped — and pass it as the enricher input's `known_tags`. The read SHALL happen outside any open transaction, like all database work around slow operations. An empty library yields an empty vocabulary and enrichment proceeds.

#### Scenario: Vocabulary flows into enrichment
- **GIVEN** stored enrichments whose results carry tags
- **WHEN** the worker processes a new job
- **THEN** the enricher receives those tags as `known_tags`, most frequent first

#### Scenario: Cold start with no vocabulary
- **GIVEN** an empty `enrichments` table
- **WHEN** the worker processes a job
- **THEN** the enricher receives an empty vocabulary and the job completes normally

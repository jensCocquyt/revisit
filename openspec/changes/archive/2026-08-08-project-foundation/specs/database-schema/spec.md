## ADDED Requirements

### Requirement: Migrations are the only schema mechanism
The system SHALL apply all database schema changes through ordered SQL migration files, runnable with a single command locally, in Docker Compose, and in CI.

#### Scenario: Fresh database migrates cleanly
- **WHEN** migrations run against an empty PostgreSQL database
- **THEN** all migrations apply in order without error and the applied versions are recorded

#### Scenario: Re-running is a no-op
- **WHEN** migrations run a second time against an already-migrated database
- **THEN** no migration is re-applied and the command exits successfully

### Requirement: Core tables exist after migration
Migrations SHALL create the `links`, `enrichment_jobs`, `enrichments`, `content_versions`, and `idempotency_keys` tables with the columns and constraints the build spec defines.

#### Scenario: All core tables present
- **WHEN** migrations complete on a fresh database
- **THEN** all five core tables exist

#### Scenario: Job queue columns support leasing
- **WHEN** the `enrichment_jobs` table is inspected after migration
- **THEN** it contains `status`, `attempts`, `available_at`, `locked_until`, `locked_by`, `last_error`, and `completed_at` columns

#### Scenario: Enrichment idempotency is enforced by the schema
- **WHEN** two rows with the same `(link_id, content_hash, prompt_version)` are inserted into `enrichments`
- **THEN** the second insert is rejected by a unique constraint

#### Scenario: Link-job relationship is enforced
- **WHEN** an `enrichment_jobs` row is inserted referencing a non-existent link
- **THEN** the insert is rejected by a foreign-key constraint

-- migrate:up

CREATE TABLE links (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    url             text NOT NULL,
    normalized_url  text NOT NULL,
    note            text,
    goal            text,
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'enriched', 'failed')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX links_status_idx ON links (status);
CREATE INDEX links_normalized_url_idx ON links (normalized_url);

CREATE TABLE enrichment_jobs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id       uuid NOT NULL REFERENCES links (id),
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts      integer NOT NULL DEFAULT 0,
    available_at  timestamptz NOT NULL DEFAULT now(),
    locked_until  timestamptz,
    locked_by     text,
    last_error    text,
    completed_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Claim query filter: eligible pending jobs ordered by availability.
CREATE INDEX enrichment_jobs_claim_idx ON enrichment_jobs (status, available_at);
CREATE INDEX enrichment_jobs_link_id_idx ON enrichment_jobs (link_id);

CREATE TABLE content_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id         uuid NOT NULL REFERENCES links (id),
    content_hash    text NOT NULL,
    extracted_text  text NOT NULL,
    title           text,
    metadata        jsonb,
    extracted_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (link_id, content_hash)
);

CREATE TABLE enrichments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id             uuid NOT NULL REFERENCES links (id),
    content_version_id  uuid REFERENCES content_versions (id),
    content_hash        text NOT NULL,
    prompt_version      text NOT NULL,
    contract_version    text NOT NULL,
    result              jsonb NOT NULL,
    model_id            text,
    latency_ms          integer,
    token_usage         jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- Worker idempotency: a retry may repeat a model call but cannot
    -- create conflicting final results for the same input.
    UNIQUE (link_id, content_hash, prompt_version)
);

CREATE INDEX enrichments_link_id_idx ON enrichments (link_id);

CREATE TABLE idempotency_keys (
    key           text PRIMARY KEY,
    request_hash  text NOT NULL,
    link_id       uuid NOT NULL REFERENCES links (id),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- migrate:down

DROP TABLE idempotency_keys;
DROP TABLE enrichments;
DROP TABLE content_versions;
DROP TABLE enrichment_jobs;
DROP TABLE links;

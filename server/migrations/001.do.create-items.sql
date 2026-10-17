CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  url text,
  title text,
  note text,
  body text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX items_created_at ON items (created_at DESC);

CREATE TABLE passages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  position integer NOT NULL,
  text text NOT NULL,
  words tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  embedding vector(1024) NOT NULL,
  UNIQUE (item_id, position)
);

CREATE INDEX passages_words ON passages USING gin (words);
CREATE INDEX passages_text_trigrams ON passages USING gin (text gin_trgm_ops);

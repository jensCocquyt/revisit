CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

-- Nullable until items saved before sign-in existed are claimed by the owner.
ALTER TABLE items ADD COLUMN user_id uuid REFERENCES users (id);

DROP INDEX items_url;
CREATE UNIQUE INDEX items_user_url ON items (user_id, url);

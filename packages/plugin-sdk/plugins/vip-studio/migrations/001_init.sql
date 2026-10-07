-- Studio VIP: catalogul (toate tipurile într-un tabel), categoriile, echipamentele membrilor și jurnalul din ACP,
-- în schema proprie a pluginului.
CREATE TABLE categories (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE items (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  category_id integer REFERENCES categories (id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}',
  plans text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  retired boolean NOT NULL DEFAULT false,
  media_ids text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key)
);

CREATE INDEX items_kind_position ON items (kind, position, id);

-- Alegerile unui membru; `test_mode` = salvate de cineva cu dreptul de test (Root / Admin), fără plan VIP.
CREATE TABLE loadouts (
  user_id text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}',
  test_mode boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loadouts_updated ON loadouts (updated_at DESC);

CREATE TABLE audit (
  id serial PRIMARY KEY,
  actor_id text,
  action text NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

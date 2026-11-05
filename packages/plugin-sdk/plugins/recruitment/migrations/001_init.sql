-- Recrutare: posturile din echipă și aplicațiile membrilor, în schema proprie a pluginului.
-- `status`: open (ON), new (deschis, evidențiat NOU), closed (OFF). `apply_mode`: form (formularul pluginului),
-- topic (un topic nou în forumul ales), link (o adresă). `group_id`: grupul postului (doar informativ).
CREATE TABLE positions (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  group_id integer,
  icon text NOT NULL DEFAULT '',
  apply_mode text NOT NULL DEFAULT 'form',
  apply_forum_id integer,
  apply_url text NOT NULL DEFAULT '',
  questions text NOT NULL DEFAULT '',
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX positions_sort ON positions (sort, id);

-- `status`: pending, accepted, rejected. `answers`: textul trimis de membru (deja curățat).
CREATE TABLE applications (
  id serial PRIMARY KEY,
  position_id integer NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
  user_id text NOT NULL,
  answers text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  note text NOT NULL DEFAULT '',
  handled_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz
);

CREATE INDEX applications_position ON applications (position_id, created_at DESC);
CREATE INDEX applications_user ON applications (user_id, status);
CREATE INDEX applications_status ON applications (status, created_at DESC);

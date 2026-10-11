-- Tickete suport: ticketele, mesajele (răspunsuri și note interne), istoricul acțiunilor și citirile (pentru „nou”),
-- în schema proprie a pluginului.
CREATE TABLE tickets (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  subject text NOT NULL,
  category text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  assignee_id text,
  replies integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_reply_at timestamptz NOT NULL DEFAULT now(),
  last_reply_by text,
  first_staff_reply_at timestamptz,
  closed_at timestamptz
);

CREATE INDEX tickets_user ON tickets (user_id, updated_at DESC);
CREATE INDEX tickets_status ON tickets (status, updated_at DESC);
CREATE INDEX tickets_assignee ON tickets (assignee_id, status);

-- `internal` = notă vizibilă doar staff-ului; `staff` = scrisă de cineva cu dreptul de gestionare.
CREATE TABLE messages (
  id serial PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  user_id text,
  body text NOT NULL,
  staff boolean NOT NULL DEFAULT false,
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_ticket ON messages (ticket_id, id);

-- Schimbările de stare, prioritate, categorie și responsabil, afișate în firul ticketului.
CREATE TABLE events (
  id serial PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  actor_id text,
  action text NOT NULL,
  value text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_ticket ON events (ticket_id, id);

CREATE TABLE reads (
  ticket_id integer NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  user_id text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

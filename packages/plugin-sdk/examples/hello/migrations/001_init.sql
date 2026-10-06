-- Postările noi văzute de plugin (listenerul `post.created`), în schema proprie a pluginului.
CREATE TABLE greetings_log (
  id serial PRIMARY KEY,
  post_id integer NOT NULL,
  topic_id integer NOT NULL,
  author_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX greetings_log_created ON greetings_log (created_at DESC);

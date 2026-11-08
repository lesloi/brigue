-- The journal splits in two: a public chronicle and one mailbox per dynasty.
--
-- The chronicle is what the town remembers of its own affairs: today the
-- elections that changed a seat, tomorrow its laws. It is small enough to read
-- as a page, and every reader sees the same one.
--
-- A private line — a refusal, a workshop built or lost, a penniless hour, an
-- election result — belongs to one dynasty and would drown the chronicle. The
-- `events` table keeps the town's line and drops the ones it held for a
-- dynasty; the boxes wait for a reset in the towns that still carry them.
DELETE FROM events WHERE audience <> 'town';
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_check;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_audience_check;
ALTER TABLE events DROP COLUMN dynasty_id;
ALTER TABLE events ADD CONSTRAINT events_chronicle_only CHECK (audience = 'town');

CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- A mailbox is addressed by its dynasty. A human dynasty id is minted once
  -- for the whole server (`dynasty-<uuid>`), and an AI one has no mailbox, so
  -- the id alone names the box; the writer deletes a town's mail with the town.
  dynasty_id text NOT NULL CHECK (length(dynasty_id) > 0),
  -- A notice carries its kind and the fields of its sentence. Prose — a letter
  -- from a player, later a rumour from the town — carries neither: its `type`
  -- is null and its text lives in `body`.
  type text,
  payload jsonb,
  body text,
  -- Who wrote a prose message. Null when the town wrote it; never set on a
  -- notice, whose author is the simulation. The server fills it from the
  -- session, never from the request body.
  author_dynasty_id text CHECK (author_dynasty_id IS NULL OR length(author_dynasty_id) > 0),
  -- A message is unread until the player opens the Courrier; the flag is the
  -- whole unread state, so no cursor lives on the account.
  read boolean NOT NULL DEFAULT false,
  -- The instant it was written, and nothing else: retention follows the real
  -- clock, and the ids order the page. A message carries no town hour.
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- Exactly one shape: a notice has a type and its payload, prose has a body.
  CHECK ((type IS NULL) = (body IS NOT NULL)),
  CHECK ((type IS NULL) <> (payload IS NOT NULL)),
  -- A notice has no player author; prose may or may not have one.
  CHECK (type IS NULL OR author_dynasty_id IS NULL)
);

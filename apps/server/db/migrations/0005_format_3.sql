-- The town, in tables instead of one document. One world per database, so no
-- table carries a world_id: these rows ARE the town.
--
-- The shape here is the format that follows — hours instead of weeks, due_at
-- instead of due_week — and the code that fills it lands in the same branch.
-- Until it does, these tables are empty and nothing reads them.
--
-- The release that ships this format starts at version one and squashes the
-- earlier migrations: the town that ran before is a test town.

CREATE TABLE state (
  -- One row, forever. It is the row the writer locks, so the constraint is not
  -- decoration: a second row would be a second town.
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  format_version integer NOT NULL,
  ruleset_version integer NOT NULL,
  seed integer NOT NULL,
  rng integer NOT NULL,
  hour integer NOT NULL CHECK (hour >= 1),
  year integer NOT NULL,
  engagement_seq integer NOT NULL DEFAULT 0
);

CREATE TABLE houses (
  id text PRIMARY KEY CHECK (length(id) > 0),
  name text NOT NULL CHECK (length(name) > 0),
  controller text NOT NULL CHECK (controller IN ('ai', 'human')),
  treasury_cents integer NOT NULL,
  debt_cents integer NOT NULL,
  favour integer NOT NULL,
  prestige integer NOT NULL,
  career integer NOT NULL,
  dormant boolean NOT NULL DEFAULT false
);

CREATE TABLE people (
  id text PRIMARY KEY CHECK (length(id) > 0),
  house_id text NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  name text NOT NULL,
  age integer NOT NULL,
  artisanat integer NOT NULL,
  parole integer NOT NULL,
  intrigue integer NOT NULL,
  alive boolean NOT NULL
);

CREATE INDEX people_house ON people (house_id);

-- `position` holds the order the core writes and reads: the world has arrays,
-- and an array is part of the state hash. Loading in a different order would
-- give the same town two hashes.
CREATE TABLE workshops (
  house_id text NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  position integer NOT NULL,
  good text NOT NULL,
  level integer NOT NULL,
  workers integer NOT NULL,
  PRIMARY KEY (house_id, position)
);

CREATE TABLE stock (
  house_id text NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  good text NOT NULL,
  units integer NOT NULL CHECK (units >= 0),
  PRIMARY KEY (house_id, good)
);

CREATE TABLE seats (
  seat_id text PRIMARY KEY,
  person_id text REFERENCES people (id) ON DELETE SET NULL
);

CREATE TABLE laws (
  id text PRIMARY KEY CHECK (length(id) > 0),
  position integer NOT NULL,
  title text NOT NULL,
  sponsor_house_id text NOT NULL REFERENCES houses (id),
  enacted_at integer NOT NULL
);

-- A campaign has no duration any more: it is a candidacy, and it counts for one
-- scrutiny. A hearing and a site still have one, so they carry the instant they
-- fall due.
CREATE TABLE engagements (
  id text PRIMARY KEY CHECK (length(id) > 0),
  kind text NOT NULL CHECK (kind IN ('hearing', 'site')),
  house_id text NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  due_at integer NOT NULL,
  position integer NOT NULL
);

CREATE INDEX engagements_due ON engagements (due_at);

-- `counts_at` is the scrutiny the votes land on: a candidacy lodged after the
-- noon bell waits for the next one, and the row says which.
CREATE TABLE campaigns (
  seat_id text NOT NULL,
  house_id text NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  counts_at integer NOT NULL,
  votes integer NOT NULL,
  PRIMARY KEY (seat_id, house_id, counts_at)
);

CREATE TABLE market (
  good text PRIMARY KEY,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  flow_units integer NOT NULL DEFAULT 0
);

CREATE TABLE market_history (
  good text NOT NULL,
  position integer NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  PRIMARY KEY (good, position)
);

-- The journal is a feed, not an archive: the instant, the audience, and the
-- payload the client already knows how to read. The cursor that says what a
-- player has seen lives with the player, not here.
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at integer NOT NULL,
  audience text NOT NULL CHECK (audience IN ('town', 'court', 'house')),
  house_id text,
  type text NOT NULL,
  payload jsonb NOT NULL,
  CHECK ((audience = 'house') = (house_id IS NOT NULL))
);

CREATE INDEX events_at ON events (at);

-- The queue changes with the code that writes it: `actions` today is keyed by
-- week and carries a world_id, and the new one carries the hour it plays on and
-- no world at all. Replacing a table the running server still writes to belongs
-- to the commit that switches the server, not here.

-- A player survives a reset; the house does not. The binding becomes nullable
-- for exactly that moment: the token is what carries someone from one town to
-- the next, and the new town gives it a house again.
ALTER TABLE players ALTER COLUMN house_id DROP NOT NULL;

ALTER TABLE players ADD COLUMN cursor_event_id bigint NOT NULL DEFAULT 0;

-- The sealed season keeps the register and the book of kings, and no reset
-- touches them. `kings` keys on the token, so the crown follows the player and
-- never the name: a name taken again inherits nothing.
CREATE TABLE archive_houses (
  season integer NOT NULL,
  name text NOT NULL,
  prestige integer NOT NULL,
  offices_held integer NOT NULL,
  title text NOT NULL,
  generations integer NOT NULL,
  wealth_cents integer NOT NULL,
  PRIMARY KEY (season, name)
);

CREATE TABLE kings (
  season integer PRIMARY KEY,
  crowned_at integer NOT NULL,
  token_hash text NOT NULL,
  house_name text NOT NULL,
  person_name text NOT NULL,
  ordinance text,
  staple_good text
);

-- The town, in tables instead of one document. One world per database, so no
-- town table carries a world_id: these rows ARE the town, and `state` is the
-- single row the writer locks.
--
-- This is the whole schema at format 3: continuous hours, a scheduler, a
-- journal and the actions queue that feeds it. The earlier formats and their
-- migrations were deleted with their test towns, so this file starts at one.

-- A token bound to a house, outside the world: the world is versioned and
-- replayed, a login is not a game rule, and a format change must never lock a
-- player out. A player survives a reset; the house does not, which is why
-- `house_id` may be empty for exactly that moment.
CREATE TABLE players (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  world_id text NOT NULL CHECK (length(world_id) > 0),
  house_id text CHECK (length(house_id) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The last visit. Dormancy and the thirty-day deletion are measured from it.
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  -- The last journal entry this reader has seen. It only moves forward.
  cursor_event_id bigint NOT NULL DEFAULT 0
);

-- One live token per house today. "Several tokens per house" is a later
-- release, with a revoke-all; it lifts this partial index in its own migration.
CREATE UNIQUE INDEX players_live_house ON players (world_id, house_id) WHERE revoked_at IS NULL;

CREATE INDEX players_house ON players (world_id, house_id);

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
  engagement_seq integer NOT NULL DEFAULT 0,
  -- When the current hour began, in real time. The scheduler measures how many
  -- hours are owed from here, not from a grid.
  hour_started_at timestamptz NOT NULL
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

-- A hearing and a site still have a duration, so they carry the instant they
-- fall due.
CREATE TABLE engagements (
  id text PRIMARY KEY CHECK (length(id) > 0),
  kind text NOT NULL CHECK (kind IN ('hearing', 'site')),
  house_id text NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  due_at integer NOT NULL,
  position integer NOT NULL
);

CREATE INDEX engagements_due ON engagements (due_at);

-- A campaign has no duration: it is a candidacy, and it counts for one
-- scrutiny. The noon bell closes the open map into the closed one, so `closed`
-- says which scrutiny the votes land on: a candidacy lodged after the bell
-- waits for the next one.
CREATE TABLE campaigns (
  seat_id text NOT NULL,
  house_id text NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  closed boolean NOT NULL DEFAULT false,
  votes integer NOT NULL,
  PRIMARY KEY (seat_id, house_id, closed)
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

-- A client-generated UUID makes a retried request a duplicate, never a second
-- action. Rows are kept after their hour is played: the town must stay
-- replayable, and a retried request must stay detectable. `seq` is the order
-- the actions were received in, because two clocks never agree.
CREATE TABLE actions (
  seq bigserial UNIQUE,
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  house_id text NOT NULL CHECK (length(house_id) > 0),
  plays_at integer NOT NULL CHECK (plays_at >= 1),
  action jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- A queued action can be cancelled before its hour plays. The row stays: a
  -- retried POST must remain a duplicate, and the hour's replay is the set of
  -- rows that were not cancelled when it played.
  cancelled_at timestamptz
);

CREATE INDEX actions_plays_at ON actions (plays_at, seq);

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

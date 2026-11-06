-- The town, in tables instead of one document. One database holds several
-- towns, so every town table carries a town_id and its keys are composite: the
-- rows of a town are the town, and `state` is the row the writer locks.
--
-- This is the whole schema at format 3: continuous hours, a scheduler, a
-- journal and the actions queue that feeds it. The earlier formats and their
-- migrations were deleted with their test towns, so this file starts at one.

-- A town is a place a player can join. Its name is what the screen shows; the
-- id is what the rows carry.
CREATE TABLE towns (
  id text PRIMARY KEY CHECK (length(id) > 0),
  name text NOT NULL CHECK (length(name) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A place name is spent for good. A dead town's name does not come back, and no
-- id is ever recycled into a sealed season. It carries no town_id and no
-- cascade: the point is that it outlives the towns.
CREATE TABLE town_names (
  name text PRIMARY KEY CHECK (length(name) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A token bound to a house, outside the town: the town is versioned and
-- replayed, a login is not a game rule. `world_id` is the town the token
-- belongs to. A season's seal keeps the player and takes the house, which is
-- why `house_id` may be empty for exactly that moment; until the seal exists, a
-- reset clears the tokens with the towns.
CREATE TABLE players (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  world_id text NOT NULL CHECK (length(world_id) > 0),
  house_id text CHECK (length(house_id) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The last visit. Dormancy and the thirty-day deletion are measured from it.
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  -- Set when the player asks to delete their identity. The binding stays live
  -- so they can come back before the deadline; when it passes, the scheduler
  -- erases the house, its queue and every row of the house.
  delete_after timestamptz,
  -- The last journal entry this reader has seen. It only moves forward.
  cursor_event_id bigint NOT NULL DEFAULT 0
);

-- One live token per house today. "Several tokens per house" is a later
-- release, with a revoke-all; it lifts this partial index in its own migration.
CREATE UNIQUE INDEX players_live_house ON players (world_id, house_id) WHERE revoked_at IS NULL;

CREATE INDEX players_house ON players (world_id, house_id);

CREATE TABLE state (
  -- One row per town. It is the row the writer locks, so the key is not
  -- decoration: two rows for one town would be two towns.
  town_id text PRIMARY KEY REFERENCES towns (id) ON DELETE CASCADE,
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
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) > 0),
  name text NOT NULL CHECK (length(name) > 0),
  controller text NOT NULL CHECK (controller IN ('ai', 'human')),
  treasury_cents integer NOT NULL,
  debt_cents integer NOT NULL,
  favour integer NOT NULL,
  prestige integer NOT NULL,
  career integer NOT NULL,
  dormant boolean NOT NULL DEFAULT false,
  PRIMARY KEY (town_id, id),
  UNIQUE (town_id, name)
);

CREATE TABLE people (
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) > 0),
  house_id text NOT NULL,
  name text NOT NULL,
  age integer NOT NULL,
  artisanat integer NOT NULL,
  parole integer NOT NULL,
  intrigue integer NOT NULL,
  alive boolean NOT NULL,
  PRIMARY KEY (town_id, id),
  FOREIGN KEY (town_id, house_id) REFERENCES houses (town_id, id) ON DELETE CASCADE
);

CREATE INDEX people_house ON people (town_id, house_id);

-- `position` holds the order the core writes and reads: the world has arrays,
-- and an array is part of the state hash. Loading in a different order would
-- give the same town two hashes.
CREATE TABLE workshops (
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  house_id text NOT NULL,
  position integer NOT NULL,
  good text NOT NULL,
  level integer NOT NULL,
  workers integer NOT NULL,
  PRIMARY KEY (town_id, house_id, position),
  FOREIGN KEY (town_id, house_id) REFERENCES houses (town_id, id) ON DELETE CASCADE
);

CREATE TABLE stock (
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  house_id text NOT NULL,
  good text NOT NULL,
  units integer NOT NULL CHECK (units >= 0),
  PRIMARY KEY (town_id, house_id, good),
  FOREIGN KEY (town_id, house_id) REFERENCES houses (town_id, id) ON DELETE CASCADE
);

CREATE TABLE seats (
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  seat_id text NOT NULL,
  person_id text,
  PRIMARY KEY (town_id, seat_id),
  FOREIGN KEY (town_id, person_id) REFERENCES people (town_id, id) ON DELETE SET NULL
);

CREATE TABLE laws (
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) > 0),
  position integer NOT NULL,
  title text NOT NULL,
  sponsor_house_id text NOT NULL,
  enacted_at integer NOT NULL,
  PRIMARY KEY (town_id, id),
  FOREIGN KEY (town_id, sponsor_house_id) REFERENCES houses (town_id, id) ON DELETE CASCADE
);

-- A hearing and a site still have a duration, so they carry the instant they
-- fall due.
CREATE TABLE engagements (
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) > 0),
  kind text NOT NULL CHECK (kind IN ('hearing', 'site')),
  house_id text NOT NULL,
  due_at integer NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (town_id, id),
  FOREIGN KEY (town_id, house_id) REFERENCES houses (town_id, id) ON DELETE CASCADE
);

CREATE INDEX engagements_due ON engagements (town_id, due_at);

-- A campaign has no duration: it is a candidacy, and it counts for one
-- scrutiny. The noon bell closes the open map into the closed one, so `closed`
-- says which scrutiny the votes land on: a candidacy lodged after the bell
-- waits for the next one.
CREATE TABLE campaigns (
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  seat_id text NOT NULL,
  house_id text NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  votes integer NOT NULL,
  PRIMARY KEY (town_id, seat_id, house_id, closed),
  FOREIGN KEY (town_id, house_id) REFERENCES houses (town_id, id) ON DELETE CASCADE
);

CREATE TABLE market (
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  good text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  flow_units integer NOT NULL DEFAULT 0,
  PRIMARY KEY (town_id, good)
);

CREATE TABLE market_history (
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  good text NOT NULL,
  position integer NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  PRIMARY KEY (town_id, good, position)
);

-- The journal is a feed, not an archive: the instant, the audience, and the
-- payload the client already knows how to read. The id is global so a reader's
-- cursor never has to know which town it came from; the town filter is applied
-- at read time. The cursor that says what a player has seen lives with the
-- player, not here.
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  at integer NOT NULL,
  audience text NOT NULL CHECK (audience IN ('town', 'court', 'house')),
  house_id text,
  type text NOT NULL,
  payload jsonb NOT NULL,
  CHECK ((audience = 'house') = (house_id IS NOT NULL))
);

-- The journal is read backwards from a cursor that is an event id, one town at
-- a time: the index is the pair, not the hour. It also serves the cascade when
-- a town goes.
CREATE INDEX events_town_id ON events (town_id, id);

-- A client-generated UUID makes a retried request a duplicate, never a second
-- action: the id is globally unique, so a retry is caught whatever town it
-- names. `seq` is the order the actions were received in, because two clocks
-- never agree.
CREATE TABLE actions (
  seq bigserial UNIQUE,
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  town_id text NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  house_id text NOT NULL CHECK (length(house_id) > 0),
  plays_at integer NOT NULL CHECK (plays_at >= 1),
  action jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- A queued action can be cancelled before its hour plays. The row stays: a
  -- retried POST must remain a duplicate, and the hour's replay is the set of
  -- rows that were not cancelled when it played.
  cancelled_at timestamptz
);

CREATE INDEX actions_town_plays_at ON actions (town_id, plays_at, seq);

-- The sealed season keeps the register and the book of kings, and no ordinary
-- reset touches them; a full reset deletes them too. They are keyed by town
-- and season: two towns can seal a season in the same year. No foreign key to
-- `towns`: a town's death must not take its chronicle with it.
CREATE TABLE archive_houses (
  town_id text NOT NULL,
  season integer NOT NULL,
  name text NOT NULL,
  prestige integer NOT NULL,
  offices_held integer NOT NULL,
  title text NOT NULL,
  generations integer NOT NULL,
  wealth_cents integer NOT NULL,
  PRIMARY KEY (town_id, season, name)
);

CREATE TABLE kings (
  town_id text NOT NULL,
  season integer NOT NULL,
  crowned_at integer NOT NULL,
  token_hash text NOT NULL,
  house_name text NOT NULL,
  person_name text NOT NULL,
  ordinance text,
  staple_good text,
  PRIMARY KEY (town_id, season)
);

-- The whole schema of the server's database, in one file: the tables of a town,
-- the accounts and the book of kings. It is the only schema file, and it is
-- applied to an empty database.
--
-- A schema change edits this file; a database crosses with `reset --full`, which
-- rebuilds it from here. There is no upgrade path, because no world of another
-- format is read. `migrate` builds an empty database and nothing else.

-- An account, outside the town: the town is replayed, a login is not a game
-- rule. The name is the human family name; the person the account plays points
-- back at it through `people.player_id`, and nothing here names a town.
CREATE TABLE players (
  token_hash text PRIMARY KEY,
  player_id bigserial UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The last visit. Dormancy and the thirty-day deletion are measured from it.
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- The player asked to delete their identity. The account stays live so they
  -- can come back before the deadline, which is when the scheduler erases it.
  delete_after timestamptz
);

-- A family name is unique across the whole server: it is the name a player is
-- known by in every town, and the book of kings keeps it.
CREATE UNIQUE INDEX players_family_name ON players (lower(name));

-- The only record that crosses a reset, and a full reset deletes it too. Keyed
-- by the player and the instant: the crown follows the player, and a town's hour
-- means nothing once the town is gone. No foreign key to `players`, because the
-- book outlives the account.
CREATE TABLE kings (
  id bigserial PRIMARY KEY,
  -- Null when the account that wore the crown is gone: the book outlives it.
  player_id bigint,
  dynasty_name text NOT NULL,
  crowned_at timestamptz NOT NULL,
  -- The town's age at the crowning, in hours from the first hour of the world.
  elapsed_hours integer NOT NULL
);

-- Every town table carries its `town_id` and the rows of a town are the town;
-- `state` is the row the writer locks. Every autoincremented id is a global
-- `bigserial`, assigned by the database.

-- A name may come back after a reset; an id never does, so a dead town's
-- accounts cannot point at a new one.
CREATE TABLE towns (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per town: what belongs to no person, and the row the writer locks.
CREATE TABLE state (
  town_id bigint PRIMARY KEY REFERENCES towns (id) ON DELETE CASCADE,
  format_version integer NOT NULL,
  ruleset_version integer NOT NULL,
  seed integer NOT NULL,
  rng integer NOT NULL,
  hour integer NOT NULL,
  year integer NOT NULL,
  -- Provisional ids for the rows the world mints before the database names
  -- them. They are a cursor, not a key: the real ids are the serials.
  engagement_seq integer NOT NULL DEFAULT 0,
  -- The scheduler counts owed hours from here, not from a grid.
  hour_started_at timestamptz NOT NULL,
  workshop_seq integer NOT NULL DEFAULT 0
);

-- The person is the unit of the world: the purse, the debt, the favour, the
-- prestige, the degree, the residence and the workshops are theirs. A human
-- person points at the account that controls it; an AI person points at nobody
-- and carries `ia = true`. The family name is not here: it is the account's.
CREATE TABLE people (
  id bigserial PRIMARY KEY,
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  player_id bigint,
  ia boolean NOT NULL,
  person_name text NOT NULL,
  age integer NOT NULL,
  title text NOT NULL DEFAULT 'roturier',
  residence_level integer NOT NULL DEFAULT 1,
  treasury_cents integer NOT NULL,
  debt_cents integer NOT NULL,
  favour integer NOT NULL,
  prestige integer NOT NULL,
  alive boolean NOT NULL,
  -- One person per account; an AI person is null and nulls do not collide.
  UNIQUE (player_id)
);

CREATE INDEX people_town ON people (town_id);

-- The world holds workshops in a person, and the array is ordered by id. Two
-- workshops of one trade are two buildings that "destroy" must tell apart.
CREATE TABLE workshops (
  id bigserial PRIMARY KEY,
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  good text NOT NULL,
  level integer NOT NULL
);

CREATE INDEX workshops_person ON workshops (town_id, person_id);

CREATE TABLE stock (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  person_id bigint REFERENCES people (id) ON DELETE CASCADE,
  good text NOT NULL,
  units integer NOT NULL,
  PRIMARY KEY (town_id, person_id, good)
);

CREATE TABLE seats (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  seat_id text NOT NULL,
  person_id bigint REFERENCES people (id) ON DELETE SET NULL,
  PRIMARY KEY (town_id, seat_id)
);

CREATE TABLE laws (
  id bigserial PRIMARY KEY,
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  sponsor_person_id bigint REFERENCES people (id) ON DELETE CASCADE,
  enacted_at integer NOT NULL
);

CREATE INDEX laws_town ON laws (town_id, position);

-- A site says what it is for — a title at the next bell, a workshop built or
-- improved — and its cost is paid when it opens, so the row needs nothing else.
CREATE TABLE engagements (
  id bigserial PRIMARY KEY,
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  kind text NOT NULL,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  due_at integer NOT NULL,
  position integer NOT NULL,
  work text,
  trade text,
  workshop_id bigint REFERENCES workshops (id) ON DELETE SET NULL
);

CREATE INDEX engagements_due ON engagements (town_id, due_at);

-- A campaign has no duration: it counts for one scrutiny, and `closed` says
-- which — a candidacy lodged after the bell waits for the next one.
CREATE TABLE campaigns (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  seat_id text NOT NULL,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  closed boolean NOT NULL DEFAULT false,
  votes integer NOT NULL,
  PRIMARY KEY (town_id, seat_id, person_id, closed)
);

CREATE TABLE market (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  good text NOT NULL,
  price_cents integer NOT NULL,
  flow_units integer NOT NULL DEFAULT 0,
  PRIMARY KEY (town_id, good)
);

CREATE TABLE market_history (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  good text NOT NULL,
  position integer NOT NULL,
  price_cents integer NOT NULL,
  PRIMARY KEY (town_id, good, position)
);

-- The town's chronicle, read as a page: every reader sees the same one, and a
-- line meant for a single person lives in `messages`.
--
-- `at` is the town's hour, which diverges from real time after a catch-up;
-- `recorded_at` is when the row was written, and the purge keeps seven real days
-- of it.
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  at integer NOT NULL,
  audience text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_town_id ON events (town_id, id);

CREATE INDEX events_town_recorded_at ON events (town_id, recorded_at);

-- One mailbox per account. A human person points at its account through
-- `people.player_id`; an AI person has none, so its private lines are written
-- for nobody. No foreign key: an erased account's mail is pruned by retention.
CREATE TABLE messages (
  id bigserial PRIMARY KEY,
  player_id bigint NOT NULL,
  -- A notice carries its kind and the fields of its sentence; prose carries
  -- neither and puts its text in `body`.
  type text,
  payload jsonb,
  body text,
  -- Null when the town wrote it, never set on a notice. Filled from the
  -- session, never from the request body.
  author_player_id bigint,
  -- The whole unread state, so no cursor lives on the account.
  read boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_player ON messages (player_id, id);

-- The row's own id is the order the actions arrived in, because two clocks never
-- agree. A client that sends the same order twice sends two actions.
CREATE TABLE actions (
  id bigserial PRIMARY KEY,
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  plays_at integer NOT NULL,
  action jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX actions_town_plays_at ON actions (town_id, plays_at, id);

-- Not folded here, because it belongs to the runner and not to the town:
-- `schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL
-- DEFAULT now())` is created by `src/db/migrations.ts` and lists what has run.

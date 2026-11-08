-- The schema of the server's database, as the migrations leave it: the tables of
-- a town, the accounts and the book of kings, in one file.
--
-- A reading aid, never a source: nothing applies this file. A database is built
-- by replaying `db/migrations/*.sql` in order, and this file is folded from each
-- migration in the same commit that adds it. A test builds both schemas and
-- compares their catalogues, so a migration left unfolded here turns the suite
-- red. As of 0008_storage_without_copies.sql; when the two disagree, the migrations
-- are right.
--
-- Every town table carries its `town_id` and its keys are composite: the rows of
-- a town are the town, and `state` is the row the writer locks.

-- A name may come back after a reset; an id never does, so a dead town's
-- accounts cannot point at a new one.
CREATE TABLE towns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (length(name) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- An account, outside the town: the town is replayed, a login is not a game
-- rule. An ordinary reset or a season's seal keeps the token and takes the
-- dynasty, so `dynasty_id` may be null between the two. The town is not stored
-- here: it is the dynasty's, and the dynasty is looked up (see 0008).
CREATE TABLE players (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  player_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  dynasty_id text CHECK (length(dynasty_id) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The last visit. Dormancy and the thirty-day deletion are measured from it.
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  -- The player asked to delete their identity. The binding stays live so they
  -- can come back before the deadline, which is when the scheduler erases the
  -- dynasty, its queue and every row of the dynasty.
  delete_after timestamptz
);

-- One live account per dynasty today. "Several accounts per dynasty" is a later
-- release, with a revoke-all; it lifts this partial index in its own migration.
-- An account between towns has no dynasty, and nulls do not collide here.
CREATE UNIQUE INDEX players_live_dynasty ON players (dynasty_id) WHERE revoked_at IS NULL;

-- One row per town: what belongs to no dynasty, and the row the writer locks.
CREATE TABLE state (
  town_id bigint PRIMARY KEY REFERENCES towns (id) ON DELETE CASCADE,
  format_version integer NOT NULL,
  ruleset_version integer NOT NULL,
  seed integer NOT NULL,
  rng integer NOT NULL,
  hour integer NOT NULL CHECK (hour >= 1),
  year integer NOT NULL,
  engagement_seq integer NOT NULL DEFAULT 0,
  -- The scheduler counts owed hours from here, not from a grid.
  hour_started_at timestamptz NOT NULL,
  workshop_seq integer NOT NULL DEFAULT 0
);

CREATE TABLE dynasties (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) > 0),
  name text NOT NULL CHECK (length(name) > 0),
  controller text NOT NULL CHECK (controller IN ('ai', 'human')),
  treasury_cents integer NOT NULL,
  debt_cents integer NOT NULL,
  favour integer NOT NULL,
  prestige integer NOT NULL,
  career integer NOT NULL,
  dormant boolean NOT NULL DEFAULT false,
  title text NOT NULL DEFAULT 'roturier'
    CHECK (title IN ('roturier', 'bourgeois', 'notable', 'patricien', 'ecuyer', 'chevalier',
                     'baron', 'vicomte', 'comte', 'marquis', 'duc', 'prince')),
  residence_level integer NOT NULL DEFAULT 1 CHECK (residence_level BETWEEN 1 AND 12),
  PRIMARY KEY (town_id, id),
  UNIQUE (town_id, name)
);

-- Only a human dynasty is ranked by name across towns; the AI ones carry the
-- same names in every town. `lower()` is the key because a valid name has no
-- accent or ligature to fold.
CREATE UNIQUE INDEX dynasties_human_name ON dynasties (lower(name)) WHERE controller = 'human';

-- The persons of a dynasty: a seat points at one of them, never at the dynasty.
CREATE TABLE people (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) > 0),
  dynasty_id text NOT NULL,
  name text NOT NULL,
  age integer NOT NULL,
  artisanat integer NOT NULL,
  parole integer NOT NULL,
  intrigue integer NOT NULL,
  alive boolean NOT NULL,
  PRIMARY KEY (town_id, id),
  FOREIGN KEY (town_id, dynasty_id) REFERENCES dynasties (town_id, id) ON DELETE CASCADE
);

CREATE INDEX people_dynasty ON people (town_id, dynasty_id);

-- The world holds workshops as an array and hashes it in order, so `position`
-- is that order. The id is the world's (`workshopSeq`): two workshops of one
-- trade are two buildings that "destroy" must tell apart.
CREATE TABLE workshops (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  dynasty_id text NOT NULL,
  position integer NOT NULL,
  good text NOT NULL,
  level integer NOT NULL,
  id text NOT NULL DEFAULT gen_random_uuid()::text,
  PRIMARY KEY (town_id, dynasty_id, position),
  CONSTRAINT workshops_id_key UNIQUE (town_id, dynasty_id, id),
  FOREIGN KEY (town_id, dynasty_id) REFERENCES dynasties (town_id, id) ON DELETE CASCADE
);

CREATE TABLE stock (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  dynasty_id text NOT NULL,
  good text NOT NULL,
  units integer NOT NULL CHECK (units >= 0),
  PRIMARY KEY (town_id, dynasty_id, good),
  FOREIGN KEY (town_id, dynasty_id) REFERENCES dynasties (town_id, id) ON DELETE CASCADE
);

CREATE TABLE seats (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  seat_id text NOT NULL,
  person_id text,
  PRIMARY KEY (town_id, seat_id),
  FOREIGN KEY (town_id, person_id) REFERENCES people (town_id, id) ON DELETE SET NULL
);

CREATE TABLE laws (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) > 0),
  position integer NOT NULL,
  title text NOT NULL,
  sponsor_dynasty_id text NOT NULL,
  enacted_at integer NOT NULL,
  PRIMARY KEY (town_id, id),
  FOREIGN KEY (town_id, sponsor_dynasty_id) REFERENCES dynasties (town_id, id) ON DELETE CASCADE
);

-- A site says what it is for — a title at the next bell, a workshop built or
-- improved — and its cost is paid when it opens, so the row needs nothing else.
CREATE TABLE engagements (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) > 0),
  kind text NOT NULL CHECK (kind IN ('hearing', 'site')),
  dynasty_id text NOT NULL,
  due_at integer NOT NULL,
  position integer NOT NULL,
  work text CHECK (work IN ('build', 'upgrade', 'residence', 'title')),
  trade text CHECK (trade IN ('weaver', 'baker', 'carpenter')),
  workshop_id text,
  PRIMARY KEY (town_id, id),
  FOREIGN KEY (town_id, dynasty_id) REFERENCES dynasties (town_id, id) ON DELETE CASCADE
);

CREATE INDEX engagements_due ON engagements (town_id, due_at);

-- A campaign has no duration: it counts for one scrutiny, and `closed` says
-- which — a candidacy lodged after the bell waits for the next one.
CREATE TABLE campaigns (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  seat_id text NOT NULL,
  dynasty_id text NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  votes integer NOT NULL,
  PRIMARY KEY (town_id, seat_id, dynasty_id, closed),
  FOREIGN KEY (town_id, dynasty_id) REFERENCES dynasties (town_id, id) ON DELETE CASCADE
);

CREATE TABLE market (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  good text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  flow_units integer NOT NULL DEFAULT 0,
  PRIMARY KEY (town_id, good)
);

CREATE TABLE market_history (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  good text NOT NULL,
  position integer NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  PRIMARY KEY (town_id, good, position)
);

-- The town's chronicle, read as a page: every reader sees the same one, and a
-- line meant for a single dynasty lives in `messages`.
--
-- `at` is the town's hour, which diverges from real time after a catch-up;
-- `recorded_at` is when the row was written, and the purge keeps seven real days
-- of it.
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  at integer NOT NULL,
  audience text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_chronicle_only CHECK (audience = 'town')
);

CREATE INDEX events_town_id ON events (town_id, id);

CREATE INDEX events_town_recorded_at ON events (town_id, recorded_at);

-- One mailbox per dynasty. A human dynasty id is minted once for the whole
-- server and an AI one has no mailbox, so the id alone names the box; the writer
-- deletes a town's mail with the town.
CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dynasty_id text NOT NULL CHECK (length(dynasty_id) > 0),
  -- A notice carries its kind and the fields of its sentence; prose carries
  -- neither and puts its text in `body`.
  type text,
  payload jsonb,
  body text,
  -- Null when the town wrote it, never set on a notice. Filled from the
  -- session, never from the request body.
  author_dynasty_id text CHECK (author_dynasty_id IS NULL OR length(author_dynasty_id) > 0),
  -- The whole unread state, so no cursor lives on the account.
  read boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type IS NULL) = (body IS NOT NULL)),
  CHECK ((type IS NULL) <> (payload IS NOT NULL)),
  CHECK (type IS NULL OR author_dynasty_id IS NULL)
);

-- The client mints the id, so a retried request is a duplicate and never a
-- second action; `seq` is the order they arrived in, because two clocks never
-- agree.
CREATE TABLE actions (
  seq bigserial UNIQUE,
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  dynasty_id text NOT NULL CHECK (length(dynasty_id) > 0),
  plays_at integer NOT NULL CHECK (plays_at >= 1),
  action jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- A cancelled action keeps its row: a retried POST must stay a duplicate, and
  -- the hour replays the rows that were not cancelled.
  cancelled_at timestamptz
);

CREATE INDEX actions_town_plays_at ON actions (town_id, plays_at, seq);

-- The only record that crosses a reset, and a full reset deletes it too. Keyed
-- by the player and the instant: the crown follows the player, and a town's hour
-- means nothing once the town is gone. No foreign key to `players`, because the
-- book outlives the account.
CREATE TABLE kings (
  player_id bigint NOT NULL,
  dynasty_name text NOT NULL,
  person_name text NOT NULL,
  crowned_at timestamptz NOT NULL,
  -- The town's age at the crowning, in hours from the first hour of the world.
  elapsed_hours integer NOT NULL,
  PRIMARY KEY (player_id, crowned_at)
);

-- Not folded here, because it belongs to the runner and not to the town:
-- `schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL
-- DEFAULT now())` is created by `src/db/migrations.ts` and lists what has run.

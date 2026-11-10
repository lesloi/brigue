-- The whole schema of the server's database, in one file: the tables of a town,
-- the accounts and the book of kings. It is the only schema file, and it is
-- applied to an empty database.
--
-- A schema change edits this file; a database crosses with `reset`, which
-- rebuilds it from here and keeps the accounts and the book of kings. There is
-- no upgrade path, because no world of another format is read. `migrate` builds
-- an empty database and nothing else.

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

-- The sweep of the accounts whose deadline passed looks at the deadline, once
-- per pass: without this it reads every account every minute.
CREATE INDEX players_due_deletion ON players (delete_after);

-- The only record that crosses a reset, and a full reset deletes it too. It
-- names nobody: the book outlives the accounts, and a crown is the town's
-- memory, not a column to join on.
CREATE TABLE kings (
  id bigserial PRIMARY KEY,
  dynasty_name text NOT NULL,
  crowned_at timestamptz NOT NULL,
  -- The town's age at the crowning, in hours from the first hour of the world.
  elapsed_hours integer NOT NULL
);

-- A town table carries its `town_id`, except the two that hang from a person —
-- `workshops` and `stock`, which a town owns through its people. The world's
-- clock lives in `settings`. One world, one clock, several towns: every town
-- counts its hours from the same origin, but each holds its own watermark and
-- owes its own hours, so a town that fell behind keeps them.

-- A name may come back after a reset; an id never does, so a dead town's
-- accounts cannot point at a new one.
CREATE TABLE towns (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The start of the first hour this town's rows do not hold yet: the town's own
  -- watermark, and the row a writer locks. The world's hour is derived from
  -- `world_started_at`, so the gap between the two is what this town owes.
  last_played_at timestamptz NOT NULL
);

-- The world's settings: one key/value row each, outside any town. The first
-- town writes them; a later town reads them, so every town shares one clock and
-- one format. The values are text; the store parses the numbers and the
-- instants.
--
-- `world_started_at` is when the world was founded, and every hour is counted
-- from it: the hour is the wall clock, never a stored counter. How far a town's
-- rows have been played is that town's own `last_played_at`, not a world-wide
-- counter: one town's failure must not cost the others their hours.
CREATE TABLE settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- The person is the unit of the world: the purse, the debt, the favour, the
-- prestige, the degree, the residence and the workshops are theirs. A human
-- person points at the account that controls it; a person with no account is an
-- AI, so `player_id IS NULL` is the whole of the fact. The family name is not
-- here: it is the account's.
--
-- The codes a row carries are one-based places in a list the core writes
-- (`TITLES`, `GOODS`, `TRADES`), so `title = 1` is the roturier and `title = 12`
-- the prince. A list may gain an entry; an existing code is never renumbered.
CREATE TABLE people (
  id bigserial PRIMARY KEY,
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  -- The account holds the person: deleting the account deletes it, and the
  -- schema's own cascades take its workshops, stock, seats and mail.
  player_id bigint REFERENCES players (player_id) ON DELETE CASCADE,
  person_name text NOT NULL,
  title smallint NOT NULL DEFAULT 1,
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
--
-- A workshop practices a trade (`TRADES`, 1 = weaver), and its output is the
-- trade's chain. It has no `town_id`: the person it hangs from is the town.
CREATE TABLE workshops (
  id bigserial PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  trade smallint NOT NULL,
  level integer NOT NULL
);

CREATE INDEX workshops_person ON workshops (person_id);

-- A warehouse hangs from a person too. `good` is a place in `GOODS`
-- (1 = wool, and so on); a raw good and a worked one are the same list.
CREATE TABLE stock (
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  good smallint NOT NULL,
  units integer NOT NULL,
  PRIMARY KEY (person_id, good)
);

CREATE TABLE seats (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  seat_id text NOT NULL,
  person_id bigint REFERENCES people (id) ON DELETE SET NULL,
  PRIMARY KEY (town_id, seat_id)
);

-- A seat names its holder: deleting the person must find the seat, and the key
-- starts at the town.
CREATE INDEX seats_person ON seats (person_id);

-- A law is what the town voted: a code from a catalogue, and the value it was
-- set to. One row per rule in force, so enacting it again is setting it again.
-- Nothing writes this table yet; the catalogue is the town's, not the store's.
CREATE TABLE laws (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  code text NOT NULL,
  value integer NOT NULL,
  PRIMARY KEY (town_id, code)
);

-- A campaign has no duration: it is a candidacy, it counts at the coming
-- scrutiny, and the scrutiny deletes it. No closed flag, no votes: the vote is
-- the town's roll, and nothing keeps the result once it is said.
CREATE TABLE campaigns (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  seat_id text NOT NULL,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (town_id, seat_id, person_id)
);

-- A candidacy follows its person: deleting the person must find it, and the key
-- starts at the town and the seat.
CREATE INDEX campaigns_person ON campaigns (person_id);

CREATE TABLE market (
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  good smallint NOT NULL,
  price_cents integer NOT NULL,
  flow_units integer NOT NULL DEFAULT 0,
  PRIMARY KEY (town_id, good)
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
  -- The instant the hour it happened on begins, in real time: the store maps it
  -- back to the town's hour, and the client reads the hour.
  at timestamptz NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- The page reads the town's lines newest first: the trailing id is the order,
-- and it is what spares the sort, not decoration.
CREATE INDEX events_town_id ON events (town_id, id);

CREATE INDEX events_town_recorded_at ON events (town_id, recorded_at);

-- One mailbox per account. A human person points at its account through
-- `people.player_id`; an AI person has none, so its private lines are written
-- for nobody. The mailbox and its author are accounts: erasing one takes the
-- letters it holds, and leaves the letters it wrote without a name.
CREATE TABLE messages (
  id bigserial PRIMARY KEY,
  -- The mailbox is the account's, and the mail goes when the account does.
  player_id bigint NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
  -- A notice carries its kind and the fields of its sentence; prose carries
  -- neither and puts its text in `body`. The kind is the same word as an event's.
  type text,
  payload jsonb,
  body text,
  -- Null when the town wrote it, never set on a notice. Filled from the
  -- session, never from the request body. The author may be erased while its
  -- letter stays: the letter loses a name, not its place.
  author_player_id bigint REFERENCES players (player_id) ON DELETE SET NULL,
  -- The whole unread state, so no cursor lives on the account.
  read boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- The box reads newest first, as the chronicle does: the trailing id is the order.
CREATE INDEX messages_player ON messages (player_id, id);

-- The thirty-day prune is the box's clock, not the reader's: one delete over
-- every mailbox, once per pass.
CREATE INDEX messages_recorded_at ON messages (recorded_at);

-- A letter outlives its author: erasing the account must find the letters it
-- wrote to take the name away.
CREATE INDEX messages_author ON messages (author_player_id);

-- The row's own id is the order the actions arrived in, because two clocks never
-- agree. A client that sends the same order twice sends two actions.
CREATE TABLE actions (
  id bigserial PRIMARY KEY,
  town_id bigint NOT NULL REFERENCES towns (id) ON DELETE CASCADE,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  -- The instant its hour begins, in real time: the pass selects what is due with
  -- one comparison, and the store maps the instant back to the town's hour.
  plays_at timestamptz NOT NULL,
  -- The action is a type and its fields apart: a query can read what was asked
  -- without parsing the payload, and an unknown type is a row, not a crash.
  type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- A pass reads the hours it owes by range, not by page: the range already
-- narrows to a handful, and the order of an hour is sorted there.
CREATE INDEX actions_town_plays_at ON actions (town_id, plays_at);

-- An ordered action names its person: a person erased takes its queue with it,
-- and a save renames the rows of a person the database just named.
CREATE INDEX actions_person ON actions (person_id);

-- Not folded here, because it belongs to the runner and not to the town:
-- `schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL
-- DEFAULT now())` is created by `src/db/migrations.ts` and lists what has run.

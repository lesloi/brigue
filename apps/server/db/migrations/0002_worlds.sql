-- The town itself and the actions queued against it. One row per world: the
-- whole document is read and written under the row lock, because catch-up turns
-- a read into a write and two of them would lose a week.
CREATE TABLE worlds (
  id text PRIMARY KEY CHECK (length(id) > 0),
  state jsonb NOT NULL,
  -- When the current week (state->>'week') began. Catch-up is measured from
  -- here and advances by whole weeks, so a partial hour is never lost.
  week_started_at timestamptz NOT NULL,
  -- The last tick that was played, so a read with nothing to catch up returns
  -- the week it just showed instead of an empty ledger.
  last_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A client-generated UUID makes a retried request a duplicate, never a second
-- action. Rows are kept after their week is played: the town can be replayed,
-- and a retried request must stay detectable.
CREATE TABLE actions (
  seq bigserial UNIQUE,
  id uuid PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  house_id text NOT NULL CHECK (length(house_id) > 0),
  week integer NOT NULL CHECK (week >= 1),
  action jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Two actions of the same week are applied in the order they were received;
-- `seq` is that order, and it does not depend on two clocks agreeing.
CREATE INDEX actions_world_week ON actions (world_id, week, seq);

-- 0001 left world_id as text until worlds had an id. Rows may predate this
-- table, so the constraint is NOT VALID: new writes are checked, old rows are
-- left alone rather than failing the deploy.
ALTER TABLE players
  ADD CONSTRAINT players_world FOREIGN KEY (world_id) REFERENCES worlds(id) NOT VALID;

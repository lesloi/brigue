-- A token bound to a house, outside the world: the world is versioned and
-- replayed, a login is not a game rule, and a format change must never lock a
-- player out.
--
-- world_id is text until the server gives worlds a real id (a later migration),
-- which keeps this table independent of the world's shape.
CREATE TABLE players (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  world_id text NOT NULL CHECK (length(world_id) > 0),
  house_id text NOT NULL CHECK (length(house_id) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- One live token per house today. "Several tokens per house" is a later
-- release, with a revoke-all; it lifts this partial index in its own migration.
CREATE UNIQUE INDEX players_live_house ON players (world_id, house_id) WHERE revoked_at IS NULL;

CREATE INDEX players_house ON players (world_id, house_id);

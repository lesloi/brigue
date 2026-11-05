-- The last visit, for dormancy and the thirty-day deletion. It lives outside
-- the world for the same reason the binding does: a world's catch-up cannot
-- count visits it never simulated. Existing rows get the migration instant,
-- which the format reset deletes anyway.
ALTER TABLE players ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();

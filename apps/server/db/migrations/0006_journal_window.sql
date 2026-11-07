-- The journal is a sliding window, not a feed with one cursor per reader: every
-- read returns the newest page, so no reader position can hide another's lines.
--
-- `at` is the town's hour and diverges from real time after a catch-up, so the
-- row also carries the instant it was written. The purge keeps the last seven
-- real days of that instant.
ALTER TABLE events ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX events_town_recorded_at ON events (town_id, recorded_at);

-- The cursor went with the feed: a reader crossing towns carried an event id
-- that could sit above the new town's newest event and empty its journal.
ALTER TABLE players DROP COLUMN cursor_event_id;

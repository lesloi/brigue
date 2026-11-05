-- A queued action can be cancelled before its week ticks. The row stays: a
-- retried POST with the same id must remain a duplicate, and the week's replay
-- is the set of rows that were not cancelled when it ticked.
ALTER TABLE actions ADD COLUMN cancelled_at timestamptz;

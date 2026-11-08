-- The account and the dynasty each kept a copy of something another row already
-- knew: the town (`dynasties.town_id`), and the name as the uniqueness rule sees
-- it. A copy can disagree with its source; both go.
--
-- A valid name is letters and digits (`isValidName`), and `lower()` of it is
-- exactly the key the server computes, so the cross-town index keeps its name
-- and loses its column. Unbound accounts keep a null `dynasty_id`, and Postgres
-- treats nulls as distinct in a unique index, so they do not collide.

DROP INDEX players_live_dynasty;
ALTER TABLE players DROP COLUMN town_id;
CREATE UNIQUE INDEX players_live_dynasty ON players (dynasty_id) WHERE revoked_at IS NULL;

DROP INDEX dynasties_human_name;
ALTER TABLE dynasties DROP COLUMN name_key;
CREATE UNIQUE INDEX dynasties_human_name ON dynasties (lower(name)) WHERE controller = 'human';

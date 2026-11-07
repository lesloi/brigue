-- An account may outlive its dynasty: an ordinary reset and the seal of a season
-- both keep the token and take the dynasty, so a row carries no town and no dynasty
-- until the player chooses a trade again.
--
-- `town_id` cannot keep the dead town's id: the rebuilt `towns` identity starts
-- over, so a carried id would meet a new town and the account would look like
-- one of its members. This supersedes the note in 0001 that a reset clears the
-- accounts with the towns.
ALTER TABLE players ALTER COLUMN town_id DROP NOT NULL;

-- The binding is all or nothing: an account is either in a town with a dynasty,
-- or between the two.
ALTER TABLE players ADD CONSTRAINT players_binding CHECK ((town_id IS NULL) = (dynasty_id IS NULL));

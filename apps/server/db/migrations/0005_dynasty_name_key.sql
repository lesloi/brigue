-- The name of a dynasty is identity: the player chooses it at creation and pays
-- to change it afterwards. A name is letters and digits, so two names are one
-- name when they differ only by case — the server writes `name_key` (`nameKey`
-- in the core), and the partial index below is the net behind that rule, never
-- the rule itself: the check reads the dynasties, and the index only catches the
-- race a second server would slip in.
--
-- It holds the human dynasties only: the three AI dynasties carry the same names in
-- every town, and only a human dynasty is ranked by name across towns.
ALTER TABLE dynasties ADD COLUMN name_key text NOT NULL DEFAULT '';

-- A town read by a server that predates the column keeps its keys empty, and
-- the reader fills them on its next save. What is written here is reserved, so
-- no name can equal it: the read replaces each key with the one the rule makes.
UPDATE dynasties SET name_key = 'legacy:' || town_id || '-' || id WHERE name_key = '';

CREATE UNIQUE INDEX dynasties_human_name ON dynasties (name_key) WHERE controller = 'human';

-- The ladder of #54: a dynasty carries a title and a residence level, and a
-- workshop carries an id of its own, because two workshops of one trade are two
-- buildings that "destroy" must tell apart. The workers are gone: upkeep is what
-- a workshop costs, one level's share, with nobody to count.
--
-- This is a rules change, not an additive one: the warehouse of a dynasty that
-- arrives goes from 100 to 200 units (its level 2 workshop), so RULES.version
-- moves and the towns are reset with the release.

ALTER TABLE dynasties
  ADD COLUMN title text NOT NULL DEFAULT 'roturier'
    CHECK (title IN ('roturier', 'bourgeois', 'notable', 'patricien', 'ecuyer', 'chevalier',
                     'baron', 'vicomte', 'comte', 'marquis', 'duc', 'prince')),
  ADD COLUMN residence_level integer NOT NULL DEFAULT 1 CHECK (residence_level BETWEEN 1 AND 12);

-- The id is minted by the world (`workshopSeq`), so it is the same in every
-- dynasty and the key is the dynasty's: the seeds all open a `workshop-1`.
ALTER TABLE workshops ADD COLUMN id text NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE workshops ADD CONSTRAINT workshops_id_key UNIQUE (town_id, dynasty_id, id);
ALTER TABLE workshops DROP COLUMN workers;

-- The counter that mints workshop ids. It follows `state`, which is one row per
-- town.
ALTER TABLE state ADD COLUMN workshop_seq integer NOT NULL DEFAULT 0;

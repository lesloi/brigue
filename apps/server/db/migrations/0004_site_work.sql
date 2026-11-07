-- The site of the ladder of #54 is not the one of a hearing: a building site
-- says what it is for, because a title is obtained at the next noon or midnight
-- and a workshop is built or improved. The cost is paid when the site opens, so
-- the work and its object are all the row needs.
ALTER TABLE engagements ADD COLUMN work text
  CHECK (work IN ('build', 'upgrade', 'residence', 'title'));

-- A workshop is built by a trade: what it makes when the site closes.
ALTER TABLE engagements ADD COLUMN trade text CHECK (trade IN ('weaver', 'baker', 'carpenter'));

-- The workshop a site improves.
ALTER TABLE engagements ADD COLUMN workshop_id text;

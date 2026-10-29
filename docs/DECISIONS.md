# Decisions

Lasting choices and the reason behind each. They can be questioned: if one no longer holds,
propose another with your arguments, then rewrite the entry. Git keeps the history.

## Product

- **A mobile-first PWA, not a native app.** The player plays in short visits, on a phone. An
  installable PWA opens full screen, needs no store review, and keeps the desktop as a widened
  version of the same screens instead of a second product. A store listing was explicitly not
  wanted. Revisit if native-only capabilities (push, background work) become the point, or if
  the installed feel is not enough in daily use.

- **One world with seats, not one world per player.** The town is a shared object: five seats,
  held by houses, each house controlled by an AI or a human. Solo is the same code with every
  seat but yours on AI, and a player who leaves leaves a house behind rather than a gap. A world
  per player would make multiplayer a rewrite instead of an assignment. Revisit only if the town
  proves too small to hold a solo player's pace.

## State

- **The server holds the world; the client renders it.** The client decides nothing and stores
  nothing: no local save to version, to lose with a cleared browser, or to reconcile between two
  devices. Revisit if the game has to be playable without a connection for long stretches.

- **A token, not an account.** An opaque 256-bit token, stored hashed, shown once, no email, no
  recovery. The token is the whole identity, which is a fair price for zero sign-up. The
  consequence is stated in the interface: lose the token, lose the house. Revisit if the game is
  ever opened to strangers.

- **The world catches up on read; there is no scheduler.** `tick` is pure, so the server computes
  the weeks elapsed since the last visit when a player asks for the world. A cron would add a
  component to watch and would not change what the player sees. Revisit when a world must move
  while nobody is looking, which is what a shared season would need.

## Simulation

- **The core is pure, deterministic and clock-free.** One seed, one world, one hash. A test
  replays 200 weeks and asserts the same state hash, and another fails if `Math.random` or
  `Date.now` ever enters `packages/core`. Everything else in the project depends on this being
  true: it is how a bug is reproduced, how a balance change is measured, and how the server can
  catch a world up without trusting a clock.

- **One tick is one game week.** Slow enough for a betrayal to be prepared, fast enough that a
  week away does not ruin a game. A new year starts every 52 weeks.

- **Money is integer cents.** No float anywhere: the economy must replay exactly, and a drift of
  a hundredth per tick is invisible until it is catastrophic.

- **The shape of the world only ever grows.** A new field arrives with a default; a field is
  never renamed and a unit never changes. This is what keeps a world readable across a deploy
  without a migration, and it costs nothing at the moment of the change. `formatVersion` and
  `rulesetVersion` are stored with the world so a mismatch is refused rather than misread.

- **Events are the only thing the client reads.** A week produces a list of events; the screens
  are a rendering of them. It keeps the interface honest, gives the journal its use for
  debugging, and means a screen never has to recompute a rule.

## Stack

- **TypeScript everywhere.** One language for the core, the server and the client, so the same
  `tick` can run on a server today and in a test or a browser tomorrow. Chosen over Python, which
  the owner knows better, because the simulation had to be able to run on a phone. Revisit if
  profiling ever shows the simulation outgrowing Node.

- **The world is one `jsonb` column in Postgres.** It is one document per world, read and written
  whole, and the database is asked for nothing but durability. Revisit if a screen ever needs to
  query inside the world rather than read it.

## Interface

- **A chancery, not an isometric town.** The game is played in documents: registers, letters,
  edicts, an organisation tree. It is what the domain is, and it removes the largest cost of the
  project, which is art. The one illustration is the town scene on the home screen. Revisit if
  the town view ever becomes a place where the player acts.

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
  seat but yours on AI. A world per player would make multiplayer a rewrite instead of an
  assignment. Revisit only if the town proves too small to hold a solo player's pace.

- **A house whose player leaves goes back to the AI; it does not vanish.** The house keeps its
  money, its seat, its grudges and its heir. Nothing in the interface marks it as abandoned,
  because the town would not know. This is what keeps a small persistent town from dying at the
  first absence, and it is free to build only if it is decided now.

## Identity

- **A token, not an account.** An opaque 256-bit token, stored hashed, shown once, no email, no
  recovery. The token is the whole identity, which is a fair price for zero sign-up. The
  consequence is stated in the interface: lose the token, lose the house. Revisit if the game is
  ever opened to strangers.

- **The token is bound to a house, and that binding lives outside the world.** A `players` table
  holds the token hash, the world, the house and a revocation date. The binding is not part of
  the world because the world is versioned, replayed and hashed; a login is not a game rule, and
  a format change must never be able to lock a player out. Authorisation is checked once, at the
  edge, before the world is loaded. One live token per house for now, enforced by a partial
  unique index; the release that allows several tokens per house lifts it and adds a revoke-all.

## State

- **The server holds the world; the client renders it.** The client stores nothing: no local save
  to version, to lose with a cleared browser, or to reconcile between two devices. It receives a
  projection of the world and the events of the week, and it computes no rule. Revisit if the game
  has to be playable offline for long stretches.

- **The world catches up on read; there is no scheduler.** `tick` is pure, so the server computes
  the weeks elapsed since the last visit when a player asks for the world. A cron would add a
  component to watch and would not change what the player sees. The contract: one game week per
  real hour, capped at 520 weeks per read, with the events of the last week returned and the rest
  summarised as counters. Revisit when a shared season must move while nobody is looking.

- **One writer per world.** Catch-up turns a read into a write, so two requests for the same world
  could each replay the same weeks and lose one of them. The row is locked for the duration
  (`SELECT … FOR UPDATE`), actions carry a client-generated UUID with a unique constraint (a
  retried request is refused, not applied twice), and each action carries the week it was queued
  for: the server applies a week's actions in the order they were received, then ticks once.
  "Insertion order" alone is only well defined inside one week.

## Simulation

- **The core is pure, deterministic and clock-free.** One seed, one world, one hash. A test
  replays 200 weeks and asserts the same state hash, and another fails if `Math.random` or
  `Date.now` ever enters `packages/core`. Everything else depends on this: it is how a bug is
  reproduced, how a balance change is measured, and why the server can catch a world up at all.

- **One tick is one game week; one game week is one real hour.** A game year is about two days of
  wall clock, a month away is about three game years, and a dynasty lasts weeks of real play.
  Slow enough for a betrayal to be prepared, fast enough that an absence does not ruin a game.

- **Money is integer cents.** No float anywhere: the economy must replay exactly, and a drift of
  a hundredth per tick is invisible until it is catastrophic.

- **The market clears what a workshop makes, at the week's price.** There is no finished-goods
  stock: producing and selling are one act, and the decision is what to produce and how much raw
  material to buy. Holding cloth for a better week would be a second mechanic, and crediting both
  the goods and the coin would count the output twice.

- **Pacing is not a rule.** How long a week lasts and how far a returning player is caught up
  (`PACING`) are read by the server and must not bump `rulesetVersion`; a recipe, by contrast, is
  a rule and lives in `RULES`, because changing one changes the economy.

- **A refusal is an event, never a throw.** The server replays stored actions weeks later; one
  poisoned action must not be able to stop the town. An unknown house, an unaffordable purchase
  and a missing material all come back as `action.refused` or `workshop.idle`. Only a wrong
  version of the world throws, and only before any replay starts.

- **The shape of the world only ever grows.** A new field arrives with a default; a field is
  never renamed and a unit never changes. This is what keeps a world readable across a deploy
  without a migration, and it costs nothing at the moment of the change. `formatVersion` and
  `rulesetVersion` are stored with the world, and `tick` refuses a world it does not know.

## Stack

- **TypeScript everywhere.** One language for the core, the server and the client, so a rule is
  written once and tested without a database. It was chosen over Python, which the owner knows
  better: the deciding argument was one language and one toolchain for a solo project, not the
  ability to run the simulation in a browser. (`stateHash` uses `node:crypto`, so the core is not
  browser-ready today; if a client-side mode is ever wanted, that one file moves to WebCrypto.)
  Revisit if profiling shows the simulation outgrowing Node.

- **One container serves both the API and the built client.** Same origin, no CORS, no second
  deployment, no CDN. In development, two processes; in production, one image, one Deployment,
  one Ingress, one Postgres, no CronJob and no Redis.

- **The world is one `jsonb` column in Postgres.** One document per world, read and written whole,
  and the database is asked for nothing but durability. Revisit if a screen ever needs to query
  inside the world rather than read it.

## Interface

- **A chancery, not an isometric town.** The game is played in documents: registers, letters,
  edicts, an organisation tree. It is what the domain is, and it removes the largest cost of the
  project, which is art. The one illustration is the town scene on the home screen. Revisit if
  the town view ever becomes a place where the player acts.

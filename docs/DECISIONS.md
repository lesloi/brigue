# Decisions

Lasting choices and the reason behind each. They can be questioned: if one no longer holds,
propose another with your arguments, then rewrite its entry. Git keeps the history.

## Product

- **A mobile-first PWA, not a native app.** The player plays in short visits, on a phone. An
  installable PWA opens full screen, needs no store review, and keeps the desktop as a widened
  version of the same screens instead of a second product. A store listing was explicitly not
  wanted. Revisit if native-only capabilities (push, background work) become the point, or if
  the installed feel is not enough in daily use.

- **One world with twelve seats, not one world per player.** The town is a shared object: twelve
  seats, held by people, each house controlled by an AI or a human. Solo is the same code with
  every seat but yours on AI. A world per player would make multiplayer a rewrite instead of an
  assignment. The seat is held by a **person**, not a house; that is what makes a career and a
  succession possible. Revisit only if the town proves too small to hold a solo player's pace.

- **A house whose player stops playing goes dormant; a human who arrives takes an AI's place.**
  A dormant house keeps its money, its seat, its grudges and its heir, but nothing runs: the
  workshop idles, the stock stays a target, the holder votes no more. The holder stays a
  candidate by default, so a challenger turns the next election into a normal contest. After
  thirty days without a visit the house is deleted and the token with it: no return, no vacation
  mode, and no AI ever plays it. The reverse is asymmetric: when a full town receives a human,
  the AI house ends and the newcomer starts with nothing — no money, no seat, no career. No AI is
  created after the opening; the ten founding families are a floor, and a freed place waits for a
  human. An absence must not be a betrayal, and an arrival must not inherit a mayoralty.

- **The town is capped at twenty houses, ten of them AI.** The cap is what makes a seat scarce:
  twenty houses for twelve seats is a contest, and the council only becomes political once the
  town outgrows its seats. The AI cap keeps the town human: a shared world is mostly people, and
  a solo world is ten AI and its founder. The town opens with ten AI and the founder; a human
  arriving when it is full replaces an AI. Revisit if a season proves too small at twenty.

- **The council is a pyramid of twelve: one, two, four, five.** The seats are ranked, and each
  floor holds a different right rather than a stronger version of the one below. One office per
  person, all elected on the same day, every day; to climb, a person gives up the office they
  hold. **The career is the gate**: standing for a floor requires having held an office of a
  lower floor, and the career dies with the person, so the heir starts at the bottom. The five
  seats at the base hold no lever: salary, prestige, a vote on exceptional measures, and jury
  duty. A vacant seat blocks nothing — the power is simply unavailable, as in Europe 1400 — so a
  young town has no mayor for its first four elections. Revisit if twelve seats for twenty houses
  proves too generous.

- **Titles are bought, and lost by a court, not by a vote.** Twelve degrees, from roturier to
  prince, bought at the town hall: they cost gold, give prestige, open a level of residence and
  some offices. Money buys the ladder; the court can strip a degree as a sentence; death drops
  the house one degree. A majority that could strip a title would be a weapon, and a judge is a
  defence. Revisit if titles become a pure money sink.

## Identity

- **A token, not an account.** An opaque 256-bit token, stored hashed, shown once, no email, no
  recovery. The token is the whole identity, which is a fair price for zero sign-up. The
  consequence is stated in the interface: lose the token, lose the house. Revisit if the game is
  ever opened to strangers.

- **The token is bound to a house, and that binding lives outside the world.** A `players` table
  holds the token hash, the world, the house, a revocation date and the last visit. The binding
  is not part of the world because the world is versioned, replayed and hashed; a login is not a
  game rule, and a format change must never be able to lock a player out. The last visit lives
  there for the same reason: the thirty-day deletion is an edge rule, not a simulation rule,
  because a world's catch-up cannot count weeks it never simulated. Authorisation is checked
  once, at the edge, before the world is loaded. One live token per house for now, enforced by a
  partial unique index; the release that allows several tokens per house lifts it and adds a
  revoke-all.

## State

- **The server holds the world; the client renders it.** The client stores nothing: no local save
  to version, to lose with a cleared browser, or to reconcile between two devices. It receives a
  projection of the world and the events of the week, and it computes no rule. Revisit if the game
  has to be playable offline for long stretches.

- **The world catches up on read; there is no scheduler.** `tick` is pure, so the server computes
  the weeks elapsed since the last visit when a player asks for the world. A cron would add a
  component to watch and would not change what the player sees. The contract: one game week per
  real hour, capped at 744 weeks per read (a full month), with the events of the last week
  returned and the rest summarised as counters. Beyond the cap the wall clock jumps over the
  remaining weeks: they were never simulated, the town only counts the weeks it lived, and the
  summary says how many were skipped. Without that jump a long absence would leave a backlog
  that every immediate read keeps ticking, so two reads with no time passing would disagree.
  Revisit when a shared season must move while nobody is looking.

- **One writer per world.** Catch-up turns a read into a write, so two requests for the same world
  could each replay the same weeks and lose one of them. The row is locked for the duration
  (`SELECT … FOR UPDATE`), actions carry a client-generated UUID with a unique constraint (a
  retried request is refused, not applied twice), and each action carries the week it was queued
  for: the server applies a week's actions in the order they were received, then ticks once.
  "Insertion order" alone is only well defined inside one week, so a sequence column holds it.
  Applied actions are kept: a retry must stay detectable, and the town must stay replayable.
  An action may name the week being played or the next one; a week that already ticked is
  refused, and the action endpoint never catches the world up itself.

- **The next format is a reset, not a migration.** No world is in production. The new model adds
  a person and changes what a seat holds (from a house to a person), which the additive rule
  cannot carry. The next `formatVersion` starts a new town; a world of the old format is refused,
  never guessed. The additive rule resumes from that format.

## Simulation

- **The core is pure, deterministic and clock-free.** One seed, one world, one hash. A test
  replays 200 weeks and asserts the same state hash, and another fails if `Math.random` or
  `Date.now` ever enters `packages/core`. Everything else depends on this: it is how a bug is
  reproduced, how a balance change is measured, and why the server can catch a world up at all.

- **One tick is one game week and one real hour; a year is a day.** Twenty-four weeks make a
  year, so the calendar advances a year per day. A mandate lasts a day; a character enters at
  twenty, is offered retirement at fifty, and dies somewhere after, with a median around
  sixty-two. The day is the unit the player actually plays; the week is the tick. The earlier
  argument against faster elections — a ceremony that fires while the player sleeps and rewards
  being awake — is answered by a fixed daily ceremony that is **queued in advance**, not by a
  slower one. Two clocks must not be confused: the length of the year and the election cadence
  are rules and move the `rulesetVersion`; how long a week lasts and how far a catch-up goes are
  `PACING`, read by the server, and changing them must not refuse an existing world. Revisit if
  the calendar feels too fast in play.

- **Money is integer cents.** No float anywhere: the economy must replay exactly, and a drift of
  a hundredth per tick is invisible until it is catastrophic.

- **A workshop produces into a stock, and selling is an action.** Production credits goods, the
  sale credits coin, never both. The stock has a capacity fixed by the workshop's level, and it
  does not spoil; what reduces it is theft. Holding is a bet on next week's price, and dumping a
  large stock moves the price down for everyone. This replaces the earlier rule that output was
  sold on production: that rule was chosen to count the output once, and the stock keeps that
  property while giving the workshop its first real decision. Revisit if holding across weeks
  proves to be a second mechanic too many.

- **Theft is what a stock loses, and a shield is what a victim earns.** A theft is a secret coup
  resolved two weeks later: the thief's intrigue against the target's defence. A failure leaves a
  proof at the clerk's office; a success leaves nothing. Each hostile act a house absorbs raises
  its shield, which fades with the weeks, so the first blow is easy and the fifth is almost
  impossible. Spoilage would have been a clock; theft is a decision by someone, and it makes a
  full warehouse a target. Revisit if the shield makes a vendetta impossible.

- **The price lags a week, and the town prices the week after.** A week's net flow (sold minus
  bought) pushes the next week's price away from its reference, and the gap back closes a quarter
  a week, so a shock fades instead of becoming the new normal. The lag is on purpose: the price
  you see is the town you were, and what you do now moves the price you will sell at next week.
  The town also has a standing demand per good, so a good nobody makes climbs and a good it takes
  nothing of sits on its reference.

- **Engagements have durations; there are no action points.** A campaign runs eight weeks, a
  hearing is held six weeks after the complaint, a building site takes twelve. They are counted
  in weeks, so they survive a catch-up: the world replays whole weeks and resolves what falls
  due. A budget of actions per week would be action points with another clock; the calendar is
  the scarcity, and it does not punish sleep. Revisit if players stop returning between
  engagements.

- **Laws are domains, plus exceptional votes.** Each office fixes its own laws alone: the mayor
  the sales and guild taxes, the provost the definition of crimes, the alderman the price of
  grain, wool and cloth and the rents, the treasurer the succession duty, the clerk the
  admissibility of complaints, the crier libel, the master of the hall the places and the seal.
  The council votes only the
  exceptional measures — a public work, a loan, a recoinage, an amnesty, a requisition, the
  gates, an ennoblement — with a quorum of seven, a majority of the votes cast (abstentions
  excluded) and at least four yes. The vote is public; the mayor convenes, and four of the seven
  offices can force a sitting. A dormant house keeps its seat but casts no vote; a sitting counts
  only the seats that answer, and a boycott of six blocks it just the same. This is Europe 1400's
  model, with a parliament kept for the big things: the five seats without a lever become the
  swing vote. Revisit if the council never meets.

- **The court is a jury of five random houses, voting in secret, and a judge who does not vote.**
  A complaint is filed at the clerk's office with evidence; five houses drawn at random,
  excluding the parties, judge, and a dormant juror is replaced. The judge is the office that did
  not investigate — the provost judges what the clerk built, and the reverse — so no one defines
  a crime, gathers the proofs and sets the price. He does not vote: he fixes the sentence and
  breaks a tie. The law's severity sets the range, the evidence sets the starting point, and the
  judge moves it. Three penalties: a fine (a tenth of the estate for a medium sentence), the loss
  of a title degree, and prison — two days for a medium sentence, and a political death rather
  than a pause, since the prisoner keeps his house and his trade but cannot stand, vote, judge or
  buy a title, and his office is suspended until the next election. There is no exile. Evidence
  can be destroyed, hidden or fabricated; a forged proof is a crime, and the clerk examines
  authenticity, which balances the provost's investigation. The jury is where the houses without
  a seat hold power, and the secret ballot is the only vote one can buy without knowing whether
  the money worked. Revisit if juries are captured or trials are too slow.

- **Death is a window, retirement is a choice, and the heir inherits the house, not the career.**
  At fifty, retirement is offered; refusing opens a window in which death may come any week,
  with a chance that rises to certainty around a hundred and ten. The roll happens in the tick,
  whether the player is connected or not. The heir keeps the house's money, workshops, stock and
  grudges, loses the career and the seats, drops one title, pays about fifteen per cent of the
  estate in duty and funerals, and starts with ten in each attribute plus a tenth of what the
  parent had gained. The choice is what keeps death from being a tax on time passing; the rise
  is what makes staying a gamble. Revisit if generations feel like a treadmill.

- **The AI plays politics.** Each week an AI house chooses a seat by its rank, spends favour to
  campaign, supports a camp and remembers who beat it. It also buys the input its workshops lack,
  as before, and sells its stock at the market price. The earlier rule — an AI buys and decides
  nothing else — was right for a town of four; at twenty it leaves the player alone in a crowd.
  It sells its whole stock every week at the market price: it takes the price, it does not time
  it, so the flow stays regular and the price readable. Revisit when an AI must choose what to
  produce.

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
  deployment, no CDN. In development, two processes; in production, one image that serves both,
  with nothing between the browser and the server. The image mounts the Vite output behind
  `WEB_ROOT` and refuses to start without its `index.html`: a client that was never built is a
  404 on the domain that every probe would otherwise call healthy. Hashed assets are cached
  forever, `index.html` and the service worker never.

- **Migrations can be checked without being applied.** `migrate --check` exits non-zero while the
  image carries a migration `schema_migrations` does not have, and `applyMigrations` takes a
  Postgres advisory lock before touching anything, table included. That is the hook a deploy
  uses to hold back a new instance until the schema matches its image.

- **Readiness asks the database; liveness does not.** `/readyz` runs one `SELECT 1` and fails
  while it cannot; `/healthz` touches nothing. Wired the other way, a database outage would
  restart every pod and turn one problem into two.

- **The world is one `jsonb` column in Postgres.** One document per world, read and written whole,
  and the database is asked for nothing but durability. Revisit if a screen ever needs to query
  inside the world rather than read it.

- **The state hash the API returns is the projection, not the world.** The world hash covers the
  seed and the generator; published, it would let a client brute-force a young town's seed and
  simulate its whole future. Two reads with no time passing still agree, because they return the
  same projection.

## Interface

- **A chancery, not an isometric town.** The game is played in documents: registers, letters,
  edicts, a pyramid of seats. It is what the domain is, and it removes the largest cost of the
  project, which is art. The one illustration is the town scene on the home screen; a map of
  places, drawn in seals, is navigation, not a second scene. Revisit if the town view ever
  becomes a place where the player acts.

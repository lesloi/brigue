# Decisions

Lasting choices and the reason behind each. They can be questioned: if one no longer holds,
propose another with your arguments, then rewrite its entry. Git keeps the history.

## Product

- **A mobile-first PWA, not a native app.** The player plays in short visits, on a phone. An
  installable PWA opens full screen, needs no store review, and keeps the desktop as a widened
  version of the same screens instead of a second product. A store listing was explicitly not
  wanted. Revisit if native-only capabilities (push, background work) become the point, or if
  the installed feel is not enough in daily use.

- **One world and one town, not one world per player.** The town is a shared object: twelve seats,
  held by people, each house controlled by an AI or a human. Solo is the same code with every seat
  but yours on AI. A world per player would make multiplayer a rewrite instead of an assignment.
  The seat is held by a **person**, not a house; that is what makes a career and a succession
  possible. Revisit only if the town proves too small to hold a solo player's pace.

- **A silent house is forgotten, not robbed; a human who arrives takes an AI's place.** Silence
  is a state of the town, not a punishment: a house with no visit for a few days — three,
  calibrated in `PACING` — goes dormant. It keeps its money, its stock, its grudges and its heir,
  and nothing is taken from it; a rival gains nothing from the door being closed. What it loses is
  standing: the workshop idles, it stands for nothing and votes for nothing, so its seat is
  contested without it, and its prestige and favour decay while it is silent. The town is then
  governed by the houses that are there, which is the point of a shared council. After thirty days
  without a visit the house is deleted and the token with it: no return, no vacation mode, and no
  AI ever plays it. When the last human house goes, the town goes with it: the next player starts
  a new town, and only the sealed register and the book of kings cross. The deletion stays an edge
  rule. The reverse is asymmetric: when a full town
  receives a human, the finished-trade AI house ends and the newcomer chooses a trade, starts with
  its workshop and no money, no seat, no career. No AI is created after the opening; the ten
  opening families are the opening composition, and a freed finished-trade place waits for a
  human. The three raw suppliers are permanent AI. An absence must not be a betrayal, and an
  arrival must not inherit a mayoralty.

- **The town is capped at twenty houses, ten of them AI.** The cap is what makes a seat scarce:
  twenty houses for twelve seats is a contest, and the council only becomes political once the
  town outgrows its seats. Above the town, the same houses compete for seven seats of county and
  seven of kingdom, shared across their towns: the higher the tier, the scarcer the seat. The AI
  cap keeps the town human: a shared world is mostly people, and a solo world is ten AI and one human house. The town opens with ten AI in the target — three permanent raw suppliers and seven
  finished trades — and six today (three raw, three finished). A human arriving when it is full
  replaces a finished-trade AI, never a raw supplier; the AI count only falls as humans arrive,
  and "ten" is the opening composition, not a floor. Revisit if a whole kingdom proves too small
  at twenty houses a town.

- **The player chooses a trade at creation; the raw suppliers stay AI.** At the first launch,
  every player chooses one of three trades: weaver (wool into cloth),
  baker (grain into bread), carpenter (wood into planks). The house starts with a workshop of
  that trade; no assignment balances the town's mix. The first house is not a political
  role: it holds no seat and no vote, and only its starting kit differs — a workshop of its
  trade, eight units of its input and a purse, because its first sale is hours away. The town is
  built without it: the first house is added when the first player joins, so no town waits empty
  for someone. Its name is drawn from the town's names at that moment — nothing about the first
  house is fixed — and the player may rename it later (not built yet). A human who
  arrives later, replacing a finished trade, brings its workshop and nothing else; the first house's
  place, re-founded after a deletion, keeps the kit, because it is the opening slot and
  not a newcomer taking an AI's place. The three raw
  suppliers (wool, grain, wood) stay AI houses forever and are never replaced by a human: they
  are the floor that keeps every chain fed, so a player town cannot lose an input to a newcomer
  who chose another trade. The finished trades are what humans replace. The price signal and
  the trade conversion of the residence work let a player move into a missing finished good; a
  town of weavers will have cheap cloth and dear bread, which is the market working, not a bug.
  Revisit if the raw floor makes the town feel like a diorama rather than a player economy.

- **The town's council is a pyramid of twelve: one, two, four, five.** The seats are ranked, and
  each floor holds a different right rather than a stronger version of the one below. One office per
  person, all elected on the same day, every day; to climb, a person gives up the office they
  hold. **The career is the gate**: standing for a floor requires the house to have held an
  office of a lower floor, and one mandate is enough. The career belongs to the house, and the
  heir keeps it one floor lower. The five
  seats at the base hold no lever: salary, prestige, a vote on exceptional measures, and jury
  duty. A vacant seat blocks nothing — the power is simply unavailable, as in Europe 1400 — so a
  young town has no mayor for its first four elections. Revisit if twelve seats for twenty houses
  proves too generous.

- **Three tiers above the loom: the town, the county, the kingdom.** Twelve seats in the town,
  seven in the county, seven in the kingdom; the mayor heads the town, the count the county, the
  king the kingdom. Each tier holds a right the tier below cannot exercise, never a stronger
  version of it: the town fixes prices, taxes, crimes, the market and the court; the county holds
  the tolls, the roads, the granary and the appeal against a town; the kingdom holds the coin, the
  general ordinance and the staple — the staple being the right to force a good through one town
  before it is sold elsewhere. The pyramid of twelve is the lowest tier, not the
  whole house. None of it above the town is in the code, and the town comes first: the county and
  the kingdom wait until the town has a council that votes, a court and a register. Revisit if the
  tiers end up voting the same thing three times.

- **One franchise everywhere.** Every house votes at every tier, at the same scrutiny, with the
  same roll and the same campaign bonus; what changes with the tier is the title required, the
  career required and the price of a campaign. A narrower college — mayors electing the county,
  counts electing the king — would disenfranchise the house that has just lost, and the career
  gate already forces the ladder. The price of a campaign rises with the tier and the favour
  spent on one is never refunded: buying a crown must ruin a house.

- **Titles are bought, and lost by a court, not by a vote.** Twelve degrees, from roturier to
  prince, bought at the town hall: they cost gold, give prestige, open a level of residence and
  some offices. Money buys the ladder; the court can strip a degree as a sentence; death drops the
  house one degree. A majority that could strip a title would be a weapon, and a judge is a
  defence. Revisit if titles become a pure money sink.

- **Favour is earned by service and by visible spending.** A mandate held, a jury served, a vote
  cast with the winner: the exercise gives a little, often. A gift to the treasury, a funded work,
  a banquet: money gives a lot, once. Crimes take it away. Favour is the currency of elections,
  and it has two speeds on purpose: the incumbent accumulates, the newcomer buys a campaign.
  Revisit if one speed swallows the other.

- **The long game is the register, and the register is a chronicle.** One line per house at the
  clerk's office — prestige, offices held, titles, generations and wealth — shown to everyone. No
  single number ranks them: the register ranks by column, so a merchant, a notable and a dynasty
  are each first at something. A cumulative score would put the oldest house ahead forever and
  turn a story into a points race. While the town lives the register is never wiped: 1407 stays 1407. Revisit if the columns stop saying anything.

- **The only ending is a won crown, and the crown reigns a day.** No season ends on a clock and no
  wipe takes the register: a house is reset by death, one at a time, so the register turns over
  without being erased. The town ends when a king is crowned: the kingdom election is the last
  election, and its winner reigns one real day — a town year — before the world closes. The day
  is not a formality: he grants the staple and issues the ordinance, and the town lives under them
  until midnight. Nobody can depose him: there is no plot and no counter-power, because the season
  is already over.
  Neither bell of that last day renews anything — the seal takes their place — and it opens a new
  town with the same names. What crosses is the record and nothing else: the
  sealed register is kept and readable, the king enters the book of kings with his house, his day
  and the line of what he did — the ordinance he gave and the staple he granted — and his line
  wears the crown there. The crown follows the player, not the name: a name taken again inherits
  nothing. It is worth no more than the line it writes. No law
  of his binds the new town, and the good he favoured has no privilege in it. Revisit if the last
  election is decided before it starts, or if the day goes unwatched.

- **The residence is one ladder.** The title opens a level, money pays for it, and the level sets
  the prestige cap, the defence of the stock, the warehouse capacity and the number of workshops.
  Three separate ladders would be three things to read on a phone; one says what the house can
  hold, which is what chapter II must teach. Revisit if a level stops meaning anything.

## Identity

- **A token, not an account.** An opaque 256-bit token, stored hashed, shown once, no email, no
  recovery. The token is the whole identity, which is a fair price for zero sign-up. The
  consequence is stated in the interface: lose the token, lose the house. Revisit if the game is
  ever opened to strangers.

- **The token is bound to a house, and that binding lives outside the world.** A `players` table
  holds the token hash, the world, the house, a revocation date and the last visit. The binding
  is not part of the world because the world is versioned, replayed and hashed; a login is not a
  game rule, and a format change must never be able to lock a player out. The last visit lives
  there for the same reason: the thirty-day deletion is an edge rule, not a simulation rule, and
  it must happen whether or not the town is being played. Authorisation is checked
  once, at the edge, before the world is loaded. One live token per house for now, enforced by a
  partial unique index; the release that allows several tokens per house lifts it and adds a
  revoke-all.

## State

- **The server holds the world; the client renders it.** The client stores nothing: no local save
  to version, to lose with a cleared browser, or to reconcile between two devices. It receives a
  projection of the world and the events since it last read, and it computes no rule. Revisit if
  the game has to be playable offline for long stretches.

- **The town moves without a reader; a scheduler advances it.** `tick` is pure, so the server can
  advance the world once an hour and write the result, sweeping everything that fell due since the
  last pass in chronological order: the town lives while nobody looks, and a read is a plain read.
  The hour is the clock, so what takes less than one is rounded up, and the screen says the hour
  something ends, never the minute. Catching up on read gave the first player back the whole bill
  — a burst of weeks under the row lock, a cap that skipped the rest, and a town with no history
  while no one was reading it. The price is a component to watch: a stopped scheduler leaves every screen
  healthy and the world frozen, so the age of the world is what an operator alerts on. Catch-up
  stays as the backstop for a missed run: a read advances the town only when it is more than an
  hour behind — that is, when the scheduler is down — so it writes nothing the rest of the time.
  The rate, how many real hours a year lasts, lives in `PACING`, read by the server, never in the
  world. Revisit if the scheduler proves more fragile than the read path it replaced.

- **One writer per world.** The scheduler and the backstop both write the same town, so two passes
  could each advance it and lose one of them. The `state` row is locked for the duration
  (`SELECT … FOR UPDATE`) whichever way the write comes, and that lock is what keeps the two
  writers apart. Actions carry a client-generated UUID with a unique constraint (a retried
  request is refused, not applied twice) and a sequence column holds the order in which they were
  received, because insertion order alone is not a contract. Applied actions are kept: a retry
  must stay detectable, and the town must stay replayable. The scheduler applies what was queued
  before it advances, an action queued for an instant the town has already played is refused
  rather than replayed, and the action endpoint never advances the world itself. A queued action
  can be cancelled before its hour plays: the row is marked, never deleted, so a retry stays a
  duplicate and the hour's replay uses the actions that were still queued when it played. The
  list of queued actions does not advance the town either; the town's own hour is the only
  applied verdict, and the wall clock only bounds how far ahead an action may be placed.

- **The journal is a feed, not an archive.** A scheduler writes events nobody is reading, so every
  event carries its instant and its audience, the log has growing ids, and the filter by audience
  happens at read time. Each player holds a cursor outside the world, like the
  last visit. A read returns the newest fifty events since that cursor in detail, and counts the
  rest by type and by refusal; raw events are dropped after a few days. The register carries what
  lasts; the journal carries only what is new.

- **A format change migrates or resets, and a reset is never silent.** Within a format, changes
  stay additive: a new field with a default. A change the additive rule cannot carry starts a new
  `formatVersion`; a world of another format is refused, never guessed. A world with a registered
  migration is converted; one without is not deleted in silence: the reset names what it will
  destroy and refuses until an operator confirms it. The format that ships next is
  the first: it deletes the test towns, the earlier formats and their migrations, and starts
  `formatVersion` and `rulesetVersion` at one. Nothing in them is worth carrying, and a version
  number that records a history nobody can read is a cost, not a safeguard. Once a town has
  players whose history matters, a breaking change ships a migration by default.

  This first format resets with `pnpm --filter @brigue/server reset`: the schema is dropped and
  rebuilt from the one migration, and the sealed seasons stay untouched. `--check` shows what
  would go, `--force` skips the question, and otherwise an operator reads the same report and
  answers `yes` on a terminal; without one, it refuses. A full reset, with `--full`, deletes the
  sealed seasons too and is the only one that touches the register. The tokens do not cross yet
  — the tables that hold the binding are rebuilt, and nothing can bind a token to a new house —
  so a reset clears them with the town until the seal lands.

  The next format carries the clock, the scheduler, the journal and the tables, and nothing else:
  the town's politics lands additively inside it, and the floors above the town wait for the
  format after. One thing at a time, and the only change that cannot wait is the one that breaks
  the shape of the world.

## Simulation

- **The core is pure, deterministic and clock-free.** One seed in, one world out: the town is
  built from the seed, and the first house is added when its player joins with the trade that
  player chose. Two towns from the same seed can therefore start in different chains, and a seed
  alone does not rebuild a playable town. A stored world carries the trade in its workshops. A test replays two hundred advances and asserts the same state hash,
  and another fails if `Math.random` or `Date.now` ever enters `packages/core`. Everything else
  depends on this: it is how a bug is reproduced, how a balance change is measured, and why the
  server can catch a world up at all.

- **Time is continuous; a year is a day.** The simulation advances to an instant, not by whole
  weeks: what falls due before that instant is resolved in order, and every event carries the
  instant it happened. A year lasts a real day, so a month lasts two hours and a life about sixty
  days; the rate is `PACING`, and changing it must not refuse a world. The word "week" is gone from
  the game: a duration is said in hours when the player plans and in months when the town speaks.
  What is a rule is the shape of the calendar — twelve months to the year, a mandate of a year, a
  person who enters at twenty and is offered retirement at fifty — and changing that moves the
  `rulesetVersion`. Revisit if a continuous clock makes the town harder to read than a weekly one.

- **Two bells a day: noon and midnight.** At noon the council sits, the court judges and
  candidacies close; at midnight the year turns, every seat comes up and the votes are counted.
  Two fixed hours are what
  let a player queue an action in advance and still be counted: the deadline is the same for
  everyone, and it does not reward being awake. The server's clock is on the screen, so noon means
  the server's noon wherever the player sits. An extraordinary sitting can still be forced, and
  it is the exception that proves the bells. Revisit if two rendezvous a day is a schedule players
  cannot hold.

- **Money is integer cents.** No float anywhere: the economy must replay exactly, and a drift of
  a hundredth per advance is invisible until it is catastrophic.

- **A workshop produces into a stock, and selling is an action.** Production credits goods, the
  sale credits coin, never both. The stock has a capacity fixed by the house's residence — a
  constant until the residence ladder lands — and it does not spoil; what reduces it is theft.
  Holding is a bet on the next price, and dumping a large stock moves the price down for
  everyone. This replaces the earlier rule that output was
  sold on production: that rule was chosen to count the output once, and the stock keeps that
  property while giving the workshop its first real decision. Revisit if holding across hours
  proves to be a second mechanic too many.

- **Theft is what a stock loses, and a shield is what a victim earns.** A theft is a secret coup
  resolved two hours later: the thief's intrigue against the target's defence. A failure leaves a
  proof at the clerk's office; a success leaves none, unless the watch is out — its size, paid by
  the mayor and commanded by the provost, sets the chance that even a clean theft leaves a trace,
  and a bought provost can look the other way. The guard defends no stock: it makes theft visible,
  which threatens the thief with the court instead of adding a second ladder of defence. Each
  hostile act a house absorbs raises its shield, which fades with the hours, so the first blow is
  easy and the fifth is almost impossible. Spoilage would have been a clock; theft is a decision
  by someone, and it makes a full warehouse a target. Revisit if the shield makes a vendetta
  impossible.

- **Six goods, three chains.** Wool into cloth, grain into bread, wood into planks. Three trades —
  weaver, baker, carpenter — one chain each, and a person keeps one trade at a time but may learn
  another, converting the workshop. The town eats bread, builds with planks and wears cloth, so
  each chain has a buyer. Europe 1400 had sixty-nine goods; six is what a phone screen and twenty
  houses can carry. Revisit when a seventh good arrives with a new trade.

- **The price is settled at the bells.** A half-day's net flow (sold minus bought) pushes the next
  price away from its reference, and the gap back closes a quarter at each bell, so a shock fades
  instead of becoming the new normal. The lag is on purpose: the price you see is the town you
  were, and what you do now moves the price you will sell at after the next bell. The town also
  has a standing demand per good, so a good nobody makes climbs and a good it takes nothing of
  sits on its reference.

- **Engagements have durations; there are no action points.** A building site takes twelve hours,
  a campaign is a candidacy lodged before the noon bell — its old run is gone, because one that
  ended four hours before the vote was decoration — a hearing is held at the next noon sitting
  after the complaint, and the provost investigates in the hours between. A duration counts in
  town time and the screen shows the hour it ends, so a player plans with "ready at 19:00". What
  falls due is resolved by the
  next advance, even if the town has already passed the instant, and the event carries both
  instants: late rather than dropped. A budget of actions per hour would be action points with
  another clock; the calendar is the scarcity, and it does not punish sleep. Revisit if players
  stop returning between engagements.

- **Laws are domains, plus exceptional votes.** Each office fixes its own laws alone: the mayor
  the sales and guild taxes and the watch's budget, the provost the definition of crimes, the
  alderman the prices of the town's goods and the rents, the treasurer the succession duty, the
  clerk the admissibility of complaints, the crier libel, the master of the hall the places and
  the seal. The mayor may change one of his own laws a day and no more.
  The council votes only the
  exceptional measures — a public work, a loan, an amnesty, a requisition, the gates — with a
  quorum of seven, a majority of the votes cast (abstentions excluded) and at least four yes. A
  recoinage is not the town's to vote: the tier above holds the coin. The vote is public; the mayor convenes, and four of the seven offices can force a
  sitting outside the bells. A dormant house keeps its seat but casts no vote, so a sitting counts
  only the seats that answer, and a boycott of six blocks it just the same. This is Europe 1400's
  model, with a parliament kept for the big things: the five seats without a lever become the
  swing vote. Revisit if the council never meets.

- **The court is a jury of five random houses, voting in secret, and a judge who does not vote.**
  A complaint is filed at the clerk's office with evidence — a visible crime leaves a proof to its
  victim, a secret one leaves a proof only when it fails, and the provost's investigation finds
  the rest; five houses drawn at random, excluding the parties, judge, and a dormant juror is
  replaced. The judge is the office that did
  not investigate — the provost judges what the clerk built, and the reverse — so no one defines
  a crime, gathers the proofs and sets the price. He does not vote: he fixes the sentence and
  breaks a tie. The law's severity sets the range, the evidence sets the starting point, and the
  judge moves it (minor five per cent and one day, medium ten and two, serious twenty and three).
  Three penalties: a fine (a tenth of the estate for a medium sentence), the loss
  of a title degree, and prison — two days for a medium sentence, and a political death rather
  than a pause, since the prisoner keeps his house and his trade but cannot stand, vote, judge or
  buy a title, and his office is suspended until the next election. There is no exile. Evidence
  can be destroyed, hidden or fabricated; a forged proof is a crime, and **the clerk in office
  exposes it automatically** — while he sits and is awake, no forgery passes, so a forger must
  first bribe, defeat, or wait for a vacancy. A bribe is money and intrigue, for a few hours,
  against one category of acts; discovered, it is a crime for both. The jury is where the houses without
  a seat hold power, and the secret ballot is the only vote one can buy without knowing whether
  the money worked. Revisit if juries are captured or trials are too slow.

- **Death is a window, retirement is a choice, and the heir inherits the house and the career one
  floor lower.**
  At fifty, retirement is offered; refusing opens a window in which death may come at any
  scrutiny, with a chance that rises to certainty around a hundred and ten. The roll happens at
  the midnight bell, whether the player is connected or not. The heir keeps the house's money, workshops, stock and
  grudges, keeps the career one floor lower, loses the seats, drops one title, pays about fifteen
  per cent of the estate in duty and funerals, and starts with ten in each attribute plus a tenth
  of what the parent had gained. The choice is what keeps death from being a tax on time passing; the rise
  is what makes staying a gamble. Revisit if generations feel like a treadmill.

- **The AI plays politics.** At each scrutiny an AI house chooses a seat by its rank, spends favour to
  campaign, and remembers who beat it. It votes according to its interests and its grudges. It also buys the input its workshops lack,
  as before, and sells its stock at the market price. The earlier rule — an AI buys and decides
  nothing else — was right for a town of four; at twenty it leaves the player alone in a crowd.
  It sells its whole stock every hour, at the market price: it takes the price, it does not
  time it, so the flow stays regular and the price readable. It buys its inputs every hour
  too, or its workshops would starve between two bells. Revisit when an AI must choose what to
  produce.

- **A refusal is an event, never a throw.** The server replays stored actions days later; one
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

- **The client is Preact, and the projection descends in props.** A document game is six screens
  of forms, lists and dialogs: hand-written templates carried one screen, but at six they are a
  pile of `innerHTML`, `querySelector` and listeners rewired on every paint. Preact keeps the
  rule — the client renders a projection and decides nothing — with components and local state,
  for about 4 kB gzipped and one dependency. No router library and no state library: the
  projection goes down the tree, everything else stays local. React was the other candidate; its
  ecosystem buys nothing here and its runtime is ten times the size. Revisit if the bundle
  outgrows a phone or the state stops fitting in props.

- **One container serves both the API and the built client.** Same origin, no CORS, no second
  deployment, no CDN. In development, two processes; in production, one image that serves both,
  with nothing between the browser and the server. The image mounts the Vite output behind
  `WEB_ROOT` and refuses to start without its `index.html`: a client that was never built is a
  404 on the domain that every probe would otherwise call healthy. Hashed assets are cached
  forever, `index.html` and the service worker never.

- **Migrations can be checked without being applied.** `migrate --check` exits non-zero while the
  image carries a migration `schema_migrations` does not have, and `applyMigrations` takes a
  Postgres advisory lock before touching anything, table included. That is the hook a deploy can
  use to hold back a new instance until the schema matches its image.

- **Readiness asks the database; liveness does not.** `/readyz` runs one `SELECT 1` and fails
  while it cannot; `/healthz` touches nothing. Wired the other way, a database outage would
  restart every pod and turn one problem into two.

- **The world is the database: tables, not a document.** One live world per database and no
  `world_id` anywhere — houses, people, seats, workshops, stock, laws, engagements, campaigns and
  the market are the town itself. One row, `state`, carries what belongs to no house: the seed,
  the generator's cursor, the hour and the year; it is what the writer locks. The simulation still reads and writes the world whole, but the storage keeps it in rows,
  so a screen can read the market alone and the register is a query. A format change is a
  migration across those tables; a reset is a wipe of them. What a sealed season keeps is the
  register, not the town: the seal writes the houses' last columns and the book of kings into an
  archive that outlives every ordinary reset, a format change included, and the town itself is
  dropped; only a full reset deletes it.
  The players outlive a season's seal, which takes the house and keeps the token; this first
  format change rebuilt the tables that hold the binding before that seal existed, so it clears
  the tokens with the town. Once the seal lands, a reset keeps them. Revisit if the archive must
  hold the whole town, or if one world per database proves too rigid for tests.

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

- **The back button walks the tabs, then leaves.** A tab is a history entry: opening Marché
  pushes one, and the back button returns to the tab you came from; from the home tab it leaves
  the PWA rather than trapping the player in a loop. No router: a tab switch is one `pushState`,
  and `popstate` restores the tab. A deep-linked Marché has no in-app predecessor, so going home
  replaces the entry instead of leaving. Revisit if a screen grows sub-views that need a back of
  their own.

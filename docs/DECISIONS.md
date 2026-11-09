# Decisions

Lasting choices and the reason behind each. They can be questioned: if one no longer holds,
propose another with your arguments, then rewrite its entry. Git keeps the history.

## Product

- **A mobile-first PWA, not a native app.** The player plays in short visits, on a phone. An
  installable PWA opens full screen, needs no store review, and keeps the desktop as a widened
  version of the same screens instead of a second product. A store listing was explicitly not
  wanted. Revisit if native-only capabilities (push, background work) become the point, or if
  the installed feel is not enough in daily use.

- **One shared world of several towns, not one world per player.** The world holds several towns;
  a town is a shared object: twelve seats, held by people, each person played by an AI or an
  account. Solo is the same code with every seat but yours on AI. A town — or a world — per player
  would make multiplayer a rewrite instead of an assignment. The seat is held by a **person**; that is what makes a career and a succession possible. Revisit only if the town proves
  too small to hold a solo player's pace.

- **A join takes the first free place; a full world gets a new town.** The towns are visited
  least filled first — the one that needs people most — and the oldest breaks a tie. A human person
  no player has ever taken is a free place, and a town below twenty people takes a new human
  person; a town whose humans have all gone is left to its deletion, never given to a newcomer.
  When no town has a place, the join founds one — three AI people and the newcomer's person — and
  names it by drawing from a list of places. A name may come back; its id, assigned by the
  database, never does.

- **A silent person is forgotten, not robbed; a human who arrives takes an AI's place.** Silence
  is a state of the town, not a punishment: a person with no visit for a few days — three,
  calibrated in `PACING` — goes dormant. It keeps its money, its stock, its grudges and its heir,
  and nothing is taken from it; a rival gains nothing from the door being closed. What it loses is
  standing: the workshop idles, it stands for nothing and votes for nothing, so its seat is up
  without it, and if nobody stands for it the seat falls vacant; its prestige and favour decay while
  it is silent. The town is then
  governed by the people who are there, which is the point of a shared council. After thirty days
  without a visit the person is deleted and the token with it: no return, no vacation mode, and no
  AI ever plays it. When the last human person goes, the town goes with it: the next player starts
  a new town, and only the book of kings crosses. The scheduler applies the
  same silence rule on every pass, so a town with no player expires without waiting for a visit.
  The deletion stays an edge rule. A revoked token does not free the person: it waits for its
  owner until the deletion, like a silent one, and no arrival inherits its purse, its stock or
  its seat. The reverse is asymmetric: a human arriving later chooses a trade, starts with the
  same kit as the first person, and holds no seat or career. No AI is created after the opening:
  the three AI people are the opening composition. An absence must not be a betrayal, and an
  arrival must not inherit a mayoralty.

- **The town is capped at twenty people, three of them AI.** The cap is what makes a seat scarce:
  twenty people for twelve seats is a contest, and the council only becomes political once the
  town outgrows its seats. Above the town, the same people compete for seven seats of county and
  seven of kingdom, shared across their towns: the higher the tier, the scarcer the seat. The AI
  cap keeps the town human: a shared world is mostly people, and a solo world is three AI and one
  human person. The town opens with three AI people, one per finished trade; the raw goods come
  at the market, not from a person. The three are the composition: no AI is created or removed
  after the opening. Revisit if a whole kingdom proves too small at twenty people a town.

- **The player chooses a trade at creation; the raw goods are bought at the market.** At the first launch,
  every player chooses one of three trades: weaver (wool into cloth),
  baker (grain into bread), carpenter (wood into planks). The person starts with a workshop of
  that trade; no assignment balances the town's mix. No person is a political
  role: none holds a seat or a vote at the start. Every person begins with the same kit — a
  workshop of its trade, eight units of its input and a purse, because its first sale is hours
  away. The town is built without the first person: it is added when the first player joins, so no
  town waits empty for someone. Its name is suggested, prefilled at the creation and free to
  edit; the id is opaque and never derived from it. A human who arrives
  later joins with the same kit, in a free place; the first person's place, re-founded after a
  deletion, keeps it too. Wool, grain and wood are bought at the market at the current price; no
  person produces them, so every chain is fed whatever the town's trades. The three AI people are
  the finished trades, one per trade.
  The price signal and a third workshop of the good the town lacks let a player move into a
  missing finished good: a person of weavers can build a bakery once its residence holds it. A town
  of weavers will have cheap cloth and dear bread, which is the market working, not a bug.

- **The town's council is a pyramid of twelve: one, two, four, five.** The seats are ranked, and
  each floor holds a different right rather than a stronger version of the one below. One office per
  person, all elected on the same day, every day; to climb, a person gives up the office they
  hold. **The gate of a floor is an open question**: the design asked for a career of offices held,
  the code has none, and the career field went with the format of the single baseline. Whatever
  replaces it must be stated before it is built. The five
  seats at the base hold no lever: salary, prestige, a vote on exceptional measures, and jury
  duty. A vacant seat blocks nothing — the power is simply unavailable, as in Europe 1400 — so a
  young town has no mayor for its first four elections. Revisit if twelve seats for twenty people
  proves too generous.

- **Only those who stand are candidates, and one seat at a time.** A person stands by paying the
  campaign favour cost; the active incumbent stands without paying. A second open candidacy is
  refused, and a candidacy is never cumulative on the same seat. A person elected to one seat gives
  up any other it held: that seat falls vacant and is announced as such, even when it was settled
  earlier in the same scrutiny. The candidate learns the result whether the town changes hands or
  not; the town's chronicle carries only a new winner or a vacancy. A dormant incumbent who does not
  stand leaves the seat vacant. At the start of each year an AI person without a seat tries a
  random vacant one; a seated AI defends its seat and waits for #55 to climb.

- **Three tiers above the loom: the town, the county, the kingdom.** Twelve seats in the town,
  seven in the county, seven in the kingdom; the mayor heads the town, the count the county, the
  king the kingdom. Each tier holds a right the tier below cannot exercise, never a stronger
  version of it: the town fixes prices, taxes, crimes, the market and the court; the county holds
  the tolls, the roads, the granary and the appeal against a town; the kingdom holds the coin.
  The pyramid of twelve is the lowest tier, not the whole person. None of it above the town is in
  the code, and the town comes first: the county and the kingdom wait until the town has a council
  that votes and a court. Revisit if the tiers end up voting the same thing three times.

- **One franchise everywhere.** Every person votes at every tier, at the same scrutiny, with the
  same roll and the same campaign bonus; what changes with the tier is the title required and the
  price of a campaign. A narrower college — mayors electing the county, counts electing the king —
  would disenfranchise the person who has just lost. The price of a campaign rises with the tier and the favour
  spent on one is never refunded: buying a crown must ruin a person.

- **Titles are bought, and lost by a court, not by a vote.** Twelve degrees, from roturier to
  prince, bought at the town hall: they cost gold, give prestige, open a level of residence and
  some offices. Money buys the ladder; the court can strip a degree as a sentence; death drops the
  heir one degree. The degree is the person's; death drops the heir one degree, and the family
  name survives them. A majority that could strip a title would be a weapon, and a judge is a
  defence. Revisit if titles become a pure money sink.

- **Favour is earned by service and by visible spending.** A mandate held, a jury served, a vote
  cast with the winner: the exercise gives a little, often. A gift to the treasury, a funded work,
  a banquet: money gives a lot, once. Crimes take it away. Favour is the currency of elections,
  and it has two speeds on purpose: the incumbent accumulates, the newcomer buys a campaign.
  Revisit if one speed swallows the other.

- **The book of kings is the only record that crosses a reset.** One line per reign at the
  clerk's office: the player, the family name, the instant of the crowning and the time it took to
  crown a king. No register of families crosses; the town's own people are the register while it
  lives, and they go with it. The crown follows the player, not the name: a name taken again
  inherits nothing. Revisit if the long game needs the families' columns.

- **The only ending is a won crown, and the crown reigns a day.** No season ends on a clock and no
  wipe takes the book: a person is reset by death, one at a time, so the town turns over without
  being erased. The town ends when a king is crowned: the kingdom election is the last election,
  and its winner reigns one real day — a town year — before the world closes. The day is a
  formality: he grants nothing, and the town lives as it did. Nobody can depose him: there is no
  plot and no counter-power, because the season is already over.
  Neither bell of that last day renews anything — the seal takes their place — and it opens a new
  town with the same names. What crosses is the book of kings: the player, the family name,
  the instant of the crowning and the time it took. The crown follows the player, not the name: a
  name taken again inherits nothing. Revisit if the last election is decided before it starts, or
  if the day goes unwatched.

- **The residence is one ladder.** The title opens a level, money pays for it, and the level sets
  the prestige cap, the defence of the stock and the number of workshops (1,1,2,2,2,3,3,3,3,4,4,4).
  Three separate ladders would be three things to read on a phone; one says what the person can
  hold, which is what chapter II must teach. The title and the level are two purchases, the degree
  first: one purchase would make the title and the residence the same object and leave "standing"
  with nothing of its own. A title is obtained at the next noon or midnight, never at once: it is
  paid for the hour it is bought and delivered at the town's rendezvous, like a candidacy. Revisit
  if a level stops meaning anything.

- **The warehouse is what the workshops hold.** Every workshop gives capacity by its level — 100,
  200, 350 and on — and the person's warehouse is their sum. A second building is a second store,
  and storage grows with the workshop, which is what gives the level a use. The residence no longer
  fixes it: a ladder that decides how many buildings and how big each can be says capacity twice.
  The table is calibration and moves with the economy.

## Identity

- **A player account is a key, and there is no way back.** The interface introduces it as a
  _compte joueur_, then says only the account; the code and the database call the string a token.
  One opaque 256-bit secret,
  stored hashed, shown once, with no email, no password and no recovery. What an account with
  credentials would promise — a way back — is exactly what this withholds, and the interface
  states the consequence without softening it: without the account, the person cannot be found
  again. The account is the whole identity,
  which is a fair price for zero sign-up. A player who wants to
  leave for good asks for the deletion: it is scheduled a week out, the player can do nothing
  until the deadline, the account stays valid so that reconnecting offers to come back, and when
  the week is over the scheduler erases the account, the person and its queued actions — with the
  town when it was the last human. Silence is the other exit, and it
  waits thirty days.
  Revisit if the game is ever opened to strangers.

- **The token is bound to a person, and that binding lives outside the world.** A `players` table
  holds the token hash, the family name, a revocation date and the last visit; the person points
  back at the account through `people.player_id`. The binding
  is not part of the world because the world is versioned, replayed and hashed; a login is not a
  game rule, and a format change must never be able to lock a player out. The last visit lives
  there for the same reason: the thirty-day deletion is an edge rule, not a simulation rule, and
  it must happen whether or not the town is being played. A reset takes the person and keeps the
  account, so the binding may be empty between the two: the token is the identity, and only an
  explicit revoke ends it. Authorisation is checked once, at the edge, before the world is
  loaded. One live token per person for now, enforced by a unique index; the release that
  allows several tokens per person lifts it and adds a revoke-all.

## State

- **The server holds the world; the client renders it.** The client stores nothing: no local save
  to version, to lose with a cleared browser, or to reconcile between two devices. It receives a
  projection of the world and the newest page of its mail and of the town's chronicle, and it
  computes no rule. Revisit if
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

- **One writer per world.** The scheduler and the backstop both write the same town, so two
  passes could each advance it and lose one of them. The world's `hour` row in `settings` is
  locked for the duration (`SELECT … FOR UPDATE`) whichever way the write comes, and that lock is
  what keeps the two writers apart — and what serialises a save across every town, since there is
  one clock for the world. An action's id is the row's own sequence, and that id is the order in
  which actions were received, because insertion order is the only contract there is. The client
  sends
  no id: a request replayed after a lost response is a second action, and the town accepts it.
  Applied actions are kept, because the town must stay replayable. The scheduler applies what was
  queued before it advances, an action queued for an instant the town has already played is
  refused rather than replayed, and the action endpoint never advances the world itself. A queued
  action can be cancelled before its hour plays: the row is deleted, and the hour's replay uses
  the actions that were still queued when it played. The list of queued actions does not advance
  the town either; the town's own hour is the only applied verdict, and the wall clock only
  bounds how far ahead an action may be placed. Revisit if a flaky phone starts buying twice.

- **The journal is two pages: a private mailbox and a public chronicle.** A scheduler writes
  while nobody reads, so every event carries its hour and its audience. A line addressed to the
  town is a chronicle line: small, shared, and the same page for every reader — an election that
  changed a seat, later a law. A line addressed to a person is a message: a refusal, a work built
  or lost, a debt paid or unpaid, a candidacy, an election result. Only a human person has a
  mailbox, addressed by the account's player id (minted once for the whole server); an AI one reads
  nothing, so its private lines are written for nobody. A notice carries its `type` and the
  `payload` of its sentence; a letter from a player is prose — `type` null, `body`, and the
  `author_player_id` the server takes from the session — and lands in the recipient's box. A
  public square is not this table. The chronicle
  keeps seven real days and the mail thirty (`PACING.chronicleRetentionHours`,
  `PACING.messageRetentionHours`), cut by the wall clock at the write, so a scheduler stopped
  longer loses the days before the stop. A read returns the newest fifty of each in time order;
  there is no per-reader filter, so one reader's visit can never hide a line from another. A message
  is unread until the player opens the Courrier, which marks the box read; the `read` flag is the
  whole unread state, there is no cursor on the account, and it hides no line. A person deletes a
  message one by one, and there is no trash or tombstone: the row goes. The badge counts at
  most the page it can open, and opening marks the whole box: mail older than the newest fifty is
  pruned unseen rather than shown twice. The Courrier and the Greffe are the
  only screens that render the journal: a trade lives on the Marché, production and works on the
  Maison, and an event no screen needs is not written. The book of kings carries what lasts; the
  journal carries only what is recent.

- **A format change migrates or resets, and a reset is never silent.** Within a format, changes
  stay additive: a new field with a default. A change the additive rule cannot carry starts a new
  `formatVersion`; a world of another format is refused, never guessed. A world with a registered
  migration is converted; one without is not deleted in silence: the reset names what it will
  destroy and refuses until an operator confirms it. The format in the code is the third: it
  moves the world's variables into one shared `settings` table, drops the per-town `state` row
  and the generator cursor, and derives the year from the hour. It follows the second, which
  merged the `dynasties` table into `people`, with no migration, because the towns are test towns
  and the reset below is how a database crosses. Two names keep Maison and a later pass must not "fix"
  them: the tab that opens the person's screen, and the residence level of that name, which is a
  building. A database crosses with that reset, run before the
  rollout is approved; `migrate` is not the path, since `schema.sql` is already recorded under its
  name and the gate would report nothing pending on a database that needs the rebuild.
  Nothing in a test town is worth carrying, and a version
  number that records a history nobody can read is a cost, not a safeguard. Once a town has
  players whose history matters, a breaking change ships a migration by default.

  A reset (`pnpm --filter @brigue/server reset`) drops the schema and rebuilds it from
  `db/schema.sql`, and the book of kings and the accounts stay. `--check` shows what
  would go, `--force` skips the question, and otherwise an operator reads the same report and
  answers `yes` on a terminal; without one, it refuses. A full reset, with `--full`, deletes the
  book and the accounts too and is the only one that touches them. A carried account keeps its
  token, its player id and its dates, and loses its town and its person: the next visit asks for a
  trade, which gives it a person again — the first player to come back founds the town, the others
  take a place. A scheduled deletion keeps its deadline, and the scheduler erases the account
  when it passes.

  The next format carries the clock, the scheduler, the journal and the tables, and nothing else:
  the town's politics lands additively inside it, and the floors above the town wait for the
  format after. One thing at a time, and the only change that cannot wait is the one that breaks
  the shape of the world.

- **The schema is one file, and a schema change is a reset.** `db/schema.sql` is the whole
  schema, replayed on an empty database; there is no upgrade path to write, because no world of
  another format is read. A schema change edits that file, and the database crosses with
  `reset --full`, which deletes the towns, the accounts and the book of kings. The format number
  carries no history: it moved to three with the shared clock and settings, and the next schema
  change may pick another. `migrate` builds an empty database and nothing else; its gate reports
  the schema missing on a database that predates it, and the reset is the path a deployed
  database takes.

## Simulation

- **The core is pure, deterministic and clock-free.** The caller passes both the instant
  (`until`) and the random stream (`random`): the core never reads the wall clock or a global
  random source itself. One seed in, one world out: the town is built from the seed, and the
  first person is added when its player joins with the trade that player chose. Two towns from
  the same seed can therefore start in different chains, and a seed alone does not rebuild a
  playable town. A stored world carries the trade in its workshops. The seed is the world's
  identity, not a generator cursor: the world has no `rng`, and randomness comes from the caller.
  A test replays two hundred advances with the same stream and asserts the same state hash, and
  another fails if `Math.random` or `Date.now` is written inside `packages/core`. Everything else
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
  sale credits coin, never both. The stock has a capacity fixed by the person's workshops, and it
  does not spoil; what reduces it is theft.
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
  hostile act a person absorbs raises its shield, which fades with the hours, so the first blow is
  easy and the fifth is almost impossible. Spoilage would have been a clock; theft is a decision
  by someone, and it makes a full warehouse a target. Revisit if the shield makes a vendetta
  impossible.

- **Six goods, three chains.** Wool into cloth, grain into bread, wood into planks. Three trades —
  weaver, baker, carpenter — one chain each. A workshop is bound to a trade, and a person may hold
  several, even two of the same; there is no conversion. To change what the person makes, it builds
  a workshop of the other trade and destroys the old one, and it can never destroy its last: the
  trade of the last workshop is the person's livelihood. Building is the price of changing, which
  keeps the market's signal a decision and not a tap. The town eats bread, builds with planks and
  wears cloth, so each chain has a buyer. Europe 1400 had sixty-nine goods; six is what a phone
  screen and twenty people can carry. Revisit when a seventh good arrives with a new trade, or if
  the cost of changing proves to freeze every person in its opening trade.

- **The price is settled at the bells.** A half-day's net flow (sold minus bought) pushes the next
  price away from its reference, and the gap back closes a quarter at each bell, so a shock fades
  instead of becoming the new normal. The lag is on purpose: the price you see is the town you
  were, and what you do now moves the price you will sell at after the next bell. The town also
  has a standing demand per good, so a good nobody makes climbs and a good it takes nothing of
  sits on its reference. That demand is calibrated to the middle of the town's two states — the
  three AI people alone, and the same town with one player working the chain — so an unworked
  chain sits a little above its reference and a worked chain at it or below: the reference is the
  centre of the band, not a price a short-handed town rests on. There is no random drift: the
  price moves only by the town's flow and the pull home, so the same trades give the same price.
  The raw goods join the flow like the others: the wool, grain and wood the workshops buy push
  their prices up, and selling them pushes them down.

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
  sitting outside the bells. A dormant person keeps their seat but casts no vote, so a sitting counts
  only the seats that answer, and a boycott of six blocks it just the same. This is Europe 1400's
  model, with a parliament kept for the big things: the five seats without a lever become the
  swing vote. Revisit if the council never meets.

- **The court is a jury of five random people, voting in secret, and a judge who does not vote.**
  A complaint is filed at the clerk's office with evidence — a visible crime leaves a proof to its
  victim, a secret one leaves a proof only when it fails, and the provost's investigation finds
  the rest; five people drawn at random, excluding the parties, judge, and a dormant juror is
  replaced. The judge is the office that did
  not investigate — the provost judges what the clerk built, and the reverse — so no one defines
  a crime, gathers the proofs and sets the price. He does not vote: he fixes the sentence and
  breaks a tie. The law's severity sets the range, the evidence sets the starting point, and the
  judge moves it (minor five per cent and one day, medium ten and two, serious twenty and three).
  Three penalties: a fine (a tenth of the estate for a medium sentence), the loss
  of a title degree, and prison — two days for a medium sentence, and a political death rather
  than a pause, since the prisoner keeps his estate and his trade but cannot stand, vote, judge or
  buy a title, and his office is suspended until the next election. There is no exile. Evidence
  can be destroyed, hidden or fabricated; a forged proof is a crime, and **the clerk in office
  exposes it automatically** — while he sits and is awake, no forgery passes, so a forger must
  first bribe, defeat, or wait for a vacancy. A bribe is money and intrigue, for a few hours,
  against one category of acts; discovered, it is a crime for both. The jury is where the people without
  a seat hold power, and the secret ballot is the only vote one can buy without knowing whether
  the money worked. Revisit if juries are captured or trials are too slow.

- **Death is a window, retirement is a choice, and the heir inherits the estate one degree
  lower.**
  At fifty, retirement is offered; refusing opens a window in which death may come at any
  scrutiny, with a chance that rises to certainty around a hundred and ten. The roll happens at
  the midnight bell, whether the player is connected or not. The heir keeps the estate's money, workshops, stock and
  grudges, loses the seats, drops one degree, pays about fifteen per cent of the estate in duty and
  funerals, and starts at the bottom of the attributes the parent had raised. The choice is what keeps death from being a tax on time passing; the rise
  is what makes staying a gamble. Revisit if generations feel like a treadmill.

- **The AI plays politics.** At the start of each year an AI person without a seat tries a random
  vacant one, paying the campaign cost if it has the favour; a seated AI defends its seat and does
  not challenge another holder or climb until #55. It votes with the same roll and campaign bonus
  as a human. It also buys the input its workshops lack,
  as before, and sells its stock at the market price. The earlier rule — an AI buys and decides
  nothing else — was right for a town of four; at twenty it leaves the player alone in a crowd.
  It sells its whole stock every hour, at the market price: it takes the price, it does not
  time it, so the flow stays regular and the price readable. It buys its inputs every hour
  too, or its workshops would starve between two bells. Revisit when an AI must choose what to
  produce.

- **A refusal is an event, never a throw.** The server replays stored actions days later; one
  poisoned action must not be able to stop the town. An unknown person, an unaffordable purchase
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

- **The schema can be checked without being applied.** `migrate --check` exits non-zero while the
  image carries a schema `schema_migrations` does not have, and `applySchema` takes a Postgres
  advisory lock before touching anything, table included. That is the hook a deploy can use to
  hold back a new instance until the schema matches its image, and after a rewritten baseline it
  is the signal that the database must be reset.

- **Readiness asks the database; liveness does not.** `/readyz` runs one `SELECT 1` and fails
  while it cannot; `/healthz` touches nothing. Wired the other way, a database outage would
  restart every pod and turn one problem into two.

- **The towns are the database: tables, not a document.** One database holds several towns, and
  every town table carries its `town_id` — people, seats, workshops, stock, laws, engagements,
  campaigns and the market are a town itself. What belongs to no person and to no town lives in
  the world's `settings`, one text key/value row per variable: `hour`, `hour_started_at`,
  `format_version`, `ruleset_version` and `seed`. There is one world, one clock and several
  towns: every town shares that hour and its year, and the `hour` row is what the writer locks.
  The store parses the numbers and the instant from the text. The first town writes the settings
  from the world it is given; a later town reads them, so founding a town cannot reset the clock
  or the seed. `towns` keeps only `id`, `name` and `created_at`; `year` is derived from `hour`,
  and there is no per-town state row and no generator cursor.
  The simulation still reads and writes a town whole, but the storage keeps it in rows, so a screen
  can read the market alone and the book of kings is a query. Every autoincremented id is a global
  `bigserial` assigned by the database: the store inserts a row without its id, reads the id back
  and writes it into the in-memory world before the rows that reference it, so a person's key, a
  seat, a campaign, an action, a workshop and a site all agree after a save. A format change is a
  migration across those tables; a reset is a wipe of them. Deleting a town cascades its tables;
  the accounts, their mail and the book of kings outlive it. What a sealed season keeps is the
  book: the seal writes the crowned player, the family name, the instant and the time it took; the
  town itself is dropped, and only a full reset deletes the book.
  The accounts outlive a season's seal, which takes the person and keeps the account; an ordinary
  reset does the same, and the first visit after it asks for a trade. The account carries the
  family name and no town of its own: the person points back at it through `people.player_id`, and
  a mailbox is the account's. Revisit if the book must hold the families' columns, or if several
  towns in one database prove too rigid for tests.

- **The state hash the API returns is the projection, not the world.** The world hash covers the
  seed and the whole town; published, it would hand a client the world's identity and its state.
  Two reads with no time passing still agree, because they return the same projection.

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

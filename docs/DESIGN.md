# Design

Brigue is a game of municipal politics in a medieval town. You choose a trade, you arrive with
its workshop and no name, and the town has twelve seats. It is not a game about building an
empire: it is a game about being someone in a room where twelve people decide.

This file describes the town the game is meant to build. Where it and [DECISIONS.md](./DECISIONS.md)
differ, the decision wins; the code reaches the target one format at a time, and the floors above
the town are only sketched at the end.

## The three chapters

The structure decides everything else.

**I — The workshop.** You choose a trade and learn it. You buy its raw good, you work it, you
sell the finished good at the hall, and you discover that the price you see is the town you
were: what everyone sells this hour moves what you will get after the next bell. The goal is a workshop
that produces without you watching it, and a sense of when to sell. About an hour.

**II — The house.** You settle. A better residence, a title, a first file at the clerk's office.
The town hall is visible and locked: you are told the office needs a standing you do not have.
About two hours.

**III — The town.** You play. Twelve seats, lawsuits, rumours, heirs. This is the real
game and it never ends.

Two rules keep the chapters honest:

- Each chapter leaves traces in the next. The workshop of chapter I pays for the campaign of
  chapter III; the debts of chapter II follow you into the council.
- The economy stays useful but stops being new. It produces money and leverage; chapter III does
  not ask you to set prices, it asks you to choose whom to ruin.

## The town

One world holds several towns. A newcomer takes a free place in the least-filled town that has
one — a human house no player has taken, or a new human house while the town is below twenty
houses — the oldest breaking a tie, and a town is founded only when every town is full. A house a
player has taken stays theirs while it is silent, and a revoked token does not give it away. A
town is named when it is founded: a place name is drawn from a list; a name may come back, but
the id is assigned by the database and never does. A town whose humans have all gone is never
offered to a newcomer; it is on its way out.

Twenty houses at most, three of them AI at the opening. The town is founded when its first player
joins: three AI houses and the first player's house are created together, so no town waits empty
for someone. That house is offered a name, which its player may keep or replace at once, and may
buy again later. Its offices do not exist yet:
every seat is empty, and the pyramid fills from the bottom, one floor per election.

A human who arrives later chooses a trade and takes a free place with the same kit as the first
house — the workshop, eight units of its input and a purse — and no seat or career.
The three AI houses are the finished trades, one per trade. Wool, grain and wood are bought at
the market at the current price: no house produces them, so every chain is fed whatever the
town's trades. No AI is created or removed after the opening: the three are the composition.

A player who stops playing leaves a **dormant** house. It keeps its money, its seat and its
grudges, but nothing runs: the workshop is idle, the stock is still a target, and the holder
votes no more. The holder stays a candidate by default, so a challenger turns the next election
into a normal contest. After thirty days without a visit, the house is deleted and the token with
it — no return, no vacation mode — and, when no human house is left, the town goes too. A player
who wants to leave for good asks for the deletion: it is scheduled a week out, the player can do
nothing until then, and the token stays valid so that reconnecting offers to come back. When the
week is over the house and its queued actions go, and the town with its last human. The server
checks on its own rhythm; no visit is needed.

The cap is the point. Twenty houses for twelve seats is scarcity; twelve seats for twenty houses
is a queue.

The book of kings, kept at the clerk's office, lists the crowned: the player, the house, the
person, the instant and the time it took. It is the long game, and the only record that crosses a
reset.

## The council

Twelve seats in a pyramid: one mayor, two great offices, four small ones, five without a lever.

- **Maire** — the agenda, appeals, the sales and guild taxes, the watch's budget.
- **Prévôt** — investigates, seizes, holds the watch; defines theft, blows, threats, kidnapping.
- **Trésorier** — succession duty, income, usury, the chest.
- **Greffier** — the record: complaints received or refused, evidence kept, authenticity.
- **Crieur** — the voice: the ban published, insults, pamphlets, rumours.
- **Échevin du ban** — the prices of the town's goods; the rents.
- **Maître de la halle** — places, the cloth seal, weights and measures.
- **Five without a lever** — three jurats and two marguilliers. Salary, prestige, a vote on
  exceptional measures, and jury duty.

Every office is elected, all of them on the same day, every day. A person holds one office; to
climb, they give up the one they have. **The career is the gate**: to stand for a floor, the house
must have held an office of a lower floor, and one mandate is enough. The career belongs to the
house, not the person: the heir keeps it one floor lower. A mayor's son may stand for the great
offices, not the mayoralty.

A vacant seat blocks nothing. Its power is simply unavailable, as it was in Europe 1400: no
mayor, no agenda; no provost, no investigation. A young town has no mayor for its first four
elections, and that is the founding story.

## The laws

Two kinds.

**By domain, without a vote.** Each office fixes its own laws alone: the mayor sets the sales and
guild taxes; the provost defines which acts are crimes and places each at one of three degrees —
minor, medium, serious; the alderman fixes the prices of the town's goods, and the rents; the
treasurer sets the succession duty; the clerk decides which complaints are received; the crier
publishes and defines libel; the master of the hall sets the places and the seal.

**By vote, for exceptional measures**: a public work, a public loan, a recoinage, an amnesty, a
requisition, closing the gates, ennobling a house. Seven seats must be present; the majority is
of the votes cast, abstentions excluded, with at least four yes. The vote is public: the town
knows who voted for whom. The mayor convenes; four of the seven offices with a domain can force
a sitting.

**Absence.** A dormant house keeps its seat but casts no vote; a sitting counts only the seats
that answer, so a town that sleeps loses its quorum before it loses its houses. A deliberate
boycott of six seats blocks the sitting the same way.

Every measure is carried by a house, and its name stays on the law.

## The court

A complaint is filed at the clerk's office with evidence. A visible crime — blows, a threat, an
insult — leaves a proof to its victim; a secret one leaves a proof only when it fails; the
provost's investigation can find the rest. **Five houses drawn at random**,
excluding the parties, sit as a jury and vote in secret. **The judge is the office that did not
investigate** — the provost judges what the clerk built, and the other way round — so no one
defines a crime, gathers the proofs and sets the price. The judge does not vote; he fixes the
sentence and breaks a tie.

The sentence sits between a floor and a ceiling set by the law that defines the crime; the
evidence sets where in that range it starts, and the judge moves it. The degree fixes the scale:
minor is five per cent and one day, medium ten and two, serious twenty and three. Three penalties
exist: a fine, the loss of a degree of title, and prison. A medium sentence is two days and a
tenth of the estate. Prison is a political death, not a pause: the prisoner keeps his house and his trade, but
cannot stand, vote, judge or buy a title, and the office he held is suspended until the next
election. There is no exile.

Evidence is a thing one brings. It can be destroyed, hidden, or fabricated; a forged proof is a
crime, and **the clerk in office exposes it automatically** — while he sits and is awake, no
forgery passes. To forge, one must first neutralize him: a bribe, a defeat, or a vacancy. A bribe
is money and intrigue, for a few hours, against one category of acts; discovered, it is a crime
for both. A juror who is dormant when the vote comes is replaced by another draw; one does not
refuse to serve.

The jury is where the eight houses without a seat have power. It is also the only secret vote in
the game: one may bribe a juror, never know whether the money worked.

## The economy

A workshop produces into a warehouse; selling is an action, at the price the last bell settled.
Six goods, three
chains: wool into cloth, grain into bread, wood into planks. The town eats bread, builds with
planks and wears cloth. Holding a good for a better bell is a bet: the price is pushed by what the
town sold and bought since the last bell, pulled a quarter of the way back to its reference at
each bell, and jittered by chance. The raw goods are the exception: they are bought at the market, and their price drifts by
chance and pulls home, never from the town's flow. Dumping a large stock moves the price down for everyone, including the
dumper's neighbour. The AI houses sell their whole stock every hour at the market price: they
take the price, they do not time it, so the flow stays regular and the price readable. The
Marché marks the prices that have left their band around the reference, so the flow is visible,
not only described.

The warehouse's capacity is what the house's workshops hold: every workshop gives 100 units at
its first level, 200 at its second, 350 at its third, and more as it grows, so a second building
is a second store. There is no spoilage. What reduces a stock is theft: a secret coup resolved
two hours later, the thief's intrigue against the target's defence. A failure leaves a proof at the clerk's office; a success leaves no automatic proof,
though an investigation may still find one. A victim who
has been struck hard is harder to strike again for a while — the shield rises with each hostile
act and fades with the hours.

## The character

Three attributes, raised by use: **artisanat, parole, intrigue**. Returns diminish, and the
ceiling is set by the trade and the title. They belong to the person and die with them.

A workshop is bound to one trade — weaver, baker, carpenter — and a house may hold several,
even two of the same trade. There is no conversion: to change what the house makes, it builds
another workshop and destroys the old one, and it can never destroy its last. A workshop is
built at the first level; each further level takes longer, and it produces nothing while it
grows. A house pays an upkeep for every workshop that runs, one level's share an hour, and
nothing for a workshop under works.

The **residence** is one ladder: the title opens a level, money pays for it, and the level sets
the prestige cap, the defence of the stock and the number of workshops. The two purchases are
separate: the title is bought first, then the level it opened. A title is obtained at the next
noon or midnight, a workshop and a residence upgrade when their works are done.

**Favour** is the currency of elections. It is earned by service — a mandate held, a
jury served, a vote cast with the winner — and by visible acts: a gift to the treasury, a funded
work, a banquet. Crimes take it away.

Twelve titles: roturier, bourgeois, notable, patricien, écuyer, chevalier, baron, vicomte, comte,
marquis, duc, prince. Each gives prestige, opens a level of residence and a ceiling on a
workshop's level, and some offices. The title and the residence belong to the house; the title
**falls one degree at death**. Prestige as the screen shows it is the title's, plus the
residence's, plus what service earned — and only the service is capped by the residence.

A character enters at twenty. At fifty, retirement is offered. Refusing it opens a window in
which death may come at any scrutiny, with a chance that rises until it reaches certainty around a
hundred and ten. The median death is around sixty-two; one in two hundred reaches ninety; a
hundred is a legend. The roll happens at the midnight bell, whether or not the player is
connected.

The heir keeps the house — money, workshops, stock, grudges — keeps the career one floor lower,
loses the seats,
drops one title, one residence level and one level from every workshop, pays about fifteen per
cent of the estate in duty and funerals, and starts with
ten in each attribute plus a tenth of what the parent had gained. Retirement is clean and lets
the player choose the heir; death takes the choice away.

## The world model

A house is a place, a person holds an office, and every house has a controller:

```
House    = { id, name, controller, treasury, title, residence, prestige, favour, career, workshops, stock, grudges }
Workshop = { id, trade, level }
Person = { id, houseId, name, age, attributes, alive }
Seat   = { personId | null }
```

The simulation never asks who controls a house. Solo, multiplayer, and a dormant house are the
same code: the server assigns seats, and a dormant house keeps its history without being played.

## The clock

One real hour is one town hour. Twenty-four hours make a year, and a year is a day: the calendar
advances a year per day. A mandate lasts a day. A character's thirty playable years last thirty
real days.

Engagements have durations, not action points: a building site takes twelve hours, a campaign is
a candidacy lodged before the noon bell, and a hearing is held at the next noon sitting after the
complaint. A duration is counted in town time and the screen shows the hour it ends, so a player
plans with "ready at 19:00". What falls due is resolved by the next advance, even if the town has
already passed the instant, and the event carries both instants: late rather than dropped.

## Screens

- **Ville** — the home screen. The town scene, your house, the journal, the laws in force
  and who carried them, and the register of what falls due.
- **Dynastie** — buildings, residence, family, heirs, titles. The tab that opens it keeps the
  label Maison.
- **Marché** — prices against their reference, stock, buying and selling, and the queued actions
  with their cancel.
- **Conseil** — the twelve seats as a pyramid, the offices and their domains, the next sitting.
- **Greffe** — acts, complaints, evidence, the court.
- **Courrier** — letters received, rumours, invitations.

The interface is a chancery: flat sections, hairline rules, one strong action per screen, one accent
colour reserved for what is dangerous or decisive. The town illustration appears once, on **Ville**;
a map of places, drawn in seals, serves as navigation.

## The floors above the town (next format)

Not built. The town's council is the first floor; the two above it are written here so their
offices have names before they have code. Both are elected by every house, at the same midnight
scrutiny, with the same roll and the same campaign bonus; only the title required, the career
required and the price of a campaign change.

### The county

Headed by the count, who must bear the title of count and have held a town office. The four lesser
offices need a knight's title; the bailli and the receveur, a baron's.

- **Comte** — levies the company, decides whether the roads are guarded, presides the court of the
  county and breaks its ties.
- **Bailli** — instructs what crosses a town's border; admits or refuses an appeal.
- **Receveur** — holds the county's chest: the tolls in, the company's wages out, and an unpaid
  company disbands or turns to pillage.
- **Voyer** — sets the tolls between towns and the state of the roads.
- **Gruyer** — the forests, the cutting rights and the price of planks.
- **Grenetier** — the granary: releases grain in a famine, or withholds it.
- **Juge-mage** — judges a town; the fine is paid by its chest and its mayor answers.

### The kingdom

Headed by the king, who must bear the title of prince and have held a county office. The four
lesser offices need a marquis's title; the chancelier and the argentier, a duke's.

- **Roi** — crowned, he reigns one day.
- **Chancelier** — the seal; he may refuse to seal.
- **Argentier** — the coin and the royal chest.
- **Maréchal** — the royal company and the marshals' provosts on the roads.
- **Chambellan** — the door: nothing reaches the king without passing him.
- **Maître des comptes** — audits a county and may refuse its budget.
- **Juge souverain** — the last appeal; he judges the counts.

## Not decided yet

- The range each crime's law gives the judge.
- Whether twelve seats for twenty houses, with an election every day, keep the council contested.

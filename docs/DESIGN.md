# Design

Brigue is a game of municipal politics in a medieval town. You arrive with a loom and no name,
and the town has twelve seats. It is not a game about building an empire: it is a game about
being someone in a room where twelve people decide.

## The three chapters

The structure decides everything else.

**I — The workshop.** You learn. You buy wool, you weave, you sell at the hall, and you discover
that the price you see is the town you were: what everyone sells this week moves what you will
get next week. The goal is a workshop that produces without you watching it, and a sense of when
to sell. About an hour.

**II — The house.** You settle. A better residence, a title, a first file at the clerk's office.
The town hall is visible and locked: you are told the office needs a standing you do not have.
About two hours.

**III — The town.** You play. Twelve seats, factions, lawsuits, rumours, heirs. This is the real
game and it never ends.

Two rules keep the chapters honest:

- Each chapter leaves traces in the next. The workshop of chapter I pays for the campaign of
  chapter III; the debts of chapter II follow you into the council.
- The economy stays useful but stops being new. It produces money and leverage; chapter III does
  not ask you to set prices, it asks you to choose whom to ruin.

## The town

Twenty houses at most, ten of them held by the AI. A world opens with ten AI houses and its
founder: the town exists before the player, but its offices do not. Every seat is empty, and the
pyramid fills from the bottom, one floor per election.

A human who arrives in a full town takes the place of an AI house. The AI line ends; the newcomer
starts with nothing — no money, no seat, no career. No AI is created after the opening: the ten
founding families are a floor, not a pump, and a freed place waits for a human.

A player who stops playing leaves a **dormant** house. It keeps its money, its seat and its
grudges, but nothing runs: the workshop is idle, the stock is still a target, and the holder
votes no more. The holder stays a candidate by default, so a challenger turns the next election
into a normal contest. After thirty days without a visit, the house is deleted and the token with
it — no return, no vacation mode.

The cap is the point. Twenty houses for twelve seats is scarcity; twelve seats for twenty houses
is a queue.

## The council

Twelve seats in a pyramid: one mayor, two great offices, four small ones, five without a lever.

- **Maire** — the agenda, appeals, the sales and guild taxes, the watch's budget.
- **Prévôt** — investigates, seizes, holds the watch; defines theft, blows, threats, kidnapping.
- **Trésorier** — succession duty, income, usury, the chest.
- **Greffier** — the record: complaints received or refused, evidence kept, authenticity.
- **Crieur** — the voice: the ban published, insults, pamphlets, rumours.
- **Échevin du ban** — the price of grain, wool and cloth; rents.
- **Maître de la halle** — places, the cloth seal, weights and measures.
- **Five without a lever** — three jurats and two marguilliers. Salary, prestige, a vote on
  exceptional measures, and jury duty.

Every office is elected, all of them on the same day, every day. A person holds one office; to
climb, they give up the one they have. **The career is the gate**: to stand for a floor, a person
must have held an office of a lower floor. The career dies with the person; the heir starts at
the bottom.

A vacant seat blocks nothing. Its power is simply unavailable, as it was in Europe 1400: no
mayor, no agenda; no provost, no investigation. A young town has no mayor for its first four
elections, and that is the founding story.

## The laws

Two kinds.

**By domain, without a vote.** Each office fixes its own laws alone: the mayor sets the sales and
guild taxes; the provost defines which acts are crimes; the alderman fixes the price of grain,
wool and cloth, and the rents; the treasurer sets the succession duty; the clerk decides which
complaints are received;
the crier publishes and defines libel; the master of the hall sets the places and the seal.

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

A complaint is filed at the clerk's office with evidence. **Five houses drawn at random**,
excluding the parties, sit as a jury and vote in secret. **The judge is the office that did not
investigate** — the provost judges what the clerk built, and the other way round — so no one
defines a crime, gathers the proofs and sets the price. The judge does not vote; he fixes the
sentence and breaks a tie.

The sentence sits between a floor and a ceiling set by the law that defines the crime; the
evidence sets where in that range it starts, and the judge moves it. Three penalties exist: a
fine, the loss of a degree of title, and prison. A medium sentence is two days and a tenth of the
estate. Prison is a political death, not a pause: the prisoner keeps his house and his trade, but
cannot stand, vote, judge or buy a title, and the office he held is suspended until the next
election. There is no exile.

Evidence is a thing one brings. It can be destroyed, hidden, or fabricated; a forged proof is a
crime, and the clerk is the one who examines it. A false accusation that survives the clerk's
eye is the sharpest weapon in the town. A juror who is dormant when the vote comes is replaced by
another draw; one does not refuse to serve.

The jury is where the eight houses without a seat have power. It is also the only secret vote in
the game: one may bribe a juror, never know whether the money worked.

## The economy

A workshop produces into a warehouse; selling is an action, at the week's price. Holding cloth
for a better week is a bet: the price is pushed by what the town sold and bought the week
before, pulled a quarter of the way back to its reference, and jittered by chance. Dumping a
large stock moves the price down for everyone, including the dumper's neighbour. The AI houses
sell their whole stock every week at the market price: they take the price, they do not time it,
so the flow stays regular and the price readable.

Capacity is fixed by the workshop's level, and there is no spoilage. What reduces a stock is
theft: a secret coup resolved after two weeks, the thief's intrigue against the target's
defence. A failure leaves a proof at the clerk's office; a success leaves nothing. A victim who
has been struck hard is harder to strike again for a while — the shield rises with each hostile
act and fades with the weeks.

## The character

Three attributes, raised by use: **artisanat, parole, intrigue**. Returns diminish, and the
ceiling is set by the trade and the title. They belong to the person and die with them.

Twelve titles, bought at the town hall: roturier, bourgeois, notable, patricien, écuyer,
chevalier, baron, vicomte, comte, marquis, duc, prince. Each gives prestige and opens a level of
residence and some offices. The title belongs to the house, and **falls one degree at death**.

A character enters at twenty. At fifty, retirement is offered. Refusing it opens a window in
which death may come any week, with a chance that rises until it reaches certainty around a
hundred and ten. The median death is around sixty-two; one in two hundred reaches ninety; a
hundred is a legend. The roll happens in the tick, whether or not the player is connected.

The heir keeps the house — money, workshops, stock, grudges — loses the career and the seats,
drops one title, pays about fifteen per cent of the estate in duty and funerals, and starts with
ten in each attribute plus a tenth of what the parent had gained. Retirement is clean and lets
the player choose the heir; death takes the choice away.

## The world model

A house is a place, a person holds an office, and every house has a controller:

```
House  = { id, name, controller, treasury, title, prestige, favour, workshops, stock, grudges }
Person = { id, houseId, name, age, attributes, career, alive }
Seat   = { personId | null }
```

The simulation never asks who controls a house. Solo, multiplayer, and a dormant house are the
same code: the server assigns seats, and a dormant house keeps its history without being played.

## The week

One tick is one game week and one real hour. Twenty-four weeks make a year, and a year is a day:
the calendar advances a year per day. A mandate lasts a day. A character's thirty playable years
last a month.

Engagements have durations, not action points: a campaign runs eight weeks, a hearing is held
six weeks after the complaint, a building site takes twelve. They are counted in weeks, so they
survive a catch-up: the world replays whole weeks and resolves what falls due.

## Screens

- **Ville** — the home screen. The town scene, your house, the week's ledger, the laws in force
  and who carried them, and the register of what falls due.
- **Maison** — buildings, residence, family, heirs, titles.
- **Marché** — prices, stock, orders, contracts.
- **Conseil** — the twelve seats as a pyramid, the offices and their domains, the next sitting.
- **Greffe** — acts, complaints, evidence, the court.
- **Courrier** — letters received, rumours, invitations.

The interface is a chancery: flat sections, hairline rules, one strong action per screen, one
accent colour reserved for what is dangerous. The town illustration appears once, on **Ville**;
a map of places, drawn in seals, serves as navigation.

## Not decided yet

- How the clerk detects a forged proof.
- The range each crime's law gives the judge.
- Whether twelve seats for twenty houses, with an election every day, keep the council contested.

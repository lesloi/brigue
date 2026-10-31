# Design

Brigue is a game of municipal politics in a medieval town. You arrive with a loom and no name,
and the town has five seats. It is not a game about building an empire: it is a game about being
someone in a room where five people decide.

## The three chapters

The structure decides everything else.

**I — The workshop.** You learn. You buy wool, you weave, you sell at the hall, you discover
that the market reacts. The goal is a workshop that runs without you watching it. About an hour.

**II — The house.** You settle. A better residence, a title, a first file at the clerk's office.
The town hall is visible and locked: you are told the office needs a standing you do not have.
About two hours.

**III — The town.** You play. Five seats, factions, lawsuits, rumours, heirs. This is the real
game and it never ends.

Two rules keep the chapters honest:

- Each chapter leaves traces in the next. The workshop of chapter I pays for the campaign of
  chapter III; the debts of chapter II follow you into the council.
- The economy stays useful but stops being new. It produces money and leverage; chapter III does
  not ask you to set prices, it asks you to choose whom to ruin.

## What makes it a game

- **Seats are few and named.** Five for the whole town. An election won by someone is an election
  lost by everyone else.
- **A seat grants a right, not a bonus.** The mayor names to small offices and hears appeals; the
  provost opens an investigation or seizes goods; the aldermen set the ban on grain and wool; the
  treasurer levies the cloth tax. A privilege measured in percent cannot be told; a power can.
- **Grudges are remembered.** Every house keeps a register: who beat it, who helped it, who
  testified against it. An AI without memory is not an opponent, it is scenery.
- **Succession resets the board.** When a character dies, prestige passes on dented, and the
  enemies survive intact.

## The world model

A house is a place, and every place has a controller:

```
House = { id, name, controller: "ai" | "human", treasury, favour, prestige, workshops }
Seat  = { houseId | null }
```

The simulation never asks who controls a house. Solo, multiplayer, and a player who stops playing
are the same code: the server assigns seats, and a seat given back to an AI keeps its history.

## The week

One tick is one game week. A tick applies the queued actions in order, then the world moves: prices
drift, workshops produce and sell, wages are paid, and an election is held when the week calls for
one. The client never computes any of this; it renders the events of the week and sends action
intents.

## Screens

- **Ville** — the home screen. The town scene, your house, the week's ledger, the laws in force
  and who carried them.
- **Maison** — buildings, residence, family, heirs.
- **Marché** — prices, orders, contracts.
- **Conseil** — the five seats as an organisation tree, the agenda, the vote, the two camps, and
  what it would take to be an elector.
- **Greffe** — acts, complaints, lawsuits.
- **Courrier** — letters received, rumours, invitations.

The interface is a chancery: flat sections, hairline rules, one strong action per screen, one
accent colour reserved for what is dangerous. The town illustration appears once, on **Ville**.

## Not decided yet

- How a lawsuit actually runs, and what evidence costs.
- Whether rumours are a separate resource or only a flavour of favour.
- What the player does during a week between two ticks beyond queuing actions.

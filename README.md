<h1 align="center">Brigue</h1>

<h3 align="center">A slow game of municipal politics in a medieval town.</h3>

<p align="center">
  You choose a trade and arrive with its workshop, and no name. You leave with a seat, or you leave.
</p>

## What it is

- **Three chapters.** You learn a trade, you settle a dynasty, then the town opens: twelve council
  seats, an election every day, lawsuits, titles, heirs.
- **The council is the game.** Twelve seats in a pyramid. Each one grants a concrete right, not a
  bonus: the mayor sets the taxes and the agenda, the provost defines crimes and seizes goods, the
  alderman fixes the prices of the market. Five seats carry no lever at all — but they vote the
  exceptional measures, and they judge.
- **The law is split.** Each office fixes its own domain alone; the council votes only the big
  things: a work, a loan, a recoinage, an amnesty, a requisition, the gates, an ennoblement.
- **The court is a jury.** Five dynasties drawn at random, a secret vote, a judge who presides. A
  forged proof is a crime, and the clerk is the one who examines it.
- **The market bites back.** A workshop produces into a warehouse; selling is a decision; the
  price you see is the town you were; and a full store is a target.
- **Played on a phone**, in short visits, as an installable PWA.

## Status

Early, and in two layers.

- **The design** is in [docs/DESIGN.md](./docs/DESIGN.md) and [docs/DECISIONS.md](./docs/DECISIONS.md).
  It describes the target game: twelve seats, a person who holds an office, a dynasty that climbs,
  a stock, a court, titles, and a day-long mandate.
- **The code** implements the clock and the economy: one real hour is one town hour, twenty-four
  hours a year, and a scrutiny at the end of each year with every seat up; the town advances on a
  scheduler, and the two bells settle the prices. Five seats today, six goods in three chains, a
  warehouse with a cap, a sale made by an action, and a trade chosen at creation. The three
  finished trades are AI dynasties; the raw goods are bought at the market. The town lives in
  Postgres tables and its events in a journal. It is covered by tests, and it is the
  format that replaces the week-based one — it deletes the test towns and starts the version at
  one; no world is in production.

The server issues a token, advances the town on its own, serves the projection and the newest
journal page, and accepts actions for the hour being played or the next one.
The PWA has its shell, the creation screen, the Ville screen and the Marché screen, rendered with
Preact: it renders the projection and the journal, and sends market intents. The Marché buys and
sells, lists the queued actions with their cancel, and draws the year's price history; the Ville
shows the workshop's hourly figures and the journal. The other screens are still to come. One
image carries the API and the built client: one process, one port, one origin.

## Stack

- TypeScript everywhere, one language for the core, the server and the client.
- `packages/core`: pure, deterministic simulation. No I/O, no clock, no global random.
- pnpm workspace, vitest, prettier, eslint.

## Run it

```sh
pnpm install
pnpm test
pnpm check
pnpm build
```

The server needs Postgres:

```sh
export DATABASE_URL=postgres://localhost/brigue
pnpm --filter @brigue/server migrate
pnpm --filter @brigue/server dev
```

When a format change cannot migrate the old schema, the database is reset instead: `pnpm
--filter @brigue/server reset` drops the town and rebuilds the schema from the migrations,
carrying the book of kings and the accounts across. Run it with the application stopped: it
drops the schema under any writer. A carried account keeps its token and its player id and
loses its dynasty; the next visit asks for a trade and gives it one. It shows what it would
destroy and asks for `yes` on a terminal; `--force` skips the question, and without a terminal
it refuses rather than guess. `--check` shows the same and changes nothing. `--full` deletes
the book of kings and the accounts as well, and is the only reset that touches them. Its test
is destructive too and therefore runs alone, after the parallel suite:
`RESET_DATABASE_URL=$DATABASE_URL pnpm exec vitest run apps/server/test/reset-test.ts`.

The PWA runs beside it, and Vite proxies `/api` to `http://localhost:3000`:

```sh
pnpm --filter @brigue/web dev
```

On an Android phone, `adb reverse tcp:5173 tcp:5173` and open
`http://localhost:5173`: localhost is a secure context, so the service worker
and the install prompt work without a certificate. `pnpm build` produces the
installable files in `apps/web/dist`.

One image serves the API and the built client:

```sh
docker build -t brigue:dev .
```

It carries the built client at `WEB_ROOT`, and needs `DATABASE_URL` to start.

`pnpm test` runs the Postgres integration tests when `DATABASE_URL` is set, and
skips them otherwise.

`COOKIE_SECURE=false` is for local HTTP only; `TRUST_PROXY=true` only when the
server really sits behind the ingress, because it trusts `X-Forwarded-For` for
the login rate limit. Get that wrong either way: without it behind the ingress,
every player shares one bucket and the town gets rate limited; with it set
without an ingress, a client can pick its own bucket.

## Documents

- [AGENTS.md](./AGENTS.md): how the code is organised and how to work on it.
- [docs/DECISIONS.md](./docs/DECISIONS.md): the lasting choices and why.
- [docs/DESIGN.md](./docs/DESIGN.md): the game itself.
- [GLOSSARY.md](./GLOSSARY.md): the town's vocabulary.

## Licence

AGPL-3.0-or-later.

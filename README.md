<h1 align="center">Brigue</h1>

<h3 align="center">A slow game of municipal politics in a medieval town.</h3>

<p align="center">
  You arrive with a loom and no name. You leave with a seat, or you leave.
</p>

## What it is

- **Three chapters.** You learn a trade, you settle a house, then the town opens: twelve council
  seats, an election every day, lawsuits, titles, heirs.
- **The council is the game.** Twelve seats in a pyramid. Each one grants a concrete right, not a
  bonus: the mayor sets the taxes and the agenda, the provost defines crimes and seizes goods, the
  alderman fixes the prices of the market. Five seats carry no lever at all — but they vote the
  exceptional measures, and they judge.
- **The law is split.** Each office fixes its own domain alone; the council votes only the big
  things: a work, a loan, a recoinage, an amnesty, a requisition, the gates, an ennoblement.
- **The court is a jury.** Five houses drawn at random, a secret vote, a judge who presides. A
  forged proof is a crime, and the clerk is the one who examines it.
- **The market bites back.** A workshop produces into a warehouse; selling is a decision; the
  price you see is the town you were; and a full store is a target.
- **Played on a phone**, in short visits, as an installable PWA.

## Status

Early, and in two layers.

- **The design** is in [docs/DESIGN.md](./docs/DESIGN.md) and [docs/DECISIONS.md](./docs/DECISIONS.md).
  It describes the target game: twelve seats, a person who holds an office, a house that holds a
  career, a stock, a court, titles, and a day-long mandate.
- **The code** implements the calendar: one week per real hour, twenty-four weeks a year, and a
  scrutiny at the end of each year with every seat up. Five seats today, output sold on
  production. It is covered by tests, and it is the base the next ruleset replaces. The next
  `formatVersion` starts a new town; no world is in production.

The server issues a token, serves the world with catch-up, and accepts actions for the week being
played or the next one. The PWA has its shell and the Ville screen, rendered with Preact: it
renders the projection and the events of the last week, and sends a market intent. The other
screens are still to come. One image carries the API and the built client: one process, one port,
one origin.

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

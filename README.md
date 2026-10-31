<h1 align="center">Brigue</h1>

<h3 align="center">A slow game of municipal politics in a medieval town.</h3>

<p align="center">
  You arrive with a loom and no name. You leave with a seat, or you leave.
</p>

## What it is

- **Three chapters.** You learn a trade, you settle a house, then the town opens: five
  council seats, elections, lawsuits, rumours, heirs.
- **The council is the game.** Seats are few and named. Each one grants a concrete right, not
  a bonus: the mayor names to small offices, the provost seizes goods, the alderman sets the
  price of wool.
- **A week per tick.** The town moves slowly enough that a betrayal can be prepared, and fast
  enough that a week away does not ruin a game.
- **Played on a phone**, in short visits, as an installable PWA.

## Status

Early. The simulation core runs and is covered by tests. The server now binds a
token to a house; the rest of the API and the client are next. Nothing is
playable yet.

## Stack

- TypeScript everywhere, one language for the core, the server and the client.
- `packages/core`: pure, deterministic simulation. No I/O, no clock, no global random.
- pnpm workspace, vitest, prettier, eslint.

## Run it

```sh
pnpm install
pnpm test
pnpm check
```

The server needs Postgres:

```sh
export DATABASE_URL=postgres://localhost/brigue
pnpm --filter @brigue/server migrate
pnpm --filter @brigue/server dev
```

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

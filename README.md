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

Early. The simulation core runs and is covered by tests. The server issues a
token, serves the world with catch-up, and accepts one action per week. The PWA
has its shell and the Ville screen: it renders the projection and the events of
the last week, and sends a market intent. The other screens are still to come.
One image carries the API and the built client: one process, one port, one
origin.

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

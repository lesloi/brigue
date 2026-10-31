# Brigue

Brigue is a slow, tick-based game of municipal politics in a medieval town. You start as a
cloth weaver, you learn the market, then you climb into the council. The game is played
mostly on a phone, in short visits. Vocabulary: [GLOSSARY.md](./GLOSSARY.md).

## Architecture

- `packages/core`: the whole simulation. Pure TypeScript: no I/O, no wall clock, no global
  random. One seed in, one world out.
- `apps/server`: Node, holds the world in Postgres, serves the API, catches the
  world up when a player asks for it.
- `apps/web`: a Vite PWA, mobile first. It renders the projection and the events, and sends
  action intents; it decides nothing.
- TypeScript everywhere, one language for the core, the server and the client. pnpm workspace.

By default:

- `tick(world, actions)` returns a new world and the events of the week. It never mutates the
  world it is given, and the core never reads the clock or `Math.random`; a test guards both.
- Money is integer cents. There is no float in the simulation, and no amount is ever a string.
- The core never imports from `apps/*`. It is the one part that must stay replayable without a
  server, a database or a browser.
- A world carries `formatVersion` and `rulesetVersion`. A world of another version is refused,
  never guessed.
- Changes to the shape of the world are additive only: a new field with a default. Renaming a
  field or changing a unit is a breaking change and needs a migration, so we do not do it.
- A seat is held by a house whose controller is `ai` or `human`. The simulation never asks
  which: solo, multiplayer and a player who leaves are the same code.
- A refusal is an event, never a throw: the server replays stored actions weeks later, and one
  poisoned action must not be able to stop the town. Only a wrong world version throws.
- The game speaks French; the code, the commits and the docs speak English.

## Decisions

[DECISIONS.md](./docs/DECISIONS.md) holds the lasting choices and their reasons, by theme. Read
the section of the subject you touch. A decision can be questioned: if it no longer holds, say
so, propose an alternative with your arguments, and rewrite its entry once the owner agrees. Add
an entry only for a choice that is costly to reverse and whose reason the code does not show.

## Working

- `main` stays green: GitHub Actions runs `pnpm check`, `pnpm test` and `pnpm build` on every pull
  request and every push to `main`; the Postgres tests run in their own job against a service,
  and a third builds the image for every event and pushes it to GHCR from `main` only.
- After a change: `pnpm format`, then `pnpm check` (formatting, lint, types).
- Before committing: `pnpm test` and `pnpm build`, unless already run since the last change.
- Run `pnpm install` after a pull, merge or rebase that changes dependencies.
- Branches: `type/short-description` (`feature`, `bugfix`, `hotfix`, `release`, `chore`).
  Commits: Conventional Commits under 72 characters, without `Co-authored-by:`.
- Update the docs only when a rule, a convention or a command changes, not for a new feature.

## Issues

- GitHub Issues on `lesloi/brigue`. Labels: `core`, `api`, `web`, `infra`, `ci`,
  `documentation`.
- To change an issue, edit its description rather than adding a comment; keep comments for a
  discussion.

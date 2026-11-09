import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { NAME_PRICE, type Action, type World } from '@brigue/core';

import { createApp } from '../src/http/app.ts';
import { SESSION_COOKIE } from '../src/http/cookies.ts';
import { issueToken } from '../src/identity/session.ts';
import { MemoryPlayerStore } from '../src/identity/players.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryWorldStore } from '../src/town/worlds.ts';
import { CARON, LECLERC, TEST_TOWN, town } from './helpers.ts';

const START = new Date('2026-11-07T08:00:00.000Z').getTime();
const ACTION_IDS = [
  '00000000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-0000000000c2',
  '00000000-0000-4000-8000-0000000000c3',
  '00000000-0000-4000-8000-0000000000c4',
];

interface Harness {
  url: string;
  cookie: string;
  store: MemoryPlayerStore;
  worlds: MemoryWorldStore;
  read(): Promise<World>;
  close(): Promise<void>;
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

async function start(world: World = town(7)): Promise<Harness> {
  const store = new MemoryPlayerStore();
  const worlds = new MemoryWorldStore();
  const server = createApp({
    store,
    worlds,
    logger: createLogger(() => {}),
    ready: async () => {},
    now: () => START,
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const townInfo = await worlds.createTown(TEST_TOWN.name, world, new Date(START));
  const { token, player } = await issueToken(store, 'Leclerc', new Date(START));
  await store.rebind(player.tokenHash, townInfo.id, LECLERC, new Date(START));
  running.push(
    () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  );

  return {
    url: `http://127.0.0.1:${address.port}`,
    cookie: `${SESSION_COOKIE}=${token}`,
    store,
    worlds,
    read: () => worlds.withWorld(async (session) => session.snapshot.world, townInfo.id),
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

function post(harness: Harness, intent: unknown, hour = 1, index = 0): Promise<Response> {
  return fetch(`${harness.url}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: harness.cookie },
    body: JSON.stringify({ id: ACTION_IDS[index] ?? ACTION_IDS[0], hour, action: intent }),
  });
}

function rename(harness: Harness, name: unknown): Promise<Response> {
  return fetch(`${harness.url}/api/dynasty/name`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: harness.cookie },
    body: JSON.stringify({ name }),
  });
}

describe('the ladder on the action queue', () => {
  it('accepts a build, an upgrade and the two purchases as actions', async () => {
    // Arrange
    const harness = await start();

    // Act
    const build = await post(harness, { type: 'workshop.build', trade: 'baker' }, 1, 0);
    const upgrade = await post(harness, { type: 'workshop.upgrade', workshopId: 4 }, 1, 1);
    const title = await post(harness, { type: 'person.buy_title' }, 1, 2);
    const residence = await post(harness, { type: 'person.upgrade_residence' }, 1, 3);

    // Assert
    expect([build.status, upgrade.status, title.status, residence.status]).toEqual([201, 201, 201, 201]);
    const body = (await build.json()) as { id: string; hour: number; personId: number };
    expect(body).toMatchObject({ hour: 1, personId: LECLERC });
  });

  it('refuses a build of a trade nobody practises', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await post(harness, { type: 'workshop.build', trade: 'miller' });

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_action' });
  });

  it('refuses the queued rename: the name is an identity, not a trade', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await post(harness, { type: 'dynasty.rename', name: 'Moreau' });

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('the family name', () => {
  it('renames the family at once, and its living person with it', async () => {
    // Arrange: a purse that pays the rename.
    const world = town(7);
    world.people[LECLERC]!.treasuryCents = 100_000;
    const harness = await start(world);

    // Act
    const response = await rename(harness, '  Moreau  ');

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Moreau' });
    const after = await harness.read();
    expect(after.people[LECLERC]?.name).toBe('Colin Moreau');
    expect(after.people[LECLERC]?.treasuryCents).toBe(100_000 - NAME_PRICE.renameCents);
    expect((await harness.store.listByTown(TEST_TOWN.id))[0]?.name).toBe('Moreau');
  });

  it('keeps a rename out of the journal: a name is identity, not a town affair', async () => {
    // Arrange
    const world = town(7);
    world.people[LECLERC]!.treasuryCents = 100_000;
    const harness = await start(world);

    // Act
    await rename(harness, 'Moreau');
    const response = await fetch(`${harness.url}/api/world`, { headers: { Cookie: harness.cookie } });

    // Assert: no chronicle line, no message; the Maison screen carries the name.
    const body = (await response.json()) as {
      messages: Array<{ type: string }>;
      chronicle: Array<{ type: string }>;
    };
    expect(body.messages).toEqual([]);
    expect(body.chronicle).toEqual([]);
  });

  it('refuses a name another account carries, whatever its case', async () => {
    // Arrange
    const world = town(7);
    world.people[LECLERC]!.treasuryCents = 100_000;
    const harness = await start(world);

    // Act
    const response = await rename(harness, 'CARON');

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'name_taken' });
    expect((await harness.read()).people[LECLERC]?.name).toBe('Colin Leclerc');
  });

  it('refuses a name that is not one, and a person that cannot pay', async () => {
    // Arrange
    const world = town(7);
    world.people[LECLERC]!.treasuryCents = 10;
    const harness = await start(world);

    // Act
    const numbers = await rename(harness, 42);
    const empty = await rename(harness, '   ');
    const poor = await rename(harness, 'Moreau');

    // Assert
    expect(numbers.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(poor.status).toBe(409);
    expect(await poor.json()).toEqual({ error: 'insufficient_funds' });
    expect((await harness.read()).people[LECLERC]?.name).toBe('Colin Leclerc');
  });
});

describe('the action view of the ladder', () => {
  it('names the degree a queued title buys', async () => {
    // Arrange: a person that can pay for its next degree.
    const world = town(7);
    world.people[LECLERC]!.treasuryCents = 1_000_000;
    const harness = await start(world);

    // Act
    await post(harness, { type: 'person.buy_title' });
    const response = await fetch(`${harness.url}/api/actions`, { headers: { Cookie: harness.cookie } });

    // Assert
    const body = (await response.json()) as { actions: Array<Record<string, unknown>> };
    expect(body.actions).toContainEqual(expect.objectContaining({ type: 'person.buy_title', title: 'bourgeois' }));
  });

  it('lists a build with its trade, and a purchase with no field', async () => {
    // Arrange
    const harness = await start();
    await post(harness, { type: 'workshop.build', trade: 'baker' });

    // Act
    const response = await fetch(`${harness.url}/api/actions`, { headers: { Cookie: harness.cookie } });

    // Assert
    const body = (await response.json()) as { actions: Array<Record<string, unknown>> };
    expect(body.actions).toContainEqual(expect.objectContaining({ type: 'workshop.build', trade: 'baker' }));
  });

  it('keeps the person from the session, never from the body', async () => {
    // Arrange
    const harness = await start();
    const intent: Action & { personId?: number } = {
      type: 'workshop.build',
      personId: CARON,
      trade: 'weaver',
    };

    // Act
    await post(harness, intent);
    const response = await fetch(`${harness.url}/api/actions`, { headers: { Cookie: harness.cookie } });

    // Assert
    const body = (await response.json()) as { actions: Array<{ id: string }> };
    expect(body.actions).toHaveLength(1);
  });
});

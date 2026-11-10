import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorld, NAME_PRICE, nameKey, RULES, type World } from '@brigue/core';

import { createApp } from '../src/http/app.ts';
import { SESSION_COOKIE } from '../src/http/cookies.ts';
import { issueToken } from '../src/identity/session.ts';
import { MemoryPlayerStore } from '../src/identity/players.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryWorldStore } from '../src/town/worlds.ts';
import { FOURNIER, LECLERC, TEST_TOWN, town } from './helpers.ts';

const START = new Date('2026-11-07T08:00:00.000Z').getTime();

interface Harness {
  url: string;
  store: MemoryPlayerStore;
  worlds: MemoryWorldStore;
  join(body: Record<string, unknown>): Promise<Response>;
  cookie(token: string): string;
  close(): Promise<void>;
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

async function start(world?: World): Promise<Harness> {
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
  running.push(
    () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  );

  const url = `http://127.0.0.1:${address.port}`;

  if (world !== undefined) {
    await worlds.createTown(TEST_TOWN.name, world, new Date(START));
  }

  return {
    url,
    store,
    worlds,
    join: (body) =>
      fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    cookie: (token) => `${SESSION_COOKIE}=${token}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A town at the cap, so the next join founds another one. */
function fullTown(seed = 7): World {
  const world = town(seed);
  const template = world.people[FOURNIER]!;
  for (let id = 1; id <= 20; id += 1) {
    if (world.people[id] !== undefined) {
      continue;
    }
    world.people[id] = {
      ...structuredClone(template),
      id,
      ia: true,
      name: `IA ${id}`,
      workshops: [{ id, trade: 'baker', level: 1 }],
      stock: {},
    };
  }

  return world;
}

async function worldOf(harness: Harness, townId: number): Promise<World> {
  return harness.worlds.withWorld(async (session) => session.snapshot.world, townId);
}

describe('the candidate a creation prefills', () => {
  it('suggests a free name and an opaque id, without founding anything', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await fetch(`${harness.url}/api/dynasty/name`);

    // Assert: a name and an id nothing carries, and no town was made.
    const body = (await response.json()) as { id: string; familyName: string; personName: string };
    expect(response.status).toBe(200);
    expect(body.familyName).not.toBe('');
    expect(body.id).toMatch(/^person-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body.personName.endsWith(body.familyName)).toBe(true);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await harness.worlds.listTowns()).toEqual([]);
  });

  it('keeps the name the player kept, and the person id comes from the town', async () => {
    // Arrange: the screen asks with a name of its own.
    const harness = await start();
    const id = 'person-0b7c2f0e-2a51-4b4f-9a0e-3b8f0f5f5c11';

    // Act: the name travels with the candidate, the way the screen sends it.
    const response = await harness.join({ trade: 'weaver', candidate: { id }, name: '  Moreau ' });
    const joined = (await response.json()) as { townId: number; personId: number };

    // Assert
    expect(response.status).toBe(201);
    const world = await worldOf(harness, joined.townId);
    expect(world.people[joined.personId]?.ia).toBe(false);
    expect(world.people[joined.personId]?.name).toMatch(/ Moreau$/);
    expect((await harness.store.listByTown(joined.townId))[0]?.name).toBe('Moreau');
  });

  it('founds the family under the name the player kept, with an id that is not its name', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await harness.join({ trade: 'weaver', name: 'Moreau' });
    const joined = (await response.json()) as { token: string; townId: number; personId: number };

    // Assert
    expect(response.status).toBe(201);
    const person = (await worldOf(harness, joined.townId)).people[joined.personId];
    expect(person?.name).toMatch(/ Moreau$/);
    expect(person?.ia).toBe(false);
    expect(nameKey(String(person?.id))).not.toContain('moreau');
    expect((await harness.store.listByTown(joined.townId))[0]?.name).toBe('Moreau');
  });

  it('gives a newcomer the same town, and the name it kept', async () => {
    // Arrange
    const harness = await start();
    const first = (await (await harness.join({ trade: 'weaver', name: 'Moreau' })).json()) as { townId: number };

    // Act
    const response = await harness.join({ trade: 'baker', name: 'Olivier' });
    const second = (await response.json()) as { townId: number; personId: number };

    // Assert
    const world = await worldOf(harness, first.townId);
    expect(second.townId).toBe(first.townId);
    expect(world.people[second.personId]?.name).toMatch(/ Olivier$/);
    expect(world.people[second.personId]?.ia).toBe(false);
  });

  it('applies the name kept to the place that waits for a human, for nothing', async () => {
    // Arrange: a town built without its first person, so a free place waits.
    const harness = await start(createWorld());

    // Act
    const response = await harness.join({ trade: 'weaver', name: 'Moreau' });
    const joined = (await response.json()) as { townId: number; personId: number };

    // Assert: the waiting town or a fresh one, the trade, the name kept and no price.
    const world = await worldOf(harness, joined.townId);
    expect(response.status).toBe(201);
    expect(world.people[joined.personId]?.name).toMatch(/ Moreau$/);
    expect(world.people[joined.personId]?.treasuryCents).toBe(RULES.startingPurseCents);
  });
});

describe('the name a creation keeps', () => {
  it('refuses a name a person of the town is known by, whatever its case', async () => {
    // Arrange: a town whose AI family is Caron.
    const harness = await start(town(7));

    // Act
    const upper = await harness.join({ trade: 'weaver', name: 'CARON' });
    const mixed = await harness.join({ trade: 'weaver', name: 'cArOn' });

    // Assert: nothing was founded for either, and the place still waits.
    expect(upper.status).toBe(409);
    expect(mixed.status).toBe(409);
    expect(await mixed.json()).toEqual({ error: 'name_taken' });
    const world = await worldOf(harness, 1);
    expect(world.people[LECLERC]?.name).toBe('Colin Leclerc');
  });

  it('refuses a name an account of another town carries, whatever its case', async () => {
    // Arrange: a settled full town, and a second, emptier one, so the next join
    // lands in the second.
    const harness = await start(fullTown());
    await harness.worlds.createTown(TEST_TOWN.name, town(9), new Date(START));
    const joined = (await (await harness.join({ trade: 'weaver', name: 'Moreau' })).json()) as { townId: number };
    expect(joined.townId).toBe(2);

    // Act
    const elsewhere = await harness.join({ trade: 'baker', name: ' MOREau ' });

    // Assert: two towns, and no third one founded for a taken name.
    expect(elsewhere.status).toBe(409);
    expect(await elsewhere.json()).toEqual({ error: 'name_taken' });
    expect(await harness.worlds.listTowns()).toHaveLength(2);
  });

  it('refuses an AI name even where no AI person carries it', async () => {
    // Arrange: a town where the AI family names are not the suggestion's.
    const harness = await start();
    await harness.join({ trade: 'weaver', name: 'Moreau' });

    // Act: Caron is the opening composition's name, in every town.
    const response = await harness.join({ trade: 'baker', name: 'caron' });

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'name_taken' });
  });

  it('refuses a name of accented letters, the tongue of the code being plain', async () => {
    // Arrange
    const harness = await start();

    // Act
    const accented = await harness.join({ trade: 'weaver', name: 'Hébert' });
    const spaced = await harness.join({ trade: 'weaver', name: 'Le Noir' });
    const empty = await harness.join({ trade: 'weaver', name: '   ' });

    // Assert: a name is letters and digits; an empty one keeps the suggestion.
    expect([accented.status, spaced.status]).toEqual([400, 400]);
    expect(empty.status).toBe(201);
    const drawn = (await empty.json()) as { townId: number; personId: number };
    expect((await worldOf(harness, drawn.townId)).people[drawn.personId]?.name).not.toBe('');
  });

  it('refuses a poisoned or an over-long name, and founds nothing', async () => {
    // Arrange
    const harness = await start();

    // Act
    const poisoned = await harness.join({ trade: 'weaver', name: 'Caron; DROP' });
    const long = await harness.join({ trade: 'weaver', name: 'A'.repeat(40) });
    const number = await harness.join({ trade: 'weaver', name: 42 });

    // Assert: no town was founded for any of them.
    expect([poisoned.status, long.status, number.status]).toEqual([400, 400, 400]);
    expect(await poisoned.json()).toEqual({ error: 'invalid_name' });
    expect(await harness.worlds.listTowns()).toEqual([]);
  });

  it('draws a name when it is missing: a client from before the field', async () => {
    // Arrange
    const harness = await start();
    const prompt = new Set(['Caron', 'Fournier', 'Charpentier']);

    // Act
    const without = await harness.join({ trade: 'weaver' });

    // Assert: the old client still joins, under a name the server drew.
    expect(without.status).toBe(201);
    const drawn = (await without.json()) as { townId: number; personId: number };
    const world = await worldOf(harness, drawn.townId);
    const family = world.people[drawn.personId]?.name.split(' ').at(-1) ?? '';
    expect(family).not.toBe('');
    expect(prompt.has(family)).toBe(false);
  });
});

describe('the rename route', () => {
  async function seated(): Promise<{ harness: Harness; token: string }> {
    const harness = await start(town(7));
    const { token, player } = await issueToken(harness.store, 'Leclerc', new Date(START));
    await harness.store.rebind(player.tokenHash, TEST_TOWN.id, LECLERC, new Date(START));
    const world = await worldOf(harness, TEST_TOWN.id);
    world.people[LECLERC]!.treasuryCents = 100_000;
    await harness.worlds.withWorld((session) => session.write(world, []), TEST_TOWN.id);

    return { harness, token };
  }

  const put = (harness: Harness, token: string, name: unknown) =>
    fetch(`${harness.url}/api/dynasty/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: harness.cookie(token) },
      body: JSON.stringify({ name }),
    });

  it('renames at once, keeps the id and charges the price', async () => {
    // Arrange
    const { harness, token } = await seated();

    // Act
    const response = await put(harness, token, ' Moreau ');

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Moreau' });
    const after = await worldOf(harness, TEST_TOWN.id);
    expect(after.people[LECLERC]?.treasuryCents).toBe(100_000 - NAME_PRICE.renameCents);
    expect(after.people[LECLERC]?.name).toBe('Colin Moreau');
    expect((await harness.store.listByTown(TEST_TOWN.id))[0]?.name).toBe('Moreau');
  });

  it('refuses a rename from a person the silence has already deleted', async () => {
    // Arrange: a live token whose last visit is past the deletion threshold, so
    // the next read removes the person. The rename must not slip in first.
    const harness = await start(town(7));
    const month = 31 * 24 * 60 * 60 * 1000;
    const { token, player } = await issueToken(harness.store, 'Leclerc', new Date(START - month));
    await harness.store.rebind(player.tokenHash, TEST_TOWN.id, LECLERC, new Date(START - month));

    // Act
    const response = await put(harness, token, 'Moreau');

    // Assert
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'unknown_person' });
  });

  it('refuses a name taken in the town or by an account elsewhere, whatever its case', async () => {
    // Arrange: another account whose family is Moreau.
    const { harness, token } = await seated();
    await issueToken(harness.store, 'Moreau', new Date(START));

    // Act
    const inTown = await put(harness, token, 'cAron');
    const away = await put(harness, token, 'MOREau');

    // Assert: one answer for one rule, and the person unchanged.
    expect(inTown.status).toBe(409);
    expect(away.status).toBe(409);
    expect(await away.json()).toEqual({ error: 'name_taken' });
    expect((await worldOf(harness, TEST_TOWN.id)).people[LECLERC]?.name).toBe('Colin Leclerc');
  });

  it('refuses an empty, a poisoned or an over-long name', async () => {
    // Arrange
    const { harness, token } = await seated();

    // Act
    const empty = await put(harness, token, '   ');
    const poisoned = await put(harness, token, 'Moreau\u202E;');
    const long = await put(harness, token, 'A'.repeat(40));
    const number = await put(harness, token, 42);

    // Assert
    expect([empty.status, poisoned.status, long.status, number.status]).toEqual([400, 400, 400, 400]);
    expect((await worldOf(harness, TEST_TOWN.id)).people[LECLERC]?.name).toBe('Colin Leclerc');
  });

  it('gives the Maison screen a free name with its price', async () => {
    // Arrange
    const { harness, token } = await seated();

    // Act
    const response = await fetch(`${harness.url}/api/dynasty/name`, { headers: { Cookie: harness.cookie(token) } });

    // Assert
    const body = (await response.json()) as { id: string; familyName: string };
    expect(response.status).toBe(200);
    expect(body.familyName).not.toBe('');
    expect(body.id).toMatch(/^person-/);
  });
});

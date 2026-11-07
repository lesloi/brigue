import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorld, NAME_PRICE, nameKey, RULES, type House, type World } from '@brigue/core';

import { createApp } from '../src/http/app.ts';
import { SESSION_COOKIE } from '../src/http/cookies.ts';
import { issueToken } from '../src/identity/session.ts';
import { MemoryPlayerStore } from '../src/identity/players.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryWorldStore } from '../src/town/worlds.ts';
import { TEST_TOWN, town } from './helpers.ts';

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

/** A town with no free place: the human house no account may take is replaced. */
function fullTown(seed = 7): World {
  const world = town(seed);
  world.houses.leclerc!.name = 'Divers';
  for (let index = 0; index < 20 - Object.keys(world.houses).length; index += 1) {
    world.houses[`human-${index}`] = {
      ...(world.houses.leclerc as House),
      id: `human-${index}`,
      name: `Divers ${index}`,
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
    const response = await fetch(`${harness.url}/api/house/name`);

    // Assert: a name and an id nothing carries, and no town was made.
    const body = (await response.json()) as { id: string; houseName: string; personName: string };
    expect(response.status).toBe(200);
    expect(body.houseName).not.toBe('');
    expect(body.id).toMatch(/^house-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body.personName.endsWith(body.houseName)).toBe(true);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await harness.worlds.listTowns()).toEqual([]);
  });

  it('keeps the id of the candidate the screen sent, and the name the player kept', async () => {
    // Arrange: the screen asks with a name of its own.
    const harness = await start();
    const id = 'house-0b7c2f0e-2a51-4b4f-9a0e-3b8f0f5f5c11';

    // Act: the name travels with the candidate, the way the screen sends it.
    const response = await harness.join({ trade: 'weaver', candidate: { id }, name: '  Moreau ' });
    const joined = (await response.json()) as { townId: number; houseId: string };

    // Assert
    expect(response.status).toBe(201);
    expect(joined.houseId).toBe(id);
    const world = await worldOf(harness, joined.townId);
    expect(world.houses[id]?.name).toBe('Moreau');
    expect(Object.values(world.people).find((person) => person.houseId === id)?.name).toMatch(/ Moreau$/);
  });

  it('founds the house under the name the player kept, with an id that is not its name', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await harness.join({ trade: 'weaver', name: 'Moreau' });
    const joined = (await response.json()) as { token: string; townId: number; houseId: string };

    // Assert
    expect(response.status).toBe(201);
    const house = (await worldOf(harness, joined.townId)).houses[joined.houseId];
    expect(house?.name).toBe('Moreau');
    expect(house?.controller).toBe('human');
    expect(nameKey(house?.id ?? '')).not.toContain('moreau');
  });

  it('gives a newcomer the same town, and the name it kept', async () => {
    // Arrange
    const harness = await start();
    const first = (await (await harness.join({ trade: 'weaver', name: 'Moreau' })).json()) as { townId: number };

    // Act
    const response = await harness.join({ trade: 'baker', name: 'Olivier' });
    const second = (await response.json()) as { townId: number; houseId: string };

    // Assert
    const world = await worldOf(harness, first.townId);
    expect(second.townId).toBe(first.townId);
    expect(world.houses[second.houseId]?.name).toBe('Olivier');
    expect(world.houses[second.houseId]?.controller).toBe('human');
  });

  it('applies the name kept to the place that waits for a human, for nothing', async () => {
    // Arrange: a town built without its first house, so a free place waits.
    const harness = await start(createWorld(7));

    // Act
    const response = await harness.join({ trade: 'weaver', name: 'Moreau' });
    const joined = (await response.json()) as { townId: number; houseId: string };

    // Assert: the waiting house, its trade, the name kept and no price.
    const world = await worldOf(harness, joined.townId);
    expect(response.status).toBe(201);
    expect(world.houses[joined.houseId]?.name).toBe('Moreau');
    expect(world.houses[joined.houseId]?.treasuryCents).toBe(RULES.startingPurseCents);
    expect(Object.values(world.people).find((person) => person.houseId === joined.houseId)?.name).toMatch(/ Moreau$/);
  });
});

describe('the name a creation keeps', () => {
  it('refuses a name a house of the town carries, whatever its case', async () => {
    // Arrange: a town whose AI house is Caron.
    const harness = await start(town(7));

    // Act
    const upper = await harness.join({ trade: 'weaver', name: 'CARON' });
    const mixed = await harness.join({ trade: 'weaver', name: 'cArOn' });

    // Assert: nothing was founded for either, and the place still waits.
    expect(upper.status).toBe(409);
    expect(mixed.status).toBe(409);
    expect(await mixed.json()).toEqual({ error: 'name_taken' });
    const world = await worldOf(harness, 1);
    expect(world.houses.leclerc?.name).toBe('Leclerc');
  });

  it('refuses a name a human house of another town carries, whatever its case', async () => {
    // Arrange: a settled town with a human Moreau, and a full town, so the
    // next join founds a town of its own.
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

  it('refuses an AI name even where no AI house carries it', async () => {
    // Arrange: a town whose three AI houses were renamed, so only the rule is left.
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
    expect((await worldOf(harness, 1)).houses.leclerc?.name).not.toBe('');
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
    const drawn = (await without.json()) as { townId: number; houseId: string };
    const world = await worldOf(harness, drawn.townId);
    expect(world.houses[drawn.houseId]?.name).not.toBe('');
    expect(prompt.has(world.houses[drawn.houseId]?.name ?? '')).toBe(false);
  });
});

describe('the rename route', () => {
  async function seated(): Promise<{ harness: Harness; token: string }> {
    const harness = await start(town(7));
    const { token } = await issueToken(harness.store, TEST_TOWN.id, 'leclerc', new Date(START));
    const world = await worldOf(harness, TEST_TOWN.id);
    world.houses.leclerc!.treasuryCents = 100_000;
    await harness.worlds.withWorld((session) => session.save(world, session.snapshot.hourStartedAt, []), TEST_TOWN.id);

    return { harness, token };
  }

  const put = (harness: Harness, token: string, name: unknown) =>
    fetch(`${harness.url}/api/house/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: harness.cookie(token) },
      body: JSON.stringify({ name }),
    });

  it('renames at once, keeps the id, charges the price and writes the journal', async () => {
    // Arrange
    const { harness, token } = await seated();

    // Act
    const response = await put(harness, token, ' Moreau ');

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Moreau' });
    const after = await worldOf(harness, TEST_TOWN.id);
    expect(after.houses.leclerc?.id).toBe('leclerc');
    expect(after.houses.leclerc?.name).toBe('Moreau');
    expect(after.houses.leclerc?.treasuryCents).toBe(100_000 - NAME_PRICE.renameCents);
    expect(after.people['person-leclerc']?.name).toBe('Colin Moreau');

    const journal = await fetch(`${harness.url}/api/world`, { headers: { Cookie: harness.cookie(token) } });
    const body = (await journal.json()) as { events: Array<{ type: string; after?: string }> };
    expect(body.events).toContainEqual(expect.objectContaining({ type: 'house.renamed', after: 'Moreau' }));
  });

  it('refuses a name taken in the town or by a human house elsewhere, whatever its case', async () => {
    // Arrange: another town whose human house is Moreau.
    const { harness, token } = await seated();
    const elsewhere = town(9);
    elsewhere.houses.leclerc!.name = 'Moreau';
    await harness.worlds.createTown('Arras', elsewhere, new Date(START));

    // Act
    const inTown = await put(harness, token, 'cAron');
    const away = await put(harness, token, 'MOREau');

    // Assert: one answer for one rule, and the house unchanged.
    expect(inTown.status).toBe(409);
    expect(away.status).toBe(409);
    expect(await away.json()).toEqual({ error: 'name_taken' });
    expect((await worldOf(harness, TEST_TOWN.id)).houses.leclerc?.name).toBe('Leclerc');
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
    expect((await worldOf(harness, TEST_TOWN.id)).houses.leclerc?.name).toBe('Leclerc');
  });

  it('gives the Maison screen a free name with its price', async () => {
    // Arrange
    const { harness, token } = await seated();

    // Act
    const response = await fetch(`${harness.url}/api/house/name`, { headers: { Cookie: harness.cookie(token) } });

    // Assert
    const body = (await response.json()) as { id: string; houseName: string };
    expect(response.status).toBe(200);
    expect(body.houseName).not.toBe('');
    expect(body.id).toMatch(/^house-/);
  });
});

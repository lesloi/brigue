import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorld, PACING, type World } from '@brigue/core';

import { SESSION_COOKIE } from '../src/cookies.ts';
import { createApp } from '../src/http.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryPlayerStore, type Player } from '../src/players.ts';
import { applyPresence } from '../src/presence.ts';
import { authenticate, issueToken } from '../src/session.ts';
import { MemoryWorldStore, WORLD_ID } from '../src/worlds.ts';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const START = Date.parse('2026-11-05T12:00:00.000Z');

function player(houseId: string, lastSeenAt: Date, revokedAt: Date | null = null): Player {
  return {
    tokenHash: houseId.padEnd(64, '0'),
    worldId: WORLD_ID,
    houseId,
    createdAt: lastSeenAt,
    lastSeenAt,
    revokedAt,
  };
}

function aHumanWorld(): World {
  const world = createWorld(20261105);
  world.houses.caron.controller = 'human';

  return world;
}

describe('dormancy', () => {
  it('marks a silent house dormant and keeps its money and its seat', () => {
    // Arrange
    const world = aHumanWorld();
    world.seats.maire = { personId: 'person-caron' };
    const treasuryCents = world.houses.caron.treasuryCents;
    const seen = new Date(START - (PACING.dormancyDays * DAY + HOUR));

    // Act
    const presence = applyPresence(world, [player('caron', seen)], START);

    // Assert
    expect(presence.world.houses.caron.dormant).toBe(true);
    expect(presence.world.houses.caron.treasuryCents).toBe(treasuryCents);
    expect(presence.world.seats.maire.personId).toBe('person-caron');
  });

  it('deletes a house silent for more than thirty days with its people and its seat', () => {
    // Arrange
    const world = aHumanWorld();
    world.seats.maire = { personId: 'person-caron' };
    world.campaigns.maire = { caron: 2 };
    const seen = new Date(START - (PACING.deletionDays * DAY + HOUR));

    // Act
    const presence = applyPresence(world, [player('caron', seen)], START);

    // Assert
    expect(presence.deletedHouseIds).toEqual(['caron']);
    expect(presence.world.houses.caron).toBeUndefined();
    expect(presence.world.people['person-caron']).toBeUndefined();
    expect(presence.world.seats.maire.personId).toBeNull();
    expect(presence.world.campaigns.maire).toEqual({});
  });

  it('still reads a house at exactly the thirty-day boundary', () => {
    // Arrange: the existing month-long catch-up lands exactly here.
    const world = aHumanWorld();
    const seen = new Date(START - PACING.deletionDays * DAY);

    // Act
    const presence = applyPresence(world, [player('caron', seen)], START);

    // Assert
    expect(presence.deletedHouseIds).toEqual([]);
    expect(presence.world.houses.caron.dormant).toBe(true);
  });

  it('goes dormant exactly at the dormancy boundary', () => {
    // Arrange
    const world = aHumanWorld();
    const seen = new Date(START - PACING.dormancyDays * DAY);

    // Act
    const presence = applyPresence(world, [player('caron', seen)], START);

    // Assert
    expect(presence.world.houses.caron.dormant).toBe(true);
  });

  it('walks a twenty-house town without changing it', () => {
    // Arrange
    const base = createWorld(20261105);
    const world: World = { ...base, houses: { ...base.houses }, people: { ...base.people } };
    for (let index = 5; index <= 20; index += 1) {
      const id = `house-${index}`;
      const personId = `person-${index}`;
      world.houses[id] = {
        ...base.houses.herse,
        id,
        name: `Maison ${index}`,
        workshops: [{ good: 'grain', level: 1, workers: 1 }],
        stock: {},
      };
      world.people[personId] = {
        ...base.people['person-herse'],
        id: personId,
        houseId: id,
        name: `Nom ${index}`,
      };
    }

    // Act
    const presence = applyPresence(world, [player('brigue', new Date(START))], START);

    // Assert
    expect(Object.keys(presence.world.houses)).toHaveLength(20);
    expect(presence.deletedHouseIds).toEqual([]);
    expect(presence.changed).toBe(false);
  });

  it('treats a house with no live token as dormant, and an AI house as never dormant', () => {
    // Arrange
    const world = aHumanWorld();
    world.houses.herse.dormant = true;
    const seen = new Date(START - HOUR);

    // Act
    const presence = applyPresence(world, [player('brigue', seen, seen)], START);

    // Assert: a closed session leaves the house dormant even after a visit...
    expect(presence.world.houses.brigue.dormant).toBe(true);
    // ...and an AI house is always played.
    expect(presence.world.houses.herse.dormant).toBe(false);
  });

  it('revokes a player row whose house the world no longer holds', () => {
    // Arrange: a token outlived a house whose deletion was saved but whose
    // revocation failed.
    const world = createWorld(20261105);
    delete world.houses.caron;

    // Act
    const presence = applyPresence(world, [player('caron', new Date(START))], START);

    // Assert
    expect(presence.deletedHouseIds).toContain('caron');
  });

  it('dormants a human house that has no player row, without deleting it', () => {
    // Arrange
    const world = aHumanWorld();

    // Act
    const presence = applyPresence(world, [], START);

    // Assert
    expect(presence.world.houses.brigue.dormant).toBe(true);
    expect(presence.deletedHouseIds).toEqual([]);
  });
});

interface Harness {
  url: string;
  store: MemoryPlayerStore;
  close: () => Promise<void>;
  cookies: Record<string, string>;
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

async function start(
  world: World,
  players: Array<{ houseId: string; lastSeenAt: Date }>,
  now: number,
): Promise<Harness> {
  const store = new MemoryPlayerStore();
  const worlds = new MemoryWorldStore();
  const server = createApp({
    store,
    worlds,
    logger: createLogger(() => {}),
    ready: async () => {},
    now: () => now,
    secureCookies: false,
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  running.push(close);

  await worlds.createIfAbsent(WORLD_ID, world, new Date(now), new Date(now));

  const cookies: Record<string, string> = {};
  for (const entry of players) {
    const { token } = await issueToken(store, WORLD_ID, entry.houseId, entry.lastSeenAt);
    cookies[entry.houseId] = `${SESSION_COOKIE}=${token}`;
  }

  return { url: `http://127.0.0.1:${address.port}`, store, close, cookies };
}

function tokenOf(cookie: string): string {
  return cookie.slice(SESSION_COOKIE.length + 1);
}

describe('the thirty-day deletion', () => {
  it('removes the house, revokes its token and frees its slot', async () => {
    // Arrange
    const world = aHumanWorld();
    world.seats.maire = { personId: 'person-caron' };
    const silentSince = new Date(START - (PACING.deletionDays * DAY + HOUR));
    const harness = await start(
      world,
      [
        { houseId: 'brigue', lastSeenAt: new Date(START) },
        { houseId: 'caron', lastSeenAt: silentSince },
      ],
      START,
    );
    const brigueCookie = harness.cookies.brigue as string;
    const caronToken = tokenOf(harness.cookies.caron as string);

    // Act: a living house reads the town, and the silent one is noticed.
    const response = await fetch(`${harness.url}/api/world`, { headers: { Cookie: brigueCookie } });
    const body = (await response.json()) as {
      world: { town: { houses: Array<{ id: string }>; seats: { maire: { personId: string | null } } } };
    };

    // Assert
    expect(response.status).toBe(200);
    expect(body.world.town.houses.map((house) => house.id)).not.toContain('caron');
    expect(body.world.town.seats.maire.personId).toBeNull();
    expect(await authenticate(harness.store, caronToken)).toBeNull();

    const rows = (await harness.store.listByWorld(WORLD_ID)).filter((row) => row.houseId === 'caron');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).not.toBeNull();

    // The live-house index no longer blocks the freed place.
    await expect(issueToken(harness.store, WORLD_ID, 'caron', new Date(START))).resolves.toBeDefined();
  });

  it('makes a returning founder start a fresh house after more than thirty days', async () => {
    // Arrange: the old house has money and a seat, so a failed respawn would
    // keep them.
    const world = createWorld(20261105);
    world.houses.brigue.treasuryCents = 999_999;
    world.seats.maire = { personId: 'person-brigue' };
    const seen = new Date(START - (PACING.deletionDays * DAY + HOUR));
    const harness = await start(world, [{ houseId: 'brigue', lastSeenAt: seen }], START);
    const oldCookie = harness.cookies.brigue as string;

    // Act: the visit arrives after the silence.
    const expired = await fetch(`${harness.url}/api/world`, { headers: { Cookie: oldCookie } });

    // Assert: the house is gone and the dead cookie is cleared.
    expect(expired.status).toBe(401);
    expect(expired.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    expect(await authenticate(harness.store, tokenOf(oldCookie))).toBeNull();

    // Act: the freed place waits for a human.
    const joined = await fetch(`${harness.url}/api/session`, { method: 'POST' });
    const { token } = (await joined.json()) as { token: string };
    const read = await fetch(`${harness.url}/api/world`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    const body = (await read.json()) as {
      world: {
        house: { id: string; treasuryCents: number };
        town: { seats: { maire: { personId: string | null } } };
      };
    };

    // Assert: a starter house, not the old money, and no inherited seat.
    expect(joined.status).toBe(201);
    expect(read.status).toBe(200);
    expect(body.world.house.id).toBe('brigue');
    expect(body.world.house.treasuryCents).toBe(117340);
    expect(body.world.town.seats.maire.personId).toBeNull();
  });
});

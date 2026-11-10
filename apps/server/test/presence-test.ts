import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { PACING, RULES, type World } from '@brigue/core';

import { SESSION_COOKIE } from '../src/http/cookies.ts';
import { createApp } from '../src/http/app.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryPlayerStore, type Player } from '../src/identity/players.ts';
import { applyPresence } from '../src/town/presence.ts';
import { authenticate, issueToken } from '../src/identity/session.ts';
import { MemoryWorldStore, UnknownWorldError } from '../src/town/worlds.ts';
import { CARON, FOURNIER, LECLERC, TEST_TOWN, town } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const START = Date.parse('2026-11-05T12:00:00.000Z');

function player(personId: number, lastSeenAt: Date): Player {
  return {
    tokenHash: String(personId).padEnd(64, '0'),
    playerId: personId,
    name: `Maison ${personId}`,
    townId: TEST_TOWN.id,
    personId,
    createdAt: lastSeenAt,
    lastSeenAt,
    deleteAfter: null,
  };
}

function aHumanWorld(): World {
  const world = town(20261105);
  world.people[CARON].ia = false;

  return world;
}

describe('dormancy', () => {
  it('marks a silent person dormant and keeps its money and its seat', () => {
    // Arrange
    const world = aHumanWorld();
    world.seats.maire = { personId: CARON };
    const treasuryCents = world.people[CARON].treasuryCents;
    const seen = new Date(START - (PACING.dormancyDays * DAY + HOUR));

    // Act
    const presence = applyPresence(world, [player(CARON, seen)], START);

    // Assert
    expect(presence.dormant.has(CARON)).toBe(true);
    expect(presence.world.people[CARON].treasuryCents).toBe(treasuryCents);
    expect(presence.world.seats.maire.personId).toBe(CARON);
  });

  it('deletes a person silent for more than thirty days with its seat and its candidacy', () => {
    // Arrange
    const world = aHumanWorld();
    world.seats.maire = { personId: CARON };
    world.campaigns.maire = [CARON, LECLERC];
    const seen = new Date(START - (PACING.deletionDays * DAY + HOUR));

    // Act
    const presence = applyPresence(world, [player(CARON, seen)], START);

    // Assert
    expect(presence.deletedPersonIds).toEqual([CARON]);
    expect(presence.world.people[CARON]).toBeUndefined();
    expect(presence.world.seats.maire.personId).toBeNull();
    expect(presence.world.campaigns.maire).toEqual([LECLERC]);
  });

  it('still reads a person at exactly the thirty-day boundary', () => {
    // Arrange: the existing month-long catch-up lands exactly here.
    const world = aHumanWorld();
    const seen = new Date(START - PACING.deletionDays * DAY);

    // Act
    const presence = applyPresence(world, [player(CARON, seen)], START);

    // Assert
    expect(presence.deletedPersonIds).toEqual([]);
    expect(presence.dormant.has(CARON)).toBe(true);
  });

  it('goes dormant exactly at the dormancy boundary', () => {
    // Arrange
    const world = aHumanWorld();
    const seen = new Date(START - PACING.dormancyDays * DAY);

    // Act
    const presence = applyPresence(world, [player(CARON, seen)], START);

    // Assert
    expect(presence.dormant.has(CARON)).toBe(true);
  });

  it('walks a twenty-person town without changing it', () => {
    // Arrange
    const base = town(20261105);
    const world: World = { ...base, people: { ...base.people } };
    for (let index = Object.keys(world.people).length + 1; index <= 20; index += 1) {
      world.people[index] = {
        ...base.people[FOURNIER],
        id: index,
        name: `Nom ${index}`,
        workshops: [{ id: index, trade: 'baker', level: 1 }],
        stock: {},
      };
    }

    // Act
    const presence = applyPresence(world, [player(LECLERC, new Date(START))], START);

    // Assert
    expect(Object.keys(presence.world.people)).toHaveLength(20);
    expect(presence.deletedPersonIds).toEqual([]);
  });

  it('treats a person with no account as dormant, and an AI person as never dormant', () => {
    // Arrange: the visitor belongs to another person, so leclerc has no token.
    const world = aHumanWorld();

    // Act
    const presence = applyPresence(world, [player(FOURNIER, new Date(START))], START);

    // Assert: a person nobody holds a token for runs nothing...
    expect(presence.dormant.has(LECLERC)).toBe(true);
    // ...and an AI person is always played.
    expect(presence.dormant.has(FOURNIER)).toBe(false);
  });

  it('revokes a player row whose person the world no longer holds', () => {
    // Arrange: a token outlived a person whose deletion was saved but whose
    // revocation failed.
    const world = town(20261105);
    delete world.people[CARON];

    // Act
    const presence = applyPresence(world, [player(CARON, new Date(START))], START);

    // Assert
    expect(presence.deletedPersonIds).toContain(CARON);
  });

  it('dormants a human person that has no player row, without deleting it', () => {
    // Arrange
    const world = aHumanWorld();

    // Act
    const presence = applyPresence(world, [], START);

    // Assert
    expect(presence.dormant.has(LECLERC)).toBe(true);
    expect(presence.deletedPersonIds).toEqual([]);
  });
});

interface Harness {
  url: string;
  store: MemoryPlayerStore;
  worlds: MemoryWorldStore;
  close: () => Promise<void>;
  cookies: Record<number, string>;
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

async function start(
  world: World,
  players: Array<{ personId: number; lastSeenAt: Date }>,
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

  await worlds.createTown(TEST_TOWN.name, world, new Date(now));

  const cookies: Record<number, string> = {};
  for (const entry of players) {
    const { token, player } = await issueToken(store, `Maison ${entry.personId}`, entry.lastSeenAt);
    await store.rebind(player.tokenHash, TEST_TOWN.id, entry.personId, entry.lastSeenAt);
    cookies[entry.personId] = `${SESSION_COOKIE}=${token}`;
  }

  return { url: `http://127.0.0.1:${address.port}`, store, worlds, close, cookies };
}

function tokenOf(cookie: string): string {
  return cookie.slice(SESSION_COOKIE.length + 1);
}

describe('the thirty-day deletion', () => {
  it('removes the person, revokes its token and frees its place', async () => {
    // Arrange
    const world = aHumanWorld();
    world.seats.maire = { personId: CARON };
    const silentSince = new Date(START - (PACING.deletionDays * DAY + HOUR));
    const harness = await start(
      world,
      [
        { personId: LECLERC, lastSeenAt: new Date(START) },
        { personId: CARON, lastSeenAt: silentSince },
      ],
      START,
    );
    const leclercCookie = harness.cookies[LECLERC] as string;
    const caronToken = tokenOf(harness.cookies[CARON] as string);

    // Act: a living person reads the town, and the silent one is noticed.
    const response = await fetch(`${harness.url}/api/world`, { headers: { Cookie: leclercCookie } });
    const body = (await response.json()) as {
      world: { town: { people: Array<{ id: number }>; seats: { maire: { personId: number | null } } } };
    };

    // Assert
    expect(response.status).toBe(200);
    expect(body.world.town.people.map((person) => person.id)).not.toContain(CARON);
    expect(body.world.town.seats.maire.personId).toBeNull();
    expect(await authenticate(harness.store, caronToken)).toBeNull();

    // The account went with the person: there is no revoked state to keep.
    const rows = (await harness.store.listByTown(TEST_TOWN.id)).filter((row) => row.personId === CARON);
    expect(rows).toHaveLength(0);

    // The freed place can be bound again.
    const { player } = await issueToken(harness.store, 'Caron', new Date(START));
    await expect(harness.store.rebind(player.tokenHash, TEST_TOWN.id, CARON, new Date(START))).resolves.toBeDefined();
  });

  it('makes a returning player start a fresh first person after more than thirty days', async () => {
    // Arrange: the old person has money and a seat, so a failed respawn would
    // keep them.
    const world = town(20261105);
    world.people[LECLERC].treasuryCents = 999_999;
    world.seats.maire = { personId: LECLERC };
    const seen = new Date(START - (PACING.deletionDays * DAY + HOUR));
    const harness = await start(world, [{ personId: LECLERC, lastSeenAt: seen }], START);
    const oldCookie = harness.cookies[LECLERC] as string;

    // Act: the visit arrives after the silence.
    const expired = await fetch(`${harness.url}/api/world`, { headers: { Cookie: oldCookie } });

    // Assert: the person is gone and the dead cookie is cleared.
    expect(expired.status).toBe(401);
    expect(expired.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    expect(await authenticate(harness.store, tokenOf(oldCookie))).toBeNull();
    // The last human person went with the silence, and the town with it.
    await expect(
      harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id),
    ).rejects.toBeInstanceOf(UnknownWorldError);

    // Act: the freed place waits for a human, who chooses a trade on arrival.
    const joined = await fetch(`${harness.url}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trade: 'baker' }),
    });
    const { token, personId } = (await joined.json()) as { token: string; personId: number };
    const read = await fetch(`${harness.url}/api/world`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    const body = (await read.json()) as {
      world: {
        person: {
          id: number;
          treasuryCents: number;
          workshops: Array<{ good: string; input: string | null }>;
          stock: Record<string, number>;
        };
        town: { seats: { maire: { personId: number | null } } };
      };
    };

    // Assert: a starter person, not the old money, and no inherited seat.
    expect(joined.status).toBe(201);
    expect(read.status).toBe(200);
    // A new town, so the drawn name may be any place: what matters is that the
    // old money and the old seat did not cross.
    expect(body.world.person.id).toBe(personId);
    expect(body.world.person.treasuryCents).toBe(RULES.startingPurseCents);
    expect(body.world.person.workshops).toEqual([
      {
        id: 4,
        trade: 'baker',
        good: 'bread',
        level: 2,
        input: 'grain',
        outputUnitsPerHour: 4,
        inputUnitsPerHour: 4,
        upkeepCentsPerHour: 240,
        capacityUnits: 200,
        canUpgrade: false,
      },
    ]);
    expect(body.world.person.stock.grain).toBe(8);
    expect(body.world.town.seats.maire.personId).toBeNull();
  });
});

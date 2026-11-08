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
import { TEST_TOWN, town } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const START = Date.parse('2026-11-05T12:00:00.000Z');

function player(dynastyId: string, lastSeenAt: Date): Player {
  return {
    tokenHash: dynastyId.padEnd(64, '0'),
    playerId: 1,
    townId: TEST_TOWN.id,
    dynastyId,
    createdAt: lastSeenAt,
    lastSeenAt,
    deleteAfter: null,
  };
}

function aHumanWorld(): World {
  const world = town(20261105);
  world.dynasties.caron.controller = 'human';

  return world;
}

describe('dormancy', () => {
  it('marks a silent dynasty dormant and keeps its money and its seat', () => {
    // Arrange
    const world = aHumanWorld();
    world.seats.maire = { personId: 'person-caron' };
    const treasuryCents = world.dynasties.caron.treasuryCents;
    const seen = new Date(START - (PACING.dormancyDays * DAY + HOUR));

    // Act
    const presence = applyPresence(world, [player('caron', seen)], START);

    // Assert
    expect(presence.dormant.has('caron')).toBe(true);
    expect(presence.world.dynasties.caron.treasuryCents).toBe(treasuryCents);
    expect(presence.world.seats.maire.personId).toBe('person-caron');
  });

  it('deletes a dynasty silent for more than thirty days with its people and its seat', () => {
    // Arrange
    const world = aHumanWorld();
    world.seats.maire = { personId: 'person-caron' };
    world.campaigns.maire = { caron: 2 };
    world.engagements = [
      { id: 'engagement-caron', kind: 'site', dynastyId: 'caron', dueAt: world.hour + 4, work: 'residence' },
      { id: 'engagement-leclerc', kind: 'hearing', dynastyId: 'leclerc', dueAt: world.hour + 4 },
    ];
    const seen = new Date(START - (PACING.deletionDays * DAY + HOUR));

    // Act
    const presence = applyPresence(world, [player('caron', seen)], START);

    // Assert
    expect(presence.deletedDynastyIds).toEqual(['caron']);
    expect(presence.world.dynasties.caron).toBeUndefined();
    expect(presence.world.people['person-caron']).toBeUndefined();
    expect(presence.world.seats.maire.personId).toBeNull();
    expect(presence.world.campaigns.maire).toEqual({});
    expect(presence.world.engagements.map((engagement) => engagement.id)).toEqual(['engagement-leclerc']);
  });

  it('still reads a dynasty at exactly the thirty-day boundary', () => {
    // Arrange: the existing month-long catch-up lands exactly here.
    const world = aHumanWorld();
    const seen = new Date(START - PACING.deletionDays * DAY);

    // Act
    const presence = applyPresence(world, [player('caron', seen)], START);

    // Assert
    expect(presence.deletedDynastyIds).toEqual([]);
    expect(presence.dormant.has('caron')).toBe(true);
  });

  it('goes dormant exactly at the dormancy boundary', () => {
    // Arrange
    const world = aHumanWorld();
    const seen = new Date(START - PACING.dormancyDays * DAY);

    // Act
    const presence = applyPresence(world, [player('caron', seen)], START);

    // Assert
    expect(presence.dormant.has('caron')).toBe(true);
  });

  it('walks a twenty-dynasty town without changing it', () => {
    // Arrange
    const base = town(20261105);
    const world: World = { ...base, dynasties: { ...base.dynasties }, people: { ...base.people } };
    for (let index = Object.keys(world.dynasties).length + 1; index <= 20; index += 1) {
      const id = `dynasty-${index}`;
      const personId = `person-${index}`;
      world.dynasties[id] = {
        ...base.dynasties.fournier,
        id,
        name: `Maison ${index}`,
        workshops: [{ id: 'workshop-1', good: 'grain', level: 1 }],
        stock: {},
      };
      world.people[personId] = {
        ...base.people['person-fournier'],
        id: personId,
        dynastyId: id,
        name: `Nom ${index}`,
      };
    }

    // Act
    const presence = applyPresence(world, [player('leclerc', new Date(START))], START);

    // Assert
    expect(Object.keys(presence.world.dynasties)).toHaveLength(20);
    expect(presence.deletedDynastyIds).toEqual([]);
  });

  it('treats a dynasty with no account as dormant, and an AI dynasty as never dormant', () => {
    // Arrange: the visitor belongs to another dynasty, so leclerc has no token.
    const world = aHumanWorld();

    // Act
    const presence = applyPresence(world, [player('fournier', new Date(START))], START);

    // Assert: a dynasty nobody holds a token for runs nothing...
    expect(presence.dormant.has('leclerc')).toBe(true);
    // ...and an AI dynasty is always played.
    expect(presence.dormant.has('fournier')).toBe(false);
  });

  it('revokes a player row whose dynasty the world no longer holds', () => {
    // Arrange: a token outlived a dynasty whose deletion was saved but whose
    // revocation failed.
    const world = town(20261105);
    delete world.dynasties.caron;

    // Act
    const presence = applyPresence(world, [player('caron', new Date(START))], START);

    // Assert
    expect(presence.deletedDynastyIds).toContain('caron');
  });

  it('dormants a human dynasty that has no player row, without deleting it', () => {
    // Arrange
    const world = aHumanWorld();

    // Act
    const presence = applyPresence(world, [], START);

    // Assert
    expect(presence.dormant.has('leclerc')).toBe(true);
    expect(presence.deletedDynastyIds).toEqual([]);
  });
});

interface Harness {
  url: string;
  store: MemoryPlayerStore;
  worlds: MemoryWorldStore;
  close: () => Promise<void>;
  cookies: Record<string, string>;
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

async function start(
  world: World,
  players: Array<{ dynastyId: string; lastSeenAt: Date }>,
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

  const cookies: Record<string, string> = {};
  for (const entry of players) {
    const { token } = await issueToken(store, TEST_TOWN.id, entry.dynastyId, entry.lastSeenAt);
    cookies[entry.dynastyId] = `${SESSION_COOKIE}=${token}`;
  }

  return { url: `http://127.0.0.1:${address.port}`, store, worlds, close, cookies };
}

function tokenOf(cookie: string): string {
  return cookie.slice(SESSION_COOKIE.length + 1);
}

describe('the thirty-day deletion', () => {
  it('removes the dynasty, revokes its token and frees its slot', async () => {
    // Arrange
    const world = aHumanWorld();
    world.seats.maire = { personId: 'person-caron' };
    const silentSince = new Date(START - (PACING.deletionDays * DAY + HOUR));
    const harness = await start(
      world,
      [
        { dynastyId: 'leclerc', lastSeenAt: new Date(START) },
        { dynastyId: 'caron', lastSeenAt: silentSince },
      ],
      START,
    );
    const leclercCookie = harness.cookies.leclerc as string;
    const caronToken = tokenOf(harness.cookies.caron as string);

    // Act: a living dynasty reads the town, and the silent one is noticed.
    const response = await fetch(`${harness.url}/api/world`, { headers: { Cookie: leclercCookie } });
    const body = (await response.json()) as {
      world: { town: { dynasties: Array<{ id: string }>; seats: { maire: { personId: string | null } } } };
    };

    // Assert
    expect(response.status).toBe(200);
    expect(body.world.town.dynasties.map((dynasty) => dynasty.id)).not.toContain('caron');
    expect(body.world.town.seats.maire.personId).toBeNull();
    expect(await authenticate(harness.store, caronToken)).toBeNull();

    // The account went with the dynasty: there is no revoked state to keep.
    const rows = (await harness.store.listByTown(TEST_TOWN.id)).filter((row) => row.dynastyId === 'caron');
    expect(rows).toHaveLength(0);

    // The live-dynasty index no longer blocks the freed place.
    await expect(issueToken(harness.store, TEST_TOWN.id, 'caron', new Date(START))).resolves.toBeDefined();
  });

  it('makes a returning player start a fresh first dynasty after more than thirty days', async () => {
    // Arrange: the old dynasty has money and a seat, so a failed respawn would
    // keep them.
    const world = town(20261105);
    world.dynasties.leclerc.treasuryCents = 999_999;
    world.seats.maire = { personId: 'person-leclerc' };
    const seen = new Date(START - (PACING.deletionDays * DAY + HOUR));
    const harness = await start(world, [{ dynastyId: 'leclerc', lastSeenAt: seen }], START);
    const oldCookie = harness.cookies.leclerc as string;

    // Act: the visit arrives after the silence.
    const expired = await fetch(`${harness.url}/api/world`, { headers: { Cookie: oldCookie } });

    // Assert: the dynasty is gone and the dead cookie is cleared.
    expect(expired.status).toBe(401);
    expect(expired.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    expect(await authenticate(harness.store, tokenOf(oldCookie))).toBeNull();
    // The last human dynasty went with the silence, and the town with it.
    await expect(
      harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id),
    ).rejects.toBeInstanceOf(UnknownWorldError);

    // Act: the freed place waits for a human, who chooses a trade on arrival.
    const joined = await fetch(`${harness.url}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trade: 'baker' }),
    });
    const { token, dynastyId } = (await joined.json()) as { token: string; dynastyId: string };
    const read = await fetch(`${harness.url}/api/world`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    const body = (await read.json()) as {
      world: {
        dynasty: {
          id: string;
          treasuryCents: number;
          workshops: Array<{ good: string; input: string | null }>;
          stock: Record<string, number>;
        };
        town: { seats: { maire: { personId: string | null } } };
      };
    };

    // Assert: a starter dynasty, not the old money, and no inherited seat.
    expect(joined.status).toBe(201);
    expect(read.status).toBe(200);
    // A new town, so the drawn name may be any place: what matters is that the
    // old money and the old seat did not cross.
    expect(body.world.dynasty.id).toBe(dynastyId);
    expect(body.world.dynasty.treasuryCents).toBe(RULES.startingPurseCents);
    expect(body.world.dynasty.workshops).toEqual([
      {
        id: 'workshop-1',
        good: 'bread',
        level: 2,
        input: 'grain',
        outputUnitsPerHour: 4,
        inputUnitsPerHour: 4,
        upkeepCentsPerHour: 240,
        capacityUnits: 200,
        canUpgrade: false,
        upgradeHours: 3,
      },
    ]);
    expect(body.world.dynasty.stock.grain).toBe(8);
    expect(body.world.town.seats.maire.personId).toBeNull();
  });
});

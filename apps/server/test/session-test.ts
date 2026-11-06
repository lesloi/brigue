import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorld, RULES } from '@brigue/core';

import { SESSION_COOKIE } from '../src/cookies.ts';
import { createApp, type AppDeps } from '../src/http.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryPlayerStore } from '../src/players.ts';
import { issueToken } from '../src/session.ts';
import { MemoryWorldStore, UnknownWorldError, type WorldStore } from '../src/worlds.ts';
import { TEST_FIRST_HOUSE, TEST_TOWN, town } from './helpers.ts';

interface Harness {
  url: string;
  store: MemoryPlayerStore;
  worlds: MemoryWorldStore;
  logs: string[];
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

async function start(options: Partial<AppDeps> = {}): Promise<Harness> {
  const store = new MemoryPlayerStore();
  const worlds = new MemoryWorldStore();
  const logs: string[] = [];
  const logger = createLogger((line) => logs.push(line));
  const server = createApp({ store, worlds, logger, ready: async () => {}, ...options });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  running.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  return { url: `http://127.0.0.1:${address.port}`, store, worlds, logs };
}

function login(harness: Harness, token: string, ip?: string): Promise<Response> {
  return fetch(`${harness.url}/api/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: JSON.stringify({ token }),
  });
}

function join(harness: Harness, trade = 'weaver'): Promise<Response> {
  return fetch(`${harness.url}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trade }),
  });
}

function cookieOf(response: Response): string | undefined {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}

function cookiePair(response: Response): string {
  return (cookieOf(response) as string).split(';')[0];
}

describe('the token endpoint', () => {
  it('opens the house of a valid token and sets an httpOnly session cookie', async () => {
    const harness = await start();
    const { token } = await issueToken(harness.store, TEST_TOWN.id, 'leclerc');

    const response = await login(harness, token);
    const cookie = cookieOf(response) as string;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ worldId: TEST_TOWN.id, houseId: 'leclerc' });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers a revoked token exactly like an unknown one: 401 and nothing else', async () => {
    const harness = await start();
    const { token, player } = await issueToken(harness.store, TEST_TOWN.id, 'leclerc');
    await harness.store.revoke(player.tokenHash, new Date());

    const unknown = await login(harness, `bgk_${'x'.repeat(43)}`);
    const revoked = await login(harness, token);

    expect(unknown.status).toBe(401);
    expect(revoked.status).toBe(401);
    expect(await unknown.text()).toBe('');
    expect(await revoked.text()).toBe('');
    expect(cookieOf(unknown)).toBeUndefined();
    expect(cookieOf(revoked)).toBeUndefined();
  });

  it('never reads a token from the URL', async () => {
    // Arrange: a token the store does not know. Reading it would answer 401
    // instead of joining.
    const harness = await start();
    const unknown = `bgk_${'x'.repeat(43)}`;

    // Act
    const response = await fetch(`${harness.url}/api/session?token=${encodeURIComponent(unknown)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trade: 'weaver' }),
    });

    // Assert: the body's trade created the town, the query was ignored.
    expect(response.status).toBe(201);
    expect(cookieOf(response)).toBeDefined();
  });

  it('refuses a malformed body without opening a session', async () => {
    const harness = await start();

    const response = await fetch(`${harness.url}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(response.status).toBe(400);
    expect(cookieOf(response)).toBeUndefined();
  });

  it('is rate limited per client, without touching another client', async () => {
    const harness = await start({ trustProxy: true, sessionAttemptsPerMinute: 2 });
    const valid = await issueToken(harness.store, TEST_TOWN.id, 'leclerc');
    const limited = await (async () => {
      expect((await login(harness, 'nope', '203.0.113.7')).status).toBe(401);
      expect((await login(harness, 'nope', '203.0.113.7')).status).toBe(401);

      return login(harness, valid.token, '203.0.113.7');
    })();

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

    const other = await login(harness, valid.token, '198.51.100.4');
    expect(other.status).toBe(200);
  });

  it('ignores a client-chosen leftmost forwarded address', async () => {
    const harness = await start({ trustProxy: true, sessionAttemptsPerMinute: 1 });

    expect((await login(harness, 'nope', '1.2.3.4, 203.0.113.7')).status).toBe(401);
    expect((await login(harness, 'nope', '5.6.7.8, 203.0.113.7')).status).toBe(429);
  });

  it('falls back to the socket when the forwarded header is absent', async () => {
    const harness = await start({ trustProxy: true, sessionAttemptsPerMinute: 1 });

    expect((await login(harness, 'nope')).status).toBe(401);
    expect((await login(harness, 'nope')).status).toBe(429);
  });
});

describe('joining the town', () => {
  it('issues a token for the first human house and founds the town', async () => {
    const harness = await start();

    const response = await join(harness);
    const body = (await response.json()) as { token: string; worldId: string; houseId: string };

    // The town is founded here, named by the draw, so its id is not fixed.
    const towns = await harness.worlds.listTowns();
    expect(response.status).toBe(201);
    expect(towns).toHaveLength(1);
    expect(body.worldId).toBe(towns[0]?.id);
    expect(towns[0]?.name).not.toBe('');
    expect(body.houseId).toMatch(/^[a-z0-9-]+$/);
    expect(body.token).toMatch(/^bgk_[A-Za-z0-9_-]{43}$/);
    expect(cookieOf(response)).toContain('HttpOnly');

    // The first house is the human one the join drew, and the town is one
    // hour old.
    const snapshot = await harness.worlds.withWorld(async (session) => session.snapshot, body.worldId);
    expect(snapshot.world.hour).toBe(1);
    expect(snapshot.world.houses[body.houseId]?.controller).toBe('human');
    expect(snapshot.world.houses[body.houseId]?.name).not.toBe('');

    // The issued token is the identity: it logs in on the next visit.
    const again = await login(harness, body.token);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ worldId: body.worldId, houseId: body.houseId });
  });

  it('hands a second player a new house, not the first one', async () => {
    // Arrange: the first player has the town and its first house.
    const harness = await start();
    const first = (await (await join(harness)).json()) as { houseId: string; worldId: string };

    // Act
    const response = await join(harness);
    const second = (await response.json()) as { houseId: string; worldId: string };

    // Assert: the same town, a house of its own, a workshop, no purse.
    expect(response.status).toBe(201);
    expect(second.worldId).toBe(first.worldId);
    expect(second.houseId).not.toBe(first.houseId);
    const world = await harness.worlds.withWorld(async (session) => session.snapshot.world, first.worldId);
    expect(world.houses[second.houseId]?.controller).toBe('human');
    expect(world.houses[second.houseId]?.treasuryCents).toBe(RULES.startingPurseCents);
    expect(world.houses[first.houseId]?.treasuryCents).toBe(RULES.startingPurseCents);
  });

  it('binds a player to a human house with no live token', async () => {
    // Arrange: a town whose first house exists but has no token.
    const harness = await start();
    const base = town(7);
    await harness.worlds.createTown(TEST_TOWN, base, new Date());

    // Act
    const response = await join(harness);
    const body = (await response.json()) as { houseId: string; worldId: string };

    // Assert: the freed place is taken, and no house is added.
    expect(response.status).toBe(201);
    expect(body.worldId).toBe(TEST_TOWN.id);
    expect(body.houseId).toBe(TEST_FIRST_HOUSE.id);
    const world = await harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id);
    expect(Object.keys(world.houses)).toHaveLength(Object.keys(base.houses).length);
  });

  it('does not hand out a house the deletion pass is about to remove', async () => {
    // Arrange: a freed house whose last visit is past the deletion threshold.
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN, town(7), new Date());
    const seen = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await harness.store.insert({
      tokenHash: 'f'.repeat(64),
      worldId: TEST_TOWN.id,
      houseId: TEST_FIRST_HOUSE.id,
      createdAt: seen,
      lastSeenAt: seen,
      revokedAt: seen,
    });

    // Act
    const response = await join(harness);
    const body = (await response.json()) as { houseId: string; worldId: string };

    // Assert: a new house, not the one the next read would delete.
    expect(response.status).toBe(201);
    expect(body.worldId).toBe(TEST_TOWN.id);
    expect(body.houseId).not.toBe(TEST_FIRST_HOUSE.id);
  });

  it('skips a town that vanishes between the list and its lock', async () => {
    // Arrange: a store whose only town is deleted right after the list.
    const real = new MemoryWorldStore();
    await real.createTown(TEST_TOWN, town(7), new Date());
    let vanish = true;
    const worlds: WorldStore = {
      createTown: (info, world, at) => real.createTown(info, world, at),
      listTowns: () => real.listTowns(),
      usedTownNames: () => real.usedTownNames(),
      withWorld: (run, townId) => {
        if (vanish && townId === TEST_TOWN.id) {
          vanish = false;
          return Promise.reject(new UnknownWorldError());
        }

        return real.withWorld(run, townId);
      },
      withJoinLock: (run) => real.withJoinLock(run),
      close: () => real.close(),
    };
    const harness = await start({ worlds });

    // Act
    const response = await join(harness);
    const body = (await response.json()) as { worldId: string };

    // Assert: the join founds a town instead of failing.
    expect(response.status).toBe(201);
    expect(body.worldId).not.toBe(TEST_TOWN.id);
  });

  it('founds a second town when no town has a free place', async () => {
    // Arrange: a town at the cap, its only human house taken.
    const harness = await start();
    const base = town(7);
    for (let index = 0; index < 16; index += 1) {
      const id = `ai-${index}`;
      base.houses[id] = { ...(base.houses.caron as (typeof base.houses)[string]), id, name: `IA ${index}` };
      base.people[`person-${id}`] = {
        ...(base.people['person-caron'] as (typeof base.people)[string]),
        id: `person-${id}`,
        houseId: id,
      };
    }
    await harness.worlds.createTown(TEST_TOWN, base, new Date());
    await issueToken(harness.store, TEST_TOWN.id, TEST_FIRST_HOUSE.id, new Date());

    // Act
    const response = await join(harness);
    const body = (await response.json()) as { worldId: string; houseId: string };

    // Assert: a new town with its own first house, the full one untouched.
    expect(response.status).toBe(201);
    expect(body.worldId).not.toBe(TEST_TOWN.id);
    expect((await harness.worlds.listTowns()).map((town) => town.id).sort()).toEqual(
      [TEST_TOWN.id, body.worldId].sort(),
    );
    const founded = await harness.worlds.withWorld(async (session) => session.snapshot.world, body.worldId);
    expect(founded.houses[body.houseId]?.controller).toBe('human');
    expect(Object.keys(founded.houses)).toHaveLength(Object.keys(town(1).houses).length);
    const full = await harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id);
    expect(Object.keys(full.houses)).toHaveLength(20);
  });

  it('takes a free place in an older town before founding a new one', async () => {
    // Arrange: an older town with no place, a younger one with a freed house.
    const harness = await start();
    const older = town(7);
    for (let index = 0; index < 16; index += 1) {
      const id = `ai-${index}`;
      older.houses[id] = { ...(older.houses.caron as (typeof older.houses)[string]), id, name: `IA ${index}` };
      older.people[`person-${id}`] = {
        ...(older.people['person-caron'] as (typeof older.people)[string]),
        id: `person-${id}`,
        houseId: id,
      };
    }
    const younger = { id: 'jeune', name: 'Jeune' };
    await harness.worlds.createTown(TEST_TOWN, older, new Date());
    await harness.worlds.createTown(younger, town(8), new Date());
    await issueToken(harness.store, TEST_TOWN.id, TEST_FIRST_HOUSE.id, new Date());

    // Act: the second town's first house has no live token.
    const response = await join(harness);
    const body = (await response.json()) as { worldId: string; houseId: string };

    // Assert
    expect(response.status).toBe(201);
    expect(body.worldId).toBe(younger.id);
    expect(body.houseId).toBe(TEST_FIRST_HOUSE.id);
  });

  it('leaves a town whose humans have all gone to the scheduler', async () => {
    // Arrange: a town of AI houses only, waiting to be deleted.
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN, createWorld(9), new Date());

    // Act
    const response = await join(harness);
    const body = (await response.json()) as { worldId: string };

    // Assert: a new town is founded rather than the dead one kept alive.
    expect(response.status).toBe(201);
    expect(body.worldId).not.toBe(TEST_TOWN.id);
  });

  it('refuses to hand out a token for a world the current rules cannot read', async () => {
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN, { ...town(7), rulesetVersion: RULES.version + 1 }, new Date());

    const response = await join(harness);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'world_version', rulesetVersion: RULES.version + 1 });
    expect(cookieOf(response)).toBeUndefined();
  });

  it('opens the first house with the chosen trade', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await join(harness, 'baker');
    const body = (await response.json()) as { token: string };
    const read = await fetch(`${harness.url}/api/world`, {
      headers: { Cookie: `${SESSION_COOKIE}=${body.token}` },
    });
    const world = (await read.json()) as {
      world: { house: { workshops: Array<{ good: string; input: string | null }>; stock: Record<string, number> } };
    };

    // Assert
    expect(response.status).toBe(201);
    expect(read.status).toBe(200);
    expect(world.world.house.workshops).toEqual([
      {
        good: 'bread',
        level: 2,
        workers: 2,
        input: 'grain',
        outputUnitsPerHour: 4,
        inputUnitsPerHour: 4,
        wagesCentsPerHour: 240,
      },
    ]);
    expect(world.world.house.stock.grain).toBe(8);
  });

  it('does not change the trade when a token resumes', async () => {
    // Arrange
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN, town(7, 'baker'), new Date());
    const { token } = await issueToken(harness.store, TEST_TOWN.id, 'leclerc');

    // Act
    const response = await login(harness, token);
    const read = await fetch(`${harness.url}/api/world`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    const world = (await read.json()) as {
      world: { house: { workshops: Array<{ good: string; input: string | null }> } };
    };

    // Assert
    expect(response.status).toBe(200);
    expect(world.world.house.workshops).toEqual([
      {
        good: 'bread',
        level: 2,
        workers: 2,
        input: 'grain',
        outputUnitsPerHour: 4,
        inputUnitsPerHour: 4,
        wagesCentsPerHour: 240,
      },
    ]);
  });

  it('refuses a join without a trade, before creating the world', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await fetch(`${harness.url}/api/session`, { method: 'POST' });

    // Assert: no world was minted for an invalid request.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_trade' });
    expect(cookieOf(response)).toBeUndefined();
    expect(await harness.worlds.listTowns()).toEqual([]);
  });

  it('refuses an unknown or null trade', async () => {
    // Arrange
    const harness = await start();

    // Act
    const unknown = await join(harness, 'silk');
    const body = await fetch(`${harness.url}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trade: null }),
    });

    // Assert
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: 'invalid_trade' });
    expect(body.status).toBe(400);
    expect(await body.json()).toEqual({ error: 'invalid_trade' });
  });
});

describe('the session cookie', () => {
  it('reads the house back from the cookie alone', async () => {
    const harness = await start();
    const { token } = await issueToken(harness.store, TEST_TOWN.id, 'herse');
    const opened = await login(harness, token);

    const response = await fetch(`${harness.url}/api/session`, {
      headers: { Cookie: cookiePair(opened) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ worldId: TEST_TOWN.id, houseId: 'herse' });
  });

  it('clears a dead cookie instead of replaying it', async () => {
    const harness = await start();

    const response = await fetch(`${harness.url}/api/session`, {
      headers: { Cookie: `${SESSION_COOKIE}=bgk_${'x'.repeat(43)}` },
    });

    expect(response.status).toBe(401);
    expect(cookieOf(response)).toContain('Max-Age=0');
  });

  it('revokes the token when the session is closed', async () => {
    const harness = await start();
    const { token } = await issueToken(harness.store, TEST_TOWN.id, 'leclerc');
    const opened = await login(harness, token);

    const closed = await fetch(`${harness.url}/api/session`, {
      method: 'DELETE',
      headers: { Cookie: cookiePair(opened) },
    });
    const after = await fetch(`${harness.url}/api/session`, {
      headers: { Cookie: cookiePair(opened) },
    });

    expect(closed.status).toBe(204);
    expect(cookieOf(closed)).toContain('Max-Age=0');
    expect(after.status).toBe(401);
    expect(await login(harness, token)).toMatchObject({ status: 401 });
  });

  it('drops Secure only when the server is explicitly told to', async () => {
    const harness = await start({ secureCookies: false });
    const { token } = await issueToken(harness.store, TEST_TOWN.id, 'leclerc');

    const response = await login(harness, token);

    expect(cookieOf(response)).not.toContain('Secure');
  });
});

describe('the logs', () => {
  it('never contain a token, whether it was accepted, unknown or revoked', async () => {
    const harness = await start();
    const { token, player } = await issueToken(harness.store, TEST_TOWN.id, 'leclerc');

    await login(harness, token);
    await login(harness, `bgk_${'x'.repeat(43)}`);
    await harness.store.revoke(player.tokenHash, new Date());
    await login(harness, token);

    const lines = harness.logs.join('\n');

    expect(lines).toContain('session.opened');
    expect(lines).toContain('session.refused');
    expect(lines).not.toContain(token);
  });
});

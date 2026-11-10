import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorld, RULES, stateHash, type World } from '@brigue/core';

import { SESSION_COOKIE } from '../src/http/cookies.ts';
import { createApp, type AppDeps } from '../src/http/app.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryPlayerStore } from '../src/identity/players.ts';
import { issueToken } from '../src/identity/session.ts';
import { MemoryWorldStore, UnknownWorldError, type WorldStore } from '../src/town/worlds.ts';
import { FOURNIER, LECLERC, TEST_TOWN, town } from './helpers.ts';

interface Harness {
  url: string;
  store: MemoryPlayerStore;
  worlds: MemoryWorldStore;
  logs: string[];
}

const HOUR = 60 * 60 * 1000;

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

/** An account bound to the fixture person of the fixture town. */
async function boundAccount(harness: Harness, name = 'Leclerc') {
  const issued = await issueToken(harness.store, name);
  const player = await harness.store.rebind(issued.player.tokenHash, TEST_TOWN.id, LECLERC, new Date());

  return { token: issued.token, player: player!, cookie: `${SESSION_COOKIE}=${issued.token}` };
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

/** The trade choice of an account that already holds a session cookie. */
function choose(harness: Harness, trade: string, cookie: string): Promise<Response> {
  return fetch(`${harness.url}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ trade }),
  });
}

/** An account an ordinary reset left between towns: the token and the id stay. */
async function afterReset(harness: Harness) {
  const { token, player } = await issueToken(harness.store, 'Leclerc');
  harness.store.resetAccounts();

  return { token, player, cookie: `${SESSION_COOKIE}=${token}` };
}

/** Fills a town to the cap with AI people, so only its humans are places. */
function fillTown(world: World): World {
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

function cookieOf(response: Response): string | undefined {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}

function cookiePair(response: Response): string {
  return (cookieOf(response) as string).split(';')[0];
}

describe('the token endpoint', () => {
  it('opens the person of a valid token and sets an httpOnly session cookie', async () => {
    const harness = await start();
    const { token } = await boundAccount(harness);

    const response = await login(harness, token);
    const cookie = cookieOf(response) as string;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ townId: TEST_TOWN.id, personId: LECLERC, deletionAfter: null });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers a token whose account is gone exactly like an unknown one: 401 and nothing else', async () => {
    const harness = await start();
    const { token, player } = await boundAccount(harness);
    await harness.store.deleteAccount(player.playerId);

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
    const valid = await boundAccount(harness);
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
  it('issues a token for the first human person and founds the town', async () => {
    const harness = await start();

    const response = await join(harness);
    const body = (await response.json()) as { token: string; townId: number; personId: number };

    // The town is founded here, named by the draw, so its id is not fixed.
    const towns = await harness.worlds.listTowns();
    expect(response.status).toBe(201);
    expect(towns).toHaveLength(1);
    expect(body.townId).toBe(towns[0]?.id);
    expect(towns[0]?.name).not.toBe('');
    expect(body.personId).toBeGreaterThan(0);
    expect(body.token).toMatch(/^bgk_[A-Za-z0-9_-]{43}$/);
    expect(cookieOf(response)).toContain('HttpOnly');

    // The first person is the human one the join drew, and the town is one
    // hour old.
    const snapshot = await harness.worlds.withWorld(async (session) => session.snapshot, body.townId);
    expect(snapshot.world.hour).toBe(1);
    expect(snapshot.world.people[body.personId]?.ia).toBe(false);
    expect(snapshot.world.people[body.personId]?.name).not.toBe('');

    // The issued token is the identity: it logs in on the next visit.
    const again = await login(harness, body.token);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ townId: body.townId, personId: body.personId, deletionAfter: null });
  });

  it('hands a second player a new person, not the first one', async () => {
    // Arrange: the first player has the town and its first person.
    const harness = await start();
    const first = (await (await join(harness)).json()) as { personId: number; townId: number };

    // Act
    const response = await join(harness);
    const second = (await response.json()) as { personId: number; townId: number };

    // Assert: the same town, a person of its own, a workshop, no purse.
    expect(response.status).toBe(201);
    expect(second.townId).toBe(first.townId);
    expect(second.personId).not.toBe(first.personId);
    const world = await harness.worlds.withWorld(async (session) => session.snapshot.world, first.townId);
    expect(world.people[second.personId]?.ia).toBe(false);
    expect(world.people[second.personId]?.treasuryCents).toBe(RULES.startingPurseCents);
    expect(world.people[first.personId]?.treasuryCents).toBe(RULES.startingPurseCents);
  });

  it('adds a person to a town, bound to the account', async () => {
    // Arrange: a town whose first person no account holds — an AI, since a
    // person without an account is one.
    const harness = await start();
    const base = town(7);
    await harness.worlds.createTown(TEST_TOWN.name, base, new Date());

    // Act
    const response = await join(harness);
    const body = (await response.json()) as { personId: number; townId: number };

    // Assert: the join adds its own person, and the town holds both.
    expect(response.status).toBe(201);
    expect(body.townId).toBe(TEST_TOWN.id);
    expect(body.personId).not.toBe(LECLERC);
    const world = await harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id);
    expect(world.people[body.personId]?.ia).toBe(false);
    expect(Object.keys(world.people)).toHaveLength(Object.keys(base.people).length + 1);
  });

  it('skips a town that vanishes between the list and its lock', async () => {
    // Arrange: a store whose only town is deleted right after the list. The
    // split town is skipped, and the suggestion of the founding join reads
    // each town once more: the town is gone in every read but the list.
    const real = new MemoryWorldStore();
    const split = await real.createTown('Split', town(7), new Date());
    let vanish = true;
    const worlds: WorldStore = {
      createTown: (name, world, at) => real.createTown(name, world, at),
      listTowns: () => real.listTowns(),
      readClock: () => real.readClock(),
      moveWorldClockBack: (hours) => real.moveWorldClockBack(hours),
      withWorld: (run, townId) => {
        // Gone, not failing: the next join will not see it either.
        if (vanish && townId === split.id) {
          vanish = false;
          void real.withWorld((session) => session.clear(), townId);
          return Promise.reject(new UnknownWorldError());
        }

        return real.withWorld(run, townId);
      },
      withJoinLock: (run) => real.withJoinLock(run),
      markMessageRead: (id, playerId) => real.markMessageRead(id, playerId),
      deleteMessage: (id, playerId) => real.deleteMessage(id, playerId),
      pruneJournal: (townId, chronicleBefore, messagesBefore) =>
        real.pruneJournal(townId, chronicleBefore, messagesBefore),
      close: () => real.close(),
    };
    const harness = await start({ worlds });

    // Act
    const response = await join(harness);
    const body = (await response.json()) as { townId: number };

    // Assert: the join founds a town instead of failing.
    expect(response.status).toBe(201);
    expect(body.townId).not.toBe(split.id);
  });

  it('founds a second town when no town has a free place', async () => {
    // Arrange: a town at the cap, its only human person taken.
    const harness = await start();
    const base = fillTown(town(7));
    await harness.worlds.createTown(TEST_TOWN.name, base, new Date());
    await boundAccount(harness);

    // Act
    const response = await join(harness);
    const body = (await response.json()) as { townId: number; personId: number };

    // Assert: a new town with its own first person, the full one untouched.
    expect(response.status).toBe(201);
    expect(body.townId).not.toBe(TEST_TOWN.id);
    expect((await harness.worlds.listTowns()).map((town) => town.id).sort()).toEqual(
      [TEST_TOWN.id, body.townId].sort(),
    );
    const founded = await harness.worlds.withWorld(async (session) => session.snapshot.world, body.townId);
    expect(founded.people[body.personId]?.ia).toBe(false);
    expect(Object.keys(founded.people)).toHaveLength(Object.keys(town(1).people).length);
    const full = await harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id);
    expect(Object.keys(full.people)).toHaveLength(20);
  });

  it('takes a free place in a town that has one before founding a new one', async () => {
    // Arrange: a town with no place, another with a freed person.
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN.name, fillTown(town(7)), new Date());
    const younger = await harness.worlds.createTown('Jeune', town(8), new Date());
    await boundAccount(harness);

    // Act: the second town's first person has no live token.
    const response = await join(harness);
    const body = (await response.json()) as { townId: number; personId: number };

    // Assert: the place of the younger town, which is where the join landed.
    expect(response.status).toBe(201);
    expect(body.townId).toBe(younger.id);
    const world = await harness.worlds.withWorld(async (session) => session.snapshot.world, younger.id);
    expect(world.people[body.personId]?.name).not.toBe('Leclerc');
  });

  it('takes the least-filled town, not the oldest', async () => {
    // Arrange: an older town full of people with a freed place, a younger and
    // emptier one with a freed place too.
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN.name, fillTown(town(7)), new Date());
    const younger = await harness.worlds.createTown('Jeune', town(8), new Date());

    // Act
    const response = await join(harness);
    const body = (await response.json()) as { townId: number };

    // Assert: the town that needs people most, not the oldest.
    expect(response.status).toBe(201);
    expect(body.townId).toBe(younger.id);
  });

  it('leaves a town whose humans have all gone to the scheduler', async () => {
    // Arrange: a town of AI people only, waiting to be deleted.
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN.name, createWorld(), new Date());

    // Act
    const response = await join(harness);

    // Assert: a new town is founded rather than the dead one kept alive.
    expect(response.status).toBe(201);
    expect(((await response.json()) as { townId: number }).townId).not.toBe(TEST_TOWN.id);
  });

  it('refuses to hand out a token for a world the current rules cannot read', async () => {
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN.name, { ...town(7), rulesetVersion: RULES.version + 1 }, new Date());

    const response = await join(harness);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'world_version', rulesetVersion: RULES.version + 1 });
    expect(cookieOf(response)).toBeUndefined();
  });

  it('opens the first person with the chosen trade', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await join(harness, 'baker');
    const body = (await response.json()) as { token: string };
    const read = await fetch(`${harness.url}/api/world`, {
      headers: { Cookie: `${SESSION_COOKIE}=${body.token}` },
    });
    const world = (await read.json()) as {
      world: { person: { workshops: Array<{ good: string; input: string | null }>; stock: Record<string, number> } };
    };

    // Assert
    expect(response.status).toBe(201);
    expect(read.status).toBe(200);
    expect(world.world.person.workshops).toEqual([
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
    expect(world.world.person.stock.grain).toBe(8);
  });

  it('does not change the trade when a token resumes', async () => {
    // Arrange
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN.name, town(7, 'baker'), new Date());
    const { token } = await boundAccount(harness);

    // Act
    const response = await login(harness, token);
    const read = await fetch(`${harness.url}/api/world`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    const world = (await read.json()) as {
      world: { person: { workshops: Array<{ good: string; input: string | null }> } };
    };

    // Assert
    expect(response.status).toBe(200);
    expect(world.world.person.workshops).toEqual([
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
  it('reads the person back from the cookie alone', async () => {
    const harness = await start();
    const { token } = await boundAccount(harness, 'Herse');
    const opened = await login(harness, token);

    const response = await fetch(`${harness.url}/api/session`, {
      headers: { Cookie: cookiePair(opened) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ townId: TEST_TOWN.id, personId: LECLERC, deletionAfter: null });
  });

  it('clears a dead cookie instead of replaying it', async () => {
    const harness = await start();

    const response = await fetch(`${harness.url}/api/session`, {
      headers: { Cookie: `${SESSION_COOKIE}=bgk_${'x'.repeat(43)}` },
    });

    expect(response.status).toBe(401);
    expect(cookieOf(response)).toContain('Max-Age=0');
  });

  it('schedules the deletion and locks the player out until they come back', async () => {
    // Arrange: the only human of a town, with a token.
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN.name, town(7), new Date());
    const { token, player } = await boundAccount(harness);
    const cookie = `${SESSION_COOKIE}=${token}`;

    // Act: the request schedules, it does not erase.
    const scheduled = await fetch(`${harness.url}/api/player/deletion`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const body = (await scheduled.json()) as { deleteAfter: string };
    const read = await fetch(`${harness.url}/api/world`, { headers: { Cookie: cookie } });
    const actions = await fetch(`${harness.url}/api/actions`, { headers: { Cookie: cookie } });
    const session = await fetch(`${harness.url}/api/session`, { headers: { Cookie: cookie } });

    // Assert: a week of grace, the town is closed, the token still opens a
    // session, and the row is still there.
    expect(scheduled.status).toBe(200);
    expect(new Date(body.deleteAfter).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * HOUR);
    expect(read.status).toBe(409);
    expect(await read.json()).toEqual({ error: 'deletion_pending', deleteAfter: body.deleteAfter });
    expect(actions.status).toBe(409);
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ deletionAfter: body.deleteAfter });
    expect(await login(harness, token)).toMatchObject({ status: 200 });
    expect(await harness.store.listByTown(TEST_TOWN.id)).toHaveLength(1);

    // Act: coming back calls it off.
    const cancelled = await fetch(`${harness.url}/api/player/deletion`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    const again = await fetch(`${harness.url}/api/world`, { headers: { Cookie: cookie } });

    // Assert
    expect(cancelled.status).toBe(204);
    expect(again.status).toBe(200);
    expect((await harness.store.findByTokenHash(player.tokenHash))?.deleteAfter).toBeNull();
  });

  it('refuses a token whose deletion deadline has passed', async () => {
    // Arrange: the week is over; the scheduler has not purged yet.
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN.name, town(7), new Date());
    const { token, player } = await boundAccount(harness);
    await harness.store.markDeletion(player.tokenHash, new Date(Date.now() - HOUR));
    const cookie = `${SESSION_COOKIE}=${token}`;

    // Act
    const session = await fetch(`${harness.url}/api/session`, { headers: { Cookie: cookie } });
    const read = await fetch(`${harness.url}/api/world`, { headers: { Cookie: cookie } });

    // Assert: both refuse and clear the dead cookie.
    expect(session.status).toBe(401);
    expect(cookieOf(session)).toContain('Max-Age=0');
    expect(read.status).toBe(401);
  });

  it('drops Secure only when the server is explicitly told to', async () => {
    const harness = await start({ secureCookies: false });
    const { token } = await boundAccount(harness);

    const response = await login(harness, token);

    expect(cookieOf(response)).not.toContain('Secure');
  });
});

describe('a token a reset left without a person', () => {
  it('answers its session without a person, and keeps the token', async () => {
    // Arrange
    const harness = await start();
    const { cookie } = await afterReset(harness);

    // Act
    const response = await fetch(`${harness.url}/api/session`, { headers: { Cookie: cookie } });

    // Assert: the account is known, the person is not there yet.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ townId: null, personId: null, deletionAfter: null });
  });

  it('reads nothing and writes nothing until the trade is chosen', async () => {
    // Arrange: a town that a person-less account could reach if a read bound it.
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN.name, town(7), new Date());
    const { cookie } = await afterReset(harness);
    const before = await harness.worlds.withWorld(async (session) => stateHash(session.snapshot.world), TEST_TOWN.id);

    // Act
    const world = await fetch(`${harness.url}/api/world`, { headers: { Cookie: cookie } });
    const actions = await fetch(`${harness.url}/api/actions`, { headers: { Cookie: cookie } });

    // Assert: a named refusal, not a 500, and the town is exactly as it was.
    expect(world.status).toBe(409);
    expect(await world.json()).toEqual({ error: 'dynasty_lost' });
    expect(actions.status).toBe(409);
    const after = await harness.worlds.withWorld(async (session) => stateHash(session.snapshot.world), TEST_TOWN.id);
    expect(after).toBe(before);
  });

  it('founds a town with the trade chosen now, and returns no new token', async () => {
    // Arrange
    const harness = await start();
    const { token, player, cookie } = await afterReset(harness);

    // Act: the trade is the explicit choice, not the lost person's.
    const response = await choose(harness, 'baker', cookie);
    const body = (await response.json()) as { townId: number; personId: number; token?: string };

    // Assert: a new town whose first person is the returning account's.
    expect(response.status).toBe(200);
    expect(body.token).toBeUndefined();
    const towns = await harness.worlds.listTowns();
    expect(towns).toHaveLength(1);
    expect(body.townId).toBe(towns[0]?.id);
    const world = await harness.worlds.withWorld(async (session) => session.snapshot.world, body.townId);
    expect(world.people[body.personId]?.ia).toBe(false);
    expect(world.people[body.personId]?.workshops[0]?.trade).toBe('baker');

    // The identity is the same, and the token still opens it.
    const found = await harness.store.findByTokenHash(player.tokenHash);
    expect(found?.playerId).toBe(player.playerId);
    expect(found?.personId).toBe(body.personId);
    const again = await login(harness, token);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ townId: body.townId, personId: body.personId });
  });

  it('gives a returning account a person of its own when the town has none bound', async () => {
    // Arrange: a town whose first person no account holds.
    const harness = await start();
    await harness.worlds.createTown(TEST_TOWN.name, town(7), new Date());
    const { cookie } = await afterReset(harness);

    // Act
    const response = await choose(harness, 'carpenter', cookie);
    const body = (await response.json()) as { townId: number; personId: number };

    // Assert: the account gets a person of its own, and one is added.
    expect(response.status).toBe(200);
    expect(body.townId).toBe(TEST_TOWN.id);
    expect(body.personId).not.toBe(LECLERC);
    const world = await harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id);
    expect(Object.keys(world.people)).toHaveLength(Object.keys(town(7).people).length + 1);
  });

  it('binds a double tap once, without spending a second place', async () => {
    // Arrange
    const harness = await start();
    const { player, cookie } = await afterReset(harness);

    // Act: two choices in flight at once, as a fast double tap sends them.
    const responses = await Promise.all([choose(harness, 'baker', cookie), choose(harness, 'weaver', cookie)]);

    // Assert: both answer, one town, one human person, one binding.
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await harness.worlds.listTowns()).toHaveLength(1);
    const found = await harness.store.findByTokenHash(player.tokenHash);
    expect(found?.personId).not.toBeNull();
    const world = await harness.worlds.withWorld(async (session) => session.snapshot.world, found?.townId as number);
    const humans = Object.values(world.people).filter((person) => !person.ia);
    expect(humans).toHaveLength(1);
  });

  it('keeps a scheduled deletion across the reset, then re-binds once it is called off', async () => {
    // Arrange: the week the player asked for crossed the reset.
    const harness = await start();
    const { player, cookie } = await afterReset(harness);
    await harness.store.markDeletion(player.tokenHash, new Date(Date.now() + HOUR));

    // Act: the choice is refused while the account is closing.
    const refused = await choose(harness, 'baker', cookie);

    // Assert
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'deletion_pending' });

    // Act: the player comes back, then chooses.
    const cancelled = await fetch(`${harness.url}/api/player/deletion`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    const rebound = await choose(harness, 'baker', cookie);

    // Assert
    expect(cancelled.status).toBe(204);
    expect(rebound.status).toBe(200);
    expect(await harness.store.findByTokenHash(player.tokenHash)).toMatchObject({ deleteAfter: null });
  });

  it('refuses the choice once the deletion deadline has passed', async () => {
    // Arrange
    const harness = await start();
    const { player, cookie } = await afterReset(harness);
    await harness.store.markDeletion(player.tokenHash, new Date(Date.now() - HOUR));

    // Act
    const response = await choose(harness, 'baker', cookie);

    // Assert: the account is gone, and the dead cookie is cleared.
    expect(response.status).toBe(401);
    expect(cookieOf(response)).toContain('Max-Age=0');
  });
});

describe('the logs', () => {
  it('never contain a token, whether it was accepted, unknown or erased', async () => {
    const harness = await start();
    const { token, player } = await boundAccount(harness);

    await login(harness, token);
    await login(harness, `bgk_${'x'.repeat(43)}`);
    await harness.store.deleteAccount(player.playerId);
    await login(harness, token);

    const lines = harness.logs.join('\n');

    expect(lines).toContain('session.opened');
    expect(lines).toContain('session.refused');
    expect(lines).not.toContain(token);
  });
});

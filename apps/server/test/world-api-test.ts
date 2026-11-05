import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorld, FORMAT_VERSION, hashJson, RULES, stateHash, type World } from '@brigue/core';

import { SESSION_COOKIE } from '../src/cookies.ts';
import { createApp } from '../src/http.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryPlayerStore } from '../src/players.ts';
import { issueToken } from '../src/session.ts';
import { MemoryWorldStore, WORLD_ID } from '../src/worlds.ts';

const START = new Date('2026-10-31T12:00:00.000Z').getTime();
const HOUR = 60 * 60 * 1000;
const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';

interface Harness {
  url: string;
  store: MemoryPlayerStore;
  worlds: MemoryWorldStore;
  logs: string[];
  clock: { now: number };
  cookie: string;
  cookies: Record<string, string>;
}

interface WorldBody {
  world: {
    week: number;
    year: number;
    house: { id: string; stock: Record<string, number>; favour: number };
    town: { houses: Array<Record<string, unknown>> };
    nextTickAt: string;
  };
  events: Array<Record<string, unknown> & { type: string; houseId?: string; units?: number }>;
  summary: {
    weeksPlayed: number;
    skippedWeeks: number;
    counts: Record<string, number>;
    refusals: Record<string, number>;
  };
  stateHash: string;
  dev?: boolean;
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

async function start(
  options: { world?: World; at?: number; devAdvance?: boolean; houses?: string[] } = {},
): Promise<Harness> {
  const clock = { now: options.at ?? START };
  const store = new MemoryPlayerStore();
  const worlds = new MemoryWorldStore();
  const logs: string[] = [];
  const logger = createLogger((line) => logs.push(line));
  const server = createApp({
    store,
    worlds,
    logger,
    ready: async () => {},
    now: () => clock.now,
    devAdvance: options.devAdvance,
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  running.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const world = options.world ?? createWorld(20261031);
  await worlds.createIfAbsent(world, new Date(clock.now), new Date(clock.now));

  const houses = options.houses ?? ['brigue'];
  const cookies: Record<string, string> = {};
  for (const houseId of houses) {
    const { token } = await issueToken(store, WORLD_ID, houseId, new Date(clock.now));
    cookies[houseId] = `${SESSION_COOKIE}=${token}`;
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    store,
    worlds,
    logs,
    clock,
    cookies,
    cookie: cookies[houses[0] as string] as string,
  };
}

function getWorld(harness: Harness): Promise<Response> {
  return fetch(`${harness.url}/api/world`, { headers: { Cookie: harness.cookie } });
}

function getWorldAs(harness: Harness, houseId: string): Promise<Response> {
  return fetch(`${harness.url}/api/world`, { headers: { Cookie: harness.cookies[houseId] as string } });
}

async function worldBody(harness: Harness): Promise<WorldBody> {
  const response = await getWorld(harness);

  expect(response.status).toBe(200);

  return (await response.json()) as WorldBody;
}

async function worldBodyAs(harness: Harness, houseId: string): Promise<WorldBody> {
  const response = await getWorldAs(harness, houseId);

  expect(response.status).toBe(200);

  return (await response.json()) as WorldBody;
}

function postAction(harness: Harness, body: unknown): Promise<Response> {
  return postActionAs(harness, 'brigue', body);
}

function postActionAs(harness: Harness, houseId: string, body: unknown): Promise<Response> {
  return fetch(`${harness.url}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: harness.cookies[houseId] as string },
    body: JSON.stringify(body),
  });
}

function getPending(harness: Harness, houseId = 'brigue'): Promise<Response> {
  return fetch(`${harness.url}/api/actions`, { headers: { Cookie: harness.cookies[houseId] as string } });
}

function cancelPending(harness: Harness, id: string, houseId = 'brigue'): Promise<Response> {
  return fetch(`${harness.url}/api/actions/${id}`, {
    method: 'DELETE',
    headers: { Cookie: harness.cookies[houseId] as string },
  });
}

function buyWool(id: string, week: number, units: number, extra: Record<string, unknown> = {}): unknown {
  return { id, week, action: { type: 'market.buy', good: 'wool', units, ...extra } };
}

function sellWool(id: string, week: number, units: number): unknown {
  return { id, week, action: { type: 'market.sell', good: 'wool', units } };
}

describe('GET /api/world', () => {
  it('refuses without a session', async () => {
    const harness = await start();

    const response = await fetch(`${harness.url}/api/world`);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
  });

  it('returns the same state hash twice when no time passed', async () => {
    // Arrange
    const harness = await start();

    // Act
    const first = await worldBody(harness);
    const second = await worldBody(harness);

    // Assert
    expect(first.stateHash).toBe(second.stateHash);
    expect(first.events).toEqual(second.events);
    expect(first.world.week).toBe(1);
  });

  it('catches a month up in one request and summarises the rest', async () => {
    // Arrange
    const harness = await start();
    harness.clock.now += 30 * 24 * HOUR;

    // Act
    const body = await worldBody(harness);

    // Assert
    expect(body.summary.weeksPlayed).toBe(720);
    expect(body.summary.skippedWeeks).toBe(0);
    expect(body.world.week).toBe(721);
    expect(body.events.length).toBeLessThan(100);
    expect(body.summary.counts['market.sold']).toBeGreaterThan(0);
  });

  it('keeps the last week on the following read that has nothing to play', async () => {
    // Arrange
    const harness = await start();
    harness.clock.now += HOUR;
    const first = await worldBody(harness);

    // Act
    const second = await worldBody(harness);

    // Assert
    expect(first.summary.weeksPlayed).toBe(1);
    expect(first.events.length).toBeGreaterThan(0);
    expect(second.events).toEqual(first.events);
    expect(second.stateHash).toBe(first.stateHash);
  });

  it('answers a wrong world version clearly, without replaying', async () => {
    // Arrange
    const world = { ...createWorld(7), rulesetVersion: RULES.version + 1 };
    const harness = await start({ world });
    const before = stateHash(world);
    harness.clock.now += 2 * HOUR;

    // Act
    const response = await getWorld(harness);

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'world_version',
      formatVersion: world.formatVersion,
      rulesetVersion: RULES.version + 1,
      expected: { formatVersion: world.formatVersion, rulesetVersion: RULES.version },
    });
    const after = await harness.worlds.withWorld(async (session) => session.snapshot.world);
    expect(stateHash(after)).toBe(before);
    expect(after.week).toBe(1);
  });

  it('refuses a world of the previous format at the door', async () => {
    // Arrange: a format-1 world is refused before any replay.
    const world = { ...createWorld(7), formatVersion: 1 };
    const harness = await start({ world });
    const before = stateHash(world);
    harness.clock.now += 2 * HOUR;

    // Act
    const response = await getWorld(harness);

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'world_version',
      formatVersion: 1,
      rulesetVersion: RULES.version,
      expected: { formatVersion: FORMAT_VERSION, rulesetVersion: RULES.version },
    });
    const after = await harness.worlds.withWorld(async (session) => session.snapshot.world);
    expect(stateHash(after)).toBe(before);
    expect(after.week).toBe(1);
  });

  it('shows its own house in full, the town without the seed or other purses', async () => {
    // Arrange
    const harness = await start();

    // Act
    const body = await worldBody(harness);
    const serialised = JSON.stringify(body);

    // Assert
    expect(body.world.house.id).toBe('brigue');
    expect(serialised).not.toContain('"seed"');
    expect(serialised).not.toContain('"rng"');
    expect(body.world.town.houses.every((house) => !('treasuryCents' in house))).toBe(true);
    expect(new Date(body.world.nextTickAt).getTime()).toBe(START + HOUR);
    // The hash covers the projection, not the seed-bearing world.
    expect(body.stateHash).toBe(hashJson(body.world));
  });

  it('returns a house its own ledger and not another house’s', async () => {
    // Arrange: both houses read the same last week, so the second read is
    // served from the stored events of the first.
    const world = createWorld(20261031);
    world.houses.caron.controller = 'human';
    const harness = await start({ world, houses: ['brigue', 'caron'] });
    harness.clock.now += HOUR;

    // Act
    const brigue = await worldBodyAs(harness, 'brigue');
    const caron = await worldBodyAs(harness, 'caron');

    // Assert
    const wagesOf = (body: WorldBody, houseId: string) =>
      body.events.filter((event) => event.type === 'house.wages_paid' && event.houseId === houseId);

    expect(wagesOf(brigue, 'brigue').length).toBeGreaterThan(0);
    expect(wagesOf(brigue, 'caron')).toEqual([]);
    expect(wagesOf(caron, 'caron').length).toBeGreaterThan(0);
    expect(wagesOf(caron, 'brigue')).toEqual([]);
  });

  it('projects and ticks a town of twenty houses', async () => {
    // Arrange
    const base = createWorld(20261031);
    const world: World = { ...base, houses: { ...base.houses }, people: { ...base.people } };
    for (let index = Object.keys(world.houses).length + 1; index <= 20; index += 1) {
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
    const harness = await start({ world });

    // Act
    const first = await worldBody(harness);
    harness.clock.now += HOUR;
    const next = await worldBody(harness);

    // Assert
    expect(first.world.town.houses).toHaveLength(20);
    expect(next.world.week).toBe(2);
  });
});

describe('POST /api/actions', () => {
  it('refuses without a session', async () => {
    const harness = await start();

    const response = await fetch(`${harness.url}/api/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(401);
  });

  it('queues an action for the current week and applies it before the tick', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, buyWool(ID_A, 1, 2));
    harness.clock.now += HOUR;
    const body = await worldBody(harness);

    // Assert
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: ID_A, week: 1, houseId: 'brigue' });
    expect(body.events[0]).toMatchObject({
      type: 'market.bought',
      houseId: 'brigue',
      good: 'wool',
      units: 2,
      priceCents: 380,
      totalCents: 760,
    });
    expect(body.world.house.stock.wool).toBe(6);
  });

  it("queues a sale at the week's price", async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, sellWool(ID_A, 1, 2));
    harness.clock.now += HOUR;
    const body = await worldBody(harness);

    // Assert: two of the eight wool are sold, four are woven, two remain.
    expect(response.status).toBe(201);
    expect(body.events).toContainEqual(
      expect.objectContaining({ type: 'market.sold', houseId: 'brigue', good: 'wool', units: 2, priceCents: 380 }),
    );
    expect(body.world.house.stock.wool).toBe(2);
  });

  it('refuses a replayed request and applies it once', async () => {
    // Arrange
    const harness = await start();
    const submitted = buyWool(ID_A, 1, 2);

    // Act
    const first = await postAction(harness, submitted);
    const replay = await postAction(harness, submitted);
    harness.clock.now += HOUR;
    const body = await worldBody(harness);

    // Assert
    expect(first.status).toBe(201);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'duplicate_action' });
    expect(body.events.filter((event) => event.type === 'market.bought' && event.units === 2)).toHaveLength(1);
  });

  it('refuses a retry once the week it belonged to has been played', async () => {
    // Arrange
    const harness = await start();
    const submitted = buyWool(ID_A, 1, 2);
    await postAction(harness, submitted);
    harness.clock.now += HOUR;
    const applied = await worldBody(harness);

    // Act
    const replay = await postAction(harness, submitted);
    const body = await worldBody(harness);

    // Assert
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'stale_week', currentWeek: 2 });
    expect(body.events).toEqual(applied.events);
    expect(body.stateHash).toBe(applied.stateHash);
    expect(body.summary.weeksPlayed).toBe(0);
    expect(body.events.filter((event) => event.type === 'market.bought' && event.units === 2)).toHaveLength(1);
  });

  it('refuses a week that has already been played', async () => {
    // Arrange
    const harness = await start();
    harness.clock.now += 2 * HOUR;
    await worldBody(harness);

    // Act
    const response = await postAction(harness, buyWool(ID_A, 1, 1));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'stale_week', currentWeek: 3 });
  });

  it('refuses a week too far ahead of the town clock', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, buyWool(ID_A, 10, 1));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'future_week', currentWeek: 1 });
  });

  it('refuses a week the catch-up cap will not reach', async () => {
    // Arrange: a world well over a month behind, so catch-up will skip.
    const harness = await start();
    harness.clock.now += 1000 * HOUR;

    // Act: a GET would land on week 745, not week 1001.
    const response = await postAction(harness, buyWool(ID_A, 1000, 1));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'future_week', currentWeek: 745 });
  });

  it('accepts the next week when the client read just before the hour turned', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, buyWool(ID_A, 2, 3));
    harness.clock.now += 2 * HOUR;
    const body = await worldBody(harness);

    // Assert
    expect(response.status).toBe(201);
    expect(body.events[0]).toMatchObject({ type: 'market.bought', units: 3 });
    // The first week still counts only the three AI purchases; the queued
    // action belongs to the second week and is not applied early.
    expect(body.summary.counts['market.bought']).toBe(3);
  });

  it('never takes the house from the body', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, buyWool(ID_A, 1, 1, { houseId: 'caron' }));
    harness.clock.now += HOUR;
    const body = await worldBody(harness);

    // Assert
    expect(response.status).toBe(201);
    expect(body.events[0]).toMatchObject({ type: 'market.bought', houseId: 'brigue' });
  });

  it('refuses an action on a world whose rules changed', async () => {
    // Arrange
    const world = { ...createWorld(7), rulesetVersion: RULES.version + 1 };
    const harness = await start({ world });

    // Act
    const response = await postAction(harness, buyWool(ID_A, 1, 1));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'world_version' });
    expect(await harness.worlds.withWorld(async (session) => session.findAction(ID_A))).toBeNull();
  });

  it('rejects a malformed action before it reaches the world', async () => {
    // Arrange
    const harness = await start();
    const invalid = [
      { week: 1, action: { type: 'market.buy', good: 'wool', units: 1 } },
      { id: 'nope', week: 1, action: { type: 'market.buy', good: 'wool', units: 1 } },
      { id: ID_A, week: 0, action: { type: 'market.buy', good: 'wool', units: 1 } },
      { id: ID_A, week: 1, action: { type: 'market.buy', good: 'silk', units: 1 } },
      { id: ID_A, week: 1, action: { type: 'market.buy', good: 'wool', units: 0 } },
      { id: ID_A, week: 1, action: { type: 'market.sell', good: 'silk', units: 1 } },
      { id: ID_A, week: 1, action: { type: 'market.sell', good: 'wool', units: 0 } },
      { id: ID_A, week: 1, action: { type: 'council.campaign', seatId: 'roi' } },
      { id: ID_A, week: 1, action: { type: 'market.short', good: 'wool', units: 1 } },
    ];

    // Act
    const responses = await Promise.all(invalid.map((body) => postAction(harness, body)));

    // Assert
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_action' });
    }
  });
});

describe('the queued actions', () => {
  it('lists and cancels an action before its week ticks', async () => {
    // Arrange
    const harness = await start();
    const empty = await getPending(harness);
    expect(await empty.json()).toEqual({ actions: [] });
    await postAction(harness, buyWool(ID_A, 1, 2));

    // Act
    const listed = await getPending(harness);
    const cancelled = await cancelPending(harness, ID_A);
    harness.clock.now += HOUR;
    const body = await worldBody(harness);

    // Assert
    expect(await listed.json()).toEqual({
      actions: [{ id: ID_A, week: 1, type: 'market.buy', good: 'wool', units: 2 }],
    });
    expect(cancelled.status).toBe(204);
    expect(await (await getPending(harness)).json()).toEqual({ actions: [] });
    // The cancelled buy was not applied: eight wool less the four woven.
    expect(body.world.house.stock.wool).toBe(4);
  });

  it('keeps the cancelled row as a duplicate', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 1, 2));
    await cancelPending(harness, ID_A);

    // Act
    const retry = await postAction(harness, buyWool(ID_A, 1, 2));

    // Assert
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: 'duplicate_action' });
  });

  it('is idempotent', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 1, 2));

    // Act and assert
    expect((await cancelPending(harness, ID_A)).status).toBe(204);
    expect((await cancelPending(harness, ID_A)).status).toBe(204);
  });

  it('keeps a cancellation already won even after the week ticks', async () => {
    // Arrange: cancel, then let the world catch up over the action's week.
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 1, 2));
    await cancelPending(harness, ID_A);
    harness.clock.now += HOUR;
    const warmed = await worldBody(harness);

    // Act
    const again = await cancelPending(harness, ID_A);

    // Assert: the retry is a no-op, not a stale refusal.
    expect(again.status).toBe(204);
    expect((await worldBody(harness)).stateHash).toBe(warmed.stateHash);
  });

  it('refuses a cancellation once the week has ticked', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 1, 2));
    harness.clock.now += HOUR;
    const applied = await worldBody(harness);

    // Act
    const response = await cancelPending(harness, ID_A);

    // Assert: the buy was applied (eight plus two, less four woven).
    expect(applied.world.house.stock.wool).toBe(6);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'stale_week', currentWeek: 2 });
  });

  it("does not cancel another house's action", async () => {
    // Arrange
    const harness = await start({ houses: ['brigue', 'caron'] });
    await postActionAs(harness, 'caron', buyWool(ID_A, 1, 2));

    // Act
    const foreign = await cancelPending(harness, ID_A, 'brigue');
    const own = await cancelPending(harness, ID_A, 'caron');

    // Assert
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: 'unknown_action' });
    expect(own.status).toBe(204);
  });

  it('lists and cancels a campaign', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, { id: ID_A, week: 1, action: { type: 'council.campaign', seatId: 'maire' } });
    const listed = (await (await getPending(harness)).json()) as {
      actions: Array<{ type: string; seatId?: string }>;
    };

    // Act
    await cancelPending(harness, ID_A);
    harness.clock.now += HOUR;
    const body = await worldBody(harness);

    // Assert: no favour was spent and no campaign was queued.
    expect(listed.actions).toContainEqual(expect.objectContaining({ type: 'council.campaign', seatId: 'maire' }));
    expect(body.world.house.favour).toBe(50);
  });

  it('lists an action queued for the next week', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 2, 2));

    // Act
    const listed = (await (await getPending(harness)).json()) as {
      actions: Array<{ id: string; week: number }>;
    };

    // Assert
    expect(listed.actions).toContainEqual(expect.objectContaining({ id: ID_A, week: 2 }));
  });

  it('refuses an unknown or malformed id', async () => {
    // Arrange
    const harness = await start();

    // Act
    const unknown = await cancelPending(harness, ID_B);
    const malformed = await cancelPending(harness, 'not-a-uuid');

    // Assert
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'unknown_action' });
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({ error: 'unknown_action' });
  });

  it('refuses without a session', async () => {
    const harness = await start();

    const list = await fetch(`${harness.url}/api/actions`);
    const cancel = await fetch(`${harness.url}/api/actions/${ID_A}`, { method: 'DELETE' });

    expect(list.status).toBe(401);
    expect(cancel.status).toBe(401);
  });
});

describe('POST /api/dev/advance', () => {
  function postAdvance(harness: Harness, init: RequestInit = {}): Promise<Response> {
    return fetch(`${harness.url}/api/dev/advance`, {
      method: 'POST',
      headers: { Cookie: harness.cookie },
      ...init,
    });
  }

  it('does not exist unless the server was started for development', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAdvance(harness);

    // Assert
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('advertises development in the world payload only when it is on', async () => {
    // Arrange
    const regular = await start();
    const development = await start({ devAdvance: true });

    // Act
    const plainBody = await worldBody(regular);
    const devBody = await worldBody(development);

    // Assert
    expect(plainBody.dev).toBeUndefined();
    expect(devBody.dev).toBe(true);
    // Same world, same clock: the flag must not reach the hash.
    expect(devBody.stateHash).toBe(plainBody.stateHash);
  });

  it('plays exactly one week and leaves the next natural tick an hour away', async () => {
    // Arrange
    const harness = await start({ devAdvance: true });
    const before = await worldBody(harness);

    // Act
    const response = await postAdvance(harness);
    const after = (await response.json()) as WorldBody;

    // Assert
    expect(response.status).toBe(200);
    expect(after.world.week).toBe(before.world.week + 1);
    expect(new Date(after.world.nextTickAt).getTime()).toBe(harness.clock.now + HOUR);
    expect(after.dev).toBe(true);
  });

  it('does not advance again on a plain read, and the hashes agree', async () => {
    // Arrange
    const harness = await start({ devAdvance: true });
    const advanced = (await (await postAdvance(harness)).json()) as WorldBody;

    // Act
    const read = await worldBody(harness);

    // Assert
    expect(read.world.week).toBe(advanced.world.week);
    expect(read.stateHash).toBe(advanced.stateHash);
  });

  it('applies the action queued for the week it plays', async () => {
    // Arrange
    const harness = await start({ devAdvance: true });
    const before = await worldBody(harness);
    await postAction(harness, buyWool(ID_A, before.world.week, 10));

    // Act
    const advanced = (await (await postAdvance(harness)).json()) as WorldBody;

    // Assert
    expect(advanced.events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', houseId: 'brigue', units: 10 }),
    );
  });

  it('advances twice in a row', async () => {
    // Arrange
    const harness = await start({ devAdvance: true });
    const before = await worldBody(harness);

    // Act
    await postAdvance(harness);
    const second = (await (await postAdvance(harness)).json()) as WorldBody;

    // Assert
    expect(second.world.week).toBe(before.world.week + 2);
  });

  it('refuses without a session', async () => {
    // Arrange
    const harness = await start({ devAdvance: true });

    // Act
    const response = await fetch(`${harness.url}/api/dev/advance`, { method: 'POST' });

    // Assert
    expect(response.status).toBe(401);
  });

  it('refuses anything but POST', async () => {
    // Arrange
    const harness = await start({ devAdvance: true });

    // Act
    const response = await fetch(`${harness.url}/api/dev/advance`, { headers: { Cookie: harness.cookie } });

    // Assert
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

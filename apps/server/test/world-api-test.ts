import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { FORMAT_VERSION, hashJson, PACING, RULES, stateHash, WorldVersionError, type World } from '@brigue/core';

import { SESSION_COOKIE } from '../src/cookies.ts';
import { createApp } from '../src/http.ts';
import { createLogger } from '../src/logger.ts';
import { playDue } from '../src/scheduler.ts';
import { MemoryPlayerStore } from '../src/players.ts';
import { issueToken } from '../src/session.ts';
import { MemoryWorldStore } from '../src/worlds.ts';
import { TEST_TOWN, town } from './helpers.ts';

const START = new Date('2026-10-31T12:00:00.000Z').getTime();
const HOUR = 60 * 60 * 1000;
const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';

interface Harness {
  url: string;
  /** Moves the clock and plays the hours the scheduler would, as the loop does. */
  advance(ms: number): Promise<void>;
  /** Moves the clock without playing: a scheduler that never ran. */
  lapse(ms: number): Promise<void>;
  store: MemoryPlayerStore;
  worlds: MemoryWorldStore;
  logs: string[];
  clock: { now: number };
  cookie: string;
  cookies: Record<string, string>;
}

interface WorldBody {
  world: {
    hour: number;
    year: number;
    house: { id: string; stock: Record<string, number>; favour: number };
    town: { houses: Array<Record<string, unknown>> };
    nextBellAt: string;
  };
  events: Array<Record<string, unknown> & { type: string; houseId?: string; units?: number }>;
  summary: {
    hours: number;
    skipped: number;
    counts: Partial<Record<string, number>>;
    refusals: Partial<Record<string, number>>;
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

  const world = options.world ?? town(20261031);
  await worlds.createTown(TEST_TOWN, world, new Date(clock.now));

  const houses = options.houses ?? ['leclerc'];
  const cookies: Record<string, string> = {};
  for (const houseId of houses) {
    const { token } = await issueToken(store, TEST_TOWN.id, houseId, new Date(clock.now));
    cookies[houseId] = `${SESSION_COOKIE}=${token}`;
  }

  // The scheduler's pass, minus the timer: what the loop would do on its own.
  const play = async (): Promise<void> => {
    try {
      const hour = await worlds.withWorld(async (session) => {
        const due = await playDue(session, session.snapshot, new Date(clock.now));
        if (due.hours > 0) {
          await session.save(due.world, due.hourStartedAt, due.events);
        }

        return due.world.hour;
      }, TEST_TOWN.id);
      await worlds.pruneJournal(TEST_TOWN.id, hour - PACING.journalRetentionHours);
    } catch (error) {
      // The loop logs a refused world and leaves it for the reader to report.
      if (!(error instanceof WorldVersionError)) {
        throw error;
      }
    }
  };

  return {
    url: `http://127.0.0.1:${address.port}`,
    advance: async (ms: number) => {
      clock.now += ms;
      await play();
    },
    lapse: async (ms: number) => {
      clock.now += ms;
    },
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
  return postActionAs(harness, 'leclerc', body);
}

function postActionAs(harness: Harness, houseId: string, body: unknown): Promise<Response> {
  return fetch(`${harness.url}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: harness.cookies[houseId] as string },
    body: JSON.stringify(body),
  });
}

function getPending(harness: Harness, houseId = 'leclerc'): Promise<Response> {
  return fetch(`${harness.url}/api/actions`, { headers: { Cookie: harness.cookies[houseId] as string } });
}

function cancelPending(harness: Harness, id: string, houseId = 'leclerc'): Promise<Response> {
  return fetch(`${harness.url}/api/actions/${id}`, {
    method: 'DELETE',
    headers: { Cookie: harness.cookies[houseId] as string },
  });
}

function buyWool(id: string, hour: number, units: number, extra: Record<string, unknown> = {}): unknown {
  return { id, hour, action: { type: 'market.buy', good: 'wool', units, ...extra } };
}

function sellWool(id: string, hour: number, units: number): unknown {
  return { id, hour, action: { type: 'market.sell', good: 'wool', units } };
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
    expect(first.world.hour).toBe(1);
  });

  it('catches a month up when the scheduler never ran, and counts what it left behind', async () => {
    // Arrange: the loop is down; a visit is the only thing that wakes the town.
    const harness = await start();
    await harness.lapse(30 * 24 * HOUR);

    // Act
    const body = await worldBody(harness);

    // Assert
    expect(body.summary.hours).toBe(720);
    expect(body.summary.skipped).toBe(0);
    expect(body.world.hour).toBe(721);
    // The page is the newest fifty, in time order, up to the last hour lived.
    expect(body.events).toHaveLength(50);
    expect(Number(body.events.at(-1)?.at)).toBe(720);
    // The rest is counted, not sent.
    expect(body.summary.counts['market.bought']).toBeGreaterThan(50);
  });

  it('keeps the last hour on the following read that has nothing to play', async () => {
    // Arrange: the read is the backstop and only wakes a town more than an
    // hour behind, so the loop must have missed two.
    const harness = await start();
    await harness.lapse(2 * HOUR);
    const first = await worldBody(harness);

    // Act
    const second = await worldBody(harness);

    // Assert: the cursor consumed the page; the hours are neither played nor
    // shown twice.
    expect(first.summary.hours).toBe(2);
    expect(first.events.length).toBeGreaterThan(0);
    expect(second.events).toEqual([]);
    expect(second.summary.hours).toBe(0);
    expect(second.summary.counts).toEqual({});
    expect(second.stateHash).toBe(first.stateHash);
  });

  it('shows the newest page and forgets what it counted', async () => {
    // Arrange: a month of entries, far more than one page.
    const harness = await start();
    await harness.lapse(30 * 24 * HOUR);
    const first = await worldBody(harness);

    // Act
    const second = await worldBody(harness);

    // Assert: the cursor jumped to the newest entry, so the counted entries
    // are never shown again, and a second read has nothing left.
    expect(first.events).toHaveLength(50);
    expect(second.events).toEqual([]);
    expect(second.summary.hours).toBe(0);
    expect(second.summary.counts).toEqual({});
  });

  it('leaves a town one hour behind to the scheduler', async () => {
    // Arrange: the loop is down for a single hour.
    const harness = await start();
    await harness.lapse(HOUR);

    // Act: a read may leave that hour to the loop.
    const lazy = await worldBody(harness);

    // Assert
    expect(lazy.summary.hours).toBe(0);
    expect(lazy.world.hour).toBe(1);

    // Act: two more hours pass without the loop.
    await harness.lapse(2 * HOUR);
    const awake = await worldBody(harness);

    // Assert: the read is the backstop, and plays the whole backlog.
    expect(awake.summary.hours).toBe(3);
    expect(awake.world.hour).toBe(4);
  });

  it('answers a wrong world version clearly, without replaying', async () => {
    // Arrange
    const world = { ...town(7), rulesetVersion: RULES.version + 1 };
    const harness = await start({ world });
    const before = stateHash(world);
    await harness.advance(2 * HOUR);

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
    const after = await harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id);
    expect(stateHash(after)).toBe(before);
    expect(after.hour).toBe(1);
  });

  it('refuses a world of the previous format at the door', async () => {
    // Arrange: format 2 is what this build replaced; it is refused before any
    // replay, so the town is never read through the wrong shape.
    const world = { ...town(7), formatVersion: 2 };
    const harness = await start({ world });
    const before = stateHash(world);
    await harness.advance(2 * HOUR);

    // Act
    const response = await getWorld(harness);

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'world_version',
      formatVersion: 2,
      rulesetVersion: RULES.version,
      expected: { formatVersion: FORMAT_VERSION, rulesetVersion: RULES.version },
    });
    const after = await harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id);
    expect(stateHash(after)).toBe(before);
    expect(after.hour).toBe(1);
  });

  it('shows its own house in full, the town without the seed or other purses', async () => {
    // Arrange
    const harness = await start();

    // Act
    const body = await worldBody(harness);
    const serialised = JSON.stringify(body);

    // Assert
    expect(body.world.house.id).toBe('leclerc');
    expect(serialised).not.toContain('"seed"');
    expect(serialised).not.toContain('"rng"');
    expect(body.world.town.houses.every((house) => !('treasuryCents' in house))).toBe(true);
    expect(new Date(body.world.nextBellAt).getTime()).toBe(START + 12 * HOUR);
    // The hash covers the projection, not the seed-bearing world.
    expect(body.stateHash).toBe(hashJson(body.world));
  });

  it('returns a house its own ledger and not another house’s', async () => {
    // Arrange: both houses read the same last hour, so the second read is
    // served from the stored events of the first.
    const world = town(20261031);
    world.houses.caron.controller = 'human';
    const harness = await start({ world, houses: ['leclerc', 'caron'] });
    await harness.advance(HOUR);

    // Act
    const leclerc = await worldBodyAs(harness, 'leclerc');
    const caron = await worldBodyAs(harness, 'caron');

    // Assert
    const wagesOf = (body: WorldBody, houseId: string) =>
      body.events.filter((event) => event.type === 'house.wages_paid' && event.houseId === houseId);

    expect(wagesOf(leclerc, 'leclerc').length).toBeGreaterThan(0);
    expect(wagesOf(leclerc, 'caron')).toEqual([]);
    expect(wagesOf(caron, 'caron').length).toBeGreaterThan(0);
    expect(wagesOf(caron, 'leclerc')).toEqual([]);
  });

  it('projects and ticks a town of twenty houses', async () => {
    // Arrange
    const base = town(20261031);
    const world: World = { ...base, houses: { ...base.houses }, people: { ...base.people } };
    for (let index = Object.keys(world.houses).length + 1; index <= 20; index += 1) {
      const id = `house-${index}`;
      const personId = `person-${index}`;
      world.houses[id] = {
        ...base.houses.fournier,
        id,
        name: `Maison ${index}`,
        workshops: [{ good: 'grain', level: 1, workers: 1 }],
        stock: {},
      };
      world.people[personId] = {
        ...base.people['person-fournier'],
        id: personId,
        houseId: id,
        name: `Nom ${index}`,
      };
    }
    const harness = await start({ world });

    // Act
    const first = await worldBody(harness);
    await harness.advance(HOUR);
    const next = await worldBody(harness);

    // Assert
    expect(first.world.town.houses).toHaveLength(20);
    expect(next.world.hour).toBe(2);
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

  it('queues an action for the current hour and applies it before the tick', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, buyWool(ID_A, 1, 2));
    await harness.advance(HOUR);
    const body = await worldBody(harness);

    // Assert
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: ID_A, hour: 1, houseId: 'leclerc' });
    expect(body.events[0]).toMatchObject({
      type: 'market.bought',
      houseId: 'leclerc',
      good: 'wool',
      units: 2,
      priceCents: 380,
      totalCents: 760,
    });
    expect(body.world.house.stock.wool).toBe(6);
  });

  it("queues a sale at the hour's price", async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, sellWool(ID_A, 1, 2));
    await harness.advance(HOUR);
    const body = await worldBody(harness);

    // Assert: two of the eight wool are sold, four are woven, two remain.
    expect(response.status).toBe(201);
    expect(body.events).toContainEqual(
      expect.objectContaining({ type: 'market.sold', houseId: 'leclerc', good: 'wool', units: 2, priceCents: 380 }),
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
    await harness.advance(HOUR);
    const body = await worldBody(harness);

    // Assert
    expect(first.status).toBe(201);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'duplicate_action' });
    expect(body.events.filter((event) => event.type === 'market.bought' && event.units === 2)).toHaveLength(1);
  });

  it('refuses a retry once the hour it belonged to has been played', async () => {
    // Arrange
    const harness = await start();
    const submitted = buyWool(ID_A, 1, 2);
    await postAction(harness, submitted);
    await harness.advance(HOUR);
    const applied = await worldBody(harness);

    // Act
    const replay = await postAction(harness, submitted);
    const body = await worldBody(harness);

    // Assert: the hour is not replayed, and the cursor has already consumed
    // the page that carried the first application.
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'stale_hour', currentHour: 2 });
    expect(body.events).toEqual([]);
    expect(body.stateHash).toBe(applied.stateHash);
    expect(body.summary.hours).toBe(0);
    expect(applied.events.filter((event) => event.type === 'market.bought' && event.units === 2)).toHaveLength(1);
  });

  it('refuses a hour that has already been played', async () => {
    // Arrange
    const harness = await start();
    await harness.advance(2 * HOUR);
    await worldBody(harness);

    // Act
    const response = await postAction(harness, buyWool(ID_A, 1, 1));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'stale_hour', currentHour: 3 });
  });

  it('refuses a hour too far ahead of the town clock', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, buyWool(ID_A, 10, 1));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'future_hour', currentHour: 1 });
  });

  it('refuses a hour the catch-up cap will not reach', async () => {
    // Arrange: a world well over a month behind, so catch-up will skip.
    const harness = await start();
    await harness.advance(1000 * HOUR);

    // Act: a GET would land on hour 745, not hour 1001.
    const response = await postAction(harness, buyWool(ID_A, 1000, 1));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'future_hour', currentHour: 745 });
  });

  it('accepts the next hour when the client read just before the hour turned', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, buyWool(ID_A, 2, 3));
    await harness.advance(2 * HOUR);
    const body = await worldBody(harness);

    // Assert
    expect(response.status).toBe(201);
    // The queued action plays on its own hour, not on the one before.
    const buys = body.events.filter((event) => event.type === 'market.bought' && event.houseId === 'leclerc');
    expect(buys).toHaveLength(1);
    expect(buys[0]).toMatchObject({ units: 3, at: 2 });
  });

  it('never takes the house from the body', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, buyWool(ID_A, 1, 1, { houseId: 'caron' }));
    await harness.advance(HOUR);
    const body = await worldBody(harness);

    // Assert
    expect(response.status).toBe(201);
    expect(body.events[0]).toMatchObject({ type: 'market.bought', houseId: 'leclerc' });
  });

  it('refuses an action on a world whose rules changed', async () => {
    // Arrange
    const world = { ...town(7), rulesetVersion: RULES.version + 1 };
    const harness = await start({ world });

    // Act
    const response = await postAction(harness, buyWool(ID_A, 1, 1));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'world_version' });
    expect(await harness.worlds.withWorld(async (session) => session.findAction(ID_A), TEST_TOWN.id)).toBeNull();
  });

  it('rejects a malformed action before it reaches the world', async () => {
    // Arrange
    const harness = await start();
    const invalid = [
      { hour: 1, action: { type: 'market.buy', good: 'wool', units: 1 } },
      { id: 'nope', hour: 1, action: { type: 'market.buy', good: 'wool', units: 1 } },
      { id: ID_A, hour: 0, action: { type: 'market.buy', good: 'wool', units: 1 } },
      { id: ID_A, hour: 1, action: { type: 'market.buy', good: 'silk', units: 1 } },
      { id: ID_A, hour: 1, action: { type: 'market.buy', good: 'wool', units: 0 } },
      { id: ID_A, hour: 1, action: { type: 'market.sell', good: 'silk', units: 1 } },
      { id: ID_A, hour: 1, action: { type: 'market.sell', good: 'wool', units: 0 } },
      { id: ID_A, hour: 1, action: { type: 'council.campaign', seatId: 'roi' } },
      { id: ID_A, hour: 1, action: { type: 'market.short', good: 'wool', units: 1 } },
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
  it('lists and cancels an action before its hour ticks', async () => {
    // Arrange
    const harness = await start();
    const empty = await getPending(harness);
    expect(await empty.json()).toEqual({ actions: [] });
    await postAction(harness, buyWool(ID_A, 1, 2));

    // Act
    const listed = await getPending(harness);
    const cancelled = await cancelPending(harness, ID_A);
    await harness.advance(HOUR);
    const body = await worldBody(harness);

    // Assert
    expect(await listed.json()).toEqual({
      actions: [{ id: ID_A, hour: 1, type: 'market.buy', good: 'wool', units: 2 }],
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

  it('keeps a cancellation already won even after the hour ticks', async () => {
    // Arrange: cancel, then let the world catch up over the action's hour.
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 1, 2));
    await cancelPending(harness, ID_A);
    await harness.advance(HOUR);
    const warmed = await worldBody(harness);

    // Act
    const again = await cancelPending(harness, ID_A);

    // Assert: the retry is a no-op, not a stale refusal.
    expect(again.status).toBe(204);
    expect((await worldBody(harness)).stateHash).toBe(warmed.stateHash);
  });

  it('refuses a cancellation once the hour has ticked', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 1, 2));
    await harness.advance(HOUR);
    const applied = await worldBody(harness);

    // Act
    const response = await cancelPending(harness, ID_A);

    // Assert: the buy was applied (eight plus two, less four woven).
    expect(applied.world.house.stock.wool).toBe(6);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'stale_hour', currentHour: 2 });
  });

  it("does not cancel another house's action", async () => {
    // Arrange
    const harness = await start({ houses: ['leclerc', 'caron'] });
    await postActionAs(harness, 'caron', buyWool(ID_A, 1, 2));

    // Act
    const foreign = await cancelPending(harness, ID_A, 'leclerc');
    const own = await cancelPending(harness, ID_A, 'caron');

    // Assert
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: 'unknown_action' });
    expect(own.status).toBe(204);
  });

  it('lists and cancels a campaign', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, { id: ID_A, hour: 1, action: { type: 'council.campaign', seatId: 'maire' } });
    const listed = (await (await getPending(harness)).json()) as {
      actions: Array<{ type: string; seatId?: string }>;
    };

    // Act
    await cancelPending(harness, ID_A);
    await harness.advance(HOUR);
    const body = await worldBody(harness);

    // Assert: no favour was spent and no campaign was queued.
    expect(listed.actions).toContainEqual(expect.objectContaining({ type: 'council.campaign', seatId: 'maire' }));
    expect(body.world.house.favour).toBe(50);
  });

  it('lists an action queued for the next hour', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 2, 2));

    // Act
    const listed = (await (await getPending(harness)).json()) as {
      actions: Array<{ id: string; hour: number }>;
    };

    // Assert
    expect(listed.actions).toContainEqual(expect.objectContaining({ id: ID_A, hour: 2 }));
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

  it('plays exactly one hour and leaves the next natural tick an hour away', async () => {
    // Arrange
    const harness = await start({ devAdvance: true });
    const before = await worldBody(harness);

    // Act
    const response = await postAdvance(harness);
    const after = (await response.json()) as WorldBody;

    // Assert
    expect(response.status).toBe(200);
    expect(after.world.hour).toBe(before.world.hour + 1);
    // The simulated hour is saved at the real now: the next natural hour is an
    // hour away, not already owed.
    const anchor = await harness.worlds.withWorld(async (session) => session.snapshot.hourStartedAt, TEST_TOWN.id);
    expect(anchor.getTime()).toBe(harness.clock.now);
    expect(after.dev).toBe(true);

    // Act: an hour later the town plays exactly one more, not a backlog.
    await harness.advance(HOUR);
    const read = await worldBody(harness);

    // Assert
    expect(read.world.hour).toBe(after.world.hour + 1);
  });

  it('does not advance again on a plain read, and the hashes agree', async () => {
    // Arrange
    const harness = await start({ devAdvance: true });
    const advanced = (await (await postAdvance(harness)).json()) as WorldBody;

    // Act
    const read = await worldBody(harness);

    // Assert
    expect(read.world.hour).toBe(advanced.world.hour);
    expect(read.stateHash).toBe(advanced.stateHash);
  });

  it('applies the action queued for the hour it plays', async () => {
    // Arrange
    const harness = await start({ devAdvance: true });
    const before = await worldBody(harness);
    await postAction(harness, buyWool(ID_A, before.world.hour, 10));

    // Act
    const advanced = (await (await postAdvance(harness)).json()) as WorldBody;

    // Assert
    expect(advanced.events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', houseId: 'leclerc', units: 10 }),
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
    expect(second.world.hour).toBe(before.world.hour + 2);
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

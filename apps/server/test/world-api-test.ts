import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { FORMAT_VERSION, hashJson, PACING, RULES, stateHash, WorldVersionError, type World } from '@brigue/core';

import { SESSION_COOKIE } from '../src/http/cookies.ts';
import { createApp } from '../src/http/app.ts';
import { createLogger } from '../src/logger.ts';
import { playDue } from '../src/town/scheduler.ts';
import { MemoryPlayerStore } from '../src/identity/players.ts';
import { issueToken } from '../src/identity/session.ts';
import { MemoryWorldStore } from '../src/town/worlds.ts';
import { CARON, FOURNIER, LECLERC, seeded, TEST_TOWN, town } from './helpers.ts';

const START = new Date('2026-10-31T12:00:00.000Z').getTime();
const HOUR = 60 * 60 * 1000;
// The store assigns action ids in arrival order, one counter per town.
const ID_A = 1;
const ID_B = 2;

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

interface MessageBody {
  id: number;
  read: boolean;
  event: Record<string, unknown> & { type: string; personId?: number | 'unknown'; units?: number };
}

interface WorldBody {
  world: {
    hour: number;
    year: number;
    person: { id: number; stock: Record<string, number>; favour: number };
    town: { people: Array<Record<string, unknown>> };
    nextBellAt: string;
  };
  messages: MessageBody[];
  chronicle: Array<Record<string, unknown> & { type: string; personId?: number | 'unknown'; units?: number }>;
  unreadMessages: number;
  summary: {
    hours: number;
    skipped: number;
  };
  stateHash: string;
  dev?: boolean;
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

async function start(
  options: { world?: World; at?: number; devAdvance?: boolean; readers?: Record<string, number> } = {},
): Promise<Harness> {
  const clock = { now: options.at ?? START };
  const store = new MemoryPlayerStore();
  const worlds = new MemoryWorldStore(() => new Date(clock.now));
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
  await worlds.createTown(TEST_TOWN.name, world, new Date(clock.now));

  const readers = options.readers ?? { leclerc: LECLERC };
  const cookies: Record<string, string> = {};
  for (const [label, personId] of Object.entries(readers)) {
    const name = label.charAt(0).toUpperCase() + label.slice(1);
    const { token, player } = await issueToken(store, name, new Date(clock.now));
    await store.rebind(player.tokenHash, TEST_TOWN.id, personId, new Date(clock.now));
    cookies[label] = `${SESSION_COOKIE}=${token}`;
  }

  // The scheduler's pass, minus the timer: what the loop would do on its own.
  const play = async (): Promise<void> => {
    try {
      await worlds.withWorld(async (session) => {
        const players = await store.listByTown(TEST_TOWN.id);
        const accounts = new Map(
          players.flatMap((player) => (player.personId === null ? [] : [[player.personId, player.playerId] as const])),
        );
        const due = await playDue(session, session.snapshot, new Date(clock.now), 1, new Set(), seeded());
        if (due.hours > 0) {
          await session.save(due.world, due.hourStartedAt, due.events, accounts);
        }
      }, TEST_TOWN.id);
      await worlds.pruneJournal(
        TEST_TOWN.id,
        new Date(clock.now - PACING.chronicleRetentionHours * HOUR),
        new Date(clock.now - PACING.messageRetentionHours * HOUR),
      );
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
    cookie: cookies[Object.keys(readers)[0] as string] as string,
  };
}

function getWorld(harness: Harness): Promise<Response> {
  return fetch(`${harness.url}/api/world`, { headers: { Cookie: harness.cookie } });
}

function getWorldAs(harness: Harness, dynastyId: string): Promise<Response> {
  return fetch(`${harness.url}/api/world`, { headers: { Cookie: harness.cookies[dynastyId] as string } });
}

async function worldBody(harness: Harness): Promise<WorldBody> {
  const response = await getWorld(harness);

  expect(response.status).toBe(200);

  return (await response.json()) as WorldBody;
}

async function worldBodyAs(harness: Harness, dynastyId: string): Promise<WorldBody> {
  const response = await getWorldAs(harness, dynastyId);

  expect(response.status).toBe(200);

  return (await response.json()) as WorldBody;
}

function postAction(harness: Harness, body: unknown): Promise<Response> {
  return postActionAs(harness, 'leclerc', body);
}

function postActionAs(harness: Harness, dynastyId: string, body: unknown): Promise<Response> {
  return fetch(`${harness.url}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: harness.cookies[dynastyId] as string },
    body: JSON.stringify(body),
  });
}

function getPending(harness: Harness, dynastyId = 'leclerc'): Promise<Response> {
  return fetch(`${harness.url}/api/actions`, { headers: { Cookie: harness.cookies[dynastyId] as string } });
}

function cancelPending(harness: Harness, id: number, dynastyId = 'leclerc'): Promise<Response> {
  return fetch(`${harness.url}/api/actions/${id}`, {
    method: 'DELETE',
    headers: { Cookie: harness.cookies[dynastyId] as string },
  });
}

function buyWool(id: number, hour: number, units: number, extra: Record<string, unknown> = {}): unknown {
  return { id, hour, action: { type: 'market.buy', good: 'wool', units, ...extra } };
}

function sellWool(id: number, hour: number, units: number): unknown {
  return { id, hour, action: { type: 'market.sell', good: 'wool', units } };
}

function sellGrain(id: number, hour: number, units: number): unknown {
  return { id, hour, action: { type: 'market.sell', good: 'grain', units } };
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
    expect(first.messages).toEqual(second.messages);
    expect(first.chronicle).toEqual(second.chronicle);
    expect(first.unreadMessages).toBe(second.unreadMessages);
    expect(first.world.hour).toBe(1);
  });

  it('catches a month up when the scheduler never ran, and keeps the newest page', async () => {
    // Arrange: the loop is down; a visit is the only thing that wakes the town.
    const harness = await start();
    await harness.lapse(30 * 24 * HOUR);

    // Act
    const body = await worldBody(harness);

    // Assert
    expect(body.summary.hours).toBe(720);
    expect(body.summary.skipped).toBe(0);
    expect(body.world.hour).toBe(721);
    // The player was dormant for the whole month, so its workshops idled and it
    // got no message; the badge counts nothing.
    expect(body.messages).toEqual([]);
    expect(body.unreadMessages).toBe(0);
    // The chronicle carries the town's elections only, never a private line.
    expect(body.chronicle.length).toBeGreaterThan(0);
    for (const line of body.chronicle) {
      expect(line.type).toBe('council.election_held');
      expect(Number(line.at)).toBeLessThanOrEqual(720);
    }
  });

  it('returns the same page on a read that has nothing to play', async () => {
    // Arrange: the read is the backstop and only wakes a town more than an
    // hour behind, so the loop must have missed two.
    const harness = await start();
    await harness.lapse(2 * HOUR);
    const first = await worldBody(harness);

    // Act
    const second = await worldBody(harness);

    // Assert: the page is a window; a read is not a consumption.
    expect(first.summary.hours).toBe(2);
    expect(second.messages).toEqual(first.messages);
    expect(second.chronicle).toEqual(first.chronicle);
    expect(second.unreadMessages).toBe(first.unreadMessages);
    expect(second.summary.hours).toBe(0);
    expect(second.stateHash).toBe(first.stateHash);
  });

  it('shows the same newest page on every read', async () => {
    // Arrange: a month of entries, far more than one page.
    const harness = await start();
    await harness.lapse(30 * 24 * HOUR);
    const first = await worldBody(harness);

    // Act
    const second = await worldBody(harness);

    // Assert: reading is not a consumption, on either page.
    expect(second.messages).toEqual(first.messages);
    expect(second.chronicle).toEqual(first.chronicle);
    expect(second.summary.hours).toBe(0);
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
    // Arrange: the format this build replaced is refused before any replay, so
    // the town is never read through the wrong shape.
    const world = { ...town(7), formatVersion: FORMAT_VERSION - 1 };
    const harness = await start({ world });
    const before = stateHash(world);
    await harness.advance(2 * HOUR);

    // Act
    const response = await getWorld(harness);

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'world_version',
      formatVersion: FORMAT_VERSION - 1,
      rulesetVersion: RULES.version,
      expected: { formatVersion: FORMAT_VERSION, rulesetVersion: RULES.version },
    });
    const after = await harness.worlds.withWorld(async (session) => session.snapshot.world, TEST_TOWN.id);
    expect(stateHash(after)).toBe(before);
    expect(after.hour).toBe(1);
  });

  it('shows its own dynasty in full, the town without the seed or other purses', async () => {
    // Arrange
    const harness = await start();

    // Act
    const body = await worldBody(harness);
    const serialised = JSON.stringify(body);

    // Assert
    expect(body.world.person.id).toBe(LECLERC);
    expect(serialised).not.toContain('"seed"');
    expect(serialised).not.toContain('"rng"');
    expect(body.world.town.people.every((dynasty) => !('treasuryCents' in dynasty))).toBe(true);
    expect(new Date(body.world.nextBellAt).getTime()).toBe(START + 12 * HOUR);
    // The hash covers the projection, not the seed-bearing world.
    expect(body.stateHash).toBe(hashJson(body.world));
  });

  it('returns a dynasty its own mail and not another dynasty’s', async () => {
    // Arrange: both dynasties sell grain they do not hold in the same hour, so
    // each gets a refusal of its own.
    const world = town(20261031);
    world.people[CARON]!.ia = false;
    const harness = await start({ world, readers: { leclerc: LECLERC, caron: CARON } });
    await postActionAs(harness, 'leclerc', sellGrain(ID_A, 1, 1));
    await postActionAs(harness, 'caron', sellGrain(ID_B, 1, 1));
    await harness.advance(HOUR);

    // Act
    const leclerc = await worldBodyAs(harness, 'leclerc');
    const caron = await worldBodyAs(harness, 'caron');

    // Assert
    const refusalsOf = (body: WorldBody) => body.messages.filter((message) => message.event.type === 'action.refused');

    expect(refusalsOf(leclerc)).toHaveLength(1);
    expect(refusalsOf(leclerc)[0]?.event).toMatchObject({ personId: LECLERC });
    expect(refusalsOf(caron)).toHaveLength(1);
    expect(refusalsOf(caron)[0]?.event).toMatchObject({ personId: CARON });
  });

  it('keeps the chronicle to the town and the mail to the dynasty', async () => {
    // Arrange: a whole year, so the scrutiny elects the AI candidates.
    const harness = await start();

    // Act
    await harness.advance(24 * HOUR);
    const body = await worldBody(harness);

    // Assert: the town's page carries the elections, the weaver's mailbox
    // carries nothing it did not do, and the two never mix.
    expect(body.chronicle.length).toBeGreaterThan(0);
    expect(body.chronicle.every((line) => line.type === 'council.election_held')).toBe(true);
    expect(body.messages).toEqual([]);
  });

  it('projects and ticks a town of twenty people', async () => {
    // Arrange
    const base = town(20261031);
    const world: World = { ...base, people: { ...base.people } };
    const template = base.people[FOURNIER]!;
    for (let id = 5; id <= 20; id += 1) {
      world.people[id] = {
        ...structuredClone(template),
        id,
        ia: true,
        name: `Nom ${id}`,
        workshops: [{ id, good: 'grain', level: 1 }],
        stock: {},
      };
    }
    const harness = await start({ world });

    // Act
    const first = await worldBody(harness);
    await harness.advance(HOUR);
    const next = await worldBody(harness);

    // Assert
    expect(first.world.town.people).toHaveLength(20);
    expect(next.world.hour).toBe(2);
  });
});

describe('POST /api/messages/:id/read', () => {
  function markRead(harness: Harness, id: number, dynastyId = 'leclerc'): Promise<Response> {
    return fetch(`${harness.url}/api/messages/${id}/read`, {
      method: 'POST',
      headers: { Cookie: harness.cookies[dynastyId] as string },
    });
  }

  async function twoRefusals(harness: Harness): Promise<void> {
    await postAction(harness, sellGrain(ID_A, 1, 1));
    await postAction(harness, { id: ID_B, hour: 1, action: { type: 'person.buy_title' } });
    await harness.advance(HOUR);
  }

  it('marks one message read and leaves the other unread', async () => {
    // Arrange: two refusals of the weaver's, so two messages.
    const harness = await start();
    await twoRefusals(harness);
    const before = await worldBody(harness);
    expect(before.messages).toHaveLength(2);
    expect(before.unreadMessages).toBe(2);
    const target = before.messages[0];

    // Act
    const response = await markRead(harness, target?.id ?? 0);

    // Assert: one line is read, the other still waits, and the badge follows.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ read: true, unreadMessages: 1 });
    const after = await worldBody(harness);
    expect(after.messages.filter((message) => message.read).map((message) => message.id)).toEqual([target?.id]);
    expect(after.unreadMessages).toBe(1);
  });

  it('does not mark another dynasty’s message', async () => {
    // Arrange: two humans, each with a refusal.
    const world = town(20261031);
    world.people[CARON]!.ia = false;
    const harness = await start({ world, readers: { leclerc: LECLERC, caron: CARON } });
    await postActionAs(harness, 'leclerc', sellGrain(ID_A, 1, 1));
    await postActionAs(harness, 'caron', sellGrain(ID_B, 1, 1));
    await harness.advance(HOUR);
    const caron = await worldBodyAs(harness, 'caron');
    const target = caron.messages[0];

    // Act: the weaver names the other's id.
    const response = await markRead(harness, target?.id ?? 0);

    // Assert: nothing is read, and the owner still has its unread line.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ read: false, unreadMessages: 1 });
    expect((await worldBodyAs(harness, 'caron')).unreadMessages).toBe(1);
  });

  it('refuses an id that is not one, without a session, and anything but POST', async () => {
    // Arrange
    const harness = await start();

    // Act
    const malformed = await fetch(`${harness.url}/api/messages/0/read`, {
      method: 'POST',
      headers: { Cookie: harness.cookie },
    });
    const anonymous = await fetch(`${harness.url}/api/messages/1/read`, { method: 'POST' });
    const wrongMethod = await fetch(`${harness.url}/api/messages/1/read`, { headers: { Cookie: harness.cookie } });

    // Assert
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({ error: 'unknown_message' });
    expect(anonymous.status).toBe(401);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('POST');
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

    // Assert: the buy played before the hour's production, which ate four.
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: ID_A, hour: 1, personId: LECLERC });
    expect(body.world.person.stock.wool).toBe(6);
    expect(body.messages).toEqual([]);
  });

  it("queues a sale at the hour's price", async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, sellWool(ID_A, 1, 2));
    await harness.advance(HOUR);
    const body = await worldBody(harness);

    // Assert: two of the eight wool are sold, four are woven, two remain, and
    // the sale is the Marché's, not a journal line.
    expect(response.status).toBe(201);
    expect(body.world.person.stock.wool).toBe(2);
    expect(body.messages).toEqual([]);
  });

  it('accepts a replayed request as a second action', async () => {
    // Arrange: nothing marks the request, so the town has no way to know it is
    // the same order twice.
    const harness = await start();
    const submitted = buyWool(ID_A, 1, 2);

    // Act
    const first = await postAction(harness, submitted);
    const replay = await postAction(harness, submitted);
    await harness.advance(HOUR);
    const body = await worldBody(harness);

    // Assert: both buys played: eight wool, four bought, four woven.
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(body.world.person.stock.wool).toBe(8);
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

    // Assert: the hour is not replayed, and both pages are the same.
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'stale_hour', currentHour: 2 });
    expect(body.messages).toEqual(applied.messages);
    expect(body.chronicle).toEqual(applied.chronicle);
    expect(body.stateHash).toBe(applied.stateHash);
    expect(body.summary.hours).toBe(0);
    expect(body.world.person.stock.wool).toBe(6);
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

    // Assert: the queued action plays on its own hour, not on the one before:
    // eight wool, three bought, four woven on each of the two hours.
    expect(response.status).toBe(201);
    expect(body.world.hour).toBe(3);
    expect(body.world.person.stock.wool).toBe(3);
  });

  it('never takes the dynasty from the body', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await postAction(harness, buyWool(ID_A, 1, 1, { personId: CARON }));
    await harness.advance(HOUR);
    const body = await worldBody(harness);

    // Assert: the buy is the authenticated dynasty's, and its purse paid.
    expect(response.status).toBe(201);
    expect(body.world.person.stock.wool).toBe(5);
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

describe('DELETE /api/messages/:id', () => {
  function deleteMail(harness: Harness, id: number, dynastyId = 'leclerc'): Promise<Response> {
    return fetch(`${harness.url}/api/messages/${id}`, {
      method: 'DELETE',
      headers: { Cookie: harness.cookies[dynastyId] as string },
    });
  }

  it('deletes one message and answers the badge', async () => {
    // Arrange: a refusal of the weaver's.
    const harness = await start();
    await postAction(harness, sellGrain(ID_A, 1, 1));
    await harness.advance(HOUR);
    const before = await worldBody(harness);
    const target = before.messages[0];
    expect(target).toBeDefined();

    // Act
    const response = await deleteMail(harness, target?.id ?? 0);

    // Assert: the row goes, the answer says so, and the page loses the line.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, unreadMessages: 0 });
    const after = await worldBody(harness);
    expect(after.messages).toEqual([]);
  });

  it('does not delete another dynasty’s message', async () => {
    // Arrange: two humans, each with a refusal.
    const world = town(20261031);
    world.people[CARON]!.ia = false;
    const harness = await start({ world, readers: { leclerc: LECLERC, caron: CARON } });
    await postActionAs(harness, 'leclerc', sellGrain(ID_A, 1, 1));
    await postActionAs(harness, 'caron', sellGrain(ID_B, 1, 1));
    await harness.advance(HOUR);
    const caron = await worldBodyAs(harness, 'caron');
    const target = caron.messages[0];
    expect(target).toBeDefined();

    // Act: the weaver names the other's id.
    const response = await deleteMail(harness, target?.id ?? 0);

    // Assert: nothing is deleted, and the owner still holds the line.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: false });
    expect((await worldBodyAs(harness, 'caron')).messages).toHaveLength(1);
  });

  it('refuses an id that is not one, without a session, and anything but DELETE', async () => {
    // Arrange
    const harness = await start();

    // Act
    const malformed = await fetch(`${harness.url}/api/messages/0`, {
      method: 'DELETE',
      headers: { Cookie: harness.cookie },
    });
    const anonymous = await fetch(`${harness.url}/api/messages/1`, { method: 'DELETE' });
    const wrongMethod = await fetch(`${harness.url}/api/messages/1`, { headers: { Cookie: harness.cookie } });

    // Assert
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({ error: 'unknown_message' });
    expect(anonymous.status).toBe(401);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('DELETE');
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
    expect(body.world.person.stock.wool).toBe(4);
  });

  it('accepts a retry after a cancellation as a new action', async () => {
    // Arrange: the cancelled row is gone, so the same order is a new one.
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 1, 2));
    await cancelPending(harness, ID_A);

    // Act
    const retry = await postAction(harness, buyWool(ID_B, 1, 2));

    // Assert
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual({ id: ID_B, hour: 1, personId: LECLERC });
  });

  it('finds nothing to cancel twice', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 1, 2));

    // Act and assert
    expect((await cancelPending(harness, ID_A)).status).toBe(204);
    expect((await cancelPending(harness, ID_A)).status).toBe(404);
  });

  it('leaves the world untouched when a cancelled action is cancelled again', async () => {
    // Arrange: cancel, then let the world catch up over the action's hour.
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 1, 2));
    await cancelPending(harness, ID_A);
    await harness.advance(HOUR);
    const warmed = await worldBody(harness);

    // Act
    const again = await cancelPending(harness, ID_A);

    // Assert: the row is gone, and the world did not move.
    expect(again.status).toBe(404);
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
    expect(applied.world.person.stock.wool).toBe(6);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'stale_hour', currentHour: 2 });
  });

  it("does not cancel another dynasty's action", async () => {
    // Arrange
    const harness = await start({ readers: { leclerc: LECLERC, caron: CARON } });
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
    expect(body.world.person.favour).toBe(50);
  });

  it('lists an action queued for the next hour', async () => {
    // Arrange
    const harness = await start();
    await postAction(harness, buyWool(ID_A, 2, 2));

    // Act
    const listed = (await (await getPending(harness)).json()) as {
      actions: Array<{ id: number; hour: number }>;
    };

    // Assert
    expect(listed.actions).toContainEqual(expect.objectContaining({ id: ID_A, hour: 2 }));
  });

  it('refuses an unknown or malformed id', async () => {
    // Arrange
    const harness = await start();

    // Act
    const unknown = await cancelPending(harness, ID_B);
    const malformed = await fetch(`${harness.url}/api/actions/not-a-number`, {
      method: 'DELETE',
      headers: { Cookie: harness.cookie },
    });

    // Assert
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'unknown_action' });
    expect(malformed.status).toBe(404);
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

    // Assert: ten wool bought on the hour, four woven.
    expect(advanced.world.person.stock.wool).toBe(14);
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

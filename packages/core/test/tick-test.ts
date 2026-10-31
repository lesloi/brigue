import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { advance, canonicalJson, createWorld, stateHash, tick, WorldVersionError } from '../src/index.ts';
import type { Action, Event, World } from '../src/index.ts';

const SEED = 20261029;
const WEEKS = 200;

function play(world: World, weeks: number, actionAt?: (week: number) => Action[]): { world: World; events: Event[] } {
  let current = world;
  const events: Event[] = [];

  for (let week = 0; week < weeks; week += 1) {
    const result = tick(current, actionAt?.(week) ?? []);
    current = result.world;
    events.push(...result.events);
  }

  return { world: current, events };
}

function scripted(week: number): Action[] {
  if (week === 3) return [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 5 }];
  if (week === 7) return [{ type: 'council.campaign', houseId: 'brigue', seatId: 'maire' }];
  if (week === 11) return [{ type: 'market.buy', houseId: 'brigue', good: 'cloth', units: 400 }];
  return [];
}

describe('the simulation core', () => {
  it('gives the same world for the same seed and the same actions', () => {
    const first = play(createWorld(SEED), WEEKS, scripted);
    const second = play(createWorld(SEED), WEEKS, scripted);

    expect(stateHash(first.world)).toBe(stateHash(second.world));
    expect(canonicalJson(first.world)).toBe(canonicalJson(second.world));
  });

  it('gives a different world for a different seed', () => {
    expect(stateHash(play(createWorld(SEED), WEEKS, scripted).world)).not.toBe(
      stateHash(play(createWorld(1), WEEKS, scripted).world),
    );
  });

  it('never mutates the world it is given', () => {
    const world = createWorld(SEED);
    const before = canonicalJson(world);

    tick(world, [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 2 }]);

    expect(canonicalJson(world)).toBe(before);
  });

  it('refuses an action the house cannot pay for, and says so', () => {
    const world = createWorld(SEED);
    const refused = tick(world, [{ type: 'market.buy', houseId: 'brigue', good: 'cloth', units: 10_000 }]);
    const control = tick(world, []);

    expect(refused.events).toContainEqual({
      type: 'action.refused',
      action: 'market.buy',
      houseId: 'brigue',
      reason: 'insufficient_funds',
    });
    expect(refused.world.houses.brigue.treasuryCents).toBe(control.world.houses.brigue.treasuryCents);
  });

  it('refuses an action from a house that does not exist instead of throwing', () => {
    const { events } = tick(createWorld(SEED), [{ type: 'market.buy', houseId: 'ghost', good: 'wool', units: 1 }]);

    expect(events[0]).toMatchObject({ type: 'action.refused', reason: 'unknown_house' });
  });

  it('refuses an action type it does not know, instead of skipping it', () => {
    const malformed = { type: 'market.invent', houseId: 'brigue', good: 'wool' } as unknown as Action;
    const { events } = tick(createWorld(SEED), [malformed]);

    expect(events[0]).toMatchObject({ type: 'action.refused', reason: 'unknown_action', houseId: 'unknown' });
  });

  it('clears the output at the market instead of counting it twice', () => {
    const { world } = tick(createWorld(SEED));

    expect(world.houses.brigue.stock.cloth).toBeUndefined();
    expect(world.houses.brigue.stock.wool).toBe(4);
  });

  it('idles a workshop with no raw material, and produces again once it is bought', () => {
    const first = play(createWorld(SEED), 3);

    expect(first.events).toContainEqual({
      type: 'workshop.idle',
      houseId: 'brigue',
      good: 'cloth',
      input: 'wool',
      missingUnits: 4,
    });

    const { events } = tick(first.world, [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 4 }]);

    expect(events).toContainEqual(expect.objectContaining({ type: 'market.sold', houseId: 'brigue', good: 'cloth' }));
  });

  it('holds an election on its period and fills a seat', () => {
    const { world, events } = play(createWorld(SEED), 4);
    const election = events.find((event) => event.type === 'council.election_held');

    expect(election).toMatchObject({ type: 'council.election_held', seatId: 'maire' });
    expect(world.seats.maire.houseId).not.toBeNull();
  });

  it('keeps a campaign for one seat out of another seat election', () => {
    const control = play(createWorld(SEED), 4);
    const campaigned = play(createWorld(SEED), 4, (week) =>
      week === 0 ? [{ type: 'council.campaign', houseId: 'brigue', seatId: 'tresorier' }] : [],
    );

    const votesOf = (events: Event[]) => events.find((event) => event.type === 'council.election_held');

    expect(votesOf(campaigned.events)).toEqual(votesOf(control.events));
    expect(campaigned.world.campaigns.tresorier).toEqual({ brigue: 2 });
  });

  it('turns unpaid wages into a debt instead of erasing them', () => {
    const world = createWorld(SEED);
    world.houses.brigue.treasuryCents = 0;
    world.houses.brigue.stock = {};
    world.houses.brigue.workshops = [{ good: 'wool', level: 0, workers: 3 }];

    const { world: after, events } = tick(world);

    expect(events).toContainEqual({ type: 'house.penniless', houseId: 'brigue', shortfallCents: 360 });
    expect(after.houses.brigue.debtCents).toBe(360);
  });

  it('refuses a world written by another ruleset', () => {
    const world = createWorld(SEED);
    world.rulesetVersion += 1;

    expect(() => tick(world)).toThrow(WorldVersionError);
  });

  it('keeps the ledger in integer cents', () => {
    const { world } = play(createWorld(SEED), 20);

    for (const house of Object.values(world.houses)) {
      expect(Number.isInteger(house.treasuryCents)).toBe(true);
      expect(Number.isInteger(house.debtCents)).toBe(true);
    }
    for (const price of Object.values(world.market)) {
      expect(Number.isInteger(price)).toBe(true);
    }
  });
});

describe('the generator', () => {
  it('escapes the zero fixed point', () => {
    expect(advance(0)).toBeGreaterThan(0);
  });
});

describe('canonical json', () => {
  it('sorts keys and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });
});

describe('the core', () => {
  it('stays pure: no wall clock, no global rng, no import from an app', () => {
    const sourceDir = join(import.meta.dirname, '..', 'src');
    const offenders = readdirSync(sourceDir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => {
        // Comments are allowed to name what the code must not do.
        const source = readFileSync(join(sourceDir, file), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        return (
          source.includes('Math.random') || source.includes('Date.now') || /from\s+['"][^'"]*\/apps\//.test(source)
        );
      });

    expect(offenders).toEqual([]);
  });
});

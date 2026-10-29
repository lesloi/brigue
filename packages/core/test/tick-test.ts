import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { canonicalJson, createWorld, stateHash, tick } from '../src/index.ts';
import type { Action, World } from '../src/index.ts';

const WEEKS = 200;

/** A fixed scripted game: no randomness outside the seed, no wall clock. */
function playthrough(seed: number): World {
  let world = createWorld(seed);

  for (let week = 0; week < WEEKS; week += 1) {
    const actions: Action[] = [];

    if (week === 3) {
      actions.push({ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 5 });
    }
    if (week === 7) {
      actions.push({ type: 'council.campaign', houseId: 'brigue', seatId: 'tresorier' });
    }
    if (week === 11) {
      actions.push({ type: 'market.buy', houseId: 'brigue', good: 'cloth', units: 400 });
    }

    world = tick(world, actions).world;
  }

  return world;
}

describe('the simulation core', () => {
  it('gives the same world for the same seed and the same actions', () => {
    const first = playthrough(20261029);
    const second = playthrough(20261029);

    expect(stateHash(first)).toBe(stateHash(second));
    expect(canonicalJson(first)).toBe(canonicalJson(second));
  });

  it('gives a different world for a different seed', () => {
    expect(stateHash(playthrough(20261029))).not.toBe(stateHash(playthrough(1)));
  });

  it('never mutates the world it is given', () => {
    const world = createWorld(20261029);
    const before = canonicalJson(world);

    tick(world, [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 2 }]);

    expect(canonicalJson(world)).toBe(before);
  });

  it('refuses an action the house cannot pay for', () => {
    const world = createWorld(20261029);
    const refused = tick(world, [{ type: 'market.buy', houseId: 'brigue', good: 'cloth', units: 10_000 }]);
    const control = tick(world, []);

    expect(refused.events.some((event) => event.type === 'market.bought')).toBe(false);
    expect(refused.world.houses.brigue.treasuryCents).toBe(control.world.houses.brigue.treasuryCents);
  });

  it('holds an election on its period and fills a seat', () => {
    let world = createWorld(20261029);
    const events = [];

    for (let week = 0; week < 4; week += 1) {
      const result = tick(world);
      world = result.world;
      events.push(...result.events);
    }

    const election = events.find((event) => event.type === 'council.election_held');

    expect(election).toBeDefined();
    expect(world.seats.maire.houseId).not.toBeNull();
  });

  it('keeps the ledger in integer cents', () => {
    const { world } = tick(createWorld(20261029));

    for (const house of Object.values(world.houses)) {
      expect(Number.isInteger(house.treasuryCents)).toBe(true);
    }
    for (const price of Object.values(world.market)) {
      expect(Number.isInteger(price)).toBe(true);
    }
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

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  FORMAT_VERSION,
  HOURS_PER_YEAR,
  RULES,
  stateHash,
  takeSeat,
  visibleTo,
  WorldVersionError,
  yearOf,
} from '../src/index.ts';
import type { Action, Event, World } from '../src/index.ts';
import { CARON, FOURNIER, LECLERC, tick, town } from './helpers.ts';

const SEED = 20261029;
const HOURS = 200;

function play(
  world: World,
  hours: number,
  actionAt?: (hour: number) => Action[],
  dormant: ReadonlySet<number> = new Set(),
): { world: World; events: Event[] } {
  let current = world;
  const events: Event[] = [];

  for (let hour = 0; hour < hours; hour += 1) {
    const result = tick(current, actionAt?.(hour) ?? [], dormant);
    current = result.world;
    events.push(...result.events);
  }

  return { world: current, events };
}

function scripted(hour: number): Action[] {
  if (hour === 3) return [{ type: 'market.buy', personId: LECLERC, good: 'wool', units: 5 }];
  if (hour === 7) return [{ type: 'council.campaign', personId: LECLERC, seatId: 'maire' }];
  if (hour === 11) return [{ type: 'market.buy', personId: LECLERC, good: 'cloth', units: 20 }];
  return [];
}

describe('the simulation core', () => {
  it('gives the same world for the same seed and the same actions', () => {
    const first = play(town(SEED), HOURS, scripted);
    const second = play(town(SEED), HOURS, scripted);

    expect(stateHash(first.world)).toBe(stateHash(second.world));
    expect(canonicalJson(first.world)).toBe(canonicalJson(second.world));
  });

  it('starts the same world every time', () => {
    // There is no seed: the world is fixed, and what happens next is the
    // actions and trading, not a draw at creation.
    expect(stateHash(play(town(SEED), HOURS, scripted).world)).toBe(stateHash(play(town(1), HOURS, scripted).world));
  });

  it('never mutates the world it is given', () => {
    const world = town(SEED);
    const before = canonicalJson(world);

    tick(world, [{ type: 'market.buy', personId: LECLERC, good: 'wool', units: 2 }]);

    expect(canonicalJson(world)).toBe(before);
  });

  it('refuses an action the person cannot pay for, and says so', () => {
    const world = town(SEED);
    const refused = tick(world, [{ type: 'market.buy', personId: LECLERC, good: 'cloth', units: 10_000 }]);
    const control = tick(world, []);

    expect(refused.events).toContainEqual(
      expect.objectContaining({
        type: 'action.refused',
        audience: { personId: LECLERC },
        action: 'market.buy',
        personId: LECLERC,
        reason: 'insufficient_funds',
      }),
    );
    expect(refused.world.people[LECLERC].treasuryCents).toBe(control.world.people[LECLERC].treasuryCents);
  });

  it('refuses an action from a person that does not exist instead of throwing', () => {
    const { events } = tick(town(SEED), [{ type: 'market.buy', personId: 999, good: 'wool', units: 1 }]);

    expect(events[0]).toMatchObject({ type: 'action.refused', audience: 'court', reason: 'unknown_person' });
  });

  it('refuses an action type it does not know, instead of skipping it', () => {
    const malformed = { type: 'market.invent', personId: LECLERC, good: 'wool' } as unknown as Action;
    const { events } = tick(town(SEED), [malformed]);

    expect(events[0]).toMatchObject({
      type: 'action.refused',
      audience: 'court',
      reason: 'unknown_action',
      personId: 0,
    });
  });

  it('credits the output to the stock instead of the purse', () => {
    const { world } = tick(town(SEED));

    expect(world.people[LECLERC].stock.cloth).toBe(4);
    expect(world.people[LECLERC].stock.wool).toBe(4);
    // The first person is human: its stock is not sold, and production pays no coin.
    expect(world.people[LECLERC].treasuryCents).toBe(RULES.startingPurseCents - 240);
  });

  it('idles a workshop with no raw material, and produces again once it is bought', () => {
    // Arrange: eight wool, four a hour, so the third hour has nothing to weave.
    const first = play(town(SEED), 3);

    // Assert: two hours made eight cloth, and the third made none.
    expect(first.world.people[LECLERC].stock).toEqual({ cloth: 8 });

    // Act: the wool is bought on the hour the workshop starts again.
    const { world } = tick(first.world, [{ type: 'market.buy', personId: LECLERC, good: 'wool', units: 4 }]);

    // Assert
    expect(world.people[LECLERC].stock).toEqual({ cloth: 12 });
  });

  it('fills the vacant seats with the AI at each scrutiny, and leaves the rest to the humans', () => {
    // Arrange: four AI people for five seats; the human never stands.
    const base = town(SEED);
    const world: World = { ...base, people: { ...base.people } };
    world.people[5] = {
      ...base.people[FOURNIER],
      id: 5,
      name: 'Jean Quint',
      workshops: [{ id: 5, good: 'grain', level: 1 }],
      stock: {},
    };

    // Act
    const { world: after, events } = play(world, HOURS_PER_YEAR * 2);

    // Assert: no scrutiny announcement; the four AI hold four seats and the
    // fifth waits for a human, and no person holds two seats.
    expect(events.some((event) => event.type === 'council.scrutiny_held')).toBe(false);
    const holders = Object.values(after.seats)
      .map((seat) => seat.personId)
      .filter((personId): personId is number => personId !== null);
    expect(holders).toHaveLength(4);
    expect(new Set(holders).size).toBe(holders.length);
    expect(Object.values(after.seats).filter((seat) => seat.personId === null)).toHaveLength(1);
  });

  it('makes twenty-four ticks a year and derives the year from the hour', () => {
    // Arrange: twenty-three hours are still the first year.
    const almost = play(town(SEED), HOURS_PER_YEAR - 1).world;

    // Act: the twenty-fourth tick closes it.
    const after = tick(almost).world;

    // Assert: the year is a reading of the hour, not a field of the world.
    expect(almost.hour).toBe(HOURS_PER_YEAR);
    expect(yearOf(almost.hour)).toBe(1401);
    expect(after.hour).toBe(HOURS_PER_YEAR + 1);
    expect(yearOf(after.hour)).toBe(1402);
  });

  it('advances a living person one year per twenty-four ticks', () => {
    // Arrange: the first person enters at twenty.
    const before = play(town(SEED), HOURS_PER_YEAR - 1).world;

    // Act
    const after = tick(before).world;

    // Assert
    expect(before.people[LECLERC].age).toBe(20);
    expect(after.people[LECLERC].age).toBe(21);
  });

  it('seats a living person and refuses an unknown or dead one', () => {
    // Arrange
    const world = town(SEED);
    const leclerc = world.people[LECLERC];
    const dead = structuredClone(leclerc);
    dead.id = 99;
    dead.alive = false;
    world.people[99] = dead;

    // Act and assert
    expect(takeSeat(world, 999)).toEqual({ ok: false, reason: 'unknown_person' });
    expect(takeSeat(world, 99)).toEqual({ ok: false, reason: 'person_dead' });
    expect(takeSeat(world, leclerc.id)).toEqual({ ok: true, seat: { personId: leclerc.id } });
  });

  it('keeps every filled seat on a living person', () => {
    // Arrange and act: enough hours to fill every seat once.
    const { world } = play(town(SEED), HOURS_PER_YEAR * 6);

    // Assert
    for (const seat of Object.values(world.seats)) {
      if (seat.personId === null) {
        continue;
      }
      const person = world.people[seat.personId];
      expect(person).toBeDefined();
      expect(person.alive).toBe(true);
    }
  });

  it('lodges a candidacy at once and the noon bell closes it for the scrutiny', () => {
    // Arrange: lodged during hour one, before any noon.
    const queued = tick(town(SEED), [{ type: 'council.campaign', personId: LECLERC, seatId: 'maire' }]);

    // Assert: the bonus is in the open map at once, and the event says which
    // scrutiny it counts for. The AI may have campaigned for the same seat.
    expect(queued.world.campaigns.maire?.[LECLERC]).toBe(RULES.campaignVoteBonus);
    expect(queued.world.engagements).toEqual([]);
    expect(queued.events).toContainEqual(
      expect.objectContaining({ type: 'council.campaigned', seatId: 'maire', countsAt: HOURS_PER_YEAR }),
    );

    // Act: run to the hour before noon, then step across the bell.
    const beforeNoon = play(queued.world, 10).world;
    const afterNoon = tick(beforeNoon).world;

    // Assert: the bell closes the open map into the one the scrutiny reads.
    expect(beforeNoon.closedCampaigns.maire).toBeUndefined();
    expect(afterNoon.closedCampaigns.maire?.[LECLERC]).toBe(RULES.campaignVoteBonus);
    expect(afterNoon.campaigns.maire).toBeUndefined();
  });

  it('counts a candidacy lodged after the noon bell for the next scrutiny', () => {
    // Arrange: the town is past noon on its first day.
    const world = { ...town(SEED), hour: HOURS_PER_YEAR / 2 + 1 };

    // Act
    const queued = tick(world, [{ type: 'council.campaign', personId: LECLERC, seatId: 'maire' }]);

    // Assert: it waits for the scrutiny after the coming one.
    expect(queued.events).toContainEqual(
      expect.objectContaining({ type: 'council.campaigned', seatId: 'maire', countsAt: HOURS_PER_YEAR * 2 }),
    );
    expect(queued.world.campaigns.maire).toEqual({ [LECLERC]: RULES.campaignVoteBonus });
    expect(queued.world.closedCampaigns.maire).toBeUndefined();
  });

  it('resolves an engagement at its due hour', () => {
    // The due hour is the caller's business: a hearing falls at the next noon
    // sitting, a site after twelve hours. This checks the resolver, not the
    // scheduling.
    const noon = HOURS_PER_YEAR / 2;

    for (const [kind, dueAt] of [
      ['hearing', noon],
      ['site', 1 + RULES.siteHours],
    ] as const) {
      // Arrange: an engagement due at that hour. A residence site needs the
      // degree that opens the next level.
      const world = town(SEED);
      if (kind === 'site') {
        world.people[LECLERC].title = 'bourgeois';
      }
      world.engagements = [
        kind === 'site'
          ? { id: 1, kind, personId: LECLERC, dueAt, work: 'residence' }
          : { id: 1, kind, personId: LECLERC, dueAt },
      ];

      // Act: run to the due hour, then one tick more.
      const early = play(world, dueAt - world.hour);
      const due = tick(early.world);

      // Assert: it waits for its hour, then leaves the world and does its work.
      expect(early.world.engagements).toHaveLength(1);
      expect(due.world.engagements).toEqual([]);
      if (kind === 'site') {
        expect(due.world.people[LECLERC]?.residenceLevel).toBe(2);
      }
    }
  });

  it('resolves an engagement behind the town clock by the next tick instead of dropping it', () => {
    // Arrange: an older state can leave the counter past a due hour. A cap jump
    // moves only the wall clock, so this is the defensive path, not the normal one.
    const world = town(SEED);
    world.hour = 900;
    world.people[LECLERC].title = 'bourgeois';
    world.engagements = [{ id: 1, kind: 'site', personId: LECLERC, dueAt: 800, work: 'residence' }];

    // Act
    const { world: after } = tick(world);

    // Assert: it resolves on the first tick that runs, and does its work.
    expect(after.engagements).toEqual([]);
    expect(after.people[LECLERC]?.residenceLevel).toBe(2);
  });

  it('keeps a campaign for one seat out of another seat vote', () => {
    // Arrange: both worlds reach the same scrutiny, one with a campaign for the treasury.
    const control = play(town(SEED), HOURS_PER_YEAR);
    const campaigned = play(town(SEED), HOURS_PER_YEAR, (hour) =>
      hour === 0 ? [{ type: 'council.campaign', personId: LECLERC, seatId: 'tresorier' }] : [],
    );

    const votesOf = (events: Event[], seatId: string) =>
      events.find(
        (event): event is Extract<Event, { type: 'council.election_held' }> =>
          event.type === 'council.election_held' && event.seatId === seatId,
      )?.votes;

    // Assert: the mayor is elected first and its vote is untouched.
    expect(votesOf(campaigned.events, 'maire')).toEqual(votesOf(control.events, 'maire'));
    expect(campaigned.world.campaigns).toEqual({});
  });

  it('turns unpaid upkeep into a debt instead of erasing it', () => {
    const world = town(SEED);
    world.people[LECLERC].treasuryCents = 0;
    world.people[LECLERC].stock = {};
    world.people[LECLERC].workshops = [{ id: 1, good: 'wool', level: 3 }];
    const upkeep = 3 * RULES.upkeepPerWorkshopLevelCents;

    const { world: after, events } = tick(world);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'person.penniless',
        audience: { personId: LECLERC },
        personId: LECLERC,
        shortfallCents: upkeep,
      }),
    );
    expect(after.people[LECLERC].debtCents).toBe(upkeep);
  });

  it('refuses an action from a dormant person instead of running it', () => {
    // Arrange
    const world = town(SEED);

    // Act
    const { world: after, events } = tick(
      world,
      [{ type: 'market.buy', personId: LECLERC, good: 'wool', units: 1 }],
      new Set([LECLERC]),
    );

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'action.refused',
        audience: { personId: LECLERC },
        action: 'market.buy',
        personId: LECLERC,
        reason: 'dormant_person',
      }),
    );
    expect(after.people[LECLERC].stock.wool).toBe(8);
  });

  it('vacates a dormant person’s seat, stops its trade and keeps it out of the vote', () => {
    // Arrange: the human holds the mayoralty, then goes dormant.
    const world = town(SEED);
    world.seats.maire = { personId: LECLERC };
    // A workshop with no input, so any sale at all would be the dormant person
    // running when it must not.
    world.people[LECLERC].workshops = [{ id: 1, good: 'wool', level: 2 }];
    world.people[LECLERC].stock = {};
    const treasuryCents = world.people[LECLERC].treasuryCents;

    // Act: one plain hour, then the five periods that bring the next scrutiny.
    const dormant = new Set([LECLERC]);
    const quiet = tick(world, [], dormant);
    const later = play(quiet.world, HOURS_PER_YEAR * 5, undefined, dormant);

    // Assert: the dormant holder does not trade, leaves the seat vacant at the
    // first scrutiny, and votes in none of them.
    expect(quiet.events.filter((event) => event.type === 'market.sold' && event.personId === LECLERC)).toEqual([]);
    expect(quiet.world.people[LECLERC].treasuryCents).toBe(treasuryCents);
    expect(
      later.events.some(
        (event) => event.type === 'council.election_held' && event.seatId === 'maire' && event.winnerPersonId === null,
      ),
    ).toBe(true);
    for (const event of later.events) {
      if (event.type === 'council.election_held') {
        expect(event.votes[LECLERC]).toBeUndefined();
      }
    }
  });

  it('shows a person-ledger event to that person only', () => {
    // Arrange: Caron cannot pay the upkeep of a workshop that cannot run.
    const world = town(SEED);
    world.people[CARON].treasuryCents = 0;
    world.people[CARON].stock = {};
    world.people[CARON].workshops = [{ id: 1, good: 'cloth', level: 2 }];

    // Act
    const { events } = tick(world);
    const forLeclerc = visibleTo(events, LECLERC);
    const forCaron = visibleTo(events, CARON);

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'person.penniless',
        personId: CARON,
        audience: { personId: CARON },
      }),
    );
    expect(forLeclerc.filter((event) => event.type === 'person.penniless')).toEqual([]);
    expect(forCaron.filter((event) => event.type === 'person.penniless' && event.personId === CARON)).toHaveLength(1);
  });

  it('ticks a town of twenty people', () => {
    // Arrange
    const base = town(SEED);
    const world: World = { ...base, people: { ...base.people } };
    for (let index = Object.keys(world.people).length + 1; index <= 20; index += 1) {
      world.people[index] = {
        ...base.people[FOURNIER],
        id: index,
        name: `Nom ${index}`,
        workshops: [{ id: index, good: 'grain', level: 1 }],
        stock: {},
      };
    }

    // Act
    const { world: after } = play(world, 2);

    // Assert
    expect(Object.keys(after.people)).toHaveLength(20);
    expect(after.hour).toBe(3);
  });

  it('refuses a world written by another ruleset', () => {
    const world = town(SEED);
    world.rulesetVersion += 1;

    expect(() => tick(world)).toThrow(WorldVersionError);
  });

  it('refuses a world of the previous format instead of guessing it', () => {
    // Arrange
    const world = { ...town(SEED), formatVersion: FORMAT_VERSION - 1 };

    // Act and assert
    expect(() => tick(world)).toThrow(WorldVersionError);
  });

  it('keeps the ledger in integer cents', () => {
    const { world } = play(town(SEED), 20);

    for (const person of Object.values(world.people)) {
      expect(Number.isInteger(person.treasuryCents)).toBe(true);
      expect(Number.isInteger(person.debtCents)).toBe(true);
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
  it('keeps the wall clock and the global random source out of its source', () => {
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

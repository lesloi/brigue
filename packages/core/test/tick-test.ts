import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  advanceRng,
  canonicalJson,
  FORMAT_VERSION,
  RULES,
  START_YEAR,
  stateHash,
  takeSeat,
  visibleTo,
  HOURS_PER_YEAR,
  WorldVersionError,
} from '../src/index.ts';
import type { Action, Event, World } from '../src/index.ts';
import { tick, town } from './helpers.ts';

const SEED = 20261029;
const HOURS = 200;

function play(world: World, hours: number, actionAt?: (hour: number) => Action[]): { world: World; events: Event[] } {
  let current = world;
  const events: Event[] = [];

  for (let hour = 0; hour < hours; hour += 1) {
    const result = tick(current, actionAt?.(hour) ?? []);
    current = result.world;
    events.push(...result.events);
  }

  return { world: current, events };
}

function scripted(hour: number): Action[] {
  if (hour === 3) return [{ type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units: 5 }];
  if (hour === 7) return [{ type: 'council.campaign', dynastyId: 'leclerc', seatId: 'maire' }];
  if (hour === 11) return [{ type: 'market.buy', dynastyId: 'leclerc', good: 'cloth', units: 20 }];
  return [];
}

describe('the simulation core', () => {
  it('gives the same world for the same seed and the same actions', () => {
    const first = play(town(SEED), HOURS, scripted);
    const second = play(town(SEED), HOURS, scripted);

    expect(stateHash(first.world)).toBe(stateHash(second.world));
    expect(canonicalJson(first.world)).toBe(canonicalJson(second.world));
  });

  it('gives a different world for a different seed', () => {
    expect(stateHash(play(town(SEED), HOURS, scripted).world)).not.toBe(
      stateHash(play(town(1), HOURS, scripted).world),
    );
  });

  it('never mutates the world it is given', () => {
    const world = town(SEED);
    const before = canonicalJson(world);

    tick(world, [{ type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units: 2 }]);

    expect(canonicalJson(world)).toBe(before);
  });

  it('refuses an action the dynasty cannot pay for, and says so', () => {
    const world = town(SEED);
    const refused = tick(world, [{ type: 'market.buy', dynastyId: 'leclerc', good: 'cloth', units: 10_000 }]);
    const control = tick(world, []);

    expect(refused.events).toContainEqual(
      expect.objectContaining({
        type: 'action.refused',
        audience: { dynastyId: 'leclerc' },
        action: 'market.buy',
        dynastyId: 'leclerc',
        reason: 'insufficient_funds',
      }),
    );
    expect(refused.world.dynasties.leclerc.treasuryCents).toBe(control.world.dynasties.leclerc.treasuryCents);
  });

  it('refuses an action from a dynasty that does not exist instead of throwing', () => {
    const { events } = tick(town(SEED), [{ type: 'market.buy', dynastyId: 'ghost', good: 'wool', units: 1 }]);

    expect(events[0]).toMatchObject({ type: 'action.refused', reason: 'unknown_dynasty' });
  });

  it('refuses an action type it does not know, instead of skipping it', () => {
    const malformed = { type: 'market.invent', dynastyId: 'leclerc', good: 'wool' } as unknown as Action;
    const { events } = tick(town(SEED), [malformed]);

    expect(events[0]).toMatchObject({ type: 'action.refused', reason: 'unknown_action', dynastyId: 'unknown' });
  });

  it('credits the output to the stock instead of the purse', () => {
    const { world } = tick(town(SEED));

    expect(world.dynasties.leclerc.stock.cloth).toBe(4);
    expect(world.dynasties.leclerc.stock.wool).toBe(4);
    // The first dynasty is human: its stock is not sold, and production pays no coin.
    expect(world.dynasties.leclerc.treasuryCents).toBe(RULES.startingPurseCents - 240);
  });

  it('idles a workshop with no raw material, and produces again once it is bought', () => {
    const first = play(town(SEED), 3);

    expect(first.events).toContainEqual(
      expect.objectContaining({
        type: 'workshop.idle',
        audience: { dynastyId: 'leclerc' },
        dynastyId: 'leclerc',
        good: 'cloth',
        input: 'wool',
        missingUnits: 4,
      }),
    );

    const { events } = tick(first.world, [{ type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units: 4 }]);

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'workshop.produced', dynastyId: 'leclerc', good: 'cloth', units: 4 }),
    );
  });

  it('fills the vacant seats with the AI at each scrutiny, and leaves the rest to the humans', () => {
    // Arrange: four AI dynasties for five seats; the human never stands.
    const base = town(SEED);
    const world: World = { ...base, dynasties: { ...base.dynasties }, people: { ...base.people } };
    world.dynasties.quint = {
      ...base.dynasties.fournier,
      id: 'quint',
      name: 'Quint',
      workshops: [{ id: 'workshop-1', good: 'grain', level: 1 }],
      stock: {},
    };
    world.people['person-quint'] = {
      ...base.people['person-fournier'],
      id: 'person-quint',
      dynastyId: 'quint',
      name: 'Jean Quint',
    };

    // Act
    const { world: after, events } = play(world, HOURS_PER_YEAR * 2);

    // Assert: no scrutiny announcement; the four AI hold four seats and the
    // fifth waits for a human, and no person holds two seats.
    expect(events.some((event) => event.type === 'council.scrutiny_held')).toBe(false);
    const holders = Object.values(after.seats)
      .map((seat) => seat.personId)
      .filter((personId): personId is string => personId !== null);
    expect(holders).toHaveLength(4);
    expect(new Set(holders).size).toBe(holders.length);
    expect(Object.values(after.seats).filter((seat) => seat.personId === null)).toHaveLength(1);
  });

  it('makes twenty-four ticks a year and derives the year from the hour', () => {
    // Arrange: twenty-three hours are still the first year.
    const almost = play(town(SEED), HOURS_PER_YEAR - 1).world;

    // Act: the twenty-fourth tick closes it.
    const after = tick(almost).world;

    // Assert
    expect(almost.hour).toBe(HOURS_PER_YEAR);
    expect(almost.year).toBe(START_YEAR);
    expect(after.hour).toBe(HOURS_PER_YEAR + 1);
    expect(after.year).toBe(START_YEAR + 1);
  });

  it('advances a living person one year per twenty-four ticks', () => {
    // Arrange: the first dynasty enters at twenty.
    const before = play(town(SEED), HOURS_PER_YEAR - 1).world;

    // Act
    const after = tick(before).world;

    // Assert
    expect(before.people['person-leclerc'].age).toBe(20);
    expect(after.people['person-leclerc'].age).toBe(21);
  });

  it('seats a person of the dynasty and refuses another dynasty’s person', () => {
    // Arrange
    const world = town(SEED);
    const leclerc = world.people['person-leclerc'];
    const caron = world.people['person-caron'];

    // Act and assert
    expect(takeSeat(world, 'leclerc', caron.id)).toEqual({ ok: false, reason: 'person_of_another_dynasty' });
    expect(takeSeat(world, 'leclerc', leclerc.id)).toEqual({ ok: true, seat: { personId: leclerc.id } });
  });

  it('keeps every filled seat on a living person of the dynasty that holds it', () => {
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
      expect(world.dynasties[person.dynastyId]).toBeDefined();
    }
  });

  it('lodges a candidacy at once and the noon bell closes it for the scrutiny', () => {
    // Arrange: lodged during hour one, before any noon.
    const queued = tick(town(SEED), [{ type: 'council.campaign', dynastyId: 'leclerc', seatId: 'maire' }]);

    // Assert: the bonus is in the open map at once, and the event says which
    // scrutiny it counts for. The AI may have campaigned for the same seat.
    expect(queued.world.campaigns.maire?.leclerc).toBe(RULES.campaignVoteBonus);
    expect(queued.world.engagements).toEqual([]);
    expect(queued.events).toContainEqual(
      expect.objectContaining({ type: 'council.campaigned', seatId: 'maire', countsAt: HOURS_PER_YEAR }),
    );

    // Act: run to the hour before noon, then step across the bell.
    const beforeNoon = play(queued.world, 10).world;
    const afterNoon = tick(beforeNoon).world;

    // Assert: the bell closes the open map into the one the scrutiny reads.
    expect(beforeNoon.closedCampaigns.maire).toBeUndefined();
    expect(afterNoon.closedCampaigns.maire?.leclerc).toBe(RULES.campaignVoteBonus);
    expect(afterNoon.campaigns.maire).toBeUndefined();
  });

  it('counts a candidacy lodged after the noon bell for the next scrutiny', () => {
    // Arrange: the town is past noon on its first day.
    const world = { ...town(SEED), hour: HOURS_PER_YEAR / 2 + 1 };

    // Act
    const queued = tick(world, [{ type: 'council.campaign', dynastyId: 'leclerc', seatId: 'maire' }]);

    // Assert: it waits for the scrutiny after the coming one.
    expect(queued.events).toContainEqual(
      expect.objectContaining({ type: 'council.campaigned', seatId: 'maire', countsAt: HOURS_PER_YEAR * 2 }),
    );
    expect(queued.world.campaigns.maire).toEqual({ leclerc: RULES.campaignVoteBonus });
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
      // Arrange: an engagement due at that hour.
      const world = town(SEED);
      world.engagements = [
        kind === 'site'
          ? { id: 'engagement-site', kind, dynastyId: 'leclerc', dueAt, work: 'residence' }
          : { id: 'engagement-hearing', kind, dynastyId: 'leclerc', dueAt },
      ];

      // Act: run to the due hour, then one tick more.
      const early = play(world, dueAt - world.hour);
      const due = tick(early.world);

      // Assert
      expect(early.events.filter((event) => event.type === 'engagement.resolved')).toEqual([]);
      expect(due.events).toContainEqual(
        expect.objectContaining({ type: 'engagement.resolved', kind, dueAt, resolvedAt: dueAt }),
      );
      expect(due.world.engagements).toEqual([]);
    }
  });

  it('resolves an engagement behind the town clock by the next tick instead of dropping it', () => {
    // Arrange: an older state can leave the counter past a due hour. A cap jump
    // moves only the wall clock, so this is the defensive path, not the normal one.
    const world = town(SEED);
    world.hour = 900;
    world.engagements = [{ id: 'engagement-late', kind: 'site', dynastyId: 'leclerc', dueAt: 800, work: 'residence' }];

    // Act
    const { world: after, events } = tick(world);

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'engagement.resolved',
        engagementId: 'engagement-late',
        kind: 'site',
        dueAt: 800,
        resolvedAt: 900,
      }),
    );
    expect(after.engagements).toEqual([]);
  });

  it('keeps a campaign for one seat out of another seat vote', () => {
    // Arrange: both worlds reach the same scrutiny, one with a campaign for the treasury.
    const control = play(town(SEED), HOURS_PER_YEAR);
    const campaigned = play(town(SEED), HOURS_PER_YEAR, (hour) =>
      hour === 0 ? [{ type: 'council.campaign', dynastyId: 'leclerc', seatId: 'tresorier' }] : [],
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
    world.dynasties.leclerc.treasuryCents = 0;
    world.dynasties.leclerc.stock = {};
    world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'wool', level: 3 }];
    const upkeep = 3 * RULES.upkeepPerWorkshopLevelCents;

    const { world: after, events } = tick(world);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'dynasty.penniless',
        audience: { dynastyId: 'leclerc' },
        dynastyId: 'leclerc',
        shortfallCents: upkeep,
      }),
    );
    expect(after.dynasties.leclerc.debtCents).toBe(upkeep);
  });

  it('refuses an action from a dormant dynasty instead of running it', () => {
    // Arrange
    const world = town(SEED);
    world.dynasties.leclerc.dormant = true;

    // Act
    const { world: after, events } = tick(world, [
      { type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units: 1 },
    ]);

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'action.refused',
        audience: { dynastyId: 'leclerc' },
        action: 'market.buy',
        dynastyId: 'leclerc',
        reason: 'dormant_dynasty',
      }),
    );
    expect(after.dynasties.leclerc.stock.wool).toBe(8);
  });

  it('vacates a dormant dynasty’s seat, stops its trade and keeps it out of the vote', () => {
    // Arrange: the human holds the mayoralty, then goes dormant.
    const world = town(SEED);
    world.seats.maire = { personId: 'person-leclerc' };
    world.dynasties.leclerc.dormant = true;
    // A workshop with no input, so any sale at all would be the dormant dynasty
    // running when it must not.
    world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'wool', level: 2 }];
    world.dynasties.leclerc.stock = {};
    const treasuryCents = world.dynasties.leclerc.treasuryCents;

    // Act: one plain hour, then the five periods that bring the next scrutiny.
    const quiet = tick(world);
    const later = play(quiet.world, HOURS_PER_YEAR * 5);

    // Assert: the dormant holder does not trade, leaves the seat vacant at the
    // first scrutiny, and votes in none of them.
    expect(quiet.events.filter((event) => event.type === 'market.sold' && event.dynastyId === 'leclerc')).toEqual([]);
    expect(quiet.world.dynasties.leclerc.treasuryCents).toBe(treasuryCents);
    expect(
      later.events.some(
        (event) => event.type === 'council.election_held' && event.seatId === 'maire' && event.winnerDynastyId === null,
      ),
    ).toBe(true);
    for (const event of later.events) {
      if (event.type === 'council.election_held') {
        expect(event.votes['leclerc']).toBeUndefined();
      }
    }
  });

  it('shows a dynasty-ledger event to that dynasty only', () => {
    // Arrange
    const { events } = tick(town(SEED));

    // Act
    const forLeclerc = visibleTo(events, 'leclerc');
    const forCaron = visibleTo(events, 'caron');

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'dynasty.upkeep_paid', dynastyId: 'caron', audience: { dynastyId: 'caron' } }),
    );
    expect(forLeclerc.filter((event) => event.type === 'dynasty.upkeep_paid' && event.dynastyId === 'caron')).toEqual(
      [],
    );
    expect(
      forCaron.filter((event) => event.type === 'dynasty.upkeep_paid' && event.dynastyId === 'caron'),
    ).toHaveLength(1);
  });

  it('ticks a town of twenty dynasties', () => {
    // Arrange
    const base = town(SEED);
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
    const { world: after } = play(world, 2);

    // Assert
    expect(Object.keys(after.dynasties)).toHaveLength(20);
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

    for (const dynasty of Object.values(world.dynasties)) {
      expect(Number.isInteger(dynasty.treasuryCents)).toBe(true);
      expect(Number.isInteger(dynasty.debtCents)).toBe(true);
    }
    for (const price of Object.values(world.market)) {
      expect(Number.isInteger(price)).toBe(true);
    }
  });
});

describe('the generator', () => {
  it('escapes the zero fixed point', () => {
    expect(advanceRng(0)).toBeGreaterThan(0);
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

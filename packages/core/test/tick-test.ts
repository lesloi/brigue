import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  advanceRng,
  canonicalJson,
  createWorld,
  FORMAT_VERSION,
  RULES,
  SEATS,
  START_YEAR,
  stateHash,
  takeSeat,
  visibleTo,
  HOURS_PER_YEAR,
  WorldVersionError,
} from '../src/index.ts';
import { tick } from './helpers.ts';
import type { Action, Event, World } from '../src/index.ts';

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
  if (hour === 3) return [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 5 }];
  if (hour === 7) return [{ type: 'council.campaign', houseId: 'brigue', seatId: 'maire' }];
  if (hour === 11) return [{ type: 'market.buy', houseId: 'brigue', good: 'cloth', units: 20 }];
  return [];
}

describe('the simulation core', () => {
  it('gives the same world for the same seed and the same actions', () => {
    const first = play(createWorld(SEED), HOURS, scripted);
    const second = play(createWorld(SEED), HOURS, scripted);

    expect(stateHash(first.world)).toBe(stateHash(second.world));
    expect(canonicalJson(first.world)).toBe(canonicalJson(second.world));
  });

  it('gives a different world for a different seed', () => {
    expect(stateHash(play(createWorld(SEED), HOURS, scripted).world)).not.toBe(
      stateHash(play(createWorld(1), HOURS, scripted).world),
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

    expect(refused.events).toContainEqual(
      expect.objectContaining({
        type: 'action.refused',
        audience: { houseId: 'brigue' },
        action: 'market.buy',
        houseId: 'brigue',
        reason: 'insufficient_funds',
      }),
    );
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

  it('credits the output to the stock instead of the purse', () => {
    const { world } = tick(createWorld(SEED));

    expect(world.houses.brigue.stock.cloth).toBe(4);
    expect(world.houses.brigue.stock.wool).toBe(4);
    // The founder is human: its stock is not sold, and production pays no coin.
    expect(world.houses.brigue.treasuryCents).toBe(117340 - 240);
  });

  it('idles a workshop with no raw material, and produces again once it is bought', () => {
    const first = play(createWorld(SEED), 3);

    expect(first.events).toContainEqual(
      expect.objectContaining({
        type: 'workshop.idle',
        audience: { houseId: 'brigue' },
        houseId: 'brigue',
        good: 'cloth',
        input: 'wool',
        missingUnits: 4,
      }),
    );

    const { events } = tick(first.world, [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 4 }]);

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'workshop.produced', houseId: 'brigue', good: 'cloth', units: 4 }),
    );
  });

  it('holds one scrutiny per game year and puts every seat up', () => {
    // Arrange: five houses, so five seats can actually be filled, and two years.
    const base = createWorld(SEED);
    const world: World = { ...base, houses: { ...base.houses }, people: { ...base.people } };
    world.houses.quint = {
      ...base.houses.herse,
      id: 'quint',
      name: 'Quint',
      workshops: [{ good: 'grain', level: 1, workers: 1 }],
      stock: {},
    };
    world.people['person-quint'] = {
      ...base.people['person-herse'],
      id: 'person-quint',
      houseId: 'quint',
      name: 'Jean Quint',
    };

    // Act
    const { world: after, events } = play(world, HOURS_PER_YEAR * 2);

    // Assert: one scrutiny each year, and every seat is contested in each.
    const scrutinies = events.filter(
      (event): event is Extract<Event, { type: 'council.scrutiny_held' }> => event.type === 'council.scrutiny_held',
    );
    expect(scrutinies.map((event) => event.year)).toEqual([START_YEAR, START_YEAR + 1]);
    for (const scrutiny of scrutinies) {
      expect(scrutiny.seats).toEqual([...SEATS]);
    }

    const elections = events.filter(
      (event): event is Extract<Event, { type: 'council.election_held' }> => event.type === 'council.election_held',
    );
    for (const seatId of SEATS) {
      expect(elections.filter((event) => event.seatId === seatId)).toHaveLength(2);
    }
    for (const seatId of SEATS) {
      expect(after.seats[seatId].personId).not.toBeNull();
    }

    const holders = Object.values(after.seats)
      .map((seat) => seat.personId)
      .filter((personId): personId is string => personId !== null);
    expect(new Set(holders).size).toBe(holders.length);
  });

  it('makes twenty-four ticks a year and derives the year from the hour', () => {
    // Arrange: twenty-three hours are still the first year.
    const almost = play(createWorld(SEED), HOURS_PER_YEAR - 1).world;

    // Act: the twenty-fourth tick closes it.
    const after = tick(almost).world;

    // Assert
    expect(almost.hour).toBe(HOURS_PER_YEAR);
    expect(almost.year).toBe(START_YEAR);
    expect(after.hour).toBe(HOURS_PER_YEAR + 1);
    expect(after.year).toBe(START_YEAR + 1);
  });

  it('advances a living person one year per twenty-four ticks', () => {
    // Arrange: the founder enters at twenty.
    const before = play(createWorld(SEED), HOURS_PER_YEAR - 1).world;

    // Act
    const after = tick(before).world;

    // Assert
    expect(before.people['person-brigue'].age).toBe(20);
    expect(after.people['person-brigue'].age).toBe(21);
  });

  it('seats a person of the house and refuses another house’s person', () => {
    // Arrange
    const world = createWorld(SEED);
    const brigue = world.people['person-brigue'];
    const caron = world.people['person-caron'];

    // Act and assert
    expect(takeSeat(world, 'brigue', caron.id)).toEqual({ ok: false, reason: 'person_of_another_house' });
    expect(takeSeat(world, 'brigue', brigue.id)).toEqual({ ok: true, seat: { personId: brigue.id } });
  });

  it('keeps every filled seat on a living person of the house that holds it', () => {
    // Arrange and act: enough hours to fill every seat once.
    const { world } = play(createWorld(SEED), HOURS_PER_YEAR * 6);

    // Assert
    for (const seat of Object.values(world.seats)) {
      if (seat.personId === null) {
        continue;
      }
      const person = world.people[seat.personId];
      expect(person).toBeDefined();
      expect(person.alive).toBe(true);
      expect(world.houses[person.houseId]).toBeDefined();
    }
  });

  it('lodges a candidacy at once and the noon bell closes it for the scrutiny', () => {
    // Arrange: lodged during hour one, before any noon.
    const queued = tick(createWorld(SEED), [{ type: 'council.campaign', houseId: 'brigue', seatId: 'maire' }]);

    // Assert: the bonus is in the open map at once, and the event says which
    // scrutiny it counts for.
    expect(queued.world.campaigns.maire).toEqual({ brigue: RULES.campaignVoteBonus });
    expect(queued.world.engagements).toEqual([]);
    expect(queued.events).toContainEqual(
      expect.objectContaining({ type: 'council.campaigned', seatId: 'maire', countsAt: HOURS_PER_YEAR }),
    );

    // Act: run to the hour before noon, then step across the bell.
    const beforeNoon = play(queued.world, 10).world;
    const afterNoon = tick(beforeNoon).world;

    // Assert: the bell closes the open map into the one the scrutiny reads.
    expect(beforeNoon.closedCampaigns.maire).toBeUndefined();
    expect(afterNoon.closedCampaigns.maire).toEqual({ brigue: RULES.campaignVoteBonus });
    expect(afterNoon.campaigns.maire).toBeUndefined();
  });

  it('counts a candidacy lodged after the noon bell for the next scrutiny', () => {
    // Arrange: the town is past noon on its first day.
    const world = { ...createWorld(SEED), hour: HOURS_PER_YEAR / 2 + 1 };

    // Act
    const queued = tick(world, [{ type: 'council.campaign', houseId: 'brigue', seatId: 'maire' }]);

    // Assert: it waits for the scrutiny after the coming one.
    expect(queued.events).toContainEqual(
      expect.objectContaining({ type: 'council.campaigned', seatId: 'maire', countsAt: HOURS_PER_YEAR * 2 }),
    );
    expect(queued.world.campaigns.maire).toEqual({ brigue: RULES.campaignVoteBonus });
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
      const world = createWorld(SEED);
      world.engagements = [{ id: `engagement-${kind}`, kind, houseId: 'brigue', dueAt }];

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
    const world = createWorld(SEED);
    world.hour = 900;
    world.engagements = [{ id: 'engagement-late', kind: 'site', houseId: 'brigue', dueAt: 800 }];

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
    const control = play(createWorld(SEED), HOURS_PER_YEAR);
    const campaigned = play(createWorld(SEED), HOURS_PER_YEAR, (hour) =>
      hour === 0 ? [{ type: 'council.campaign', houseId: 'brigue', seatId: 'tresorier' }] : [],
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

  it('turns unpaid wages into a debt instead of erasing them', () => {
    const world = createWorld(SEED);
    world.houses.brigue.treasuryCents = 0;
    world.houses.brigue.stock = {};
    world.houses.brigue.workshops = [{ good: 'wool', level: 0, workers: 3 }];

    const { world: after, events } = tick(world);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'house.penniless',
        audience: { houseId: 'brigue' },
        houseId: 'brigue',
        shortfallCents: 360,
      }),
    );
    expect(after.houses.brigue.debtCents).toBe(360);
  });

  it('refuses an action from a dormant house instead of running it', () => {
    // Arrange
    const world = createWorld(SEED);
    world.houses.brigue.dormant = true;

    // Act
    const { world: after, events } = tick(world, [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 1 }]);

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'action.refused',
        audience: { houseId: 'brigue' },
        action: 'market.buy',
        houseId: 'brigue',
        reason: 'dormant_house',
      }),
    );
    expect(after.houses.brigue.stock.wool).toBe(8);
  });

  it('keeps a dormant house’s seat, stops its trade and keeps it out of the vote', () => {
    // Arrange: one election fills the mayoralty, then its holder goes dormant.
    const elected = play(createWorld(SEED), HOURS_PER_YEAR).world;
    const personId = elected.seats.maire.personId as string;
    const holder = elected.people[personId];
    const house = elected.houses[holder.houseId];
    house.dormant = true;
    // A workshop with no input, so any sale at all would be the dormant house
    // running when it must not.
    house.workshops = [{ good: 'wool', level: 2, workers: 2 }];
    house.stock = {};
    const treasuryCents = house.treasuryCents;

    // Act: one plain hour, then the five periods that bring the seat back.
    const quiet = tick(elected);
    const later = play(quiet.world, HOURS_PER_YEAR * 5);

    // Assert
    expect(quiet.events.filter((event) => event.type === 'market.sold' && event.houseId === holder.houseId)).toEqual(
      [],
    );
    expect(quiet.world.houses[holder.houseId].treasuryCents).toBe(treasuryCents);
    expect(later.world.seats.maire.personId).toBe(personId);
    expect(later.events.filter((event) => event.type === 'council.election_held' && event.seatId === 'maire')).toEqual(
      [],
    );
    for (const event of later.events) {
      if (event.type === 'council.election_held') {
        expect(event.votes[holder.houseId]).toBeUndefined();
      }
    }
  });

  it('shows a house-ledger event to that house only', () => {
    // Arrange
    const { events } = tick(createWorld(SEED));

    // Act
    const forBrigue = visibleTo(events, 'brigue');
    const forCaron = visibleTo(events, 'caron');

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'house.wages_paid', houseId: 'caron', audience: { houseId: 'caron' } }),
    );
    expect(forBrigue.filter((event) => event.type === 'house.wages_paid' && event.houseId === 'caron')).toEqual([]);
    expect(forCaron.filter((event) => event.type === 'house.wages_paid' && event.houseId === 'caron')).toHaveLength(1);
  });

  it('ticks a town of twenty houses', () => {
    // Arrange
    const base = createWorld(SEED);
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

    // Act
    const { world: after } = play(world, 2);

    // Assert
    expect(Object.keys(after.houses)).toHaveLength(20);
    expect(after.hour).toBe(3);
  });

  it('refuses a world written by another ruleset', () => {
    const world = createWorld(SEED);
    world.rulesetVersion += 1;

    expect(() => tick(world)).toThrow(WorldVersionError);
  });

  it('refuses a world of the previous format instead of guessing it', () => {
    // Arrange
    const world = { ...createWorld(SEED), formatVersion: FORMAT_VERSION - 1 };

    // Act and assert
    expect(FORMAT_VERSION).toBe(1);
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

import { describe, expect, it } from 'vitest';

import {
  advance,
  createWorld,
  displayedPrestige,
  HOURS_PER_YEAR,
  nextTitle,
  RULES,
  stockCapacityUnits,
  stockUnits,
  TITLES,
  titleOf,
  workshopCap,
  workshopLevelCap,
  withFirstDynasty,
  type Action,
  type Event,
  type World,
} from '../src/index.ts';
import { TEST_FIRST_DYNASTY, tick, town } from './helpers.ts';

const SEED = 20261107;

/** Plays hour by hour, placing the actions on the hour they are given for. */
function play(
  world: World,
  until: number,
  actions: (hour: number) => Action[] = () => [],
): { world: World; events: Event[] } {
  const placed = [];
  for (let hour = world.hour; hour <= until; hour += 1) {
    for (const action of actions(hour)) {
      placed.push({ at: hour, action });
    }
  }

  return advance(world, until, placed);
}

function leased(world: World, dynastyId: string) {
  return world.dynasties[dynastyId];
}

function refusal(events: Event[], reason: string) {
  return events.find((event) => event.type === 'action.refused' && event.reason === reason);
}

describe('workshops, trades and the ladder', () => {
  it('sums the warehouse from what each workshop level holds', () => {
    // Arrange: the kit's level 2 loom, and a second one after a build.
    const world = town(SEED);

    // Assert
    expect(stockCapacityUnits(world.dynasties.leclerc)).toBe(200);
    expect(stockCapacityUnits(createWorld(SEED).dynasties.caron)).toBe(350);
  });

  it('builds a workshop that works the new chain, and charges for it', () => {
    // Arrange: a purse that pays the build and the upkeep of the site's hours.
    const world = town(SEED);
    world.dynasties.leclerc.treasuryCents = 1_000_000;
    const treasury = world.dynasties.leclerc.treasuryCents;

    // A second building needs a residence that holds two: the level 1 holds one.
    world.dynasties.leclerc.title = 'bourgeois';
    world.dynasties.leclerc.residenceLevel = 3;

    // Act: the build is a twelve-hour site.
    const { world: after, events } = play(world, world.hour + RULES.siteHours, (hour) =>
      hour === world.hour ? [{ type: 'workshop.build', dynastyId: 'leclerc', trade: 'baker' }] : [],
    );

    // Assert: paid at the opening, the workshop appears when the site falls due.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'workshop.built', audience: { dynastyId: 'leclerc' }, trade: 'baker' }),
    );
    expect(leased(after, 'leclerc').workshops).toHaveLength(2);
    expect(leased(after, 'leclerc').workshops[1]?.good).toBe('bread');
    expect(leased(after, 'leclerc').workshops[1]?.level).toBe(RULES.builtWorkshopLevel);
    // The purse moved by the build and by the upkeep of every hour since: the
    // site is the new workshop's, which does not exist yet, so it stops nothing,
    // and the dynasty also earned what it sold.
    expect(treasury - leased(after, 'leclerc').treasuryCents).toBeGreaterThanOrEqual(RULES.buildCents);
  });

  it('counts the site against the residence cap, so two builds cannot beat a cap of one', () => {
    // Arrange: a dynasty at residence 1, which holds one workshop it already has.
    const world = town(SEED);

    // Act
    const { world: after, events } = tick(world, [{ type: 'workshop.build', dynastyId: 'leclerc', trade: 'baker' }]);

    // Assert
    expect(refusal(events, 'workshop_cap')).toBeDefined();
    expect(leased(after, 'leclerc').workshops).toHaveLength(1);
    expect(after.engagements).toEqual([]);
  });

  it('refuses to destroy the last workshop', () => {
    // Arrange
    const world = town(SEED);
    const workshopId = leased(world, 'leclerc').workshops[0]!.id;

    // Act
    const { world: after, events } = tick(world, [{ type: 'workshop.destroy', dynastyId: 'leclerc', workshopId }]);

    // Assert
    expect(refusal(events, 'last_workshop')).toBeDefined();
    expect(leased(after, 'leclerc').workshops).toHaveLength(1);
  });

  it('destroys a workshop with no refund, and keeps the stock it cannot hold', () => {
    // Arrange: two workshops and a warehouse above what one level 2 holds.
    const world = town(SEED);
    const [first, second] = [
      leased(world, 'leclerc').workshops[0]!,
      { id: 'workshop-2', good: 'bread' as const, level: 2 },
    ];
    leased(world, 'leclerc').workshops = [first, second];
    leased(world, 'leclerc').stock = { wool: 300 };
    const treasury = leased(world, 'leclerc').treasuryCents;

    // Act
    const { world: after } = tick(world, [{ type: 'workshop.destroy', dynastyId: 'leclerc', workshopId: second.id }]);

    // Assert: nothing is credited, nothing is confiscated, and the cap fell.
    expect(leased(after, 'leclerc').workshops).toHaveLength(1);
    expect(stockUnits(leased(after, 'leclerc'))).toBeGreaterThanOrEqual(300);
    expect(leased(after, 'leclerc').treasuryCents).toBeLessThanOrEqual(treasury);
    expect(stockCapacityUnits(leased(after, 'leclerc'))).toBe(200);
  });

  it('raises a workshop one level at a time, for hours and no money, up to the title cap', () => {
    // Arrange: a roturier, whose cap is 2, and its level 2 loom.
    const world = town(SEED);
    const workshopId = leased(world, 'leclerc').workshops[0]!.id;

    // Act: the upgrade is refused at the cap, then allowed once the title opens it.
    const { events } = tick(world, [{ type: 'workshop.upgrade', dynastyId: 'leclerc', workshopId }]);
    const promoted = town(SEED);
    promoted.dynasties.leclerc.title = 'bourgeois';
    const run = play(promoted, promoted.hour + RULES.improvementHours[3], (hour) =>
      hour === promoted.hour ? [{ type: 'workshop.upgrade', dynastyId: 'leclerc', workshopId }] : [],
    );

    // Assert
    expect(refusal(events, 'level_cap')).toBeDefined();
    expect(run.events).toContainEqual(
      expect.objectContaining({ type: 'workshop.upgraded', dynastyId: 'leclerc', level: 3 }),
    );
    expect(leased(run.world, 'leclerc').workshops[0]?.level).toBe(3);
    expect(stockCapacityUnits(leased(run.world, 'leclerc'))).toBe(350);
  });

  it('stops production for the hours a workshop is under improvement', () => {
    // Arrange: a loom with wool, on a short works.
    const world = town(SEED);
    world.dynasties.leclerc.title = 'bourgeois';
    world.dynasties.leclerc.stock = { wool: 60 };
    const workshopId = 'workshop-1';

    // Act: the improvement is open at the first hour, and its site runs one hour.
    const started = tick(world, [{ type: 'workshop.upgrade', dynastyId: 'leclerc', workshopId }]);

    // Assert: no cloth is woven while the site is open, and the wool is untouched.
    expect(started.world.dynasties.leclerc.stock).toEqual({ wool: 60 });
  });

  it('refuses a second site while one is under way', () => {
    // Arrange: a dynasty whose residence holds two, so only the site guard can refuse.
    const world = town(SEED);
    world.dynasties.leclerc.title = 'bourgeois';
    world.dynasties.leclerc.residenceLevel = 3;
    world.dynasties.leclerc.treasuryCents = 1_000_000;

    // Act: a build opens a site, a destroy in the same hour is refused.
    const { world: after, events } = tick(world, [
      { type: 'workshop.build', dynastyId: 'leclerc', trade: 'baker' },
      { type: 'workshop.destroy', dynastyId: 'leclerc', workshopId: 'workshop-1' },
    ]);

    // Assert
    expect(refusal(events, 'site_in_progress')).toBeDefined();
    expect(after.engagements).toHaveLength(1);
    expect(after.dynasties.leclerc?.workshops).toHaveLength(1);
  });

  it("holds a dormant dynasty's site until it comes back", () => {
    // Arrange: a dynasty that went silent while its works were open.
    const world = town(SEED);
    world.dynasties.leclerc.title = 'bourgeois';
    world.dynasties.leclerc.dormant = true;

    // Act
    const { world: after, events } = tick(world, [
      { type: 'workshop.upgrade', dynastyId: 'leclerc', workshopId: 'workshop-1' },
    ]);

    // Assert: the action is refused, and nothing opens.
    expect(refusal(events, 'dormant_dynasty')).toBeDefined();
    expect(after.engagements).toEqual([]);
  });

  it('pays no upkeep for a workshop under improvement', () => {
    // Arrange: a dynasty with a purse and no stock to sell.
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'wool', level: 2 }];
    world.dynasties.leclerc.title = 'bourgeois';
    world.dynasties.leclerc.stock = { wool: 50 };
    const workshopId = 'workshop-1';

    // Act: the improvement starts, then one more hour.
    const started = tick(world, [{ type: 'workshop.upgrade', dynastyId: 'leclerc', workshopId }]);
    const after = tick(started.world);

    // Assert: no upkeep is charged for that workshop while it is a site, so the
    // purse does not move at all.
    expect(after.world.dynasties.leclerc.treasuryCents).toBe(world.dynasties.leclerc.treasuryCents);
  });

  it('obtains a title at the next noon or midnight', () => {
    // Arrange: a town at the first hour, which is just after midnight.
    const world = town(SEED);
    world.dynasties.leclerc.treasuryCents = 1_000_000;
    const price = 60_000;

    // Act: bought at the first hour, obtained at the coming noon.
    const { world: after, events } = play(world, HOURS_PER_YEAR / 2, (hour) =>
      hour === world.hour ? [{ type: 'dynasty.buy_title', dynastyId: 'leclerc' }] : [],
    );

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'dynasty.title_received',
        dynastyId: 'leclerc',
        title: 'bourgeois',
        dueAt: HOURS_PER_YEAR / 2,
      }),
    );
    expect(titleOf(leased(after, 'leclerc'))).toBe('bourgeois');
    expect(world.dynasties.leclerc.treasuryCents - leased(after, 'leclerc').treasuryCents).toBeGreaterThanOrEqual(
      price,
    );
  });

  it('refuses a title the dynasty cannot pay for, and names the missing money', () => {
    // Arrange
    const world = town(SEED);
    leased(world, 'leclerc').treasuryCents = 10;

    // Act
    const { world: after, events } = tick(world, [{ type: 'dynasty.buy_title', dynastyId: 'leclerc' }]);

    // Assert: nothing is opened and the degree does not move.
    expect(refusal(events, 'insufficient_funds')).toBeDefined();
    expect(titleOf(leased(after, 'leclerc'))).toBe('roturier');
    expect(after.engagements).toEqual([]);
  });

  it('opens the residence only as far as the title did', () => {
    // Arrange: a roturier, whose degree opens level 1.
    const world = town(SEED);
    leased(world, 'leclerc').treasuryCents = 1_000_000;

    // Act
    const { world: after, events } = tick(world, [{ type: 'dynasty.upgrade_residence', dynastyId: 'leclerc' }]);

    // Assert
    expect(refusal(events, 'title_open')).toBeDefined();
    expect(leased(after, 'leclerc').residenceLevel).toBe(1);
  });

  it('charges a title bought twice in one hour only once', () => {
    // Arrange: the same degree ordered twice before the hour plays.
    const world = town(SEED);
    world.dynasties.leclerc.treasuryCents = 1_000_000;

    // Act
    const { world: after, events } = tick(world, [
      { type: 'dynasty.buy_title', dynastyId: 'leclerc' },
      { type: 'dynasty.buy_title', dynastyId: 'leclerc' },
    ]);

    // Assert: one works, one charge, one refusal.
    expect(
      after.engagements.filter((engagement) => engagement.kind === 'site' && engagement.work === 'title'),
    ).toHaveLength(1);
    expect(refusal(events, 'site_in_progress')).toBeDefined();
    expect(world.dynasties.leclerc.treasuryCents - leased(after, 'leclerc').treasuryCents).toBeGreaterThanOrEqual(
      60_000,
    );
    expect(world.dynasties.leclerc.treasuryCents - leased(after, 'leclerc').treasuryCents).toBeLessThan(
      60_000 + 100_000,
    );
  });

  it('pays for a residence level the title opened, and the level caps prestige and workshops', () => {
    // Arrange: a bourgeois has opened level 2; level 1 holds one workshop.
    const world = town(SEED);
    leased(world, 'leclerc').title = 'bourgeois';
    leased(world, 'leclerc').treasuryCents = 1_000_000;
    expect(workshopCap(leased(world, 'leclerc'))).toBe(1);

    // Act
    const run = play(world, world.hour + RULES.improvementHours[2], (hour) =>
      hour === world.hour ? [{ type: 'dynasty.upgrade_residence', dynastyId: 'leclerc' }] : [],
    );

    // Assert
    const dynasty = leased(run.world, 'leclerc');
    expect(dynasty.residenceLevel).toBe(2);
    // Level 2 holds one workshop as well: the second service arrives at level 3.
    expect(workshopCap(dynasty)).toBe(1);
    expect(displayedPrestige(dynasty)).toBe(80 + 50 + Math.min(dynasty.prestige, 300));
  });

  it('shows the prestige of the title and of the residence, and caps only the service', () => {
    // Arrange: a patrician at residence 4, with more service than the cap allows.
    const world = town(SEED);
    const dynasty = leased(world, 'leclerc');
    dynasty.title = 'patricien';
    dynasty.residenceLevel = 4;
    dynasty.prestige = 10_000;

    // Assert: the title adds its 140 and the residence 90, the service stops at 500.
    expect(displayedPrestige(dynasty)).toBe(140 + 90 + 500);
    expect(workshopLevelCap(dynasty)).toBe(4);
  });

  it('walks the twelve degrees in order and stops at the prince', () => {
    expect(TITLES).toHaveLength(12);
    for (let index = 0; index < TITLES.length - 1; index += 1) {
      expect(nextTitle(TITLES[index]!)).toBe(TITLES[index + 1]);
    }
    expect(nextTitle('prince')).toBeUndefined();
  });

  it('names the first dynasty from what it is given, with an id that is not its name', () => {
    // Arrange
    const identity = { ...TEST_FIRST_DYNASTY, id: 'dynasty-7f3a', dynastyName: 'Moreau', personName: 'Colin Moreau' };

    // Act
    const world = withFirstDynasty(createWorld(SEED), 'weaver', identity);

    // Assert
    expect(world.dynasties['dynasty-7f3a']?.name).toBe('Moreau');
    expect(world.people['person-dynasty-7f3a']?.name).toBe('Colin Moreau');
  });
});

import {
  PACING,
  type GoodId,
  type House,
  type Law,
  type Seat,
  type SeatId,
  type Workshop,
  type World,
} from '@brigue/core';

export interface OwnHouseView {
  id: string;
  name: string;
  treasuryCents: number;
  debtCents: number;
  favour: number;
  prestige: number;
  career: number;
  dormant: boolean;
  workshops: Workshop[];
  stock: Partial<Record<GoodId, number>>;
}

/** What the town knows about another house: its name and standing, not its purse. */
export interface PublicHouseView {
  id: string;
  name: string;
  prestige: number;
  dormant: boolean;
}

/** A person the client may name when a seat points at them. No attributes, no age. */
export interface PublicPersonView {
  id: string;
  houseId: string;
  name: string;
}

export interface WorldProjection {
  week: number;
  year: number;
  house: OwnHouseView;
  town: {
    houses: PublicHouseView[];
    people: PublicPersonView[];
    seats: Record<SeatId, Seat>;
    laws: Law[];
    market: Record<GoodId, number>;
  };
  /** The instant the current week ends, so the client can show the next tick. */
  nextTickAt: string;
}

/**
 * The client renders, it decides nothing: it gets its own house in full and the
 * rest of the town at the detail the town itself would show. The seed, the
 * generator and other houses' treasuries never leave the server.
 */
export function projectWorld(world: World, houseId: string, weekStartedAt: Date): WorldProjection {
  const house = world.houses[houseId];
  if (!house) {
    // The token points at a house the world no longer holds: a server bug, not
    // something to paper over with a made-up house.
    throw new Error(`world ${world.seed} has no house ${houseId}`);
  }

  return {
    week: world.week,
    year: world.year,
    house: ownHouse(house),
    town: {
      houses: Object.values(world.houses)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          prestige: candidate.prestige,
          dormant: candidate.dormant,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      people: Object.values(world.people)
        .map((person) => ({ id: person.id, houseId: person.houseId, name: person.name }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      seats: structuredClone(world.seats),
      laws: structuredClone(world.laws),
      market: structuredClone(world.market),
    },
    nextTickAt: new Date(weekStartedAt.getTime() + PACING.minutesPerWeek * 60_000).toISOString(),
  };
}

function ownHouse(house: House): OwnHouseView {
  return {
    id: house.id,
    name: house.name,
    treasuryCents: house.treasuryCents,
    debtCents: house.debtCents,
    favour: house.favour,
    prestige: house.prestige,
    career: house.career,
    dormant: house.dormant,
    workshops: structuredClone(house.workshops),
    stock: structuredClone(house.stock),
  };
}

import { randomInt } from 'node:crypto';

import type { HouseIdentity, World } from '@brigue/core';

/**
 * The places a town can take. A name may come back; the id is assigned by the
 * database and never does.
 */
export const TOWN_NAMES = [
  'Amiens',
  'Arras',
  'Beauvais',
  'Béthune',
  'Blois',
  'Boulogne',
  'Bourges',
  'Bruges',
  'Cambrai',
  'Compiègne',
  'Douai',
  'Gand',
  'Laon',
  'Lille',
  'Louvain',
  'Malines',
  'Meaux',
  'Mons',
  'Noyon',
  'Péronne',
  'Provins',
  'Reims',
  'Rouen',
  'Saint-Omer',
  'Senlis',
  'Soissons',
  'Tournai',
  'Troyes',
  'Valenciennes',
  'Ypres',
] as const;

/**
 * The names the first house can take. None of them is an AI house's: a town
 * with two Carons would make the register unreadable.
 */
export const HOUSE_NAMES = [
  'Leclerc',
  'Moreau',
  'Hébert',
  'Delaunay',
  'Garnier',
  'Perrin',
  'Aubry',
  'Boucher',
  'Dufour',
  'Lemoine',
  'Marchand',
  'Renard',
  'Roux',
  'Simon',
  'Thibault',
  'Vaillant',
  'de Gambais',
  'de Sacy',
  'Le Noir',
  'Bourdon',
  'Favre',
  'Guérin',
  'Hamon',
  'Joubert',
  'Leroy',
  'Massé',
  'Olivier',
  'Poulain',
  'Regnier',
  'Tessier',
  'Vidal',
] as const;

/** The first names a person of the town can carry. */
export const PERSON_NAMES = [
  'Colin',
  'Jehan',
  'Perrin',
  'Hugues',
  'Margot',
  'Aaliz',
  'Guillemette',
  'Thomas',
  'Robin',
  'Nicolas',
  'Jeanne',
  'Pierre',
  'Martin',
  'Berthe',
  'Adenet',
  'Clémence',
] as const;

/**
 * The identity of the first house, drawn when its player joins: a name the
 * town does not already use, a first name for the person, and an id derived
 * from the name. Nothing about the first house is fixed.
 */
export function drawHouseIdentity(world: World): HouseIdentity {
  const taken = new Set(Object.values(world.houses).map((house) => house.name.toLowerCase()));
  const free = HOUSE_NAMES.filter((name) => !taken.has(name.toLowerCase()));
  const houseName = free.length > 0 ? free[randomInt(free.length)] : `Maison ${Object.keys(world.houses).length + 1}`;
  const firstName = PERSON_NAMES[randomInt(PERSON_NAMES.length)];

  return {
    id: uniqueHouseId(world, slug(houseName)),
    houseName,
    personName: `${firstName} ${houseName}`,
  };
}

/** The id is the name's slug, made unique against the houses already there. */
function uniqueHouseId(world: World, base: string): string {
  let id = base;
  let suffix = 2;

  while (world.houses[id] !== undefined) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }

  return id;
}

/**
 * The name of a new town, drawn when a join founds one. Names may repeat: the
 * id is assigned by the database, so a dead town's name can come back without
 * bringing its id with it.
 */
export function drawTownName(): string {
  return TOWN_NAMES[randomInt(TOWN_NAMES.length)];
}

function slug(name: string): string {
  const plain = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return plain === '' ? 'maison' : plain;
}

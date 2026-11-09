import { randomInt, randomUUID } from 'node:crypto';

import { DYNASTY_NAMES, nameKey } from '@brigue/core';

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

/** How many draws a suggestion may make before the pool is called exhausted. */
const SUGGESTION_DRAWS = 4;

/**
 * The family name the creation screen offers, drawn from the pool and from
 * nothing else. It is a suggestion, not a rule: the player rewrites it or keeps
 * it, and the check of what is kept happens when the account is made.
 *
 * The pool moves no generator: the world's own stream is what a tick draws
 * from, and a suggestion is the screen's business, so several draws are made
 * until one is free, then the caller writes its own.
 */
export function suggestFamilyName(worldNames: Iterable<string>, elsewhere: ReadonlySet<string> = new Set()): string {
  const taken = new Set(Array.from(worldNames, (name) => nameKey(name)));
  let drawn: string | undefined;

  for (let draw = 0; draw < SUGGESTION_DRAWS && drawn === undefined; draw += 1) {
    const candidate = DYNASTY_NAMES[randomInt(DYNASTY_NAMES.length)]!;
    if (!taken.has(nameKey(candidate)) && !elsewhere.has(nameKey(candidate))) {
      drawn = candidate;
    }
  }

  // Every draw was taken: the player writes their own name, which is what the
  // rule always allowed. The pool is a suggestion, never a limit.
  return drawn ?? '';
}

/**
 * The identity a join is made with: an opaque id — a retried join keeps it, and
 * nothing derives it from the name — the family name suggested to the player,
 * and a full name for the person of the account.
 */
export function drawPersonIdentity(suggestedFamily: string): {
  id: string;
  familyName: string;
  personName: string;
} {
  const firstName = PERSON_NAMES[randomInt(PERSON_NAMES.length)];

  return {
    id: `person-${randomUUID()}`,
    familyName: suggestedFamily,
    personName: `${firstName} ${suggestedFamily}`.trim(),
  };
}

/**
 * The name of a new town, drawn when a join founds one. Names may repeat: the
 * id is assigned by the database, so a dead town's name can come back without
 * bringing its id with it.
 */
export function drawTownName(): string {
  return TOWN_NAMES[randomInt(TOWN_NAMES.length)];
}

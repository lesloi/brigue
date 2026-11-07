/**
 * A house's name, and the rule that keeps two houses of one town apart.
 *
 * The name is identity, not data: it is shown on every screen, read by the
 * town's register and by the global ranking, so two houses a reader could
 * confuse must not exist. A name is letters and digits only — no accent, no
 * space, no apostrophe, no mark — which leaves nothing to fold but the case.
 * The comparison goes further than the rule on purpose: names written before
 * the rule carry accents (`Hébert`), and `Hebert` must find them, the way the
 * issue asks for names "accents and case aside". The database compares bytes,
 * so this module is the rule, and the database's index is only a net behind it.
 */

/** Longer is a sentence, not a name; the screen and the rule say the same number. */
export const NAME_MAX_LENGTH = 24;

/**
 * What a suggested name may be drawn from. None of them is an AI house's: no
 * human house of the server may take one, see `AI_HOUSE_NAMES`. The list is a
 * suggestion, never a limit: a player who is not drawn one writes their own.
 */
export const HOUSE_NAMES = [
  'Leclerc',
  'Moreau',
  'Hebert',
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
  'Gambais',
  'Sacy',
  'Lenoir',
  'Bourdon',
  'Favre',
  'Guerin',
  'Hamon',
  'Joubert',
  'Leroy',
  'Masse',
  'Olivier',
  'Poulain',
  'Regnier',
  'Tessier',
  'Vidal',
] as const;

/**
 * Controls, formats and bidirectional marks: a name pasted from a document can
 * carry them, they render as nothing or as a reordered line, and no reader
 * should see a name its owner cannot. Stripped before the rule is asked, so a
 * messy paste is cleaned rather than refused.
 */
// eslint-disable-next-line no-control-regex -- a control character is exactly what this strips
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Combining marks a decomposed letter carries, none of them a letter of its own. */
const DIACRITICS = /\p{M}/gu;

/** Letters no diacritic can fold, each with what it reads as. */
const LIGATURES: ReadonlyArray<[RegExp, string]> = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/ð/g, 'd'],
  [/þ/g, 'th'],
];

/** The name as the town keeps it: trimmed, without what a screen cannot show. */
export function sanitizeName(name: string): string {
  return name.replace(INVISIBLE, '').normalize('NFC').trim();
}

/**
 * Letters — ASCII ones, the umlaut-free tongue of the code — and digits, from
 * the first character on. A name is a word a clerk writes, and nothing two
 * keyboards spell differently.
 */
export function isValidName(name: string): boolean {
  return name.length > 0 && name.length <= NAME_MAX_LENGTH && /^[A-Za-z][A-Za-z0-9]*$/.test(name);
}

/**
 * What two names are compared on: the case, the accent, the width of the
 * letters and the apostrophe, because a name written before the rule still
 * carries them. A name the rule accepts has none of them, so its key is itself
 * in lower case.
 */
export function nameKey(name: string): string {
  let folded = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u2019/g, "'");

  for (const [pattern, plain] of LIGATURES) {
    folded = folded.replace(pattern, plain);
  }

  return folded.normalize('NFD').replace(DIACRITICS, '');
}

/** A name is unique in its town: another house, however it writes it, holds it. */
export function nameIsTaken(houses: Iterable<string>, name: string): boolean {
  const key = nameKey(name);

  return Array.from(houses).some((carried) => nameKey(carried) === key);
}

/** What a rename asks: shared by the route, the core and the tests. */
export interface HouseRenameRequest {
  /** The name as the player wrote it; it is trimmed and cleaned here, not by the caller. */
  name: string;
  /** Unpaid when zero: the name kept at creation costs nothing. */
  priceCents: number;
  /**
   * The keys of the human houses of the whole server, this one aside. Only the
   * server knows them: the town sees its own houses, and an AI name elsewhere
   * is no conflict.
   */
  takenElsewhere?: ReadonlySet<string>;
}

export type NameRefusal = 'invalid_name' | 'name_taken' | 'insufficient_funds';

export type HouseRenameOutcome = { ok: true; name: string } | { ok: false; reason: NameRefusal };

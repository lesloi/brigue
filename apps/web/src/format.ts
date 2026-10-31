import type { GoodId, RefusalReason, SeatId } from '@brigue/core';

const MONEY = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat('fr-FR');

export function formatCents(cents: number): string {
  return MONEY.format(cents / 100);
}

export function formatCount(value: number): string {
  return COUNT.format(value);
}

export function goodQuantity(units: number, good: GoodId): string {
  const name = goodName(good);
  return `${formatCount(units)} ${name}${units > 1 ? 's' : ''}`;
}

export function goodName(good: GoodId): string {
  switch (good) {
    case 'cloth':
      return 'drap';
    case 'wool':
      return 'laine';
    case 'grain':
      return 'blé';
  }
}

export function workshopName(good: GoodId): string {
  switch (good) {
    case 'cloth':
      return 'Atelier de tisserand';
    case 'wool':
      return 'Atelier de laine';
    case 'grain':
      return 'Atelier de grain';
  }
}

export function seatName(seat: SeatId): string {
  switch (seat) {
    case 'maire':
      return 'mairie';
    case 'prevot':
      return 'prévôté';
    case 'echevin-north':
      return 'échevinage nord';
    case 'echevin-south':
      return 'échevinage sud';
    case 'tresorier':
      return 'trésorerie';
  }
}

export function refusalText(reason: RefusalReason): string {
  switch (reason) {
    case 'unknown_action':
      return 'action inconnue';
    case 'unknown_house':
      return 'maison inconnue';
    case 'unknown_seat':
      return 'charge inconnue';
    case 'invalid_quantity':
      return 'quantité invalide';
    case 'insufficient_funds':
      return 'fonds insuffisants';
    case 'insufficient_favour':
      return 'faveur insuffisante';
  }
}

/** Server error codes, said the way the screen would say them. */
export function actionErrorText(code: string | null): string {
  switch (code) {
    case 'stale_week':
      return 'Cette semaine est déjà passée. Le monde va être relu.';
    case 'future_week':
      return "Cette semaine n'a pas encore commencé.";
    case 'duplicate_action':
      return 'Cette action a déjà été envoyée.';
    case 'invalid_action':
      return "L'action n'a pas été comprise par le serveur.";
    case 'unknown_world':
      return 'Cette ville a disparu.';
    case 'world_version':
      return "Cette ville n'est plus compatible avec le serveur.";
    case 'no_free_house':
      return "Cette ville n'a plus de maison libre.";
    default:
      return "L'action n'a pas pu être envoyée.";
  }
}

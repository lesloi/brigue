import type { GoodId, RefusalReason, SeatId, TitleId, Trade } from '@brigue/core';

import type { PendingActionView, ProjectedSite } from './api.ts';

const MONEY = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat('fr-FR');

export function formatCents(cents: number): string {
  return MONEY.format(cents / 100);
}

export function formatCount(value: number): string {
  return COUNT.format(value);
}

export function goodQuantity(units: number, good: GoodId): string {
  const name = units > 1 ? pluralGoodName(good) : goodName(good);
  return `${formatCount(units)} ${name}`;
}

export function goodName(good: GoodId): string {
  switch (good) {
    case 'cloth':
      return 'drap';
    case 'wool':
      return 'laine';
    case 'grain':
      return 'blé';
    case 'bread':
      return 'pain';
    case 'wood':
      return 'bois';
    case 'planks':
      return 'planche';
  }
}

/** "Bois" is already plural; the other goods take an s. */
function pluralGoodName(good: GoodId): string {
  switch (good) {
    case 'cloth':
      return 'draps';
    case 'wool':
      return 'laines';
    case 'grain':
      return 'blés';
    case 'bread':
      return 'pains';
    case 'wood':
      return 'bois';
    case 'planks':
      return 'planches';
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
    case 'bread':
      return 'Atelier de boulanger';
    case 'wood':
      return 'Atelier de bûcheron';
    case 'planks':
      return 'Atelier de charpentier';
  }
}

export function tradeName(trade: Trade): string {
  switch (trade) {
    case 'weaver':
      return 'Tisserand';
    case 'baker':
      return 'Boulanger';
    case 'carpenter':
      return 'Charpentier';
  }
}

/** The twelve degrees, said as the Maison screen says them. */
export function titleName(title: TitleId): string {
  switch (title) {
    case 'roturier':
      return 'roturier';
    case 'bourgeois':
      return 'bourgeois';
    case 'notable':
      return 'notable';
    case 'patricien':
      return 'patricien';
    case 'ecuyer':
      return 'écuyer';
    case 'chevalier':
      return 'chevalier';
    case 'baron':
      return 'baron';
    case 'vicomte':
      return 'vicomte';
    case 'comte':
      return 'comte';
    case 'marquis':
      return 'marquis';
    case 'duc':
      return 'duc';
    case 'prince':
      return 'prince';
  }
}

/** What the trade buys and makes, said as the creation screen says it. */
export function tradeChainText(trade: Trade): string {
  switch (trade) {
    case 'weaver':
      return 'tisse la laine pour faire des draps';
    case 'baker':
      return 'cuit le blé pour faire du pain';
    case 'carpenter':
      return 'travaille le bois pour faire des planches';
  }
}

/** One queued action, said the way the "En attente" list says it. */
export function pendingActionText(action: PendingActionView): string {
  switch (action.type) {
    case 'market.buy':
      return action.good === undefined ? 'Achat au marché' : `Achat de ${goodQuantity(action.units ?? 0, action.good)}`;
    case 'market.sell':
      return action.good === undefined ? 'Vente au marché' : `Vente de ${goodQuantity(action.units ?? 0, action.good)}`;
    case 'council.campaign':
      return action.seatId === undefined ? 'Candidature' : `Candidature à la ${seatName(action.seatId)}`;
    case 'workshop.build':
      return action.trade === undefined ? 'Construction' : `Construction d'un atelier de ${tradeName(action.trade)}`;
    case 'workshop.destroy':
      return "Démolition d'un atelier";
    case 'workshop.upgrade':
      return "Agrandissement d'un atelier";
    case 'house.buy_title':
      return action.title === undefined ? "Achat d'un titre" : `Achat du titre de ${titleName(action.title)}`;
    case 'house.upgrade_residence':
      return 'Élévation de la résidence';
  }
}

/** A site under way, said in the same voice as the queue. */
export function siteWorkText(site: ProjectedSite, workshopNameOf: (id: string) => string): string {
  switch (site.work) {
    case 'build':
      return site.trade === null ? 'Construction' : `Construction d'un atelier de ${tradeName(site.trade)}`;
    case 'upgrade':
      return `Agrandissement de ${site.workshopId === null ? 'l’atelier' : workshopNameOf(site.workshopId)}`;
    case 'residence':
      return 'Élévation de la résidence';
    case 'title':
      return 'Remise du titre';
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
      return 'dynastie inconnue';
    case 'dormant_house':
      return 'dynastie dormante';
    case 'unknown_seat':
      return 'charge inconnue';
    case 'unknown_good':
      return 'denrée inconnue';
    case 'invalid_quantity':
      return 'quantité invalide';
    case 'insufficient_funds':
      return 'fonds insuffisants';
    case 'insufficient_stock':
      return 'stock insuffisant';
    case 'stock_full':
      return 'entrepôt plein';
    case 'insufficient_favour':
      return 'faveur insuffisante';
    case 'unknown_workshop':
      return 'atelier inconnu';
    case 'unknown_trade':
      return 'métier inconnu';
    case 'workshop_cap':
      return 'la résidence ne tient pas un atelier de plus';
    case 'last_workshop':
      return "c'est votre dernier atelier";
    case 'level_cap':
      return 'le titre ne permet pas ce niveau';
    case 'title_open':
      return 'le titre ne permet pas ce niveau de résidence';
    case 'no_next_title':
      return 'aucun titre au-dessus';
    case 'no_next_residence':
      return 'la résidence est au plus haut';
    case 'site_in_progress':
      return 'un chantier est déjà en cours';
    case 'name_taken':
      return 'ce nom est déjà porté';
    case 'invalid_name':
      return 'nom invalide';
  }
}

/** Server error codes for an action, said the way the screen would say them. */
export function actionErrorText(code: string | null): string {
  switch (code) {
    case 'stale_hour':
      return 'Cette heure est déjà passée. Le monde va être relu.';
    case 'future_hour':
      return "Cette heure n'a pas encore commencé.";
    case 'duplicate_action':
      return 'Cette action a déjà été envoyée.';
    case 'unknown_action':
      return "Cette action n'existe plus.";
    case 'invalid_action':
      return "L'action n'a pas été comprise par le serveur.";
    case 'invalid_trade':
      return 'Métier inconnu.';
    case 'unknown_world':
      return 'Cette ville a disparu.';
    case 'world_version':
      return "Cette ville n'est plus compatible avec le serveur.";
    case 'no_free_house':
      return "Cette ville n'a plus de dynastie libre.";
    case 'deletion_pending':
      // The account is what the server has scheduled, and it outlives the dynasty.
      return 'Ce compte est en cours de suppression.';
    case 'house_lost':
      return "Ta dynastie n'existe plus : choisis un métier pour revenir.";
    case 'name_required':
      return 'Écris le nom de ta dynastie pour revenir.';
    default:
      return "L'action n'a pas pu être envoyée.";
  }
}

/** Server error codes for a read, which is a different failure from an action. */
export function readErrorText(code: string | null): string {
  switch (code) {
    case 'unknown_action':
      return "Cette action n'existe plus.";
    case 'invalid_trade':
      return 'Métier inconnu.';
    case 'unknown_world':
      return 'Cette ville a disparu.';
    case 'world_version':
      return "Cette ville n'est plus compatible avec le serveur.";
    case 'not_found':
      return "Le serveur n'a pas trouvé cette ville.";
    case 'house_lost':
      return "Ta dynastie n'existe plus : choisis un métier pour revenir.";
    case 'name_required':
      return 'Écris le nom de ta dynastie pour revenir.';
    case 'deletion_pending':
      return 'Ce compte est en cours de suppression.';
    default:
      return "La ville n'a pas pu être relue.";
  }
}

import type { Action, Event } from '@brigue/core';

import { formatCents, formatCount, goodName, goodQuantity, refusalText, seatName } from './format.ts';

export type Tone = 'gain' | 'loss' | 'warning' | 'refusal' | 'council' | 'neutral';

export interface EventLine {
  tone: Tone;
  text: string;
}

/**
 * Turns one event into a sentence. It decides no rule: every number comes from
 * the event, never from the projection.
 */
export function eventLine(event: Event, ownHouseId: string, nameOf: (houseId: string) => string): EventLine {
  const own = (houseId: string) => houseId === ownHouseId;
  const subject = (houseId: string) => (own(houseId) ? 'Vous' : nameOf(houseId));
  const verb = (houseId: string, mine: string, theirs: string) => (own(houseId) ? mine : theirs);

  switch (event.type) {
    case 'action.refused':
      return {
        tone: 'refusal',
        text: `${subject(event.houseId)} : ${actionName(event.action)} refusé — ${refusalText(event.reason)}.`,
      };

    case 'market.bought':
      return {
        tone: 'loss',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez acheté', 'a acheté')} ${goodQuantity(event.units, event.good)} à ${formatCents(event.priceCents)} écus, soit ${formatCents(event.totalCents)} écus.`,
      };

    case 'market.sold':
      return {
        tone: 'gain',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez vendu', 'a vendu')} ${goodQuantity(event.units, event.good)} à ${formatCents(event.priceCents)} écus, soit ${formatCents(event.revenueCents)} écus.`,
      };

    case 'market.price_changed':
      return {
        tone: event.after > event.before ? 'warning' : 'neutral',
        text: `${capitalize(goodName(event.good))} : ${formatCents(event.before)} → ${formatCents(event.after)} écus l'unité.`,
      };

    case 'workshop.idle':
      return {
        tone: 'warning',
        text: `${subject(event.houseId)} : atelier de ${goodName(event.good)} à l'arrêt, il manque ${goodQuantity(event.missingUnits, event.input)}.`,
      };

    case 'house.wages_paid':
      return {
        tone: 'loss',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez payé', 'a payé')} ${formatCents(event.amountCents)} écus de gages.`,
      };

    case 'house.penniless':
      return {
        tone: 'refusal',
        text: `${subject(event.houseId)} n'${verb(event.houseId, 'avez', 'a')} pas pu payer ${formatCents(event.shortfallCents)} écus de gages.`,
      };

    case 'house.debt_repaid':
      return {
        tone: 'neutral',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez remboursé', 'a remboursé')} ${formatCents(event.amountCents)} écus de dette.`,
      };

    case 'council.campaigned':
      return {
        tone: 'council',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez dépensé', 'a dépensé')} ${formatCount(event.favourSpent)} de faveur pour la ${seatName(event.seatId)}.`,
      };

    case 'council.election_held': {
      const votes = Object.entries(event.votes)
        .map(([houseId, count]) => `${nameOf(houseId)} ${formatCount(count)}`)
        .join(', ');
      return {
        tone: 'council',
        text: `Élection : la ${seatName(event.seatId)} revient à ${nameOf(event.winnerHouseId)}. Voix : ${votes}.`,
      };
    }
  }
}

function actionName(action: Action['type'] | 'unknown'): string {
  switch (action) {
    case 'market.buy':
      return 'achat';
    case 'council.campaign':
      return 'candidature';
    case 'unknown':
      return 'action';
    default:
      return 'action';
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

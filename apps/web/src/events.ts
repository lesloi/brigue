import type { Action, Event } from '@brigue/core';

import { formatCents, formatCount, goodName, goodQuantity, refusalText, seatName } from './format.ts';

/** The three cuts of the journal: the house's own story, everything, the prices. */
export type LedgerFilter = 'house' | 'all' | 'prices';

/**
 * The default is the house's own story plus the town's politics; the AI's
 * market noise and the price lines stay behind the other cuts. `prices` is
 * where chapter I's lesson lives; `all` is the whole page.
 */
export function ledgerEvents(events: readonly Event[], houseId: string, filter: LedgerFilter): Event[] {
  switch (filter) {
    case 'all':
      return [...events];
    case 'prices':
      return events.filter((event) => event.type === 'market.price_changed');
    case 'house':
      return events.filter(
        (event) =>
          ('houseId' in event && event.houseId === houseId) ||
          event.type.startsWith('council.') ||
          event.type.startsWith('engagement.'),
      );
  }
}

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

    case 'workshop.produced':
      return {
        tone: 'gain',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez produit', 'a produit')} ${goodQuantity(event.units, event.good)}.`,
      };

    case 'workshop.overflow':
      return {
        tone: 'warning',
        text: `${subject(event.houseId)} : entrepôt plein, ${goodQuantity(event.refusedUnits, event.good)} en trop.`,
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
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez déposé', 'a déposé')} une candidature à la ${seatName(event.seatId)} avec ${formatCount(event.favourSpent)} de faveur ; elle compte au prochain scrutin.`,
      };

    case 'engagement.resolved': {
      const late =
        event.resolvedAt === event.dueAt
          ? ''
          : ` (${formatCount(event.resolvedAt - event.dueAt)} heure${event.resolvedAt - event.dueAt > 1 ? 's' : ''} de retard)`;

      if (event.kind === 'hearing') {
        return {
          tone: 'council',
          text: `L'audience de ${subject(event.houseId)} est tenue${late}.`,
        };
      }

      return {
        tone: 'neutral',
        text: `Le chantier de ${subject(event.houseId)} est achevé${late}.`,
      };
    }

    case 'council.scrutiny_held':
      return {
        tone: 'council',
        text: `Scrutin de l'an ${event.year} : les ${formatCount(event.seats.length)} charges sont remises en jeu.`,
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
    case 'market.sell':
      return 'vente';
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

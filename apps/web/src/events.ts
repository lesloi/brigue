import type { Action, Event } from '@brigue/core';

import {
  formatCents,
  formatCount,
  goodName,
  goodQuantity,
  refusalText,
  seatName,
  titleName,
  tradeName,
} from './format.ts';

/** The three cuts of the journal: the dynasty's own story, everything, the prices. */
export type LedgerFilter = 'dynasty' | 'all' | 'prices';

/**
 * The default is the dynasty's own story plus the town's politics; the AI's
 * market noise and the price lines stay behind the other cuts. `prices` is
 * where chapter I's lesson lives; `all` is the whole page.
 */
export function ledgerEvents(events: readonly Event[], dynastyId: string, filter: LedgerFilter): Event[] {
  switch (filter) {
    case 'all':
      return [...events];
    case 'prices':
      return events.filter((event) => event.type === 'market.price_changed');
    case 'dynasty':
      return events.filter(
        (event) =>
          ('dynastyId' in event && event.dynastyId === dynastyId) ||
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
export function eventLine(event: Event, ownDynastyId: string, nameOf: (dynastyId: string) => string): EventLine {
  const own = (dynastyId: string) => dynastyId === ownDynastyId;
  const subject = (dynastyId: string) => (own(dynastyId) ? 'Vous' : nameOf(dynastyId));
  const verb = (dynastyId: string, mine: string, theirs: string) => (own(dynastyId) ? mine : theirs);

  switch (event.type) {
    case 'action.refused':
      return {
        tone: 'refusal',
        text: `${subject(event.dynastyId)} : ${actionName(event.action)} refusé — ${refusalText(event.reason)}.`,
      };

    case 'market.bought':
      return {
        tone: 'loss',
        text: `${subject(event.dynastyId)} ${verb(event.dynastyId, 'avez acheté', 'a acheté')} ${goodQuantity(event.units, event.good)} à ${formatCents(event.priceCents)} écus, soit ${formatCents(event.totalCents)} écus.`,
      };

    case 'market.sold':
      return {
        tone: 'gain',
        text: `${subject(event.dynastyId)} ${verb(event.dynastyId, 'avez vendu', 'a vendu')} ${goodQuantity(event.units, event.good)} à ${formatCents(event.priceCents)} écus, soit ${formatCents(event.revenueCents)} écus.`,
      };

    case 'market.price_changed':
      return {
        tone: event.after > event.before ? 'warning' : 'neutral',
        text: `${capitalize(goodName(event.good))} : ${formatCents(event.before)} → ${formatCents(event.after)} écus l'unité.`,
      };

    case 'workshop.produced':
      return {
        tone: 'gain',
        text: `${subject(event.dynastyId)} ${verb(event.dynastyId, 'avez produit', 'a produit')} ${goodQuantity(event.units, event.good)}.`,
      };

    case 'workshop.overflow':
      return {
        tone: 'warning',
        text: `${subject(event.dynastyId)} : entrepôt plein, ${goodQuantity(event.refusedUnits, event.good)} en trop.`,
      };

    case 'workshop.idle':
      return {
        tone: 'warning',
        text: `${subject(event.dynastyId)} : atelier de ${goodName(event.good)} à l'arrêt, il manque ${goodQuantity(event.missingUnits, event.input)}.`,
      };

    case 'workshop.built':
      return {
        tone: 'gain',
        text: `L'atelier de ${tradeName(event.trade)} de ${subject(event.dynastyId)} est bâti.`,
      };

    case 'workshop.destroyed':
      return {
        tone: 'loss',
        text: `${subject(event.dynastyId)} ${verb(event.dynastyId, 'avez fait abattre', 'a fait abattre')} un atelier de ${goodName(event.good)}.`,
      };

    case 'workshop.upgraded':
      return {
        tone: 'gain',
        text: `${subject(event.dynastyId)} : un atelier passe au niveau ${formatCount(event.level)}.`,
      };

    case 'workshop.build_lost':
      return {
        tone: 'refusal',
        text: `Le chantier de ${tradeName(event.trade)} de ${subject(event.dynastyId)} échoue : ${formatCents(event.paidCents)} écus perdus.`,
      };

    case 'dynasty.title_bought':
      return {
        tone: 'council',
        text: `${subject(event.dynastyId)} ${verb(event.dynastyId, 'avez acheté', 'a acheté')} le titre de ${titleName(event.title)} ; il ${verb(event.dynastyId, 'vous sera remis', 'sera remis')} au prochain midi ou minuit.`,
      };

    case 'dynasty.title_received':
      return {
        tone: 'council',
        text: `${subject(event.dynastyId)} ${verb(event.dynastyId, 'êtes', 'est')} désormais ${titleName(event.title)}.`,
      };

    case 'dynasty.residence_received':
      return {
        tone: 'gain',
        text: `${subject(event.dynastyId)} : la résidence atteint le niveau ${formatCount(event.level)}.`,
      };

    case 'dynasty.renamed':
      return {
        tone: 'council',
        text: `La dynastie ${event.before} prend le nom de ${event.after}.`,
      };

    case 'dynasty.upkeep_paid':
      return {
        tone: 'loss',
        text: `${subject(event.dynastyId)} ${verb(event.dynastyId, 'avez payé', 'a payé')} ${formatCents(event.amountCents)} écus d'entretien.`,
      };

    case 'dynasty.penniless':
      return {
        tone: 'refusal',
        text: `${subject(event.dynastyId)} n'${verb(event.dynastyId, 'avez', 'a')} pas pu payer ${formatCents(event.shortfallCents)} écus d'entretien.`,
      };

    case 'dynasty.debt_repaid':
      return {
        tone: 'neutral',
        text: `${subject(event.dynastyId)} ${verb(event.dynastyId, 'avez remboursé', 'a remboursé')} ${formatCents(event.amountCents)} écus de dette.`,
      };

    case 'council.campaigned':
      return {
        tone: 'council',
        text: `${subject(event.dynastyId)} ${verb(event.dynastyId, 'avez déposé', 'a déposé')} une candidature à la ${seatName(event.seatId)} avec ${formatCount(event.favourSpent)} de faveur ; le scrutin qui la compte est dans ${formatCount(event.countsAt - event.at)} heures.`,
      };

    case 'engagement.resolved': {
      const late =
        event.resolvedAt === event.dueAt
          ? ''
          : ` (${formatCount(event.resolvedAt - event.dueAt)} heure${event.resolvedAt - event.dueAt > 1 ? 's' : ''} de retard)`;

      if (event.kind === 'hearing') {
        return {
          tone: 'council',
          text: `L'audience de ${subject(event.dynastyId)} est tenue${late}.`,
        };
      }

      return {
        tone: 'neutral',
        text: `Le chantier de ${subject(event.dynastyId)} est achevé${late}.`,
      };
    }

    case 'engagement.opened':
      return {
        tone: 'neutral',
        text:
          event.kind === 'hearing'
            ? `L'audience de ${subject(event.dynastyId)} est fixée à l'heure ${formatCount(event.dueAt)}.`
            : `${subject(event.dynastyId)} : un chantier est ouvert, il sera clos à l'heure ${formatCount(event.dueAt)}.`,
      };

    case 'council.scrutiny_held':
      return {
        tone: 'council',
        text: `Scrutin de l'an ${event.year} : les ${formatCount(event.seats.length)} charges sont remises en jeu.`,
      };

    case 'council.election_held': {
      if (event.winnerDynastyId === null) {
        return {
          tone: 'council',
          text: `Élection : la ${seatName(event.seatId)} reste vacante, personne ne s'est présenté.`,
        };
      }

      const votes = Object.entries(event.votes)
        .map(([dynastyId, count]) => `${nameOf(dynastyId)} ${formatCount(count)}`)
        .join(', ');
      return {
        tone: 'council',
        text: `Élection : la ${seatName(event.seatId)} revient à ${nameOf(event.winnerDynastyId)}. Voix : ${votes}.`,
      };
    }

    case 'council.election_result':
      return event.won
        ? {
            tone: 'council',
            text: `Vous êtes élu à la ${seatName(event.seatId)} avec ${formatCount(event.votes[event.dynastyId] ?? 0)} voix.`,
          }
        : {
            tone: 'neutral',
            text: `Vous avez perdu la ${seatName(event.seatId)} ; ${nameOf(event.winnerDynastyId)} l'emporte.`,
          };
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
    case 'workshop.build':
      return 'construction';
    case 'workshop.destroy':
      return 'démolition';
    case 'workshop.upgrade':
      return 'agrandissement';
    case 'dynasty.buy_title':
      return 'achat de titre';
    case 'dynasty.upgrade_residence':
      return 'élévation de la résidence';
    case 'unknown':
      return 'action';
    default:
      return 'action';
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

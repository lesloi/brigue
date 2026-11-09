import type { Action, Event, PersonId } from '@brigue/core';

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

export type Tone = 'gain' | 'loss' | 'warning' | 'refusal' | 'council' | 'neutral';

export interface EventLine {
  tone: Tone;
  text: string;
}

/**
 * Turns one event into a sentence. It decides no rule: every number comes from
 * the event, never from the projection.
 */
export function eventLine(event: Event, ownPersonId: PersonId, nameOf: (personId: PersonId) => string): EventLine {
  const own = (personId: PersonId) => personId === ownPersonId;
  const subject = (personId: PersonId) => (own(personId) ? 'Vous' : nameOf(personId));
  const verb = (personId: PersonId, mine: string, theirs: string) => (own(personId) ? mine : theirs);

  switch (event.type) {
    case 'action.refused':
      return {
        tone: 'refusal',
        text: `${subject(event.personId)} : ${refusalName(event.action)} — ${refusalText(event.reason)}.`,
      };

    case 'market.bought':
      return {
        tone: 'loss',
        text: `${subject(event.personId)} ${verb(event.personId, 'avez acheté', 'a acheté')} ${goodQuantity(event.units, event.good)} à ${formatCents(event.priceCents)} écus, soit ${formatCents(event.totalCents)} écus.`,
      };

    case 'market.sold':
      return {
        tone: 'gain',
        text: `${subject(event.personId)} ${verb(event.personId, 'avez vendu', 'a vendu')} ${goodQuantity(event.units, event.good)} à ${formatCents(event.priceCents)} écus, soit ${formatCents(event.revenueCents)} écus.`,
      };

    case 'market.price_changed':
      return {
        tone: event.after > event.before ? 'warning' : 'neutral',
        text: `${capitalize(goodName(event.good))} : ${formatCents(event.before)} → ${formatCents(event.after)} écus l'unité.`,
      };

    case 'workshop.produced':
      return {
        tone: 'gain',
        text: `${subject(event.personId)} ${verb(event.personId, 'avez produit', 'a produit')} ${goodQuantity(event.units, event.good)}.`,
      };

    case 'workshop.overflow':
      return {
        tone: 'warning',
        text: `${subject(event.personId)} : entrepôt plein, ${goodQuantity(event.refusedUnits, event.good)} en trop.`,
      };

    case 'workshop.idle':
      return {
        tone: 'warning',
        text: `${subject(event.personId)} : atelier de ${goodName(event.good)} à l'arrêt, il manque ${goodQuantity(event.missingUnits, event.input)}.`,
      };

    case 'workshop.built':
      return {
        tone: 'gain',
        text: `${subject(event.personId)} ${verb(event.personId, 'avez bâti', 'a bâti')} un atelier de ${tradeName(event.trade).toLowerCase()}.`,
      };

    case 'workshop.destroyed':
      return {
        tone: 'loss',
        text: `${subject(event.personId)} ${verb(event.personId, 'avez fait abattre', 'a fait abattre')} un atelier de ${goodName(event.good)}.`,
      };

    case 'workshop.upgraded':
      return {
        tone: 'gain',
        text: `${subject(event.personId)} : un atelier passe au niveau ${formatCount(event.level)}.`,
      };

    case 'workshop.build_lost':
      return {
        tone: 'refusal',
        text: `Le chantier de ${tradeName(event.trade)} de ${subject(event.personId)} échoue : ${formatCents(event.paidCents)} écus perdus.`,
      };

    case 'person.title_bought':
      return {
        tone: 'council',
        text: `${subject(event.personId)} ${verb(event.personId, 'avez acheté', 'a acheté')} le titre de ${titleName(event.title)} ; il ${verb(event.personId, 'vous sera remis', 'sera remis')} au prochain midi ou minuit.`,
      };

    case 'person.title_received':
      return {
        tone: 'council',
        text: `${subject(event.personId)} ${verb(event.personId, 'êtes', 'est')} désormais ${titleName(event.title)}.`,
      };

    case 'person.residence_received':
      return {
        tone: 'gain',
        text: `${subject(event.personId)} : la résidence atteint le niveau ${formatCount(event.level)}.`,
      };

    case 'person.upkeep_paid':
      return {
        tone: 'loss',
        text: `${subject(event.personId)} ${verb(event.personId, 'avez payé', 'a payé')} ${formatCents(event.amountCents)} écus d'entretien.`,
      };

    case 'person.penniless':
      return {
        tone: 'refusal',
        text: `${subject(event.personId)} n'${verb(event.personId, 'avez', 'a')} pas pu payer ${formatCents(event.shortfallCents)} écus d'entretien.`,
      };

    case 'person.debt_repaid':
      return {
        tone: 'neutral',
        text: `${subject(event.personId)} ${verb(event.personId, 'avez remboursé', 'a remboursé')} ${formatCents(event.amountCents)} écus de dette.`,
      };

    case 'council.campaigned':
      return {
        tone: 'council',
        // A stored message keeps no town hour, so the line names the scrutiny's
        // own hour rather than a countdown from the moment it was written.
        text: `${subject(event.personId)} ${verb(event.personId, 'avez déposé', 'a déposé')} une candidature à la ${seatName(event.seatId)} avec ${formatCount(event.favourSpent)} de faveur ; le scrutin qui la compte est à l'heure ${formatCount(event.countsAt)}.`,
      };

    case 'engagement.resolved': {
      const late =
        event.resolvedAt === event.dueAt
          ? ''
          : ` (${formatCount(event.resolvedAt - event.dueAt)} heure${event.resolvedAt - event.dueAt > 1 ? 's' : ''} de retard)`;

      if (event.kind === 'hearing') {
        return {
          tone: 'council',
          text: `L'audience de ${subject(event.personId)} est tenue${late}.`,
        };
      }

      return {
        tone: 'neutral',
        text: `Le chantier de ${subject(event.personId)} est achevé${late}.`,
      };
    }

    case 'engagement.opened':
      return {
        tone: 'neutral',
        text:
          event.kind === 'hearing'
            ? `L'audience de ${subject(event.personId)} est fixée à l'heure ${formatCount(event.dueAt)}.`
            : `${subject(event.personId)} : un chantier est ouvert, il sera clos à l'heure ${formatCount(event.dueAt)}.`,
      };

    case 'council.scrutiny_held':
      return {
        tone: 'council',
        text: `Scrutin de l'an ${event.year} : les ${formatCount(event.seats.length)} charges sont remises en jeu.`,
      };

    case 'council.election_held': {
      if (event.winnerPersonId === null) {
        return {
          tone: 'council',
          text: `Élection : la ${seatName(event.seatId)} reste vacante, personne ne s'est présenté.`,
        };
      }

      const votes = Object.entries(event.votes)
        .map(([personId, count]) => `${nameOf(Number(personId))} ${formatCount(count)}`)
        .join(', ');
      return {
        tone: 'council',
        text: `Élection : la ${seatName(event.seatId)} revient à ${nameOf(event.winnerPersonId)}. Voix : ${votes}.`,
      };
    }

    case 'council.election_result':
      return event.won
        ? {
            tone: 'council',
            text: `Vous êtes élu à la ${seatName(event.seatId)} avec ${formatCount(event.votes[event.personId] ?? 0)} voix.`,
          }
        : {
            tone: 'neutral',
            text: `Vous avez perdu la ${seatName(event.seatId)} ; ${nameOf(event.winnerPersonId)} l'emporte.`,
          };
  }
}

/** The refused action with its agreement: a vente is refusede, an achat refusé. */
function refusalName(action: Action['type'] | 'unknown'): string {
  switch (action) {
    case 'market.buy':
      return 'achat refusé';
    case 'market.sell':
      return 'vente refusée';
    case 'council.campaign':
      return 'candidature refusée';
    case 'workshop.build':
      return 'construction refusée';
    case 'workshop.destroy':
      return 'démolition refusée';
    case 'workshop.upgrade':
      return 'agrandissement refusé';
    case 'person.buy_title':
      return 'achat de titre refusé';
    case 'person.upgrade_residence':
      return 'élévation de la résidence refusée';
    case 'unknown':
      return 'action refusée';
    default:
      return 'action refusée';
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

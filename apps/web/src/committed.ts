import type { CommittedCents, PendingActionView } from './api.ts';

/**
 * What the queued actions will take from the purse. The market and the
 * campaigns are left out: the price of a trade is the hour's, and a campaign's
 * is a favour cost the screen does not count.
 */
export function committedCents(actions: readonly PendingActionView[], prices: CommittedCents): number {
  let total = 0;

  for (const action of actions) {
    if (action.type === 'person.buy_title') {
      total += prices.titleCents;
    } else if (action.type === 'person.upgrade_residence') {
      total += prices.residenceCents;
    } else if (action.type === 'workshop.build') {
      total += prices.buildCents;
    }
  }

  return total;
}

import type { PendingActionView } from './api.ts';

/**
 * The hours a queued action may still be taken back. The server plays an action
 * on the hour it names and refuses a cancellation once that hour has been
 * played; the queue only ever holds the current hour and the next.
 */
export const CANCELLABLE_HOURS = 2;

export function isCancellable(action: PendingActionView, currentHour: number): boolean {
  return action.hour >= currentHour && action.hour < currentHour + CANCELLABLE_HOURS;
}

/**
 * When a queued action plays, said against the town's clock. The server keeps
 * a played action in the queue until the town has marked it, so an hour that
 * has already played is said as such rather than dropped from the list.
 */
export function pendingHourText(action: PendingActionView, currentHour: number): string {
  if (action.hour < currentHour) {
    return 'à la prochaine lecture';
  }
  if (action.hour === currentHour) {
    return "à la prochaine avance de l'heure";
  }

  return "dans l'heure qui vient";
}

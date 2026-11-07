import { describe, expect, it } from 'vitest';

import { isCancellable, pendingHourText } from '../src/pending.ts';

const action = (hour: number) => ({ id: 'a', hour, type: 'house.buy_title' as const });

describe('a queued action', () => {
  it('can be taken back only until its hour has played', () => {
    expect(isCancellable(action(12), 12)).toBe(true);
    expect(isCancellable(action(13), 12)).toBe(true);
    expect(isCancellable(action(11), 12)).toBe(false);
  });

  it('says the time left, not the hour it plays', () => {
    expect(pendingHourText(action(11), 12)).toBe('à la prochaine lecture');
    expect(pendingHourText(action(12), 12)).toBe("À la prochaine avance de l'heure");
    expect(pendingHourText(action(13), 12)).toBe("dans l'heure qui vient");
  });
});

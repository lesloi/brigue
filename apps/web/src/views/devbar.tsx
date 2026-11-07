import { useEffect, useState } from 'preact/hooks';

import type { WorldResponse } from '../api.ts';

/**
 * Local development only: the server sets `dev` on the payload it serves when
 * it was started with DEV_ADVANCE. The button has no place in production, and
 * every screen carries it so a player can watch a site from the screen it
 * belongs to.
 *
 * The click is answered at once: the town's own reply is what turns the button
 * back, so a slow hour never looks like a dead button, and two fast clicks
 * never play three hours.
 */
export function DevBar({ data, busy, onAdvance }: { data: WorldResponse; busy: boolean; onAdvance(): void }) {
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (!busy) {
      setAsked(false);
    }
  }, [busy]);

  return (
    <div class="dev">
      <button
        id="advance-hour"
        type="button"
        title="Mode développement : simule une heure"
        disabled={busy || asked}
        onClick={() => {
          setAsked(true);
          onAdvance();
        }}
      >
        {asked ? '…' : 'Heure suivante'}
      </button>
      <span class="dev-note">heure {data.world.hour}</span>
    </div>
  );
}

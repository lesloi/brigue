import { useState } from 'preact/hooks';

import type { WorldResponse } from '../api.ts';

/**
 * Local development only: the server sets `dev` on the payload it serves when
 * it was started with DEV_ADVANCE. The button has no place in production, and
 * every screen carries it so a player can watch a site from the screen it
 * belongs to.
 */
export function DevBar({ data, busy, onAdvance }: { data: WorldResponse; busy: boolean; onAdvance(): void }) {
  const [last, setLast] = useState<number | null>(null);

  return (
    <div class="dev">
      <button
        id="advance-hour"
        type="button"
        title="Mode développement : simule une heure"
        disabled={busy}
        onClick={() => {
          setLast(data.world.hour);
          onAdvance();
        }}
      >
        Heure suivante
      </button>
      {last === null ? null : <span class="dev-note">heure {last} jouée</span>}
    </div>
  );
}

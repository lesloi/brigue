import type { WorldResponse } from '../api.ts';
import { formatCents, formatCount, goodName } from '../format.ts';
import { ResourceIcon } from '../icons.tsx';

/** The screen each place starts on, so the bar keeps the house in reach. */
export type HeaderMode = 'ville' | 'house';

/**
 * The bar that closes the top of every screen, under the hero on Ville and
 * under the title elsewhere. It always gives the same four things — money,
 * workshop stock, raw stock, and the house on its own screen — so a figure a
 * player looks for is never on only one screen.
 */
export function HouseBar({ data, mode }: { data: WorldResponse; mode: HeaderMode }) {
  const house = data.world.house;
  const output = mode === 'house' ? null : (house.workshops[0]?.good ?? null);

  return (
    <section class="res" aria-label="Ta maison">
      <div class="c">
        <ResourceIcon kind="coins" />
        <span class="v">{formatCents(house.treasuryCents)}</span>
        <span class="l">écus</span>
      </div>
      {mode === 'house' ? (
        <div class="c">
          <ResourceIcon kind="prestige" />
          <span class="v">{house.prestige}</span>
          <span class="l">prestige</span>
        </div>
      ) : (
        <div class="c">
          {output !== null ? <ResourceIcon kind={output} /> : null}
          <span class="v">{output !== null ? formatCount(house.stock[output] ?? 0) : '—'}</span>
          <span class="l">{output !== null ? goodName(output) : 'stock'}</span>
        </div>
      )}
      <div class="c">
        <ResourceIcon kind="warehouse" />
        <span class="v">{formatCount(house.stockUnits)}</span>
        <span class="l">entrepôt</span>
      </div>
      <div class="c">
        <ResourceIcon kind="favour" />
        <span class="v">{formatCount(house.favour)}</span>
        <span class="l">faveur</span>
      </div>
    </section>
  );
}

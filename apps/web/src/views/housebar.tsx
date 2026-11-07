import type { PendingActionView, WorldResponse } from '../api.ts';
import { committedCents } from '../committed.ts';
import { formatCents, formatCount, goodName } from '../format.ts';
import { ResourceIcon } from '../icons.tsx';

/** The screen each place starts on, so the bar keeps the house in reach. */
export type HeaderMode = 'ville' | 'house';

/**
 * The bar that closes the top of every screen, under the hero on Ville and
 * under the title elsewhere. It always gives the same four things — money,
 * workshop stock, the warehouse and the house on its own screen — so a figure
 * a player looks for is never on only one screen.
 *
 * A queued action is money already set aside: the bar takes it out of the
 * count at once, so a purchase never leaves the purse looking untouched until
 * the hour plays.
 */
export function HouseBar({
  data,
  mode,
  pending,
}: {
  data: WorldResponse;
  mode: HeaderMode;
  pending: readonly PendingActionView[];
}) {
  const house = data.world.house;
  const ladder = house.ladder;
  const output = mode === 'house' ? null : (house.workshops[0]?.good ?? null);
  const setAside = committedCents(pending, {
    titleCents: ladder.nextTitle?.priceCents ?? 0,
    residenceCents: ladder.nextResidence?.priceCents ?? 0,
    buildCents: house.build.priceCents,
  });
  const treasuryCents = Math.max(0, house.treasuryCents - setAside);

  return (
    <section class="res" aria-label="Ta maison">
      <div class="c">
        <ResourceIcon kind="coins" />
        <span class="v">{formatCents(treasuryCents)}</span>
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
        <span class="v">
          {formatCount(house.stockUnits)} / {formatCount(house.stockCapacityUnits)}
        </span>
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

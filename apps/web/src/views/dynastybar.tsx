import type { PendingActionView, WorldResponse } from '../api.ts';
import { committedCents } from '../committed.ts';
import { formatCents, formatCount, goodName } from '../format.ts';
import { ResourceIcon } from '../icons.tsx';

/** The screen each place starts on, so the bar keeps the person in reach. */
export type HeaderMode = 'ville' | 'person';

/**
 * The bar that closes the top of every screen, under the hero on Ville and
 * under the title elsewhere. It always gives the same four things — money,
 * workshop stock, the warehouse and the person on its own screen — so a figure
 * a player looks for is never on only one screen.
 *
 * A queued action is money already set aside: the bar takes it out of the
 * count at once, so a purchase never leaves the purse looking untouched until
 * the hour plays.
 */
export function PersonBar({
  data,
  mode,
  pending,
}: {
  data: WorldResponse;
  mode: HeaderMode;
  pending: readonly PendingActionView[];
}) {
  const person = data.world.person;
  const ladder = person.ladder;
  const output = mode === 'person' ? null : (person.workshops[0]?.good ?? null);
  const setAside = committedCents(pending, {
    titleCents: ladder.nextTitle?.priceCents ?? 0,
    residenceCents: ladder.nextResidence?.priceCents ?? 0,
    buildCents: person.build.priceCents,
  });
  const treasuryCents = Math.max(0, person.treasuryCents - setAside);

  return (
    <section class="res" aria-label="Ta dynastie">
      <div class="c">
        <ResourceIcon kind="coins" />
        <span class="v">{formatCents(treasuryCents)}</span>
        <span class="l">écus</span>
      </div>
      {mode === 'person' ? (
        <div class="c">
          <ResourceIcon kind="prestige" />
          <span class="v">{person.prestige}</span>
          <span class="l">prestige</span>
        </div>
      ) : (
        <div class="c">
          {output !== null ? <ResourceIcon kind={output} /> : null}
          <span class="v">{output !== null ? formatCount(person.stock[output] ?? 0) : '—'}</span>
          <span class="l">{output !== null ? goodName(output) : 'stock'}</span>
        </div>
      )}
      <div class="c">
        <ResourceIcon kind="warehouse" />
        <span class="v">
          {formatCount(person.stockUnits)} / {formatCount(person.stockCapacityUnits)}
        </span>
        <span class="l">entrepôt</span>
      </div>
      <div class="c">
        <ResourceIcon kind="favour" />
        <span class="v">{formatCount(person.favour)}</span>
        <span class="l">faveur</span>
      </div>
    </section>
  );
}

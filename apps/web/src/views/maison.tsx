import { TRADES, type TitleId, type Trade } from '@brigue/core/world';
import { useState } from 'preact/hooks';

import type { PendingActionView, ProjectedWorkshop, WorldResponse } from '../api.ts';
import {
  formatCents,
  formatCount,
  pendingActionText,
  titleName,
  tradeChainText,
  tradeName,
  workshopName,
} from '../format.ts';
import { DynastyScene } from '../dynasty-scene.tsx';
import { ResourceIcon, Seal, WorkshopThumb } from '../icons.tsx';
import { pendingHourText } from '../pending.ts';
import { DevBar } from './devbar.tsx';
import { DynastyBar } from './dynastybar.tsx';

interface MaisonProps {
  data: WorldResponse;
  advancing: boolean;
  pending: PendingActionView[];
  cancelling: number | null;
  busy: string | null;
  renameError: string | null;
  onBuild(trade: Trade): void;
  onDestroy(workshopId: string): void;
  onUpgrade(workshopId: string): void;
  onBuyTitle(): void;
  onUpgradeResidence(): void;
  onRename(name: string): void;
  onCancel(id: number): void;
  onAdvance(): void;
}

const TRADE_CHOICES = [...TRADES].sort((left, right) => tradeName(left).localeCompare(tradeName(right), 'fr'));

/**
 * The Maison screen: what the dynasty is — its name, its title, its residence —
 * and what it holds — its workshops. Every figure comes from the projection,
 * including the price of the next step and whether the door is open: the screen
 * shows the gate and asks; it never decides whether the dynasty may pass.
 */
export function Maison({
  data,
  advancing,
  pending,
  cancelling,
  busy,
  renameError,
  onBuild,
  onDestroy,
  onUpgrade,
  onBuyTitle,
  onUpgradeResidence,
  onRename,
  onCancel,
  onAdvance,
}: MaisonProps) {
  const { world } = data;
  const dynasty = world.dynasty;
  const ladder = dynasty.ladder;
  const [name, setName] = useState(dynasty.name);
  const [choosing, setChoosing] = useState(false);
  // A workshop's works lock the builders; the remise of a title does not, it is
  // the town's own door. A second degree waits only on the first being
  // delivered, which is what `titleQueued` and the site of a title say.
  const building = dynasty.sites.some((site) => site.work !== 'title');
  // The queued purchases wait for their order to play: the next degree is
  // already bought as far as this hour is concerned.
  const titleQueued = pending.some((action) => action.type === 'dynasty.buy_title');
  const residenceQueued = pending.some((action) => action.type === 'dynasty.upgrade_residence');
  const renameQueued = name.trim() !== dynasty.name;

  return (
    <main class="screen">
      <section class="hero hero-dynasty" aria-label={dynasty.name}>
        <DynastyScene residenceLevel={dynasty.residenceLevel} />
        <div class="scrim"></div>
        <div class="id">
          <Seal />
          <div>
            <div class="nm">Dynastie {dynasty.name}</div>
            <div class="pl">
              {world.town.name} &middot; an {world.year}
            </div>
          </div>
          <div class="wk">
            h. {world.calendar.hourOfYear}/{world.calendar.hoursPerYear}
          </div>
        </div>
        <div class="cap">
          <div>
            <div class="sub">{titleName(dynasty.title)}</div>
            <h1>{ladder.residence}</h1>
          </div>
          <div class="cap-right">
            {dynasty.workshops.length} atelier{dynasty.workshops.length > 1 ? 's' : ''}
          </div>
        </div>
      </section>

      <DynastyBar data={data} mode="dynasty" pending={pending} />

      {data.dev === true ? <DevBar data={data} busy={advancing} onAdvance={onAdvance} /> : null}

      <div class="body">
        <section class="sec" aria-labelledby="maison-title">
          <div class="h">
            <b id="maison-title">Dynastie {dynasty.name}</b>
          </div>
          <div class="card">
            <form
              class="rename"
              onSubmit={(event) => {
                event.preventDefault();
                if (renameQueued) {
                  onRename(name.trim());
                }
              }}
            >
              <label for="dynasty-name">Nom de la dynastie</label>
              <input
                id="dynasty-name"
                name="name"
                autocomplete="off"
                maxLength={24}
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
              <button class="btn outline" type="submit" disabled={!renameQueued || busy === 'rename'}>
                <span class="btn-label">
                  Renommer <Price cents={dynasty.rename.priceCents} />
                </span>
              </button>
            </form>
            {renameError !== null ? <p class="warn">{renameError}</p> : null}
            {ladder.nextTitle === null ? (
              <div class="row empty">
                <div class="nm">
                  <b>Prince</b>
                  <p>Il n'y a pas de degré au-dessus.</p>
                </div>
              </div>
            ) : (
              <div class="wait">
                <div class="nm">
                  <b>Titre de {titleName(ladder.nextTitle.title)}</b>
                  <p>
                    {titleHint(
                      titleQueued || building,
                      dynasty.sites.some((site) => site.work === 'title'),
                    )}
                  </p>
                </div>
                <button
                  class="btn"
                  type="button"
                  // A title in flight does not lock the next degree: only a build,
                  // a residence under way and this button's own request do.
                  disabled={
                    titleQueued ||
                    !ladder.nextTitle ||
                    busy === 'title' ||
                    dynasty.treasuryCents < ladder.nextTitle.priceCents
                  }
                  onClick={onBuyTitle}
                >
                  <span class="btn-label">
                    <Price cents={ladder.nextTitle.priceCents} />
                  </span>
                </button>
              </div>
            )}
            {ladder.nextResidence === null ? (
              <div class="row empty">
                <div class="nm">
                  <b>Palais</b>
                  <p>La résidence ne se dépasse pas.</p>
                </div>
              </div>
            ) : (
              <div class="wait">
                <div class="nm">
                  <b>{ladder.nextResidence.name}</b>
                  <p>{residenceHint(ladder, titleName)}</p>
                </div>
                <button
                  class="btn"
                  type="button"
                  disabled={
                    building ||
                    residenceQueued ||
                    !ladder.nextResidence.opened ||
                    busy === 'residence' ||
                    dynasty.treasuryCents < ladder.nextResidence.priceCents
                  }
                  onClick={onUpgradeResidence}
                >
                  <span class="btn-label">
                    <Price cents={ladder.nextResidence.priceCents} />
                  </span>
                </button>
              </div>
            )}
          </div>
        </section>

        <section class="sec" aria-labelledby="ateliers-title">
          <div class="h">
            <b id="ateliers-title">Ateliers</b>
            <span>
              {dynasty.workshops.length} / {formatCount(ladder.workshops)}
            </span>
          </div>
          <div class="card">
            {dynasty.workshops.map((workshop) => (
              <WorkshopLine
                key={workshop.id}
                workshop={workshop}
                busy={busy}
                building={building}
                last={dynasty.workshops.length <= 1}
                onUpgrade={onUpgrade}
                onDestroy={onDestroy}
              />
            ))}
          </div>
          {dynasty.build.room > 0 && choosing ? (
            <div class="card trade-list">
              {TRADE_CHOICES.map((trade) => (
                <button
                  class="trade-choice"
                  type="button"
                  key={trade}
                  disabled={building || busy === 'build'}
                  onClick={() => {
                    setChoosing(false);
                    onBuild(trade);
                  }}
                >
                  <span class="trade-name">{tradeName(trade)}</span>
                  <span class="trade-chain">{tradeChainText(trade)}</span>
                </button>
              ))}
            </div>
          ) : dynasty.build.room > 0 ? (
            <button
              class="btn outline wide"
              type="button"
              disabled={building || busy === 'build'}
              onClick={() => setChoosing(true)}
            >
              <span class="btn-label">
                Bâtir un atelier <Price cents={dynasty.build.priceCents} /> · {formatCount(dynasty.build.hours)} h
              </span>
            </button>
          ) : null}
        </section>

        <section class="sec" aria-labelledby="attente-title">
          <div class="h">
            <b id="attente-title">En attente</b>
            <span>{pending.length}</span>
          </div>
          <div class="card">
            {pending.length === 0 ? (
              <div class="row empty">
                <div class="nm">
                  <b>Rien en attente</b>
                  <p>Les actions envoyées pour cette heure joueront à la prochaine.</p>
                </div>
              </div>
            ) : (
              pending.map((action) => (
                <div class="wait" key={action.id}>
                  <div class="nm">
                    <b>{pendingActionText(action)}</b>
                    <p>{pendingHourText(action, world.hour)}</p>
                  </div>
                  <button
                    class="btn outline"
                    type="button"
                    disabled={cancelling === action.id}
                    onClick={() => onCancel(action.id)}
                  >
                    Annuler
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
function titleHint(queued: boolean, delivering: boolean): string {
  if (queued) {
    return 'Commande en attente pour cette heure.';
  }
  if (delivering) {
    return 'Le titre en cours est remis au prochain midi ou minuit.';
  }

  return 'Obtenu au prochain midi ou minuit.';
}

/**
 * What holds the next residence level, or how long it takes: a door the title
 * has not opened yet, or the hours the upgrade costs.
 */
function residenceHint(
  ladder: WorldResponse['world']['dynasty']['ladder'],
  nameOf: (title: TitleId) => string,
): string {
  const next = ladder.nextResidence;

  if (next === null) {
    return 'La résidence ne se dépasse pas.';
  }
  if (!next.opened) {
    return `Prérequis : titre de ${nameOf(ladder.nextTitle?.title ?? ladder.title)}`;
  }

  return `${formatCount(next.hours)} h de travaux.`;
}

/** A price with the coin that says it is one, shared by every button that costs. */
function Price({ cents }: { cents: number }) {
  return (
    <span class="btn-price">
      <ResourceIcon kind="coins" />
      {formatCents(cents)}
    </span>
  );
}

function WorkshopLine({
  workshop,
  busy,
  building,
  last,
  onUpgrade,
  onDestroy,
}: {
  workshop: ProjectedWorkshop;
  busy: string | null;
  building: boolean;
  last: boolean;
  onUpgrade(workshopId: string): void;
  onDestroy(workshopId: string): void;
}) {
  return (
    <div class="row">
      <div class="th">
        <WorkshopThumb good={workshop.good} />
      </div>
      <div class="nm">
        <b>
          {workshopName(workshop.good)} <span class="lv">niv. {workshop.level}</span>
        </b>
        <p>
          {formatCount(workshop.outputUnitsPerHour)} par heure · {formatCents(workshop.upkeepCentsPerHour)} d'entretien
        </p>
        <p>{formatCount(workshop.capacityUnits)} unités d'entrepôt</p>
      </div>
      <div class="actions">
        <button
          class="btn"
          type="button"
          disabled={building || !workshop.canUpgrade || busy === `upgrade-${workshop.id}`}
          title={workshop.canUpgrade ? undefined : 'Le titre ne permet pas ce niveau'}
          onClick={() => onUpgrade(workshop.id)}
        >
          {workshop.upgradeHours === null ? 'Agrandir' : `Agrandir (${formatCount(workshop.upgradeHours)} h)`}
        </button>
        <button
          class="btn outline"
          type="button"
          disabled={building || last || busy === `destroy-${workshop.id}`}
          onClick={() => onDestroy(workshop.id)}
        >
          Rétrograder
        </button>
      </div>
    </div>
  );
}

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
import { PersonScene } from '../dynasty-scene.tsx';
import { ResourceIcon, Seal, WorkshopThumb } from '../icons.tsx';
import { pendingHourText } from '../pending.ts';
import { DevBar } from './devbar.tsx';
import { PersonBar } from './dynastybar.tsx';

interface MaisonProps {
  data: WorldResponse;
  advancing: boolean;
  pending: PendingActionView[];
  cancelling: number | null;
  busy: string | null;
  renameError: string | null;
  onBuild(trade: Trade): void;
  onDestroy(workshopId: number): void;
  onUpgrade(workshopId: number): void;
  onBuyTitle(): void;
  onUpgradeResidence(): void;
  onRename(name: string): void;
  onCancel(id: number): void;
  onAdvance(): void;
}

const TRADE_CHOICES = [...TRADES].sort((left, right) => tradeName(left).localeCompare(tradeName(right), 'fr'));

/**
 * The Maison screen: who the person is — their name, their title, their
 * residence — and what they hold — their workshops. Every figure comes from the
 * projection, including the price of the next step and whether the door is open:
 * the screen shows the gate and asks; it never decides whether the person may pass.
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
  const person = world.person;
  const ladder = person.ladder;
  const [name, setName] = useState(person.name);
  const [choosing, setChoosing] = useState(false);
  // The queued purchases wait for their order to play: the next degree is
  // already bought as far as this hour is concerned.
  const titleQueued = pending.some((action) => action.type === 'person.buy_title');
  const residenceQueued = pending.some((action) => action.type === 'person.upgrade_residence');
  const renameQueued = name.trim() !== person.name;

  return (
    <main class="screen">
      <section class="hero hero-dynasty" aria-label={person.name}>
        <PersonScene residenceLevel={person.residenceLevel} />
        <div class="scrim"></div>
        <div class="id">
          <Seal />
          <div>
            <div class="nm">Dynastie {person.name}</div>
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
            <div class="sub">
              {titleName(person.title)} &middot; {person.personName}
            </div>
            <h1>{ladder.residence}</h1>
          </div>
          <div class="cap-right">
            {person.workshops.length} atelier{person.workshops.length > 1 ? 's' : ''}
          </div>
        </div>
      </section>

      <PersonBar data={data} mode="person" pending={pending} />

      {data.dev === true ? <DevBar data={data} busy={advancing} onAdvance={onAdvance} /> : null}

      <div class="body">
        <section class="sec" aria-labelledby="maison-title">
          <div class="h">
            <b id="maison-title">Dynastie {person.name}</b>
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
              <label for="family-name">Nom de la dynastie</label>
              <input
                id="family-name"
                name="name"
                autocomplete="off"
                maxLength={24}
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
              <button class="btn outline" type="submit" disabled={!renameQueued || busy === 'rename'}>
                <span class="btn-label">
                  Renommer <Price cents={person.rename.priceCents} />
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
                  <p>{titleHint(titleQueued)}</p>
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
                    person.treasuryCents < ladder.nextTitle.priceCents
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
                    residenceQueued ||
                    !ladder.nextResidence.opened ||
                    busy === 'residence' ||
                    person.treasuryCents < ladder.nextResidence.priceCents
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
              {person.workshops.length} / {formatCount(ladder.workshops)}
            </span>
          </div>
          <div class="card">
            {person.workshops.map((workshop) => (
              <WorkshopLine
                key={workshop.id}
                workshop={workshop}
                busy={busy}
                last={person.workshops.length <= 1}
                onUpgrade={onUpgrade}
                onDestroy={onDestroy}
              />
            ))}
          </div>
          {person.build.room > 0 && choosing ? (
            <div class="card trade-list">
              {TRADE_CHOICES.map((trade) => (
                <button
                  class="trade-choice"
                  type="button"
                  key={trade}
                  disabled={busy === 'build'}
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
          ) : person.build.room > 0 ? (
            <button
              class="btn outline wide"
              type="button"
              disabled={busy === 'build'}
              onClick={() => setChoosing(true)}
            >
              <span class="btn-label">
                Bâtir un atelier <Price cents={person.build.priceCents} /> · {formatCount(person.build.hours)} h
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
function titleHint(queued: boolean): string {
  if (queued) {
    return 'Commande en attente pour cette heure.';
  }

  return 'Obtenu au prochain midi ou minuit.';
}

/**
 * What holds the next residence level: a door the title has not opened yet, or
 * the hours the works take.
 */
function residenceHint(ladder: WorldResponse['world']['person']['ladder'], nameOf: (title: TitleId) => string): string {
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
  last,
  onUpgrade,
  onDestroy,
}: {
  workshop: ProjectedWorkshop;
  busy: string | null;
  last: boolean;
  onUpgrade(workshopId: number): void;
  onDestroy(workshopId: number): void;
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
          disabled={!workshop.canUpgrade || busy === `upgrade-${workshop.id}`}
          title={workshop.canUpgrade ? undefined : 'Le titre ne permet pas ce niveau'}
          onClick={() => onUpgrade(workshop.id)}
        >
          {workshop.upgradeHours === null ? 'Agrandir' : `Agrandir (${formatCount(workshop.upgradeHours)} h)`}
        </button>
        <button
          class="btn outline"
          type="button"
          disabled={last || busy === `destroy-${workshop.id}`}
          onClick={() => onDestroy(workshop.id)}
        >
          Rétrograder
        </button>
      </div>
    </div>
  );
}

import type { PersonId } from '@brigue/core';

import type { PendingActionView, WorldResponse } from '../api.ts';
import { netPendingFor } from '../trade.ts';
import { formatCents, formatCount, goodQuantity, workshopName } from '../format.ts';
import { HeroScene } from '../hero.tsx';
import { ResourceIcon, Seal, WorkshopThumb } from '../icons.tsx';
import { DevBar } from './devbar.tsx';
import { PersonBar } from './dynastybar.tsx';

interface VilleProps {
  data: WorldResponse;
  now: number;
  advancing: boolean;
  /** Actions the server holds for the current and next hour. */
  pending: PendingActionView[];
  onRefresh(): void;
  onGoMarket(): void;
  onAdvance(): void;
  onDeleteAccount(): void;
}

/** The Ville screen, rendered only from the projection and the journal page. */
export function Ville({
  data,
  now,
  advancing,
  pending,
  onRefresh,
  onGoMarket,
  onAdvance,
  onDeleteAccount,
}: VilleProps) {
  const { world } = data;
  const person = world.person;
  const nameOf = personName(world);

  return (
    <main class="screen">
      <section class="hero" aria-label={world.town.name}>
        <HeroScene />
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
            <div class="sub">une ville de la hanse</div>
            <h1>{world.town.name}</h1>
          </div>
          <button class="tick" id="refresh" type="button" aria-label="Rafraîchir la ville" onClick={onRefresh}>
            <span id="tick-countdown">{countdownText(world.nextBellAt, now)}</span>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 11a8 8 0 1 0-2.3 5.7" />
              <path d="M20 4v7h-7" />
            </svg>
          </button>
        </div>
      </section>

      <PersonBar data={data} mode="ville" pending={pending} />

      {data.dev === true ? <DevBar data={data} busy={advancing} onAdvance={onAdvance} /> : null}

      <div class="body">
        <section class="sec" aria-labelledby="person-title">
          <div class="h">
            <b id="person-title">Ta dynastie</b>
            <span>
              {person.workshops.length} atelier{person.workshops.length > 1 ? 's' : ''}
            </span>
          </div>
          <div class="card">
            {person.workshops.length === 0 ? (
              <div class="row empty">
                <div class="nm">
                  <b>Aucun atelier</b>
                  <p>La dynastie n'a pas encore de quoi produire.</p>
                </div>
              </div>
            ) : (
              person.workshops.map((workshop) => (
                <WorkshopRow
                  workshop={workshop}
                  priceCents={world.town.market[workshop.good]}
                  stock={person.stock}
                  pendingInput={
                    workshop.input === null
                      ? 0
                      : netPendingFor(
                          workshop.input,
                          pending.filter((action) => action.hour === world.hour),
                        )
                  }
                  onGoMarket={onGoMarket}
                />
              ))
            )}
            {person.debtCents > 0 ? (
              <div class="row debt">
                <div class="th">
                  <ResourceIcon kind="coins" />
                </div>
                <div class="nm">
                  <b>Dette</b>
                  <p>À rembourser sur les prochaines heures.</p>
                </div>
                <div class="act">
                  <span class="price owed">
                    <b>{formatCents(person.debtCents)}</b> écus
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section class="sec" aria-labelledby="laws-title">
          <div class="h">
            <b id="laws-title">Ce qui est loi</b>
            <span>{world.town.laws.length} en vigueur</span>
          </div>
          <div class="card">
            {world.town.laws.length === 0 ? (
              <div class="row empty">
                <div class="nm">
                  <b>Aucune loi</b>
                  <p>La ville se gouverne encore par l'usage.</p>
                </div>
              </div>
            ) : (
              world.town.laws.map((law) => (
                <div class="law">
                  <b>{law.title}</b>
                  <span class="pill">vigueur</span>
                  <p>
                    portée par <span>{nameOf(law.sponsorPersonId)}</span> &middot;{' '}
                    {lawAgeText(law.enactedAt, world.hour)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
      <footer class="account">
        <button type="button" onClick={onDeleteAccount}>
          Supprimer mon compte
        </button>
      </footer>
    </main>
  );
}

export function personName(world: WorldResponse['world']): (personId: PersonId) => string {
  const names = new Map(world.town.people.map((person) => [person.id, person.name]));
  names.set(world.person.id, world.person.name);

  return (personId) => names.get(personId) ?? 'une personne inconnue';
}

export function countdownText(nextBellAt: string, now: number): string {
  const remaining = new Date(nextBellAt).getTime() - now;

  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 'cloche imminente';
  }

  return `cloche dans ${durationText(remaining)}`;
}

/** How long ago the town enacted a law, said in hours from its own clock. */
export function lawAgeText(enactedAt: number, currentHour: number): string {
  const age = currentHour - enactedAt;

  if (age <= 0) {
    return 'cette heure';
  }

  return `il y a ${formatCount(age)} heure${age > 1 ? 's' : ''}`;
}

function durationText(remaining: number): string {
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function WorkshopRow({
  workshop,
  priceCents,
  stock,
  pendingInput,
  onGoMarket,
}: {
  workshop: WorldResponse['world']['person']['workshops'][number];
  priceCents: number;
  stock: WorldResponse['world']['person']['stock'];
  pendingInput: number;
  onGoMarket(): void;
}) {
  const input = workshop.input;
  const held = input === null ? 0 : (stock[input] ?? 0);
  const effectiveHeld = Math.max(0, held + pendingInput);
  const missing = input === null ? 0 : Math.max(0, workshop.inputUnitsPerHour - effectiveHeld);
  const pendingBuy = input !== null && pendingInput > 0 ? pendingInput : 0;
  const pendingSell = input !== null && pendingInput < 0 ? -pendingInput : 0;
  // What the warehouse already covers: the workshop eats its input at one rate
  // an hour, so every hour of input is one hour of production, no more.
  const reserveHours =
    input === null || workshop.inputUnitsPerHour <= 0 ? null : Math.floor(effectiveHeld / workshop.inputUnitsPerHour);

  return (
    <div class="row">
      <div class="th">
        <WorkshopThumb good={workshop.good} />
      </div>
      <div class="nm">
        <b>
          {workshopName(workshop.good)}
          <span class="lv">niv. {workshop.level}</span>
        </b>
        {/* The chain and its hourly rate in one line: what it eats, what it
            makes, and how fast. The badge above carries the level, and the
            workers only ever set the wages, which the ledger writes. */}
        <p>
          {input === null
            ? `${goodQuantity(workshop.outputUnitsPerHour, workshop.good)} par heure`
            : `${goodQuantity(workshop.inputUnitsPerHour, input)} → ${goodQuantity(
                workshop.outputUnitsPerHour,
                workshop.good,
              )} par heure`}
        </p>
        {reserveHours !== null && reserveHours > 0 ? (
          <p>
            réserve : {reserveHours} heure{reserveHours > 1 ? 's' : ''}
          </p>
        ) : null}
        {missing > 0 && input !== null ? (
          <p class="warn">
            {pendingBuy > 0 ? 'Il manque toujours ' : 'Il manque '}
            {goodQuantity(missing, input)} pour produire cette heure.
          </p>
        ) : null}
        {input !== null && pendingBuy > 0 ? (
          <p class="pending">Achat de {goodQuantity(pendingBuy, input)} en attente pour cette heure.</p>
        ) : null}
        {input !== null && pendingSell > 0 ? (
          <p class="pending">Vente de {goodQuantity(pendingSell, input)} en attente pour cette heure.</p>
        ) : null}
      </div>
      <div class="act">
        <span class="price">
          <b>{formatCents(priceCents)}</b> écus
        </span>
        <span class="price-l">l'unité</span>
        <span class="price">
          <b>{formatCount(stock[workshop.good] ?? 0)}</b> en stock
        </span>
        {missing > 0 ? (
          <button class="btn outline" type="button" onClick={onGoMarket}>
            Au marché
          </button>
        ) : null}
      </div>
    </div>
  );
}

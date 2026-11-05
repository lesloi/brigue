import { useState } from 'preact/hooks';

import type { CalendarView, PendingActionView, WorldResponse } from '../api.ts';
import { eventLine, ledgerEvents, type LedgerFilter } from '../events.ts';
import { netPendingFor } from '../trade.ts';
import { formatCents, formatCount, goodName, goodQuantity, workshopName } from '../format.ts';
import { HeroScene } from '../hero.tsx';
import { ResourceIcon, Seal, WorkshopThumb } from '../icons.tsx';

const LEDGER_LIMIT = 8;

interface VilleProps {
  data: WorldResponse;
  now: number;
  advancing: boolean;
  /** Actions the server holds for the current and next week. */
  pending: PendingActionView[];
  onRefresh(): void;
  onGoMarket(): void;
  onAdvance(): void;
}

/** The Ville screen, rendered only from the projection and last week's events. */
export function Ville({ data, now, advancing, pending, onRefresh, onGoMarket, onAdvance }: VilleProps) {
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('house');
  const [expanded, setExpanded] = useState(false);
  const { world, events, summary } = data;
  const house = world.house;
  const workshop = house.workshops[0];
  const output = workshop?.good ?? null;
  const input = workshop?.input ?? null;
  const nameOf = houseName(world);
  const ledger = ledgerEvents(events, house.id, ledgerFilter);
  const shownLedger = expanded ? ledger : ledger.slice(0, LEDGER_LIMIT);

  return (
    <main class="screen">
      <section class="hero" aria-label="Saint-Aubin">
        <HeroScene />
        <div class="scrim"></div>
        <div class="id">
          <Seal />
          <div>
            <div class="nm">Maison {house.name}</div>
            <div class="pl">Saint-Aubin &middot; an {world.year}</div>
          </div>
          <div class="wk">
            sem. {world.calendar.weekOfYear}/{world.calendar.weeksPerYear}
          </div>
        </div>
        <div class="cap">
          <div>
            <div class="sub">une ville de la hanse</div>
            <h1>Saint-Aubin</h1>
          </div>
          <button class="tick" id="refresh" type="button" aria-label="Rafraîchir la ville" onClick={onRefresh}>
            <span id="tick-countdown">{countdownText(world.nextTickAt, now)}</span>
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

      <section class="res" aria-label="Ressources">
        <div class="c">
          <ResourceIcon kind="coins" />
          <span class="v">{formatCents(house.treasuryCents)}</span>
          <span class="l">écus</span>
        </div>
        <div class="c">
          {output !== null ? <ResourceIcon kind={output} /> : null}
          <span class="v">{output !== null ? formatCount(house.stock[output] ?? 0) : '—'}</span>
          <span class="l">{output !== null ? goodName(output) : 'stock'}</span>
        </div>
        <div class="c">
          {input !== null ? <ResourceIcon kind={input} /> : null}
          <span class="v">{input !== null ? formatCount(house.stock[input] ?? 0) : '—'}</span>
          <span class="l">{input !== null ? goodName(input) : 'matière'}</span>
        </div>
        <div class="c">
          <ResourceIcon kind="favour" />
          <span class="v">{formatCount(house.favour)}</span>
          <span class="l">faveur</span>
        </div>
      </section>

      <Calendar calendar={world.calendar} year={world.year} now={now} />

      {data.dev === true ? <DevBar busy={advancing} onAdvance={onAdvance} /> : null}

      <div class="body">
        <section class="sec" aria-labelledby="house-title">
          <div class="h">
            <b id="house-title">Ta maison</b>
            <span>
              {house.workshops.length} atelier{house.workshops.length > 1 ? 's' : ''}
            </span>
          </div>
          <div class="card">
            {house.workshops.length === 0 ? (
              <div class="row empty">
                <div class="nm">
                  <b>Aucun atelier</b>
                  <p>La maison n'a pas encore de quoi produire.</p>
                </div>
              </div>
            ) : (
              house.workshops.map((workshop) => (
                <WorkshopRow
                  workshop={workshop}
                  priceCents={world.town.market[workshop.good]}
                  stock={house.stock}
                  pendingInput={
                    workshop.input === null
                      ? 0
                      : netPendingFor(
                          workshop.input,
                          pending.filter((action) => action.week === world.week),
                        )
                  }
                  onGoMarket={onGoMarket}
                />
              ))
            )}
            {house.debtCents > 0 ? (
              <div class="row debt">
                <div class="th">
                  <ResourceIcon kind="coins" />
                </div>
                <div class="nm">
                  <b>Dette</b>
                  <p>À rembourser sur les prochaines semaines.</p>
                </div>
                <div class="act">
                  <span class="price owed">
                    <b>{formatCents(house.debtCents)}</b> écus
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section class="sec" aria-labelledby="week-title">
          <div class="h">
            <b id="week-title">La semaine dernière</b>
            <span>
              {ledger.length} ligne{ledger.length > 1 ? 's' : ''}
            </span>
          </div>
          <div class="filters">
            <div class="segmented" role="group" aria-label="Filtrer le registre">
              <button
                type="button"
                class={ledgerFilter === 'house' ? 'on' : ''}
                aria-pressed={ledgerFilter === 'house'}
                onClick={() => {
                  setLedgerFilter('house');
                  setExpanded(false);
                }}
              >
                Ma maison
              </button>
              <button
                type="button"
                class={ledgerFilter === 'all' ? 'on' : ''}
                aria-pressed={ledgerFilter === 'all'}
                onClick={() => {
                  setLedgerFilter('all');
                  setExpanded(false);
                }}
              >
                Tout
              </button>
              <button
                type="button"
                class={ledgerFilter === 'prices' ? 'on' : ''}
                aria-pressed={ledgerFilter === 'prices'}
                onClick={() => {
                  setLedgerFilter('prices');
                  setExpanded(false);
                }}
              >
                Prix
              </button>
            </div>
          </div>
          <CatchUpNote summary={summary} />
          <div class="card">
            {ledger.length === 0 ? (
              <div class="row empty">
                <div class="nm">
                  <b>Rien au registre</b>
                  <p>Rien pour ce filtre cette semaine.</p>
                </div>
              </div>
            ) : (
              shownLedger.map((event) => {
                const line = eventLine(event, house.id, nameOf);

                return (
                  <div class="ev">
                    <span class={`dot ${line.tone}`} aria-hidden="true"></span>
                    <p>{line.text}</p>
                  </div>
                );
              })
            )}
          </div>
          {ledger.length > LEDGER_LIMIT ? (
            <div class="more">
              <button class="btn outline wide" type="button" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Réduire' : `Voir les ${ledger.length - LEDGER_LIMIT} autres`}
              </button>
            </div>
          ) : null}
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
                    portée par <span>{nameOf(law.sponsorHouseId)}</span> &middot; semaine {law.enactedWeek}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

/**
 * Local development only: the server sets `dev` on the payload it serves when
 * it was started with DEV_ADVANCE. The button has no place in production.
 */
function DevBar({ busy, onAdvance }: { busy: boolean; onAdvance(): void }) {
  return (
    <div class="dev">
      <button
        id="advance-week"
        type="button"
        title="Mode développement : simule une heure"
        disabled={busy}
        onClick={onAdvance}
      >
        Semaine suivante
      </button>
    </div>
  );
}

export function houseName(world: WorldResponse['world']): (houseId: string) => string {
  const names = new Map(world.town.houses.map((house) => [house.id, house.name]));
  names.set(world.house.id, world.house.name);

  return (houseId) => names.get(houseId) ?? 'une maison inconnue';
}

export function countdownText(nextTickAt: string, now: number): string {
  const remaining = new Date(nextTickAt).getTime() - now;

  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 'semaine imminente';
  }

  return `semaine dans ${durationText(remaining)}`;
}

/** The same countdown for the scrutiny the projection dates, never a computed one. */
export function scrutinyText(nextScrutinyAt: string, now: number): string {
  const remaining = new Date(nextScrutinyAt).getTime() - now;

  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 'scrutin imminent';
  }

  return `scrutin dans ${durationText(remaining)}`;
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

function Calendar({ calendar, year, now }: { calendar: CalendarView; year: number; now: number }) {
  const weeks = Array.from({ length: calendar.weeksPerYear }, (_, index) => index + 1);

  return (
    <section class="cal" aria-labelledby="cal-title">
      <div class="h">
        <b id="cal-title">Le calendrier</b>
        <span>
          an {year} &middot; semaine {calendar.weekOfYear} sur {calendar.weeksPerYear}
        </span>
      </div>
      <div class="cal-card">
        <ol class="weeks" aria-label={`Semaine ${calendar.weekOfYear} sur ${calendar.weeksPerYear}`}>
          {weeks.map((week) => (
            <li
              key={week}
              class={week === calendar.weekOfYear ? 'now' : week === calendar.weeksPerYear ? 'scrutiny' : ''}
              aria-current={week === calendar.weekOfYear ? 'true' : undefined}
              title={week === calendar.weeksPerYear ? 'Scrutin' : `Semaine ${week}`}
            >
              <span>{week}</span>
            </li>
          ))}
        </ol>
        <p class="cal-line">
          {scrutinyText(calendar.nextScrutinyAt, now)} &middot; toutes les charges sont remises en jeu.
        </p>
      </div>
    </section>
  );
}

function WorkshopRow({
  workshop,
  priceCents,
  stock,
  pendingInput,
  onGoMarket,
}: {
  workshop: WorldResponse['world']['house']['workshops'][number];
  priceCents: number;
  stock: WorldResponse['world']['house']['stock'];
  pendingInput: number;
  onGoMarket(): void;
}) {
  const input = workshop.input;
  const inputName = input === null ? null : goodName(input);
  const held = input === null ? 0 : (stock[input] ?? 0);
  const effectiveHeld = Math.max(0, held + pendingInput);
  const missing = input === null ? 0 : Math.max(0, workshop.inputUnitsPerWeek - effectiveHeld);
  const pendingBuy = input !== null && pendingInput > 0 ? pendingInput : 0;
  const pendingSell = input !== null && pendingInput < 0 ? -pendingInput : 0;

  return (
    <div class="row">
      <div class="th">
        <WorkshopThumb good={workshop.good} />
      </div>
      <div class="nm">
        <b>{workshopName(workshop.good)}</b>
        {inputName === null ? null : (
          <p>
            {inputName} → {goodName(workshop.good)}
          </p>
        )}
        {/* The chain line already names the trade; the two numbers below are the
            week in units, the only ones a player acts on. Level and workers are
            their causes, and the wages are written in the ledger each week. */}
        <p>
          {goodQuantity(workshop.outputUnitsPerWeek, workshop.good)}/semaine
          {input !== null ? ` · ${goodQuantity(workshop.inputUnitsPerWeek, input)}` : ''}
        </p>
        {missing > 0 && input !== null ? (
          <p class="warn">
            {pendingBuy > 0 ? 'Il manque toujours ' : 'Il manque '}
            {goodQuantity(missing, input)} pour produire cette semaine.
          </p>
        ) : null}
        {input !== null && pendingBuy > 0 ? (
          <p class="pending">Achat de {goodQuantity(pendingBuy, input)} en attente pour cette semaine.</p>
        ) : null}
        {input !== null && pendingSell > 0 ? (
          <p class="pending">Vente de {goodQuantity(pendingSell, input)} en attente pour cette semaine.</p>
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

function CatchUpNote({ summary }: { summary: WorldResponse['summary'] }) {
  if (summary.weeksPlayed <= 1 && summary.skippedWeeks === 0) {
    return null;
  }

  const parts: string[] = [];
  if (summary.weeksPlayed > 1) {
    parts.push(`${summary.weeksPlayed} semaines vécues depuis votre dernière visite, la dernière seule est détaillée.`);
  }
  if (summary.skippedWeeks > 0) {
    parts.push(`${summary.skippedWeeks} semaines sautées faute de place dans le rattrapage.`);
  }

  return <p class="note">{parts.join(' ')}</p>;
}

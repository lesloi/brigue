import type { CalendarView, WorldResponse } from '../api.ts';
import { eventLine } from '../events.ts';
import { formatCents, formatCount, goodName, workshopName } from '../format.ts';
import { HeroScene } from '../hero.tsx';
import { ResourceIcon, Seal, WorkshopThumb } from '../icons.tsx';

interface VilleProps {
  data: WorldResponse;
  now: number;
  buying: boolean;
  advancing: boolean;
  onRefresh(): void;
  onBuyWool(): void;
  onAdvance(): void;
}

/** The Ville screen, rendered only from the projection and last week's events. */
export function Ville({ data, now, buying, advancing, onRefresh, onBuyWool, onAdvance }: VilleProps) {
  const { world, events, summary } = data;
  const house = world.house;
  const nameOf = houseName(world);

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
          <ResourceIcon kind="cloth" />
          <span class="v">{formatCount(house.stock.cloth ?? 0)}</span>
          <span class="l">drap</span>
        </div>
        <div class="c">
          <ResourceIcon kind="wool" />
          <span class="v">{formatCount(house.stock.wool ?? 0)}</span>
          <span class="l">laine</span>
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
                <WorkshopRow workshop={workshop} priceCents={world.town.market[workshop.good]} />
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
            <div class="buy">
              <div>
                <b>Acheter de la laine</b>
                <p>{formatCents(world.town.market.wool)} écus l'unité &middot; appliqué à la prochaine semaine</p>
              </div>
              <button class="btn" id="buy-wool" type="button" disabled={buying} onClick={onBuyWool}>
                10 laines
              </button>
            </div>
          </div>
        </section>

        <section class="sec" aria-labelledby="week-title">
          <div class="h">
            <b id="week-title">La semaine dernière</b>
            <span>
              {events.length} ligne{events.length > 1 ? 's' : ''}
            </span>
          </div>
          <CatchUpNote summary={summary} />
          <div class="card">
            {events.length === 0 ? (
              <div class="row empty">
                <div class="nm">
                  <b>Rien au registre</b>
                  <p>Aucun événement pour cette semaine.</p>
                </div>
              </div>
            ) : (
              events.map((event) => {
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
}: {
  workshop: WorldResponse['world']['house']['workshops'][number];
  priceCents: number;
}) {
  return (
    <div class="row">
      <div class="th">
        <WorkshopThumb good={workshop.good} />
      </div>
      <div class="nm">
        <b>{workshopName(workshop.good)}</b>
        <p>
          <span class="lv">niv. {workshop.level}</span> {formatCount(workshop.workers)} ouvrier
          {workshop.workers > 1 ? 's' : ''} &middot; {goodName(workshop.good)}
        </p>
      </div>
      <div class="act">
        <span class="price">
          <b>{formatCents(priceCents)}</b> écus
        </span>
        <span class="price-l">l'unité</span>
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

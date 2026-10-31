import type { WorldResponse } from '../api.ts';
import { eventLine } from '../events.ts';
import { formatCents, formatCount, goodName, workshopName } from '../format.ts';
import { heroScene } from '../hero.ts';
import { esc } from '../html.ts';
import { navIcon, resourceIcon, seal, workshopThumb } from '../icons.ts';

/** The Ville screen, rendered only from the projection and last week's events. */
export function villeTemplate(data: WorldResponse): string {
  const { world, events, summary } = data;
  const house = world.house;
  const nameOf = houseName(world);

  return `<div class="app">
  <main class="screen">
    <section class="hero" aria-label="Saint-Aubin">
      ${heroScene()}
      <div class="scrim"></div>
      <div class="id">
        ${seal()}
        <div><div class="nm">Maison ${esc(house.name)}</div><div class="pl">Saint-Aubin &middot; an ${esc(world.year)}</div></div>
        <div class="wk">sem. ${esc(world.week)}</div>
      </div>
      <div class="cap">
        <div><div class="sub">une ville de la hanse</div><h1>Saint-Aubin</h1></div>
        <button class="tick" id="refresh" type="button" aria-label="Rafraîchir la ville">
          <span id="tick-countdown">—</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>
        </button>
      </div>
    </section>

    <section class="res" aria-label="Ressources">
      <div class="c">${resourceIcon('coins')}<span class="v">${esc(formatCents(house.treasuryCents))}</span><span class="l">écus</span></div>
      <div class="c">${resourceIcon('cloth')}<span class="v">${esc(formatCount(house.stock.cloth ?? 0))}</span><span class="l">drap</span></div>
      <div class="c">${resourceIcon('wool')}<span class="v">${esc(formatCount(house.stock.wool ?? 0))}</span><span class="l">laine</span></div>
      <div class="c">${resourceIcon('favour')}<span class="v">${esc(formatCount(house.favour))}</span><span class="l">faveur</span></div>
    </section>

    <div class="body">
      <section class="sec" aria-labelledby="house-title">
        <div class="h"><b id="house-title">Ta maison</b><span>${esc(house.workshops.length)} atelier${house.workshops.length > 1 ? 's' : ''}</span></div>
        <div class="card">
          ${
            house.workshops.length === 0
              ? `<div class="row empty"><div class="nm"><b>Aucun atelier</b><p>La maison n'a pas encore de quoi produire.</p></div></div>`
              : house.workshops.map((workshop) => workshopRow(workshop, world)).join('')
          }
          ${
            house.debtCents > 0
              ? `<div class="row debt"><div class="th">${resourceIcon('coins')}</div><div class="nm"><b>Dette</b><p>À rembourser sur les prochaines semaines.</p></div><div class="act"><span class="price owed"><b>${esc(formatCents(house.debtCents))}</b> écus</span></div></div>`
              : ''
          }
          <div class="buy">
            <div><b>Acheter de la laine</b><p>${esc(formatCents(world.town.market.wool))} écus l'unité &middot; appliqué à la prochaine semaine</p></div>
            <button class="btn" id="buy-wool" type="button">10 laines</button>
          </div>
        </div>
      </section>

      <section class="sec" aria-labelledby="week-title">
        <div class="h"><b id="week-title">La semaine dernière</b><span>${esc(events.length)} ligne${events.length > 1 ? 's' : ''}</span></div>
        ${catchUpNote(summary)}
        <div class="card">
          ${
            events.length === 0
              ? `<div class="row empty"><div class="nm"><b>Rien au registre</b><p>Aucun événement pour cette semaine.</p></div></div>`
              : events
                  .map((event) => {
                    const line = eventLine(event, house.id, nameOf);
                    return `<div class="ev"><span class="dot ${line.tone}" aria-hidden="true"></span><p>${esc(line.text)}</p></div>`;
                  })
                  .join('')
          }
        </div>
      </section>

      <section class="sec" aria-labelledby="laws-title">
        <div class="h"><b id="laws-title">Ce qui est loi</b><span>${esc(world.town.laws.length)} en vigueur</span></div>
        <div class="card">
          ${
            world.town.laws.length === 0
              ? `<div class="row empty"><div class="nm"><b>Aucune loi</b><p>La ville se gouverne encore par l'usage.</p></div></div>`
              : world.town.laws
                  .map(
                    (law) =>
                      `<div class="law"><b>${esc(law.title)}</b><span class="pill">vigueur</span><p>portée par <span>${esc(nameOf(law.sponsorHouseId))}</span> &middot; semaine ${esc(law.enactedWeek)}</p></div>`,
                  )
                  .join('')
          }
        </div>
      </section>
    </div>
  </main>

  <div class="fade" aria-hidden="true"></div>
  <nav class="nav" aria-label="Navigation principale">
    ${navItem('ville', 'Ville', true)}
    ${navItem('marche', 'Marché', false)}
    ${navItem('conseil', 'Conseil', false)}
    ${navItem('greffe', 'Greffe', false)}
    ${navItem('courrier', 'Courrier', false)}
  </nav>

  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
</div>`;
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

  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `semaine dans ${hours} h ${String(minutes).padStart(2, '0')}`;
  }

  return `semaine dans ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function workshopRow(
  workshop: WorldResponse['world']['house']['workshops'][number],
  world: WorldResponse['world'],
): string {
  const price = world.town.market[workshop.good];
  return `<div class="row">
    <div class="th">${workshopThumb(workshop.good)}</div>
    <div class="nm"><b>${esc(workshopName(workshop.good))}</b><p><span class="lv">niv. ${esc(workshop.level)}</span> ${esc(formatCount(workshop.workers))} ouvrier${workshop.workers > 1 ? 's' : ''} &middot; ${esc(goodName(workshop.good))}</p></div>
    <div class="act"><span class="price"><b>${esc(formatCents(price))}</b> écus</span><span class="price-l">l'unité</span></div>
  </div>`;
}

function catchUpNote(summary: WorldResponse['summary']): string {
  if (summary.weeksPlayed <= 1 && summary.skippedWeeks === 0) {
    return '';
  }

  const parts: string[] = [];
  if (summary.weeksPlayed > 1) {
    parts.push(`${summary.weeksPlayed} semaines vécues depuis votre dernière visite, la dernière seule est détaillée.`);
  }
  if (summary.skippedWeeks > 0) {
    parts.push(`${summary.skippedWeeks} semaines sautées faute de place dans le rattrapage.`);
  }

  return `<p class="note">${esc(parts.join(' '))}</p>`;
}

function navItem(kind: 'ville' | 'marche' | 'conseil' | 'greffe' | 'courrier', label: string, active: boolean): string {
  if (active) {
    return `<a class="nav-item on" href="/" aria-current="page">${navIcon(kind)}<span>${esc(label)}</span></a>`;
  }

  return `<button class="nav-item" type="button" disabled title="À venir" aria-label="${esc(label)} (à venir)">${navIcon(kind)}<span>${esc(label)}</span></button>`;
}

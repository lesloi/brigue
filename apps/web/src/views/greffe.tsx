import type { WorldResponse } from '../api.ts';
import { eventLine } from '../events.ts';
import { formatCount } from '../format.ts';
import { Seal } from '../icons.tsx';
import { personName } from './ville.tsx';

/**
 * The Greffe is the town's public chronicle: the elections that changed a seat,
 * and later its laws. Every reader sees the same page; it carries no private
 * line.
 */
export function Greffe({ data }: { data: WorldResponse }) {
  const { chronicle, world, summary } = data;
  const nameOf = personName(world);
  const newestFirst = [...chronicle].reverse();

  return (
    <main class="screen">
      <header class="mhead">
        <Seal />
        <div>
          <div class="eyebrow">
            {world.town.name} &middot; an {world.year}
          </div>
          <h1>Le greffe</h1>
        </div>
        <div class="wk">
          h. {world.calendar.hourOfYear}/{world.calendar.hoursPerYear}
        </div>
      </header>

      <div class="body">
        <section class="sec" aria-labelledby="chronicle-title">
          <div class="h">
            <b id="chronicle-title">Chronique de la ville</b>
            <span>
              {formatCount(chronicle.length)} ligne{chronicle.length > 1 ? 's' : ''}
            </span>
          </div>
          <CatchUpNote summary={summary} />
          <div class="card">
            {chronicle.length === 0 ? (
              <div class="row empty">
                <div class="nm">
                  <b>Rien à la chronique</b>
                  <p>La ville n'a rien changé qui vaille une ligne.</p>
                </div>
              </div>
            ) : (
              newestFirst.map((event, index) => {
                const line = eventLine(event, world.person.id, nameOf);

                return (
                  <div class="ev" key={`${event.type}-${event.at}-${index}`}>
                    <span class={`dot ${line.tone}`} aria-hidden="true"></span>
                    <p>{line.text}</p>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function CatchUpNote({ summary }: { summary: WorldResponse['summary'] }) {
  const text = catchUpText(summary);

  if (text === null) {
    return null;
  }

  return <p class="note">{text}</p>;
}

/** What the pages do not show, said with the grammar of its count. */
export function catchUpText(summary: WorldResponse['summary']): string | null {
  const parts: string[] = [];
  const hours = (count: number) => `${formatCount(count)} heure${count > 1 ? 's' : ''}`;

  if (summary.hours >= 1) {
    parts.push(`${hours(summary.hours)} vécue${summary.hours > 1 ? 's' : ''} depuis votre dernière visite.`);
  }
  if (summary.skipped > 0) {
    parts.push(`${hours(summary.skipped)} sautée${summary.skipped > 1 ? 's' : ''} faute de place dans le rattrapage.`);
  }

  return parts.length === 0 ? null : parts.join(' ');
}

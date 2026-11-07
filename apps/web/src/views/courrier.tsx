import { useEffect, useRef } from 'preact/hooks';

import type { WorldResponse } from '../api.ts';
import { eventLine } from '../events.ts';
import { formatCount } from '../format.ts';
import { Seal } from '../icons.tsx';
import { dynastyName } from './ville.tsx';

/**
 * The Courrier is the dynasty's own mailbox: refusals, works done or lost, its
 * debts, its candidacies. It is private, and opening it clears the badge.
 */
export function Courrier({
  data,
  onSeen,
  onDelete,
}: {
  data: WorldResponse;
  onSeen(): void;
  onDelete(id: number): void;
}) {
  const { messages, world } = data;
  const nameOf = dynastyName(world);
  // The badge follows the mailbox, not the page: one visit clears it once.
  const asked = useRef(false);

  useEffect(() => {
    if (data.unreadMessages > 0 && !asked.current) {
      asked.current = true;
      onSeen();
    }
  }, [data.unreadMessages, onSeen]);

  // The server hands the page in time order; an inbox reads newest first.
  const newestFirst = [...messages].reverse();

  return (
    <main class="screen">
      <header class="mhead">
        <Seal />
        <div>
          <div class="eyebrow">
            {world.town.name} &middot; an {world.year}
          </div>
          <h1>Le courrier</h1>
        </div>
        <div class="wk">
          h. {world.calendar.hourOfYear}/{world.calendar.hoursPerYear}
        </div>
      </header>

      <div class="body">
        <section class="sec" aria-labelledby="mail-title">
          <div class="h">
            <b id="mail-title">Messages</b>
            <span>
              {data.unreadMessages > 0
                ? `${formatCount(data.unreadMessages)} non lu${data.unreadMessages > 1 ? 's' : ''}`
                : `${formatCount(messages.length)} message${messages.length > 1 ? 's' : ''}`}
            </span>
          </div>
          <div class="card">
            {messages.length === 0 ? (
              <div class="row empty">
                <div class="nm">
                  <b>Aucun message</b>
                  <p>La dynastie n'a rien à se faire dire.</p>
                </div>
              </div>
            ) : (
              newestFirst.map((message) => {
                const line = eventLine(message.event, world.dynasty.id, nameOf);

                return (
                  <div class="ev" key={message.id}>
                    <span class={`dot ${line.tone}`} aria-hidden="true"></span>
                    <p>{line.text}</p>
                    {/* No trash: the message goes for good, and its line with it. */}
                    <button
                      class="msg-del"
                      type="button"
                      aria-label="Supprimer ce message"
                      title="Supprimer"
                      onClick={() => onDelete(message.id)}
                    >
                      Supprimer
                    </button>
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

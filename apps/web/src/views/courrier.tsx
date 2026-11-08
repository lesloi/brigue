import { useEffect, useRef, useState } from 'preact/hooks';

import type { MessageView, WorldResponse } from '../api.ts';
import { eventLine, type EventLine } from '../events.ts';
import { formatCount } from '../format.ts';
import { Seal } from '../icons.tsx';
import { Modal } from './modal.tsx';
import { dynastyName } from './ville.tsx';

/**
 * The Courrier is the dynasty's own mailbox: refusals, works done or lost, its
 * debts, its candidacies. A message is unread until the player opens it, so the
 * list carries a « Lu » action per unread line, and the detail the delete.
 */
export function Courrier({
  data,
  onRead,
  onDelete,
}: {
  data: WorldResponse;
  onRead(id: number): void;
  onDelete(id: number): void;
}) {
  const { messages, world } = data;
  const nameOf = dynastyName(world);
  const [opened, setOpened] = useState<MessageView | null>(null);

  // The server hands the page in time order; an inbox reads newest first.
  const newestFirst = [...messages].reverse();

  function open(message: MessageView): void {
    setOpened(message);

    // Showing the message is what reads it; the list itself reads nothing.
    if (!message.read) {
      onRead(message.id);
    }
  }

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
                  <div class={`ev${message.read ? '' : ' unread'}`} key={message.id}>
                    <span class={`dot ${line.tone}`} aria-hidden="true"></span>
                    <button class="msg-text" type="button" onClick={() => open(message)}>
                      {line.text}
                    </button>
                    {message.read ? null : (
                      <button
                        class="msg-read"
                        type="button"
                        aria-label="Marquer comme lu"
                        onClick={() => onRead(message.id)}
                      >
                        Lu
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {opened !== null ? (
        <MessageDialog
          line={eventLine(opened.event, world.dynasty.id, nameOf)}
          onClose={() => setOpened(null)}
          onDelete={() => {
            onDelete(opened.id);
            setOpened(null);
          }}
        />
      ) : null}
    </main>
  );
}

/** One message, displayed: that is when it is read, and where it can go. */
function MessageDialog({ line, onClose, onDelete }: { line: EventLine; onClose(): void; onDelete(): void }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The safe choice is what a stray Enter lands on.
    closeButton.current?.focus();
  }, []);

  return (
    <Modal titleId="message-title" onClose={onClose}>
      <h2 id="message-title">Message</h2>
      <p class="msg-body">{line.text}</p>
      <div class="dialog-actions">
        <button class="btn outline" type="button" ref={closeButton} onClick={onClose}>
          Fermer
        </button>
        <button class="btn" type="button" onClick={onDelete}>
          Supprimer
        </button>
      </div>
    </Modal>
  );
}

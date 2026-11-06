import type { Event, RefusalReason } from '@brigue/core';

import type { JournalCounts, JournalRefusals } from './worlds.ts';

/** What the journal page leaves behind, counted before it is thrown away. */
export interface JournalTally {
  counts: JournalCounts;
  refusals: JournalRefusals;
}

export function emptyTally(): JournalTally {
  return { counts: {}, refusals: {} };
}

/** One event into the tally. A refusal is counted twice on purpose: by type and by reason. */
export function countEvent(tally: JournalTally, event: Event): void {
  add(tally.counts, event.type, 1);
  if (event.type === 'action.refused') {
    add(tally.refusals, event.reason, 1);
  }
}

/** A row of `GROUP BY type, payload->>'reason'` into the same tally. */
export interface GroupedCount {
  type: string;
  reason: string | null;
  count: number;
}

export function foldGrouped(tally: JournalTally, rows: readonly GroupedCount[]): void {
  for (const row of rows) {
    add(tally.counts, row.type as Event['type'], row.count);
    // Only a refusal has a reason: a future event carrying one must not leak
    // into the refusal tally.
    if (row.type === 'action.refused' && row.reason !== null) {
      add(tally.refusals, row.reason as RefusalReason, row.count);
    }
  }
}

function add<K extends string>(record: Partial<Record<K, number>>, key: K, count: number): void {
  record[key] = (record[key] ?? 0) + count;
}

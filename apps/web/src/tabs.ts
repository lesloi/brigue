/**
 * The screens that exist today, and the history rule that joins them.
 *
 * A tab is a history entry: opening another tab pushes it, so the browser's
 * back button returns to the tab you came from; from the home tab it leaves the
 * PWA instead of trapping the player in a loop. The rule is pure so it can be
 * tested without a browser.
 */

export type Tab = 'ville' | 'marche' | 'maison';

export interface TabHistory {
  tab: Tab;
  /** True when the app pushed this entry; false on the first entry of a visit. */
  pushed: boolean;
}

const TABS: readonly Tab[] = ['ville', 'marche', 'maison'];

export function tabFromHash(hash: string): Tab {
  const candidate = hash.replace(/^#/, '');

  return (TABS as readonly string[]).includes(candidate) ? (candidate as Tab) : 'ville';
}

export function stateOf(state: unknown): TabHistory | null {
  if (typeof state !== 'object' || state === null) {
    return null;
  }

  const { tab, pushed } = state as { tab?: unknown; pushed?: unknown };
  if (typeof tab !== 'string' || !(TABS as readonly string[]).includes(tab) || typeof pushed !== 'boolean') {
    return null;
  }

  return { tab: tab as Tab, pushed };
}

export type Navigation = 'none' | 'back' | 'push' | 'replace';

/**
 * What selecting `next` should do to history, given the current tab and the
 * current entry's state. Coming home walks back when the app pushed the entry;
 * a deep-linked Marché has no in-app predecessor, so it replaces instead of
 * leaving the PWA.
 */
export function navigationFor(current: Tab, state: unknown, next: Tab): Navigation {
  if (current === next) {
    return 'none';
  }
  if (next === 'ville') {
    return stateOf(state)?.pushed === true ? 'back' : 'replace';
  }

  return 'push';
}

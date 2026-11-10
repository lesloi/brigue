import type { Event, GoodId, Law, PersonId, SeatId, TitleId, Trade } from '@brigue/core';

/** What `GET /api/world` returns. The client renders it and computes no rule. */
export interface CalendarView {
  hoursPerYear: number;
  hourOfYear: number;
  nextScrutinyHour: number;
  nextScrutinyAt: string;
}

/** A market action in flight, shared by the screen and the shell. */
export interface TradeIntent {
  kind: 'buy' | 'sell';
  good: GoodId;
}

/** What a queued action costs when it plays, as far as the screen knows it. */
export interface CommittedCents {
  titleCents: number;
  residenceCents: number;
  buildCents: number;
}

/** One action the server holds for the current or next hour. */
export interface PendingActionView {
  id: number;
  hour: number;
  type:
    | 'market.buy'
    | 'market.sell'
    | 'council.campaign'
    | 'workshop.build'
    | 'workshop.destroy'
    | 'workshop.upgrade'
    | 'person.buy_title'
    | 'person.upgrade_residence';
  good?: GoodId;
  units?: number;
  seatId?: SeatId;
  trade?: Trade;
  workshopId?: number;
  /** The degree a title purchase buys, so the queue can name it. */
  title?: TitleId;
}

/** A workshop as the server projects it: the chain's input is not the client's rule. */
export interface ProjectedWorkshop {
  id: number;
  good: GoodId;
  level: number;
  input: GoodId | null;
  outputUnitsPerHour: number;
  inputUnitsPerHour: number;
  upkeepCentsPerHour: number;
  capacityUnits: number;
  canUpgrade: boolean;
}

/** The ladder, every figure already computed by the server. */
export interface ProjectedLadder {
  title: TitleId;
  residence: string;
  titlePrestige: number;
  residencePrestige: number;
  servicePrestige: number;
  prestigeCap: number;
  workshops: number;
  stockDefence: number;
  workshopLevelCap: number;
  nextTitle: { title: TitleId; priceCents: number } | null;
  nextResidence: { level: number; name: string; priceCents: number; opened: boolean } | null;
}

export interface WorldProjection {
  hour: number;
  year: number;
  calendar: CalendarView;
  person: {
    id: PersonId;
    /** The family name the account carries; the person's name when it has none. */
    name: string;
    /** The name the town sees, given name and family name together. */
    personName: string;
    ia: boolean;
    treasuryCents: number;
    debtCents: number;
    favour: number;
    prestige: number;
    title: TitleId;
    residenceLevel: number;
    ladder: ProjectedLadder;
    workshops: ProjectedWorkshop[];
    stock: Partial<Record<GoodId, number>>;
    stockUnits: number;
    stockCapacityUnits: number;
    build: { priceCents: number; level: number; room: number; cap: number };
    rename: { priceCents: number };
  };
  town: {
    id: number;
    name: string;
    people: Array<{ id: PersonId; name: string; ia: boolean; prestige: number; residenceLevel: number }>;
    seats: Record<SeatId, { personId: PersonId | null }>;
    laws: Law[];
    market: Record<GoodId, number>;
    marketReferences: Record<GoodId, number>;
  };
  /** The instant the current hour ends, so the client can show the next bell. */
  nextBellAt: string;
}

export interface CatchUpSummary {
  hours: number;
}

/** One stored message: its row id, its unread state, and the line. */
export interface MessageView {
  id: number;
  read: boolean;
  event: Event;
}

export interface WorldResponse {
  world: WorldProjection;
  /** The person's private mail, newest page, in the order it happened. */
  messages: MessageView[];
  /** The town's public chronicle, newest page, in the order it happened. */
  chronicle: Event[];
  /** How many messages came after the reader's watermark, at most a page. */
  unreadMessages: number;
  summary: CatchUpSummary;
  stateHash: string;
  /** How long a deletion waits; the screen says it, the server owns it. */
  deletionGraceDays: number;
  /** Set only by a server started for local development: it exposes `advanceHour`. */
  dev?: boolean;
}

export type ActionIntent =
  | { type: 'market.buy'; good: GoodId; units: number }
  | { type: 'market.sell'; good: GoodId; units: number }
  | { type: 'council.campaign'; seatId: SeatId }
  | { type: 'workshop.build'; trade: Trade }
  | { type: 'workshop.destroy'; workshopId: number }
  | { type: 'workshop.upgrade'; workshopId: number }
  | { type: 'person.buy_title' }
  | { type: 'person.upgrade_residence' };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(code ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface SessionInfo {
  /** Empty for an account a reset left between towns, until it chooses again. */
  townId: number | null;
  personId: PersonId | null;
  /** Set when a deletion is scheduled: the deadline, in ISO. */
  deletionAfter: string | null;
}

export async function readSession(): Promise<SessionInfo | null> {
  const response = await fetch('/api/session', { credentials: 'same-origin' });

  if (response.status === 200) {
    return (await response.json()) as SessionInfo;
  }
  if (response.status === 401) {
    return null;
  }

  throw new ApiError(response.status, await errorCode(response));
}

export interface Joined {
  townId: number;
  personId: PersonId;
  /** Only a new account gets a token: a returning one keeps its own. */
  token?: string;
}

/** The identity a join is made with, drawn by the server: the family and first name. */
export interface PersonCandidate {
  familyName: string;
  personName: string;
}

/**
 * The candidate the creation screen prefills. No person is founded by it: the
 * player edits the name, keeps it, and only the join writes anything.
 */
export function readCandidate(): Promise<PersonCandidate> {
  return send('/api/dynasty/name');
}

/**
 * A trade either founds a person for a new account or gives one back to an
 * account a reset left without one; the session cookie says which. The name
 * sent is the family name the player kept.
 */
export function joinTown(trade: Trade, name: string): Promise<Joined> {
  return send<Joined>('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trade, name }),
  });
}

export function resumeTown(token: string): Promise<SessionInfo> {
  return send('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

/** Schedules the erasure of the identity; the token stays valid until then. */
export function requestDeletion(): Promise<{ deleteAfter: string }> {
  return send('/api/player/deletion', { method: 'POST' });
}

/** Cancels a scheduled erasure: the player came back. */
export function cancelDeletion(): Promise<void> {
  return sendVoid('/api/player/deletion', { method: 'DELETE' });
}

export function readWorld(): Promise<WorldResponse> {
  return send('/api/world');
}

/** The player opened one message: it is marked read. */
export function markMessageRead(id: number): Promise<{ read: boolean; unreadMessages: number }> {
  return send(`/api/messages/${id}/read`, { method: 'POST' });
}

/** Deletes one message. No trash: the row goes, and the badge count comes back. */
export function deleteMessage(id: number): Promise<{ deleted: boolean; unreadMessages: number }> {
  return send(`/api/messages/${id}`, { method: 'DELETE' });
}

/** Local development only: plays the next hour now. The server refuses in production. */
export function advanceHour(): Promise<WorldResponse> {
  return send('/api/dev/advance', { method: 'POST' });
}

export function sendAction(
  hour: number,
  action: ActionIntent,
): Promise<{ id: number; hour: number; personId: PersonId }> {
  return send('/api/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hour, action }),
  });
}

/** The actions the server still holds for this person, current and next hour. */
export async function readPending(): Promise<PendingActionView[]> {
  const body = await send<{ actions: PendingActionView[] }>('/api/actions');

  return body.actions;
}

/** The family name, changed at once: an identity, not a trade of the hour. */
export function renameFamily(name: string): Promise<{ name: string }> {
  return send('/api/dynasty/name', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function cancelAction(id: number): Promise<void> {
  const response = await fetch(`/api/actions/${id}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await errorCode(response));
  }
}

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await errorCode(response));
  }

  return (await response.json()) as T;
}

/** A call whose answer carries no body, like a deletion. */
async function sendVoid(path: string, init: RequestInit = {}): Promise<void> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await errorCode(response));
  }
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

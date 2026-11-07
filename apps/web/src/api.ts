import type { Event, GoodId, Law, SeatId, TitleId, Trade } from '@brigue/core';

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

/** One action the server holds for the current or next hour. */
/** What a queued action costs when it plays, as far as the screen knows it. */
export interface CommittedCents {
  titleCents: number;
  residenceCents: number;
  buildCents: number;
}

export interface PendingActionView {
  id: string;
  hour: number;
  type:
    | 'market.buy'
    | 'market.sell'
    | 'council.campaign'
    | 'workshop.build'
    | 'workshop.destroy'
    | 'workshop.upgrade'
    | 'dynasty.buy_title'
    | 'dynasty.upgrade_residence';
  good?: GoodId;
  units?: number;
  seatId?: SeatId;
  trade?: Trade;
  workshopId?: string;
  /** The degree a title purchase buys, so the queue can name it. */
  title?: TitleId;
}

/** A workshop as the server projects it: the chain's input is not the client's rule. */
export interface ProjectedWorkshop {
  id: string;
  good: GoodId;
  level: number;
  input: GoodId | null;
  outputUnitsPerHour: number;
  inputUnitsPerHour: number;
  upkeepCentsPerHour: number;
  capacityUnits: number;
  canUpgrade: boolean;
  upgradeHours: number | null;
}

/** A site under way, and the hour it closes. */
export interface ProjectedSite {
  id: string;
  dueAt: number;
  work: 'build' | 'upgrade' | 'residence' | 'title';
  trade: Trade | null;
  workshopId: string | null;
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
  nextResidence: { level: number; name: string; priceCents: number; opened: boolean; hours: number } | null;
}

export interface WorldProjection {
  hour: number;
  year: number;
  calendar: CalendarView;
  dynasty: {
    id: string;
    name: string;
    treasuryCents: number;
    debtCents: number;
    favour: number;
    prestige: number;
    career: number;
    dormant: boolean;
    title: TitleId;
    residenceLevel: number;
    ladder: ProjectedLadder;
    workshops: ProjectedWorkshop[];
    stock: Partial<Record<GoodId, number>>;
    stockUnits: number;
    stockCapacityUnits: number;
    build: { priceCents: number; hours: number; level: number; room: number; cap: number };
    sites: ProjectedSite[];
    rename: { priceCents: number };
  };
  town: {
    id: number;
    name: string;
    dynasties: Array<{ id: string; name: string; prestige: number; dormant: boolean; residenceLevel: number }>;
    people: Array<{ id: string; dynastyId: string; name: string }>;
    seats: Record<SeatId, { personId: string | null }>;
    laws: Law[];
    market: Record<GoodId, number>;
    marketHistory: Partial<Record<GoodId, number[]>>;
    marketReferences: Record<GoodId, number>;
  };
  /** The instant the current hour ends, so the client can show the next bell. */
  nextBellAt: string;
}

export interface CatchUpSummary {
  hours: number;
  skipped: number;
}

export interface WorldResponse {
  world: WorldProjection;
  /** The dynasty's private mail, newest page, in the order it happened. */
  messages: Event[];
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
  | { type: 'workshop.destroy'; workshopId: string }
  | { type: 'workshop.upgrade'; workshopId: string }
  | { type: 'dynasty.buy_title' }
  | { type: 'dynasty.upgrade_residence' };

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
  dynastyId: string | null;
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
  dynastyId: string;
  /** Only a new account gets a token: a returning one keeps its own. */
  token?: string;
}

/** The identity a join is made with, drawn by the server: opaque id, suggested name. */
export interface DynastyCandidate {
  id: string;
  dynastyName: string;
  personName: string;
}

/**
 * The candidate the creation screen prefills. No dynasty is founded by it: the
 * player edits the name, keeps it, and only the join writes anything.
 */
export function readCandidate(): Promise<DynastyCandidate> {
  return send('/api/dynasty/name');
}

/**
 * A trade either founds a dynasty for a new account or gives one back to an
 * account a reset left without one; the session cookie says which. The name
 * sent is the one the player kept, with the id of the candidate it came from:
 * a suggestion that never arrived mints its own, the name being the player's.
 */
export function joinTown(trade: Trade, name: string, candidateId?: string): Promise<Joined> {
  return send<Joined>('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trade, name, ...(candidateId ? { candidate: { id: candidateId } } : {}) }),
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

/** The player opened the Courrier: the unread badge goes back to zero. */
export function markMessagesRead(): Promise<{ unreadMessages: number }> {
  return send('/api/messages/read', { method: 'POST' });
}

/** Local development only: plays the next hour now. The server refuses in production. */
export function advanceHour(): Promise<WorldResponse> {
  return send('/api/dev/advance', { method: 'POST' });
}

export function sendAction(
  hour: number,
  action: ActionIntent,
): Promise<{ id: string; hour: number; dynastyId: string }> {
  return send('/api/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: actionId(), hour, action }),
  });
}

/** The actions the server still holds for this dynasty, current and next hour. */
export async function readPending(): Promise<PendingActionView[]> {
  const body = await send<{ actions: PendingActionView[] }>('/api/actions');

  return body.actions;
}

/** The dynasty's name, changed at once: an identity, not a trade of the hour. */
export function renameDynasty(name: string): Promise<{ name: string }> {
  return send('/api/dynasty/name', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function cancelAction(id: string): Promise<void> {
  const response = await fetch(`/api/actions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await errorCode(response));
  }
}

/**
 * `crypto.randomUUID` is only exposed in a secure context, and a phone testing
 * the town over plain HTTP is not one. getRandomValues is available everywhere.
 */
function actionId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

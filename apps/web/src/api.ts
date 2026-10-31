import type { Event, GoodId, Law, SeatId, Workshop } from '@brigue/core';

/** What `GET /api/world` returns. The client renders it and computes no rule. */
export interface WorldProjection {
  week: number;
  year: number;
  house: {
    id: string;
    name: string;
    treasuryCents: number;
    debtCents: number;
    favour: number;
    prestige: number;
    workshops: Workshop[];
    stock: Partial<Record<GoodId, number>>;
  };
  town: {
    houses: Array<{ id: string; name: string; prestige: number }>;
    seats: Record<SeatId, { houseId: string | null }>;
    laws: Law[];
    market: Record<GoodId, number>;
  };
  /** The instant the current week ends, so the client can show the next tick. */
  nextTickAt: string;
}

export interface CatchUpSummary {
  weeksPlayed: number;
  skippedWeeks: number;
  counts: Partial<Record<Event['type'], number>>;
  refusals: Partial<Record<string, number>>;
}

export interface WorldResponse {
  world: WorldProjection;
  events: Event[];
  summary: CatchUpSummary;
  stateHash: string;
}

export type ActionIntent =
  { type: 'market.buy'; good: GoodId; units: number } | { type: 'council.campaign'; seatId: SeatId };

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

export async function hasSession(): Promise<boolean> {
  const response = await fetch('/api/session', { credentials: 'same-origin' });

  if (response.status === 200) {
    return true;
  }
  if (response.status === 401) {
    return false;
  }

  throw new ApiError(response.status, await errorCode(response));
}

export interface Joined {
  worldId: string;
  houseId: string;
  token: string;
}

export function joinTown(): Promise<Joined> {
  return send<Joined>('/api/session', { method: 'POST' });
}

export function resumeTown(token: string): Promise<{ worldId: string; houseId: string }> {
  return send('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export function readWorld(): Promise<WorldResponse> {
  return send('/api/world');
}

export function sendAction(week: number, action: ActionIntent): Promise<{ id: string; week: number; houseId: string }> {
  return send('/api/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: crypto.randomUUID(), week, action }),
  });
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

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

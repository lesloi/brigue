import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorld, RULES } from '@brigue/core';

import { SESSION_COOKIE } from '../src/cookies.ts';
import { createApp, type AppDeps } from '../src/http.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryPlayerStore } from '../src/players.ts';
import { issueToken } from '../src/session.ts';
import { MemoryWorldStore } from '../src/worlds.ts';

interface Harness {
  url: string;
  store: MemoryPlayerStore;
  worlds: MemoryWorldStore;
  logs: string[];
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

async function start(options: Partial<AppDeps> = {}): Promise<Harness> {
  const store = new MemoryPlayerStore();
  const worlds = new MemoryWorldStore();
  const logs: string[] = [];
  const logger = createLogger((line) => logs.push(line));
  const server = createApp({ store, worlds, logger, ready: async () => {}, ...options });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  running.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  return { url: `http://127.0.0.1:${address.port}`, store, worlds, logs };
}

function login(harness: Harness, token: string, ip?: string): Promise<Response> {
  return fetch(`${harness.url}/api/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: JSON.stringify({ token }),
  });
}

function cookieOf(response: Response): string | undefined {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}

function cookiePair(response: Response): string {
  return (cookieOf(response) as string).split(';')[0];
}

describe('the token endpoint', () => {
  it('opens the house of a valid token and sets an httpOnly session cookie', async () => {
    const harness = await start();
    const { token } = await issueToken(harness.store, 'saint-aubin', 'brigue');

    const response = await login(harness, token);
    const cookie = cookieOf(response) as string;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ worldId: 'saint-aubin', houseId: 'brigue' });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers a revoked token exactly like an unknown one: 401 and nothing else', async () => {
    const harness = await start();
    const { token, player } = await issueToken(harness.store, 'saint-aubin', 'brigue');
    await harness.store.revoke(player.tokenHash, new Date());

    const unknown = await login(harness, `bgk_${'x'.repeat(43)}`);
    const revoked = await login(harness, token);

    expect(unknown.status).toBe(401);
    expect(revoked.status).toBe(401);
    expect(await unknown.text()).toBe('');
    expect(await revoked.text()).toBe('');
    expect(cookieOf(unknown)).toBeUndefined();
    expect(cookieOf(revoked)).toBeUndefined();
  });

  it('never reads a token from the URL', async () => {
    const harness = await start();
    const { token } = await issueToken(harness.store, 'saint-aubin', 'brigue');

    // The house is taken, so a join cannot succeed. A 200 would mean the
    // query-string token was used as an identity.
    const response = await fetch(`${harness.url}/api/session?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'no_free_house' });
    expect(cookieOf(response)).toBeUndefined();
  });

  it('refuses a malformed body without opening a session', async () => {
    const harness = await start();

    const response = await fetch(`${harness.url}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(response.status).toBe(400);
    expect(cookieOf(response)).toBeUndefined();
  });

  it('is rate limited per client, without touching another client', async () => {
    const harness = await start({ trustProxy: true, sessionAttemptsPerMinute: 2 });
    const valid = await issueToken(harness.store, 'saint-aubin', 'brigue');
    const limited = await (async () => {
      expect((await login(harness, 'nope', '203.0.113.7')).status).toBe(401);
      expect((await login(harness, 'nope', '203.0.113.7')).status).toBe(401);

      return login(harness, valid.token, '203.0.113.7');
    })();

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

    const other = await login(harness, valid.token, '198.51.100.4');
    expect(other.status).toBe(200);
  });

  it('ignores a client-chosen leftmost forwarded address', async () => {
    const harness = await start({ trustProxy: true, sessionAttemptsPerMinute: 1 });

    expect((await login(harness, 'nope', '1.2.3.4, 203.0.113.7')).status).toBe(401);
    expect((await login(harness, 'nope', '5.6.7.8, 203.0.113.7')).status).toBe(429);
  });

  it('falls back to the socket when the forwarded header is absent', async () => {
    const harness = await start({ trustProxy: true, sessionAttemptsPerMinute: 1 });

    expect((await login(harness, 'nope')).status).toBe(401);
    expect((await login(harness, 'nope')).status).toBe(429);
  });
});

describe('joining the town', () => {
  it('issues a token for the first human house and creates the world', async () => {
    const harness = await start();

    const response = await fetch(`${harness.url}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = (await response.json()) as { token: string; worldId: string; houseId: string };

    expect(response.status).toBe(201);
    expect(body.worldId).toBe('saint-aubin');
    expect(body.houseId).toBe('brigue');
    expect(body.token).toMatch(/^bgk_[A-Za-z0-9_-]{43}$/);
    expect(cookieOf(response)).toContain('HttpOnly');
    expect(await harness.worlds.withWorld('saint-aubin', async (session) => session.snapshot.world.week)).toBe(1);

    // The issued token is the identity: it logs in on the next visit.
    const again = await login(harness, body.token);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ worldId: 'saint-aubin', houseId: 'brigue' });
  });

  it('refuses a second token for a house that already has one', async () => {
    const harness = await start();
    await issueToken(harness.store, 'saint-aubin', 'brigue');

    const response = await fetch(`${harness.url}/api/session`, { method: 'POST' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'no_free_house' });
    expect(cookieOf(response)).toBeUndefined();
  });

  it('refuses to hand out a token for a world the current rules cannot read', async () => {
    const harness = await start();
    await harness.worlds.createIfAbsent(
      'saint-aubin',
      { ...createWorld(7), rulesetVersion: RULES.version + 1 },
      new Date(),
      new Date(),
    );

    const response = await fetch(`${harness.url}/api/session`, { method: 'POST' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'world_version', rulesetVersion: RULES.version + 1 });
    expect(cookieOf(response)).toBeUndefined();
  });
});

describe('the session cookie', () => {
  it('reads the house back from the cookie alone', async () => {
    const harness = await start();
    const { token } = await issueToken(harness.store, 'saint-aubin', 'herse');
    const opened = await login(harness, token);

    const response = await fetch(`${harness.url}/api/session`, {
      headers: { Cookie: cookiePair(opened) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ worldId: 'saint-aubin', houseId: 'herse' });
  });

  it('clears a dead cookie instead of replaying it', async () => {
    const harness = await start();

    const response = await fetch(`${harness.url}/api/session`, {
      headers: { Cookie: `${SESSION_COOKIE}=bgk_${'x'.repeat(43)}` },
    });

    expect(response.status).toBe(401);
    expect(cookieOf(response)).toContain('Max-Age=0');
  });

  it('revokes the token when the session is closed', async () => {
    const harness = await start();
    const { token } = await issueToken(harness.store, 'saint-aubin', 'brigue');
    const opened = await login(harness, token);

    const closed = await fetch(`${harness.url}/api/session`, {
      method: 'DELETE',
      headers: { Cookie: cookiePair(opened) },
    });
    const after = await fetch(`${harness.url}/api/session`, {
      headers: { Cookie: cookiePair(opened) },
    });

    expect(closed.status).toBe(204);
    expect(cookieOf(closed)).toContain('Max-Age=0');
    expect(after.status).toBe(401);
    expect(await login(harness, token)).toMatchObject({ status: 401 });
  });

  it('drops Secure only when the server is explicitly told to', async () => {
    const harness = await start({ secureCookies: false });
    const { token } = await issueToken(harness.store, 'saint-aubin', 'brigue');

    const response = await login(harness, token);

    expect(cookieOf(response)).not.toContain('Secure');
  });
});

describe('the logs', () => {
  it('never contain a token, whether it was accepted, unknown or revoked', async () => {
    const harness = await start();
    const { token, player } = await issueToken(harness.store, 'saint-aubin', 'brigue');

    await login(harness, token);
    await login(harness, `bgk_${'x'.repeat(43)}`);
    await harness.store.revoke(player.tokenHash, new Date());
    await login(harness, token);

    const lines = harness.logs.join('\n');

    expect(lines).toContain('session.opened');
    expect(lines).toContain('session.refused');
    expect(lines).not.toContain(token);
  });
});

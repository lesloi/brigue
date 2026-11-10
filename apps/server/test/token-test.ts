import { describe, expect, it } from 'vitest';

import { MemoryPlayerStore } from '../src/identity/players.ts';
import { authenticate, issueToken } from '../src/identity/session.ts';
import { hashToken, isTokenShaped, mintToken, TOKEN_BYTES, TOKEN_PREFIX } from '../src/identity/tokens.ts';

describe('the token', () => {
  it('carries 256 bits behind a recognisable prefix', () => {
    const token = mintToken();

    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(isTokenShaped(token)).toBe(true);
    expect(Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64url')).toHaveLength(TOKEN_BYTES);
  });

  it('is never the same twice', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => mintToken()));

    expect(tokens.size).toBe(100);
  });

  it('is stored as a hash, never as itself', async () => {
    const store = new MemoryPlayerStore();
    const { token } = await issueToken(store, 'Leclerc');

    expect(await store.findByTokenHash(token)).toBeNull();
    expect(await store.findByTokenHash(hashToken(token))).not.toBeNull();
  });
});

describe('the binding', () => {
  it('assigns the account a stable id and reads it back', async () => {
    const store = new MemoryPlayerStore();
    const { player } = await issueToken(store, 'Leclerc');

    expect(typeof player.playerId).toBe('number');
    expect((await store.findByTokenHash(player.tokenHash))?.playerId).toBe(player.playerId);
  });

  it('records the last visit and moves it on touch', async () => {
    // Arrange
    const store = new MemoryPlayerStore();
    const at = new Date('2026-10-31T12:00:00Z');
    const later = new Date('2026-11-01T12:00:00Z');
    const { player } = await issueToken(store, 'Leclerc', at);

    // Act
    await store.touch(player.tokenHash, later);

    // Assert
    expect(player.lastSeenAt).toEqual(at);
    expect((await store.findByTokenHash(player.tokenHash))?.lastSeenAt).toEqual(later);
  });

  it('opens exactly one person', async () => {
    const store = new MemoryPlayerStore();
    const leclerc = await issueToken(store, 'Leclerc');
    const caron = await issueToken(store, 'Caron');
    await store.rebind(leclerc.player.tokenHash, 1, 901, new Date());
    await store.rebind(caron.player.tokenHash, 1, 902, new Date());

    expect(await authenticate(store, leclerc.token)).toMatchObject({ townId: 1, personId: 901 });
    expect(await authenticate(store, caron.token)).toMatchObject({ townId: 1, personId: 902 });
  });

  it.each([undefined, '', 'bgk_', 'not-a-token', `bgk_${'x'.repeat(43)}`])('refuses %j', async (token) => {
    const store = new MemoryPlayerStore();
    await issueToken(store, 'Leclerc');

    expect(await authenticate(store, token)).toBeNull();
  });

  it('refuses a token whose account is gone', async () => {
    const store = new MemoryPlayerStore();
    const { token, player } = await issueToken(store, 'Leclerc');
    await store.rebind(player.tokenHash, 1, 901, new Date());

    await store.deleteAccount(player.playerId);

    expect(await authenticate(store, token)).toBeNull();
  });

  it('holds one live token per person, and allows a new one once the account is gone', async () => {
    const store = new MemoryPlayerStore();
    const first = await issueToken(store, 'Leclerc');
    await store.rebind(first.player.tokenHash, 1, 901, new Date());
    const second = await issueToken(store, 'Caron');

    await expect(store.rebind(second.player.tokenHash, 1, 901, new Date())).rejects.toThrow();
    await store.deleteAccount(first.player.playerId);

    await expect(store.rebind(second.player.tokenHash, 1, 901, new Date())).resolves.toBeDefined();
  });

  it('keeps the binding outside the world it names', async () => {
    const store = new MemoryPlayerStore();
    const { player } = await issueToken(store, 'Herse');

    expect(player).not.toHaveProperty('world');
    expect(player).toMatchObject({ townId: null, personId: null, name: 'Herse' });
  });
});

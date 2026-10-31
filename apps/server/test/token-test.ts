import { describe, expect, it } from 'vitest';

import { MemoryPlayerStore } from '../src/players.ts';
import { authenticate, issueToken } from '../src/session.ts';
import { hashToken, isTokenShaped, mintToken, TOKEN_BYTES, TOKEN_PREFIX } from '../src/tokens.ts';

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
    const { token } = await issueToken(store, 'saint-aubin', 'brigue');

    expect(await store.findByTokenHash(token)).toBeNull();
    expect(await store.findByTokenHash(hashToken(token))).not.toBeNull();
  });
});

describe('the binding', () => {
  it('opens exactly one house', async () => {
    const store = new MemoryPlayerStore();
    const brigue = await issueToken(store, 'saint-aubin', 'brigue');
    const caron = await issueToken(store, 'saint-aubin', 'caron');

    expect(await authenticate(store, brigue.token)).toMatchObject({ worldId: 'saint-aubin', houseId: 'brigue' });
    expect(await authenticate(store, caron.token)).toMatchObject({ worldId: 'saint-aubin', houseId: 'caron' });
  });

  it.each([undefined, '', 'bgk_', 'not-a-token', `bgk_${'x'.repeat(43)}`])('refuses %j', async (token) => {
    const store = new MemoryPlayerStore();
    await issueToken(store, 'saint-aubin', 'brigue');

    expect(await authenticate(store, token)).toBeNull();
  });

  it('refuses a revoked token', async () => {
    const store = new MemoryPlayerStore();
    const { token, player } = await issueToken(store, 'saint-aubin', 'brigue');

    await store.revoke(player.tokenHash, new Date('2026-10-31T12:00:00Z'));

    expect(await authenticate(store, token)).toBeNull();
  });

  it('holds one live token per house, and allows a new one after revoke', async () => {
    const store = new MemoryPlayerStore();
    const first = await issueToken(store, 'saint-aubin', 'brigue');

    await expect(issueToken(store, 'saint-aubin', 'brigue')).rejects.toThrow();
    await store.revoke(first.player.tokenHash, new Date());

    await expect(issueToken(store, 'saint-aubin', 'brigue')).resolves.toBeDefined();
  });

  it('keeps the binding outside the world it names', async () => {
    const store = new MemoryPlayerStore();
    const { player } = await issueToken(store, 'another-town', 'herse');

    expect(player).not.toHaveProperty('world');
    expect(player).toMatchObject({ worldId: 'another-town', houseId: 'herse' });
  });
});

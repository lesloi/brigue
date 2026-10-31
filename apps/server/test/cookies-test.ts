import { describe, expect, it } from 'vitest';

import { clearedSessionCookie, readSessionCookie, sessionCookie } from '../src/cookies.ts';

describe('the session cookie', () => {
  it('is httpOnly, Secure, SameSite=Strict and lasts like the token does', () => {
    const cookie = sessionCookie('bgk_value', true);

    expect(cookie).toContain('bgk_value');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=34560000');
  });

  it('drops Secure when the deployment explicitly does', () => {
    expect(sessionCookie('bgk_value', false)).not.toContain('Secure');
  });

  it('clears itself with Max-Age=0', () => {
    expect(clearedSessionCookie(true)).toContain('Max-Age=0');
    expect(clearedSessionCookie(true)).toContain('HttpOnly');
  });

  it('reads only its own cookie', () => {
    expect(readSessionCookie('other=1; brigue_token=bgk_value; trailing=2')).toBe('bgk_value');
    expect(readSessionCookie('other=1')).toBeUndefined();
    expect(readSessionCookie(undefined)).toBeUndefined();
    expect(readSessionCookie('brigue_token=')).toBeUndefined();
  });
});

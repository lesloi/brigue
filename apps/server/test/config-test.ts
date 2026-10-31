import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.ts';

describe('the config', () => {
  it('defaults to Secure cookies and an untrusted proxy', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://localhost/brigue' });

    expect(config.secureCookies).toBe(true);
    expect(config.trustProxy).toBe(false);
    expect(config.port).toBe(3000);
  });

  it('only drops Secure when told to', () => {
    expect(loadConfig({ DATABASE_URL: 'x', COOKIE_SECURE: 'false' }).secureCookies).toBe(false);
    expect(loadConfig({ DATABASE_URL: 'x', COOKIE_SECURE: 'true' }).secureCookies).toBe(true);
  });

  it('needs a database', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('refuses a port it cannot listen on', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x', PORT: '0' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL: 'x', PORT: 'seventy' })).toThrow(/PORT/);
  });
});

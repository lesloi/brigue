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

  it('mounts a client only when asked', () => {
    expect(loadConfig({ DATABASE_URL: 'x' }).webRoot).toBeUndefined();
    expect(loadConfig({ DATABASE_URL: 'x', WEB_ROOT: '' }).webRoot).toBeUndefined();
    expect(loadConfig({ DATABASE_URL: 'x', WEB_ROOT: '/app/web' }).webRoot).toBe('/app/web');
  });

  it('refuses a port it cannot listen on', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x', PORT: '0' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL: 'x', PORT: 'seventy' })).toThrow(/PORT/);
  });

  it('only exposes the development advance when explicitly asked', () => {
    expect(loadConfig({ DATABASE_URL: 'x' }).devAdvance).toBe(false);
    expect(loadConfig({ DATABASE_URL: 'x', DEV_ADVANCE: 'true' }).devAdvance).toBe(true);
    expect(loadConfig({ DATABASE_URL: 'x', DEV_ADVANCE: '1' }).devAdvance).toBe(false);
  });
});

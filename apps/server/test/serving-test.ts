import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp, type AppDeps } from '../src/http.ts';
import { createLogger } from '../src/logger.ts';
import { MemoryPlayerStore } from '../src/players.ts';
import { MemoryWorldStore } from '../src/worlds.ts';

interface Harness {
  url: string;
}

const running: Array<() => Promise<void>> = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function start(options: Partial<AppDeps> = {}): Promise<Harness> {
  const server = createApp({
    store: new MemoryPlayerStore(),
    worlds: new MemoryWorldStore(),
    logger: createLogger(() => {}),
    ready: async () => {},
    ...options,
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  running.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  return { url: `http://127.0.0.1:${address.port}` };
}

/**
 * The layout Vite produces: an `index.html`, hashed files under `assets/` and
 * a few public files at the root. The tests need it without a real build.
 */
async function builtClient(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brigue-web-'));
  directories.push(root);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Brigue</title>');
  await writeFile(join(root, 'assets', 'app-3f9a1c.js'), 'console.log("brigue");');
  await writeFile(join(root, 'sw.js'), 'self.addEventListener("install", () => {});');

  return root;
}

describe('health probes', () => {
  it('answers liveness without touching the database', async () => {
    // Arrange
    const harness = await start({
      ready: async () => {
        throw new Error('liveness must not probe the database');
      },
    });

    // Act
    const response = await fetch(`${harness.url}/healthz`);

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports ready when the database answers', async () => {
    // Arrange
    const harness = await start({ ready: async () => {} });

    // Act
    const response = await fetch(`${harness.url}/readyz`);

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports not ready when the database probe fails', async () => {
    // Arrange
    const harness = await start({
      ready: async () => {
        throw new Error('connection refused');
      },
    });

    // Act
    const response = await fetch(`${harness.url}/readyz`);

    // Assert
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });

  it('refuses anything but GET on the probes', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await fetch(`${harness.url}/healthz`, { method: 'POST' });

    // Assert
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('serving the built client', () => {
  it('serves the shell at the root', async () => {
    // Arrange
    const webRoot = await builtClient();
    const harness = await start({ webRoot });

    // Act
    const response = await fetch(`${harness.url}/`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('<title>Brigue</title>');
  });

  it('caches hashed assets forever and the service worker never', async () => {
    // Arrange
    const webRoot = await builtClient();
    const harness = await start({ webRoot });

    // Act
    const asset = await fetch(`${harness.url}/assets/app-3f9a1c.js`);
    const worker = await fetch(`${harness.url}/sw.js`);

    // Assert
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(worker.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers HEAD with the headers and no body', async () => {
    // Arrange
    const webRoot = await builtClient();
    const harness = await start({ webRoot });

    // Act
    const response = await fetch(`${harness.url}/assets/app-3f9a1c.js`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String('console.log("brigue");'.length));
    expect(await response.text()).toBe('');
  });

  it('falls back to the shell for a screen URL', async () => {
    // Arrange
    const webRoot = await builtClient();
    const harness = await start({ webRoot });

    // Act
    const response = await fetch(`${harness.url}/village`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('<title>Brigue</title>');
  });

  it('leaves the API to the API, even with a client mounted', async () => {
    // Arrange
    const webRoot = await builtClient();
    const harness = await start({ webRoot });

    // Act
    const response = await fetch(`${harness.url}/api/unknown`);

    // Assert
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('answers 404 for a missing file rather than the shell', async () => {
    // Arrange
    const webRoot = await builtClient();
    const harness = await start({ webRoot });

    // Act
    const response = await fetch(`${harness.url}/assets/missing.js`);

    // Assert
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('refuses to walk out of the client directory', async () => {
    // Arrange
    const webRoot = await builtClient();
    const harness = await start({ webRoot });

    // Act
    const plain = await fetch(`${harness.url}/../package.json`);
    const encoded = await fetch(`${harness.url}/%2e%2e/package.json`);

    // Assert
    expect(plain.status).toBe(404);
    expect(encoded.status).toBe(404);
    expect(await encoded.json()).toEqual({ error: 'not_found' });
  });

  it('refuses to mount a directory without a built shell', async () => {
    // Arrange
    const webRoot = await mkdtemp(join(tmpdir(), 'brigue-empty-'));
    directories.push(webRoot);

    // Act
    const mount = () => start({ webRoot });

    // Assert
    await expect(mount()).rejects.toThrow(/index\.html/);
  });

  it('keeps the JSON 404 when no client is mounted, as in development', async () => {
    // Arrange
    const harness = await start();

    // Act
    const response = await fetch(`${harness.url}/village`);

    // Assert
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});

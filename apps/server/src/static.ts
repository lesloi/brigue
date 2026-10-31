import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve, sep } from 'node:path';

import { sendJson } from './respond.ts';

const INDEX = 'index.html';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * The window that needs revalidating on every load, next to the hashed assets
 * that can never change under the same name. Vite swaps index.html and sw.js
 * on each deploy, and a cached copy of either would serve last week's app.
 */
const ALWAYS_REVALIDATE = new Set([INDEX, 'sw.js', 'manifest.webmanifest']);

/**
 * Mounting a client that was never built would answer 404 on the domain while
 * every probe stays green. Refuse to boot instead.
 */
export function assertWebRoot(webRoot: string): void {
  const index = join(resolve(webRoot), INDEX);

  if (statSync(index, { throwIfNoEntry: false })?.isFile() !== true) {
    throw new Error(`WEB_ROOT ${webRoot} has no ${INDEX}: the client was not built`);
  }
}

/**
 * Serves one request from the built client, or answers 404. `pathname` is
 * already parsed and still percent-encoded.
 */
export function serveStatic(
  webRoot: string,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const file = resolveFile(webRoot, pathname);

  if (file === null) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  const stats = statSync(file);
  const extension = file.slice(file.lastIndexOf('.'));
  const relative = file
    .slice(resolve(webRoot).length + 1)
    .split(sep)
    .join('/');

  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Content-Length': String(stats.size),
    'Cache-Control': cacheControl(relative),
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(file);
  // The file was there a moment ago; if it is gone now, the headers are already
  // sent and there is nothing better to do than drop the connection.
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

function resolveFile(webRoot: string, pathname: string): string | null {
  const root = resolve(webRoot);
  let decoded: string;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // A backslash is a path separator on a Windows build and a traversal tool on
  // every one of them; nothing the client ships ever needs one.
  if (decoded.includes('\0') || decoded.includes('\\')) {
    return null;
  }

  const relative = decoded.replace(/^\/+/, '');
  const candidate = resolve(root, relative);

  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }

  if (statSync(candidate, { throwIfNoEntry: false })?.isFile() === true) {
    return candidate;
  }

  // A path without an extension is a screen, not a file: hand it the shell and
  // let the client decide. A missing asset stays a 404 instead of an HTML page
  // served under a .js URL.
  const last = relative.slice(relative.lastIndexOf('/') + 1);
  if (!last.includes('.')) {
    return join(root, INDEX);
  }

  return null;
}

function cacheControl(relative: string): string {
  if (relative.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (ALWAYS_REVALIDATE.has(relative)) {
    return 'no-cache';
  }

  return 'public, max-age=3600';
}

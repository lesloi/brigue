import { loadConfig } from './config.ts';
import { createApp } from './http.ts';
import { createLogger } from './logger.ts';
import { createPgPlayerStore } from './pg-players.ts';
import { createPgWorldStore } from './pg-worlds.ts';

const config = loadConfig(process.env);
const logger = createLogger((line) => process.stdout.write(`${line}\n`));

if (!config.secureCookies) {
  logger.warn('config.insecure_cookie', {
    // The token cookie is worth a house: only opt out on localhost.
    detail: 'COOKIE_SECURE=false sends the session cookie without Secure',
  });
}

const store = await createPgPlayerStore(config.databaseUrl);
const worlds = await createPgWorldStore(config.databaseUrl);
const server = createApp({
  store,
  worlds,
  logger,
  ready: () => store.ping(),
  webRoot: config.webRoot,
  secureCookies: config.secureCookies,
  trustProxy: config.trustProxy,
});

server.listen(config.port, config.host, () => {
  logger.info('server.listening', { port: config.port, host: config.host });
});

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  logger.info('server.stopping', { signal });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await store.close();
  await worlds.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

import { loadConfig } from './config.ts';
import { createApp } from './http/app.ts';
import { createLogger } from './logger.ts';
import { createPgPlayerStore } from './identity/pg-players.ts';
import { createPgWorldStore } from './town/pg-worlds.ts';
import { startScheduler } from './town/scheduler.ts';

const config = loadConfig(process.env);
const logger = createLogger((line) => process.stdout.write(`${line}\n`));

if (!config.secureCookies) {
  logger.warn('config.insecure_cookie', {
    // The token cookie is worth a dynasty: only opt out on localhost.
    detail: 'COOKIE_SECURE=false sends the session cookie without Secure',
  });
}

if (config.devAdvance) {
  logger.warn('config.dev_advance', {
    // A player who can skip weeks can outrun the town: local development only.
    detail: 'DEV_ADVANCE=true exposes POST /api/dev/advance',
  });
}

const store = await createPgPlayerStore(config.databaseUrl);
const worlds = await createPgWorldStore(config.databaseUrl);
// The town moves without a reader; a read only catches up when this loop is
// more than an hour behind.
const scheduler = startScheduler({ store: worlds, players: store, logger, now: () => new Date() });
const server = createApp({
  store,
  worlds,
  logger,
  ready: () => store.ping(),
  webRoot: config.webRoot,
  devAdvance: config.devAdvance,
  secureCookies: config.secureCookies,
  trustProxy: config.trustProxy,
});

server.listen(config.port, config.host, () => {
  logger.info('server.listening', { port: config.port, host: config.host });
});

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  logger.info('server.stopping', { signal });
  scheduler.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await store.close();
  await worlds.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  secureCookies: boolean;
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got ${String(env.PORT)}`);
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    databaseUrl,
    // Default is the safe one. Local development over plain HTTP has to opt
    // out explicitly, and main.ts warns when it does.
    secureCookies: env.COOKIE_SECURE !== 'false',
    // The ingress terminates TLS and forwards the client address. Set only
    // when the peer really is that ingress: otherwise the header is spoofable.
    trustProxy: env.TRUST_PROXY === 'true',
  };
}

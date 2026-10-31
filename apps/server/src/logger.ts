import { redactTokens } from './tokens.ts';

export type LogFields = Record<string, unknown>;
export type LogSink = (line: string) => void;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
}

const REDACTED_KEYS = /^(token|authorization|cookie|set-cookie)$/i;

/**
 * One JSON object per line. Field names that could carry a credential are
 * redacted, and token-shaped strings are scrubbed from the whole line, so a
 * caller that forgets cannot put a token in a log.
 */
export function createLogger(sink: LogSink, now: () => Date = () => new Date()): Logger {
  const write = (level: 'info' | 'warn', message: string, fields: LogFields = {}): void => {
    const line = JSON.stringify({
      at: now().toISOString(),
      level,
      message,
      ...(redact(fields) as LogFields),
    });

    sink(redactTokens(line));
  };

  return {
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, REDACTED_KEYS.test(key) ? '[redacted]' : redact(item)]),
    );
  }

  return value;
}

export const SESSION_COOKIE = 'brigue_token';

/**
 * 400 days is the longest a browser keeps a cookie, and it matches the decision:
 * lose the token, lose the house. A shorter cookie would lock a player out
 * without telling them why.
 */
export const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Max-Age=0`;
}

/** Reads exactly the session cookie from a Cookie header, and nothing else. */
export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const equals = part.indexOf('=');
    if (equals === -1) {
      continue;
    }

    const name = part.slice(0, equals).trim();
    if (name === SESSION_COOKIE) {
      const value = part.slice(equals + 1).trim();

      return value.length > 0 ? value : undefined;
    }
  }

  return undefined;
}

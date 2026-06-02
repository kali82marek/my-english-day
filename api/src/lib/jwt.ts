/**
 * Helpery JWT dla sesji — wydawanie i weryfikacja długożyjącego tokenu.
 *
 * Oparte na `hono/jwt` (HS256, Web Crypto pod spodem) — bez zewnętrznej biblioteki.
 * Sesja jest permanentna (do wylogowania): NIE ustawiamy krótkiego `exp`.
 * Payload niesie identyfikator użytkownika w `sub`.
 */

import { sign, verify } from 'hono/jwt';

const ALG = 'HS256' as const;

export type SessionPayload = {
  sub: string;
};

/** Wydaje token sesji dla danego użytkownika. */
export async function signSession(
  userId: string | number,
  secret: string,
): Promise<string> {
  return sign({ sub: String(userId) }, secret, ALG);
}

/**
 * Weryfikuje token i zwraca payload albo `null` dla niepoprawnego/zmanipulowanego
 * tokenu lub złego sekretu (nigdy nie rzuca).
 */
export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const payload = await verify(token, secret, ALG);
    if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

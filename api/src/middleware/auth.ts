/**
 * Middleware JWT — brama chroniąca trasy wymagające zalogowania.
 *
 * Czyta `Authorization: Bearer <jwt>`, weryfikuje przez `verifySession`,
 * na sukces ustawia `userId` w kontekście Hono; brak/niepoprawny token → 401.
 * Gotowe do nakładania także na trasy slice'ów S-01+.
 */

import { createMiddleware } from 'hono/factory';
import { verifySession } from '../lib/jwt';
import type { AppEnv } from '../types';

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';

  if (!token) {
    return c.json({ error: 'Brak tokenu uwierzytelniającego.' }, 401);
  }

  const payload = await verifySession(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Niepoprawny lub wygasły token.' }, 401);
  }

  c.set('userId', payload.sub);
  await next();
});

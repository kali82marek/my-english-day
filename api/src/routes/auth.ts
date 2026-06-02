/**
 * Router auth — register / login / me.
 *
 * - register: waliduje, normalizuje email, sprawdza unikalność, hashuje,
 *   zapisuje usera i OD RAZU wydaje token (auto-login).
 * - login: weryfikuje hasło; błąd → 401 z ogólnym komunikatem (bez enumeracji email).
 * - me: chroniony przez requireAuth; zwraca dane zalogowanego usera.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { hashPassword, verifyPassword } from '../lib/password';
import { signSession } from '../lib/jwt';
import { normalizeEmail, validateCredentials } from '../lib/validation';
import { requireAuth } from '../middleware/auth';

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
};

export const authRouter = new Hono<AppEnv>();

authRouter.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Niepoprawne dane wejściowe.' }, 400);
  }

  const errors = validateCredentials(body as Record<string, unknown>);
  if (errors.length > 0) {
    return c.json({ errors }, 400);
  }

  const email = normalizeEmail((body as { email: string }).email);
  const password = (body as { password: string }).password;

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>();
  if (existing) {
    return c.json({ error: 'Email jest już zajęty.' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const created = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id, email',
  )
    .bind(email, passwordHash)
    .first<{ id: number; email: string }>();

  if (!created) {
    return c.json({ error: 'Nie udało się utworzyć konta.' }, 500);
  }

  const token = await signSession(created.id, c.env.JWT_SECRET);
  return c.json({ token, user: { id: created.id, email: created.email } }, 201);
});

authRouter.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof (body as { email?: unknown }).email !== 'string' ||
    typeof (body as { password?: unknown }).password !== 'string'
  ) {
    return c.json({ error: 'Niepoprawne dane wejściowe.' }, 400);
  }

  const email = normalizeEmail((body as { email: string }).email);
  const password = (body as { password: string }).password;

  const user = await c.env.DB.prepare(
    'SELECT id, email, password_hash FROM users WHERE email = ?',
  )
    .bind(email)
    .first<UserRow>();

  // Ogólny komunikat dla obu przypadków (brak usera / złe hasło) — bez enumeracji.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Niepoprawny email lub hasło.' }, 401);
  }

  const token = await signSession(user.id, c.env.JWT_SECRET);
  return c.json({ token, user: { id: user.id, email: user.email } });
});

authRouter.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: number; email: string }>();

  if (!user) {
    return c.json({ error: 'Użytkownik nie istnieje.' }, 401);
  }

  return c.json({ user });
});

/**
 * Router fiszek — przegląd propozycji + bramka akceptacji (slice S-02).
 *
 * - GET /proposals: lista fiszek `proposed` zalogowanego usera + liczba sytuacji
 *   wciąż generujących (sygnał „generuję…" dla frontu).
 * - POST /:id/accept: przenosi fiszkę do bazy nauki (`status='accepted'`).
 * - DELETE /:id: odrzucenie — kasuje wiersz (odrzucone nie są przechowywane).
 *
 * Wszystkie trasy chronione; egzekwowanie własności przez `user_id` z tokenu.
 * Wzorzec raw-SQL + komunikaty PL — jak `routes/auth.ts`.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';

/** Kształt fiszki zwracanej klientowi — bez `status` (z definicji `proposed`) i `user_id`. */
type FlashcardDTO = {
  id: number;
  situation_id: number;
  type: 'word' | 'phrase' | 'sentence';
  front_en: string;
  back_pl: string;
  example_en: string;
  created_at: string;
};

export const flashcardsRouter = new Hono<AppEnv>();

// Izolacja danych — wszystkie trasy wymagają zalogowania.
flashcardsRouter.use('*', requireAuth);

// GET /proposals — propozycje do przeglądu + licznik trwających generowań.
flashcardsRouter.get('/proposals', async (c) => {
  const userId = c.get('userId');

  const { results } = await c.env.DB.prepare(
    "SELECT id, situation_id, type, front_en, back_pl, example_en, created_at FROM flashcards WHERE user_id = ? AND status = 'proposed' ORDER BY created_at",
  )
    .bind(userId)
    .all<FlashcardDTO>();

  // Sytuacje stranskrybowane, ale wciąż generujące fiszki — front pokazuje „generuję…".
  // Zakres dnia (jak `GET /situations`) — osierocony `pending` z poprzednich dni nie
  // może wiecznie blokować ekranu propozycji.
  const generating = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM situations WHERE user_id = ? AND status = 'done' AND flashcards_status = 'pending' AND date(created_at) = date('now')",
  )
    .bind(userId)
    .first<{ count: number }>();

  return c.json({ proposals: results, generatingCount: generating?.count ?? 0 });
});

// POST /:id/accept — akceptacja: propozycja → baza nauki (`accepted`).
flashcardsRouter.post('/:id/accept', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'Niepoprawny identyfikator.' }, 400);
  }

  const userId = c.get('userId');
  const result = await c.env.DB.prepare(
    "UPDATE flashcards SET status = 'accepted' WHERE id = ? AND user_id = ? AND status = 'proposed'",
  )
    .bind(id, userId)
    .run();

  // Brak zmienionego wiersza → cudza fiszka, nieistniejąca lub już zaakceptowana.
  if (result.meta.changes === 0) {
    return c.json({ error: 'Fiszka nie istnieje.' }, 404);
  }

  return c.body(null, 200);
});

// DELETE /:id — odrzucenie: kasuje wiersz (z egzekwowaniem własności).
flashcardsRouter.delete('/:id', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'Niepoprawny identyfikator.' }, 400);
  }

  const userId = c.get('userId');
  const result = await c.env.DB.prepare(
    'DELETE FROM flashcards WHERE id = ? AND user_id = ?',
  )
    .bind(id, userId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Fiszka nie istnieje.' }, 404);
  }

  return c.body(null, 204);
});

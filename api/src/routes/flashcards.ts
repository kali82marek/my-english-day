/**
 * Router fiszek — przegląd propozycji + bramka akceptacji (slice S-02) oraz sesja
 * powtórek (slice S-05, FR-011/FR-012).
 *
 * - GET /proposals: lista fiszek `proposed` zalogowanego usera + liczba sytuacji
 *   wciąż generujących (sygnał „generuję…" dla frontu).
 * - POST /:id/accept: przenosi fiszkę do bazy nauki (`status='accepted'`).
 * - DELETE /:id: odrzucenie — kasuje wiersz (odrzucone nie są przechowywane).
 * - GET /review: fiszki z bazy nauki „do powtórki teraz" (`due_at IS NULL` = świeżo
 *   zaakceptowana, od razu; inaczej `due_at <= teraz`) + liczniki `dueCount`
 *   (wszystkie do powtórki, bez limitu) i `acceptedCount` (cała baza nauki) — front
 *   odróżnia nimi „pusta baza" od „na dziś wszystko powtórzone".
 * - POST /:id/grade: ocena `again | hard | good` → nowy stan powtórek (`lib/srs.ts`).
 *
 * „Czy już pora" liczymy z chwili przekazanej z JS (`toSqlDatetime(new Date())`),
 * NIE z `datetime('now')` w SQL — testy sterują tylko zegarem JS (`vi.setSystemTime`),
 * a produkcyjnie oba są UTC. Ten sam format co DEFAULT kolumn `created_at`.
 *
 * Wszystkie trasy chronione; egzekwowanie własności przez `user_id` z tokenu; cudza,
 * nieistniejąca i (dla powtórek) wciąż `proposed` fiszka dają ten sam 404 — bez
 * wyroczni istnienia. Wzorzec raw-SQL + komunikaty PL — jak `routes/auth.ts`.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { isGrade, scheduleReview, toSqlDatetime, type ReviewState } from '../lib/srs';

// Rozmiar jednej porcji sesji — klient ocenia po jednej, kolejne pobranie po fokusie.
const REVIEW_BATCH_LIMIT = 20;

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

// GET /review — fiszki z bazy nauki, których pora nadeszła (S-05). Zarejestrowane
// statyczną ścieżką; router nie ma `GET /:id`, więc nie ma kolizji z parametrem.
flashcardsRouter.get('/review', async (c) => {
  const userId = c.get('userId');
  const now = toSqlDatetime(new Date());

  // `NULL` w `due_at` = do powtórki od razu (świeżo zaakceptowana, bez backfillu).
  // Kolejność: najdawniej „należna" pierwsza; nowe (bez `due_at`) wg chwili powstania.
  const { results } = await c.env.DB.prepare(
    "SELECT id, situation_id, type, front_en, back_pl, example_en, created_at FROM flashcards WHERE user_id = ? AND status = 'accepted' AND (due_at IS NULL OR due_at <= ?) ORDER BY COALESCE(due_at, created_at), id LIMIT ?",
  )
    .bind(userId, now, REVIEW_BATCH_LIMIT)
    .all<FlashcardDTO>();

  const counts = await c.env.DB.prepare(
    "SELECT COUNT(*) AS accepted, SUM(CASE WHEN due_at IS NULL OR due_at <= ? THEN 1 ELSE 0 END) AS due FROM flashcards WHERE user_id = ? AND status = 'accepted'",
  )
    .bind(now, userId)
    .first<{ accepted: number; due: number | null }>();

  return c.json({
    cards: results,
    dueCount: counts?.due ?? 0,
    acceptedCount: counts?.accepted ?? 0,
  });
});

// POST /:id/grade — ocena w sesji: `again` (Nie umiem) | `hard` (Prawie) | `good` (Umiem).
// Ciało i ocena walidowane PRZED dotknięciem D1; własność + `accepted` egzekwowane w
// odczycie i w `UPDATE` (ten sam 404 co `accept` dla cudzej / nieistniejącej / `proposed`).
flashcardsRouter.post('/:id/grade', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'Niepoprawny identyfikator.' }, 400);
  }

  // Nie-JSON, brak pola i wartość spoza trójki to ten sam błąd klienta.
  const body = (await c.req.json().catch(() => null)) as { grade?: unknown } | null;
  const grade = body?.grade;
  if (!isGrade(grade)) {
    return c.json({ error: 'Niepoprawna ocena.' }, 400);
  }

  const userId = c.get('userId');
  const state = await c.env.DB.prepare(
    "SELECT interval_days, ease, repetitions FROM flashcards WHERE id = ? AND user_id = ? AND status = 'accepted'",
  )
    .bind(id, userId)
    .first<ReviewState>();
  if (!state) {
    return c.json({ error: 'Fiszka nie istnieje.' }, 404);
  }

  const now = new Date();
  const next = scheduleReview(state, grade, now);
  const result = await c.env.DB.prepare(
    "UPDATE flashcards SET due_at = ?, interval_days = ?, ease = ?, repetitions = ?, reviewed_at = ? WHERE id = ? AND user_id = ? AND status = 'accepted'",
  )
    .bind(toSqlDatetime(next.due_at), next.interval_days, next.ease, next.repetitions, toSqlDatetime(now), id, userId)
    .run();

  // Wiersz zniknął między odczytem a zapisem (np. skasowana sytuacja) — ten sam kontrakt.
  if (result.meta.changes === 0) {
    return c.json({ error: 'Fiszka nie istnieje.' }, 404);
  }

  return c.body(null, 200);
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

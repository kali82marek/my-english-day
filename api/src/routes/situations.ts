/**
 * Router sytuacji — optymistyczny zapis + transkrypcja w tle, lista dnia, usuwanie.
 *
 * Wariant optymistyczny (kluczowy dla NFR „zapis w kilka sekund"):
 *   POST przyjmuje audio (multipart), zapisuje plik do R2 pod kluczem tymczasowym,
 *   wstawia wiersz `pending` i NATYCHMIAST zwraca 201. Dopiero potem, przez
 *   `c.executionCtx.waitUntil`, leci transkrypcja — odpowiedź już wyszła.
 *
 * Cykl życia pliku R2: kasowany dopiero PO potwierdzonym UPDATE transkryptu
 * (kolejność: transkrypcja → UPDATE → delete), żeby awaria zapisu do D1 nie
 * utraciła jedynej kopii audio. Przy błędzie transkrypcji plik R2 zostaje.
 *
 * Wzorzec raw-SQL + `RETURNING` + komunikaty po polsku — jak `routes/auth.ts`.
 */

import { Hono } from 'hono';
import type { AppEnv, Bindings } from '../types';
import { requireAuth } from '../middleware/auth';
import { transcribeAudio } from '../lib/transcription';

// Limit Whisper to 25 MB — większy plik odrzucamy od razu jako 400.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Wiersz tak, jak siedzi w D1 (z `audio_key`, którego NIE eksponujemy klientowi). */
type SituationRow = {
  id: number;
  user_id: number;
  transcript: string | null;
  status: 'pending' | 'done' | 'failed';
  audio_key: string | null;
  duration_ms: number | null;
  created_at: string;
};

/** Kształt zwracany klientowi — bez `audio_key`, bez `user_id`. */
type SituationDTO = {
  id: number;
  status: 'pending' | 'done' | 'failed';
  transcript: string | null;
  duration_ms: number | null;
  created_at: string;
};

function toDTO(row: SituationRow): SituationDTO {
  return {
    id: row.id,
    status: row.status,
    transcript: row.transcript,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
  };
}

/** Rozszerzenie pliku z nazwy (dla klucza R2); fallback `bin`. */
function extFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'bin';
  return name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
}

/**
 * Praca w tle: transkrypcja → finalizacja wiersza. Bufor `data` jest tą samą
 * kopią, którą zapisano do R2 (czytany raz z multipart) — nie odczytujemy z R2.
 * Sukces: UPDATE transkryptu + status='done', POTEM delete pliku R2.
 * Błąd: UPDATE status='failed' (plik R2 zostaje — hak na ewentualne przyszłe retry).
 */
async function transcribeAndFinalize(
  env: Bindings,
  situationId: number,
  audioKey: string,
  audio: { data: ArrayBuffer; name: string; type: string },
): Promise<void> {
  try {
    const transcript = await transcribeAudio(audio, env.OPENAI_API_KEY);
    await env.DB.prepare(
      "UPDATE situations SET transcript = ?, status = 'done' WHERE id = ?",
    )
      .bind(transcript, situationId)
      .run();
    // Dopiero po potwierdzonym UPDATE kasujemy tymczasowy plik audio.
    await env.AUDIO_BUCKET.delete(audioKey);
  } catch {
    await env.DB.prepare("UPDATE situations SET status = 'failed' WHERE id = ?")
      .bind(situationId)
      .run();
  }
}

export const situationsRouter = new Hono<AppEnv>();

// Wszystkie trasy chronione — izolacja danych przez userId z tokenu.
situationsRouter.use('*', requireAuth);

// POST / — optymistyczny zapis: plik → R2, wiersz `pending`, 201, transkrypcja w tle.
situationsRouter.post('/', async (c) => {
  const body = await c.req.parseBody();
  const audio = body['audio'];

  if (!(audio instanceof File) || audio.size === 0) {
    return c.json({ error: 'Brak pliku audio.' }, 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return c.json({ error: 'Plik audio jest zbyt duży (limit 25 MB).' }, 400);
  }

  const rawDuration = body['duration_ms'];
  const parsedDuration =
    typeof rawDuration === 'string' && rawDuration.trim() !== ''
      ? Number.parseInt(rawDuration, 10)
      : NaN;
  const durationMs = Number.isFinite(parsedDuration) ? parsedDuration : null;

  const userId = c.get('userId');

  // Bufor czytany RAZ — współdzielony przez zapis do R2 i wejście do Whisper.
  const data = await audio.arrayBuffer();
  const audioKey = `situations/${userId}/${crypto.randomUUID()}.${extFromName(audio.name)}`;

  await c.env.AUDIO_BUCKET.put(audioKey, data, {
    httpMetadata: { contentType: audio.type || 'application/octet-stream' },
  });

  const row = await c.env.DB.prepare(
    "INSERT INTO situations (user_id, status, audio_key, duration_ms) VALUES (?, 'pending', ?, ?) RETURNING *",
  )
    .bind(userId, audioKey, durationMs)
    .first<SituationRow>();

  if (!row) {
    // Wiersz nie powstał — sprzątamy osierocony plik R2, żeby nie zostawić śmiecia.
    await c.env.AUDIO_BUCKET.delete(audioKey);
    return c.json({ error: 'Nie udało się zapisać sytuacji.' }, 500);
  }

  // Transkrypcja PO odpowiedzi — odpowiedź 201 musi wyjść natychmiast.
  c.executionCtx.waitUntil(
    transcribeAndFinalize(c.env, row.id, audioKey, {
      data,
      name: audio.name,
      type: audio.type || 'application/octet-stream',
    }),
  );

  return c.json(toDTO(row), 201);
});

// GET / — lista sytuacji dnia bieżącego zalogowanego użytkownika.
situationsRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    "SELECT id, user_id, transcript, status, audio_key, duration_ms, created_at FROM situations WHERE user_id = ? AND date(created_at) = date('now') ORDER BY created_at DESC",
  )
    .bind(userId)
    .all<SituationRow>();

  return c.json({ situations: results.map(toDTO) });
});

// DELETE /:id — usuwa wiersz (z egzekwowaniem własności) i ewentualny plik R2.
situationsRouter.delete('/:id', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'Niepoprawny identyfikator.' }, 400);
  }

  const userId = c.get('userId');
  const row = await c.env.DB.prepare(
    'SELECT id, user_id, audio_key FROM situations WHERE id = ? AND user_id = ?',
  )
    .bind(id, userId)
    .first<{ id: number; user_id: number; audio_key: string | null }>();

  if (!row) {
    return c.json({ error: 'Sytuacja nie istnieje.' }, 404);
  }

  if (row.audio_key) {
    await c.env.AUDIO_BUCKET.delete(row.audio_key);
  }
  await c.env.DB.prepare('DELETE FROM situations WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();

  return c.body(null, 204);
});

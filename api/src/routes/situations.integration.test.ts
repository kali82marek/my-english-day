/**
 * Testy integracyjne trasy `/situations` w workerd — dowody ryzyk z
 * `context/foundation/test-plan.md` §2. Każdy `describe` to jedno ryzyko; każdy test
 * koduje OBSERWOWALNY skutek (odpowiedź HTTP, wiersz w D1, zawartość bucketa R2), nie
 * odbicie implementacji, i ma nazwany deliberate-break w komentarzu.
 *
 * Zasady harnessu (patrz `test/setup.ts`, `test/db.ts`):
 * - OpenAI mockowane WYŁĄCZNIE na krawędzi sieci (`mockOpenAI`); D1/R2 nigdy od środka.
 * - Błędy D1 wstrzykiwane triggerem `RAISE(ABORT)` na schemacie z migracji (`withTrigger`).
 * - Izolacja jest per PLIK, więc `afterEach(resetDb)` sprząta tabele, triggery i bucket.
 * - Asercje na stanie D1 po `201` dopiero po `await waitOnExecutionContext(ctx)`.
 * - Luka względem PRD to `it.fails` z odnośnikiem do follow-upu, nigdy `it.skip`.
 */
import { waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { raiseAbort, readSituation, resetDb, seedUser, withTrigger } from '../../test/db';
import { mockOpenAI, whisperResponse } from '../../test/openai-mock';
import { getSituations, postSituation } from '../../test/request';

type SituationDTO = {
  id: number;
  status: 'pending' | 'done' | 'failed';
  transcript: string | null;
  duration_ms: number | null;
  flashcards_status: 'pending' | 'done' | 'failed';
  created_at: string;
};

async function listSituations(token: string): Promise<SituationDTO[]> {
  const res = await getSituations(env, token);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { situations: SituationDTO[] };
  return body.situations;
}

/** Wiersz `pending` zasiany bezpośrednio, z `created_at` przesuniętym o `ageSeconds` wstecz. */
async function seedPending(userId: number, ageSeconds: number): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO situations (user_id, status, audio_key, created_at) VALUES (?, 'pending', ?, datetime('now', ?)) RETURNING id",
  )
    .bind(userId, `situations/${userId}/seeded.m4a`, `-${ageSeconds} seconds`)
    .first<{ id: number }>();
  if (!row) throw new Error('seedPending: INSERT nie zwrócił wiersza.');
  return row.id;
}

afterEach(() => resetDb(env));

describe('Ryzyko #1: nagranie nie przepada', () => {
  // Deliberate-break: usuń `UPDATE ... status = 'failed'` z `catch` w
  // `transcribeAndFinalize` → wiersz zostaje `pending` → czerwony.
  it('T1.1 Whisper odpowiada non-2xx → wiersz `failed`, lista pokazuje `failed`, chat nie wywołany', async () => {
    const { token } = await seedUser(env);
    const fetchSpy = mockOpenAI({ transcription: whisperResponse('rate limited', 429) });

    const { res, ctx } = await postSituation(env, token);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };

    // Nieudana transkrypcja NIE może zostawić odrzuconej obietnicy w `waitUntil`.
    await expect(waitOnExecutionContext(ctx)).resolves.toBeUndefined();

    const row = await readSituation(env, id);
    expect(row?.status).toBe('failed');
    expect(row?.transcript).toBeNull();

    const listed = (await listSituations(token)).find((s) => s.id === id);
    expect(listed?.status).toBe('failed');

    // Tylko Whisper; generowanie fiszek nie ruszyło.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Czerwony przed poprawką S-01 F2 (Hono domyślne 500 text/plain, plik zostaje w R2).
  // Deliberate-break po poprawce: usuń sprzątanie R2 z `catch` w POST → bucket
  // niepusty → czerwony.
  it('T1.2 zapis wiersza pada po udanym uploadzie → JSON 500 z `error`, bez wiersza i bez osieroconego audio', async () => {
    const { id: userId, token } = await seedUser(env);
    await withTrigger(
      env,
      'test_abort_situations_insert',
      `BEFORE INSERT ON situations ${raiseAbort('wstrzyknięty błąd D1')}`,
    );
    const fetchSpy = mockOpenAI();

    const { res, ctx } = await postSituation(env, token);

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error?: unknown };
    expect(typeof body.error).toBe('string');
    expect((body.error as string).length).toBeGreaterThan(0);

    // Nic nie zaplanowano w tle — nie ma czego czekać ani co odrzucać.
    await expect(waitOnExecutionContext(ctx)).resolves.toBeUndefined();

    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM situations WHERE user_id = ?')
      .bind(userId)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);

    const { objects } = await env.AUDIO_BUCKET.list();
    expect(objects).toHaveLength(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Reguła z PRD: „`pending` starszy niż próg jest z listy widoczny jako `failed`" —
  // serwer dziś oddaje `status` surowo, maskuje to wyłącznie klient (`ORPHAN_MS`).
  // `it.fails` = czerwony z definicji do realizacji follow-upu
  // `context/changes/testing-worker-harness-background-jobs/follow-ups/stale-pending-server-rule.md`
  // (próg 2 minuty). Gdy follow-up wejdzie, ten test zacznie przechodzić, `it.fails`
  // zgłosi błąd i wymusi zmianę na zwykłe `it`.
  // Okno północy UTC: przez ~2,5 min po północy wiersz sprzed 150 s wypada z listy dnia
  // (ryzyko #6, Faza 2 wdrożenia).
  it.fails('T1.3 stary `pending` (150 s) jest z listy widoczny jako `failed`', async () => {
    const { id: userId, token } = await seedUser(env);
    const id = await seedPending(userId, 150);

    const listed = (await listSituations(token)).find((s) => s.id === id);
    expect(listed).toBeDefined();
    expect(listed?.status).toBe('failed');
  });

  // Chroni przed nadgorliwą przyszłą poprawką progu: świeży `pending` zostaje `pending`.
  it('T1.4 świeży `pending` (30 s) zostaje `pending` na liście', async () => {
    const { id: userId, token } = await seedUser(env);
    const id = await seedPending(userId, 30);

    const listed = (await listSituations(token)).find((s) => s.id === id);
    expect(listed).toBeDefined();
    expect(listed?.status).toBe('pending');
  });
});

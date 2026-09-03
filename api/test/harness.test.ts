/**
 * Spike harnessu — testy WŁAŚCIWOŚCI harnessu, nie ryzyk. Potwierdzają w tym repo
 * trzy założenia, na których stoją testy ryzyk #1 i #2:
 *   1. cały łańcuch POST → zadanie tła → D1/R2 biegnie w workerd na schemacie z migracji,
 *      z OpenAI zamockowanym na krawędzi sieci;
 *   2. trigger `RAISE(ABORT)` przerywa zapis D1 w miniflare (wstrzykiwanie błędów D1
 *      bez mockowania bindingu);
 *   3. `waitOnExecutionContext` obejmuje `c.executionCtx.waitUntil` z Hono i odrzucona
 *      obietnica tła obala test (nic w `waitUntil` nie ginie po cichu).
 *
 * Deliberate-break guarda `fetch`: usuń `mockOpenAI` z testu 1 → test pada z
 * `Unmocked fetch: https://api.openai.com/v1/audio/transcriptions` (nie z 401 OpenAI).
 */
import { waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { raiseAbort, readFlashcards, readSituation, resetDb, seedUser, withTrigger } from './db';
import { chatResponse, mockOpenAI, whisperResponse } from './openai-mock';
import { postSituation } from './request';

const TRANSCRIPT = 'Dziś byłem w banku i pytałem o fakturę.';
const CARDS = [
  { type: 'word', front_en: 'invoice', back_pl: 'faktura', example_en: 'Send me the invoice.', is_variant: false },
  { type: 'phrase', front_en: 'how much is it', back_pl: 'ile to kosztuje', example_en: 'How much is it?', is_variant: true },
];

afterEach(() => resetDb(env));

describe('Harness workerd: właściwości', () => {
  it('szczęśliwa ścieżka: POST → 201 → zadanie tła → done, karty, pusty bucket', async () => {
    const { token } = await seedUser(env);
    const fetchSpy = mockOpenAI({
      transcription: whisperResponse(TRANSCRIPT),
      chat: chatResponse(CARDS),
    });

    const { res, ctx } = await postSituation(env, token, { durationMs: 4200 });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('audio_key');
    expect(body).not.toHaveProperty('user_id');
    expect(body.status).toBe('pending');
    expect(body.flashcards_status).toBe('pending');
    expect(body.transcript).toBeNull();
    expect(body.duration_ms).toBe(4200);
    const situationId = body.id as number;

    await waitOnExecutionContext(ctx);

    const row = await readSituation(env, situationId);
    expect(row?.status).toBe('done');
    expect(row?.transcript).toBe(TRANSCRIPT);
    expect(row?.flashcards_status).toBe('done');

    const cards = await readFlashcards(env, situationId);
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.status)).toEqual(['proposed', 'proposed']);
    expect(cards.map((card) => card.is_variant)).toEqual([0, 1]);
    expect(cards.map((card) => card.front_en)).toEqual(['invoice', 'how much is it']);

    const { objects } = await env.AUDIO_BUCKET.list();
    expect(objects).toHaveLength(0);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Sekret z `vitest.config.mts` nadpisał `.dev.vars`: do OpenAI nigdy nie idzie
    // prawdziwy klucz, nawet gdyby guard sieci zawiódł.
    for (const [, init] of fetchSpy.mock.calls) {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-never-real');
    }
  });

  it('trigger RAISE(ABORT) przerywa INSERT w D1; po DROP ten sam INSERT przechodzi', async () => {
    const { id: userId } = await seedUser(env);
    const situation = await env.DB.prepare(
      "INSERT INTO situations (user_id, status) VALUES (?, 'pending') RETURNING id",
    )
      .bind(userId)
      .first<{ id: number }>();
    expect(situation).not.toBeNull();
    const situationId = situation!.id;

    await withTrigger(
      env,
      'test_abort_flashcards_insert',
      `BEFORE INSERT ON flashcards ${raiseAbort('wstrzyknięty błąd D1')}`,
    );

    const insertCard = () =>
      env.DB.prepare(
        'INSERT INTO flashcards (situation_id, user_id, type, front_en, back_pl, example_en, is_variant) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(situationId, userId, 'word', 'invoice', 'faktura', '', 0)
        .run();

    await expect(insertCard()).rejects.toThrow(/wstrzyknięty błąd D1/);
    expect(await readFlashcards(env, situationId)).toHaveLength(0);

    await env.DB.prepare('DROP TRIGGER IF EXISTS test_abort_flashcards_insert').run();

    const result = await insertCard();
    expect(result.meta.changes).toBe(1);
    expect(await readFlashcards(env, situationId)).toHaveLength(1);
  });

  it('odrzucona obietnica w waitUntil obala waitOnExecutionContext; wiersz zostaje pending', async () => {
    const { token } = await seedUser(env);
    // Whisper pada → `catch` próbuje `UPDATE status='failed'` → trigger przerywa UPDATE
    // → `transcribeAndFinalize` rzuca → obietnica w `waitUntil` odrzucona.
    await withTrigger(
      env,
      'test_abort_status_failed',
      `BEFORE UPDATE OF status ON situations WHEN NEW.status = 'failed' ${raiseAbort('wstrzyknięty błąd D1')}`,
    );
    mockOpenAI({ transcription: whisperResponse('upstream error', 500) });

    const { res, ctx } = await postSituation(env, token);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };

    await expect(waitOnExecutionContext(ctx)).rejects.toThrow(/wstrzyknięty błąd D1/);

    const row = await readSituation(env, id);
    expect(row?.status).toBe('pending');
    expect(row?.transcript).toBeNull();
  });
});

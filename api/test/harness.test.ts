/**
 * Spike harnessu — testy WŁAŚCIWOŚCI harnessu, nie ryzyk. Potwierdzają w tym repo
 * założenia, na których stoją testy ryzyk #1, #2 (Faza 1) oraz #3, #6 (Faza 2):
 *   1. cały łańcuch POST → zadanie tła → D1/R2 biegnie w workerd na schemacie z migracji,
 *      z OpenAI zamockowanym na krawędzi sieci; DTO `201` to dokładnie klucze z `dto.ts`;
 *   2. trigger `RAISE(ABORT)` przerywa zapis D1 w miniflare (wstrzykiwanie błędów D1
 *      bez mockowania bindingu);
 *   3. `waitOnExecutionContext` obejmuje `c.executionCtx.waitUntil` z Hono i odrzucona
 *      obietnica tła obala test (nic w `waitUntil` nie ginie po cichu). Aplikacja pod
 *      testem z założenia NIE zostawia odrzuconej obietnicy (ryzyko #2, T2.3 w
 *      `src/routes/situations.integration.test.ts`), więc tę właściwość dowodzi
 *      minimalna trasa Hono z tym samym wzorcem `waitUntil`, co `POST /situations`;
 *   4. zasiew z jawnym `created_at` (`seedSituation`/`seedFlashcard`) zapisuje 1:1 w
 *      formacie DEFAULT kolumny, a bez `createdAt` kolumna dostaje DEFAULT — bez tego
 *      `it.fails` w ryzyku #6 byłby ślepy na zepsuty zasiew;
 *   5. `withWriteTripwire` naprawdę zamienia zapis do tabel danych w błąd i `resetDb`
 *      go zdejmuje — bez tego macierz 401 (ryzyko #3) nie dowodziłaby „D1 nietknięte".
 *
 * Deliberate-break guarda `fetch`: usuń `mockOpenAI` z testu 1 → test pada z
 * `Unmocked fetch: https://api.openai.com/v1/audio/transcriptions` (nie z 401 OpenAI).
 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/types';
import {
  raiseAbort,
  readFlashcard,
  readFlashcards,
  readSituation,
  resetDb,
  seedFlashcard,
  seedSituation,
  seedUser,
  withTrigger,
  withWriteTripwire,
} from './db';
import { keysOf, SITUATION_DTO_KEYS } from './dto';
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
    // Dokładny zbiór kluczy z kontraktu frontu — nie lista „czego nie ma".
    expect(keysOf(body)).toEqual(SITUATION_DTO_KEYS);
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
    const situationId = await seedSituation(env, userId);

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

  it('odrzucona obietnica w waitUntil (przez Hono) obala waitOnExecutionContext', async () => {
    // Trasa-sonda: ten sam wzorzec `c.executionCtx.waitUntil(...)` co `POST /situations`,
    // ale z obietnicą tła sterowaną z testu — odrzucamy ją dopiero PO wywołaniu
    // `waitOnExecutionContext` (plugin podpina `allSettled` synchronicznie), żeby test
    // nie zależał od kolejności mikrotasków ani nie wywołał „unhandled rejection".
    let failBackground!: (err: Error) => void;
    const probe = new Hono<AppEnv>().get('/probe', (c) => {
      c.executionCtx.waitUntil(
        new Promise<void>((_, reject) => {
          failBackground = reject;
        }),
      );
      return c.text('ok');
    });
    const ctx = createExecutionContext();

    const res = await probe.fetch(new Request('http://test.local/probe'), env, ctx);
    expect(res.status).toBe(200);
    expect(failBackground).toBeTypeOf('function');

    const waiting = waitOnExecutionContext(ctx);
    failBackground(new Error('wstrzyknięte odrzucenie w tle'));

    await expect(waiting).rejects.toThrow(/wstrzyknięte odrzucenie w tle/);
  });

  it('zasiew z jawnym czasem zapisuje 1:1 (format DEFAULT, UTC); bez `createdAt` kolumna dostaje DEFAULT', async () => {
    const { id: userId } = await seedUser(env);

    const datedId = await seedSituation(env, userId, { createdAt: new Date('2026-03-27T23:59:30Z') });
    expect((await readSituation(env, datedId))?.created_at).toBe('2026-03-27 23:59:30');

    const variantId = await seedFlashcard(env, { situationId: datedId, userId, isVariant: true });
    expect((await readFlashcard(env, variantId))?.is_variant).toBe(1);

    const defaultId = await seedSituation(env, userId);
    expect((await readSituation(env, defaultId))?.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('tripwire jest uzbrojony: DELETE na `flashcards` pada z `tripwire`, wiersz zostaje; po `resetDb` ten sam DELETE przechodzi', async () => {
    const { id: userId } = await seedUser(env);
    const situationId = await seedSituation(env, userId);
    const cardId = await seedFlashcard(env, { situationId, userId });

    // Tripwire PO zasiewie — zasiew też jest zapisem.
    await withWriteTripwire(env);

    const deleteCard = (id: number) => env.DB.prepare('DELETE FROM flashcards WHERE id = ?').bind(id).run();
    await expect(deleteCard(cardId)).rejects.toThrow(/tripwire/);
    expect(await readFlashcard(env, cardId)).not.toBeNull();

    await resetDb(env);

    // Po sprzątaniu triggera nie ma: ta sama instrukcja przechodzi (tabela pusta →
    // 0 zmian), a świeżo zasiana karta daje się skasować naprawdę.
    await expect(deleteCard(cardId)).resolves.toBeDefined();
    const fresh = await seedUser(env);
    const freshSituationId = await seedSituation(env, fresh.id);
    const freshCardId = await seedFlashcard(env, { situationId: freshSituationId, userId: fresh.id });
    expect((await deleteCard(freshCardId)).meta.changes).toBe(1);
    expect(await readFlashcard(env, freshCardId)).toBeNull();
  });
});

/**
 * Testy integracyjne trasy `/flashcards` w workerd — dowód ryzyka #3 (cudze dane / IDOR)
 * z `context/foundation/test-plan.md` §2 na poziomie WŁASNOŚCI i KSZTAŁTU DTO: propozycje
 * i licznik generowań widzą wyłącznie dane użytkownika z tokenu; `accept`/`DELETE` po
 * własności (cudzy id → 404 bez wyroczni istnienia — ten sam status i ciało co dla
 * nieistniejącego); DTO jako DOKŁADNY zbiór kluczy z kontraktu frontu (`test/dto.ts`),
 * nawet gdy kolumna (`is_variant`) istnieje w D1 i jest ustawiona. Bramę 401 na tych
 * trasach dowodzi macierz w `src/middleware/auth.integration.test.ts`.
 *
 * Każdy test ma DWÓCH użytkowników (`alice`, `bob`), ramię „cudze" (404 / brak na liście /
 * nietknięty wiersz ofiary) ORAZ ramię kontrolne „własne" (200/204 / wiersz zmieniony) —
 * bez ramienia kontrolnego trasa zwracająca 404 na wszystko byłaby zielona. Każdy test
 * koduje OBSERWOWALNY skutek (odpowiedź HTTP, wiersz w D1), nie odbicie implementacji,
 * i ma nazwany deliberate-break w komentarzu.
 *
 * Zasady harnessu (patrz `test/setup.ts`, `test/db.ts`, `test/request.ts`):
 * - Zasiew i odczyt wyłącznie helperami z `test/db.ts`; kształt żądania w `test/request.ts`.
 * - D1 nigdy nie jest mockowane od środka; żadnych asercji na tekście SQL ani bindingach.
 * - Izolacja jest per PLIK, więc `afterEach(resetDb)` sprząta tabele, triggery i bucket.
 * - DTO zawsze jako dokładny zbiór kluczy (`keysOf`), nigdy `not.toHaveProperty`.
 */
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { readFlashcard, resetDb, seedFlashcard, seedSituation, seedUser } from '../../test/db';
import { FLASHCARD_DTO_KEYS, keysOf } from '../../test/dto';
import { acceptFlashcard, deleteFlashcard, getProposals } from '../../test/request';

const TRANSCRIPT = 'Dziś byłem w banku i pytałem o fakturę.';

type ProposalsBody = { proposals: { id: number }[]; generatingCount: number };

async function readProposals(token: string): Promise<ProposalsBody> {
  const res = await getProposals(env, token);
  expect(res.status).toBe(200);
  return (await res.json()) as ProposalsBody;
}

/** 404 w konwencji `{ error }` (JSON) — identyczne dla cudzego i nieistniejącego id. */
async function expectNotFound(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type')).toContain('application/json');
  const body = (await res.json()) as { error?: unknown };
  expect(typeof body.error).toBe('string');
  expect((body.error as string).length).toBeGreaterThan(0);
}

/** Alice i Bob, każde z sytuacją `done` (fiszki wygenerowane) i jedną propozycją. */
async function seedAliceAndBobWithProposals() {
  const alice = await seedUser(env, 'alice');
  const bob = await seedUser(env, 'bob');
  const aliceSituationId = await seedSituation(env, alice.id, {
    status: 'done',
    flashcardsStatus: 'done',
    transcript: TRANSCRIPT,
  });
  const bobSituationId = await seedSituation(env, bob.id, {
    status: 'done',
    flashcardsStatus: 'done',
    transcript: TRANSCRIPT,
  });
  const aliceCardId = await seedFlashcard(env, { situationId: aliceSituationId, userId: alice.id });
  const bobCardId = await seedFlashcard(env, { situationId: bobSituationId, userId: bob.id });
  return { alice, bob, aliceCardId, bobCardId };
}

afterEach(() => resetDb(env));

describe('Ryzyko #3: cudze dane (IDOR)', () => {
  // Deliberate-breaks (każdy osobno → czerwony; kod przywrócony, suite zielone):
  //   (a) dopisz `is_variant` do `SELECT` propozycji w `GET /proposals` (`flashcards.ts`)
  //       → klucze karty ≠ `FLASHCARD_DTO_KEYS` (trasa nie ma warstwy mapowania — każda
  //       kolumna dopisana do `SELECT` wycieka);
  //   (b) usuń `user_id = ? AND` (i `.bind(userId)`) z zapytania `generatingCount`
  //       → licznik 2 (generująca sytuacja Boba policzona Alice).
  it('T3.6 GET /flashcards/proposals → tylko własne propozycje o kluczach DTO (bez `is_variant` mimo 1 w D1), licznik tylko własnych generowań', async () => {
    const alice = await seedUser(env, 'alice');
    const bob = await seedUser(env, 'bob');

    // Alice: sytuacja z gotowymi fiszkami — jedna propozycja (WARIANT) i jedna już przyjęta.
    const aliceDoneId = await seedSituation(env, alice.id, {
      status: 'done',
      flashcardsStatus: 'done',
      transcript: TRANSCRIPT,
    });
    const aliceProposedId = await seedFlashcard(env, {
      situationId: aliceDoneId,
      userId: alice.id,
      isVariant: true,
    });
    await seedFlashcard(env, { situationId: aliceDoneId, userId: alice.id, status: 'accepted' });
    // Alice: druga sytuacja wciąż generująca (DEFAULT `created_at` = dziś UTC) — liczy się.
    await seedSituation(env, alice.id, { status: 'done', flashcardsStatus: 'pending', transcript: TRANSCRIPT });
    // Bob: sytuacja generująca z propozycją — nic z tego nie może trafić do Alice.
    const bobGeneratingId = await seedSituation(env, bob.id, {
      status: 'done',
      flashcardsStatus: 'pending',
      transcript: TRANSCRIPT,
    });
    await seedFlashcard(env, { situationId: bobGeneratingId, userId: bob.id });

    // Flaga naprawdę siedzi w D1 — brak klucza w DTO to decyzja trasy, nie pusty zasiew.
    expect((await readFlashcard(env, aliceProposedId))?.is_variant).toBe(1);

    const body = await readProposals(alice.token);

    expect(keysOf(body)).toEqual(['generatingCount', 'proposals']);
    expect(body.proposals.map((card) => card.id)).toEqual([aliceProposedId]);
    for (const card of body.proposals) {
      expect(keysOf(card)).toEqual(FLASHCARD_DTO_KEYS);
    }
    expect(body.generatingCount).toBe(1);
  });

  // Deliberate-break: usuń `AND user_id = ?` (i drugi argument `.bind`) z `UPDATE` w
  // `POST /:id/accept` (`flashcards.ts`) → cudza akceptacja 200, fiszka Boba `accepted`.
  it('T3.7 POST /flashcards/:id/accept cudzy id → 404 i fiszka ofiary nadal `proposed`; własny → 200 z pustym ciałem i fiszka znika z propozycji; ponowna akceptacja własnej → 404', async () => {
    const { alice, aliceCardId, bobCardId } = await seedAliceAndBobWithProposals();

    // Ramię „cudze": ten sam kontrakt co dla nieistniejącego id — bez wyroczni istnienia.
    await expectNotFound(await acceptFlashcard(env, alice.token, bobCardId));
    expect((await readFlashcard(env, bobCardId))?.status).toBe('proposed');

    // Ramię kontrolne „własne".
    const accepted = await acceptFlashcard(env, alice.token, aliceCardId);
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toBe('');
    expect((await readFlashcard(env, aliceCardId))?.status).toBe('accepted');
    expect((await readProposals(alice.token)).proposals.map((card) => card.id)).toEqual([]);

    // Ponowna akceptacja własnej: 404 tym samym kontraktem; status się nie cofa.
    await expectNotFound(await acceptFlashcard(env, alice.token, aliceCardId));
    expect((await readFlashcard(env, aliceCardId))?.status).toBe('accepted');
  });

  // Deliberate-break: usuń `AND user_id = ?` (i drugi argument `.bind`) z `DELETE` w
  // `DELETE /:id` (`flashcards.ts`) → cudze kasowanie 204, fiszka Boba znika.
  it('T3.8 DELETE /flashcards/:id cudzy id → 404 i fiszka ofiary zostaje; własny → 204 i wiersz znika', async () => {
    const { alice, aliceCardId, bobCardId } = await seedAliceAndBobWithProposals();
    const bobCardBefore = await readFlashcard(env, bobCardId);
    expect(bobCardBefore).not.toBeNull();

    // Ramię „cudze": 404 i wiersz ofiary równy migawce sprzed wywołania.
    await expectNotFound(await deleteFlashcard(env, alice.token, bobCardId));
    expect(await readFlashcard(env, bobCardId)).toEqual(bobCardBefore);

    // Ramię kontrolne „własne".
    const deleted = await deleteFlashcard(env, alice.token, aliceCardId);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe('');
    expect(await readFlashcard(env, aliceCardId)).toBeNull();
    // Własne kasowanie Alice nie zahacza o Boba.
    expect(await readFlashcard(env, bobCardId)).toEqual(bobCardBefore);
  });
});

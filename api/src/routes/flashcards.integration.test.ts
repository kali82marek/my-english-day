/**
 * Testy integracyjne trasy `/flashcards` w workerd — dowód ryzyka #3 (cudze dane / IDOR)
 * z `context/foundation/test-plan.md` §2 na poziomie WŁASNOŚCI i KSZTAŁTU DTO: propozycje
 * i licznik generowań widzą wyłącznie dane użytkownika z tokenu; `accept`/`DELETE` po
 * własności (cudzy id → 404 bez wyroczni istnienia — ten sam status i ciało co dla
 * nieistniejącego); DTO jako DOKŁADNY zbiór kluczy z kontraktu frontu (`test/dto.ts`),
 * nawet gdy kolumna (`is_variant`) istnieje w D1 i jest ustawiona. Bramę 401 na tych
 * trasach dowodzi macierz w `src/middleware/auth.integration.test.ts`. Sesję powtórek
 * (S-05: `GET /review`, `POST /:id/grade`) dowodzi osobny `describe` na końcu pliku.
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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFlashcard, resetDb, seedFlashcard, seedSituation, seedUser, toSqlDatetime } from '../../test/db';
import { FLASHCARD_DTO_KEYS, keysOf } from '../../test/dto';
import {
  acceptFlashcard,
  deleteFlashcard,
  getProposals,
  getReview,
  gradeFlashcard,
  gradeFlashcardRaw,
} from '../../test/request';

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

/**
 * S-05 (FR-011, FR-012): sesja powtórek. Dowód w kategoriach użytkownika — widzę do
 * powtórki tylko SWOJE ZAAKCEPTOWANE fiszki, których pora nadeszła (`due_at IS NULL` =
 * świeżo zaakceptowana, od razu); ocena zmienia tylko moją fiszkę; „porą" steruje zegar
 * JS (`vi.setSystemTime`), bo trasa binduje chwilę z JS, nie `datetime('now')` w SQL.
 * Wyrocznie odstępów (1 dzień po „Umiem", `again` = od razu) z planu S-05
 * (`context/changes/srs-review-session/plan.md`, Faza 1) i `src/lib/srs.test.ts` —
 * NIE z implementacji trasy. `vi.setSystemTime` przecieka między testami w pliku, stąd
 * własne `afterEach(() => vi.useRealTimers())` (jak w ryzyku #6).
 */
describe('S-05 / FR-011, FR-012: sesja powtórek', () => {
  afterEach(() => vi.useRealTimers());

  const DAY_MS = 86_400_000;

  type ReviewBody = { cards: { id: number }[]; dueCount: number; acceptedCount: number };

  async function readReview(token: string): Promise<ReviewBody> {
    const res = await getReview(env, token);
    expect(res.status).toBe(200);
    return (await res.json()) as ReviewBody;
  }

  /** Alice i Bob, każde z sytuacją `done` — fiszki zasiewane per test. */
  async function seedAliceAndBobSituations() {
    const alice = await seedUser(env, 'alice');
    const bob = await seedUser(env, 'bob');
    const aliceSituationId = await seedSituation(env, alice.id, { status: 'done', flashcardsStatus: 'done', transcript: TRANSCRIPT });
    const bobSituationId = await seedSituation(env, bob.id, { status: 'done', flashcardsStatus: 'done', transcript: TRANSCRIPT });
    return { alice, bob, aliceSituationId, bobSituationId };
  }

  // Deliberate-breaks (każdy osobno → czerwony; kod przywrócony, suite zielone):
  //   (a) usuń `status = 'accepted'` z zapytania listy w `GET /review` (`flashcards.ts`)
  //       → propozycja Alice na liście;
  //   (b) usuń `user_id = ? AND` (i bind) → karta Boba na liście;
  //   (c) usuń `due_at <= ?` (zostaw samo `IS NULL`) → karta „po terminie" znika;
  //   (d) dopisz kolumnę SRS do `SELECT` → klucze karty ≠ `FLASHCARD_DTO_KEYS`.
  it('R2.1 GET /flashcards/review → tylko własne zaakceptowane, których pora nadeszła (NULL = od razu), w kolejności należności, o kluczach DTO; liczniki bez limitu', async () => {
    const { alice, bob, aliceSituationId, bobSituationId } = await seedAliceAndBobSituations();

    // Alice: nowa (bez `due_at`, powstała 10:00) — należna od chwili powstania.
    const freshId = await seedFlashcard(env, {
      situationId: aliceSituationId,
      userId: alice.id,
      status: 'accepted',
      frontEn: 'invoice',
      createdAt: '2026-09-01 10:00:00',
    });
    // Alice: po terminie (`due_at` 5 września) — powstała wcześniej (09:00), ale należna
    // później niż nowa → `COALESCE(due_at, created_at)` stawia ją DRUGĄ.
    const overdueId = await seedFlashcard(env, {
      situationId: aliceSituationId,
      userId: alice.id,
      status: 'accepted',
      frontEn: 'receipt',
      createdAt: '2026-09-01 09:00:00',
      dueAt: '2026-09-05 08:00:00',
      intervalDays: 1,
      repetitions: 1,
    });
    // Alice: należna jutro — w bazie nauki, ale nie do powtórki teraz.
    await seedFlashcard(env, {
      situationId: aliceSituationId,
      userId: alice.id,
      status: 'accepted',
      frontEn: 'bank statement',
      dueAt: new Date(Date.now() + DAY_MS),
      intervalDays: 3,
      repetitions: 2,
    });
    // Alice: propozycja — nie należy do bazy nauki.
    await seedFlashcard(env, { situationId: aliceSituationId, userId: alice.id, frontEn: 'ask for a refund' });
    // Bob: nowa zaakceptowana — należna, ale cudza.
    await seedFlashcard(env, { situationId: bobSituationId, userId: bob.id, status: 'accepted', frontEn: 'invoice' });

    const body = await readReview(alice.token);

    expect(keysOf(body)).toEqual(['acceptedCount', 'cards', 'dueCount']);
    expect(body.cards.map((card) => card.id)).toEqual([freshId, overdueId]);
    for (const card of body.cards) {
      expect(keysOf(card)).toEqual(FLASHCARD_DTO_KEYS);
    }
    expect(body.dueCount).toBe(2);
    expect(body.acceptedCount).toBe(3);

    // Ramię kontrolne Boba: własna nowa zaakceptowana jest u niego, Alice nie przecieka.
    const bobBody = await readReview(bob.token);
    expect(bobBody.cards).toHaveLength(1);
    expect(bobBody.acceptedCount).toBe(1);
  });

  // Deliberate-break: w `GET /review` (`flashcards.ts`) zamień bind chwili z JS na
  // `datetime('now')` w SQL → wiersz „minutę przed" zależy od realnego zegara (dziś: po
  // 2026-09-10 fiszka jest na liście mimo `07:59Z`) → czerwony. Osobno: `due_at < ?`
  // zamiast `<=` → wiersz „dokładnie o czasie" czerwony.
  it('R2.2 pora liczona z zegara JS, granica inkluzywna: minutę przed `due_at` fiszki nie ma, dokładnie o `due_at` jest', async () => {
    const { alice, aliceSituationId } = await seedAliceAndBobSituations();
    const id = await seedFlashcard(env, {
      situationId: aliceSituationId,
      userId: alice.id,
      status: 'accepted',
      dueAt: '2026-09-10 08:00:00',
      intervalDays: 1,
      repetitions: 1,
    });

    vi.setSystemTime(new Date('2026-09-10T07:59:00Z'));
    const before = await readReview(alice.token);
    expect(before.cards).toEqual([]);
    expect(before.dueCount).toBe(0);
    expect(before.acceptedCount).toBe(1);

    vi.setSystemTime(new Date('2026-09-10T08:00:00Z'));
    const atDue = await readReview(alice.token);
    expect(atDue.cards.map((card) => card.id)).toEqual([id]);
    expect(atDue.dueCount).toBe(1);
  });

  // Deliberate-breaks (każdy osobno → czerwony):
  //   (a) usuń `AND user_id = ?` (i bind) z `SELECT` stanu w `POST /:id/grade` → cudza
  //       ocena 200, wiersz Boba zmieniony;
  //   (b) usuń `AND status = 'accepted'` → ocena własnej propozycji 200;
  //   (c) usuń `isGrade` → `grade: 'easy'` przechodzi do `scheduleReview` (500 albo zapis).
  it('R2.3 POST /flashcards/:id/grade: cudza, własna `proposed` i nieistniejąca → 404 bez zmian; zła ocena, brak oceny i nie-JSON → 400 bez zmian', async () => {
    const { alice, bob, aliceSituationId, bobSituationId } = await seedAliceAndBobSituations();
    const bobCardId = await seedFlashcard(env, { situationId: bobSituationId, userId: bob.id, status: 'accepted' });
    const aliceProposedId = await seedFlashcard(env, { situationId: aliceSituationId, userId: alice.id, frontEn: 'receipt' });
    const aliceAcceptedId = await seedFlashcard(env, { situationId: aliceSituationId, userId: alice.id, status: 'accepted' });
    const bobBefore = await readFlashcard(env, bobCardId);
    const aliceProposedBefore = await readFlashcard(env, aliceProposedId);
    const aliceAcceptedBefore = await readFlashcard(env, aliceAcceptedId);
    expect(bobBefore).not.toBeNull();
    expect(aliceAcceptedBefore?.due_at).toBeNull();

    // Ramię „cudze": ten sam kontrakt co dla nieistniejącego id — bez wyroczni istnienia.
    await expectNotFound(await gradeFlashcard(env, alice.token, bobCardId, { grade: 'good' }));
    expect(await readFlashcard(env, bobCardId)).toEqual(bobBefore);

    // Własna, ale wciąż propozycja — nie w bazie nauki.
    await expectNotFound(await gradeFlashcard(env, alice.token, aliceProposedId, { grade: 'good' }));
    expect(await readFlashcard(env, aliceProposedId)).toEqual(aliceProposedBefore);

    await expectNotFound(await gradeFlashcard(env, alice.token, 999_999, { grade: 'good' }));

    // Błędy klienta na WŁASNEJ zaakceptowanej — wiersz nietknięty (400 zanim trasa dotknie D1).
    for (const res of [
      await gradeFlashcard(env, alice.token, aliceAcceptedId, { grade: 'easy' }),
      await gradeFlashcard(env, alice.token, aliceAcceptedId, {}),
      await gradeFlashcardRaw(env, alice.token, aliceAcceptedId, 'nie umiem'),
    ]) {
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as { error?: unknown };
      expect(typeof body.error).toBe('string');
    }
    expect(await readFlashcard(env, aliceAcceptedId)).toEqual(aliceAcceptedBefore);
  });

  // Deliberate-breaks (każdy osobno → czerwony):
  //   (a) w `POST /:id/grade` zapisz `due_at` z `again` jako jutro (np. `+ DAY_MS`) →
  //       po „Nie umiem" karta nie wraca na listę;
  //   (b) pomiń `reviewed_at` w `UPDATE` → `reviewed_at` zostaje `NULL`;
  //   (c) użyj realnego `Date.now()` zamiast `new Date()` sterowanego zegarem — asercje
  //       na dokładnej chwili czerwone.
  it('R2.4 własna nowa: „Umiem" → 200, należna za 1 dzień i znika z listy; potem „Nie umiem" → należna od razu i wraca na listę', async () => {
    const { alice, aliceSituationId } = await seedAliceAndBobSituations();
    const id = await seedFlashcard(env, { situationId: aliceSituationId, userId: alice.id, status: 'accepted' });
    const T = new Date('2026-09-10T08:00:00Z');
    vi.setSystemTime(T);
    expect((await readReview(alice.token)).cards.map((card) => card.id)).toEqual([id]);

    const good = await gradeFlashcard(env, alice.token, id, { grade: 'good' });
    expect(good.status).toBe(200);
    expect(await good.text()).toBe('');

    const afterGood = await readFlashcard(env, id);
    expect(afterGood?.due_at).toBe(toSqlDatetime(new Date(T.getTime() + DAY_MS)));
    expect(afterGood?.interval_days).toBe(1);
    expect(afterGood?.repetitions).toBe(1);
    expect(afterGood?.reviewed_at).toBe(toSqlDatetime(T));
    expect(afterGood?.status).toBe('accepted');

    // Do jutra nie ma jej w sesji — ale nadal jest w bazie nauki.
    const listAfterGood = await readReview(alice.token);
    expect(listAfterGood.cards).toEqual([]);
    expect(listAfterGood.dueCount).toBe(0);
    expect(listAfterGood.acceptedCount).toBe(1);

    const again = await gradeFlashcard(env, alice.token, id, { grade: 'again' });
    expect(again.status).toBe(200);

    const afterAgain = await readFlashcard(env, id);
    expect(afterAgain?.due_at).toBe(toSqlDatetime(T));
    expect(afterAgain?.repetitions).toBe(0);
    expect(afterAgain?.interval_days).toBe(0);
    expect(afterAgain?.reviewed_at).toBe(toSqlDatetime(T));

    // „Nie umiem" wraca w tej samej sesji.
    const listAfterAgain = await readReview(alice.token);
    expect(listAfterAgain.cards.map((card) => card.id)).toEqual([id]);
    expect(listAfterAgain.dueCount).toBe(1);
  });

  // Porcja sesji to 20 kart (plan S-05), ale liczniki mają być BEZ limitu — front na
  // `dueCount > cards.length` opiera podpowiedź „pobierz kolejną porcję". R2.1 tego nie
  // dowodzi (2 karty nigdy nie trafiają w limit).
  // Deliberate-breaks (każdy osobno → czerwony; kod przywrócony, suite zielone):
  //   (a) `dueCount: results.length` zamiast osobnego zliczenia → `dueCount` 20;
  //   (b) usuń `LIMIT ?` (i bind) z zapytania listy → 21 kart.
  it('R2.5 21 należnych fiszek → lista ma 20 kart o kluczach DTO, a `dueCount` i `acceptedCount` liczą wszystkie 21', async () => {
    const { alice, aliceSituationId } = await seedAliceAndBobSituations();
    for (let i = 1; i <= 21; i++) {
      await seedFlashcard(env, {
        situationId: aliceSituationId,
        userId: alice.id,
        status: 'accepted',
        frontEn: `card ${i}`,
        backPl: `karta ${i}`,
      });
    }

    const body = await readReview(alice.token);

    expect(body.cards).toHaveLength(20);
    for (const card of body.cards) {
      expect(keysOf(card)).toEqual(FLASHCARD_DTO_KEYS);
    }
    expect(body.dueCount).toBe(21);
    expect(body.acceptedCount).toBe(21);
  });
});

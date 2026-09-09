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
import { afterEach, describe, expect, it, vi } from 'vitest';
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
} from '../../test/db';
import { keysOf, SITUATION_DTO_KEYS, type SituationDTO } from '../../test/dto';
import { chatResponse, chatResponseRaw, mockOpenAI, whisperResponse } from '../../test/openai-mock';
import { deleteSituation, getProposals, getSituations, postSituation } from '../../test/request';

async function listSituations(token: string): Promise<SituationDTO[]> {
  const res = await getSituations(env, token);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { situations: SituationDTO[] };
  return body.situations;
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
  // (ryzyko #6; wyrocznia dnia lokalnego i opcje poprawki w follow-upie
  // `context/changes/testing-route-contracts-ownership-day/follow-ups/local-day-boundary.md`).
  it.fails('T1.3 stary `pending` (150 s) jest z listy widoczny jako `failed`', async () => {
    const { id: userId, token } = await seedUser(env);
    const id = await seedSituation(env, userId, { createdAt: new Date(Date.now() - 150 * 1000) });

    const listed = (await listSituations(token)).find((s) => s.id === id);
    expect(listed).toBeDefined();
    expect(listed?.status).toBe('failed');
  });

  // Chroni przed nadgorliwą przyszłą poprawką progu: świeży `pending` zostaje `pending`.
  it('T1.4 świeży `pending` (30 s) zostaje `pending` na liście', async () => {
    const { id: userId, token } = await seedUser(env);
    const id = await seedSituation(env, userId, { createdAt: new Date(Date.now() - 30 * 1000) });

    const listed = (await listSituations(token)).find((s) => s.id === id);
    expect(listed).toBeDefined();
    expect(listed?.status).toBe('pending');
  });
});

const TRANSCRIPT = 'Dziś byłem w banku i pytałem o fakturę.';

type ProposalsBody = { proposals: { id: number; type: string; front_en: string }[]; generatingCount: number };

/** `n` poprawnych kart w kształcie odpowiedzi modelu (co druga to wariant). */
function makeCards(n: number) {
  const types = ['word', 'phrase', 'sentence'] as const;
  return Array.from({ length: n }, (_, i) => ({
    type: types[i % types.length],
    front_en: `card ${i + 1}`,
    back_pl: `karta ${i + 1}`,
    example_en: `Example ${i + 1}.`,
    is_variant: i % 2 === 1,
  }));
}

/** POST z udaną transkrypcją i zadaną odpowiedzią chatu; czeka na zadanie tła. */
async function postAndFinish(token: string, chat: Response): Promise<number> {
  mockOpenAI({ transcription: whisperResponse(TRANSCRIPT), chat });
  const { res, ctx } = await postSituation(env, token);
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: number };
  // Po `done` zadanie tła NIGDY nie może zostawić odrzuconej obietnicy w `waitUntil`.
  await expect(waitOnExecutionContext(ctx)).resolves.toBeUndefined();
  return id;
}

async function readProposals(token: string): Promise<ProposalsBody> {
  const res = await getProposals(env, token);
  expect(res.status).toBe(200);
  return (await res.json()) as ProposalsBody;
}

describe('Ryzyko #2: fiszki wszystko-albo-nic', () => {
  // Deliberate-break: zamień kolejność w `transcribeAndFinalize` (generowanie PRZED
  // `UPDATE ... status = 'done'`) → transkrypt `null` → czerwony.
  it('T2.1 model odpowiada non-2xx → `done` z transkryptem, `flashcards_status=failed`, zero kart, pusty bucket', async () => {
    const { token } = await seedUser(env);

    const id = await postAndFinish(token, chatResponse(null, 500));

    const row = await readSituation(env, id);
    expect(row?.status).toBe('done');
    expect(row?.transcript).toBe(TRANSCRIPT);
    expect(row?.flashcards_status).toBe('failed');
    expect(await readFlashcards(env, id)).toHaveLength(0);

    const proposals = await readProposals(token);
    expect(proposals.proposals).toEqual([]);
    expect(proposals.generatingCount).toBe(0);

    const { objects } = await env.AUDIO_BUCKET.list();
    expect(objects).toHaveLength(0);
  });

  // Czerwony przed poprawką (pętla `.run()` po karcie: 2 karty + `failed`).
  // Deliberate-break po poprawce: wróć z `DB.batch` do pętli `.run()` → 2 karty → czerwony.
  it('T2.2 błąd D1 przy trzeciej karcie → ZERO kart i `failed`; transkrypt i `done` zachowane', async () => {
    const { token } = await seedUser(env);
    // Trigger liczy wiersze całego pliku testowego — `resetDb` w `afterEach` gwarantuje
    // pustą tabelę `flashcards` na starcie, więc „= 2" to dokładnie trzecia karta.
    await withTrigger(
      env,
      'test_abort_third_flashcard',
      `BEFORE INSERT ON flashcards WHEN (SELECT COUNT(*) FROM flashcards) = 2 ${raiseAbort('wstrzyknięty błąd D1')}`,
    );

    const id = await postAndFinish(token, chatResponse(makeCards(3)));

    expect(await readFlashcards(env, id)).toHaveLength(0);
    const row = await readSituation(env, id);
    expect(row?.flashcards_status).toBe('failed');
    expect(row?.status).toBe('done');
    expect(row?.transcript).toBe(TRANSCRIPT);
  });

  // Czerwony przed poprawką (zewnętrzny `catch` nadpisuje `status='failed'`).
  // Deliberate-break po poprawce: usuń wewnętrzny `try/catch` wokół
  // `UPDATE flashcards_status = 'failed'` → odrzucenie albo `status='failed'` → czerwony.
  it('T2.3 zapis stanu `failed` sam pada → `done` z transkryptem zostaje, `flashcards_status` zostaje `pending`, brak odrzucenia', async () => {
    const { token } = await seedUser(env);
    await withTrigger(
      env,
      'test_abort_flashcards_failed',
      `BEFORE UPDATE OF flashcards_status ON situations WHEN NEW.flashcards_status = 'failed' ${raiseAbort('wstrzyknięty błąd D1')}`,
    );

    const id = await postAndFinish(token, chatResponse(null, 500));

    const row = await readSituation(env, id);
    expect(row?.status).toBe('done');
    expect(row?.transcript).toBe(TRANSCRIPT);
    // Nic lepszego nie da się zrobić — ale `done` i transkrypt NIE mogą zostać nadpisane.
    expect(row?.flashcards_status).toBe('pending');
    expect(await readFlashcards(env, id)).toHaveLength(0);

    // Awaria po `done` nie blokuje sprzątania audio (jak w T2.1).
    const { objects } = await env.AUDIO_BUCKET.list();
    expect(objects).toHaveLength(0);
  });

  // Niezmiennik generatora: pusta lista Z MODELU = awaria (`failed`), nigdy `done`.
  // Zielony dlatego, że generator rzuca na pustą listę (T5.4). Od S-04 `done` bez kart
  // JEST legalne, ale wyłącznie gdy to dedup odsiał wszystkie kandydatki (D2.4 niżej) —
  // pusta odpowiedź modelu nadal nie może udawać „wszystko już masz". Deliberate-break:
  // tymczasowo usuń rzut na pustą listę w `src/lib/flashcards.ts` → `done` z 0 kart →
  // czerwony (przywróć).
  it('T2.4 model zwraca pustą listę → zero kart i `failed`, nigdy `done` bez kart', async () => {
    const { token } = await seedUser(env);

    const id = await postAndFinish(token, chatResponse([]));

    expect(await readFlashcards(env, id)).toHaveLength(0);
    const row = await readSituation(env, id);
    expect(row?.flashcards_status).toBe('failed');
    expect(row?.status).toBe('done');
  });

  // Górna granica batcha: 10 kart (`MAX_CARDS`) + UPDATE = 11 zapytań w jednym `batch`,
  // poniżej limitu 50 zapytań na wywołanie z `infrastructure.md`.
  it('T2.5 sukces po pełnej ścieżce → 10 kart `proposed`, `flashcards_status=done`, `generatingCount: 0`', async () => {
    const { token } = await seedUser(env);

    const id = await postAndFinish(token, chatResponse(makeCards(10)));

    const cards = await readFlashcards(env, id);
    expect(cards).toHaveLength(10);
    expect(cards.every((card) => card.status === 'proposed')).toBe(true);
    expect(cards.map((card) => card.front_en)).toEqual(makeCards(10).map((card) => card.front_en));

    const row = await readSituation(env, id);
    expect(row?.status).toBe('done');
    expect(row?.flashcards_status).toBe('done');

    const proposals = await readProposals(token);
    expect(proposals.proposals).toHaveLength(10);
    expect(proposals.generatingCount).toBe(0);
  });
});

/**
 * Ryzyko #5 — ta warstwa dowodzi „nie przecieka do bazy ani do propozycji" NIEZALEŻNIE od
 * miejsca poprawki (dziś walidator w parserze `src/lib/flashcards.ts`; w przyszłości
 * ewentualny `CHECK` w D1 — `follow-ups/enum-check-migration.md`). T5.11 bez T5.12 byłby
 * zielony dla walidatora odrzucającego WSZYSTKO — T5.12 jest ramieniem kontrolnym z
 * wartościami zapisanych kolumn (`type`, `is_variant`), których żaden T2.x nie asertuje
 * (T2.5 patrzy tylko na `front_en` i `status`). Kontrakt żądania i klasy odrzucenia parsera
 * dowodzi `src/lib/flashcards.test.ts` (T5.1–T5.10).
 */
describe('Ryzyko #5: kontrakt generatora', () => {
  const REFUSAL = 'I cannot generate flashcards for this input.';

  // Wyrocznia z PRD (Business Logic `prd.md:99`): trzy zamknięte typy fiszek — stała
  // lokalna, celowo NIE importowana z implementacji (`CARD_TYPES` w `lib/flashcards.ts`).
  const CARD_TYPES = ['word', 'phrase', 'sentence'];

  /** Trzy poprawne karty z wadliwym `type` w ŚRODKU (nie pierwsza, nie ostatnia). */
  function cardsWithIdiomInMiddle() {
    const [first, second, third] = makeCards(3);
    return [first, { ...second, type: 'idiom' }, third];
  }

  // Wadliwa karta w środku poprawnych — dowód, że odrzucana jest CAŁA odpowiedź (nigdy
  // „2 karty + failed", spójnie z ryzykiem #2), a nie sama wadliwa karta.
  // Deliberate-break: usuń sprawdzenie `type` z `assertGeneratedCard`
  // (`src/lib/flashcards.ts`) → wiersz „typ spoza kontraktu": 3 wiersze (jeden z `'idiom'`)
  // i `done` → czerwony. Wiersz „odmowa" NIE ma własnego deliberate-break na tej warstwie:
  // bez czytania `refusal` odpowiedź i tak pada na `content: null` → `failed`. Dowód, że
  // odmowa jest CZYTANA (tekst odmowy w błędzie), żyje w T5.9 w `src/lib/flashcards.test.ts`.
  it.each([
    { label: 'kartę o typie spoza kontraktu', chat: () => chatResponse(cardsWithIdiomInMiddle()) },
    { label: 'odmowę (refusal, content null)', chat: () => chatResponseRaw({ content: null, refusal: REFUSAL }) },
  ])(
    'T5.11 model zwraca $label → `flashcards_status=failed`, zero kart, propozycje puste; `done` z transkryptem zachowane, brak odrzucenia w tle',
    async ({ chat }) => {
      const { token } = await seedUser(env);

      const id = await postAndFinish(token, chat());

      expect(await readFlashcards(env, id)).toHaveLength(0);
      const row = await readSituation(env, id);
      expect(row?.flashcards_status).toBe('failed');
      expect(row?.status).toBe('done');
      expect(row?.transcript).toBe(TRANSCRIPT);

      const proposals = await readProposals(token);
      expect(proposals.proposals).toEqual([]);
      expect(proposals.generatingCount).toBe(0);
    },
  );

  // Jawny fixture (nie `makeCards`) — wartości mają być czytelne w asercji. Karta `sentence`
  // z pustym `example_en` jest LEGALNA (prompt dopuszcza pusty dla zdania; T5.3) i musi
  // zostać zapisana jako `''`, nie `NULL`. Wariant jako ostatnia karta — 6 < 10, więc nic
  // nie jest ucinane. `front_en` unikalne, bo DTO propozycji mapujemy po `front_en`.
  const EMPTY_EXAMPLE_FRONT = 'Could I get an invoice, please?';
  const MIXED_CARDS = [
    { type: 'word', front_en: 'invoice', back_pl: 'faktura', example_en: 'I need an invoice.', is_variant: false },
    { type: 'phrase', front_en: 'ask for a refund', back_pl: 'poprosić o zwrot', example_en: 'I asked for a refund.', is_variant: true },
    { type: 'sentence', front_en: EMPTY_EXAMPLE_FRONT, back_pl: 'Czy mogę prosić o fakturę?', example_en: '', is_variant: false },
    { type: 'word', front_en: 'receipt', back_pl: 'paragon', example_en: 'Keep the receipt.', is_variant: true },
    { type: 'sentence', front_en: 'Is there a fee for this transfer?', back_pl: 'Czy jest opłata za ten przelew?', example_en: 'Is there a fee for this transfer?', is_variant: true },
    { type: 'phrase', front_en: 'bank statement', back_pl: 'wyciąg bankowy', example_en: 'Print my bank statement.', is_variant: false },
  ];

  // Deliberate-breaks (każdy osobno → czerwony; kod przywrócony, suite zielone):
  //   (a) w `generateAndStoreFlashcards` (`situations.ts`) binduj `'word'` zamiast
  //       `card.type` → projekcja `type` ≠ fixture;
  //   (b) binduj `0` zamiast `card.is_variant ? 1 : 0` → projekcja `is_variant` ≠ fixture.
  it('T5.12 mieszanka typów i wariantów → każda karta zapisana z własnym `type` i `is_variant` w kolejności tablicy; DTO propozycji niesie `type` z trójki', async () => {
    const { token } = await seedUser(env);

    const id = await postAndFinish(token, chatResponse(MIXED_CARDS));

    // `readFlashcards` sortuje po `id`, a `DB.batch` wstawia w kolejności tablicy —
    // projekcja bez `id`/`created_at` porównywana 1:1 z fixture'em (`is_variant` = INTEGER).
    const cards = await readFlashcards(env, id);
    expect(cards.map(({ front_en, type, is_variant }) => ({ front_en, type, is_variant }))).toEqual(
      MIXED_CARDS.map((card) => ({ front_en: card.front_en, type: card.type, is_variant: card.is_variant ? 1 : 0 })),
    );
    expect(cards.find((card) => card.front_en === EMPTY_EXAMPLE_FRONT)?.example_en).toBe('');
    expect((await readSituation(env, id))?.flashcards_status).toBe('done');

    const { proposals } = await readProposals(token);
    expect(proposals).toHaveLength(6);
    for (const proposal of proposals) {
      expect(CARD_TYPES).toContain(proposal.type);
    }
    const typeByFront = Object.fromEntries(proposals.map((p) => [p.front_en, p.type]));
    expect(typeByFront).toEqual(Object.fromEntries(MIXED_CARDS.map((card) => [card.front_en, card.type])));
  });
});

/**
 * Własność i kształt DTO per trasa (bramę 401 dowodzi macierz w
 * `src/middleware/auth.integration.test.ts`). Każdy test: dwóch użytkowników, ramię
 * „cudze" (404 / brak na liście / nietknięty wiersz ofiary) ORAZ ramię kontrolne „własne"
 * (2xx / wiersz zmieniony) — bez ramienia kontrolnego trasa zwracająca 404 na wszystko
 * byłaby zielona. DTO zawsze jako dokładny zbiór kluczy z `test/dto.ts`.
 */
describe('Ryzyko #3: cudze dane (IDOR)', () => {
  // Deliberate-breaks (każdy osobno → czerwony; kod przywrócony, suite zielone):
  //   (a) usuń `.map(toDTO)` z `GET /` (`situations.ts`) → klucze wiersza ≠
  //       `SITUATION_DTO_KEYS` (`user_id`, `audio_key` w odpowiedzi);
  //   (b) usuń `user_id = ? AND` (i `.bind(userId)`) z zapytania listy → wiersz Boba na liście.
  it('T3.4 GET /situations → lista Alice zawiera wyłącznie sytuacje Alice, każda o kluczach DTO', async () => {
    const alice = await seedUser(env, 'alice');
    const bob = await seedUser(env, 'bob');
    // Obie sytuacje z DEFAULT `created_at` (dziś UTC) kwalifikują się do listy dnia —
    // jedyne, co je rozróżnia, to właściciel.
    const aliceSituationId = await seedSituation(env, alice.id, { status: 'done', transcript: TRANSCRIPT });
    await seedSituation(env, bob.id, { status: 'done', transcript: TRANSCRIPT });

    const situations = await listSituations(alice.token);

    expect(situations.map((s) => s.id)).toEqual([aliceSituationId]);
    for (const row of situations) {
      expect(keysOf(row)).toEqual(SITUATION_DTO_KEYS);
    }
  });

  // Deliberate-break: usuń `AND user_id = ?` (i drugi argument `.bind`) ze wstępnego
  // `SELECT` w `DELETE /:id` (`situations.ts`) → cudzy id daje 204 zamiast 404.
  it('T3.5 DELETE /situations/:id cudzy id → 404, wiersz i fiszki ofiary zostają; własny → 204 i wiersz znika', async () => {
    const alice = await seedUser(env, 'alice');
    const bob = await seedUser(env, 'bob');
    const bobSituationId = await seedSituation(env, bob.id, { status: 'done', transcript: TRANSCRIPT });
    await seedFlashcard(env, { situationId: bobSituationId, userId: bob.id });
    const aliceSituationId = await seedSituation(env, alice.id, { status: 'done', transcript: TRANSCRIPT });
    const bobBefore = await readSituation(env, bobSituationId);
    expect(bobBefore).not.toBeNull();

    // Ramię „cudze": 404 w konwencji `{ error }`; ofiara i jej fiszki nietknięte.
    const foreign = await deleteSituation(env, alice.token, bobSituationId);
    expect(foreign.status).toBe(404);
    expect(foreign.headers.get('content-type')).toContain('application/json');
    const body = (await foreign.json()) as { error?: unknown };
    expect(typeof body.error).toBe('string');
    expect((body.error as string).length).toBeGreaterThan(0);
    expect(await readSituation(env, bobSituationId)).toEqual(bobBefore);
    expect(await readFlashcards(env, bobSituationId)).toHaveLength(1);

    // Ramię kontrolne „własne".
    const own = await deleteSituation(env, alice.token, aliceSituationId);
    expect(own.status).toBe(204);
    expect(await own.text()).toBe('');
    expect(await readSituation(env, aliceSituationId)).toBeNull();
    // Własne kasowanie Alice nie zahacza o Boba.
    expect(await readSituation(env, bobSituationId)).toEqual(bobBefore);
    expect(await readFlashcards(env, bobSituationId)).toHaveLength(1);
  });
});

/**
 * Tabela wyroczni ryzyka #6 — jawne pary „czas lokalny Warszawy ↔ chwila UTC" po obu
 * stronach obu przejść DST. Każdy wiersz: `createdAt` to chwila nagrania (UTC, format
 * DEFAULT kolumny — zasiew po stronie SQL), `now` to chwila odczytu listy i licznika
 * (ISO `Z` — `vi.setSystemTime` po stronie JS). Chwile policzone przez ICU dla
 * `Europe/Warsaw`; przejścia: 2026-03-29 01:00Z (CET→CEST), 2025-10-26 01:00Z (CEST→CET).
 * Jesień 2026 (2026-10-25) pominięta CELOWO: to przyszłość względem realnego zegara,
 * a zasiana data, którą realny `date('now')` dopiero osiągnie, przekręciłaby `it.fails`
 * w konkretny dzień roku. Wszystkie daty tabeli muszą pozostać w przeszłości.
 *
 * Kierunek A: nagranie tuż po lokalnej północy, odczyt 60 s później — między nimi
 * północ UTC (ten sam dzień lokalny, inny dzień UTC). Wiek 60 s jest celowo poniżej
 * progu reguły wieku `pending` (2 min, follow-up Fazy 1), żeby po jej wejściu wiersz
 * nadal liczył się jako generujący.
 * Kierunek B: nagranie 23:30 lokalnie, odczyt 00:30 następnego dnia lokalnego — ten sam
 * dzień UTC. Nagranie należy do wczoraj (lokalnie), więc nie jest „dziś".
 */
type DayCase = {
  /** Lokalny „dziś" (data odczytu w Europe/Warsaw) i strona przejścia DST. */
  label: string;
  /** A = inkluzja (ten sam dzień lokalny), B = ekskluzja (po lokalnej północy). */
  direction: 'A' | 'B';
  /** Chwila nagrania: `created_at` w UTC (`YYYY-MM-DD HH:MM:SS`). */
  createdAt: string;
  /** Chwila odczytu: ISO `Z` dla `vi.setSystemTime`. */
  now: string;
};

const DAY_CASES: readonly DayCase[] = [
  // A: 00:59:30 CET 03-28 → 01:00:30 CET 03-28 (UTC+1; dzień przed przejściem 03-29)
  { label: '2026-03-28 CET (dzień przed 03-29)', direction: 'A', createdAt: '2026-03-27 23:59:30', now: '2026-03-28T00:00:30Z' },
  // A: 01:59:30 CEST 03-30 → 02:00:30 CEST 03-30 (UTC+2; dzień po przejściu 03-29)
  { label: '2026-03-30 CEST (dzień po 03-29)', direction: 'A', createdAt: '2026-03-29 23:59:30', now: '2026-03-30T00:00:30Z' },
  // A: 01:59:30 CEST 10-25 → 02:00:30 CEST 10-25 (UTC+2; dzień przed przejściem 10-26)
  { label: '2025-10-25 CEST (dzień przed 10-26)', direction: 'A', createdAt: '2025-10-24 23:59:30', now: '2025-10-25T00:00:30Z' },
  // A: 00:59:30 CET 10-27 → 01:00:30 CET 10-27 (UTC+1; dzień po przejściu 10-26)
  { label: '2025-10-27 CET (dzień po 10-26)', direction: 'A', createdAt: '2025-10-26 23:59:30', now: '2025-10-27T00:00:30Z' },
  // B: 23:30 CET 03-27 → 00:30 CET 03-28 (UTC+1; dzień przed przejściem 03-29)
  { label: '2026-03-28 CET (dzień przed 03-29)', direction: 'B', createdAt: '2026-03-27 22:30:00', now: '2026-03-27T23:30:00Z' },
  // B: 23:30 CEST 03-29 → 00:30 CEST 03-30 (UTC+2; dzień po przejściu 03-29)
  { label: '2026-03-30 CEST (dzień po 03-29)', direction: 'B', createdAt: '2026-03-29 21:30:00', now: '2026-03-29T22:30:00Z' },
  // B: 23:30 CEST 10-24 → 00:30 CEST 10-25 (UTC+2; dzień przed przejściem 10-26)
  { label: '2025-10-25 CEST (dzień przed 10-26)', direction: 'B', createdAt: '2025-10-24 21:30:00', now: '2025-10-24T22:30:00Z' },
  // B: 23:30 CET 10-26 → 00:30 CET 10-27 (UTC+1; dzień po przejściu 10-26)
  { label: '2025-10-27 CET (dzień po 10-26)', direction: 'B', createdAt: '2025-10-26 22:30:00', now: '2025-10-26T23:30:00Z' },
];

/**
 * Wyrocznia z PRD (US-01 „wieczorem widzi fiszki z sytuacji dnia", FR-006, FR-009;
 * `test-plan.md` §2 ryzyko #6): sytuacja należy do dnia UŻYTKOWNIKA (Europe/Warsaw), nie
 * do dnia UTC — w liście dnia `GET /situations` i w liczniku `generatingCount` z
 * `GET /flashcards/proposals`, niezależnie od DST. Test koduje to zachowanie, NIE wybraną
 * poprawkę (decyzje S-01 F1 i S-02 F4 są `PENDING`; obie opcje bez wyboru w
 * `context/changes/testing-route-contracts-ownership-day/follow-ups/local-day-boundary.md`).
 *
 * Dlaczego dwa modyfikatory: dziś dzień liczy SQL `date('now')` (realny UTC, poza zasięgiem
 * `vi.setSystemTime`), więc wiersz z tabeli nigdy nie jest „dziś". Asercje INKLUZJI
 * (kierunek A) padają → `it.fails` (czerwone z definicji do poprawki). Asercje EKSKLUZJI
 * (kierunek B) przechodzą trywialnie — nie przez regułę, tylko przez odległą datę — więc
 * `it.fails` zgłosiłby na nich błąd; są zwykłym `it` ze strażnikiem filtru dnia.
 *
 * Przenośność: asercje wyłącznie na UTC lub jawnym `timeZone` — izolat na Windows ma
 * strefę hosta (Warszawa), w CI UTC; nigdy `getHours()`/`toLocale*` bez strefy.
 * `vi.setSystemTime` przecieka między testami w pliku, a `vi.restoreAllMocks()`
 * z `test/setup.ts` go nie cofa — stąd własne `afterEach(() => vi.useRealTimers())`.
 */
describe('Ryzyko #6: dzień liczony w UTC', () => {
  afterEach(() => vi.useRealTimers());

  const inclusion = DAY_CASES.filter((c) => c.direction === 'A');
  const exclusion = DAY_CASES.filter((c) => c.direction === 'B');

  /**
   * Zasiew wiersza, który jest JEDNOCZEŚNIE „na liście dnia" i „generujący"
   * (`done` + `flashcards_status: 'pending'` + transkrypt) — jeden wiersz dowodzi obu
   * powierzchni. Zasiew (SQL) idzie PRZED `vi.setSystemTime` — dziś bez znaczenia, ale po
   * Fix A helper żądania będzie liczył granice dnia z `Date.now()`.
   */
  async function seedGenerating(createdAt: string): Promise<{ token: string; id: number }> {
    const { id: userId, token } = await seedUser(env);
    const id = await seedSituation(env, userId, {
      status: 'done',
      flashcardsStatus: 'pending',
      transcript: TRANSCRIPT,
      createdAt,
    });
    return { token, id };
  }

  // Dziś CZERWONY Z DEFINICJI (SQL `date('now')` = realny dzień). Po Fix A/B zacznie
  // przechodzić, `it.fails` zgłosi „expected test to fail" i wymusi zmianę na `it` — bez
  // przepisywania asercji (Fix A: `request.ts` dołoży granice dnia z `Date.now()`;
  // Fix B: nic poza `setSystemTime`). Jeśli któryś wiersz PRZECHODZI dziś bez poprawki,
  // zepsuty jest zasiew lub odczyt (zob. test właściwości „zasiew z jawnym czasem
  // zapisuje 1:1" w `test/harness.test.ts`) — nie zmieniaj modyfikatora.
  it.fails.each(inclusion)(
    'T6.1 $label: nagranie po lokalnej północy, przed północą UTC, jest na liście „dziś" i liczy się jako generujące',
    async ({ createdAt, now }) => {
      const { token, id } = await seedGenerating(createdAt);
      // Zegar JS ustawiany tuż przed wywołaniem trasy (przygotowanie pod obie poprawki).
      vi.setSystemTime(new Date(now));

      const listed = await listSituations(token);
      expect(listed.map((s) => s.id)).toContain(id);
      expect((await readProposals(token)).generatingCount).toBe(1);
    },
  );

  // Dziś zielony trywialnie (data zasiewu nie jest realnym „dziś"), pełny sygnał po
  // poprawce (łapie np. stały offset +1 latem). Deliberate-break: usuń
  // `AND date(created_at) = date('now')` z listy dnia (`GET /` w `situations.ts`) ORAZ
  // z licznika `generatingCount` (`GET /proposals` w `flashcards.ts`) → 4 wiersze czerwone.
  it.each(exclusion)(
    'T6.2 $label: nagranie 23:30 czasu Warszawy po lokalnej północy nie jest na liście „dziś" i nie liczy się',
    async ({ createdAt, now }) => {
      const { token, id } = await seedGenerating(createdAt);
      vi.setSystemTime(new Date(now));

      const listed = await listSituations(token);
      expect(listed.map((s) => s.id)).not.toContain(id);
      expect((await readProposals(token)).generatingCount).toBe(0);
    },
  );
});

/**
 * S-04 / FR-008 — dowód w kategoriach użytkownika: nowe propozycje nie dublują fiszek,
 * które już ma (propozycje ORAZ zaakceptowane), cudza baza nie jest zbiorem odniesienia,
 * a odpowiedź złożona wyłącznie z duplikatów kończy się `done` bez nowych kart (nie
 * `failed` — kontrast z T2.4, gdzie pusta lista Z MODELU jest awarią). Definicję
 * „to samo słowo/zwrot" (normalizacja) dowodzi `src/lib/dedup.test.ts` (D1.x); tu
 * asertujemy skutek w D1 i w `GET /flashcards/proposals`, nie kształt filtra.
 *
 * Deliberate-break wspólny: w `generateAndStoreFlashcards` (`situations.ts`) zapisz
 * `cards` zamiast `unique` (pomiń `filterDuplicates`) → D2.1, D2.3, D2.4 czerwone.
 */
describe('S-04 / FR-008: nowe propozycje nie dublują bazy użytkownika', () => {
  /** Karta w kształcie odpowiedzi modelu — jawny fixture, żeby wartości były czytelne. */
  function card(
    front_en: string,
    overrides: Partial<{ type: 'word' | 'phrase' | 'sentence'; is_variant: boolean }> = {},
  ) {
    return {
      type: overrides.type ?? 'word',
      front_en,
      back_pl: `pl: ${front_en}`,
      example_en: `Example: ${front_en}.`,
      is_variant: overrides.is_variant ?? false,
    };
  }

  /** Sytuacja `done` z wygenerowanymi fiszkami — rodzic dla zasianych kart. */
  function seedDoneSituation(userId: number): Promise<number> {
    return seedSituation(env, userId, { status: 'done', flashcardsStatus: 'done', transcript: TRANSCRIPT });
  }

  // Wyrocznia FR-008 (`prd.md`): duplikat = to samo słowo/zwrot; różnice wielkości liter
  // i kropki na końcu to wciąż ta sama fiszka. Zbiór odniesienia obejmuje ZARÓWNO
  // zaakceptowane (`invoice`), JAK I wciąż proponowane (`receipt`) — propozycja czekająca
  // na decyzję nie może pojawić się w kolejce drugi raz.
  // Deliberate-breaks: (a) dodaj `AND status = 'accepted'` do odczytu zbioru odniesienia
  // → druga `receipt` zapisana → czerwony; (b) porównuj `front_en` surowo (bez
  // `normalizeFront`) → `Invoice` i `receipt.` zapisane → czerwony.
  it('D2.1 fronty już w bazie (zaakceptowany i proponowany) → zapisany tylko nowy front; propozycje bez dubla; `done`', async () => {
    const alice = await seedUser(env, 'alice');
    const earlierId = await seedDoneSituation(alice.id);
    await seedFlashcard(env, { situationId: earlierId, userId: alice.id, frontEn: 'invoice', status: 'accepted' });
    const receiptProposalId = await seedFlashcard(env, { situationId: earlierId, userId: alice.id, frontEn: 'receipt' });

    const id = await postAndFinish(
      alice.token,
      chatResponse([card('Invoice'), card('receipt.', { is_variant: true }), card('bank statement', { type: 'phrase' })]),
    );

    const stored = await readFlashcards(env, id);
    expect(stored.map((c) => c.front_en)).toEqual(['bank statement']);
    expect(stored[0]?.type).toBe('phrase');
    expect((await readSituation(env, id))?.flashcards_status).toBe('done');

    const { proposals, generatingCount } = await readProposals(alice.token);
    expect(proposals.map((p) => p.front_en).sort()).toEqual(['bank statement', 'receipt']);
    expect(proposals.map((p) => p.id)).toContain(receiptProposalId);
    expect(generatingCount).toBe(0);
  });

  // Access Control PRD: każdy użytkownik ma zamkniętą bazę — identyczny front u Boba nie
  // jest duplikatem dla Alice. Ramię „cudze" (Bob nietknięty) + kontrolne (karta Alice
  // zapisana). Deliberate-break: usuń `WHERE user_id = ?` (i `.bind(userId)`) z odczytu
  // zbioru odniesienia → karta Alice odsiana → czerwony.
  it('D2.2 identyczny front w bazie INNEGO użytkownika → karta zapisana; cudza baza nietknięta', async () => {
    const alice = await seedUser(env, 'alice');
    const bob = await seedUser(env, 'bob');
    const bobSituationId = await seedDoneSituation(bob.id);
    const bobCardId = await seedFlashcard(env, { situationId: bobSituationId, userId: bob.id, frontEn: 'invoice', status: 'accepted' });
    const bobBefore = await readFlashcard(env, bobCardId);
    expect(bobBefore).not.toBeNull();

    const id = await postAndFinish(alice.token, chatResponse([card('invoice')]));

    const stored = await readFlashcards(env, id);
    expect(stored.map((c) => c.front_en)).toEqual(['invoice']);
    expect(stored[0]?.user_id).toBe(alice.id);
    expect((await readSituation(env, id))?.flashcards_status).toBe('done');

    expect(await readFlashcard(env, bobCardId)).toEqual(bobBefore);
    expect(await readFlashcards(env, bobSituationId)).toHaveLength(1);
    expect((await readProposals(bob.token)).proposals).toEqual([]);
  });

  // Model potrafi zwrócić tę samą frazę jako fiszkę bazową i wariant. Pierwsze wystąpienie
  // wygrywa (kolejność tablicy = kolejność zapisu), reszta partii w kolejności.
  // Deliberate-break: filtruj tylko względem bazy, nie wewnątrz partii (usuń `seen.add`
  // w pętli `filterDuplicates`) → 3 karty → czerwony.
  it('D2.3 powtórka wewnątrz jednej odpowiedzi (`invoice` / `INVOICE`) → zostaje pierwsza z jej `type`/`is_variant`; reszta w kolejności', async () => {
    const { token } = await seedUser(env);

    const id = await postAndFinish(
      token,
      chatResponse([
        card('invoice', { type: 'word', is_variant: false }),
        card('INVOICE', { type: 'phrase', is_variant: true }),
        card('receipt'),
      ]),
    );

    const stored = await readFlashcards(env, id);
    expect(stored.map(({ front_en, type, is_variant }) => ({ front_en, type, is_variant }))).toEqual([
      { front_en: 'invoice', type: 'word', is_variant: 0 },
      { front_en: 'receipt', type: 'word', is_variant: 0 },
    ]);
    expect((await readSituation(env, id))?.flashcards_status).toBe('done');
    expect((await readProposals(token)).proposals).toHaveLength(2);
  });

  // „Wszystko już masz" to sukces, nie awaria: `done` bez nowych kart, transkrypt i
  // sprzątanie R2 jak na ścieżce szczęśliwej, zero odrzucenia w tle (`postAndFinish`).
  // Kontrast z T2.4: tam pusta lista pochodzi Z MODELU i musi dać `failed`.
  // Deliberate-breaks: (a) rzuć, gdy `unique` puste → `failed` → czerwony;
  // (b) pomiń `UPDATE ... 'done'` przy pustej partii → `pending` → czerwony.
  it('D2.4 wszystkie karty z odpowiedzi już w bazie → zero nowych wierszy i `done` (nie `failed`); transkrypt zachowany, bucket pusty', async () => {
    const { id: userId, token } = await seedUser(env);
    const earlierId = await seedDoneSituation(userId);
    await seedFlashcard(env, { situationId: earlierId, userId, frontEn: 'invoice', status: 'accepted' });
    await seedFlashcard(env, { situationId: earlierId, userId, frontEn: 'ask for a refund', type: 'phrase' });

    const id = await postAndFinish(
      token,
      chatResponse([card('Invoice'), card(' ask for a refund ', { type: 'phrase', is_variant: true })]),
    );

    expect(await readFlashcards(env, id)).toHaveLength(0);
    const row = await readSituation(env, id);
    expect(row?.flashcards_status).toBe('done');
    expect(row?.status).toBe('done');
    expect(row?.transcript).toBe(TRANSCRIPT);

    const { proposals, generatingCount } = await readProposals(token);
    // Jedyna propozycja to ta sprzed nagrania — nic nie doszło, nic nie zniknęło.
    expect(proposals.map((p) => p.front_en)).toEqual(['ask for a refund']);
    expect(generatingCount).toBe(0);

    const { objects } = await env.AUDIO_BUCKET.list();
    expect(objects).toHaveLength(0);
  });
});

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
import { raiseAbort, readFlashcards, readSituation, resetDb, seedSituation, seedUser, withTrigger } from '../../test/db';
import type { SituationDTO } from '../../test/dto';
import { chatResponse, mockOpenAI, whisperResponse } from '../../test/openai-mock';
import { getProposals, getSituations, postSituation } from '../../test/request';

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

type ProposalsBody = { proposals: { id: number }[]; generatingCount: number };

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

  // Niezmiennik warstwy zapisu: nigdy `done` bez kart. Zielony dziś tylko dlatego, że
  // generator rzuca na pustą listę. Deliberate-break: tymczasowo usuń rzut na pustą
  // listę w `src/lib/flashcards.ts` → `done` z 0 kart → czerwony (przywróć; guard w
  // generatorze należy do Fazy 3 wdrożenia).
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

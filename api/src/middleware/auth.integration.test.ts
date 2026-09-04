/**
 * Macierz 401 — dowód ryzyka #3 (cudze dane / IDOR) z `context/foundation/test-plan.md` §2
 * na poziomie BRAMY: każda chroniona trasa bez ważnego tokenu odpowiada 401 JSON i nie
 * dotyka D1, R2 ani sieci. Dowodem jest skutek obserwowalny (odpowiedź, wiersze ofiary
 * przed/po, bucket, spy na `fetch`, tripwire `RAISE(ABORT)` na każdym zapisie do tabel
 * danych), nie lustro montażu `requireAuth`. Własność i kształt DTO per trasa dowodzą
 * testy `Ryzyko #3` w plikach tras (`src/routes/*.integration.test.ts`).
 *
 * REGUŁA: nowa trasa chroniona = nowy wiersz w `PROTECTED_ROUTES`. T3.3 porównuje macierz
 * z `app.routes` — trasa bez wiersza obala suite (S-04/S-05 dopisują swoje trasy tutaj).
 * Rejestruj trasy jawną metodą (`get`/`post`/…): wpisy `app.all()` mają `method: 'ALL'`
 * jak middleware i byłyby dla T3.3 niewidoczne.
 *
 * Dwa warianty na trasę i ani jednego więcej (§7 planu testów: kryptografię tokenu —
 * zły sekret, manipulacja, śmieci — pokrywa `src/lib/jwt.test.ts`): brak nagłówka
 * `Authorization` oraz token podpisany innym sekretem z TYM SAMYM `sub` ofiary — gdyby
 * brama nie stała, trasa „widziałaby" dane ofiary.
 *
 * Deliberate-breaks (każdy → czerwony; potem kod przywrócony, suite zielone):
 *   DB-A  `flashcardsRouter.use('*', requireAuth)` przeniesione PONIŻEJ `get('/proposals')`
 *         w `src/routes/flashcards.ts` → oba wiersze `GET /flashcards/proposals` (handler
 *         bez `userId` → 500 albo 200).
 *   DB-B  `situationsRouter.use('*', requireAuth)` przeniesione PONIŻEJ `post('/')` w
 *         `src/routes/situations.ts` → oba wiersze `POST /situations`: `R2.put` zostawia
 *         obiekt w buckecie, `INSERT` pada na tripwire → 500 zamiast 401.
 *   DB-C  `requireAuth` usunięte z `authRouter.get('/me', …)` w `src/routes/auth.ts` →
 *         oba wiersze `GET /auth/me` (500 zamiast 401).
 *   DB-D  tymczasowa trasa `app.get('/probe', …)` w `src/index.ts` → T3.3 czerwony
 *         (trasa spoza macierzy).
 */
import { waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import app from '../index';
import { signSession } from '../lib/jwt';
import {
  readFlashcard,
  readSituation,
  readSituationsOf,
  resetDb,
  seedFlashcard,
  seedSituation,
  seedUser,
  withWriteTripwire,
} from '../../test/db';
import { mockOpenAI } from '../../test/openai-mock';
import { audioForm, call } from '../../test/request';
import { requireAuth } from './auth';

/** Identyfikatory zasianych danych ofiary — do ścieżek z `:id`. */
type VictimIds = { situationId: number; flashcardId: number };

type ProtectedRoute = {
  /** `METHOD /ścieżka/:param` — dokładnie tak, jak Hono raportuje w `app.routes`. */
  name: string;
  method: string;
  path: (ids: VictimIds) => string;
  /** Realne ciało żądania (jak w szczęśliwej ścieżce), gdy trasa je czyta. */
  body?: () => BodyInit;
};

/** Trasy publiczne — jedyne, których T3.3 nie wymaga w macierzy. */
const PUBLIC_ROUTES: readonly string[] = ['GET /health', 'POST /auth/register', 'POST /auth/login'];

/** Macierz: KAŻDA chroniona trasa aplikacji (T3.3 pilnuje kompletności). */
const PROTECTED_ROUTES: readonly ProtectedRoute[] = [
  { name: 'GET /auth/me', method: 'GET', path: () => '/auth/me' },
  { name: 'POST /situations', method: 'POST', path: () => '/situations', body: () => audioForm() },
  { name: 'GET /situations', method: 'GET', path: () => '/situations' },
  { name: 'DELETE /situations/:id', method: 'DELETE', path: ({ situationId }) => `/situations/${situationId}` },
  { name: 'GET /flashcards/proposals', method: 'GET', path: () => '/flashcards/proposals' },
  { name: 'POST /flashcards/:id/accept', method: 'POST', path: ({ flashcardId }) => `/flashcards/${flashcardId}/accept` },
  { name: 'DELETE /flashcards/:id', method: 'DELETE', path: ({ flashcardId }) => `/flashcards/${flashcardId}` },
];

/**
 * Ofiara z realnymi danymi (sytuacja `done` z transkryptem + fiszka `proposed`),
 * migawki wierszy sprzed wywołania, tripwire uzbrojony PO zasiewie (zasiew też jest
 * zapisem) i guard sieci bez żadnej zamockowanej odpowiedzi.
 */
async function seedVictim() {
  const victim = await seedUser(env, 'victim');
  const situationId = await seedSituation(env, victim.id, {
    status: 'done',
    transcript: 'Dziś byłem w banku i pytałem o fakturę.',
  });
  const flashcardId = await seedFlashcard(env, { situationId, userId: victim.id });

  const situationBefore = await readSituation(env, situationId);
  const flashcardBefore = await readFlashcard(env, flashcardId);
  expect(situationBefore).not.toBeNull();
  expect(flashcardBefore).not.toBeNull();

  await withWriteTripwire(env);
  const fetchSpy = mockOpenAI();

  return { victim, ids: { situationId, flashcardId }, situationBefore, flashcardBefore, fetchSpy };
}

/**
 * Wywołuje trasę z podanym tokenem (`undefined` = bez nagłówka) i asertuje pełny skutek:
 * 401 JSON `{ error }`, brak zadania w tle, wiersze ofiary równe migawkom, bucket pusty,
 * `fetch` niewywołany. Tripwire jest niejawny — zapis dałby 500 zamiast 401.
 */
async function expectGateHolds(
  route: ProtectedRoute,
  tokenFor: (victimId: number) => Promise<string | undefined>,
): Promise<void> {
  const { victim, ids, situationBefore, flashcardBefore, fetchSpy } = await seedVictim();
  const token = await tokenFor(victim.id);

  const { res, ctx } = await call(env, {
    method: route.method,
    path: route.path(ids),
    token,
    body: route.body?.(),
  });

  expect(res.status).toBe(401);
  expect(res.headers.get('content-type')).toContain('application/json');
  const body = (await res.json()) as { error?: unknown };
  expect(typeof body.error).toBe('string');
  expect((body.error as string).length).toBeGreaterThan(0);

  // Nic nie zaplanowano w tle — nie ma czego czekać ani co odrzucać.
  await expect(waitOnExecutionContext(ctx)).resolves.toBeUndefined();

  expect(await readSituation(env, ids.situationId)).toEqual(situationBefore);
  expect(await readFlashcard(env, ids.flashcardId)).toEqual(flashcardBefore);
  expect(await readSituationsOf(env, victim.id)).toHaveLength(1);
  expect((await env.AUDIO_BUCKET.list()).objects).toHaveLength(0);
  expect(fetchSpy).not.toHaveBeenCalled();
}

afterEach(() => resetDb(env));

describe('Ryzyko #3: cudze dane (IDOR) — brama 401', () => {
  it.each(PROTECTED_ROUTES)(
    'T3.1 $name bez nagłówka `Authorization` → 401 JSON, D1/R2/sieć nietknięte',
    async (route) => {
      await expectGateHolds(route, async () => undefined);
    },
  );

  it.each(PROTECTED_ROUTES)(
    'T3.2 $name z tokenem podpisanym innym sekretem → 401 JSON, D1/R2/sieć nietknięte',
    async (route) => {
      // Ten sam `sub` co ofiara, inny sekret niż `JWT_SECRET` z `vitest.config.mts`.
      await expectGateHolds(route, (victimId) => signSession(victimId, 'not-the-secret'));
    },
  );

  it('T3.3 macierz obejmuje każdą niepubliczną trasę aplikacji', () => {
    // `app.routes` po `app.route()` niesie pełne ścieżki. Wpisy middleware to `use('*')`
    // (`method: 'ALL'`, np. CORS i `requireAuth` routerów) oraz `requireAuth` per handler
    // (`GET /auth/me` występuje dwa razy: brama + handler) — te odfiltrowujemy.
    const registered = app.routes
      .filter((route) => route.method !== 'ALL' && route.handler !== requireAuth)
      .map((route) => `${route.method} ${route.path}`)
      .filter((name) => !PUBLIC_ROUTES.includes(name));

    const expected = PROTECTED_ROUTES.map((route) => route.name);
    expect([...new Set(registered)].sort()).toEqual([...expected].sort());
  });
});

/**
 * Wywołanie aplikacji Hono w teście ścieżką bezpośrednią `app.fetch(req, env, ctx)`.
 *
 * KSZTAŁT ŻĄDANIA ŻYJE TYLKO TUTAJ: metoda, ścieżka, nagłówki (w tym `Authorization`),
 * ciało multipart. Asercje w testach nigdy nie budują `Request` same — wołają `call`
 * albo helper trasy. Gdy kontrakt żądania się zmieni (np. klient zacznie przekazywać
 * granice dnia lokalnego — follow-up ryzyka #6), zmiana trafia w jedno miejsce.
 *
 * `call` dokleja `Authorization: Bearer <token>` WYŁĄCZNIE gdy `token !== undefined`;
 * pominięcie `token` daje żądanie bez nagłówka (macierz 401 z ryzyka #3). Jawne
 * `headers` mają pierwszeństwo nad nagłówkiem wyprowadzonym z `token`.
 *
 * `ctx = createExecutionContext()`. Wołający decyduje, czy i jak czeka na zadanie
 * tła: `await waitOnExecutionContext(ctx)` (z `cloudflare:test`) czeka na wszystko,
 * co trafiło do `ctx.waitUntil`, i RZUCA, gdy któraś obietnica została odrzucona.
 * Asercje na stanie D1/R2 po odpowiedzi są poprawne dopiero po tym `await`.
 * Helpery zwracające samo `Response` (`getSituations`, `deleteSituation`, …) porzucają
 * `ctx` — te trasy nie planują zadania tła.
 *
 * NIE używać `exports.default.fetch` (dawne `SELF.fetch`) do asercji na zadaniu tła —
 * ta ścieżka biegnie w osobnym kontekście I/O i nie czeka na `waitUntil`.
 */
import { createExecutionContext } from 'cloudflare:test';
import app from '../src/index';
import type { Bindings } from '../src/types';

const BASE_URL = 'http://test.local';

export type CallOptions = {
  /** Metoda HTTP; domyślnie `GET`. */
  method?: string;
  /** Ścieżka względem aplikacji, np. `/situations/5`. */
  path: string;
  /** Token sesji. `undefined` = żądanie BEZ nagłówka `Authorization`. */
  token?: string;
  /** Dodatkowe nagłówki; scalane z (i nadpisujące) nagłówek auth z `token`. */
  headers?: Record<string, string>;
  /** Ciało żądania (np. `audioForm()` dla `POST /situations`). */
  body?: BodyInit;
};

/**
 * Jedyne miejsce budujące `Request`. Zwraca odpowiedź i `ctx` — wołający sam decyduje
 * o `waitOnExecutionContext(ctx)`.
 */
export async function call(
  env: Bindings,
  options: CallOptions,
): Promise<{ res: Response; ctx: ExecutionContext }> {
  const { method = 'GET', path, token, headers = {}, body } = options;
  const merged: Record<string, string> = {
    ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
  const req = new Request(`${BASE_URL}${path}`, { method, headers: merged, body });
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  return { res, ctx };
}

export type PostSituationOptions = {
  /** Zawartość pliku audio; domyślnie kilka bajtów (Whisper jest zamockowany). */
  audioBytes?: Uint8Array;
  /** Nazwa pliku — z niej trasa bierze rozszerzenie klucza R2. */
  name?: string;
  /** Pole `duration_ms` w multipart; pominięte, gdy `undefined`. */
  durationMs?: number;
};

/**
 * Realne ciało multipart `POST /situations` (`audio` + opcjonalne `duration_ms`) —
 * wydzielone, żeby macierz 401 wysyłała to samo ciało, co szczęśliwa ścieżka.
 */
export function audioForm(options: PostSituationOptions = {}): FormData {
  const {
    audioBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
    name = 'nagranie.m4a',
    durationMs,
  } = options;

  const form = new FormData();
  form.append('audio', new File([audioBytes], name, { type: 'audio/m4a' }));
  if (durationMs !== undefined) {
    form.append('duration_ms', String(durationMs));
  }
  return form;
}

/**
 * `POST /situations` z multipart (`audio` + opcjonalne `duration_ms`).
 * Zwraca odpowiedź i `ctx` — wołający sam decyduje o `waitOnExecutionContext(ctx)`.
 */
export function postSituation(
  env: Bindings,
  token: string,
  options: PostSituationOptions = {},
): Promise<{ res: Response; ctx: ExecutionContext }> {
  return call(env, { method: 'POST', path: '/situations', token, body: audioForm(options) });
}

async function getJson(env: Bindings, token: string, path: string): Promise<Response> {
  const { res } = await call(env, { path, token });
  return res;
}

/** `GET /situations` — lista dnia bieżącego (UTC) zalogowanego użytkownika. */
export function getSituations(env: Bindings, token: string): Promise<Response> {
  return getJson(env, token, '/situations');
}

/** `DELETE /situations/:id` — 204 bez ciała albo 404 dla cudzej/nieistniejącej. */
export async function deleteSituation(env: Bindings, token: string, id: number): Promise<Response> {
  const { res } = await call(env, { method: 'DELETE', path: `/situations/${id}`, token });
  return res;
}

/** `GET /flashcards/proposals` — propozycje + licznik `generatingCount`. */
export function getProposals(env: Bindings, token: string): Promise<Response> {
  return getJson(env, token, '/flashcards/proposals');
}

/** `POST /flashcards/:id/accept` — 200 z pustym ciałem albo 404. */
export async function acceptFlashcard(env: Bindings, token: string, id: number): Promise<Response> {
  const { res } = await call(env, { method: 'POST', path: `/flashcards/${id}/accept`, token });
  return res;
}

/** `DELETE /flashcards/:id` — 204 bez ciała albo 404. */
export async function deleteFlashcard(env: Bindings, token: string, id: number): Promise<Response> {
  const { res } = await call(env, { method: 'DELETE', path: `/flashcards/${id}`, token });
  return res;
}

/** `GET /flashcards/review` — fiszki do powtórki teraz + `dueCount`/`acceptedCount` (S-05). */
export function getReview(env: Bindings, token: string): Promise<Response> {
  return getJson(env, token, '/flashcards/review');
}

/** Nagłówek JSON tras przyjmujących ciało (`POST /flashcards/:id/grade`). */
export const JSON_HEADERS: Readonly<Record<string, string>> = { 'Content-Type': 'application/json' };

/**
 * `POST /flashcards/:id/grade` z ciałem JSON `body` (dowolne, także wadliwe — test
 * macierzy 400 podaje np. `{ grade: 'easy' }`) — 200 z pustym ciałem, 400 albo 404.
 */
export async function gradeFlashcard(
  env: Bindings,
  token: string,
  id: number,
  body: unknown,
): Promise<Response> {
  return gradeFlashcardRaw(env, token, id, JSON.stringify(body));
}

/** Jak `gradeFlashcard`, ale z surowym ciałem (np. nie-JSON) pod tym samym nagłówkiem JSON. */
export async function gradeFlashcardRaw(
  env: Bindings,
  token: string,
  id: number,
  rawBody: string,
): Promise<Response> {
  const { res } = await call(env, {
    method: 'POST',
    path: `/flashcards/${id}/grade`,
    token,
    headers: { ...JSON_HEADERS },
    body: rawBody,
  });
  return res;
}

/** `GET /auth/me` — `{ user: { id, email } }` dla użytkownika z tokenu. */
export function getMe(env: Bindings, token: string): Promise<Response> {
  return getJson(env, token, '/auth/me');
}

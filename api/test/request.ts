/**
 * Wywołanie aplikacji Hono w teście ścieżką bezpośrednią `app.fetch(req, env, ctx)`
 * z `ctx = createExecutionContext()`. Wołający decyduje, czy i jak czeka na zadanie
 * tła: `await waitOnExecutionContext(ctx)` (z `cloudflare:test`) czeka na wszystko,
 * co trafiło do `ctx.waitUntil`, i RZUCA, gdy któraś obietnica została odrzucona.
 * Asercje na stanie D1/R2 po odpowiedzi są poprawne dopiero po tym `await`.
 *
 * NIE używać `exports.default.fetch` (dawne `SELF.fetch`) do asercji na zadaniu tła —
 * ta ścieżka biegnie w osobnym kontekście I/O i nie czeka na `waitUntil`.
 */
import { createExecutionContext } from 'cloudflare:test';
import app from '../src/index';
import type { Bindings } from '../src/types';

const BASE_URL = 'http://test.local';

export type PostSituationOptions = {
  /** Zawartość pliku audio; domyślnie kilka bajtów (Whisper jest zamockowany). */
  audioBytes?: Uint8Array;
  /** Nazwa pliku — z niej trasa bierze rozszerzenie klucza R2. */
  name?: string;
  /** Pole `duration_ms` w multipart; pominięte, gdy `undefined`. */
  durationMs?: number;
};

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * `POST /situations` z multipart (`audio` + opcjonalne `duration_ms`).
 * Zwraca odpowiedź i `ctx` — wołający sam decyduje o `waitOnExecutionContext(ctx)`.
 */
export async function postSituation(
  env: Bindings,
  token: string,
  options: PostSituationOptions = {},
): Promise<{ res: Response; ctx: ExecutionContext }> {
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

  const req = new Request(`${BASE_URL}/situations`, {
    method: 'POST',
    headers: authHeaders(token),
    body: form,
  });
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  return { res, ctx };
}

async function getJson(env: Bindings, token: string, path: string): Promise<Response> {
  const req = new Request(`${BASE_URL}${path}`, { headers: authHeaders(token) });
  return app.fetch(req, env, createExecutionContext());
}

/** `GET /situations` — lista dnia bieżącego (UTC) zalogowanego użytkownika. */
export function getSituations(env: Bindings, token: string): Promise<Response> {
  return getJson(env, token, '/situations');
}

/** `GET /flashcards/proposals` — propozycje + licznik `generatingCount`. */
export function getProposals(env: Bindings, token: string): Promise<Response> {
  return getJson(env, token, '/flashcards/proposals');
}

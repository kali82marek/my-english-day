/**
 * Setup harnessu workerd — biegnie na starcie KAŻDEGO pliku testowego.
 * Izolacja w `@cloudflare/vitest-plugin` v1 jest per PLIK testowy: każdy plik dostaje
 * świeże D1/R2, ale zapisy w obrębie pliku trwają między testami (sprzątanie robi
 * `resetDb` z `test/db.ts` w `afterEach` plików integracyjnych).
 *
 * 1. Schemat D1 z migracji. `applyD1Migrations` aplikuje `migrations/` w kolejności
 *    numerów i księguje je w tabeli `d1_migrations` (idempotentne). To JEDYNE źródło
 *    schematu w testach — żaden test nie tworzy tabel ręcznie.
 * 2. Guard sieci. Przed każdym testem `globalThis.fetch` jest spy'em, który rzuca
 *    `Unmocked fetch: <url>`. Test potrzebujący OpenAI nadpisuje implementację przez
 *    `mockOpenAI` (`test/openai-mock.ts`) albo `vi.spyOn(globalThis, 'fetch')` (testy
 *    `src/lib/`) — Vitest zwraca istniejącego spy'a, więc nadpisanie działa.
 *    Jeśli test kiedykolwiek zobaczy 401/403 od OpenAI zamiast tego komunikatu,
 *    guard jest zepsuty (sekrety w `vitest.config.ts` to pierwsza linia obrony).
 */
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, vi } from 'vitest';
import { requestUrl } from './openai-mock';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    throw new Error(`Unmocked fetch: ${requestUrl(input)}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

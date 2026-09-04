/**
 * Testy integracyjne trasy `/auth` w workerd — dowód ryzyka #3 (cudze dane / IDOR) z
 * `context/foundation/test-plan.md` §2 dla konta: `GET /auth/me` oddaje dane użytkownika
 * z TOKENU (nie „pierwszego z bazy") i DOKŁADNIE kontrakt `AuthUser` z frontu
 * (`test/dto.ts`) — bez `password_hash`, bez `created_at`. Bramę 401 na `/auth/me`
 * dowodzi macierz w `src/middleware/auth.integration.test.ts`; kryptografię tokenu —
 * `src/lib/jwt.test.ts` (§7 planu testów: nie rozszerzać na trasach).
 *
 * Zasady harnessu (patrz `test/setup.ts`, `test/db.ts`, `test/request.ts`): zasiew
 * helperami, kształt żądania w `test/request.ts`, `afterEach(resetDb)` (izolacja per
 * PLIK), DTO jako dokładny zbiór kluczy (`keysOf`), nigdy `not.toHaveProperty`.
 */
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { resetDb, seedUser } from '../../test/db';
import { AUTH_USER_DTO_KEYS, keysOf } from '../../test/dto';
import { getMe } from '../../test/request';

afterEach(() => resetDb(env));

describe('Ryzyko #3: cudze dane (IDOR)', () => {
  // Deliberate-breaks (każdy osobno → czerwony; kod przywrócony, suite zielone):
  //   (a) `SELECT *` zamiast `SELECT id, email` w `GET /me` (`auth.ts`) → klucze `user`
  //       ≠ `AUTH_USER_DTO_KEYS` (`password_hash`, `created_at` w odpowiedzi);
  //   (b) usuń `WHERE id = ?` (i `.bind(userId)`) → pierwszy wiersz to Aaron → `id` ≠ Alice.
  it('T3.9 GET /auth/me → dane użytkownika z tokenu, klucze dokładnie `{ user: { id, email } }`', async () => {
    // Drugi użytkownik poprzedza Alice w OBU naturalnych porządkach skanu bez `WHERE`:
    // po rowid (zasiany wcześniej) i po e-mailu (indeks UNIQUE na `email` pokrywa
    // `SELECT id, email`, więc SQLite może skanować alfabetycznie — „bob" przegrałby
    // z „alice" i brak `WHERE` byłby niewidoczny). Stąd `aaron`, nie `bob`.
    const aaron = await seedUser(env, 'aaron');
    const alice = await seedUser(env, 'alice');
    expect(aaron.id).toBeLessThan(alice.id);

    const res = await getMe(env, alice.token);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(keysOf(body)).toEqual(['user']);
    expect(keysOf(body.user)).toEqual(AUTH_USER_DTO_KEYS);
    expect(body.user.id).toBe(alice.id);
    expect(body.user.email).toContain('alice-');
  });
});

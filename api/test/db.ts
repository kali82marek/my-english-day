/**
 * Helpery D1/R2 dla testów integracyjnych: zasiewanie użytkownika, odczyt surowych
 * wierszy, wstrzykiwanie błędów D1 triggerem i sprzątanie po teście.
 *
 * Izolacja w pluginie jest per PLIK testowy, więc każdy plik integracyjny woła
 * `afterEach(() => resetDb(env))`. Użytkownik jest zasiewany per test z unikalnym
 * e-mailem; triggery założone przez `withTrigger` są zdejmowane w `resetDb`.
 *
 * Błędy D1 wstrzykujemy NA KRAWĘDZI (trigger SQL na schemacie z migracji), nigdy
 * przez mockowanie bindingu od środka — dzięki temu test obserwuje skutek („ile kart
 * w bazie, jaki stan") niezależnie od tego, jak kod osiąga atomowość.
 */
import { signSession } from '../src/lib/jwt';
import type { Bindings } from '../src/types';

/** Wiersz `situations` tak, jak siedzi w D1. */
export type SituationRow = {
  id: number;
  user_id: number;
  transcript: string | null;
  status: 'pending' | 'done' | 'failed';
  audio_key: string | null;
  duration_ms: number | null;
  flashcards_status: 'pending' | 'done' | 'failed';
  created_at: string;
};

/** Wiersz `flashcards` tak, jak siedzi w D1 (`is_variant` = INTEGER 0/1). */
export type FlashcardRow = {
  id: number;
  situation_id: number;
  user_id: number;
  type: string;
  front_en: string;
  back_pl: string;
  example_en: string | null;
  status: 'proposed' | 'accepted';
  is_variant: number;
  created_at: string;
};

/**
 * Zasiewa użytkownika bezpośrednim `INSERT` (bez PBKDF2 z `/auth/register`) i wybija
 * token sesji tym samym sekretem, którego używa Worker (`env.JWT_SECRET`).
 */
export async function seedUser(
  env: Bindings,
  label = 'user',
): Promise<{ id: number; token: string }> {
  const email = `${label}-${crypto.randomUUID()}@test.invalid`;
  const row = await env.DB.prepare(
    'INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id',
  )
    .bind(email, 'pbkdf2$1$test$test')
    .first<{ id: number }>();
  if (!row) {
    throw new Error('seedUser: INSERT nie zwrócił wiersza.');
  }
  return { id: row.id, token: await signSession(row.id, env.JWT_SECRET) };
}

/** Surowy wiersz `situations` albo `null`. */
export function readSituation(env: Bindings, id: number): Promise<SituationRow | null> {
  return env.DB.prepare('SELECT * FROM situations WHERE id = ?').bind(id).first<SituationRow>();
}

/** Wszystkie karty sytuacji w kolejności zapisu. */
export async function readFlashcards(env: Bindings, situationId: number): Promise<FlashcardRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM flashcards WHERE situation_id = ? ORDER BY id',
  )
    .bind(situationId)
    .all<FlashcardRow>();
  return results;
}

/**
 * Ciało triggera przerywające instrukcję: SQLite `RAISE(ABORT, msg)`. `BEGIN`/`END`
 * wielkimi literami — parser D1 rozpoznaje blok triggera tylko w tej formie
 * (workers-sdk #10998).
 */
export function raiseAbort(message: string): string {
  return `BEGIN SELECT RAISE(ABORT, '${message.replaceAll("'", "''")}'); END`;
}

const registeredTriggers = new Set<string>();

/**
 * Zakłada trigger `CREATE TRIGGER <name> <definition>` i rejestruje nazwę do zdjęcia
 * w `resetDb`. `definition` to część po nazwie, np.
 * `BEFORE INSERT ON flashcards ${raiseAbort('wstrzyknięty błąd D1')}`.
 */
export async function withTrigger(env: Bindings, name: string, definition: string): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`withTrigger: niepoprawna nazwa triggera "${name}".`);
  }
  // Rejestracja PRZED `CREATE`, żeby nieudane założenie też trafiło do sprzątania.
  registeredTriggers.add(name);
  await env.DB.prepare(`CREATE TRIGGER ${name} ${definition}`).run();
}

/**
 * Sprząta po teście: zdejmuje zarejestrowane triggery, czyści tabele w kolejności
 * wymuszonej kluczami obcymi (flashcards → situations → users) i opróżnia bucket R2.
 */
export async function resetDb(env: Bindings): Promise<void> {
  for (const name of registeredTriggers) {
    await env.DB.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();
  }
  registeredTriggers.clear();

  await env.DB.batch([
    env.DB.prepare('DELETE FROM flashcards'),
    env.DB.prepare('DELETE FROM situations'),
    env.DB.prepare('DELETE FROM users'),
  ]);

  const { objects } = await env.AUDIO_BUCKET.list();
  if (objects.length > 0) {
    await env.AUDIO_BUCKET.delete(objects.map((object) => object.key));
  }
}

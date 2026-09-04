/**
 * Helpery D1/R2 dla testów integracyjnych: zasiewanie użytkownika, sytuacji i fiszki
 * (z jawnym `created_at`), odczyt surowych wierszy, wstrzykiwanie błędów D1 triggerem,
 * tripwire na zapisach i sprzątanie po teście.
 *
 * ZASIEW I ODCZYT ŻYJĄ TYLKO TUTAJ: testy ryzyk nie piszą SQL. Jedyną dźwignią czasu
 * po stronie SQL jest jawny `created_at` (`seedSituation`/`seedFlashcard` + `toSqlDatetime`)
 * — `vi.setSystemTime` steruje `Date` w JS, ale NIE zegarem SQLite (`date('now')`
 * i DEFAULT kolumn to zawsze realny UTC). Pominięty `createdAt` = kolumna dostaje DEFAULT.
 *
 * Izolacja w pluginie jest per PLIK testowy, więc każdy plik integracyjny woła
 * `afterEach(() => resetDb(env))`. Użytkownik jest zasiewany per test z unikalnym
 * e-mailem; triggery założone przez `withTrigger`/`withWriteTripwire` są zdejmowane
 * w `resetDb`.
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

/**
 * Chwila UTC w formacie DEFAULT kolumn `created_at` (`YYYY-MM-DD HH:MM:SS`, bez `T`
 * i bez `Z`) — zasiany tekst jest nieodróżnialny od produkcyjnego DEFAULT (zegar SQLite, UTC).
 */
export function toSqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** `Date` (przez `toSqlDatetime`) albo gotowy string SQL. */
type CreatedAt = Date | string;

function toCreatedAt(value: CreatedAt): string {
  return value instanceof Date ? toSqlDatetime(value) : value;
}

export type SeedSituationOptions = {
  /** Domyślnie `pending`. */
  status?: SituationRow['status'];
  /** Domyślnie `pending`. */
  flashcardsStatus?: SituationRow['flashcards_status'];
  /** Domyślnie `null` (jak przed transkrypcją). */
  transcript?: string | null;
  /** Domyślnie `situations/<userId>/seeded.m4a` (bez obiektu w R2 — `delete` nie rzuca). */
  audioKey?: string | null;
  /** Domyślnie `null`. */
  durationMs?: number | null;
  /** Pominięte = DEFAULT kolumny (realny zegar SQLite, UTC). */
  createdAt?: CreatedAt;
};

/** Zasiewa sytuację wskazanego użytkownika bezpośrednim `INSERT`; zwraca `id`. */
export async function seedSituation(
  env: Bindings,
  userId: number,
  options: SeedSituationOptions = {},
): Promise<number> {
  const {
    status = 'pending',
    flashcardsStatus = 'pending',
    transcript = null,
    audioKey = `situations/${userId}/seeded.m4a`,
    durationMs = null,
    createdAt,
  } = options;

  const columns = ['user_id', 'status', 'flashcards_status', 'transcript', 'audio_key', 'duration_ms'];
  const values: (string | number | null)[] = [userId, status, flashcardsStatus, transcript, audioKey, durationMs];
  if (createdAt !== undefined) {
    columns.push('created_at');
    values.push(toCreatedAt(createdAt));
  }

  const row = await env.DB.prepare(
    `INSERT INTO situations (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING id`,
  )
    .bind(...values)
    .first<{ id: number }>();
  if (!row) {
    throw new Error('seedSituation: INSERT nie zwrócił wiersza.');
  }
  return row.id;
}

export type SeedFlashcardOptions = {
  situationId: number;
  userId: number;
  /** Domyślnie `proposed`. */
  status?: FlashcardRow['status'];
  /** Domyślnie `false` (INTEGER 0). */
  isVariant?: boolean;
  /** Domyślnie `word`. */
  type?: 'word' | 'phrase' | 'sentence';
  frontEn?: string;
  backPl?: string;
  /** Domyślnie `''` — nigdy NULL, bo DTO deklaruje `string`. */
  exampleEn?: string;
  /** Pominięte = DEFAULT kolumny (realny zegar SQLite, UTC). */
  createdAt?: CreatedAt;
};

/** Zasiewa fiszkę bezpośrednim `INSERT`; zwraca `id`. */
export async function seedFlashcard(env: Bindings, options: SeedFlashcardOptions): Promise<number> {
  const {
    situationId,
    userId,
    status = 'proposed',
    isVariant = false,
    type = 'word',
    frontEn = 'invoice',
    backPl = 'faktura',
    exampleEn = '',
    createdAt,
  } = options;

  const columns = ['situation_id', 'user_id', 'type', 'front_en', 'back_pl', 'example_en', 'status', 'is_variant'];
  const values: (string | number)[] = [situationId, userId, type, frontEn, backPl, exampleEn, status, isVariant ? 1 : 0];
  if (createdAt !== undefined) {
    columns.push('created_at');
    values.push(toCreatedAt(createdAt));
  }

  const row = await env.DB.prepare(
    `INSERT INTO flashcards (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING id`,
  )
    .bind(...values)
    .first<{ id: number }>();
  if (!row) {
    throw new Error('seedFlashcard: INSERT nie zwrócił wiersza.');
  }
  return row.id;
}

/** Surowy wiersz `situations` albo `null`. */
export function readSituation(env: Bindings, id: number): Promise<SituationRow | null> {
  return env.DB.prepare('SELECT * FROM situations WHERE id = ?').bind(id).first<SituationRow>();
}

/** Wszystkie sytuacje użytkownika w kolejności zapisu. */
export async function readSituationsOf(env: Bindings, userId: number): Promise<SituationRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM situations WHERE user_id = ? ORDER BY id')
    .bind(userId)
    .all<SituationRow>();
  return results;
}

/** Surowy wiersz `flashcards` albo `null`. */
export function readFlashcard(env: Bindings, id: number): Promise<FlashcardRow | null> {
  return env.DB.prepare('SELECT * FROM flashcards WHERE id = ?').bind(id).first<FlashcardRow>();
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

const TRIPWIRE_TABLES = ['situations', 'flashcards'] as const;
const TRIPWIRE_OPS = ['INSERT', 'UPDATE', 'DELETE'] as const;

/**
 * Tripwire: KAŻDY zapis do tabel danych (`situations`, `flashcards`) staje się błędem
 * `RAISE(ABORT, 'tripwire: …')`. Obserwowalny dowód „trasa nie dotknęła D1" — trasa,
 * która mimo braku uwierzytelnienia coś zapisze, odpowie 500 zamiast 401.
 *
 * Zakładać PO zasianiu ofiary i jej danych (zasiew też jest zapisem). Nazwy stałe
 * (`test_tripwire_<op>_<tabela>`), więc jeden test uzbraja tripwire raz; `resetDb`
 * zdejmuje go przed kolejnym testem.
 */
export async function withWriteTripwire(env: Bindings): Promise<void> {
  for (const table of TRIPWIRE_TABLES) {
    for (const op of TRIPWIRE_OPS) {
      await withTrigger(
        env,
        `test_tripwire_${op.toLowerCase()}_${table}`,
        `BEFORE ${op} ON ${table} ${raiseAbort(`tripwire: zapis do ${table} bez uwierzytelnienia`)}`,
      );
    }
  }
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

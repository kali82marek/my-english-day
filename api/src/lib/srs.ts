/**
 * Algorytm powtórek (slice S-05, FR-012) — czysta logika, bez D1 i bez I/O.
 *
 * PRD wybiera TRZY przyciski oceny („złoty środek między precyzją a prostotą"):
 * Nie umiem / Prawie / Umiem. Mapujemy je na uproszczony SM-2 (sprawdzony, prosty
 * model rosnących odstępów), zredukowany do trzech ocen:
 * - `again` (Nie umiem): seria zerowana, fiszka wraca OD RAZU (`due_at = now`) — czyli
 *   jeszcze w tej samej sesji; ease spada o 0.20 (podłoga 1.3 jak w SM-2).
 * - `hard` (Prawie): seria rośnie, ale odstęp jest krótki — pierwszy krok 1 dzień,
 *   potem ×1.2 (nigdy mniej niż poprzedni + 1 dzień, żeby nie cofać); ease spada o 0.15.
 *   To jest „wiem, ale nie do końca" z PRD: mniej niż `good`, więcej niż `again`.
 * - `good` (Umiem): seria rośnie; kroki 1 dzień → 3 dni → ×ease (SM-2); ease bez zmian.
 *
 * Liczby (1/3/×ease, −0.15/−0.20, podłoga 1.3) to decyzja planu S-05, nie PRD —
 * retencja weryfikowana użyciem; zmiana = edycja tej funkcji i wyroczni w `srs.test.ts`.
 * Odstęp ma twardy pułap `MAX_INTERVAL_DAYS` (365 dni, jak domyślnie w Anki; przegląd
 * S-05 W1): trasa `grade` nie wymaga, by fiszka była należna, więc wielokrotne `good`
 * przez surowe API rosłoby wykładniczo aż do zepsucia formatu `due_at` i zakresu `Date`.
 * Odstępy liczone w dniach na milisekundach UTC (`now.getTime() + dni × DAY_MS`);
 * format tekstowy `due_at` dla D1 nadaje trasa (Faza 2), nie ten moduł.
 * Etykiety polskie przycisków żyją na froncie; tu tylko identyfikatory ocen.
 */

/**
 * Trzy oceny: `again` = Nie umiem, `hard` = Prawie, `good` = Umiem.
 * = `ReviewGrade` w `src/lib/api.ts` (front) — osobne tsconfigi, zmieniaj oba naraz.
 */
export const GRADES = ['again', 'hard', 'good'] as const;
export type Grade = (typeof GRADES)[number];

/** Stan powtórek fiszki — kolumny `interval_days`, `ease`, `repetitions` (migracja 0005). */
export type ReviewState = {
  interval_days: number;
  ease: number;
  repetitions: number;
};

const DAY_MS = 86_400_000;
const MIN_EASE = 1.3;
const AGAIN_EASE_PENALTY = 0.2;
const HARD_EASE_PENALTY = 0.15;
const HARD_MULTIPLIER = 1.2;
const FIRST_INTERVAL_DAYS = 1;
const SECOND_GOOD_INTERVAL_DAYS = 3;
// Pułap odstępu (dni) — chroni format `due_at` (`YYYY-MM-DD …`) i zakres `Date` przy
// wielokrotnym `good` na tej samej fiszce przez surowe API (trasa nie sprawdza należności).
const MAX_INTERVAL_DAYS = 365;

/** Type guard dla ciała żądania oceny — przyjmuje wyłącznie trójkę z `GRADES`. */
export function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value);
}

/**
 * Chwila UTC w formacie DEFAULT kolumn D1 (`YYYY-MM-DD HH:MM:SS`, bez `T` i bez `Z`) —
 * jeden format dla `due_at`/`reviewed_at` i dla porównania „czy już pora" w trasie
 * (bind z JS, nie `datetime('now')` w SQL: testy sterują wyłącznie zegarem JS).
 * Lustro helpera o tej samej nazwie w `test/db.ts`.
 */
export function toSqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Wyznacza nowy stan powtórek i chwilę następnej powtórki. Nie mutuje `state`.
 * `due_at` zwracane jako `Date` (UTC) — `again` daje dokładnie `now`.
 */
export function scheduleReview(
  state: ReviewState,
  grade: Grade,
  now: Date,
): ReviewState & { due_at: Date } {
  const { interval_days: intervalBefore, ease: easeBefore, repetitions: repsBefore } = state;

  if (grade === 'again') {
    return {
      repetitions: 0,
      interval_days: 0,
      ease: Math.max(MIN_EASE, easeBefore - AGAIN_EASE_PENALTY),
      due_at: new Date(now.getTime()),
    };
  }

  let rawIntervalDays: number;
  let ease: number;
  if (grade === 'hard') {
    rawIntervalDays =
      repsBefore === 0
        ? FIRST_INTERVAL_DAYS
        : Math.max(intervalBefore + 1, Math.round(intervalBefore * HARD_MULTIPLIER));
    ease = Math.max(MIN_EASE, easeBefore - HARD_EASE_PENALTY);
  } else {
    rawIntervalDays =
      repsBefore === 0
        ? FIRST_INTERVAL_DAYS
        : repsBefore === 1
          ? SECOND_GOOD_INTERVAL_DAYS
          : Math.round(intervalBefore * easeBefore);
    ease = easeBefore;
  }
  // Pułap PO wyliczeniu kroku — `hard` i `good` nigdy nie odkładają dalej niż rok.
  const intervalDays = Math.min(MAX_INTERVAL_DAYS, rawIntervalDays);

  return {
    repetitions: repsBefore + 1,
    interval_days: intervalDays,
    ease,
    due_at: new Date(now.getTime() + intervalDays * DAY_MS),
  };
}

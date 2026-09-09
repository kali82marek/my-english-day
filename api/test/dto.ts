/**
 * LUSTRO KONTRAKTU Z FRONTEM — jedyne miejsce w `api/`, gdzie zapisany jest kształt
 * odpowiedzi tras jako dokładny zbiór kluczy. Typy poniżej odwzorowują 1:1
 * `src/lib/api.ts` (`Situation`, `Flashcard`, `AuthUser`); repo `api/` i front mają
 * osobne `tsconfig`, więc rozjazdu NIE wykrywa typecheck — ZMIENIAJ OBA NARAZ.
 *
 * Sprzężenie typ ↔ lista: literał `Record<keyof <DTO>, true>` obala `npm run typecheck`
 * zarówno przy brakującym kluczu (brak właściwości), jak i nadmiarowym (excess property
 * check). Listy są posortowane, żeby `expect(keysOf(x)).toEqual(<LISTA>)` porównywało
 * zbiory, nie kolejność.
 *
 * Wzorzec asercji DTO: ZAWSZE dokładny zbiór kluczy (`keysOf`), NIGDY
 * `not.toHaveProperty` — trasa bez warstwy mapowania (`GET /flashcards/proposals`)
 * wycieka każdą kolumnę dopisaną do `SELECT`, a lista nazw „czego nie ma" tego nie łapie.
 */

/** = `Situation` w `src/lib/api.ts`. */
export type SituationDTO = {
  id: number;
  status: 'pending' | 'done' | 'failed';
  transcript: string | null;
  duration_ms: number | null;
  flashcards_status: 'pending' | 'done' | 'failed';
  created_at: string;
};

/**
 * = `Flashcard` w `src/lib/api.ts` (bez `status`, `user_id`, `is_variant` ani kolumn stanu
 * powtórek `due_at`/`interval_days`/`ease`/`repetitions`/`reviewed_at`). Ten sam zbiór
 * kluczy zwracają `GET /flashcards/proposals` i `GET /flashcards/review` (S-05).
 */
export type FlashcardDTO = {
  id: number;
  situation_id: number;
  type: 'word' | 'phrase' | 'sentence';
  front_en: string;
  back_pl: string;
  example_en: string;
  created_at: string;
};

/** = `AuthUser` w `src/lib/api.ts` (bez `password_hash`, `created_at`). */
export type AuthUserDTO = {
  id: number;
  email: string;
};

const situationShape: Record<keyof SituationDTO, true> = {
  id: true,
  status: true,
  transcript: true,
  duration_ms: true,
  flashcards_status: true,
  created_at: true,
};

const flashcardShape: Record<keyof FlashcardDTO, true> = {
  id: true,
  situation_id: true,
  type: true,
  front_en: true,
  back_pl: true,
  example_en: true,
  created_at: true,
};

const authUserShape: Record<keyof AuthUserDTO, true> = {
  id: true,
  email: true,
};

/** Posortowane klucze `SituationDTO` (`GET /situations`, `POST /situations`). */
export const SITUATION_DTO_KEYS: readonly string[] = Object.keys(situationShape).sort();

/** Posortowane klucze `FlashcardDTO` (`GET /flashcards/proposals`, `GET /flashcards/review`). */
export const FLASHCARD_DTO_KEYS: readonly string[] = Object.keys(flashcardShape).sort();

/** Posortowane klucze `AuthUserDTO` (`GET /auth/me` → `user`). */
export const AUTH_USER_DTO_KEYS: readonly string[] = Object.keys(authUserShape).sort();

/** Posortowane klucze wartości z odpowiedzi — do porównania z listami powyżej. */
export function keysOf(value: unknown): string[] {
  if (value === null || typeof value !== 'object') {
    throw new Error(`keysOf: oczekiwano obiektu, dostano ${value === null ? 'null' : typeof value}.`);
  }
  return Object.keys(value).sort();
}

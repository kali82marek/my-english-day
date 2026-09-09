# Sesja powtórek (spaced repetition) z 3 przyciskami oceny (S-05) Implementation Plan

## Overview

Użytkownik może rozpocząć sesję nauki z fiszek ze swojej bazy (zaakceptowanych w S-02), prezentowanych według algorytmu powtórek, i ocenić każdą jednym z trzech przycisków: **Nie umiem / Prawie / Umiem** (FR-011, FR-012; domknięcie US-01 i drugorzędnego Kryterium sukcesu „uczy się codziennie z fiszek"). Kierunek nauki: aplikacja pokazuje **polską stronę** (co chcę powiedzieć) → użytkownik przypomina sobie angielski → odsłania front i przykład → ocenia. Stan powtórek żyje na serwerze przy fiszce (konto w chmurze, PRD Access Control), harmonogram liczy uproszczony SM-2 zmapowany na 3 oceny. To slice **S-05** (Stream C), równoległy do S-04.

## Current State Analysis

- **Dane**: `flashcards` (migracje 0003/0004): `status` (`proposed`|`accepted`), `type`, `front_en`, `back_pl`, `example_en`, `is_variant`, `created_at`; indeksy `(user_id, status)`, `(situation_id)`. Brak jakiegokolwiek stanu powtórek. `POST /flashcards/:id/accept` przełącza `status='accepted'` (`api/src/routes/flashcards.ts`); `DELETE /situations/:id` kasuje też fiszki sytuacji (propozycje i przyjęte).
- **Trasy**: `flashcardsRouter` (`requireAuth` na `*`), wzorzec raw-SQL, `{ error }` JSON, 404 bez wyroczni istnienia (cudze = nieistniejące). Macierz 401 w `api/src/middleware/auth.integration.test.ts` wymaga wiersza dla KAŻDEJ nowej trasy chronionej (T3.3 obala suite bez niego).
- **DTO**: `api/test/dto.ts` to lustro `src/lib/api.ts` (`FlashcardDTO` = `Flashcard`); asercje DTO zawsze jako dokładny zbiór kluczy.
- **Front**: tab-navigator `src/components/app-tabs.tsx` (native, `NativeTabs`) i `app-tabs.web.tsx` (web) — dwa triggery: `index` (Home), `flashcards` (Fiszki). Ekran przeglądu `src/app/(app)/flashcards.tsx` = kolejka `queue[0]`, optymistyczne decyzje z rollbackiem, `useFocusEffect` do ładowania. Karta `src/components/flashcard-card.tsx` (czysta prezentacja, kolory akcji stałe, `TYPE_LABELS`). Klient `src/lib/api.ts` (`apiFetch`, `flashcardsApi`). Theming: `Colors`, `Spacing`, `ThemedText`/`ThemedView`. Brak testów frontu (test-plan §4 — świadomie).
- **Czas**: kolumny `created_at` to `datetime('now')` UTC w formacie `YYYY-MM-DD HH:MM:SS`; helper `toSqlDatetime` w `api/test/db.ts`; testy sterują zegarem JS przez `vi.setSystemTime`, ale NIE zegarem SQLite (`test/db.ts` nagłówek) — porównania „czy już pora" muszą więc dostać `now` z JS (bind), nie `datetime('now')` w SQL.
- **Bramki**: API `npm run typecheck` + `npm test` (workerd, migracje z `api/migrations/`); front `npm run lint` + `npx tsc --noEmit` (oba zielone dziś).

### Key Discoveries:

- **`ALTER TABLE ADD COLUMN` w SQLite nie przyjmuje niestałego DEFAULT** (`datetime('now')`) — kolumna `due_at` musi być nullable, a `NULL` znaczy „do powtórki od razu" (fiszka świeżo zaakceptowana). Dzięki temu `accept` nie wymaga zmian, a istniejące zaakceptowane fiszki wchodzą do pierwszej sesji bez backfillu.
- **Trzy oceny → SM-2 zredukowany**: `again` (Nie umiem) zeruje serię i wraca w tej samej sesji; `good` (Umiem) 1 → 3 → ×ease dni; `hard` (Prawie) to krótszy krok niż `good` i obniża ease. Czysta funkcja `scheduleReview(state, grade, now)` — testowalna bez D1 (§6.1), wyrocznie zapisane w planie (PRD milczy o liczbach; Kryterium: 3 przyciski, „Prawie" między „Nie umiem" a „Umiem").
- **Sesja = kolejka lokalna na kliencie**: serwer oddaje fiszki „do powtórki teraz" (limit 20 na pobranie); klient ocenia po jednej, `again` wraca na koniec lokalnej kolejki (serwer i tak ma `due_at = now`, więc po ponownym wejściu też będzie do powtórki). Koniec sesji = pusta kolejka.
- **Odróżnić „nic do powtórki dziś" od „pusta baza"**: odpowiedź listy niesie `acceptedCount`, żeby ekran pokazał właściwy stan (zachęta do akceptacji propozycji vs „wszystko powtórzone").
- **Własność jak dotąd**: `UPDATE ... WHERE id = ? AND user_id = ? AND status = 'accepted'` → `changes === 0` = 404 (cudza, nieistniejąca lub jeszcze nie w bazie nauki) — ten sam kontrakt co `accept`.
- **Ikony tabów**: tylko `home.png` i `explore.png` w `assets/images/tabIcons/` — nowy tab użyje `explore.png` (ikona nie jest wymogiem PRD; osobna grafika to follow-up).
- **Lekcje zespołu**: dev server na porcie 3030; 3GP nie działa z Whisperem (weryfikacja ręczna end-to-end).

## What We're NOT Doing

- **Brak pełnego Anki (4 przyciski, kroki nauki w minutach, leech, fuzz)** — PRD wprost wybiera 3 przyciski; interwały w dniach.
- **Brak konfiguracji algorytmu przez użytkownika** ani statystyk/streaków (drugorzędne Kryterium sukcesu mierzy się ręcznie).
- **Brak nauki z propozycji** — do sesji wchodzą wyłącznie `accepted` (FR-010: baza nauki = zaakceptowane).
- **Brak edycji/usuwania fiszek z bazy nauki w sesji** (FR-009: edycja w v2).
- **Brak kierunku EN→PL / losowania kierunku** — jeden kierunek PL→EN (cel persony: „umieć powiedzieć").
- **Brak dźwięku / TTS, brak powiadomień „pora na powtórkę"** — v2.
- **Brak testów frontu** (test-plan §4/§7 — świadomie poza wdrożeniem); front weryfikowany lintem, typecheckiem i ręcznie.
- **Brak osobnej tabeli historii powtórek** — stan na wierszu fiszki wystarcza MVP.

## Implementation Approach

Trzy fazy od danych do UI. (1) Addytywna migracja `0005` z kolumnami stanu powtórek (`due_at` NULL = od razu) i czysty moduł `api/src/lib/srs.ts` z algorytmem + testy jednostkowe na wyroczniach z planu. (2) Dwie trasy w `flashcardsRouter`: `GET /flashcards/review` (fiszki do powtórki teraz + liczniki) i `POST /flashcards/:id/grade` (ocena → nowy stan), z `now` bindowanym z JS; testy integracyjne (własność, DTO, zegar) i dwa wiersze w macierzy 401. (3) Front: `reviewApi` w kliencie, nowy tab „Nauka", ekran sesji z kartą PL→EN (odsłoń → 3 przyciski), lokalna kolejka z `again` na koniec, optymistyczne oceny z rollbackiem, stany pustej bazy / końca sesji.

## Critical Implementation Details

- **Czas i cykl życia** — „czy pora na powtórkę" porównuje `due_at` z chwilą przekazaną z JS (`toSqlDatetime(new Date())`, ten sam format co DEFAULT kolumn), NIE z `datetime('now')` w SQL: testy sterują tylko zegarem JS (`vi.setSystemTime`), a produkcyjnie to bez różnicy (oba UTC). `NULL` w `due_at` = do powtórki zawsze.
- **Sekwencjonowanie stanu (front)** — `again` NIE zdejmuje karty z sesji: przenosi ją na koniec lokalnej kolejki (ta sama instancja, nowy `key` nie jest potrzebny, bo odsłonięcie resetuje się przy zmianie `queue[0].id` — jeśli w kolejce jest tylko jedna karta i wraca na `queue[0]`, stan „odsłonięte" trzeba zresetować jawnie po ocenie).

## Phase 1: Warstwa danych i algorytm powtórek

### Overview

Kolumny stanu powtórek na `flashcards` (addytywnie, bez backfillu) oraz czysta funkcja harmonogramu z testami jednostkowymi. Fundament pod trasy z Fazy 2.

### Changes Required:

#### 1. Migracja: stan powtórek na fiszce

**File**: `api/migrations/0005_add_flashcard_review_state.sql`

**Intent**: Przechować na serwerze (konto w chmurze) wszystko, czego algorytm potrzebuje do wyznaczenia następnej powtórki; nowo zaakceptowane fiszki mają być od razu do powtórki bez zmian w `accept`.

**Contract** (wzorzec komentarzy jak 0003/0004; wszystko addytywne, stałe DEFAULT):
- `ALTER TABLE flashcards ADD COLUMN due_at TEXT;` — `NULL` = do powtórki od razu; po ocenie `YYYY-MM-DD HH:MM:SS` UTC.
- `ALTER TABLE flashcards ADD COLUMN interval_days INTEGER NOT NULL DEFAULT 0;`
- `ALTER TABLE flashcards ADD COLUMN ease REAL NOT NULL DEFAULT 2.5;`
- `ALTER TABLE flashcards ADD COLUMN repetitions INTEGER NOT NULL DEFAULT 0;` — długość bieżącej serii poprawnych odpowiedzi.
- `ALTER TABLE flashcards ADD COLUMN reviewed_at TEXT;` — ostatnia ocena, `NULL` = nigdy.
- `CREATE INDEX idx_flashcards_user_status_due ON flashcards (user_id, status, due_at);`

#### 2. Moduł algorytmu

**File**: `api/src/lib/srs.ts`

**Intent**: Jedno miejsce mapowania trzech ocen na odstępy — czyste, bez D1, opisane po polsku „dlaczego takie liczby".

**Contract**:
- `export const GRADES = ['again', 'hard', 'good'] as const; export type Grade = (typeof GRADES)[number];` (`again` = Nie umiem, `hard` = Prawie, `good` = Umiem — etykiety PL żyją na froncie).
- `export type ReviewState = { interval_days: number; ease: number; repetitions: number };`
- `export function scheduleReview(state: ReviewState, grade: Grade, now: Date): ReviewState & { due_at: Date }`:
  - `again`: `repetitions = 0`, `interval_days = 0`, `ease = max(1.3, ease − 0.20)`, `due_at = now` (wraca w tej samej sesji).
  - `hard`: `repetitions += 1`, `interval_days = repetitions_before === 0 ? 1 : max(interval_before + 1, round(interval_before × 1.2))`, `ease = max(1.3, ease − 0.15)`, `due_at = now + interval_days dni`.
  - `good`: `repetitions += 1`, `interval_days = repetitions_before === 0 ? 1 : repetitions_before === 1 ? 3 : round(interval_before × ease)`, `ease` bez zmian, `due_at = now + interval_days dni`.
  - Nie mutuje wejścia; `due_at` liczone na milisekundach UTC (`now.getTime() + days × 86 400 000`).
- `export function isGrade(value: unknown): value is Grade`.

#### 3. Testy jednostkowe algorytmu

**File**: `api/src/lib/srs.test.ts`

**Intent**: Zakodować wyrocznie z PRD i planu (nie z implementacji): trzy oceny, „Nie umiem" wraca od razu, „Prawie" krócej niż „Umiem", odstępy rosną z serią.

**Contract** (`describe('FR-012: trzy oceny → odstępy powtórek')`, wzorzec §6.1, bez mocków; stała `DAY_MS` lokalna):
- R1.1 `again` z dowolnego stanu → `due_at` równe `now`, `repetitions = 0`, `interval_days = 0`, `ease` spada, nie poniżej 1.3.
- R1.2 nowa fiszka (stan domyślny) `good` → 1 dzień; drugi `good` → 3 dni; trzeci → > 3 dni (mnożnik ease); seria `good` daje ściśle rosnące odstępy przez 5 kroków.
- R1.3 z tego samego stanu `hard` daje `due_at` wcześniejsze niż `good` i niższe `ease`; `hard` na nowej fiszce → 1 dzień; `hard` po odstępie 10 dni → więcej niż 10 dni (nigdy nie cofa).
- R1.4 wejście nie jest mutowane; `isGrade` przyjmuje trójkę i odrzuca `'easy'`, `''`, `1`, `undefined`.
- Deliberate-breaks w komentarzach (np. `again` ustawia `due_at = now + 1 dzień` → R1.1; `good` drugi krok = 1 → R1.2).

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `cd api && npm run typecheck`
- Testy jednostkowe algorytmu przechodzą: `cd api && npx vitest run src/lib/srs.test.ts`
- Cały zestaw API przechodzi na schemacie z migracji (migracja 0005 stosuje się w harnessie): `cd api && npm test`

#### Manual Verification:

- (brak — faza bez zachowania widocznego dla użytkownika)

---

## Phase 2: Trasy sesji powtórek (API)

### Overview

Dwie trasy chronione w `flashcardsRouter`: lista fiszek do powtórki teraz + liczniki oraz ocena fiszki. Testy integracyjne (własność, DTO, zegar) i macierz 401.

### Changes Required:

#### 1. Trasy

**File**: `api/src/routes/flashcards.ts`

**Intent**: Dać klientowi fiszki „do powtórki teraz" i przyjąć ocenę, egzekwując własność i stan `accepted` — w konwencji istniejących tras.

**Contract**:
- `GET /flashcards/review` → 200 `{ cards: FlashcardDTO[], dueCount: number, acceptedCount: number }`.
  - `cards`: fiszki `user_id = ?` i `status = 'accepted'` i (`due_at IS NULL OR due_at <= ?`) z `?` = `toSqlDatetime(new Date())` (helper lokalny w trasie lub w `lib/srs.ts` — jeden format z `test/db.ts`), `ORDER BY COALESCE(due_at, created_at), id`, `LIMIT 20`; te same kolumny co `/proposals` (DTO `FlashcardDTO` — bez `status`, `user_id`, `is_variant`, kolumn SRS).
  - `dueCount`: liczba WSZYSTKICH do powtórki (bez limitu); `acceptedCount`: liczba `accepted` użytkownika.
- `POST /flashcards/:id/grade` z JSON `{ grade: 'again' | 'hard' | 'good' }`:
  - niepoprawny `id` → 400 `{ error }`; brak/niepoprawny `grade` lub nie-JSON → 400 `{ error: 'Niepoprawna ocena.' }` (bez dotykania D1);
  - odczyt `interval_days, ease, repetitions` z `WHERE id = ? AND user_id = ? AND status = 'accepted'` → brak wiersza = 404 `{ error: 'Fiszka nie istnieje.' }` (cudza / nieistniejąca / wciąż `proposed` — bez wyroczni);
  - `scheduleReview(state, grade, new Date())` → `UPDATE flashcards SET due_at = ?, interval_days = ?, ease = ?, repetitions = ?, reviewed_at = ? WHERE id = ? AND user_id = ? AND status = 'accepted'`; `changes === 0` → 404; sukces → 200 bez ciała (jak `accept`).
- Import `scheduleReview`, `isGrade` z `../lib/srs`. Komentarz nagłówkowy routera rozszerzony o S-05.

#### 2. Helpery harnessu

**File**: `api/test/db.ts`, `api/test/request.ts`, `api/test/dto.ts`

**Intent**: Testy ryzyk nie piszą SQL ani nie budują `Request` — zasiew stanu powtórek i wywołania tras żyją w helperach.

**Contract**:
- `db.ts`: `FlashcardRow` + `due_at: string | null; interval_days: number; ease: number; repetitions: number; reviewed_at: string | null`. `SeedFlashcardOptions` + opcjonalne `dueAt?: CreatedAt | null` (pominięte = kolumna DEFAULT `NULL`), `intervalDays?`, `ease?`, `repetitions?`. Nagłówek helpera: `dueAt` to druga (obok `createdAt`) dźwignia czasu po stronie SQL.
- `request.ts`: `getReview(env, token)`; `gradeFlashcard(env, token, id, body: unknown)` — `POST /flashcards/:id/grade` z `Content-Type: application/json` i `JSON.stringify(body)` (dowolne ciało, także wadliwe).
- `dto.ts`: komentarz, że `GET /flashcards/review` również zwraca `FlashcardDTO` (ten sam zbiór kluczy); bez nowego typu.

#### 3. Macierz 401

**File**: `api/src/middleware/auth.integration.test.ts`

**Intent**: T3.3 wymaga wiersza dla każdej trasy chronionej.

**Contract**: dwa wpisy w `PROTECTED_ROUTES`: `{ name: 'GET /flashcards/review', method: 'GET', path: () => '/flashcards/review' }` i `{ name: 'POST /flashcards/:id/grade', method: 'POST', path: ({ flashcardId }) => `/flashcards/${flashcardId}/grade`, body: () => JSON.stringify({ grade: 'good' }) }` — z nagłówkiem JSON: rozszerzyć `ProtectedRoute` o opcjonalne `headers?: Record<string, string>` przekazywane do `call` (albo ciało jako `Blob` z typem `application/json`); wybrać wariant najmniej inwazyjny, `expectGateHolds` bez zmiany asercji.

#### 4. Testy integracyjne

**File**: `api/src/routes/flashcards.integration.test.ts`

**Intent**: Dowód w kategoriach użytkownika: widzę do powtórki tylko swoje zaakceptowane fiszki, których pora nadeszła; ocena zmienia tylko moją fiszkę; zegar steruje „porą".

**Contract** — nowy `describe('S-05 / FR-011, FR-012: sesja powtórek')`, `afterEach(() => vi.useRealTimers())` jak w ryzyku #6:
- R2.1 `GET /flashcards/review`: Alice ma zaakceptowaną bez `due_at` (nowa), zaakceptowaną z `due_at` w przeszłości, zaakceptowaną z `due_at` jutro, propozycję; Bob zaakceptowaną bez `due_at` → `cards` = dokładnie dwie Alice (kolejność: przeszła `due_at` przed `NULL`? — NIE: sortowanie `COALESCE(due_at, created_at)` — zasiać `createdAt` tak, by kolejność była deterministyczna i asertować ją), każda o kluczach `FLASHCARD_DTO_KEYS`; `dueCount = 2`, `acceptedCount = 3`; `keysOf(body) = ['acceptedCount','cards','dueCount']`. Deliberate-breaks: usuń `status = 'accepted'` → propozycja na liście; usuń `user_id` → karta Boba.
- R2.2 zegar: fiszka z `due_at` = `2026-09-10 08:00:00`; `vi.setSystemTime('2026-09-10T07:59:00Z')` → nie na liście; `'2026-09-10T08:00:00Z'` → na liście (granica inkluzywna). Deliberate-break: `datetime('now')` w SQL zamiast bindu → wiersz „przed" zależny od realnego zegara → czerwony.
- R2.3 `POST /:id/grade` własność: cudza zaakceptowana → 404 `{ error }`, wiersz Boba równy migawce; własna `proposed` → 404 (nie w bazie nauki); nieistniejąca → 404; `grade: 'easy'` na własnej zaakceptowanej → 400 i wiersz nietknięty; ciało nie-JSON → 400.
- R2.4 ocena własnej: `vi.setSystemTime(T)`; `good` na nowej → 200 pusta odpowiedź, wiersz: `due_at = toSqlDatetime(T + 1 dzień)`, `repetitions = 1`, `interval_days = 1`, `reviewed_at = toSqlDatetime(T)`; potem `again` → `due_at = toSqlDatetime(T)`, `repetitions = 0`; po `again` karta ZNÓW jest w `GET /review` (wraca w sesji), po `good` nie ma jej (do jutra). Deliberate-break: `UPDATE` bez `user_id` → R2.3 czerwony; `again` z `due_at = jutro` → R2.4 czerwony.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `cd api && npm run typecheck`
- Cały zestaw testów API przechodzi (w tym macierz 401 z nowymi trasami): `cd api && npm test`

#### Manual Verification:

- Smoke przeciw `wrangler dev --port 3030`: po zaakceptowaniu propozycji `GET /flashcards/review` zwraca je z `dueCount`/`acceptedCount`; `POST /flashcards/:id/grade {"grade":"good"}` → 200 i fiszka znika z `review` (`due_at` jutro w D1); `{"grade":"again"}` → 200 i fiszka wraca.

---

## Phase 3: Ekran „Nauka" (front)

### Overview

Nowy tab i ekran sesji: karta PL→EN z odsłonięciem, trzy przyciski oceny, lokalna kolejka sesji (`again` wraca na koniec), optymistyczne oceny z rollbackiem, stany „pusta baza" i „na dziś wszystko".

### Changes Required:

#### 1. Klient API

**File**: `src/lib/api.ts`

**Intent**: Jedno miejsce wywołań tras sesji, w kształcie `flashcardsApi`.

**Contract**:
- `export type ReviewGrade = 'again' | 'hard' | 'good';`
- `export const reviewApi = { listDue(): Promise<{ cards: Flashcard[]; dueCount: number; acceptedCount: number }>, grade(id: number, grade: ReviewGrade): Promise<void> }` — `GET /flashcards/review`, `POST /flashcards/${id}/grade` z `body: JSON.stringify({ grade })`. Komentarz z kontraktem (DTO = `Flashcard`, jak `/proposals`).

#### 2. Karta powtórki

**File**: `src/components/review-card.tsx`

**Intent**: Czysta prezentacja jednej fiszki w sesji: pytanie po polsku, odsłonięcie angielskiego, trzy oceny.

**Contract**: `export function ReviewCard({ card, revealed, onReveal, onGrade }: { card: Flashcard; revealed: boolean; onReveal: () => void; onGrade: (grade: ReviewGrade) => void })`.
- Zawsze: badge typu (`TYPE_LABELS` — wynieść do wspólnego modułu, np. `src/constants/flashcards.ts`, i użyć w obu kartach, żeby nie duplikować), `back_pl` jako `subtitle`, podpis „Jak powiesz to po angielsku?".
- Nieodsłonięta: jeden szeroki przycisk „Pokaż odpowiedź" (`onReveal`).
- Odsłonięta: `front_en` wyróżniony, `example_en` kursywą gdy niepusty; trzy przyciski w rzędzie: „Nie umiem" (`REJECT_COLOR`-podobna czerwień), „Prawie" (bursztyn, np. `#F5A524`), „Umiem" (`ACCEPT_COLOR` zieleń); style i `Spacing` jak `flashcard-card.tsx`.

#### 3. Ekran sesji

**File**: `src/app/(app)/review.tsx`

**Intent**: Sesja nauki: pobierz fiszki do powtórki, oceniaj po jednej, `again` wraca na koniec, koniec sesji czytelny.

**Contract** (wzorzec `flashcards.tsx`: `useFocusEffect` → `load`, stany `loading`/`queue`):
- Stan: `queue: Flashcard[]`, `revealed: boolean`, `acceptedCount`, `dueCount`, `loading`, `sessionDone: number` (licznik ocenionych w tej sesji).
- `load()` przy fokusie: `reviewApi.listDue()` → `queue = cards`, liczniki; `revealed = false`.
- `grade(card, g)`: optymistycznie: `revealed = false`; `again` → karta na koniec kolejki; `hard`/`good` → zdjęta, `sessionDone++`; `reviewApi.grade(card.id, g).catch(...)` → rollback: karta wraca na początek (jeśli jej nie ma), `sessionDone` cofnięty dla `hard`/`good`.
- Render: nagłówek „Nauka" + podtytuł „Do powtórki: N" (N = długość kolejki); `loading` → spinner; `queue[0]` → `<ReviewCard key={current.id} …>`; pusta kolejka i `acceptedCount === 0` → „Brak fiszek w bazie nauki. Zaakceptuj propozycje w zakładce Fiszki."; pusta kolejka i `acceptedCount > 0` → „Na dziś wszystko powtórzone" (+ „Oceniono: sessionDone" gdy > 0).
- Reset odsłonięcia po ocenie jest jawny (`setRevealed(false)`), bo przy jednej karcie `again` zostawia ten sam `queue[0]`.

#### 4. Nawigacja

**File**: `src/components/app-tabs.tsx`, `src/components/app-tabs.web.tsx`

**Intent**: Trzeci tab „Nauka" (native + web) prowadzący do `/review`.

**Contract**: native — `<NativeTabs.Trigger name="review">` z etykietą „Nauka" i ikoną `explore.png` (`renderingMode="template"`); web — `<TabTrigger name="review" href="/review" asChild><TabButton>Nauka</TabButton></TabTrigger>`. Kolejność: Home, Fiszki, Nauka.

### Success Criteria:

#### Automated Verification:

- Lint frontu przechodzi: `npm run lint`
- Typecheck frontu przechodzi (typed routes obejmują `/review`): `npx tsc --noEmit`

#### Manual Verification:

- Na urządzeniu/emulatorze (API na 3030): tab „Nauka" pokazuje zaakceptowane fiszki; karta pokazuje polską stronę, „Pokaż odpowiedź" odsłania angielski i przykład, trzy przyciski oceniają.
- „Nie umiem" — karta wraca na koniec sesji (przy jednej karcie pojawia się ponownie, nieodsłonięta); „Prawie"/„Umiem" zdejmują kartę; po ostatniej: „Na dziś wszystko powtórzone".
- Pusta baza nauki → komunikat o akceptacji propozycji; po zaakceptowaniu propozycji w „Fiszki" i powrocie do „Nauka" fiszka jest w sesji.
- Po ponownym wejściu na tab karta oceniona „Umiem" nie wraca (do jutra), oceniona „Nie umiem" wraca. Web (`npm run web`): tab „Nauka" i sesja działają.

**Implementation Note**: Weryfikacja ręczna wymaga uruchomionego Workera lokalnie (port 3030) i przynajmniej jednej zaakceptowanej fiszki.

---

## Testing Strategy

### Unit Tests:

- `scheduleReview` — wyrocznie: `again` wraca natychmiast i zeruje serię; `good` 1 → 3 → rosnące; `hard` krócej niż `good`, nigdy nie cofa; ease z podłogą 1.3; brak mutacji; `isGrade`.

### Integration Tests:

- `GET /flashcards/review`: tylko własne `accepted` z porą ≤ teraz (`NULL` = od razu), DTO jako dokładny zbiór kluczy, liczniki, granica czasu inkluzywna, zegar JS steruje porą.
- `POST /flashcards/:id/grade`: 400 (ocena/ciało), 404 (cudza / `proposed` / brak) bez zmiany wierszy, 200 + wiersz zgodny z `scheduleReview` dla `good` i `again`; `again` wraca do listy, `good` znika.
- Macierz 401: dwie nowe trasy.

### Manual Testing Steps:

1. Zaloguj się, nagraj sytuację, zaakceptuj 2–3 propozycje w „Fiszki".
2. Tab „Nauka": podtytuł „Do powtórki: 3"; karta z polską stroną → „Pokaż odpowiedź" → angielski + przykład → oceń „Umiem".
3. Drugą oceń „Nie umiem" — wraca na koniec; po przejściu reszty pojawia się ponownie nieodsłonięta; oceń „Prawie".
4. Po ostatniej: „Na dziś wszystko powtórzone", licznik ocenionych.
5. Wyjdź i wróć na tab: lista pusta (wszystko na jutro) poza kartami ocenionymi „Nie umiem" (jeśli nie doceniono ich później).
6. Nowe konto bez fiszek: komunikat o akceptacji propozycji.

## Performance Considerations

- `GET /review` to dwa–trzy proste zapytania z indeksem `(user_id, status, due_at)` i `LIMIT 20`; ocena to jeden `SELECT` + jeden `UPDATE`. Skala PRD (`small`) — bez znaczenia.

## Migration Notes

- Migracja `0005_add_flashcard_review_state.sql` — addytywna, wymaga 0004. Stosować lokalnie (`--local`) i na produkcji (`wrangler d1 migrations apply my-english-day-db --remote`) PRZED deployem Workera z Fazy 2 (trasa czyta nowe kolumny). Brak backfillu: `due_at IS NULL` = wszystkie dotąd zaakceptowane fiszki wchodzą do pierwszej sesji.

## References

- Roadmap: `context/foundation/roadmap.md` (S-05, Stream C)
- PRD: `context/foundation/prd.md` (US-01, FR-010, FR-011, FR-012, Success Criteria secondary, Access Control)
- Test-plan: `context/foundation/test-plan.md` (§6.1, §6.2, ryzyko #3 macierz 401, ryzyko #6 zegar)
- Router i wzorzec własności: `api/src/routes/flashcards.ts`
- Harness: `api/test/db.ts` (`seedFlashcard`, `toSqlDatetime`), `api/test/request.ts`, `api/test/dto.ts`, `api/src/middleware/auth.integration.test.ts` (`PROTECTED_ROUTES`)
- Front wzorce: `src/app/(app)/flashcards.tsx`, `src/components/flashcard-card.tsx`, `src/components/app-tabs.tsx`, `src/components/app-tabs.web.tsx`, `src/lib/api.ts`
- Prerekwizyt: `context/archive/2026-06-07-gated-ai-flashcard-generation/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Warstwa danych i algorytm powtórek

#### Automated

- [x] 1.1 Typecheck przechodzi (`cd api && npm run typecheck`) — 661bd97
- [x] 1.2 Testy jednostkowe algorytmu przechodzą (`cd api && npx vitest run src/lib/srs.test.ts`) — 661bd97
- [x] 1.3 Cały zestaw API przechodzi na schemacie z migracji (`cd api && npm test`) — 661bd97

### Phase 2: Trasy sesji powtórek (API)

#### Automated

- [x] 2.1 Typecheck przechodzi (`cd api && npm run typecheck`) — 36b5456
- [x] 2.2 Cały zestaw testów API przechodzi, w tym macierz 401 z nowymi trasami (`cd api && npm test`) — 36b5456

#### Manual

- [ ] 2.3 Smoke przeciw `wrangler dev`: `GET /flashcards/review` + `POST /flashcards/:id/grade` (good znika do jutra, again wraca)

### Phase 3: Ekran „Nauka" (front)

#### Automated

- [x] 3.1 Lint frontu przechodzi (`npm run lint`) — 5102043
- [x] 3.2 Typecheck frontu przechodzi (`npx tsc --noEmit`) — 5102043

#### Manual

- [ ] 3.3 Tab „Nauka": karta PL→EN, „Pokaż odpowiedź", trzy oceny działają na urządzeniu/emulatorze
- [ ] 3.4 „Nie umiem" wraca na koniec sesji; „Prawie"/„Umiem" zdejmują; koniec sesji „Na dziś wszystko powtórzone"
- [ ] 3.5 Pusta baza → komunikat o akceptacji; po akceptacji w „Fiszki" fiszka pojawia się w „Nauka"
- [ ] 3.6 Po ponownym wejściu „Umiem" nie wraca, „Nie umiem" wraca; web działa

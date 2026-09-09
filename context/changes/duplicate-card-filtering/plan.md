# Filtrowanie duplikatów fiszek względem bazy użytkownika (S-04) Implementation Plan

## Overview

Nowe propozycje fiszek generowane z sytuacji (S-02/S-03) nie mogą dublować fiszek, które użytkownik już ma w swojej bazie (FR-008; guardrail PRD „fiszki nie mogą się dublować z istniejącą bazą użytkownika — duplikaty podważają zaufanie do AI"). Duplikat to **dokładnie to samo słowo/zwrot** (po normalizacji wielkości liter, białych znaków i interpunkcji brzegowej); synonimy i warianty są różnymi fiszkami i zostają. Filtr żyje **wyłącznie po stronie serwera, w warstwie zapisu** — między odpowiedzią generatora a atomowym `DB.batch` — i porównuje kandydatów z fiszkami użytkownika (propozycje ORAZ zaakceptowane) oraz między sobą w obrębie jednej odpowiedzi. To slice **S-04** (Stream B), równoległy do S-05.

## Current State Analysis

- **Generator** (`api/src/lib/flashcards.ts`): `generateFlashcards(transcript, apiKey)` zwraca `GeneratedCard[]` (max 10, walidacja kontraktu, odsiew pustych; pusta lista → rzut — guard zostaje tu celowo, komentarz w nagłówku pliku wprost odsyła do S-04: „zero kart po deduplikacji będzie odrębnym wynikiem warstwy zapisu").
- **Warstwa zapisu** (`api/src/routes/situations.ts`, `generateAndStoreFlashcards`): generowanie → `DB.batch([INSERT × n, UPDATE flashcards_status='done'])`; każdy błąd → `flashcards_status='failed'`; nigdy nie rzuca. Brak jakiegokolwiek porównania z bazą.
- **Dane**: `flashcards` (migracje 0003/0004) — `user_id`, `front_en`, `status` (`proposed`|`accepted`), `is_variant`; indeks `(user_id, status)`. Brak indeksu/kolumny znormalizowanej — na małej skali (PRD: `users: small`, ~10 kart/sytuację) pełny odczyt `front_en` użytkownika jest tani.
- **Testy** (harness workerd, `context/foundation/test-plan.md` §6): jednostkowe w `api/src/lib/*.test.ts`; integracyjne w `api/src/routes/situations.integration.test.ts` (`postAndFinish` + `mockOpenAI` + `seedFlashcard` z `frontEn`/`status`); T2.4 dowodzi „pusta lista z modelu → `failed`" — to pozostaje prawdą, bo dedup dzieje się PO generatorze.
- **Front**: `GET /flashcards/proposals` i ekran „Fiszki" — bez zmian; mniej propozycji to jedyny widoczny skutek.

### Key Discoveries:

- **Miejsce filtra jest przesądzone przez archiwum**: S-03 (`context/archive/2026-06-09-same-context-variants/plan.md`) i Faza 3 testów (`flashcards.ts` nagłówek; `flashcards.test.ts` T5.4) zaprojektowały generator tak, by dedup był oddzielnym krokiem warstwy zapisu, a „zero kart po dedupie" — legalnym wynikiem `done`. Plan to respektuje: generator nietknięty.
- **Zbiór odniesienia = propozycje + zaakceptowane**: propozycja czekająca na decyzję (wygenerowana z wcześniejszej sytuacji dnia) też jest „bazą" z perspektywy użytkownika — dublowanie jej w kolejce przeglądu to dokładnie to, co PRD nazywa mąceniem nauki. Odrzucone fiszki są kasowane (S-02), więc odrzucona wcześniej fraza MOŻE wrócić — zgodne z PRD (odrzucenie ≠ „mam to").
- **Dedup wewnątrz odpowiedzi**: model potrafi zwrócić tę samą frazę jako fiszkę bazową i wariant; pierwsza wygrywa (kolejność tablicy = kolejność zapisu, T5.12).
- **Atomowość zostaje**: filtr jest czystą funkcją na tablicy PRZED `DB.batch`; batch nadal „wszystko albo nic" (ryzyko #2). Odczyt `front_en` użytkownika to jedno dodatkowe `SELECT` przed batchem; jego błąd trafia w istniejący `catch` → `failed` (spójne z resztą zadania tła).
- **Izolacja**: zbiór odniesienia jest filtrowany po `user_id` — fiszka innego użytkownika o tej samej treści NIE jest duplikatem (Access Control PRD: zamknięte bazy).
- **Lekcje zespołu** (`context/foundation/lessons.md`): dev server zawsze na porcie 3030; format audio 3GP nie działa z Whisperem (dotyczy tylko weryfikacji ręcznej end-to-end).

## What We're NOT Doing

- **Brak zmian w prompcie/schemacie generatora** — nie wysyłamy bazy użytkownika do modelu (koszt tokenów, kruchość promptu; test-plan §7 celowo nie asertuje treści promptu). Dedup jest deterministyczny w kodzie.
- **Brak dopasowania rozmytego / semantycznego** — PRD: duplikat to tylko dokładna powtórka; synonimy, formy gramatyczne (`invoice`/`invoices`) i warianty zostają. Zbyt agresywny filtr jest ryzykiem nazwanym w roadmapie.
- **Brak migracji ani kolumny znormalizowanej / indeksu** — skala mała; normalizacja w kodzie przy zapisie.
- **Brak retroaktywnego czyszczenia** istniejących duplikatów w bazie.
- **Brak sygnału w UI** („odfiltrowano N duplikatów") ani zmiany DTO propozycji.
- **Brak porównania po `back_pl`** — tożsamość fiszki to angielska strona (to, czego użytkownik się uczy).

## Implementation Approach

Slice wyłącznie backendowy, bez migracji. Nowy moduł `api/src/lib/dedup.ts` z dwiema czystymi funkcjami: `normalizeFront(text)` (klucz porównania) i `filterDuplicates(cards, existingFronts)` (odsiew względem zbioru istniejących + wewnątrz partii, zachowanie kolejności). `generateAndStoreFlashcards` w `situations.ts` po `generateFlashcards` czyta `front_en` wszystkich fiszek użytkownika, filtruje kandydatów i zapisuje tylko unikalne; zero kart po filtrze to `flashcards_status='done'` bez INSERT-ów (legalny wynik: „nic nowego do nauki"). Testy: jednostkowe na wyroczni z PRD (FR-008) + integracyjne dowodzące skutku w bazie i w propozycjach (własne vs cudze, propozycje vs zaakceptowane, wewnątrz partii, same duplikaty).

## Phase 1: Klucz porównania i filtr duplikatów (czysta logika)

### Overview

Moduł normalizacji i filtrowania bez zależności od D1 — z testami jednostkowymi, których oczekiwania pochodzą z FR-008 (dokładna powtórka = duplikat; synonim/wariant = osobna fiszka), nie z implementacji.

### Changes Required:

#### 1. Moduł dedup

**File**: `api/src/lib/dedup.ts`

**Intent**: Jedno źródło definicji „to samo słowo/zwrot" dla warstwy zapisu (i przyszłych użyć, np. importu w v2).

**Contract**:
- `export function normalizeFront(text: string): string` — trim, `toLowerCase()`, zwinięcie ciągów białych znaków do jednej spacji, zdjęcie interpunkcji brzegowej (`.,!?;:"'` oraz cudzysłowów typograficznych) z początku i końca. NIE usuwa interpunkcji wewnętrznej ani apostrofów w środku (`don't` ≠ `dont` to nie jest przypadek, który rozstrzygamy; `I'm` zostaje `i'm`). Nie zmienia znaków diakrytycznych.
- `export function filterDuplicates<T extends { front_en: string }>(cards: readonly T[], existingFronts: Iterable<string>): T[]` — zwraca karty, których `normalizeFront(front_en)` nie występuje w znormalizowanym zbiorze `existingFronts` ani wcześniej w tej samej tablicy (pierwsze wystąpienie wygrywa). Zachowuje kolejność i tożsamość obiektów; nie mutuje wejścia. Czysta: brak I/O.
- Komentarz nagłówkowy w konwencji repo (PL, „dlaczego", odnośnik do FR-008 i S-04).

#### 2. Testy jednostkowe

**File**: `api/src/lib/dedup.test.ts`

**Intent**: Zakodować wyrocznię FR-008 niezależnie od implementacji — zmiana definicji duplikatu ma zaczerwienić test.

**Contract** (`describe('FR-008: duplikat = dokładnie to samo słowo/zwrot')`, wzorzec §6.1 test-planu, bez mocków):
- D1.1 identyczne `front_en` w bazie → odsiane; różnice tylko w wielkości liter / białych znakach / kropce lub znaku zapytania na końcu → nadal duplikat (`"Invoice"`, `" invoice "`, `"invoice."` vs istniejące `invoice`; `"Could you repeat that?"` vs `"could you repeat that"`).
- D1.2 synonim i wariant zostają: `receipt` vs istniejące `invoice`; `ask for a refund` vs `ask for an invoice`; formy (`invoices` vs `invoice`) zostają (brak dopasowania rozmytego — jawna asercja).
- D1.3 dedup wewnątrz partii: dwie karty `invoice` (bazowa + wariant, różne `type`) → zostaje pierwsza (tożsamość obiektu), kolejność reszty zachowana.
- D1.4 pusty zbiór istniejących → wszystkie karty przechodzą; wejście nie jest mutowane.
- Deliberate-break nazwany w komentarzu każdego testu (np. usuń `toLowerCase()` → D1.1 czerwony; porównuj `front_en` surowo → D1.1; zastąp `Set` sprawdzaniem `includes` po `type` → D1.3).

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `cd api && npm run typecheck`
- Testy jednostkowe dedup przechodzą: `cd api && npx vitest run src/lib/dedup.test.ts`

#### Manual Verification:

- (brak — faza czysto logiczna)

---

## Phase 2: Wpięcie filtra w zapis w tle + dowód integracyjny

### Overview

Zastosowanie filtra w `generateAndStoreFlashcards` względem fiszek użytkownika w D1, obsługa wyniku „zero nowych kart" jako `done`, testy integracyjne w harnessie workerd i aktualizacja komentarzy, które opisywały S-04 jako przyszłość.

### Changes Required:

#### 1. Warstwa zapisu

**File**: `api/src/routes/situations.ts`

**Intent**: Nie tworzyć duplikatów w bazie użytkownika, zachowując atomowość batcha, izolację po `user_id` i semantykę błędów zadania tła.

**Contract**: W `generateAndStoreFlashcards`, wewnątrz istniejącego `try`, po `generateFlashcards`:
1. `SELECT front_en FROM flashcards WHERE user_id = ?` (wszystkie statusy — propozycje i zaakceptowane) → lista istniejących frontów.
2. `const unique = filterDuplicates(cards, existingFronts)`.
3. `DB.batch([...unique.map(insert), UPDATE flashcards_status='done'])` — gdy `unique` jest puste, batch zawiera SAM `UPDATE` (sytuacja `done`, zero kart: legalny wynik „wszystko już masz"). Log `console.info` z liczbą odfiltrowanych, gdy > 0 (jedyna obserwowalność w projekcie to `wrangler tail`).
Błąd `SELECT` trafia w istniejący `catch` → `failed` (bez nowej gałęzi). Aktualizacja komentarza doc funkcji (gwarancje + krok dedup). Import z `../lib/dedup`.

#### 2. Aktualizacja komentarzy odsyłających do S-04

**File**: `api/src/lib/flashcards.ts`, `api/src/lib/flashcards.test.ts` (T5.4), `api/src/routes/situations.integration.test.ts` (T2.4)

**Intent**: Komentarze mówiące „po S-04 zero kart po dedupie BĘDZIE legalne" mają opisywać stan obecny, a niezmiennik T2.4 („model zwraca pustą listę → `failed`") ma zostać wyraźnie odróżniony od nowego wyniku „same duplikaty → `done` bez kart". Zero zmian w asercjach istniejących testów.

**Contract**: Tylko treść komentarzy (czas przyszły → teraźniejszy; odnośnik do `lib/dedup.ts` i testów D2.x). Żadna istniejąca asercja nie jest osłabiana.

#### 3. Testy integracyjne

**File**: `api/src/routes/situations.integration.test.ts`

**Intent**: Dowód skutku w kategoriach użytkownika (wiersze w D1, propozycje w API), nie odbicie implementacji — wzorzec §6.2 test-planu (dwóch użytkowników, ramię „cudze" i kontrolne „własne").

**Contract** — nowy `describe('S-04 / FR-008: nowe propozycje nie dublują bazy użytkownika')` z helperami pliku (`postAndFinish`, `readProposals`, `seedFlashcard`, `readFlashcards`, `readSituation`):
- D2.1 Alice ma zaakceptowaną `invoice` i propozycję `receipt`; model zwraca `Invoice` (bazowa), `receipt.` (wariant), `bank statement` → w D1 dla nowej sytuacji tylko `bank statement`; `flashcards_status='done'`; propozycje Alice = stara `receipt` + `bank statement` (dokładnie 2, bez drugiej `receipt`).
- D2.2 Bob ma zaakceptowaną `invoice`; Alice generuje `invoice` → karta Alice ZAPISANA (cudza baza nie jest zbiorem odniesienia); Bob nietknięty. Deliberate-break: usuń `WHERE user_id = ?` z odczytu zbioru odniesienia → czerwony.
- D2.3 model zwraca `invoice`, `INVOICE`, `receipt` (partia z powtórką) przy pustej bazie → 2 karty (`invoice` pierwsza, `receipt`), `type`/`is_variant` pierwszej zachowane.
- D2.4 wszystkie karty z odpowiedzi są już w bazie → zero nowych wierszy, `flashcards_status='done'` (NIE `failed`), `status='done'`, transkrypt zachowany, bucket pusty, `generatingCount: 0`, brak odrzuconej obietnicy w tle. Kontrast z T2.4 (pusta lista z modelu → `failed`) opisany w komentarzu.
- Deliberate-break wspólny: usuń wywołanie `filterDuplicates` → D2.1/D2.3/D2.4 czerwone.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `cd api && npm run typecheck`
- Cały zestaw testów API przechodzi: `cd api && npm test`

#### Manual Verification:

- Na `cd api && npx wrangler dev --port 3030` z realnym kluczem OpenAI: dwa nagrania tej samej sytuacji (np. „byłem w sklepie, kupiłem jabłka") — druga sytuacja daje w `flashcards` wyłącznie fronty, których nie było po pierwszej (`wrangler d1 execute my-english-day-db --local --command "SELECT situation_id, front_en FROM flashcards ORDER BY id"`), a `flashcards_status` obu sytuacji = `done`.
- Ekran „Fiszki": po drugiej sytuacji kolejka nie zawiera dwóch identycznych propozycji; akceptuj/odrzuć bez regresji.

**Implementation Note**: Faza wymaga realnego klucza OpenAI tylko dla weryfikacji ręcznej; wszystkie bramki automatyczne biegną na mocku.

---

## Testing Strategy

### Unit Tests:

- `normalizeFront` / `filterDuplicates` — wyrocznia z FR-008: dokładna powtórka (case/whitespace/interpunkcja brzegowa) = duplikat; synonimy, formy gramatyczne i warianty = osobne; dedup wewnątrz partii; brak mutacji.

### Integration Tests:

- Warstwa zapisu w workerd (mock OpenAI na krawędzi sieci): duplikat względem zaakceptowanych i propozycji → nie zapisany; cudza baza nie filtruje; powtórka w partii; same duplikaty → `done` z zerem kart (nie `failed`). Regresja: T2.x, T5.x, T3.x bez zmian.

### Manual Testing Steps:

1. Zaloguj się, nagraj sytuację A; poczekaj na `done`; zaakceptuj część propozycji, resztę zostaw.
2. Nagraj sytuację B o tej samej treści; poczekaj na `done`.
3. `SELECT` fiszek B: żaden `front_en` nie powtarza (po normalizacji) frontu z A — ani zaakceptowanego, ani wciąż proponowanego.
4. Ekran „Fiszki": brak dubli w kolejce; akceptacja/odrzucenie działają.
5. (Opcjonalnie) Wymuś przypadek „same duplikaty": nagraj B trzeci raz — `flashcards_status='done'`, zero nowych kart, ekran pokazuje „Brak fiszek do przejrzenia" zamiast błędu.

## Performance Considerations

- Jedno dodatkowe `SELECT front_en` na generowanie (w tle, `waitUntil`); przy skali PRD (`small`) setki–tysiące wierszy per user to pomijalny koszt. Gdy baza urośnie, opcją jest kolumna znormalizowana + `UNIQUE(user_id, front_norm)` — poza zakresem.
- Batch nie rośnie (≤ 10 INSERT + 1 UPDATE).

## Migration Notes

- Brak migracji i nowych bindingów. Istniejące duplikaty w bazie nie są ruszane.

## References

- Roadmap: `context/foundation/roadmap.md` (S-04, Stream B, równoległy do S-05)
- PRD: `context/foundation/prd.md` (FR-008, Guardrails, Business Logic, Access Control)
- Test-plan: `context/foundation/test-plan.md` (§6.1, §6.2, ryzyka #2/#3/#5)
- Generator i guard pustej listy: `api/src/lib/flashcards.ts` (nagłówek), `api/src/lib/flashcards.test.ts` (T5.4)
- Warstwa zapisu: `api/src/routes/situations.ts` (`generateAndStoreFlashcards`)
- Wzorzec testów: `api/src/routes/situations.integration.test.ts` (T2.4, T5.12), `api/test/db.ts` (`seedFlashcard`)
- Prerekwizyty (zarchiwizowane): `context/archive/2026-06-07-gated-ai-flashcard-generation/`, `context/archive/2026-06-09-same-context-variants/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Klucz porównania i filtr duplikatów (czysta logika)

#### Automated

- [x] 1.1 Typecheck przechodzi (`cd api && npm run typecheck`) — 11fcaba
- [x] 1.2 Testy jednostkowe dedup przechodzą (`cd api && npx vitest run src/lib/dedup.test.ts`) — 11fcaba

### Phase 2: Wpięcie filtra w zapis w tle + dowód integracyjny

#### Automated

- [x] 2.1 Typecheck przechodzi (`cd api && npm run typecheck`) — ad6ba00
- [x] 2.2 Cały zestaw testów API przechodzi (`cd api && npm test`) — ad6ba00
#### Manual

- [ ] 2.3 Druga sytuacja o tej samej treści zapisuje tylko fronty nieobecne po pierwszej; `flashcards_status='done'` dla obu
- [ ] 2.4 Ekran „Fiszki" bez dubli w kolejce; akceptuj/odrzuć bez regresji

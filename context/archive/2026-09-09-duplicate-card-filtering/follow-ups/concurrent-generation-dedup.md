# Follow-up: dedup nie jest atomowy między równoległymi generowaniami

**Źródło**: przegląd implementacji S-04, ustalenie F1 (`reviews/impl-review.md`).

## Problem

`generateAndStoreFlashcards` (`api/src/routes/situations.ts`) robi read-then-write: `SELECT front_en` → `filterDuplicates` → `DB.batch(INSERT…)`. Dwie sytuacje tego samego użytkownika nagrane w krótkim odstępie biegną w dwóch równoległych `waitUntil`; jeśli oba `SELECT` wykonają się przed którymkolwiek `INSERT`, ten sam front trafi do bazy dwa razy mimo filtra. Schemat (migracje 0003–0005) nie ma ograniczenia unikalności, więc D1 tego nie zatrzyma. Luka względem FR-008 („system nie tworzy duplikatów") — dziś dedup jest **best-effort** (dokumentacja w komentarzu funkcji).

## Opcje (bez wyboru)

- **A — `UNIQUE` w schemacie**: kolumna `front_norm TEXT` wypełniana `normalizeFront` przy INSERT + `UNIQUE(user_id, front_norm)` (nowa migracja; `ALTER ADD COLUMN` + `CREATE UNIQUE INDEX` są addytywne, ale wymagają backfillu istniejących wierszy i decyzji, co z historycznymi duplikatami) i `INSERT OR IGNORE`. D1 egzekwuje, filtr w kodzie zostaje jako szybka ścieżka. Uwaga: `OR IGNORE` w `DB.batch` nie łamie atomowości, ale „ile kart zapisano" trzeba czytać z `meta.changes`.
- **B — serializacja per użytkownik**: brak w stacku (Durable Objects / kolejka) — nieproporcjonalne do MVP.
- **C — accept-as-risk**: prawdopodobieństwo wymaga dwóch nagrań o tej samej treści w oknie kilku sekund generowania; skala `small`.

## Kiedy

Przy drugiej ścieżce zapisu fiszek (import, edycja) albo gdy ręczna weryfikacja wykaże duplikaty w bazie. Test w konwencji §6.2 (`it.fails` z odnośnikiem tutaj) możliwy dopiero, gdy harness pozwoli zsynchronizować dwa `waitUntil` na granicy `SELECT`/`INSERT`.

# Follow-up: `CHECK` na enumach `flashcards.type` (i pozostałych) — S-02 F2 bez wyboru

- **Źródło**: przegląd S-02 F2 ⚠️ „Brak CHECK constraint na enumach type/status"
  (`context/archive/2026-06-07-gated-ai-flashcard-generation/reviews/impl-review.md:37-54`,
  Fix A ⭐ „dodać CHECK w nowej migracji" / Fix B „accept-as-risk", **Decision: PENDING** od
  2026-06-07); badanie Fazy 3 wdrożenia testów §4 (zero `CHECK` w czterech migracjach —
  enumy żyją tylko w komentarzach SQL); `context/foundation/test-plan.md` §2 ryzyko #5
  („nieznany `type` … przecieka do bazy i UI").
- **Co domyka Faza 3 (`testing-llm-generator-contract`)**: walidator w parserze generatora
  (`parseGeneratedCards` + `assertGeneratedCard`, `api/src/lib/flashcards.ts`) odrzuca całą
  odpowiedź modelu, gdy którakolwiek karta ma `type` spoza `word | phrase | sentence`,
  `is_variant` nie-boolean albo brak/nie-string któregoś z `front_en`/`back_pl`/`example_en`.
  Jedyna dzisiejsza ścieżka zapisu `flashcards.type` to ten generator, więc przeciek z S-02 F2
  jest zamknięty **na tej ścieżce**. Dowody: T5.5 (parser, `'idiom'` w środku poprawnych →
  cała odpowiedź odrzucona) i T5.11 (integracja: `failed`, zero wierszy, `proposals: []`);
  ramię kontrolne T5.12 (mieszanka poprawnych typów zapisana 1:1).
- **Co zostaje** (blind spot walidatora): (1) zapis fiszek spoza generatora — dziś nie
  istnieje (`seedFlashcard` w testach i skrypt `test-flashcards.ps1` piszą wprost do D1, ale
  to nie kod produkcyjny); pojawi się, gdy S-04/S-05 dodadzą ręczną edycję lub import;
  (2) enumy `flashcards.status` (`proposed | accepted`), `situations.status`
  (`pending | done | failed`), `situations.flashcards_status` (j.w.) — bez `CHECK`, pisane
  literałami z kodu tras; (3) `flashcards.example_en TEXT` nullable (migracja 0003:14) mimo
  `required` w schemacie żądania i `string` w DTO — walidator gwarantuje `''` zamiast `NULL`
  tylko na ścieżce generatora; (4) wiersze już istniejące w produkcji, jeśli kiedykolwiek
  przeciekł `type` spoza trójki — nienaprawiane (poza zakresem Fazy 3).
- **Koszt, którego przegląd S-02 nie znał**: SQLite **nie wspiera** `ALTER TABLE … ADD
  CONSTRAINT`, więc `CHECK` na istniejącej tabeli nie jest addytywne (wbrew „addytywne CHECK
  to standard w SQLite", Confidence HIGH w F2). To przebudowa tabeli w jednej migracji:
  `CREATE TABLE flashcards_new (… type TEXT NOT NULL CHECK (type IN ('word','phrase','sentence')),
  … status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted')), …)` →
  `INSERT INTO flashcards_new SELECT … FROM flashcards` → `DROP TABLE flashcards` →
  `ALTER TABLE flashcards_new RENAME TO flashcards` → odtworzenie `idx_flashcards_user_status`
  i `idx_flashcards_situation` (migracja 0003) → kolumna `is_variant INTEGER NOT NULL DEFAULT 0`
  z 0004 w nowej definicji. `flashcards.situation_id REFERENCES situations(id)` — D1 egzekwuje
  FK, kolejność kroków i `PRAGMA foreign_keys` w migracji do sprawdzenia lokalnie. Deploy dotyka
  ryzyka #4 (dryf schematu): kolejność **migracja → deploy** z checklisty S-03; harness
  aplikuje migracje z `api/migrations/` automatycznie (`test/setup.ts`), więc T5.11/T5.12
  zobaczą skutek bez zmian w testach. Analogiczna przebudowa dla `situations`, jeśli `CHECK`
  ma objąć `status`/`flashcards_status`.
- **Opcje bez wyboru**:
  - **A — migracja 0005 z przebudową** (jak wyżej) + `example_en TEXT NOT NULL DEFAULT ''`
    (spójne z DTO i walidatorem). Siła: obrona w głębi niezależna od ścieżki zapisu i od
    walidatora; samodokumentacja schematu. Koszt: migracja nieaddytywna, okno deployu
    (ryzyko #4), backfill `example_en IS NULL → ''` przed `NOT NULL`. Blind spot: brak —
    istniejące wiersze zgodne z enumami (do sprawdzenia zapytaniem przed migracją).
  - **B — accept-as-risk**: walidator parsera jako jedyna obrona. Siła: zero pracy; T5.5/T5.11
    trzymają kontrakt na jedynej dzisiejszej ścieżce zapisu. Blind spot: przyszły zapis spoza
    generatora (ręczna edycja/import) omija walidator — wtedy ta decyzja musi wrócić.
- **Kryterium zamknięcia**: decyzja (A lub B) zapisana tutaj z datą. Przy A dodatkowo:
  migracja zaaplikowana lokalnie i zdalnie (kolejność jak wyżej), `cd api && npm test` zielone
  (T5.11/T5.12 bez zmian), deliberate-break „usuń sprawdzenie `type` z `assertGeneratedCard`"
  pada teraz na `CHECK` w D1 (`D1_ERROR: CHECK constraint failed`) zamiast przeciekać — czyli
  T5.11 „idiom" zostaje czerwony dla poprawki zdjętej z parsera **i** zielony z `CHECK`;
  wpis w `test-plan.md` §6.7. Przy B: jedno zdanie w §6.7 i w §7 („zapis spoza generatora
  nie istnieje — walidator parsera jest jedyną obroną").
- **Sugerowany moment**: **S-04** (filtr duplikatów — dotyka generatora i `situations.ts`,
  a „zero kart po deduplikacji" zmienia warstwę zapisu), albo `--refresh` planu testów, gdy
  pojawi się druga ścieżka zapisu fiszek (ręczna edycja/import). Nie realizować „przy okazji"
  w zmianie, która nie dotyka migracji.
- **Status**: otwarty (decyzja poza zmianą `testing-llm-generator-contract`; plan §„Czego
  NIE robimy": migracja 0005 celowo niepisana).

<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Filtrowanie duplikatów fiszek względem bazy użytkownika (S-04)

- **Plan**: `context/changes/duplicate-card-filtering/plan.md`
- **Zakres**: Faza 2 z 2 (pełny przegląd planu; commity `11fcaba..5b0a023`)
- **Data**: 2026-09-09
- **Werdykt**: ZAAKCEPTOWANY
- **Ustalenia**: 0 krytycznych, 1 ostrzeżenie, 4 obserwacje

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność z planem | PASS (19 MATCH, 0 DRIFT, 0 MISSING, 1 EXTRA nieszkodliwy — nadwyżkowe asercje) |
| Dyscyplina zakresu | PASS (wszystkie 6 pozycji „What We're NOT Doing" przestrzegane) |
| Bezpieczeństwo i jakość | WARNING (F1) |
| Architektura | PASS |
| Spójność wzorców | PASS (drobne obserwacje F2, F5) |
| Kryteria sukcesu | PASS (typecheck OK; `npm test` 89 zielonych + 5 `it.fails`; wiersze ręczne 2.3/2.4 oczekujące — brak podpisu na ślepo) |

## Ustalenia

### F1 — Dedup nie jest atomowy między równoległymi generowaniami tego samego użytkownika

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/src/routes/situations.ts:107-131
- **Szczegóły**: Read-then-write (`SELECT front_en` → filtr → `DB.batch`) bez `UNIQUE` w schemacie. Dwie sytuacje nagrane w krótkim odstępie biegną w równoległych `waitUntil`; oba `SELECT` przed którymkolwiek `INSERT` → ten sam front dwa razy mimo filtra. Plan i change.md milczały o współbieżności. Luka względem FR-008.
- **Poprawka A ⭐ Zalecana**: Udokumentować jako best-effort (komentarz doc + `follow-ups/concurrent-generation-dedup.md` z opcją `UNIQUE(user_id, front_norm)` + `INSERT OR IGNORE`).
  - Siła: Zero ryzyka regresji; decyzja o migracji z backfillem odłożona do drugiej ścieżki zapisu fiszek.
  - Kompromis: Luka zostaje w produkcji (prawdopodobieństwo: dwa nagrania o tej samej treści w oknie kilku sekund).
  - Pewność: HIGH — skala `small` z PRD; ten sam wzorzec follow-upu co `enum-check-migration.md`.
  - Martwy punkt: Nie zmierzono realnego okna równoległości `waitUntil` na produkcji.
- **Poprawka B**: Migracja `front_norm` + `UNIQUE` + `INSERT OR IGNORE` teraz.
  - Siła: D1 egzekwuje FR-008 niezależnie od kolejności zadań tła.
  - Kompromis: Backfill i decyzja o historycznych duplikatach; `meta.changes` zamiast liczby kart; poza zakresem planu („brak migracji").
  - Pewność: MEDIUM — wymaga nowego planu.
  - Martwy punkt: Zachowanie `OR IGNORE` w `DB.batch` nieprzetestowane w harnessie.
- **Decyzja**: FIXED via Fix A — komentarz w `generateAndStoreFlashcards` + follow-up zapisany.

### F2 — Test-plan nieaktualny po S-04

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: context/foundation/test-plan.md:228, 263, 265
- **Szczegóły**: §6.5 mówił „po S-04 … będzie" (czas przyszły); zaparkowana obserwacja „dedup powinien decydować o kolejności ucinania do 10" nie podjęta (dedup działa PO ucięciu w generatorze — duplikaty zajmują miejsca w limicie); follow-up `enum-check-migration.md` datowany na S-04 nierozstrzygnięty.
- **Poprawka**: §6.5 w czasie teraźniejszym z odnośnikami do D1.x/D2.x; nota o konwencji nazw testów slice'ów poza mapą ryzyk; jawna adnotacja, że kolejność ucinania pozostaje zaparkowana; `enum-check-migration.md` odłożony do `--refresh` (bez wyboru, jak dotąd).
- **Decyzja**: FIXED (edycje §6.5; `enum-check-migration.md` pozostaje otwarty — ACCEPTED jako zaparkowany).

### F3 — Regex `EDGE_RE` z flagą `g`

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/src/lib/dedup.ts:20-24
- **Szczegóły**: `.replace` z regexem `g` resetuje `lastIndex` (spec), zweryfikowane empirycznie; klasa znaków poprawna. Stanowość dotyczyłaby tylko `.test()/.exec()`, których nie ma. Brak błędu.
- **Poprawka**: Opcjonalny komentarz „używać tylko z `.replace`".
- **Decyzja**: SKIPPED — brak błędu; komentarz nagłówkowy już opisuje użycie.

### F4 — Przypadki brzegowe normalizacji

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/src/lib/dedup.ts:30-37
- **Szczegóły**: Wiodący apostrof zdejmowany (`'tis` → `tis`); front z samej interpunkcji (`...`) daje klucz `""` i kolejne takie karty są odsiewane jako duplikat. Marginalne, poza PRD.
- **Poprawka**: Bez działania; ewentualnie pominąć dedup przy pustym kluczu.
- **Decyzja**: ACCEPTED — poza PRD, zysk pomijalny.

### F5 — Nazewnictwo testów `S-04 / FR-008` + `D2.x`

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: api/src/routes/situations.integration.test.ts:557
- **Szczegóły**: §6.2 opisuje `describe('Ryzyko #N')` + `T<n>.<m>`; dedup nie ma ryzyka w §2, więc nazwa po slice/FR jest uzasadniona, ale była nieudokumentowana.
- **Poprawka**: Zapis konwencji w test-planie (patrz F2).
- **Decyzja**: FIXED via F2 (nota w §6.5).

## Kryteria sukcesu — dowody

- `cd api && npm run typecheck` → PASS.
- `cd api && npx vitest run src/lib/dedup.test.ts` → 4/4 PASS.
- `cd api && npm test` → 10 plików, 89 zielonych + 5 `it.fails` (oczekiwane) — PASS.
- Deliberate-breaks wykonane przy bramkach: bez `toLowerCase()` → D1.1/D1.2 czerwone; bez `filterDuplicates` → D2.1/D2.3/D2.4 czerwone (D2.2 zielony zgodnie z planem). Kod przywrócony.
- Ręczne 2.3, 2.4 — oczekujące (wymagają realnego klucza OpenAI i urządzenia).

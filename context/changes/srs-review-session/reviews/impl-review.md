<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Sesja powtórek (spaced repetition) z 3 przyciskami oceny (S-05)

- **Plan**: `context/changes/srs-review-session/plan.md`
- **Zakres**: Faza 3 z 3 (pełny przegląd planu; commity `661bd97..ca8dcd0`)
- **Data**: 2026-09-09
- **Werdykt**: WYMAGA UWAGI → po poprawkach ZAAKCEPTOWANY
- **Ustalenia**: 0 krytycznych, 5 ostrzeżeń, 10 obserwacji (+1 DRIFT niski, 2 EXTRA uzasadnione z Agenta 1)

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność z planem | PASS (27 MATCH, 1 DRIFT niski — `moreDue` zamiast `dueCount` w stanie ekranu, 0 MISSING, 2 EXTRA uzasadnione — `gradeFlashcardRaw`/`JSON_HEADERS`, komunikat „kolejna porcja") |
| Dyscyplina zakresu | PASS (wszystkie 7 pozycji „What We're NOT Doing" przestrzegane) |
| Bezpieczeństwo i jakość | WARNING (W1, W2, W3, W5) |
| Architektura | PASS |
| Spójność wzorców | WARNING (W4, W5; obserwacje O1–O10) |
| Kryteria sukcesu | PASS (typecheck OK; `npm test` 101 zielonych + 5 `it.fails` z S-04; lint/tsc frontu OK; ręczne 2.3, 3.3–3.6 oczekujące — smoke 2.3 udokumentowany w `smoke-phase2.md`) |

## Ustalenia

### W1 — Brak pułapu odstępu → zepsuty format `due_at`, potem 500

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/src/lib/srs.ts:89, api/src/routes/flashcards.ts:100-137
- **Szczegóły**: Trasa `grade` nie wymaga, by fiszka była należna, więc przez surowe API można oceniać `good` bez przerwy; po 17. `good` rok 10207 → `toISOString()` daje format rozszerzony `+010207…`, `+` sortuje się przed cyframi → fiszka „należna od razu" z zepsutym formatem; po 21. `RangeError` → 500 text/plain (brak `app.onError`).
- **Poprawka**: `MAX_INTERVAL_DAYS = 365` w `scheduleReview` + wyrocznia R1.5 w `srs.test.ts`.
- **Decyzja**: FIXED.

### W2 — Rollback nieudanej oceny może pokazać odpowiedź przed pytaniem

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: src/app/(app)/review.tsx:61-78
- **Szczegóły**: Po `grade(A)` użytkownik odsłania B; błąd sieci dla A wstawia A na początek, ale `revealed` zostaje `true` → A renderuje się odsłonięta.
- **Poprawka**: `setRevealed(false)` w `catch` rollbacku.
- **Decyzja**: FIXED.

### W3 — Wyścig `SELECT` → `UPDATE` w `grade` (last-writer-wins)

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/src/routes/flashcards.ts:114-129
- **Szczegóły**: Dwie równoległe oceny tej samej fiszki czytają ten sam stan; wynik zależy od kolejności. Po W5 pojedynczy ekran nie wyśle dwóch ocen naraz; luka dotyczy dwóch urządzeń.
- **Poprawka A ⭐ Zalecana**: Follow-up `follow-ups/concurrent-grade-race.md` (opcja: strażnik optymistyczny `AND repetitions = ? AND interval_days = ?` → 409, testowalny triggerem `BEFORE UPDATE`).
  - Siła: Spójne z decyzją F1 w S-04; bez nietestowanej ścieżki 409 w tym slice'ie.
  - Kompromis: Luka zostaje przy dwóch urządzeniach.
  - Pewność: HIGH — skala `small`, jeden klient.
  - Martwy punkt: Nie zmierzono, jak często użytkownik uczy się z dwóch urządzeń naraz.
- **Poprawka B**: Strażnik optymistyczny teraz + test z `withTrigger`.
  - Siła: Zamyka lukę.
  - Kompromis: Nowy kod statusu (409) w kontrakcie frontu bez obsługi w UI.
  - Pewność: MEDIUM.
  - Martwy punkt: Reakcja frontu na 409.
- **Decyzja**: ACCEPTED via Fix A — follow-up zapisany.

### W4 — R2.1 obiecuje „liczniki bez limitu", ale tego nie dowodzi

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: api/src/routes/flashcards.integration.test.ts:202-254
- **Szczegóły**: Tylko 2 należne fiszki — `LIMIT 20` nigdy nie tnie; `dueCount: results.length` przeszedłby na zielono; usunięcie `LIMIT` też.
- **Poprawka**: R2.5 z 21 należnymi fiszkami: `cards.length === 20`, `dueCount === 21`, `acceptedCount === 21`.
- **Decyzja**: FIXED.

### W5 — Ekran powtórek bez strażnika `decidedRef` z ekranu przeglądu

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: src/app/(app)/review.tsx:39-78
- **Szczegóły**: Refokus w trakcie żądania `good` podmienia kolejkę listą z serwera, która zwróci tę kartę ponownie → podwójna ocena (3 dni zamiast 1). `flashcards.tsx` chroni się `decidedRef`.
- **Poprawka**: `pendingRef` (add przed `reviewApi.grade`, delete w `finally`), filtr w `load()`.
- **Decyzja**: FIXED.

### O1 — Indeks `idx_flashcards_user_status` redundantny wobec `(user_id, status, due_at)`

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Architektura
- **Lokalizacja**: api/migrations/0005_add_flashcard_review_state.sql:27
- **Szczegóły**: Nowy indeks ma stary jako prefiks. `DROP INDEX` nie jest addytywny w tej migracji.
- **Poprawka**: `DROP INDEX` w przyszłej migracji.
- **Decyzja**: ACCEPTED — koszt pomijalny przy skali MVP.

### O2 — Martwy `key={current.id}` na bezstanowym `ReviewCard`

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: src/app/(app)/review.tsx:98
- **Poprawka**: Usunąć.
- **Decyzja**: FIXED.

### O3 — Stały komentarz DTO „z definicji `proposed`"

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: api/src/routes/flashcards.ts:32
- **Poprawka**: Komentarz obejmujący obie trasy (`proposed` / `accepted`, kolumny SRS nieeksponowane).
- **Decyzja**: FIXED.

### O4 — Kolory poza `Colors`, duplikat `#3c87f7`

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🔎 ŚREDNI
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: src/components/review-card.tsx:22-25
- **Szczegóły**: Precedens w `flashcard-card.tsx`; dług wzorca, nie nowa dewiacja.
- **Poprawka**: `Colors.*.accent/success/danger/warning` w obu kartach — follow-up.
- **Decyzja**: SKIPPED — poza zakresem zmiany; kandydat do osobnego porządku theming.

### O5 — Brak ról a11y; kontrast bursztynu ~2.0:1

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🔎 ŚREDNI
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: src/components/review-card.tsx:74-96
- **Szczegóły**: W całym `src/` brak atrybutów a11y — luka wzorca; istniejące kolory też poniżej AA.
- **Poprawka**: `accessibilityRole="button"` + ciemniejszy bursztyn — razem z O4.
- **Decyzja**: SKIPPED — do wspólnego follow-upu theming/a11y.

### O6 — `toSqlDatetime` zduplikowane (`lib/srs.ts` i `test/db.ts`)

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: api/src/lib/srs.ts:51, api/test/db.ts:83
- **Szczegóły**: Kopia w harnessie jest niezależną wyrocznią formatu DEFAULT kolumn (jak stałe testów w §6.1) — świadome.
- **Decyzja**: ACCEPTED.

### O7 — Brak noty lustrzanej dla trójki ocen

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: src/lib/api.ts:213, api/src/lib/srs.ts:22
- **Poprawka**: Komentarz „zmieniaj oba naraz" po obu stronach.
- **Decyzja**: FIXED.

### O8 — Nagłówek „Do powtórki" pokazuje porcję (≤20), nie `dueCount`

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: src/app/(app)/review.tsx:88
- **Decyzja**: ACCEPTED — komunikat „kolejna porcja" po sesji pokrywa przypadek >20; automatyczne doładowanie to kandydat do v2.

### O9 — Hono `c.req.json()` ignoruje `Content-Type`

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/src/routes/flashcards.ts:107
- **Decyzja**: ACCEPTED — łagodne, spójne z `routes/auth.ts`.

### O10 — Ciche błędy ocen (jak w `flashcards.tsx`)

- **Ważność**: 💬 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: src/app/(app)/review.tsx:72-77
- **Decyzja**: ACCEPTED — spójne z wzorcem; ewentualny wspólny follow-up dla obu ekranów.

## Kryteria sukcesu — dowody

- `cd api && npm run typecheck` → PASS; `cd api && npm test` → 11 plików, 101 + 5 `it.fails` (po poprawkach przeglądu: 103 + 5 `it.fails` — nowe R1.5, R2.5).
- `npm run lint`, `npx tsc --noEmit` → PASS (typed routes zregenerowane — `.expo/types/router.d.ts` jest gitignored; na świeżym checkout wymaga `expo start` lub `startTypescriptTypeGenerationAsync`).
- Deliberate-breaks przy bramkach: `again` → +1 dzień (R1.1 czerwony); `grade` bez własności (R2.3 czerwony). Kod przywrócony.
- Smoke 2.3 przeciw `wrangler dev --port 3030` z lokalnym D1: `smoke-phase2.md` (review/grade/again/400/401 zgodnie z planem). Wiersze ręczne 2.3, 3.3–3.6 pozostają dla człowieka.

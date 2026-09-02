<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Generowanie fiszek AI z akceptacją (S-02)

- **Plan**: context/changes/gated-ai-flashcard-generation/plan.md
- **Scope**: Fazy 1–4 z 4 (pełny plan)
- **Date**: 2026-06-09
- **Verdict**: APPROVED
- **Findings**: 0 critical · 2 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

**Notatka (zweryfikowane, NIE jest błędem):** `user_id` w tokenie to `string` (payload.sub), a kolumny `flashcards.user_id`/`situations.user_id` to `INTEGER`. Bindowanie stringa do kolumny INTEGER jest poprawne dzięki *column affinity* SQLite i jest tym samym wzorcem, który już działa w S-01 (`GET /situations`). Brak akcji.

**Success Criteria (uruchomione 2026-06-09):** `api && npm run typecheck` ✓ · `api && npm test` → 19/19 (w tym 5 flashcards) ✓ · front `npm run lint` ✓ · front `npx tsc --noEmit` → exit 0 ✓.

## Findings

### F1 — INSERT fiszek w pętli zamiast DB.batch (N+1)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Safety & Quality (wydajność)
- **Location**: api/src/routes/situations.ts:79-85
- **Detail**: Każda z ~3-5 fiszek zapisywana osobnym `INSERT ... .run()` w pętli `for` — N round-tripów do D1, bez atomowości. Wpływ realny, ale niski: małe N i kod w tle (`waitUntil`), poza ścieżką krytyczną.
- **Fix**: Przepisać na `env.DB.batch(cards.map(c => stmt.bind(...)))` — jeden round-trip + atomowość zestawu.
- **Decision**: PENDING

### F2 — Brak CHECK constraint na enumach type/status

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; warto się zastanowić
- **Dimension**: Safety & Quality (niezawodność / data safety)
- **Location**: api/migrations/0003_create_flashcards.sql:11,15
- **Detail**: Kolumny `type` (word|phrase|sentence) i `status` (proposed|accepted) bez `CHECK (... IN (...))`. `type` trafia z odpowiedzi LLM wprost do bazy. Structured Outputs (`strict:true`, enum) realnie gwarantuje kształt, więc ryzyko materializuje się tylko przy zmianie/awarii API OpenAI → na froncie `TYPE_LABELS[card.type]` = `undefined` (flashcard-card.tsx:45).
- **Fix A ⭐ Recommended**: Dodać CHECK w nowej migracji (0004).
  - Strength: Obrona w głębi + samodokumentacja; baza odrzuca śmieci niezależnie od LLM.
  - Tradeoff: Wymaga nowej migracji — 0003 już zaaplikowana.
  - Confidence: HIGH — addytywne CHECK to standard w SQLite.
  - Blind spot: Brak — istniejące wiersze zgodne z enumami.
- **Fix B**: Accept-as-risk — polegać na gwarancji Structured Outputs.
  - Strength: Zero pracy; `strict:true` realnie wymusza enum.
  - Tradeoff: Brak siatki bezpieczeństwa przy zmianie kontraktu API.
  - Confidence: MED — zależne od stabilności OpenAI.
  - Blind spot: Przyszłe zmiany modelu/fallbacku nieobjęte.
- **Decision**: PENDING

### F3 — Opcjonalny wskaźnik „generuję fiszki…" na Home pominięty

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — świadome pominięcie punktu oznaczonego „opcjonalnie"
- **Dimension**: Plan Adherence
- **Location**: src/app/(app)/index.tsx
- **Detail**: Faza 4 pkt 4 (jawnie „Opcjonalnie") przewidywał wskaźnik przy `status='done'` + `flashcards_status='pending'`. Pole jest dostępne w `LocalSituation`, ale ekran go nie renderuje. Punkt opcjonalny — dopuszczalne pominięcie, nie drift.
- **Fix**: Brak wymaganej akcji; ewentualnie follow-up, jeśli feedback „zajrzyj do Fiszek" okaże się potrzebny.
- **Decision**: PENDING

### F4 — generatingCount liczy tylko dzień bieżący (granica północy)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — świadoma decyzja udokumentowana komentarzem
- **Dimension**: Safety & Quality (niezawodność)
- **Location**: api/src/routes/flashcards.ts:46-47
- **Detail**: COUNT generujących ma filtr `date(created_at) = date('now')` (EXTRA poza literą planu, uzasadniony: osierocony `pending` z poprzednich dni nie blokuje ekranu). Skutek uboczny: sytuacja nagrana o 23:59, generowanie kończone o 00:01, przestaje być liczona jako „generuję". Akceptowalne dla MVP; front ma twardy limit pollingu (~90 s).
- **Fix**: Brak akcji — świadomy tradeoff spójny z `GET /situations`.
- **Decision**: PENDING

### F5 — Polling bez guarda in-flight (możliwe nakładanie load())

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — nieszkodliwe; opcjonalne dopieszczenie
- **Dimension**: Safety & Quality (niezawodność)
- **Location**: src/app/(app)/flashcards.tsx:84-97
- **Detail**: Interval (POLL_MS=2500) poprawnie czyszczony w cleanup (brak wycieku), twardy limit ~90 s działa (POLL_LIMIT_MS, reset przy postępie). Brak guarda in-flight `load()`: przy sieci wolniejszej niż 2,5 s mogą wystartować równoległe GET-y. Nieszkodliwe (ostatni `setQueue` wygrywa).
- **Fix**: Opcjonalnie dodać `isLoadingRef` guard, by pominąć tick gdy poprzedni `load()` trwa.
- **Decision**: PENDING

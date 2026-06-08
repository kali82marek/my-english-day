<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Przechwytywanie sytuacji głosem (S-01)

- **Plan**: context/changes/capture-situation-by-voice/plan.md
- **Scope**: Wszystkie 4 fazy (pełny plan)
- **Date**: 2026-06-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 4 warnings · 2 observations

## Automated verification (uruchomione na nowo)

- ✅ `api && npm run typecheck` — przechodzi
- ✅ `api && npm test` — 14/14 testów zielonych
- ✅ `tsc --noEmit` (front) — przechodzi
- ✅ `npm run lint` (front, expo lint) — czysto

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

**Plan Adherence**: sub-agent dryfu potwierdził MATCH na wszystkich pozycjach P1.1–P4.4 — zero DRIFT / MISSING / EXTRA. Kontrakty subtelne (R2 delete dopiero po UPDATE; `audio_key`/`user_id` nie wyciekają do klienta; orphan-cap 60 s; FormData zachowuje `Authorization`) zachowane.
**Scope Discipline**: jeden nieplanowany plik `api/scripts/smoke-situations.ps1` (skrypt smoke-testu) wspiera strategię testów z planu — benign.

## Findings

### F1 — „Lista dnia" liczy dzień w UTC, nie w strefie użytkownika

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (correctness)
- **Location**: api/src/routes/situations.ts:151
- **Detail**: `WHERE date(created_at) = date('now')` porównuje dwie daty UTC. Dla PL (UTC+1/+2) między lokalną północą a 01:00–02:00 zapytanie zwraca jeszcze „wczoraj" UTC, a nagrania z późnego wieczora mogą wpaść w zły dzień. To rdzeń funkcji „sytuacje dnia". Ten sam wzorzec jest w samym planie (linia 146) — to też luka planu, nie tylko implementacji.
- **Fix A ⭐ Recommended**: Front przekazuje granice lokalnego dnia (lub offset), serwer filtruje po zakresie [start_dnia, koniec_dnia).
  - Strength: Poprawne dla każdej strefy; bez hardkodu Europe/Warsaw.
  - Tradeoff: Drobna zmiana kontraktu GET (query param) + front.
  - Confidence: HIGH — standardowy wzorzec dla „dziś" w aplikacji mobilnej.
  - Blind spot: Trzeba zdecydować, czy ufać zegarowi klienta.
- **Fix B**: Hardkod offsetu Europe/Warsaw po stronie serwera.
  - Strength: Zero zmian na froncie.
  - Tradeoff: Łamie się dla użytkownika w innej strefie / przy DST.
  - Confidence: MED — działa dopóki userbase jest wyłącznie w PL.
  - Blind spot: Przejścia DST (marzec/październik).
- **Decision**: PENDING

### F2 — Brak obsługi błędów R2.put / D1.INSERT w ścieżce POST

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: api/src/routes/situations.ts:119-127
- **Detail**: `AUDIO_BUCKET.put` i `INSERT ... RETURNING` nie są w try/catch. Awaria R2/D1 → generyczny 500 Hono bez polskiego `{ error }` (łamie konwencję z auth.ts). Dodatkowo jeśli `INSERT` rzuci (zamiast zwrócić null), sprzątanie R2 z linii 131 się nie wykona → osierocony plik w buckecie. Ścieżka null (129-133) jest obsłużona, ścieżka wyjątku nie.
- **Fix**: Owinąć put+insert w try/catch; w catch spróbować `AUDIO_BUCKET.delete(audioKey)` i zwrócić `c.json({ error: 'Nie udało się zapisać sytuacji.' }, 500)`.
- **Decision**: PENDING

### F3 — Osierocony `pending` nigdy nie jest uzgadniany po stronie serwera

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: api/src/routes/situations.ts:82-86, 148-156
- **Detail**: `catch` w `transcribeAndFinalize` flipuje na 'failed' tylko jeśli sam UPDATE się powiedzie. Eviction Workera / timeout `waitUntil` / błąd UPDATE-failed → wiersz zostaje 'pending' w D1 na stałe. Front maskuje to klienckim ORPHAN_MS (60 s), ale GET nadal zwraca 'pending', więc po restarcie aplikacji stary 'pending' wraca i wznawia polling w nieskończoność. Plan świadomie wybrał `waitUntil` jako wystarczające dla MVP, ale uzgodnienia rekordu w DB nie zaprojektował.
- **Fix A ⭐ Recommended**: W GET / traktować `pending` starsze niż ~2 min jako 'failed' (warunek wieku w SELECT lub mapowanie w toDTO).
  - Strength: Naprawia źródło — front nie dostaje wiecznego pending, polling sam wygasa, zgodnie z istniejącym ORPHAN_MS.
  - Tradeoff: Próg czasu trzeba dobrać do realnego czasu Whispera.
  - Confidence: HIGH — czysto serwerowa, mała zmiana w jednym SELECT.
  - Blind spot: Bardzo wolna transkrypcja (>2 min) zostałaby uznana za błąd — limit 120 s nagrania to ogranicza.
- **Fix B**: Zaakceptować jako znane ograniczenie MVP (zapis do lessons).
  - Strength: Zero kodu; zgodne z „waitUntil wystarcza dla MVP".
  - Tradeoff: Realny scenariusz osieroconego wiersza zostaje w bazie.
  - Confidence: MED — akceptowalne dopóki eviction jest rzadki.
  - Blind spot: Skala — przy większym ruchu pendingów przybywa.
- **Decision**: PENDING

### F4 — DELETE: niezabezpieczone R2.delete blokuje usunięcie wiersza

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: api/src/routes/situations.ts:177-182
- **Detail**: `AUDIO_BUCKET.delete(row.audio_key)` jest await-owany bez try/catch. Jeśli rzuci, `DELETE FROM situations` poniżej się nie wykona — użytkownik nie może usunąć sytuacji (DB jest źródłem prawdy dla listy).
- **Fix**: Owinąć R2.delete w try/catch (log + kontynuuj), żeby usunięcie wiersza z D1 zawsze doszło do skutku.
- **Decision**: PENDING

### F5 — Niestandardowy MIME `audio/m4a` zamiast `audio/mp4`

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (correctness)
- **Location**: src/components/record-button.tsx:44-47
- **Detail**: `type: audio/${ext}` daje `audio/m4a`; poprawny MIME m4a to `audio/mp4`. Whisper i tak wykrywa po rozszerzeniu `.m4a` (preset HIGH_QUALITY = AAC/MPEG-4, zgodny z lekcją o formatach), więc transkrypcja działa; jedynie R2 contentType jest niestandardowy (plik tymczasowy). Lekcja o formatach audio Whisper zachowana.
- **Fix**: Zmapować rozszerzenie→MIME jawnie (m4a → audio/mp4).
- **Decision**: PENDING

### F6 — `duration_ms` bez ograniczenia zakresu

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (correctness)
- **Location**: api/src/routes/situations.ts:106-111
- **Detail**: Parsowanie akceptuje dowolny skończony int, w tym ujemne i absurdalne wartości (brak górnego limitu wzgl. 120 s nagrania). Metadana tylko do wyświetlania, niskie ryzyko.
- **Fix**: Odrzucić/zaciąć ujemne i wartości > ~120000 ms.
- **Decision**: PENDING

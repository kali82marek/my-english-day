# Warianty fiszek w obrębie tego samego kontekstu (S-03) — Plan Brief

> Full plan: `context/changes/same-context-variants/plan.md`

## What & Why

Po fiszkach bazowych generowanych z transkryptu sytuacji (S-02) dokładamy **warianty** — rozszerzenia ściśle w obrębie tego samego kontekstu (ten sam sklep/rozmowa, podmienione detale: inny produkt, inna kwota, inne pytanie). Realizuje FR-007, którego PRD nazywa „kluczową wartością": warianty uczą elastyczności językowej, nie papugowania jednej frazy.

## Starting Point

S-02 jest wdrożony i dostarcza pełny pipeline: `generateFlashcards()` (jedno wywołanie gpt-4o ze Structured Outputs) wpięte w `waitUntil` po transkrypcji, tabela `flashcards` (proposed/accepted), ekran przeglądu z kolejką propozycji. Nic z tego nie rozróżnia fiszek bazowych od wariantów.

## Desired End State

Ta sama sytuacja generuje teraz fiszki bazowe ORAZ ~2-3 warianty w obrębie jej kontekstu, zapisane jako zwykłe propozycje z serwerową flagą `is_variant`. Użytkownik przegląda je w tej samej kolejce co dotąd (warianty wmieszane niewidocznie). Front pozostaje bez zmian — slice jest wyłącznie backendowy.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Strategia generowania | Jedno wywołanie LLM (rozszerzony prompt + schemat) | Zero dodatkowego kosztu/latencji; pipeline `waitUntil` nietknięty | Plan |
| Model danych | Kolumna `is_variant` (migracja 0004) | Odróżnia pochodzenie pod pomiar i przyszłe S-04, addytywnie | Plan |
| Liczba wariantów | AI dobiera ~2-3 (uboga sytuacja → mniej) | Naturalne dopasowanie, ogranicza zalanie przeglądu i koszt | Plan |
| UX przeglądu | Wmieszane niewidocznie | Najmniejszy slice; jednorodne doświadczenie przeglądu | Plan |
| Ekspozycja `is_variant` | Tylko server-side (poza DTO) | Spójne z „UX niewidoczne"; front bez zmian, brak martwego pola | Plan |
| Weryfikacja | Strukturalna + manualna ocena jakości | Pasuje do MVP/małej skali; observability nie istnieje w stacku | Plan |

## Scope

**In scope:**
- Migracja `0004` — kolumna `is_variant` w `flashcards`.
- Rozszerzenie typu `GeneratedCard`, schematu Structured Outputs i system promptu o warianty + flagę.
- Zapis `is_variant` w INSERT generowania w tle.
- Aktualizacja testów generatora.

**Out of scope:**
- Osobny ekran/sekcja wariantów, oznaczanie w UI, regeneracja na żądanie, edycja.
- Filtrowanie duplikatów (S-04), drugie wywołanie LLM, nowe endpointy, instrumentacja akceptacji.

## Architecture / Approach

Wyłącznie backend. Jeden prompt instruuje model, by po fiszkach bazowych (z tego, co opisano) dodał ~2-3 warianty w tym samym kontekście, oznaczając każdą kartę `is_variant`. Schemat Structured Outputs (`strict: true`) wymusza obecność flagi. Zapis w tle dokłada kolumnę do INSERT (`card.is_variant ? 1 : 0`). Cykl `flashcards_status`, kasowanie R2, DTO i cały front zostają bez zmian.

## Phases at a Glance

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Warstwa danych | Migracja 0004 — kolumna `is_variant` (addytywna) | Wymaga wdrożonej migracji 0003 z S-02 |
| 2. Generowanie wariantów | Prompt + schemat + zapis flagi + testy | Warianty wychodzą poza kontekst lub powielają bazowe — łapane manualną oceną jakości |

**Prerequisites:** S-02 (wdrożony — `flashcards`, generator, wpięcie w tle).
**Estimated effort:** ~1 sesja, 2 fazy, backend-only.

## Open Risks & Assumptions

- Jakość wariantów zależy od promptu — ryzyko wyjścia poza kontekst lub dosłownego powielenia bazowych; weryfikowane manualną oceną, nie automatem.
- Liczba wariantów niedeterministyczna (AI dobiera) — zakładamy, że ~2-3 nie zaleją przeglądu; brak twardego `minItems`/`maxItems` w schemacie.
- Pomiar akceptacji wariantów (Kryterium ≥70% w rozbiciu na typ) odłożony — kolumna `is_variant` to umożliwia później, ale instrumentacja jest poza zakresem.

## Success Criteria (Summary)

- Po transkrypcji sytuacja ma w `flashcards` fiszki bazowe (`is_variant=0`) i ~2-3 warianty (`is_variant=1`).
- Warianty trzymają się tego samego kontekstu (podmienione detale), nie są oderwane ani nie powielają dosłownie fiszek bazowych.
- Brak regresji: `GET /flashcards/proposals` bez pola `is_variant`, ekran „Fiszki" i akceptuj/odrzuć działają jak w S-02.

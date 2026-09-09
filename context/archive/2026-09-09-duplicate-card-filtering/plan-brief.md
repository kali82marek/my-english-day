# Filtrowanie duplikatów fiszek względem bazy użytkownika (S-04) — Plan Brief

> Full plan: `context/changes/duplicate-card-filtering/plan.md`

## What & Why

Nowe propozycje fiszek nie mogą dublować fiszek, które użytkownik już ma (FR-008; guardrail PRD: „duplikaty podważają zaufanie do AI i mącą naukę"). Duplikat to dokładnie to samo słowo/zwrot — po normalizacji wielkości liter, białych znaków i interpunkcji brzegowej; synonimy, formy gramatyczne i warianty (S-03) są osobnymi fiszkami i zostają.

## Starting Point

Pipeline S-02/S-03 generuje ≤10 kart na sytuację (jedno wywołanie LLM) i zapisuje je atomowo w tle (`DB.batch`). Generator celowo odrzuca pustą listę z modelu (`failed`), a archiwum S-03 i Faza 3 testów zaprojektowały go tak, by dedup był oddzielnym krokiem warstwy zapisu. Dziś nic nie porównuje kandydatów z bazą.

## Desired End State

Po wygenerowaniu kart serwer odsiewa te, których front (po normalizacji) już istnieje w bazie użytkownika (propozycje + zaakceptowane) lub powtórzył się w tej samej odpowiedzi. Zapisane zostają tylko unikalne; gdy nic nowego nie zostaje, sytuacja kończy się `done` bez kart (nie `failed`). Użytkownik w kolejce „Fiszki" nigdy nie widzi tej samej frazy dwa razy. Front bez zmian.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Definicja duplikatu | Dokładna równość `front_en` po normalizacji (case, whitespace, interpunkcja brzegowa) | PRD FR-008: tylko dokładna powtórka; rozmyte dopasowanie usunęłoby wartościowe warianty | PRD / Plan |
| Zbiór odniesienia | Fiszki użytkownika o statusie `proposed` ORAZ `accepted` | Dublowanie propozycji w kolejce mąci naukę tak samo jak dublowanie bazy; odrzucone są kasowane, więc mogą wrócić | Plan |
| Miejsce filtra | Warstwa zapisu (`generateAndStoreFlashcards`), przed `DB.batch`; generator nietknięty | Decyzja z archiwum S-03 i Fazy 3 testów; zachowuje atomowość i kontrakt generatora | Archiwum / Plan |
| Zero kart po filtrze | `flashcards_status='done'`, brak INSERT-ów | „Wszystko już masz" to sukces, nie awaria; odróżnione od T2.4 (pusta lista z modelu → `failed`) | Plan |
| Prompt | Bez zmian; baza nie jest wysyłana do modelu | Koszt tokenów, kruchość promptu; deterministyczny filtr w kodzie | Plan |
| Izolacja | Odniesienie filtrowane po `user_id` | Access Control PRD: zamknięte bazy; cudza fiszka nie jest duplikatem | PRD |
| Dane | Bez migracji i indeksu | Skala `small`; jedno `SELECT front_en` w tle jest tanie | Plan |

## Scope

**In scope:**
- `api/src/lib/dedup.ts` (`normalizeFront`, `filterDuplicates`) + testy jednostkowe na wyroczni FR-008.
- Wpięcie w `api/src/routes/situations.ts` + testy integracyjne (własne/cudze, propozycje/zaakceptowane, partia, same duplikaty).
- Aktualizacja komentarzy odsyłających do S-04 jako przyszłości.

**Out of scope:**
- Dopasowanie rozmyte/semantyczne, porównanie po `back_pl`, zmiany promptu/schematu, migracje, retroaktywne czyszczenie bazy, sygnał w UI, zmiany DTO.

## Architecture / Approach

Czysta funkcja `filterDuplicates(cards, existingFronts)` z kluczem `normalizeFront`. Zadanie tła po `generateFlashcards` czyta `front_en` wszystkich fiszek użytkownika, filtruje i zapisuje w istniejącym `DB.batch` (INSERT × unikalne + UPDATE `done`; pusta partia = sam UPDATE). Błąd odczytu trafia w istniejący `catch` → `failed`.

## Phases at a Glance

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Klucz porównania i filtr | `lib/dedup.ts` + testy jednostkowe (wyrocznia FR-008) | Zbyt agresywna normalizacja zjadająca warianty — pilnowane jawnymi asercjami „zostaje" |
| 2. Wpięcie w zapis + dowód integracyjny | Filtr w tle, `done` bez kart, testy D2.1–D2.4, komentarze | Regresja atomowości / izolacji — pilnowane przez istniejące T2.x/T3.x i D2.2 |

**Prerequisites:** S-02, S-03 (wdrożone i zarchiwizowane); harness workerd z Fazy 1 testów.
**Estimated effort:** ~1 sesja, 2 fazy, backend-only.

## Open Risks & Assumptions

- Normalizacja nie obejmuje form gramatycznych ani interpunkcji wewnętrznej — świadomie (PRD); użytkownik może dostać `invoice` i `invoices` jako dwie fiszki.
- Zakładamy, że model rzadko zwraca wyłącznie duplikaty; jeśli często, użytkownik zobaczy „Brak fiszek" po nagraniu — sygnał do ewentualnego follow-upu z promptem świadomym bazy.
- Brak pomiaru odsetka odfiltrowanych (tylko log w `wrangler tail`).

## Success Criteria (Summary)

- Druga sytuacja o tej samej treści zapisuje wyłącznie fronty nieobecne w bazie użytkownika; identyczne fronty innego użytkownika nie filtrują.
- Same duplikaty → `done` bez nowych kart, nigdy `failed`; transkrypt i sprzątanie R2 jak dotąd.
- Cały zestaw testów API zielony; kolejka „Fiszki" bez dubli, akceptuj/odrzuć bez regresji.

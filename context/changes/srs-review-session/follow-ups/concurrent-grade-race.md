# Follow-up: równoległe oceny tej samej fiszki (last-writer-wins)

**Źródło**: przegląd implementacji S-05, ustalenie W3 (`reviews/impl-review.md`).

## Problem

`POST /flashcards/:id/grade` (`api/src/routes/flashcards.ts`) czyta stan (`SELECT interval_days, ease, repetitions`), liczy `scheduleReview` i zapisuje `UPDATE`. Dwie równoległe oceny tej samej fiszki (np. podwójne tapnięcie przy wolnej sieci, dwa urządzenia) czytają ten sam stan bazowy — wygrywa ostatni zapis, wynik zależy od kolejności (`again` + `good` → losowo „od razu" albo „za 1 dzień"). Strażnik `meta.changes === 0` łapie tylko zniknięcie wiersza. Klient ma strażnik `pendingRef` (po W5), więc pojedynczy ekran nie wyśle dwóch ocen naraz; luka dotyczy dwóch urządzeń.

## Opcje (bez wyboru)

- **A — strażnik optymistyczny**: `UPDATE … WHERE … AND repetitions = ? AND interval_days = ?` z wartości odczytanych; `changes === 0` → 409 `{ error: 'Fiszka została już oceniona.' }` (albo 404 — ten sam kontrakt co dziś). Tani; test wymaga wstrzyknięcia zmiany stanu między `SELECT` a `UPDATE` (trigger `BEFORE UPDATE` zmieniający `repetitions` — możliwe w harnessie przez `withTrigger`).
- **B — accept-as-risk**: jeden użytkownik, ocena po jednej; skutek ograniczony do własnej fiszki i jednego odstępu.

## Kiedy

Przy pracy nad wieloma urządzeniami / synchronizacją albo gdy zgłoszenia pokażą „fiszka wróciła mimo Umiem".

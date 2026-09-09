# Sesja powtórek (spaced repetition) z 3 przyciskami oceny (S-05) — Plan Brief

> Full plan: `context/changes/srs-review-session/plan.md`

## What & Why

Użytkownik uczy się z zaakceptowanych fiszek w sesji powtórek: aplikacja pokazuje polską stronę, użytkownik przypomina sobie angielski, odsłania odpowiedź i ocenia jednym z trzech przycisków — Nie umiem / Prawie / Umiem (FR-011, FR-012). Domyka to pętlę US-01 i drugorzędne Kryterium sukcesu („uczy się codziennie z fiszek").

## Starting Point

Fiszki mają status `proposed`/`accepted` i nic więcej; brak stanu powtórek, tras sesji i ekranu nauki. Router `/flashcards` z konwencją własności (404 bez wyroczni), harness workerd z macierzą 401, front z dwoma tabami (Home, Fiszki) i ekranem-kolejką propozycji.

## Desired End State

Trzeci tab „Nauka": sesja z fiszkami, których pora nadeszła (nowo zaakceptowane od razu), karta PL→EN z odsłonięciem i trzema ocenami; „Nie umiem" wraca w tej samej sesji, „Prawie"/„Umiem" odkładają fiszkę o rosnące odstępy liczone na serwerze. Stan powtórek żyje przy fiszce w D1 (dostępny z każdego urządzenia).

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Algorytm | Uproszczony SM-2 na 3 oceny: `again` → od razu, `good` 1 → 3 → ×ease dni, `hard` krótszy krok i niższy ease | PRD wybiera 3 przyciski jako złoty środek; SM-2 to sprawdzony, prosty model odstępów | PRD / Plan |
| Miejsce stanu | Kolumny na `flashcards` (`due_at`, `interval_days`, `ease`, `repetitions`, `reviewed_at`) | Konto w chmurze (Access Control); bez osobnej tabeli historii w MVP | Plan |
| „Pora" dla nowych | `due_at IS NULL` = do powtórki od razu | `ALTER ADD COLUMN` nie przyjmuje `datetime('now')`; `accept` bez zmian, zero backfillu | Plan |
| Porównanie czasu | `now` bindowane z JS (format DEFAULT kolumn), nie `datetime('now')` w SQL | Testy sterują zegarem JS; spójne z kierunkiem follow-upu ryzyka #6 | Test-plan / Plan |
| Kierunek nauki | PL → EN z odsłonięciem | Persona chce „umieć powiedzieć"; jeden kierunek = prosty ekran | PRD / Plan |
| Sesja | Lokalna kolejka na kliencie z `again` na koniec; serwer oddaje do 20 „do powtórki teraz" | Najprostszy model; serwer i tak trzyma `due_at = now` po `again` | Plan |
| Do sesji wchodzą | Wyłącznie `accepted` | FR-010: baza nauki = zaakceptowane | PRD |
| Puste stany | `acceptedCount` w odpowiedzi rozróżnia „pusta baza" od „na dziś wszystko" | Bez tego ekran myliłby nowego użytkownika | Plan |
| Testy frontu | Brak; lint + tsc + ręcznie | Test-plan §4/§7 — świadomie poza wdrożeniem | Test-plan |

## Scope

**In scope:**
- Migracja 0005 + `lib/srs.ts` + testy jednostkowe.
- `GET /flashcards/review`, `POST /flashcards/:id/grade` + helpery harnessu + testy integracyjne + macierz 401.
- Front: `reviewApi`, ekran `review.tsx`, `ReviewCard`, tab „Nauka" (native + web), wspólne `TYPE_LABELS`.

**Out of scope:**
- 4 przyciski / kroki w minutach / leech / fuzz, konfiguracja algorytmu, statystyki, nauka z propozycji, edycja w sesji, kierunek EN→PL, TTS, powiadomienia, testy frontu, tabela historii.

## Architecture / Approach

Dane → API → UI. `scheduleReview(state, grade, now)` to czysta funkcja; trasa `grade` czyta stan z własnością i zapisuje wynik jednym `UPDATE`; trasa `review` zwraca `FlashcardDTO[]` (ten sam kształt co propozycje) z `dueCount`/`acceptedCount`. Ekran „Nauka" trzyma kolejkę sesji, ocenia optymistycznie z rollbackiem, resetuje odsłonięcie po każdej ocenie.

## Phases at a Glance

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Dane i algorytm | Migracja 0005, `srs.ts`, testy R1.x | Źle dobrane odstępy — wyrocznie w planie, korekta liczb to jedna funkcja |
| 2. Trasy API | `review` + `grade`, helpery, testy R2.x, macierz 401 | Własność / wyciek kolumn SRS do DTO — pilnowane przez R2.x i `keysOf` |
| 3. Ekran „Nauka" | `reviewApi`, `ReviewCard`, `review.tsx`, tab | Stan odsłonięcia przy `again` na jednej karcie — jawny reset po ocenie |

**Prerequisites:** S-02 (zaakceptowane fiszki), harness workerd; do weryfikacji ręcznej — Worker na 3030 i ≥1 fiszka w bazie nauki.
**Estimated effort:** ~2 sesje, 3 fazy (backend 2, front 1).

## Open Risks & Assumptions

- Liczby algorytmu (1/3/×ease, −0.15/−0.20, podłoga 1.3) to decyzja planu, nie PRD — retencja weryfikowana użyciem; zmiana = edycja `srs.ts` + wyroczni.
- `again` z `due_at = now` sprawia, że nieukończona sesja „wisi" do następnego wejścia — zamierzone (jak kroki nauki Anki), ale może zaskoczyć.
- Ikona taba „Nauka" tymczasowo współdzielona z „Fiszki" (`explore.png`).
- Migracja 0005 musi wejść na produkcję przed deployem Workera z Fazy 2.

## Success Criteria (Summary)

- Zaakceptowane fiszki pojawiają się w „Nauka" od razu; sesja PL→EN z odsłonięciem i trzema ocenami działa na telefonie i web.
- „Nie umiem" wraca w sesji, „Umiem" odkłada na jutro i dalej (rosnące odstępy), „Prawie" krócej niż „Umiem"; stan trwa między urządzeniami.
- Cały zestaw API zielony (własność, DTO, zegar, macierz 401); lint i typecheck frontu zielone.

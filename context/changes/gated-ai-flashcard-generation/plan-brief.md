# Generowanie fiszek AI z akceptacją (S-02) — Plan Brief

> Full plan: `context/changes/gated-ai-flashcard-generation/plan.md`

## What & Why

Po stranskrybowaniu sytuacji (S-01) system **automatycznie w tle** generuje z transkryptu angielskie fiszki (AI dobiera typy: słówko / zwrot / zdanie, ~3-5 na sytuację). Wieczorem użytkownik przegląda propozycje w zakładce „Fiszki" i każdą akceptuje lub odrzuca; zaakceptowane trafiają do bazy nauki. To **gwiazda przewodnia** roadmapy — pierwszy moment, w którym da się zmierzyć główne Kryterium sukcesu PRD („≥70% fiszek akceptowanych bez poprawek").

## Starting Point

W kodzie jest tylko **F-01** (auth: `requireAuth`, tabela `users`, klient `apiFetch`, routing chroniony, 2 taby: Home + placeholder `explore`). **S-01 ma zatwierdzony plan, ale NIE jest zaimplementowany** — brak tabeli `situations`, routera `/situations`, transkrypcji. S-02 buduje na kontrakcie S-01 (tabela `situations`, funkcja `transcribeAndFinalize` w `waitUntil`) — to twardy prerekwizyt.

## Desired End State

Użytkownik z nagranymi i stranskrybowanymi sytuacjami otwiera zakładkę „Fiszki" i widzi gotowe propozycje: angielski front, polskie tłumaczenie, typ i (gdy sensowny) przykład EN. Przegląda je pojedynczo — Akceptuj (→ baza nauki) lub Odrzuć (→ kasacja). W trakcie generowania widać stan „generuję…" z auto-odświeżaniem; po wyczerpaniu — stan pusty. Dane izolowane per-użytkownik, trwałe w D1.

## Key Decisions Made

| Decision | Choice | Why (1 zdanie) | Source |
| --- | --- | --- | --- |
| Wyzwalanie generowania | Auto po transkrypcji (w tle) | Fiszki gotowe wieczorem bez dodatkowego tapnięcia (PRD) | Plan |
| Lifecycle wywołania LLM | `c.executionCtx.waitUntil` + polling | Spójne z S-01, brak wiszącego żądania, działa dla wielu sytuacji | Plan |
| Zakres wywołania | Jedno wywołanie LLM na sytuację | Czyste zakotwiczenie każdej fiszki w jednej sytuacji | Plan |
| Limit fiszek | Miękki ~3-5, AI dobiera typy/liczbę | Chroni przed zalaniem przeglądu (obawa PRD) | Plan |
| Pola fiszki | EN + PL + typ + przykład EN | Standard fiszki, przykład podnosi trafność → wspiera ≥70% | Plan |
| Model danych | Jedna tabela `flashcards` + `status` | Prosto; baza nauki = wiersze `accepted` (grunt pod S-05) | Plan |
| Śledzenie generowania | Kolumna `situations.flashcards_status` | Jednoznaczny polling + idempotencja (`pending`→`done`/`failed`) | Plan |
| Los odrzuconych | DELETE wiersza | Decyzja użytkownika; mała, czysta tabela | Plan |
| UX przeglądu | Jedna karta naraz + przyciski | Skupiona decyzja na fiszkę (FR-009), dostępne | Plan |
| Nawigacja | Nowy tab „Fiszki" (zamiast `explore`) | Odkrywalny, wieczorny flow naturalnie idzie do zakładki | Plan |
| Model LLM | gpt-4o + Structured Outputs | Wyższa jakość → szansa na ≥70% od razu; wymuszony kształt JSON | Plan |

## Scope

**In scope:** generowanie fiszek w tle po transkrypcji (gpt-4o + Structured Outputs), tabela `flashcards`, kolumna `flashcards_status` na `situations`, endpointy proposals/accept/reject, tab „Fiszki" z przeglądem jedna-karta-naraz, polling w trakcie generowania, stany puste/błędu.

**Out of scope:** filtrowanie duplikatów (S-04), warianty kontekstu (S-03), sesja powtórek/SRS (S-05), edycja fiszek, ekran bazy nauki, ręczny przycisk „generuj", regeneracja, przechowywanie odrzuconych.

## Architecture / Approach

Generowanie wpięte w `transcribeAndFinalize` z S-01: po `status='done'`, w tym samym `waitUntil`, `generateFlashcards(transcript)` (gpt-4o, wymuszony `json_schema`) → `INSERT` fiszek (`proposed`) + `UPDATE situations SET flashcards_status='done'`; błąd → `failed` (transkrypt zostaje). Router `/flashcards`: `GET /proposals` (propozycje + `generatingCount`), `POST /:id/accept`, `DELETE /:id`. Front w zakładce „Fiszki" pobiera propozycje, renderuje pojedynczo z przyciskami i odpytuje dopóki `generatingCount>0` (z twardym limitem wieku). Reużywa `requireAuth`, wzorzec raw-SQL z `auth.ts`, `apiFetch`, themed components.

## Phases at a Glance

| Phase | Co dostarcza | Główne ryzyko |
| --- | --- | --- |
| 1. Warstwa danych (Worker) | Tabela `flashcards` + `ALTER situations` | `ALTER` wymaga istniejącej tabeli `situations` (S-01) |
| 2. Generowanie + endpointy (API) | Klient LLM, wpięcie w `transcribeAndFinalize`, router `/flashcards` | Sprzężenie z niezaimplementowanym S-01; jakość/koszt gpt-4o |
| 3. Klient API + typy (front) | `flashcardsApi`, typ `Flashcard`, rozszerzony `Situation` | Spójność typów z API |
| 4. Ekran przeglądu + nawigacja (front) | Tab „Fiszki", ekran jedna-karta-naraz, polling | Orkiestracja stanu generowania/optymistyczne akcje |

**Prerequisites:** **S-01 (`capture-situation-by-voice`) zaimplementowane i wdrożone** (tabela `situations`, `transcribeAndFinalize`, `OPENAI_API_KEY` w `Bindings`), F-01 (gotowe), klucz OpenAI lokalnie (`.dev.vars`).
**Estimated effort:** ~3-4 sesje, 4 fazy (2 backend, 2 front).

## Open Risks & Assumptions

- **Twarda zależność od S-01:** Faza 2 wpina się w `transcribeAndFinalize`, który powstaje w S-01. Bez wdrożonego S-01 nie ma się w co wpiąć — S-01 musi iść pierwszy.
- **Jakość vs Kryterium ≥70%:** gpt-4o + prompt to punkt startowy; jeśli akceptacja < 70%, iterować prompt (model w jednym miejscu, łatwa podmiana).
- **Koszt:** „jedno wywołanie na sytuację" × gpt-4o rośnie liniowo z liczbą sytuacji; miękki limit ~3-5 ogranicza rozmiar odpowiedzi; fallback `gpt-4o-mini`.
- **Osierocone `flashcards_status='pending'`** (ubity/przekroczony `waitUntil`) — front musi mieć twardy limit wieku pollingu (~90 s), inaczej „generuję…" w nieskończoność.
- **`example_en` dla typu `sentence`** bywa redundantny — dopuszczamy pusty string (ukrywany w UI).

## Success Criteria (Summary)

- Po transkrypcji sytuacji w zakładce „Fiszki" pojawia się ~3-5 trafnych propozycji (US-01, FR-006).
- Każdą fiszkę da się zaakceptować (→ baza nauki, `accepted`) lub odrzucić (→ kasacja) (FR-009, FR-010).
- Propozycje izolowane per-użytkownik; stan generowania czytelny i samonaprawialny (brak wiecznego „generuję").

# Przechwytywanie sytuacji głosem (S-01) — Plan Brief

> Full plan: `context/changes/capture-situation-by-voice/plan.md`

## What & Why

Zalogowany użytkownik nagrywa po polsku przeżytą sytuację jednym naciśnięciem; system zapisuje ją natychmiast, transkrybuje w tle (bez kroku edycji) i pokazuje na liście sytuacji dnia. To slice S-01 — pierwsze ogniwo Streamu A na drodze do gwiazdy przewodniej S-02 (generowanie fiszek). Bez zapisanych sytuacji nie ma z czego generować fiszek, więc ten slice odblokowuje cały rdzeń produktu.

## Starting Point

F-01 dał kompletny szkielet auth: routing chroniony (`Stack.Protected`), sesja w `expo-secure-store`, klient `apiFetch` z `Bearer`, Worker Hono z `requireAuth` i tabelą `users`. Ekran główny `(app)/index.tsx` to placeholder. Brak audio, R2, jakiejkolwiek integracji OpenAI i tabel produktowych — to wszystko dokłada S-01.

## Desired End State

Użytkownik otwiera ekran główny, naciska duży przycisk, mówi po polsku, a po zatrzymaniu sytuacja **natychmiast** (< 1 s) pojawia się na liście dnia ze stanem „transkrybuję…", który w kilka sekund zmienia się w gotowy transkrypt. Może nagrać dowolną liczbę sytuacji i usunąć błędne swipe'em. Dane izolowane per-użytkownik, trwałe w D1.

## Key Decisions Made

| Decision | Choice | Why (1 zdanie) | Source |
| --- | --- | --- | --- |
| Architektura transkrypcji | Optymistyczny zapis + `ctx.waitUntil` | Natychmiastowe potwierdzenie zapisu bez złożoności Queues | Plan |
| Przechowywanie audio | R2 tymczasowo, cleanup po sukcesie | Umożliwia ponowienie przy błędzie, bez trwałego kosztu storage | Plan |
| Obsługa błędu transkrypcji | Fail fast → „nagraj ponownie" | Brak status-machine w UI; prostota MVP | Plan |
| Próg NFR | Potwierdzenie **zapisu** < 1 s | Maksymalnie chroni nawyk; transkrypt dociąga później | Plan |
| Struktura ekranu | Jeden ekran: nagraj + lista dnia | Jedno tapnięcie do nagrania, zero nawigacji | Plan |
| Zakres listy | Tylko dzisiejsze sytuacje | Zgodne z roadmapą, trywialny query, mało danych | Plan |
| Interakcje | Lista + usuwanie (swipe) | Kasowanie pomyłkowych nagrań przy nagrywaniu w biegu | Plan |
| Długość nagrania | Min ~1 s, max ~120 s (auto-stop) | Chroni guardrail szybkości i koszt Whisper | Plan |
| Biblioteka audio | `expo-audio` | `expo-av` usunięte w SDK 54+ | Plan |

## Scope

**In scope:** nagrywanie głosem (uprawnienia, min/max), upload multipart, optymistyczny zapis, transkrypcja Whisper w tle (`pl`), tabela `situations`, R2 na audio (tymczasowo), endpointy create/list/delete, ekran nagrywania + lista dnia ze swipe-delete.

**Out of scope:** generowanie fiszek (S-02), edycja transkryptu, trwałe audio/odtwarzanie, retry-z-listy, historia sprzed dziś, ekran szczegółów, Queues/Durable Objects.

## Architecture / Approach

`POST /situations` (multipart) zapisuje audio do R2, wstawia wiersz `situations` ze `status='pending'` i natychmiast zwraca 201. W tym samym wywołaniu `c.executionCtx.waitUntil(...)` transkrybuje przez Whisper: sukces → `UPDATE transcript, status='done'` + `DELETE` z R2; błąd → `status='failed'` (audio zostaje). Front pokazuje listę dnia, optymistycznie wstawia wiersz `pending` i krótko odpytuje `GET /situations`, dopóki istnieją `pending`. Reużywa `requireAuth`, wzorzec raw-SQL z `auth.ts`, `apiFetch` (z obsługą `FormData`) i themed components.

## Phases at a Glance

| Phase | Co dostarcza | Główne ryzyko |
| --- | --- | --- |
| 1. Warstwa danych + storage (Worker) | Tabela `situations`, binding R2, typy | Konfiguracja R2 / migracja D1 |
| 2. Endpointy + transkrypcja (API) | create/list/delete + Whisper proxy + `waitUntil` | Cykl życia R2 vs `waitUntil`; jakość/latencja Whisper |
| 3. Nagrywanie + klient API (front) | `expo-audio`, hook, `situationsApi` + FormData | Uprawnienia mikrofonu, format audio na SDK 56 |
| 4. Ekran nagrywania + lista (front) | Przepisany `(app)/index.tsx`, swipe-delete, polling | Orkiestracja stanu pending/optymistyczny wiersz |

**Prerequisites:** F-01 (gotowe), klucz OpenAI dostępny lokalnie (`.dev.vars`), bucket R2 utworzony, urządzenie/symulator z mikrofonem.
**Estimated effort:** ~3-4 sesje, 4 fazy (2 backend, 2 front).

## Open Risks & Assumptions

- **Latencja Whisper vs odczucie „kilka sekund":** transkrypt dociąga w tle; jeśli regularnie > kilkanaście sekund, rozważyć komunikat postępu lub model szybszy (`gpt-4o-mini-transcribe`).
- **Drobna nadmiarowość decyzji:** „fail fast → nagraj ponownie" + „R2 zostaje przy błędzie" oznacza zachowany plik bez wpiętego UI ponowienia — świadomy hak na przyszłość; rozważyć późniejszy cron-cleanup osieroconych `failed`.
- **Optymistyczny wiersz lokalny** musi zostać spójnie zastąpiony realnym z odpowiedzi 201 (uniknąć duplikatu na liście).
- **Kompatybilność `expo-audio`** z SDK 56 i formatem akceptowanym przez Whisper — zweryfikować w Fazie 3.
- Próg NFR „kilka sekund" pozostaje jakościowy dla transkryptu (twardy < 1 s dotyczy zapisu) — Open Roadmap Question #1.

## Success Criteria (Summary)

- Nagranie → widoczny wiersz `pending` < 1 s → transkrypt po kilku sekundach (US-01, NFR).
- Dowolna liczba sytuacji dnia zapisywana i listowana, izolowana per-użytkownik (FR-005).
- Błędne nagranie da się usunąć; nieudana transkrypcja czytelnie prosi o ponowienie.

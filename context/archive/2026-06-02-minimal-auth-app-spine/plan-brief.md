# Minimalny auth i uwierzytelniony szkielet aplikacji — Plan Brief

> Full plan: `context/changes/minimal-auth-app-spine/plan.md`

## What & Why

Fundament F-01 z roadmapy: rejestracja/logowanie (email+hasło), trwała sesja do wylogowania, routing chroniony i uwierzytelniony klient API. To enabler — odblokowuje S-01 (`capture-situation-by-voice`) i gwiazdę przewodnią S-02. Bez tożsamości użytkownika i wywołań API z tokenem żaden slice produktowy nie ruszy.

## Starting Point

Worker Hono ma tylko `GET /health` (`api/src/index.ts`), D1 `my-english-day-db` jest podpięte ale puste (0 tabel, brak migracji). Front to Expo Router z ekranami szablonu (`src/app/`), bez auth, stanu sesji i klienta API. Sekret `JWT_SECRET` ustawiony, ale niewpięty w typy. CORS już dopuszcza `Authorization`.

## Desired End State

Na świeżym urządzeniu: założenie konta → auto-login → chroniony ekran „Witaj, <email>" z Wyloguj. Restart aplikacji utrzymuje sesję (token w secure-store). Niezalogowany na trasie chronionej jest przekierowany na logowanie. Wszystkie wywołania API niosą `Authorization: Bearer <jwt>`, Worker odrzuca żądania bez ważnego tokenu.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Niezalogowany użytkownik | Redirect na logowanie | Najprostszy standardowy guard; zamyka Open Question #2 | Plan |
| Model sesji | Długożyjący JWT, bez refresh | Wprost realizuje „sesję permanentną" FR-002 minimalnym kosztem | Plan |
| Platforma weryfikacji | Natywnie (iOS/Android) | Zgodne z celem produktu (telefon, TestFlight) i secure-store | Plan |
| Testy | Jednostkowe na rdzeniu (hash+JWT) | Chronią najłamliwszy, bezpieczeństwo-krytyczny kod bez pełnego harnessu | Plan |
| Zakres szkieletu | Bramka + ekran główny placeholder + wylogowanie | Demonstrowalny szkielet, nadal minimum | Plan |
| Po rejestracji | Auto-login | Zero tarcia, zgodne z guardrailem szybkości PRD | Plan |
| Schemat DB | Tylko tabela `users` | Brak spekulacji nad schematem nieistniejących danych | Plan |
| Walidacja | Lekka, spójna front+API | Blokuje śmieci/kolizje email bez przeciążania UX | Plan |
| Struktura tras | Grupy `(auth)`/`(app)`, minimalna przebudowa | Root renderuje dziś wprost taby; ekran auth potrzebuje miejsca poza nimi — bez usuwania `explore` | Plan (review) |
| Źródło API URL | `app.json` `extra.apiBaseUrl` | Front musi wiedzieć, gdzie jest Worker; zależne od celu natywnego | Plan (review) |
| Hashowanie | PBKDF2 (Web Crypto) | Workers nie ma bcrypta; natywne, bez zależności | Plan (research) |
| JWT | `hono/jwt` | Wbudowane sign/verify+middleware, bez zewnętrznej biblioteki | Plan (research) |

## Scope

**In scope:** tabela `users` + pierwsza migracja D1; hashowanie PBKDF2; JWT sign/verify + middleware; endpointy `register`(auto-login)/`login`/`me`; secure-store sesji; AuthProvider; uwierzytelniony klient API; ekrany logowania/rejestracji; redirect guard; chroniony ekran główny placeholder; testy jednostkowe rdzenia.

**Out of scope:** reset/zmiana hasła, weryfikacja email, OAuth, role/admin, refresh tokeny/serwerowe sesje, tabele danych produktowych, web jako platforma docelowa, pełny harness testowy, CI/CD.

## Architecture / Approach

Dwie warstwy. **Worker (Hono):** migracja D1 → `lib/password.ts` + `lib/jwt.ts` (rdzeń) → `routes/auth.ts` + `middleware/auth.ts` → montaż w `index.ts`. **Front (Expo):** `lib/session.ts` (secure-store) + `lib/api.ts` (fetch z tokenem, URL z `app.json` `extra.apiBaseUrl`) → `contexts/auth-context.tsx` (stan `loading/authenticated/unauthenticated`). Wymaga przebudowy drzewa tras: dziś root renderuje wprost tab-navigator (`AppTabs`), więc Phase 4 zamienia root na `Stack`/`Slot` z grupą publiczną `(auth)` (login/register) i chronioną `(app)` (przeniesione `index`/`explore` + `AppTabs`); bramka redirectuje wg statusu. Token JWT przepływa: login/register → secure-store → każdy `apiFetch` → middleware Workera.

## Phases at a Glance

| Faza | Dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Dane + prymitywy (Worker) | Migracja `users`, hash PBKDF2, JWT helpery + testy | Poprawność hashowania na edge bez Node crypto |
| 2. Endpointy + middleware (API) | register/login/me + bramka JWT | Wycieki w komunikatach błędów (enumeracja email) |
| 3. Sesja + klient (front) | secure-store, AuthProvider, klient API | secure-store nie działa na web — graceful fallback |
| 4. Ekrany + routing (front) | przebudowa tras (`(auth)`/`(app)`), logowanie/rejestracja, guard, ekran główny | Przebudowa drzewa tras + mignięcie logowania w stanie `loading` |

**Prerequisites:** sekret `JWT_SECRET` ustawiony (jest); dostęp do D1 (binding `DB` jest); symulator iOS/Android do weryfikacji. Brak prerekwizytów kodowych (F-01 jest pierwsze).
**Estimated effort:** ~2–3 sesje, 4 fazy (Worker → API → front infra → front UI).

## Open Risks & Assumptions

- PBKDF2 — dobór iteracji: kompromis koszt CPU Workera vs opór na brute-force.
- Długożyjący JWT: wykradziony token ważny do wylogowania (świadomie akceptowane w MVP solo).
- `expo-secure-store` nie jest jeszcze w zależnościach — dochodzi w Phase 3; na web wymaga ostrożnego owinięcia.
- Stan `loading` sesji musi blokować redirect, inaczej zalogowany użytkownik widzi mignięcie ekranu logowania.
- Phase 4 przebudowuje drzewo tras i dotyka obu wariantów `AppTabs` (natywny + web); po przeniesieniu ekranów do `(app)` triggery tabów trzeba zweryfikować w runtime (URL-e się nie zmieniają, natywny `name` może wymagać korekty).
- API base URL zależy od celu natywnego: iOS sim `localhost:3030`, emulator Androida `10.0.2.2:3030`, urządzenie fizyczne — IP w LAN.

## Success Criteria (Summary)

- Użytkownik zakłada konto, zostaje od razu zalogowany i widzi chroniony ekran główny ze swoim emailem.
- Sesja przeżywa restart aplikacji; wylogowanie wraca na logowanie; ponowne logowanie działa.
- Niezalogowany na trasie chronionej jest przekierowany na logowanie; API odrzuca żądania bez ważnego tokenu.

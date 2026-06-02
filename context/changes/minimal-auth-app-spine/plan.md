# Minimalny auth i uwierzytelniony szkielet aplikacji — Implementation Plan

## Overview

Dostarczamy fundament F-01 z roadmapy: rejestracja i logowanie (email + hasło), trwała sesja do wylogowania, routing chroniony oraz uwierzytelniony klient API. To enabler, nie ścieżka walidacji — odblokowuje S-01 (`capture-situation-by-voice`) i gwiazdę przewodnią S-02. Zakres trzymamy w minimum auth: bez resetu hasła, OAuth, weryfikacji email czy ról.

## Current State Analysis

- **Backend** (`api/src/index.ts:1-29`): Worker Hono z jednym endpointem `GET /health`. CORS skonfigurowany (`api/src/index.ts:11-19`) — `Authorization` już na allowliście, originy: `my-english-day.pages.dev`, `localhost:8081`, `localhost:19006`. Brak endpointów auth i middleware. `Bindings` to `{ DB: D1Database; ENVIRONMENT: string }` (`api/src/index.ts:4-7`).
- **Data** (`api/wrangler.toml:9-12`): D1 `my-english-day-db` podpięty jako binding `DB`, baza pusta — 0 tabel, brak migracji, brak ORM, brak folderu `api/migrations/`.
- **Sekrety**: `JWT_SECRET` i `OPENAI_API_KEY` ustawione w Cloudflare (wg roadmapy `context/foundation/roadmap.md:61-62`), ale `JWT_SECRET` nie jest jeszcze w typie `Bindings`.
- **Frontend** (`src/app/`): Expo Router, file-based routing. `src/app/_layout.tsx:7-15` = root layout z `ThemeProvider` + `AppTabs`. Tylko ekrany szablonu (`src/app/index.tsx`, `src/app/explore.tsx`). Brak ekranów auth, stanu sesji, klienta API, bezpiecznego storage tokenu.
- **Zależności**: `expo-secure-store` NIE jest w `package.json` (do dodania). `hono` ^4.7.0 jest w `api/package.json:11` (ma wbudowane `hono/jwt`). Brak frameworka testów w obu paczkach.
- **Konwencje** (CLAUDE.md): alias `@/*` → `src/*` (`tsconfig.json:5-8`), `strict: true`, `typedRoutes` + `reactCompiler` (`app.json:39-42`), kolory z `Colors.light`/`Colors.dark`, spacing z `Spacing.*` (`src/constants/theme.ts`), named export dla komponentów, default export dla ekranów.
- **Lessons** (`context/foundation/lessons.md`): dev server zawsze na porcie 3030.

## Desired End State

Użytkownik na świeżym urządzeniu może: założyć konto (email + hasło) → zostaje od razu zalogowany (auto-login) → widzi chroniony ekran główny „Witaj, <email>" z przyciskiem Wyloguj → zamyka i otwiera aplikację, sesja trwa (token w secure-store) → wylogowuje się i wraca na ekran logowania. Niezalogowany użytkownik trafiający na dowolną chronioną trasę jest przekierowany na ekran logowania. Wszystkie wywołania API niosą `Authorization: Bearer <jwt>`, a Worker odrzuca żądania bez ważnego tokenu na chronionych trasach.

Weryfikacja: ręczny przebieg na symulatorze iOS/Android (rejestracja → restart aplikacji → sesja trwa → wylogowanie), uzupełniony testami jednostkowymi Vitest dla hashowania haseł i podpisu/weryfikacji JWT.

### Key Discoveries:

- CORS na Workerze już dopuszcza nagłówek `Authorization` (`api/src/index.ts:18`) — nie trzeba go dokładać.
- `JWT_SECRET` istnieje jako sekret, ale brak go w typie `Bindings` (`api/src/index.ts:4-7`) — trzeba dodać.
- Cloudflare Workers nie ma natywnego `bcrypt` (brak Node `crypto`) — hashowanie musi iść przez Web Crypto `crypto.subtle` (PBKDF2). `nodejs_compat` jest włączone (`api/wrangler.toml:4`), ale PBKDF2 przez Web Crypto jest prostsze i bezpieczne na edge.
- `hono/jwt` daje `sign`/`verify` oraz middleware `jwt({ secret })` — nie trzeba zewnętrznej biblioteki JWT.
- Root layout (`src/app/_layout.tsx`) renderuje `AppTabs` bezwarunkowo — bramka auth musi opakować ten render stanem sesji.

## What We're NOT Doing

- Reset/odzyskiwanie hasła, zmiana hasła.
- Weryfikacja email, potwierdzanie konta.
- OAuth / logowanie społecznościowe.
- Role, uprawnienia, panel admina (PRD: płaski model).
- Refresh tokeny / serwerowa tabela sesji / unieważnianie tokenów (świadomie: sesja permanentna = długożyjący JWT).
- Tabele danych produktowych (situations, flashcards) — należą do S-01+; tu tylko `users`.
- Wsparcie web jako platformy docelowej — weryfikujemy natywnie (web może działać, ale nie jest kryterium sukcesu).
- Pełny harness testowy front+API — testy tylko na krytycznym rdzeniu (hash + JWT).
- CI/CD — parked w roadmapie.

## Implementation Approach

Kolejność: warstwa danych + prymitywy bezpieczeństwa → endpointy API + middleware → infrastruktura sesji na froncie → ekrany i routing chroniony. Każda faza jest samodzielnie weryfikowalna. Najpierw najbardziej łamliwy, bezpieczeństwo-krytyczny rdzeń (hash, JWT) z testami jednostkowymi, potem warstwy budowane na nim. Front dzielimy na infrastrukturę (sesja + klient) i prezentację (ekrany + bramka), bo bramka zależy od gotowego stanu sesji.

## Critical Implementation Details

- **Hashowanie na Workerach**: użyj `crypto.subtle` (PBKDF2, losowa sól per użytkownik, zapisana razem z hashem w jednym polu w formacie pozwalającym odtworzyć parametry przy weryfikacji). Nie używaj bibliotek zakładających Node `crypto`.
- **Kolejność bramki**: stan sesji ma trzy stany — `loading` (odczyt z secure-store w toku), `authenticated`, `unauthenticated`. Bramka NIE może przekierować na logowanie w stanie `loading`, inaczej zalogowany użytkownik mignie ekranem logowania przy każdym starcie. Redirect tylko gdy stan jest jednoznacznie `unauthenticated`.
- **secure-store a web**: `expo-secure-store` na web nie działa natywnie. Weryfikujemy natywnie; jeśli aplikacja ma się nie wywalać na web, dostęp do storage musi być owinięty tak, by brak modułu nie crashował (graceful fallback lub jawne ograniczenie do natywnego). Platforma docelowa = natywna.
- **Przebudowa drzewa tras (load-bearing)**: root `src/app/_layout.tsx:11` renderuje BEZPOŚREDNIO `<AppTabs />`, nie `<Slot>`/`<Stack>`. `AppTabs` to nawigator zakładkowy z twardo zadeklarowanymi triggerami `index`/`explore` w DWÓCH wariantach: natywnym (`NativeTabs`, `src/components/app-tabs.tsx:15,23`) i webowym (`expo-router/ui` + `TabSlot`, `src/components/app-tabs.web.tsx:24,27`). Ekran auth nie ma się gdzie wyrenderować, dopóki root pozostaje tab-navigatorem — bramka wymaga przebudowy roota na `Stack`/`Slot` z osobną grupą publiczną `(auth)` i chronioną grupą trzymającą `AppTabs`. Grupy w nawiasach NIE zmieniają URL (`/`, `/explore` zostają), ale natywny `name="index"` triggera trzeba zweryfikować w runtime po przeniesieniu. Zakres minimalny: NIE projektować nawigacji slice'ów ani nie usuwać `explore` — tylko przenieść istniejące taby pod bramkę.
- **API base URL a platforma**: weryfikacja jest natywna, więc jeden stały `localhost` nie wystarczy. Na symulatorze iOS `http://localhost:3030` działa; na emulatorze Androida host maszyny to `http://10.0.2.2:3030`; na urządzeniu fizycznym — IP maszyny w LAN. `extra.apiBaseUrl` musi to uwzględniać (domyślnie iOS sim; udokumentować alternatywy).

## Phase 1: Warstwa danych + prymitywy auth (Worker)

### Overview

Tworzymy pierwszą migrację D1 (tabela `users`) oraz dwa prymitywy bezpieczeństwa — hashowanie haseł (PBKDF2/Web Crypto) i helpery JWT (sign/verify) — pokryte testami jednostkowymi. Brak jeszcze wpięcia w endpointy.

### Changes Required:

#### 1. Migracja schematu — tabela `users`

**File**: `api/migrations/0001_create_users.sql` (nowy; utwórz przez `wrangler d1 migrations create`)

**Intent**: Pierwsza migracja projektu — tabela kont użytkowników. Tylko `users`; tabele danych produktowych dodadzą slice'y z `user_id` FK (konwencja izolacji, zob. References).

**Contract**: `users` z kolumnami: `id` (PK), `email` (unikalny, znormalizowany lowercase), `password_hash` (hash + sól + parametry PBKDF2 w jednym polu), `created_at`. Unikalność email wymuszona na poziomie schematu (UNIQUE index).

#### 2. Konfiguracja narzędzia migracji

**File**: `api/wrangler.toml`

**Intent**: Wskazać katalog migracji D1, by `wrangler d1 migrations apply` działał deterministycznie.

**Contract**: Dodaj `migrations_dir` do bloku `[[d1_databases]]` (lub potwierdź domyślny `api/migrations/`). Bez zmiany `database_id`/`binding`.

#### 3. Hashowanie haseł

**File**: `api/src/lib/password.ts` (nowy)

**Intent**: Bezpieczne hashowanie i weryfikacja hasła na edge bez zależności od Node crypto.

**Contract**: Dwie funkcje — `hashPassword(plain: string): Promise<string>` (zwraca string z solą + parametrami) i `verifyPassword(plain: string, stored: string): Promise<boolean>`. Implementacja: PBKDF2 via `crypto.subtle`, losowa sól per hash, porównanie w czasie stałym.

#### 4. Helpery JWT

**File**: `api/src/lib/jwt.ts` (nowy)

**Intent**: Wydawanie i weryfikacja długożyjącego tokenu sesji.

**Contract**: `signSession(userId: string|number, secret: string): Promise<string>` i `verifySession(token: string, secret: string): Promise<{ sub: ... } | null>`. Oparte na `hono/jwt`. Payload niesie identyfikator użytkownika (`sub`). Brak krótkiego `exp` (sesja permanentna) — jeśli `exp` ustawiony, to odległy; decyzja: bez wygaszania po stronie tokenu.

#### 5. Rozszerzenie typu `Bindings`

**File**: `api/src/index.ts`

**Intent**: Udostępnić `JWT_SECRET` w typowanym kontekście Hono.

**Contract**: Dodaj `JWT_SECRET: string` do typu `Bindings` (`api/src/index.ts:4-7`).

#### 6. Setup testów + testy rdzenia

**File**: `api/package.json`, `api/vitest.config.*` (nowy), `api/src/lib/password.test.ts`, `api/src/lib/jwt.test.ts` (nowe)

**Intent**: Minimalny harness Vitest dla Workerów + testy najłamliwszego rdzenia.

**Contract**: Skrypt `test` w `api/package.json`. Testy: hash≠plain, `verifyPassword` true dla poprawnego / false dla błędnego, różne sole dla tego samego hasła; `signSession`→`verifySession` round-trip zwraca `sub`, zły sekret/zmanipulowany token → `null`.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `cd api && npx wrangler d1 migrations apply my-english-day-db --local`
- Testy jednostkowe przechodzą: `cd api && npm test`
- Typecheck Workera przechodzi (brak błędów `tsc`/`wrangler types`)

#### Manual Verification:

- `users` istnieje w lokalnej bazie D1 z UNIQUE na `email` (podgląd przez `wrangler d1 execute ... --command "SELECT sql FROM sqlite_master"`)

**Implementation Note**: Po ukończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie manualne, zanim przejdziesz do Phase 2.

---

## Phase 2: Endpointy auth + middleware (API)

### Overview

Wpinamy prymitywy z Phase 1 w endpointy rejestracji/logowania/„kim jestem" oraz middleware JWT chroniący trasy. Walidacja lekka, spójna z frontem.

### Changes Required:

#### 1. Walidacja wejścia

**File**: `api/src/lib/validation.ts` (nowy)

**Intent**: Wspólne reguły walidacji email/hasła, by komunikaty były spójne front↔API.

**Contract**: `normalizeEmail(raw)` (trim + lowercase), `validateCredentials({email, password})` → lista błędów. Reguły: email niepusty + format, hasło min. 8 znaków.

#### 2. Router auth — register / login / me

**File**: `api/src/routes/auth.ts` (nowy)

**Intent**: Trzy endpointy realizujące flow kont. Rejestracja od razu wydaje token (auto-login).

**Contract**:
- `POST /auth/register` — body `{ email, password }`; waliduje, normalizuje email, sprawdza unikalność (kolizja → 409), hashuje, zapisuje usera, **zwraca `{ token, user: { id, email } }`** (auto-login).
- `POST /auth/login` — body `{ email, password }`; weryfikuje hasło; sukces → `{ token, user }`, błąd → 401 z ogólnym komunikatem (nie ujawniać, czy email istnieje).
- `GET /auth/me` — chroniony; zwraca `{ user: { id, email } }` dla zalogowanego.

#### 3. Middleware JWT

**File**: `api/src/middleware/auth.ts` (nowy)

**Intent**: Brama chroniąca trasy wymagające zalogowania.

**Contract**: Middleware czyta `Authorization: Bearer <jwt>`, weryfikuje przez `verifySession`, na sukces ustawia `userId` w kontekście Hono, na brak/niepoprawny token → 401. Stosowany do `GET /auth/me` (i gotowy do nakładania na trasy slice'ów).

#### 4. Montaż routera w aplikacji

**File**: `api/src/index.ts`

**Intent**: Podpiąć router auth pod główną aplikację Hono, zachowując `/health`.

**Contract**: `app.route('/auth', authRouter)` (lub równoważnie). Bez zmian w konfiguracji CORS.

#### 5. Wymuszenie portu dev 3030

**File**: `api/package.json`

**Intent**: Dev server Workera ma startować deterministycznie na 3030 (wymóg `context/foundation/lessons.md`), nie na domyślnym 8787.

**Contract**: Zmień skrypt `dev` (`api/package.json:6`) z `wrangler dev` na `wrangler dev --port 3030`. Wszystkie komendy weryfikacji manualnej używają 3030.

### Success Criteria:

#### Automated Verification:

- Typecheck Workera przechodzi
- Testy z Phase 1 nadal przechodzą: `cd api && npm test`

#### Manual Verification:

- `cd api && npm run dev` startuje na porcie **3030**
- `POST http://localhost:3030/auth/register` z nowym emailem zwraca token + user; powtórzony email → 409
- `POST http://localhost:3030/auth/login` poprawne dane → token; złe hasło → 401 z ogólnym komunikatem
- `GET http://localhost:3030/auth/me` z `Authorization: Bearer <token>` → dane usera; bez nagłówka / zły token → 401

**Implementation Note**: Po weryfikacji automatycznej zatrzymaj się na potwierdzenie manualne przed Phase 3.

---

## Phase 3: Sesja + klient API (front)

### Overview

Infrastruktura sesji na urządzeniu: bezpieczny storage tokenu, globalny stan auth (Context) i uwierzytelniony klient API. Bez ekranów — to warstwa, na której stanie bramka w Phase 4.

### Changes Required:

#### 1. Zależność secure-store

**File**: `package.json`

**Intent**: Dodać moduł bezpiecznego przechowywania tokenu.

**Contract**: Dodaj `expo-secure-store` przez `npx expo install expo-secure-store` (wersja zgodna z SDK 56).

#### 1b. Źródło konfiguracji API base URL

**File**: `app.json`

**Intent**: Front musi wiedzieć, pod jaki URL wołać Workera — bez tego `api.ts` nie ma dokąd kierować żądań (lint/typecheck przejdą, ale login/register nie zadziała).

**Contract**: Dodaj `expo.extra.apiBaseUrl` do `app.json`. Wartość domyślna pod weryfikację na symulatorze iOS: `http://localhost:3030`. W komentarzu/notatce udokumentuj alternatywy dla pozostałych celów natywnych: emulator Androida → `http://10.0.2.2:3030`, urządzenie fizyczne → IP maszyny w LAN. Odczyt w aplikacji przez `expo-constants` (`Constants.expoConfig?.extra?.apiBaseUrl`).

#### 2. Warstwa sesji (token storage)

**File**: `src/lib/session.ts` (nowy)

**Intent**: Odczyt/zapis/kasowanie tokenu w secure-store, odizolowane od reszty.

**Contract**: `getToken(): Promise<string|null>`, `setToken(t): Promise<void>`, `clearToken(): Promise<void>`. Dostęp owinięty tak, by brak modułu (web) nie crashował (zob. Critical Implementation Details).

#### 3. Klient API

**File**: `src/lib/api.ts` (nowy)

**Intent**: Jedno miejsce wywołań do Workera, automatycznie dołączające token.

**Contract**: Bazowy URL czytany z `Constants.expoConfig?.extra?.apiBaseUrl` (zob. zmiana 1b; brak wartości → jawny błąd przy starcie, nie ciche `undefined`). Funkcja `apiFetch(path, opts)` dołączająca `Authorization: Bearer <token>` gdy jest, oraz cienkie wrappery `authApi.register`, `authApi.login`, `authApi.me`. 401 sygnalizowane wywołującemu (nie połykane).

#### 4. AuthProvider (stan sesji)

**File**: `src/contexts/auth-context.tsx` (nowy)

**Intent**: Globalny stan auth dla całej aplikacji z trzema stanami (`loading`/`authenticated`/`unauthenticated`).

**Contract**: Context + hook `useAuth()` zwracający `{ status, user, signIn, register, signOut }`. Przy starcie czyta token z secure-store i `GET /auth/me` (hydratacja sesji) → ustawia status. `signOut` czyści token i stan. `status === 'loading'` dopóki hydratacja trwa.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typecheck frontu przechodzi (brak błędów `tsc`)

#### Manual Verification:

- Po dodaniu `expo-secure-store` aplikacja startuje na symulatorze bez błędów (`npm run ios`/`android`)
- Tymczasowy log/przycisk testowy potwierdza, że `setToken`→`getToken` zwraca ten sam token, a `clearToken` go usuwa
- Tymczasowe wywołanie `authApi.me` trafia pod `extra.apiBaseUrl` (Worker z Phase 2 na 3030) — widoczne w logach żądania/odpowiedzi, nie błąd „network request failed"

**Implementation Note**: Po weryfikacji automatycznej zatrzymaj się na potwierdzenie manualne przed Phase 4.

---

## Phase 4: Ekrany auth + routing chroniony (front)

### Overview

Prezentacja i bramka. Najpierw przebudowa drzewa tras (dziś root renderuje wprost tab-navigator, nie ma gdzie osadzić ekranu auth), potem ekrany logowania/rejestracji, redirect guard i chroniony ekran główny placeholder „Witaj, <email>" z wylogowaniem. Zakres minimalny: przenosimy istniejące taby pod bramkę bez projektowania nawigacji slice'ów i bez usuwania `explore`.

Docelowa struktura tras (grupy w nawiasach NIE zmieniają URL — `/` i `/explore` zostają):

```
src/app/
  _layout.tsx          → AuthProvider + ThemeProvider + Stack/Slot + bramka (redirect wg statusu)
  (auth)/
    _layout.tsx        → Stack dla ekranów publicznych
    login.tsx          → ekran logowania
    register.tsx       → ekran rejestracji
  (app)/
    _layout.tsx        → renderuje AppTabs (chroniona grupa)
    index.tsx          → chroniony ekran główny (przeniesiony z src/app/index.tsx)
    explore.tsx        → bez zmian merytorycznych (przeniesiony z src/app/explore.tsx)
```

### Changes Required:

#### 1. Przebudowa root layoutu — provider + nawigator + bramka

**File**: `src/app/_layout.tsx`

**Intent**: Zamienić bezpośrednie renderowanie `AppTabs` na nawigator z dwiema grupami i wymusić bramkę na podstawie statusu auth.

**Contract**: Drzewo owinięte w `AuthProvider` (wewnątrz zachowany `ThemeProvider`, `src/app/_layout.tsx:10`). Root renderuje `Stack`/`Slot` zamiast `AppTabs`. Bramka: `status==='loading'` → splash/nic (NIE przekierowuj — zob. Critical Implementation Details, ryzyko mignięcia); `unauthenticated` na trasie w `(app)` → `<Redirect href="/login">`; `authenticated` na trasie w `(auth)` → `<Redirect>` do `/`. `AnimatedSplashOverlay` (`src/app/_layout.tsx:11`) zachowany.

#### 2. Layout chronionej grupy `(app)`

**File**: `src/app/(app)/_layout.tsx` (nowy)

**Intent**: Osadzić istniejący tab-navigator w chronionej grupie.

**Contract**: Renderuje `<AppTabs />` (import bez zmian z `@/components/app-tabs`). To tu żyją taby; root przestaje je renderować bezpośrednio.

#### 3. Przeniesienie ekranów do `(app)` + aktualizacja referencji tabów

**File**: `src/app/index.tsx` → `src/app/(app)/index.tsx`, `src/app/explore.tsx` → `src/app/(app)/explore.tsx`; `src/components/app-tabs.tsx`, `src/components/app-tabs.web.tsx`

**Intent**: Przenieść trasy pod grupę chronioną i upewnić się, że oba warianty `AppTabs` nadal poprawnie adresują przeniesione ekrany.

**Contract**: `explore.tsx` przeniesiony bez zmian merytorycznych. Web `AppTabs` używa `href="/"` i `href="/explore"` (`src/components/app-tabs.web.tsx:24,27`) — URL-e niezmienione przez grupę, więc powinny zostać; zweryfikować w runtime. Natywny `AppTabs` używa `NativeTabs.Trigger name="index"`/`"explore"` (`src/components/app-tabs.tsx:15,23`) — `name` odnosi się do segmentu trasy w grupie; zweryfikować w runtime, że triggery wskazują na `(app)/index` i `(app)/explore` (skorygować `name` jeśli runtime tego wymaga). Bez przeprojektowania wyglądu tabów.

#### 4. Ekran logowania

**File**: `src/app/(auth)/login.tsx` (nowy)

**Intent**: Formularz email+hasło, wywołuje `signIn`, pokazuje błędy walidacji/401.

**Contract**: Pola email+hasło, przycisk Zaloguj, link do rejestracji. Walidacja lekka spójna z API. Theming z `Colors`/`Spacing`. Default export (ekran).

#### 5. Ekran rejestracji

**File**: `src/app/(auth)/register.tsx` (nowy)

**Intent**: Formularz zakładania konta; po sukcesie auto-login (stan z `register` ustawia sesję, bramka wpuszcza dalej).

**Contract**: Pola email+hasło, przycisk Załóż konto, link do logowania, obsługa 409 (email zajęty). Default export.

#### 6. Layout publicznej grupy `(auth)`

**File**: `src/app/(auth)/_layout.tsx` (nowy)

**Intent**: Prosty nawigator dla ekranów publicznych, bez tabów.

**Contract**: `Stack` z `login` i `register`, bez nagłówka tabów. Default export (layout).

#### 7. Chroniony ekran główny (placeholder)

**File**: `src/app/(app)/index.tsx` (przeniesiony i zmodyfikowany ekran szablonu)

**Intent**: Najprostszy dowód zalogowanej sesji — „Witaj, <email>" + Wyloguj.

**Contract**: Czyta `user` z `useAuth()`, renderuje powitanie i przycisk Wyloguj (`signOut`). Placeholder do wymiany w S-01. Zachowanie theming/konwencji.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typecheck frontu przechodzi (typedRoutes bez błędów)

#### Manual Verification:

- Świeży start (brak tokenu) → redirect na ekran logowania, renderowany BEZ tabów (poza tab-navigatorem)
- Rejestracja nowym emailem → auto-login → ekran główny „Witaj, <email>" z widocznymi tabami (`/`, `/explore` działają)
- Zamknięcie i ponowne otwarcie aplikacji → sesja trwa (brak ekranu logowania, brak mignięcia)
- Wyloguj → powrót na logowanie; ponowne logowanie tymi danymi działa
- Próba wejścia na trasę chronioną bez sesji → redirect na logowanie
- Taby działają natywnie i na web po przeniesieniu ekranów do `(app)` (przełączanie `index`↔`explore` bez błędów routingu)

**Implementation Note**: Po weryfikacji automatycznej zatrzymaj się na końcowe potwierdzenie manualne — to zamyka F-01.

---

## Testing Strategy

### Unit Tests:

- `password.ts`: hash≠plain; verify true/false; różne sole dla tego samego hasła.
- `jwt.ts`: round-trip sign→verify zwraca `sub`; zły sekret / zmanipulowany token → `null`.

### Integration Tests:

- Brak zautomatyzowanych (świadomie). Flow auth weryfikowany manualnie przez `wrangler dev` + symulator.

### Manual Testing Steps:

1. `cd api && npm run dev` (port 3030): register → login → me przez curl/REST client (Phase 2 success criteria).
2. Symulator: rejestracja → auto-login → restart → trwałość sesji → wylogowanie (Phase 4 success criteria).
3. Edge: zajęty email (409), złe hasło (401), wejście bez sesji na trasę chronioną (redirect).

## Performance Considerations

PBKDF2 ma celowy koszt CPU — dobierz liczbę iteracji tak, by mieścić się w budżecie CPU Workera, zachowując rozsądny opór na brute-force. Hydratacja sesji przy starcie robi jedno `GET /auth/me`; nie blokuj UI dłużej niż konieczne (stan `loading` + splash).

## Migration Notes

Pierwsza migracja w projekcie ustala konwencję `api/migrations/NNNN_*.sql`. Slice'y S-01+ dodają własne tabele danych z `user_id` FK do `users` i filtrują per zalogowany użytkownik (izolacja danych). Aplikacja migracji lokalnie: `--local`; na produkcji `wrangler d1 migrations apply my-english-day-db --remote` (poza zakresem auto-weryfikacji tego planu).

## References

- Roadmap: `context/foundation/roadmap.md` (F-01, linie 67-79)
- PRD: `context/foundation/prd.md` (FR-001, FR-002 linie 57-60; Access Control linie 103-105; Open Question #2 linia 117)
- Tech stack: `context/foundation/tech-stack.md`
- Change identity: `context/changes/minimal-auth-app-spine/change.md`
- Worker baseline: `api/src/index.ts:1-29`, `api/wrangler.toml:9-12`
- Root layout: `src/app/_layout.tsx:7-15`
- Lessons: `context/foundation/lessons.md` (port 3030)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Warstwa danych + prymitywy auth (Worker)

#### Automated

- [x] 1.1 Migracja aplikuje się czysto: `wrangler d1 migrations apply my-english-day-db --local`
- [x] 1.2 Testy jednostkowe przechodzą: `cd api && npm test`
- [x] 1.3 Typecheck Workera przechodzi

#### Manual

- [x] 1.4 Tabela `users` istnieje w lokalnym D1 z UNIQUE na `email`

### Phase 2: Endpointy auth + middleware (API)

#### Automated

- [ ] 2.1 Typecheck Workera przechodzi
- [ ] 2.2 Testy z Phase 1 nadal przechodzą: `cd api && npm test`

#### Manual

- [ ] 2.3 `cd api && npm run dev` startuje na porcie 3030
- [ ] 2.4 `POST /auth/register` zwraca token+user; powtórzony email → 409
- [ ] 2.5 `POST /auth/login` poprawne → token; złe hasło → 401 (ogólny komunikat)
- [ ] 2.6 `GET /auth/me` z tokenem → user; bez/zły token → 401

### Phase 3: Sesja + klient API (front)

#### Automated

- [ ] 3.1 Lint przechodzi: `npm run lint`
- [ ] 3.2 Typecheck frontu przechodzi

#### Manual

- [ ] 3.3 Aplikacja startuje na symulatorze po dodaniu `expo-secure-store`
- [ ] 3.4 `setToken`→`getToken` round-trip i `clearToken` działają
- [ ] 3.5 `authApi.me` trafia pod `extra.apiBaseUrl` (Worker na 3030), nie „network request failed"

### Phase 4: Ekrany auth + routing chroniony (front)

#### Automated

- [ ] 4.1 Lint przechodzi: `npm run lint`
- [ ] 4.2 Typecheck frontu przechodzi (typedRoutes)

#### Manual

- [ ] 4.3 Świeży start bez tokenu → redirect na logowanie, renderowane BEZ tabów
- [ ] 4.4 Rejestracja → auto-login → ekran główny „Witaj, <email>" z widocznymi tabami
- [ ] 4.5 Restart aplikacji → sesja trwa (brak mignięcia logowania)
- [ ] 4.6 Wyloguj → powrót na logowanie; ponowne logowanie działa
- [ ] 4.7 Wejście na trasę chronioną bez sesji → redirect na logowanie
- [ ] 4.8 Taby działają natywnie i na web po przeniesieniu do `(app)` (`index`↔`explore`)

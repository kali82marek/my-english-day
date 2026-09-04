# Faza 2 wdrożenia testów: kontrakty tras (własność, izolacja, dzień lokalny) — Plan implementacji

## Przegląd

Piszemy na istniejącym harnessie workerd (produkt Fazy 1, `test-plan.md` §6.2) testy
integracyjne na poziomie tras, które **dowodzą** ryzyka #3 z `context/foundation/test-plan.md`
§2 (cudze dane / IDOR) na każdej z **7** chronionych tras aplikacji i **kodują wyrocznię PRD**
dla ryzyka #6 (dzień liczony w UTC) jako `it.fails` z follow-upem. Dowód ryzyka #3 to jedna
macierz: brak tokenu / sfałszowany token → 401 z obserwowalnym „D1 i R2 nietknięte”; cudzy
id → 404 z nietkniętym wierszem ofiary; listy bez cudzych wierszy; DTO każdej odpowiedzi
asertowane jako **dokładny zbiór kluczy** przeciw kontraktowi z frontem (`src/lib/api.ts`).
Ryzyko #6 nie ma dziś kanału wejścia (dzień liczy SQL `date('now')` w UTC, decyzje S-01 F1 i
S-02 F4 są `PENDING`), więc test koduje zachowanie z PRD („sytuacja nagrana 23:30 czasu
Warszawy należy do dzisiejszego dnia do lokalnej północy, po obu stronach DST”) w jawnej
tabeli chwil UTC, bez wyboru poprawki.

Zero zmian w kodzie produkcyjnym: badanie potwierdziło, że każde oczekiwanie ryzyka #3 jest
dziś spełnione, a dla ryzyka #6 poprawka jest decyzją produktową poza tą zmianą. Plan kończy
się podfazą, która wypełnia §6.3 i §6.4 książki kucharskiej oraz dopisuje notatkę do §6.7
(bez edycji §1–§5; wiersz 2 tabeli §3 przestawia orkiestrator `/10x-test-plan`).

## Analiza obecnego stanu

Szczegóły i permalinki: `context/changes/testing-route-contracts-ownership-day/research.md`.

- **Trasy**: 10 tras, z czego 3 publiczne (`GET /health`, `POST /auth/register`,
  `POST /auth/login`) i **7 chronionych**: `GET /auth/me` (`requireAuth` per handler),
  `POST /situations`, `GET /situations`, `DELETE /situations/:id`, `GET /flashcards/proposals`,
  `POST /flashcards/:id/accept`, `DELETE /flashcards/:id` (oba routery: `use('*', requireAuth)`
  przed trasami). Brief orkiestratora i podsumowanie badania mówią „8” — to pomyłka o jeden
  (10 − 3 = 7; tabela w badaniu §1 wymienia dokładnie 7). Endpointów S-04/S-05 nie ma; nie ma
  `GET /situations/:id`.
- **Własność** wymuszana per zapytanie (`user_id = ?` w listach, `id = ? AND user_id = ?`
  w mutacjach); 404 dla cudzego, nieistniejącego i (w `accept`) już zaakceptowanego —
  identyczne ciało. `user_id` jest stringiem z tokenu bindowanym przeciw kolumnie INTEGER
  (działa przez afiniczność SQLite; niewidoczne dla TypeScript) — jedynym realnym dowodem
  jest test z dwoma zasianymi użytkownikami na realnym D1.
- **DTO**: `SituationDTO` przez whitelistę `toDTO`; `FlashcardDTO` z `/proposals` **bez warstwy
  mapowania** — whitelistą jest lista kolumn w `SELECT` (dopisanie kolumny = wyciek).
  `is_variant` (migracja 0004) nie jest selekcjonowane. Jedyna dzisiejsza asercja wycieku:
  `not.toHaveProperty` dla dwóch nazw w `api/test/harness.test.ts`.
- **401 przed D1**: `requireAuth` nie ma dostępu do `c.env.DB`; brak nagłówka, zły format,
  zły podpis → 401 JSON. Kryptografię tokenu (zły sekret, manipulacja, śmieci) pokrywa
  `api/src/lib/jwt.test.ts` — §7 planu testów zakazuje rozszerzania prymitywów auth.
- **Dzień**: SQL `date(created_at) = date('now')` w dwóch miejscach (lista dnia, licznik
  `generatingCount`), oba UTC; klient nie wysyła strefy; brak logiki DST. `vi.setSystemTime`
  steruje `Date` w kodzie aplikacji, **nie** zegarem SQLite; strefa izolatu na Windows to
  strefa hosta (Warszawa), w CI UTC. Jedyna dźwignia po stronie SQL to jawny `created_at`.
- **Harness**: `seedUser` daje dwóch użytkowników w jednym teście bez kolizji; `request.ts`
  zawsze dokleja `Bearer`; brak helperów `DELETE`/`accept`/`me` i żądania bez nagłówka;
  prywatny `seedPending` z `datetime('now', '-N seconds')` w pliku testowym; brak
  `afterEach(vi.useRealTimers)`. Suite: 6 plików, 31 zielonych + 1 `it.fails` (T1.3).
- **Follow-up Fazy 1** (reguła wieku `pending`, próg 2 min) ma objąć także `generatingCount`;
  oba filtry (wiek i dzień) siedzą w tych samych dwóch zapytaniach.

## Pożądany stan końcowy

Po zakończeniu planu `cd api && npm test` jest zielone (plus `it.fails` oczekiwane) i:

- **Ryzyko #3**: każda z 7 chronionych tras bez nagłówka `Authorization` i ze sfałszowanym
  tokenem zwraca 401 JSON, a wiersze ofiary, bucket R2 i sieć są nietknięte (tripwire na
  zapisach D1). Dla danych dwóch użytkowników: cudzy id → 404 z nietkniętym wierszem ofiary
  na wszystkich trzech mutacjach; listy zawierają wyłącznie własne wiersze;
  `generatingCount` liczy tylko własne sytuacje; ponowna akceptacja własnej fiszki → 404;
  DTO `GET /situations`, `POST /situations`, `GET /flashcards/proposals` i `GET /auth/me`
  mają **dokładnie** klucze z typów frontu (w tym brak `is_variant` dla fiszki zasianej z
  `is_variant=1`, brak `user_id`, `audio_key`, `status`, `password_hash`). Każda nowa trasa
  chroniona, której nie ma w macierzy, obala test kompletności.
- **Ryzyko #6**: zachowanie z PRD zakodowane w tabeli 8 wierszy (4 daty po obu stronach obu
  przejść DST × 2 kierunki); 4 wiersze „ten sam dzień lokalny, inny dzień UTC → na liście i
  liczy się” są `it.fails` (czerwone z definicji do decyzji S-01 F1 / S-02 F4), 4 wiersze
  „23:30 lokalnie → po lokalnej północy poza listą i licznik 0” są zwykłym `it` ze strażnikiem
  filtru dnia. Follow-up `follow-ups/local-day-boundary.md` opisuje obie opcje poprawki bez
  wyboru i warunek zamknięcia.
- **Helpery** w `api/test/` pozwalają napisać test nowej trasy (S-04/S-05) bez budowania
  `Request` ani SQL w teście; kształt żądania żyje wyłącznie w `request.ts`.
- `test-plan.md` §6.3 i §6.4 są wypełnione, §6.7 ma notatkę Fazy 2; §1–§5 nietknięte.

Weryfikacja: kryteria sukcesu każdej fazy + sekcja `## Postęp`.

### Kluczowe odkrycia:

- `api/src/routes/flashcards.ts:38` — `SELECT` propozycji idzie prosto do JSON; jedyna
  whitelista DTO. `flashcards.ts:64` (`accept`) i `:86` (`DELETE`) — `WHERE id = ? AND
  user_id = ?`, decyzja 404 po `meta.changes === 0`. `flashcards.ts:47` — `generatingCount`
  z filtrem dnia UTC.
- `api/src/routes/situations.ts:57-66` — `toDTO`; `:249` — lista dnia z `date('now')`;
  `:266-273` — `DELETE /:id` decyduje 404 po wstępnym `SELECT ... WHERE id = ? AND user_id = ?`.
- `api/src/middleware/auth.ts:13-28` — brak `c.env.DB`; `api/src/routes/auth.ts:89` —
  `requireAuth` per handler na `/me`; `auth.ts:91` — `SELECT id, email`.
- `api/src/lib/jwt.ts:18-23` — `signSession(userId, secret)` jest eksportowane: token
  „sfałszowany” = ten sam `sub`, inny sekret (`vitest.config.mts` ustawia `'test-secret'`).
- Hono 4.12: `app.routes` po `app.route()` niesie pełne ścieżki (`/flashcards/:id/accept`),
  wpisy middleware mają `method: 'ALL'` lub `handler === requireAuth` (sonda w tej sesji) —
  pozwala na test kompletności macierzy 401.
- Vitest 4.1.11: `fails` jest w łańcuchu modyfikatorów testu, a `each` czyta kontekst
  łańcucha (`@vitest/runner/dist/chunk-artifact.js:2153-2160`) — `it.fails.each` działa.
- `it.fails` **zgłasza błąd, gdy test przechodzi**. Pod dzisiejszym kodem SQL `date('now')`
  to realny dzień, więc wiersz zasiany w marcu nigdy nie jest „dziś”: asercje **inkluzji**
  padają (nadają się na `it.fails`), asercje **ekskluzji** przechodzą trywialnie (nie nadają
  się). Stąd podział 4 + 4 w ryzyku #6.
- Dokładne chwile UTC dla czasów Warszawy policzone przez ICU (Node 24, `Intl` z
  `timeZone: 'Europe/Warsaw'`): przejścia 2026-03-29 01:00Z (CET→CEST) i 2025-10-26 01:00Z
  (CEST→CET). Przejście 2026-10-25 jest **w przyszłości** — zasiew dat z jego okolic dałby
  dwa dni w roku, w których realne `date('now')` zrówna się z zasiewem i suite się przekręci;
  dlatego jesienna strona tabeli używa przejścia 2025-10-26 (te same reguły strefy).
- `api/test/setup.ts:30-32` — `vi.restoreAllMocks()` nie cofa `vi.setSystemTime`; cofa je
  tylko `vi.useRealTimers()`; przeciek jest w obrębie pliku.
- `api/test/db.ts:86-100` — `withTrigger` rejestruje nazwę w module i `resetDb` ją zdejmuje;
  trigger założony **przed** zasiewem ofiary zablokowałby sam zasiew (kolejność!).

## Czego NIE robimy

- Nie wybieramy ani nie realizujemy poprawki dnia lokalnego (Fix A: klient przekazuje granice
  dnia; Fix B: serwer liczy dzień w `Europe/Warsaw`) — test koduje PRD, follow-up opisuje obie
  opcje. Nie zmieniamy klienta.
- Nie zmieniamy kodu produkcyjnego. Badanie wykazało, że każde oczekiwanie ryzyka #3 jest
  spełnione; jeśli mimo to test Fazy 2 lub 3 okaże się czerwony, implementator zatrzymuje się
  i wraca do `/10x-plan` (to nowe odkrycie, nie „drobna poprawka”).
- Nie testujemy: tokenu usuniętego użytkownika (500 na `POST /situations`), text/plain 404 z
  tokenem na niedopasowanej ścieżce, braku `exp` w tokenach (FR-002: sesja permanentna) —
  odnotowane w §6.7 jako kandydaci do `--refresh`, bez follow-upu i bez testu.
- Nie rozszerzamy wariantów złego tokenu poza dwa (brak nagłówka, inny sekret) — reszta to
  prymitywy JWT (§7). Nie testujemy schematu innego niż `Bearer` na trasach.
- Nie dodajemy `app.onError`, `GET /situations/:id`, endpointów S-04/S-05 ani testów dla nich;
  nie symulujemy awarii R2 (S-01 F4 nadal `PENDING`).
- Nie realizujemy reguły wieku `pending` (follow-up Fazy 1); test ryzyka #6 jest zaprojektowany
  tak, by po jej wejściu nie zmienić wyniku.
- Nie edytujemy §1–§5 planu testów (w tym statusu wiersza 2 tabeli §3 i liczników w §4 —
  własność orkiestratora). Nie konfigurujemy CI, hooków, runnera frontu, e2e.
- Nie asertujemy tekstu SQL, kolejności zapytań ani wywołań bindingu D1/R2; nie mockujemy D1/R2
  od środka.

## Podejście do implementacji

1. **Helpery najpierw, jako jedna faza**: kształt żądania (nagłówki, ewentualne query) żyje
   wyłącznie w `request.ts`; zasiew z jawnym `created_at` i odczyty w `db.ts`; zbiory kluczy
   DTO w `dto.ts` powiązane na poziomie typów z typami DTO, tak by brakujący lub nadmiarowy
   klucz obalał `npm run typecheck`. Istniejące testy przechodzą na nowe helpery (prywatny
   `seedPending` znika), a dwa testy właściwości harnessu dowodzą, że zasiew i tripwire
   działają — bez tego `it.fails` w ryzyku #6 byłby ślepy na zepsuty zasiew.
2. **Macierz 401 w jednym pliku obok middleware**: `it.each` po tabeli 7 tras × 2 warianty,
   z ofiarą, która ma realne dane i realne ciało żądania (multipart dla `POST /situations`),
   tripwire `RAISE(ABORT)` na każdym zapisie do `situations`/`flashcards` i asercjami na
   skutku (401 JSON, wiersze ofiary bez zmian, bucket pusty, `fetch` niewywołany). Test
   kompletności porównuje tabelę z `app.routes` — nowa trasa bez wiersza w macierzy = czerwony.
3. **Własność i DTO per trasa**: `describe('Ryzyko #3: cudze dane (IDOR)')` w pliku każdej
   trasy; każdy test ma dwóch użytkowników, ramię „cudze” (404 / brak na liście / nietknięty
   wiersz) **i** ramię kontrolne „własne” (200/204 / wiersz zmieniony) — bez ramienia
   kontrolnego trasa zwracająca 404 na wszystko byłaby zielona. DTO jako dokładny zbiór
   kluczy (`keysOf(x)` = lista z `dto.ts`), nigdy `not.toHaveProperty`.
4. **Ryzyko #6 jako tabela wyroczni**: jawne pary „czas lokalny Warszawy ↔ chwila UTC” z
   komentarzem offsetu; `vi.setSystemTime(now)` dla strony JS (dziś bez wpływu — to
   przygotowanie pod obie poprawki), zasiew `created_at` w UTC dla strony SQL; asercje na
   odpowiedzi tras, nigdy na offsecie. Wiersze, które muszą dziś padać → `it.fails.each`;
   wiersze-strażniki → `it.each` z nazwanym deliberate-break.
5. **Deliberate-break per test, książka kucharska na końcu**: §6.3 i §6.4 opisują wzorzec,
   który faktycznie powstał, z regułą dla S-04/S-05 („nowa trasa chroniona = wiersz w macierzy
   401 + test cudzego id w pliku trasy + kształt w `dto.ts`”).

## Krytyczne szczegóły implementacji

- **Czas i cykl życia** — SQL `now` w D1 jest realnym UTC i nie reaguje na `vi.setSystemTime`;
  `vi.setSystemTime` przecieka między testami w pliku, a `vi.restoreAllMocks()` z `setup.ts`
  go nie cofa — `describe` ryzyka #6 ma własne `afterEach(() => vi.useRealTimers())`.
  Daty w tabeli ryzyka #6 muszą być w **przeszłości** względem realnego zegara (nigdy nie siać
  daty, którą realny zegar dopiero osiągnie), inaczej `it.fails` przekręci się w konkretny
  dzień roku. Przy zasiewie bez `createdAt` (DEFAULT `datetime('now')`) INSERT i `SELECT` są
  milisekundy od siebie — bezpieczne dla testów własności.
- **Sekwencjonowanie stanu** — Tripwire (`withWriteTripwire`) zakładać **po** zasianiu ofiary
  i jej danych, inaczej zasiew pada na własnym triggerze. Nazwy triggerów są stałe, więc
  jeden test może uzbroić tripwire raz; `resetDb` w `afterEach` zdejmuje je przed kolejnym
  testem. W teście ryzyka #6 zasiew (SQL) idzie **przed** `vi.setSystemTime` — kolejność nie ma
  dziś znaczenia, ale po Fix A/B helper żądania będzie czytał `Date.now()`, więc test ma
  ustawiać zegar tuż przed wywołaniem trasy.
- **Pułapka `it.fails`** — wiersz, który dziś **przechodzi**, powoduje błąd „expected test to
  fail”. Pod realnym `date('now')` tylko asercje inkluzji („powinno być na liście / liczyć
  się”) padają; asercje ekskluzji przechodzą z powodu odległej daty, nie reguły. Dlatego
  kierunek B jest zwykłym `it` z deliberate-break „usuń filtr dnia z obu zapytań”.
- **Kompletność macierzy** — `app.routes` zawiera wpisy middleware (`method: 'ALL'` dla
  `use('*')` i `handler === requireAuth` dla `/auth/me`); test kompletności filtruje je i
  zbiór publicznych tras (`/health`, `/auth/register`, `/auth/login`), a resztę porównuje z
  nazwami wierszy macierzy jako `METHOD /ścieżka/:param`.
- **Typowanie zbiorów kluczy** — `Record<keyof DTO, true>` jako typ literału obiektowego daje
  błąd kompilacji zarówno przy brakującym, jak i nadmiarowym kluczu (excess property check);
  lista kluczy to `Object.keys(literał).sort()`. Typy DTO w `dto.ts` są lustrem
  `src/lib/api.ts` (`Situation`, `Flashcard`, `AuthUser`) — komentarz w pliku każe zmieniać
  oba naraz; rozjazd między repo `api/` a frontem nie jest wykrywany przez typecheck (osobne
  `tsconfig`).

## Faza 1: Helpery harnessu

### Przegląd

Rozszerzenie `api/test/` o wywołanie bez nagłówka, helpery brakujących tras, zasiew z jawnym
`created_at`, odczyty, tripwire i zbiory kluczy DTO; przeniesienie prywatnego `seedPending`;
dwa testy właściwości harnessu. Po tej fazie suite jest zielone, `npm run typecheck` obejmuje
nowe pliki, a w testach nie ma już `datetime('now', ...)`.

### Wymagane zmiany:

#### 1. Wywołanie aplikacji i helpery tras

**Plik**: `api/test/request.ts`

**Cel**: Jedno miejsce budujące `Request` (nagłówki, ciało, w przyszłości ewentualne query dla
Fix A), tak by testy ryzyk nigdy nie składały żądania same i mogły pominąć `Authorization`.

**Umowa**: `call(env, { method?, path, token?, headers?, body? }) → Promise<{ res, ctx }>` —
dokleja `Authorization: Bearer <token>` **tylko gdy `token !== undefined`**; `headers`
scalane z nagłówkiem auth; `ctx = createExecutionContext()`; `app.fetch(req, env, ctx)`.
`audioForm(options: PostSituationOptions) → FormData` wydzielone z `postSituation` (macierz
401 wysyła realne ciało). `postSituation` i prywatny `getJson` przepisane na `call` (sygnatury
bez zmian). Nowe: `deleteSituation(env, token, id)`, `acceptFlashcard(env, token, id)`,
`deleteFlashcard(env, token, id)`, `getMe(env, token)` → `Promise<Response>` (bez zadania
tła; `ctx` porzucony jak w `getSituations`). Komentarz nagłówkowy: „kształt żądania żyje
tylko tutaj; asercje w testach nie budują `Request`” (to tu trafi ewentualny parametr Fix A).

#### 2. Zasiew, odczyt i tripwire

**Plik**: `api/test/db.ts`

**Cel**: Zasiać sytuację i fiszkę dowolnego użytkownika z wybranym czasem i flagami bez SQL w
teście; odczytać stan ofiary; zamienić każdy zapis do tabel danych w błąd.

**Umowa**:
- `toSqlDatetime(date: Date) → string` w formacie DEFAULT kolumny (`YYYY-MM-DD HH:MM:SS`, UTC),
  żeby zasiany tekst był nieodróżnialny od produkcyjnego.
- `seedSituation(env, userId, { status?, flashcardsStatus?, transcript?, audioKey?,
  durationMs?, createdAt? }) → Promise<number>` — domyślnie `pending`/`pending`/`null`/
  `situations/<userId>/seeded.m4a`/`null`; `createdAt` jako `Date` (przez `toSqlDatetime`) lub
  gotowy string; **pominięty `createdAt` = kolumna dostaje DEFAULT** (nie `datetime('now')`
  w helperze). `INSERT ... RETURNING id`.
- `seedFlashcard(env, { situationId, userId, status?, isVariant?, type?, frontEn?, backPl?,
  exampleEn?, createdAt? }) → Promise<number>` — domyślnie `proposed`, `false`, `'word'`,
  niepuste teksty, `exampleEn: ''` (nigdy NULL — DTO deklaruje `string`).
- `readFlashcard(env, id) → FlashcardRow | null`; `readSituationsOf(env, userId) →
  SituationRow[]` (`ORDER BY id`).
- `withWriteTripwire(env) → Promise<void>` — przez `withTrigger` zakłada sześć triggerów
  `BEFORE INSERT | UPDATE | DELETE ON situations | flashcards` z
  `raiseAbort('tripwire: zapis do <tabela> bez uwierzytelnienia')`; nazwy stałe
  (`test_tripwire_<op>_<tabela>`), zdejmowane przez `resetDb`.

#### 3. Zbiory kluczy DTO

**Plik**: `api/test/dto.ts` (nowy)

**Cel**: Wzorzec asercji „dokładny zbiór kluczy” pochodzący z kontraktu z frontem, nie z
implementacji tras; brakujący lub nadmiarowy klucz w liście = błąd `typecheck`.

**Umowa**: Typy `SituationDTO`, `FlashcardDTO`, `AuthUserDTO` — lustro `src/lib/api.ts`
(`Situation`, `Flashcard`, `AuthUser`) z komentarzem „zmieniaj oba naraz”. Stałe
`SITUATION_DTO_KEYS`, `FLASHCARD_DTO_KEYS`, `AUTH_USER_DTO_KEYS: readonly string[]`
(posortowane) wyprowadzone z literału typowanego `Record<keyof <DTO>, true>`; `keysOf(value:
unknown) → string[]` (posortowane `Object.keys`). Lokalny typ `SituationDTO` w
`situations.integration.test.ts` zastąpiony importem.

Fragment (nieoczywiste sprzężenie typ ↔ lista):

```ts
const situationShape: Record<keyof SituationDTO, true> = {
  id: true, status: true, transcript: true, duration_ms: true, flashcards_status: true, created_at: true,
};
export const SITUATION_DTO_KEYS: readonly string[] = Object.keys(situationShape).sort();
```

#### 4. Migracja istniejących testów na helpery

**Plik**: `api/src/routes/situations.integration.test.ts`, `api/test/harness.test.ts`

**Cel**: Jeden wzorzec zasiewu w repo; koniec z `datetime('now', '-N seconds')` w testach.

**Umowa**: Prywatny `seedPending(userId, ageSeconds)` usunięty; T1.3 i T1.4 sieją przez
`seedSituation(env, userId, { createdAt: new Date(Date.now() - <N> * 1000) })` (ta sama
semantyka wieku względem realnego zegara; okno północy UTC w T1.3 bez zmian, `it.fails`).
Komentarz nad T1.3 wskazuje na follow-up Fazy 2 zamiast „Faza 2 wdrożenia” (zob. Faza 4,
punkt 3). W `harness.test.ts` bezpośredni `INSERT` sytuacji w teście triggera zastąpiony
`seedSituation`; dwie asercje `not.toHaveProperty` na `201` z `POST /situations` zastąpione
`expect(keysOf(body)).toEqual(SITUATION_DTO_KEYS)`.

#### 5. Testy właściwości harnessu

**Plik**: `api/test/harness.test.ts`

**Cel**: Dowieść, że nowe dźwignie działają, zanim oprą się na nich `it.fails` i macierz 401.

**Umowa** (dwa nowe testy w `describe('Harness workerd: właściwości')`):
- **Zasiew z jawnym czasem zapisuje 1:1**: `seedSituation` z `createdAt: new Date('2026-03-27T23:59:30Z')`
  → `readSituation(id).created_at === '2026-03-27 23:59:30'`; `seedFlashcard` z
  `isVariant: true` → `readFlashcard(id).is_variant === 1`; zasiew bez `createdAt` → wartość
  w formacie `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$` (DEFAULT).
- **Tripwire jest uzbrojony**: po `withWriteTripwire` bezpośredni `DELETE FROM flashcards
  WHERE id = ?` odrzuca z komunikatem zawierającym `tripwire`; wiersz zostaje; po `resetDb`
  (wywołanym jawnie w teście) ten sam `DELETE` przechodzi.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `cd api && npm run typecheck` zielone (obejmuje `test/dto.ts`)
- `cd api && npm test` zielone: 31 dotychczasowych + 2 nowe testy właściwości, T1.3 nadal
  jako expected-fail
- `grep -rn "datetime('now'" api/test api/src --include='*.test.ts' --include='*.ts'`
  poza `api/migrations/` nie znajduje nic w plikach testowych i helperach (`seedPending` nie
  istnieje)
- `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` jest puste (zero zmian
  produkcyjnych)

#### Weryfikacja ręczna:

- Nagłówki `request.ts`, `db.ts`, `dto.ts` przeczytane: bez kontekstu tej zmiany wiadomo, że
  kształt żądania i lustro DTO mają po jednym miejscu

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 2.

---

## Faza 2: Ryzyko #3 — brama 401 na każdej chronionej trasie

### Przegląd

Jedna macierz `it.each` (7 tras × 2 warianty) dowodząca, że bez ważnego tokenu żadna trasa
nie dotyka D1, R2 ani sieci, plus test kompletności macierzy względem `app.routes`.

### Wymagane zmiany:

#### 1. Macierz 401

**Plik**: `api/src/middleware/auth.integration.test.ts` (nowy; `describe('Ryzyko #3: cudze dane (IDOR) — brama 401')`)

**Cel**: Udowodnić montaż `requireAuth` na każdej trasie skutkiem obserwowalnym, nie lustrem
middleware; utrzymać macierz kompletną przy S-04/S-05.

**Umowa** (`afterEach(resetDb)`; nagłówek pliku wymienia deliberate-breaks i regułę „nowa trasa
chroniona = nowy wiersz”):
- Tabela `PROTECTED_ROUTES`: `{ name: 'METHOD /ścieżka/:param', method, path: (ids) => string,
  body?: () => BodyInit }` dla 7 tras; `POST /situations` z `audioForm()`; `:id` z zasianych
  danych ofiary.
- Fixture per przypadek: `victim = seedUser(env, 'victim')`; `situationId = seedSituation(env,
  victim.id, { status: 'done', transcript: '…' })`; `flashcardId = seedFlashcard(env,
  { situationId, userId: victim.id })`; migawka `readSituation`/`readFlashcard` **przed**
  wywołaniem; **potem** `withWriteTripwire(env)`; `fetchSpy = mockOpenAI()` (bez wpisów).
- **T3.1 `$name` bez nagłówka `Authorization` → 401 JSON, D1/R2/sieć nietknięte**:
  `call(env, { method, path, body })` bez `token` → `401`, `content-type` zawiera
  `application/json`, ciało `{ error: <niepusty string> }`; `waitOnExecutionContext(ctx)`
  rozwiązuje się; `readSituation`/`readFlashcard` `toEqual` migawek; `readSituationsOf(victim.id)`
  długości 1; `env.AUDIO_BUCKET.list().objects` puste; `fetchSpy` niewywołany. Tripwire jest
  niejawny: każdy zapis dałby 500 zamiast 401.
- **T3.2 `$name` z tokenem podpisanym innym sekretem → 401 …** (te same asercje):
  `token = await signSession(victim.id, 'not-the-secret')` — ten sam `sub`, inny sekret.
- **T3.3 macierz obejmuje każdą niepubliczną trasę aplikacji**: z `app.routes` (import `app`
  z `api/src/index.ts`) odfiltrować `method === 'ALL'`, `handler === requireAuth` i ścieżki
  `PUBLIC_ROUTES = ['GET /health', 'POST /auth/register', 'POST /auth/login']`; zbiór
  `${method} ${path}` `toEqual` zbiorowi `name` z `PROTECTED_ROUTES` (posortowane).

Deliberate-breaks (każdy → czerwony, kod przywrócony): **DB-A** przenieść
`flashcardsRouter.use('*', requireAuth)` poniżej `get('/proposals')` w
`api/src/routes/flashcards.ts:31` → wiersze `GET /flashcards/proposals` (handler bez `userId`
→ 500 lub 200); **DB-B** przenieść `situationsRouter.use('*', requireAuth)` poniżej `post('/')`
w `api/src/routes/situations.ts:177` → `POST /situations`: `R2.put` (bucket niepusty),
`INSERT` na tripwire → 500; **DB-C** usunąć `requireAuth` z `authRouter.get('/me', …)` w
`api/src/routes/auth.ts:89` → 500 zamiast 401; **DB-D** dodać do `api/src/index.ts`
tymczasową trasę `app.get('/probe', …)` → T3.3 czerwony (trasa spoza macierzy).

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `cd api && npx vitest run src/middleware/auth.integration.test.ts` zielone: 14 przypadków
  macierzy + 1 test kompletności
- `cd api && npm test` w całości zielone
- `cd api && npm run typecheck` zielone
- `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` puste

#### Weryfikacja ręczna:

- Deliberate-breaks DB-A, DB-B, DB-C, DB-D wykonane: każdy czerwieni oczekiwane wiersze,
  DB-B zostawia obiekt w buckecie (widoczne w asercji), kod przywrócony, suite zielone

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 3. Jeśli
którykolwiek wiersz macierzy jest czerwony **przed** deliberate-break, zatrzymaj się i wróć do
`/10x-plan` — to nieznana luka, nie poprawka do wykonania w tej zmianie.

---

## Faza 3: Ryzyko #3 — własność i kształt DTO per trasa

### Przegląd

Testy z dwoma użytkownikami w pliku każdej trasy: cudzy id → 404 z nietkniętym wierszem
ofiary, listy i licznik bez cudzych danych, ponowna akceptacja własnej → 404, DTO jako
dokładny zbiór kluczy; każdy test z ramieniem kontrolnym „własne → 2xx”.

### Wymagane zmiany:

#### 1. Sytuacje

**Plik**: `api/src/routes/situations.integration.test.ts` (`describe('Ryzyko #3: cudze dane (IDOR)')`)

**Cel**: Lista dnia i kasowanie widzą wyłącznie dane z tokenu; DTO listy równe kontraktowi.

**Umowa** (dwóch użytkowników `seedUser(env, 'alice')`, `seedUser(env, 'bob')` per test):
- **T3.4 `GET /situations` → lista Alice zawiera wyłącznie sytuacje Alice, każda o kluczach
  DTO**: obie osoby mają po jednej sytuacji zasianej bez `createdAt` (DEFAULT = dziś);
  odpowiedź Alice: `ids` równe `[aliceSituationId]`; dla każdego wiersza
  `keysOf(row)` `toEqual(SITUATION_DTO_KEYS)`. Deliberate-break: usunąć `.map(toDTO)` w
  `situations.ts:254` (klucze `user_id`/`audio_key`) **oraz** osobno usunąć `user_id = ? AND`
  z `:249` (wiersz Boba na liście).
- **T3.5 `DELETE /situations/:id` cudzy id → 404, wiersz i fiszki ofiary zostają; własny →
  204 i wiersz znika**: Bob ma sytuację z jedną fiszką; Alice `deleteSituation(bobSituationId)`
  → `404` JSON `{ error }`; `readSituation(bobSituationId)` `toEqual` migawki,
  `readFlashcards(bobSituationId)` długości 1; następnie Alice kasuje własną → `204`, ciało
  puste, `readSituation(aliceSituationId)` `null`. Deliberate-break: usunąć `AND user_id = ?`
  z `SELECT` w `situations.ts:266` → 204 i wiersz Boba znika.

#### 2. Fiszki

**Plik**: `api/src/routes/flashcards.integration.test.ts` (nowy; `describe('Ryzyko #3: cudze dane (IDOR)')`)

**Cel**: Propozycje i licznik per użytkownik; DTO bez `is_variant`/`user_id`/`status` nawet
gdy kolumna istnieje i jest ustawiona; `accept`/`DELETE` po własności; ponowna akceptacja → 404.

**Umowa** (`afterEach(resetDb)`; nagłówek pliku jak w `situations.integration.test.ts`):
- **T3.6 `GET /flashcards/proposals` → tylko własne propozycje o kluczach DTO, licznik tylko
  własnych generowań**: Alice: sytuacja `done`/`flashcards_status: 'done'` z fiszką `proposed`
  zasianą z `isVariant: true` i drugą `accepted`; druga sytuacja Alice `done`/`pending`
  (generująca, DEFAULT dziś); Bob: sytuacja `done`/`pending` z fiszką `proposed`. Odpowiedź
  Alice: `proposals` `ids` równe `[aliceProposedId]` (bez `accepted`, bez Boba); dla każdej
  `keysOf(card)` `toEqual(FLASHCARD_DTO_KEYS)` (brak `is_variant` mimo `1` w D1);
  `generatingCount === 1`. Deliberate-breaks: dopisać `is_variant` do `SELECT` w
  `flashcards.ts:38`; osobno usunąć `user_id = ? AND` z `:47` (licznik 2).
- **T3.7 `POST /flashcards/:id/accept` cudzy id → 404 i fiszka ofiary nadal `proposed`; własny
  → 200 z pustym ciałem i fiszka znika z propozycji; ponowna akceptacja własnej → 404**:
  Alice `acceptFlashcard(bobCardId)` → `404`, `readFlashcard(bobCardId).status === 'proposed'`;
  Alice `acceptFlashcard(aliceCardId)` → `200`, `await res.text() === ''`,
  `readFlashcard(aliceCardId).status === 'accepted'`, `getProposals` bez tej karty; ponownie
  → `404`, status nadal `accepted`. Deliberate-break: usunąć `AND user_id = ?` z
  `flashcards.ts:64` → cudza akceptacja `200`.
- **T3.8 `DELETE /flashcards/:id` cudzy id → 404 i fiszka ofiary zostaje; własny → 204 i
  wiersz znika**: analogicznie; deliberate-break: usunąć `AND user_id = ?` z `flashcards.ts:86`.

#### 3. Konto

**Plik**: `api/src/routes/auth.integration.test.ts` (nowy; `describe('Ryzyko #3: cudze dane (IDOR)')`)

**Cel**: `GET /auth/me` oddaje dane z tokenu i dokładnie kontrakt `AuthUser`.

**Umowa**:
- **T3.9 `GET /auth/me` → dane użytkownika z tokenu, klucze dokładnie `{ user: { id, email } }`**:
  Bob zasiany **przed** Alice; `getMe(alice.token)` → `200`, `keysOf(body)` `toEqual(['user'])`,
  `keysOf(body.user)` `toEqual(AUTH_USER_DTO_KEYS)`, `body.user.id === alice.id`,
  `body.user.email` zawiera `alice-`. Deliberate-breaks: `SELECT *` w `auth.ts:91`
  (`password_hash`, `created_at`); osobno usunąć `WHERE id = ?` (pierwszy wiersz = Bob).

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `cd api && npx vitest run -t "Ryzyko #3"` zielone: T3.1–T3.9 (w tym 14 przypadków macierzy
  z Fazy 2)
- `cd api && npm test` w całości zielone
- `cd api && npm run typecheck` zielone
- `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` puste

#### Weryfikacja ręczna:

- Deliberate-breaks T3.4–T3.9 wykonane (każda nazwana zmiana czerwieni dokładnie swój test),
  kod przywrócony, suite zielone
- Smoke przez `wrangler dev` na porcie 3030 (`lessons.md`): dwa konta z `POST /auth/register`,
  konto A próbuje `DELETE /situations/<id konta B>` → 404, B nadal widzi swoją sytuację

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 4. Czerwony test
przed deliberate-break = powrót do `/10x-plan`, nie poprawka.

---

## Faza 4: Ryzyko #6 — dzień lokalny jako wyrocznia PRD (`it.fails`) + follow-up

### Przegląd

Tabela ośmiu jawnych chwil UTC dla czasów Warszawy po obu stronach obu przejść DST; cztery
wiersze inkluzji jako `it.fails.each`, cztery wiersze ekskluzji jako `it.each`-strażnik;
`vi.setSystemTime` z jawnym sprzątaniem; follow-up bez wyboru poprawki.

### Wymagane zmiany:

#### 1. Testy ryzyka #6

**Plik**: `api/src/routes/situations.integration.test.ts` (`describe('Ryzyko #6: dzień liczony w UTC')`)

**Cel**: Zakodować „sytuacja należy do dnia użytkownika (Europe/Warsaw), nie do dnia UTC, w
liście dnia i w liczniku generowania, niezależnie od DST” bez asercji na offsecie i bez
wyboru Fix A/B; być poprawnym także po wejściu reguły wieku `pending`.

**Umowa** (`afterEach(() => vi.useRealTimers())` w tym `describe`; jeden użytkownik per test;
zasiew `status: 'done'`, `flashcardsStatus: 'pending'`, `transcript` niepusty — wiersz jest
jednocześnie „na liście” i „generujący”):
- Tabela `DAY_CASES` (stałe pliku), każdy wiersz z komentarzem czasu lokalnego i offsetu;
  kolumny `label`, `createdAt` (string SQL UTC), `now` (ISO `Z`):

  | Kierunek | Data lokalna | `createdAt` (UTC) = czas lokalny | `now` (UTC) = czas lokalny | Oczekiwanie |
  |---|---|---|---|---|
  | A | 2026-03-28 (CET, dzień przed 03-29) | `2026-03-27 23:59:30` = 00:59:30 CET 03-28 | `2026-03-28T00:00:30Z` = 01:00:30 CET | na liście, licznik 1 |
  | A | 2026-03-30 (CEST, dzień po) | `2026-03-29 23:59:30` = 01:59:30 CEST 03-30 | `2026-03-30T00:00:30Z` = 02:00:30 CEST | na liście, licznik 1 |
  | A | 2025-10-25 (CEST, dzień przed 10-26) | `2025-10-24 23:59:30` = 01:59:30 CEST 10-25 | `2025-10-25T00:00:30Z` = 02:00:30 CEST | na liście, licznik 1 |
  | A | 2025-10-27 (CET, dzień po) | `2025-10-26 23:59:30` = 00:59:30 CET 10-27 | `2025-10-27T00:00:30Z` = 01:00:30 CET | na liście, licznik 1 |
  | B | 2026-03-28 | `2026-03-27 22:30:00` = 23:30 CET 03-27 | `2026-03-27T23:30:00Z` = 00:30 CET 03-28 | poza listą, licznik 0 |
  | B | 2026-03-30 | `2026-03-29 21:30:00` = 23:30 CEST 03-29 | `2026-03-29T22:30:00Z` = 00:30 CEST 03-30 | poza listą, licznik 0 |
  | B | 2025-10-25 | `2025-10-24 21:30:00` = 23:30 CEST 10-24 | `2025-10-24T22:30:00Z` = 00:30 CEST 10-25 | poza listą, licznik 0 |
  | B | 2025-10-27 | `2025-10-26 22:30:00` = 23:30 CET 10-26 | `2025-10-26T23:30:00Z` = 00:30 CET 10-27 | poza listą, licznik 0 |

  Kierunek A: ten sam dzień lokalny, północ UTC między nagraniem a odczytem, wiek 60 s (poniżej
  progu reguły wieku). Kierunek B: nagranie 23:30 lokalnie, odczyt 00:30 następnego dnia
  lokalnie, ten sam dzień UTC. Chwile policzone przez ICU dla `Europe/Warsaw`; przejścia:
  2026-03-29 01:00Z, 2025-10-26 01:00Z (jesień 2026 pominięta celowo — przyszłość względem
  realnego zegara, zob. „Krytyczne szczegóły”).
- **T6.1 `it.fails.each(DAY_CASES.filter(A))` — `$label`: nagranie po lokalnej północy przed
  północą UTC jest na liście „dziś” i liczy się jako generujące**: `seedSituation(…, { createdAt })`
  → `vi.setSystemTime(new Date(now))` → `getSituations` zawiera `id`; `getProposals().generatingCount === 1`.
  Dziś czerwony z definicji (SQL `date('now')` = realny dzień); po Fix A/B przechodzi, `it.fails`
  zgłosi błąd i wymusi zmianę na `it` — bez przepisywania asercji (Fix A: `request.ts` dołoży
  granice dnia z `Date.now()` w `Europe/Warsaw`; Fix B: nic poza `setSystemTime`).
- **T6.2 `it.each(DAY_CASES.filter(B))` — `$label`: nagranie 23:30 czasu Warszawy po lokalnej
  północy nie jest na liście „dziś” i nie liczy się**: te same kroki, oczekiwania odwrotne.
  Dziś zielony (data zasiewu nie jest realnym „dziś”), pełny sygnał po poprawce (łapie np.
  stały offset +1 latem). Deliberate-break: usunąć `AND date(created_at) = date('now')` z
  `situations.ts:249` i `flashcards.ts:47` → 4 wiersze czerwone.
- Komentarz nad `describe`: skąd tabela (PRD US-01, FR-006, FR-009; §2 ryzyko #6), dlaczego
  A/B mają różne modyfikatory, odnośnik do `follow-ups/local-day-boundary.md`, reguła
  przenośności („asercje tylko na UTC lub jawnym `timeZone`; izolat na Windows = strefa hosta,
  w CI UTC”).

#### 2. Follow-up dnia lokalnego

**Plik**: `context/changes/testing-route-contracts-ownership-day/follow-ups/local-day-boundary.md` (nowy)

**Cel**: Utrwalić wyrocznię, obie opcje poprawki bez wyboru i warunek zamknięcia, żeby
`it.fails` nie stał się trwałym wyjątkiem.

**Umowa**: Sekcje: **Źródło** (§2 #6; S-01 F1 `PENDING` z `archive/2026-06-07-capture-situation-by-voice/reviews/impl-review.md`;
S-02 F4 `PENDING`; PRD `prd.md:44-46, 71, 79, 101`); **Zakodowane jako** (T6.1 `it.fails.each`
4 wiersze, T6.2 `it.each` 4 wiersze; zakaz `it.skip`); **Wyrocznia** (dzień użytkownika =
`Europe/Warsaw`; złożona z regułą wieku: „sytuacja generująca, młodsza niż próg, liczy się
wtedy i tylko wtedy, gdy jej dzień lokalny to dziś”; lista i licznik tą samą regułą — S-02 F4);
**Opcje** (Fix A: klient przekazuje granice dnia lokalnego, serwer filtruje zakresem
`[start, koniec)`; blind spot: zaufanie zegarowi klienta; skutek testowy: jeden helper w
`request.ts` liczy granice z `Date.now()` i jawnego `timeZone`. Fix B: serwer liczy dzień przez
`Intl.DateTimeFormat` z jawnym `timeZone: 'Europe/Warsaw'`; blind spot: użytkownicy poza PL;
skutek testowy: żaden. Bez rekomendacji — decyzja produktowa); **Przenośność** (SQL `now` =
realny UTC; `vi.setSystemTime` tylko JS; izolat na Windows = strefa hosta, CI = UTC; nigdy
`getHours()`/`toLocale*` bez `timeZone`); **Sprzężenie z regułą wieku** (oba filtry w tych
samych dwóch zapytaniach; T6.1 ma wiek 60 s właśnie dlatego; T1.3 po zmianie na `it` musi
uwzględnić dzień); **Kryterium zamknięcia** (T6.1 zmienione na `it` i zielone; T6.2 zielone;
`npm test` zielone; wpis w §6.7); **Sugerowany moment** (slice rozstrzygający S-01 F1 —
najbliższy dotykający `situations.ts`, np. S-04 — albo chore po Fazie 2).

#### 3. Odnośniki z Fazy 1

**Plik**: `api/src/routes/situations.integration.test.ts` (komentarz nad T1.3)

**Cel**: Okno północy UTC w T1.3 wskazuje na konkretny follow-up, nie na „Fazę 2”.

**Umowa**: Zdanie „Okno północy UTC … (ryzyko #6, Faza 2 wdrożenia)” zastąpione odnośnikiem
do `follow-ups/local-day-boundary.md` tej zmiany.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `cd api && npx vitest run -t "Ryzyko #6"` pokazuje 4 expected-fail (T6.1) + 4 zielone (T6.2)
- `cd api && npm test` w całości zielone (T1.3 + 4× T6.1 jako expected-fail)
- `cd api && npm run typecheck` zielone
- Plik `follow-ups/local-day-boundary.md` istnieje
- `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` puste

#### Weryfikacja ręczna:

- Deliberate-break T6.2 (filtr dnia usunięty z obu zapytań) → 4 wiersze czerwone; kod
  przywrócony, suite zielone
- Brak przecieku zegara: `npx vitest run src/routes/situations.integration.test.ts` daje ten
  sam wynik co cały suite (T1.4 i T3.x nie widzą fałszywej daty)

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 5. Jeśli
którykolwiek wiersz T6.1 **przechodzi** (Vitest: „expected test to fail”), zasiew lub odczyt są
zepsute — sprawdź test właściwości zasiewu z Fazy 1, nie zmieniaj modyfikatora.

---

## Faza 5: Książka kucharska §6.3 i §6.4 + notatka §6.7

### Przegląd

Kanoniczna odpowiedź na „jak dodać test własności/401 dla nowej trasy” i „jak testować
zachowanie zależne od dnia/czasu”; notatka z tego, czego faza nauczyła; zamknięcie `change.md`.
Bez nowego kodu, bez edycji §1–§5.

### Wymagane zmiany:

#### 1. §6.3 — test nowego endpointu (własność, izolacja, 401/404)

**Plik**: `context/foundation/test-plan.md` (sekcja `### 6.3`)

**Cel**: Wzorzec, który S-04/S-05 skopiują bez czytania tej zmiany.

**Umowa**: Punkty w stylu §6.2: **Location** (macierz 401: `api/src/middleware/auth.integration.test.ts`;
własność/DTO: `api/src/routes/<route>.integration.test.ts`; helpery `request.ts` (`call`,
`audioForm`, helpery tras), `db.ts` (`seedSituation`, `seedFlashcard`, `readFlashcard`,
`readSituationsOf`, `withWriteTripwire`), `dto.ts`); **Naming** (`describe('Ryzyko #3: cudze
dane (IDOR)')`; `T3.<n>` + skutek; w macierzy `$name` z tabeli); **Reference test** (T3.1/T3.2
jako wzorzec „401 + skutek + tripwire”, T3.3 jako strażnik kompletności, T3.7 jako wzorzec
„cudze → 404 + ramię kontrolne + ponowna operacja”, T3.6 jako wzorzec dokładnego zbioru
kluczy z `is_variant=1`); **Run locally** (`cd api && npx vitest run -t "Ryzyko #3"`;
plik macierzy osobno); **Reguły**: nowa trasa chroniona = wiersz w `PROTECTED_ROUTES` (T3.3
wymusza) + test cudzego id w pliku trasy z ramieniem kontrolnym + kształt w `dto.ts` (lustro
`src/lib/api.ts`, zmieniać oba naraz); 404 nie 403 (bez wyroczni istnienia); DTO zawsze jako
dokładny zbiór kluczy, nigdy `not.toHaveProperty`; nigdy asercji na tekście SQL ani wywołaniach
bindingu; tripwire zakładać po zasiewie; kryptografii tokenu nie testować na trasach (§7);
dwóch użytkowników per test jest tanie (`seedUser` z unikalnym e-mailem, `resetDb` sprząta).

#### 2. §6.4 — test zachowania zależnego od dnia lub czasu

**Plik**: `context/foundation/test-plan.md` (sekcja `### 6.4`)

**Cel**: Uniknąć powtórki odkryć z badania przy każdym przyszłym teście czasu.

**Umowa**: **Location** (`describe('Ryzyko #6 …')` w pliku trasy; `seedSituation`/`toSqlDatetime`
w `db.ts`); **Naming** (`T6.<n>`; wiersze tabeli z etykietą czasu lokalnego i offsetu);
**Reference test** (T6.1 jako wzorzec `it.fails.each` na tabeli wyroczni; T6.2 jako wzorzec
wiersza-strażnika; T1.3/T1.4 jako wzorzec wieku względem realnego zegara); **Run locally**
(`cd api && npx vitest run -t "Ryzyko #6"`); **Reguły**: „SQL `now` to realny UTC; `vi.setSystemTime`
steruje tylko `Date` w JS; izolat na Windows ma strefę hosta, w CI UTC — asercje wyłącznie na
UTC lub jawnym `timeZone`”; jedyną dźwignią po stronie SQL jest jawny `created_at`; nigdy
`datetime('now', '-N seconds')` w testach dnia (okno północy UTC); wyrocznia z PRD jako jawna
tabela „czas lokalny ↔ chwila UTC”, nigdy offset w asercji; daty tabeli w przeszłości względem
realnego zegara; wiersz musi dziś padać, żeby był `it.fails` — wiersze przechodzące trywialnie
to `it` z nazwanym deliberate-break; kształt żądania (ewentualne granice dnia) tylko w
`request.ts`; `afterEach(() => vi.useRealTimers())` przy każdym `setSystemTime` (`restoreAllMocks`
go nie cofa); wiersze, które muszą „liczyć się”, siać w wieku poniżej progu reguły wieku
`pending` (2 min); **Uwaga**: strefy nie da się ustawić przenośnie w izolacie
(plugin 1.1.3 nie przekazuje `unsafeRuntimeEnv`).

#### 3. Notatka §6.7 i nagłówek

**Plik**: `context/foundation/test-plan.md` (sekcja `### 6.7`, linia `Last updated` w preambule)

**Cel**: Odnotować, czego faza nauczyła; nie dotykać §1–§5.

**Umowa**: Blok „**Faza 2 — Kontrakty tras: własność, izolacja, dzień** (zamknięta <data>;
`context/changes/testing-route-contracts-ownership-day/`)”, 3–5 linii: chronionych tras jest
7, nie 8 (T3.3 pilnuje liczby); `it.fails` przyjmuje tylko wiersze, które dziś padają — pod
realnym `date('now')` są to wyłącznie inkluzje, stąd 4 + 4 i jesienne przejście 2025 zamiast
2026; tripwire `RAISE(ABORT)` jako obserwowalny dowód „bez zapisu”; wynik deliberate-breaks
(które testy i jak czerwone); zaparkowane obserwacje (token usuniętego użytkownika → 500 na
`POST /situations`; text/plain 404 z tokenem na niedopasowanej ścieżce; brak `exp`) jako
kandydaci do `--refresh`. `Last updated` = data zamknięcia fazy. **Żadnej edycji** w §1–§5
(status wiersza 2 tabeli §3 i liczniki §4 przestawia orkiestrator).

#### 4. Zamknięcie zmiany

**Plik**: `context/changes/testing-route-contracts-ownership-day/change.md`

**Cel**: Stan zmiany odzwierciedla zakończenie wdrożenia.

**Umowa**: `updated:` = data zamknięcia; `status` zgodnie z konwencją `/10x-implement`; w
`## Notes` dopisek: „Faza zamknięta; follow-up: `follow-ups/local-day-boundary.md`; 7 tras
chronionych (nie 8)”.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `grep -c "TBD — see §3 Phase 2" context/foundation/test-plan.md` = 0
- `git diff -U0 -- context/foundation/test-plan.md | grep '^@@'` — każdy hunk poza linią
  `Last updated` leży za nagłówkiem `## 6. Cookbook Patterns` (§1–§5 nietknięte)
- `cd api && npm test` zielone (bez zmian względem Fazy 4)

#### Weryfikacja ręczna:

- §6.3 przeczytane „na świeżo”: osoba bez kontekstu potrafi dodać wiersz macierzy i test
  cudzego id dla hipotetycznego `GET /flashcards/accepted` (S-05)
- §6.4 przeczytane „na świeżo”: wiadomo, dlaczego `vi.setSystemTime` nie wystarcza i co zrobić
  zamiast `datetime('now', …)`

**Uwaga implementacyjna**: Po tej fazie plan jest w pełni `[x]`; kolejne uruchomienie
`/10x-test-plan` przestawi wiersz 2 tabeli §3 na `complete` i przejdzie do wiersza 3.

---

## Strategia testowania

### Testy jednostkowe:

- Bez nowych; `api/src/lib/jwt.test.ts` pozostaje jedynym miejscem testów kryptografii tokenu
  (§7). Macierz 401 celowo używa tylko dwóch wariantów.

### Testy integracyjne:

- `api/test/harness.test.ts`: +2 właściwości harnessu (zasiew 1:1, tripwire uzbrojony);
  asercja DTO `POST /situations` jako dokładny zbiór kluczy.
- `api/src/middleware/auth.integration.test.ts`: T3.1, T3.2 (7 tras × 2), T3.3 (kompletność).
- `api/src/routes/situations.integration.test.ts`: T3.4, T3.5; T6.1 (`it.fails.each` ×4),
  T6.2 (`it.each` ×4); T1.3/T1.4 na `seedSituation`.
- `api/src/routes/flashcards.integration.test.ts`: T3.6, T3.7, T3.8.
- `api/src/routes/auth.integration.test.ts`: T3.9.
- Każdy test ma nazwany deliberate-break; T6.1 jako `it.fails`.

### Kroki testowania ręcznego:

1. Faza 2: DB-A…DB-D — każdy czerwieni oczekiwane wiersze; przywrócić.
2. Faza 3: deliberate-breaks T3.4–T3.9; smoke dwóch kont przez `wrangler dev` na porcie 3030.
3. Faza 4: usunąć filtr dnia z obu zapytań → T6.2 czerwone; przywrócić; plik osobno vs suite —
   ten sam wynik.
4. Faza 5: §6.3/§6.4 czytane na świeżo.

## Uwagi dotyczące wydajności

- Trzy nowe pliki testowe = trzy nowe izolaty workerd (rzędu sekundy każdy); macierz 401 to
  15 przypadków z zasiewem 2 wierszy i 6 triggerów każdy — ułamki sekund. Oczekiwany suite
  ~8–12 s lokalnie; próg alarmowy z Fazy 1 (~30 s) niezagrożony.
- `it.fails` nie czeka na timeout — pada natychmiast na asercji.

## Uwagi dotyczące migracji

- Brak zmian schematu i kodu produkcyjnego; deploy niepotrzebny.
- Refaktor testów Fazy 1 (`seedPending` → `seedSituation`, typ DTO z `dto.ts`) nie zmienia
  ich oczekiwań; T1.3 pozostaje `it.fails` z tym samym oknem północy UTC.
- Po wejściu poprawki dnia (follow-up): T6.1 `it.fails` → `it`; przy Fix A dodatkowo jeden
  helper w `request.ts`. Po wejściu reguły wieku (follow-up Fazy 1): T6.1 bez zmian (wiek 60 s).

## Referencje

- Powiązane badania: `context/changes/testing-route-contracts-ownership-day/research.md`
- Umowa jakościowa: `context/foundation/test-plan.md` §2 (ryzyka #3, #6), §6.2 (harness), §7
- Decyzje w archiwum: `context/archive/2026-06-07-capture-situation-by-voice/plan.md:147` (404,
  nie 403), `reviews/impl-review.md` F1 (dzień w UTC, `PENDING`);
  `context/archive/2026-06-07-gated-ai-flashcard-generation/plan.md:165-168` (kontrakty
  `accept`/`DELETE`, DTO bez `status`/`user_id`), `reviews/impl-review.md` F4 (`generatingCount`,
  `PENDING`); `context/archive/2026-06-09-same-context-variants/plan.md:20` (`is_variant` nie
  w DTO); `context/archive/2026-09-03-testing-worker-harness-background-jobs/follow-ups/stale-pending-server-rule.md`
  (reguła wieku obejmuje licznik)
- PRD: `context/foundation/prd.md:44-46` (US-01), `:71` (FR-006), `:79` (FR-009), `:101`,
  `:105` (Access Control), `:117` (Open Question #2)
- Kontrakt z frontem: `src/lib/api.ts:24-27` (`AuthUser`), `:125-134` (`Situation`),
  `:180-188` (`Flashcard`)
- Kryptografia tokenu: `api/src/lib/jwt.test.ts`
- Lekcje: `context/foundation/lessons.md` (port 3030 dla `wrangler dev`)

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dodaj ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków. Zobacz `references/progress-format.md`.

### Faza 1: Helpery harnessu

#### Automatyczne

- [x] 1.1 `npm run typecheck` zielone z `test/dto.ts` — 7f75214
- [x] 1.2 `npm test` zielone: 31 + 2 testy właściwości, T1.3 expected-fail — 7f75214
- [x] 1.3 Brak `datetime('now'` w helperach i plikach testowych; `seedPending` nie istnieje — 7f75214
- [x] 1.4 Zero zmian w `api/src` poza `*.test.ts` — 7f75214

#### Ręczne

- [x] 1.5 Nagłówki `request.ts`/`db.ts`/`dto.ts` mówią, gdzie żyje kształt żądania i lustro DTO — 7f75214

### Faza 2: Ryzyko #3 — brama 401 na każdej chronionej trasie

#### Automatyczne

- [x] 2.1 `npx vitest run src/middleware/auth.integration.test.ts` zielone: 14 przypadków + kompletność — 734a034
- [x] 2.2 `npm test` w całości zielone — 734a034
- [x] 2.3 `npm run typecheck` zielone — 734a034
- [x] 2.4 Zero zmian w `api/src` poza `*.test.ts` — 734a034

#### Ręczne

- [x] 2.5 Deliberate-breaks DB-A, DB-B, DB-C, DB-D wykonane, kod przywrócony — 734a034

### Faza 3: Ryzyko #3 — własność i kształt DTO per trasa

#### Automatyczne

- [x] 3.1 `npx vitest run -t "Ryzyko #3"` zielone: T3.1–T3.9 — 98ce07b
- [x] 3.2 `npm test` w całości zielone — 98ce07b
- [x] 3.3 `npm run typecheck` zielone — 98ce07b
- [x] 3.4 Zero zmian w `api/src` poza `*.test.ts` — 98ce07b

#### Ręczne

- [x] 3.5 Deliberate-breaks T3.4–T3.9 wykonane, kod przywrócony — 98ce07b
- [x] 3.6 Smoke dwóch kont przez `wrangler dev` (3030): cudzy `DELETE` → 404 — 98ce07b

### Faza 4: Ryzyko #6 — dzień lokalny jako wyrocznia PRD (`it.fails`) + follow-up

#### Automatyczne

- [x] 4.1 `npx vitest run -t "Ryzyko #6"`: 4 expected-fail (T6.1) + 4 zielone (T6.2)
- [x] 4.2 `npm test` w całości zielone
- [x] 4.3 `npm run typecheck` zielone
- [x] 4.4 `follow-ups/local-day-boundary.md` istnieje
- [x] 4.5 Zero zmian w `api/src` poza `*.test.ts`

#### Ręczne

- [x] 4.6 Deliberate-break T6.2 (filtr dnia usunięty) → 4 czerwone, kod przywrócony
- [x] 4.7 Plik `situations` osobno vs cały suite — ten sam wynik (brak przecieku zegara)

### Faza 5: Książka kucharska §6.3 i §6.4 + notatka §6.7

#### Automatyczne

- [ ] 5.1 Brak `TBD — see §3 Phase 2` w `test-plan.md`
- [ ] 5.2 Diff `test-plan.md` tylko w §6 i linii `Last updated`
- [ ] 5.3 `npm test` zielone

#### Ręczne

- [ ] 5.4 §6.3 przeczytane na świeżo: wystarcza do testu hipotetycznej trasy S-05
- [ ] 5.5 §6.4 przeczytane na świeżo: wiadomo, czemu `setSystemTime` nie wystarcza

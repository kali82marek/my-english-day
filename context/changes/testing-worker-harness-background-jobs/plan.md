# Faza 1 wdrożenia testów: harness Workerów i zadania w tle — Plan implementacji

## Przegląd

Budujemy harness testów integracyjnych dla Workera API (workerd przez
`@cloudflare/vitest-plugin` v1 na Vitest 4.1, izolowane D1 zbudowane wyłącznie z
`api/migrations/`, jawne sekrety testowe, mock OpenAI na krawędzi sieci, deterministyczna
kontrola zadania tła przez `waitOnExecutionContext`) i piszemy na nim testy, które
**dowodzą** ryzyk #1, #2 i #4 z `context/foundation/test-plan.md` §2. Tam, gdzie test
kodujący zachowanie z PRD ujawnia, że dzisiejszy kod go nie spełnia, plan zawiera trzy
małe, już zdecydowane w archiwum poprawki w `api/src/routes/situations.ts` (obsługa błędu
zapisu w POST, atomowy zapis kart przez `DB.batch`, rozdzielenie `try` tak, by nic po
`done` nie nadpisywało stanu). Serwerowa reguła wieku `pending` (próg 2 minuty) jest
zakodowana jako `it.fails` z follow-upem, bo jej realizacja to decyzja produktowa poza tą
zmianą.

Plan kończy się podfazą, która wypełnia §6.2 książki kucharskiej w `test-plan.md`,
dopisuje notatkę do §6.7 i przestawia wiersz 1 tabeli §3 na `complete`.

## Analiza obecnego stanu

Szczegóły i permalinki: `context/changes/testing-worker-harness-background-jobs/research.md`.

- **Harness**: `api/vitest.config.ts` biegnie w środowisku `node`, bez bindingów. Cztery
  pliki testowe (20 testów) w `api/src/lib/` używają wyłącznie Web Crypto i wzorca
  `vi.spyOn(globalThis, 'fetch')`. Zero testów tras, migracji, zadania tła.
  Zainstalowane: vitest 3.2.6, wrangler 4.95, Node 24. Pluginu Cloudflare brak.
- **Wersje**: `@cloudflare/vitest-plugin@1.1.3` wymaga `vitest ^4.1`; jedyna ścieżka na
  Vitest 3 to nieutrzymywany `vitest-pool-workers@0.12`. Decyzja: podnieść Vitest do 4.1.
  W v1 nie ma `isolatedStorage` (izolacja tylko per plik testowy) ani `fetchMock`
  (zastępuje go `vi.spyOn`). Plugin **automatycznie ładuje `api/.dev.vars`** z prawdziwym
  kluczem OpenAI, gdy podano `wrangler.configPath`.
- **Zadanie tła** (`api/src/routes/situations.ts`): jeden łańcuch
  `POST /situations` → `R2.put` → `INSERT` (bez `try`) → `waitUntil(transcribeAndFinalize)`
  → `generateAndStoreFlashcards`. Karty zapisywane pętlą `.run()` po jednej (każda w
  osobnej niejawnej transakcji). `R2.delete` i propagowany wyjątek z generowania siedzą w
  tym samym `try`, którego `catch` pisze `status='failed'`, więc błąd **po** `done`
  nadpisuje `done` na `failed` mimo zapisanego transkryptu. Odrzucona obietnica w
  `waitUntil` (np. gdy `UPDATE 'failed'` w `catch` sam rzuci) zostawia wieczny `pending`.
- **Lista dnia**: `GET /situations` oddaje `status` surowo; serwer nie zna wieku `pending`.
  Klient maskuje to lokalnym postarzaniem po 60 s (`ORPHAN_MS`).
- **Migracje**: cztery pliki z twardą kolejnością (0003 `ALTER` na tabeli z 0002, 0004
  `ALTER` na tabeli z 0003). Kod wymienia `flashcards_status` (0003) i `is_variant`
  (0004). Brak CI; deploy ręczny.
- **Wstrzyknięcie błędu D1 „w środku zapisu”**: wzorzec `CREATE TRIGGER ... BEGIN SELECT
  RAISE(ABORT, ...); END` złożony z udokumentowanych klocków, ale niesprawdzony w repo na
  miniflare 5.x. Awarii R2 nie da się wstrzyknąć bez mockowania od środka.

## Pożądany stan końcowy

Po zakończeniu planu `cd api && npm test` uruchamia **wszystkie** testy API w workerd
(istniejące 20 jednostkowych + nowe integracyjne) na D1 zbudowanym od zera z
`api/migrations/`, bez dostępu do sieci i bez `api/.dev.vars`. Suite jest zielone i może
być bramką „unit + integration (api)” z §5 planu testów. Konkretnie:

- Ryzyko #1: nieudana transkrypcja kończy się `status='failed'` bez odrzuconej obietnicy;
  nieudany `INSERT` w POST zwraca JSON 500 z polem `error`, nie zostawia wiersza ani pliku
  w R2. Reguła „`pending` starszy niż 2 minuty jest z listy widoczny jako `failed`” jest
  zakodowana jako `it.fails` (czerwona z definicji do czasu follow-upu).
- Ryzyko #2: po udanej transkrypcji albo wszystkie karty są `proposed` i
  `flashcards_status='done'`, albo zero kart i `failed`; transkrypt i `status='done'`
  przeżywają każdy błąd generowania i zapisu stanu; zadanie tła nigdy nie kończy się
  odrzuconą obietnicą po zapisaniu `done`.
- Ryzyko #4: każdy test integracyjny biegnie na schemacie zbudowanym wyłącznie z
  migracji; usunięcie migracji 0004 obala suite (weryfikacja ręczna, deliberate-break).
- `test-plan.md` §6.2 opisuje, jak dodać test integracyjny; §3 wiersz 1 = `complete`.

Weryfikacja: kryteria sukcesu każdej fazy poniżej + sekcja `## Postęp`.

### Kluczowe odkrycia:

- `api/src/routes/situations.ts:171-181` — `INSERT ... RETURNING *` przez `.first()` rzuca
  przy błędzie; gałąź `if (!row)` jest martwa, a wyjątek wychodzi bez `try` jako domyślne
  500 text/plain Hono z osieroconym plikiem R2 (brak `app.onError` w `api/src/index.ts`).
- `api/src/routes/situations.ts:79-91` — pętla `INSERT` po karcie + `UPDATE done` po pętli;
  `api/src/routes/situations.ts:118-134` — jeden `try` obejmuje Whisper, `UPDATE done`,
  generowanie i `R2.delete`.
- `api/src/lib/flashcards.ts:119-124` — generator rzuca na pustą listę; to jedyny punkt,
  który dziś sprawia, że `done` implikuje ≥1 kartę.
- `api/src/routes/flashcards.ts:46-50` — `generatingCount` liczy `status='done' AND
  flashcards_status='pending'` z dnia bieżącego UTC.
- `api/src/lib/jwt.ts:18-23` — `signSession(userId, secret)`; najtańsze zasianie
  użytkownika to `INSERT INTO users (email, password_hash)` + `signSession`.
- Wzorzec mocka sieci do przeniesienia 1:1: `api/src/lib/flashcards.test.ts:4-14`
  (`chatResponse`) i `api/src/lib/transcription.test.ts:1-9` (Whisper zwraca `text/plain`).
- Ścieżka `app.fetch(req, env, ctx)` + `createExecutionContext()` +
  `waitOnExecutionContext(ctx)` z `cloudflare:test` czeka na wszystko, co trafiło do
  `ctx.waitUntil`; odrzucona obietnica rzuca. Ścieżka `exports.default.fetch` **nie** czeka
  na `waitUntil` (research §8) — nie używać do asercji na stanie D1.
- `api/tsconfig.json` ma `include: ["src/**/*.ts"]` i `types: ["@cloudflare/workers-types"]`;
  `api/worker-configuration.d.ts` jest w `.gitignore` i nie jest potrzebny (bindingi
  typowane ręcznie w `api/src/types.ts`).

## Czego NIE robimy

- Nie realizujemy serwerowej reguły wieku `pending` (Fix A z przeglądu S-01 F3) — tylko
  test `it.fails` z progiem 2 minut i follow-up. Nie zmieniamy klienta (`ORPHAN_MS`).
- Nie dodajemy globalnego `app.onError` ani obsługi błędów w innych trasach (Faza 2
  wdrożenia dotknie kontraktów tras).
- Nie symulujemy awarii R2 (wymagałoby mockowania bindingu od środka); asercje R2 to
  wyłącznie obserwacja `env.AUDIO_BUCKET.list()`.
- Nie piszemy testu snapshotu `PRAGMA table_info` ani testu tekstu SQL migracji; nie
  liczymy wierszy `d1_migrations`. Dowodem ryzyka #4 jest to, że suite biegnie wyłącznie
  na schemacie z migracji + deliberate-break.
- Nie testujemy kontraktu generatora (zdegenerowane odpowiedzi modelu, limity, `type`) —
  Faza 3 wdrożenia. Pusta lista jest tu testowana wyłącznie jako niezmiennik warstwy
  zapisu („nigdy `done` bez kart”), bez zmian w generatorze.
- Nie testujemy własności/izolacji ani granicy dnia — Faza 2 wdrożenia. Okno północy UTC
  w teście reguły wieku jest odnotowane, nie rozwiązywane.
- Nie dodajemy bezpiecznika idempotencji generowania (brak ścieżki wywołania; follow-up
  S-02 pozostaje otwarty) ani testu `MSW`; nie zmieniamy `wrangler.toml` produkcyjnego.
- Nie konfigurujemy CI, hooków ani jednego polecenia lint+typecheck+test — Faza 4
  wdrożenia i lekcje CI/hooków.
- Nie wprowadzamy drugiego projektu Vitest (`node` dla `lib/`) — wszystko biegnie w
  jednym poolu workerd.

## Podejście do implementacji

1. **Harness najpierw, jako spike**: podniesienie runnera, plugin, migracje w setupie,
   sekrety jawne, guard „niezamockowany `fetch` rzuca”, helpery. Zanim powstanie
   jakikolwiek test ryzyka, trzy fakty muszą być potwierdzone w tym repo: (a) 20
   istniejących testów biegnie w workerd, (b) `waitOnExecutionContext` obejmuje
   `c.executionCtx.waitUntil` z Hono i odrzucona obietnica obala test, (c) trigger
   `RAISE(ABORT)` przerywa `INSERT`/`UPDATE` z D1 w miniflare.
2. **Jedno ryzyko na fazę, test przed poprawką**: każdy test koduje obserwowalny skutek z
   PRD/§2 (stan wiersza w D1, odpowiedź HTTP, zawartość bucketa), nie odbicie
   implementacji. Każdy test ma nazwany **deliberate-break**: zmianę w kodzie, która musi
   go zaczerwienić. Implementator uruchamia test przed poprawką (czerwony), wprowadza
   poprawkę (zielony) i wykonuje deliberate-break przed zamknięciem fazy.
3. **Błędy D1 wstrzykiwane na krawędzi, nie od środka**: triggery SQL zakładane w teście
   na schemacie z migracji i zdejmowane w `afterEach`. Dzięki temu test „nigdy część kart
   + `failed`” jest niezależny od tego, czy poprawka to `batch`, transakcja czy sprzątanie.
4. **Poprawki minimalne i lokalne**: tylko `api/src/routes/situations.ts`, tylko to, co
   archiwum już zdecydowało (S-01 F2, S-03 follow-up `DB.batch`, S-03 F1).
5. **Książka kucharska jako ostatni krok**: §6.2 opisuje wzorzec, który faktycznie
   powstał (nie ten z research), z testem referencyjnym i poleceniem uruchomienia.

## Krytyczne szczegóły implementacji

- **Czas i cykl życia** — W teście integracyjnym asercje na stanie D1 po `201` są
  poprawne dopiero po `await waitOnExecutionContext(ctx)`; sam `await app.fetch(...)`
  wraca przed zadaniem tła. Ścieżka `exports.default.fetch` (dawne `SELF.fetch`) nie
  czeka na `waitUntil` i nie nadaje się do tych testów. `waitOnExecutionContext` porzuca
  niezakończone obietnice po 30 s z ostrzeżeniem, więc żaden mock nie może wisieć.
- **Sekwencjonowanie stanu** — Izolacja w pluginie v1 jest **per plik testowy**; zapisy
  trwają między testami w pliku. Każdy plik integracyjny sprząta w `afterEach`:
  `DROP TRIGGER IF EXISTS` dla triggerów testowych, `DELETE FROM flashcards`,
  `DELETE FROM situations`, `DELETE FROM users` (w tej kolejności, FK), obiekty w R2.
  Użytkownik zasiewany per test z unikalnym e-mailem.
- **Debugowanie i obserwowalność** — Plugin ładuje `api/.dev.vars` automatycznie.
  Harness **musi** nadpisać `OPENAI_API_KEY` i `JWT_SECRET` w `miniflare.bindings` i
  instalować w `beforeEach` spy na `globalThis.fetch`, który rzuca
  `Unmocked fetch: <url>`. Jeśli test kiedykolwiek zobaczy błąd 401 od OpenAI zamiast
  tego komunikatu, guard jest zepsuty. Weryfikacja w Fazie 1: usunąć mock z testu
  szczęśliwej ścieżki i potwierdzić komunikat guarda.
- **Pułapka triggerów D1** — `BEGIN`/`END` w `CREATE TRIGGER` wielkimi literami (issue
  workers-sdk #10998). Warunek `WHEN (SELECT COUNT(*) FROM flashcards) = 2` liczy wiersze
  z całego pliku testowego, więc trigger „przy trzeciej karcie” wymaga pustej tabeli
  `flashcards` na starcie testu (sprzątanie z punktu wyżej).
- **Okno północy UTC** — Test reguły wieku sieje `created_at = datetime('now',
  '-150 seconds')`; przez ~2,5 minuty po północy UTC wiersz wypada z listy dnia. Dziś test
  jest `it.fails`, więc to niegroźne; po realizacji follow-upu ten margines należy uwzględnić
  (odnotowane w follow-upie, rozwiązanie należy do ryzyka #6, Faza 2 wdrożenia).

## Faza 1: Harness workerd + spike

### Przegląd

Podniesienie Vitest do 4.1, instalacja `@cloudflare/vitest-plugin` v1, konfiguracja
poola workerd z migracjami i jawnymi sekretami, helpery testowe oraz plik spike'a, który
potwierdza trzy założenia harnessu. Po tej fazie 20 istniejących testów biegnie w workerd,
a `npm run typecheck` obejmuje `api/test/`.

### Wymagane zmiany:

#### 1. Zależności i skrypty

**Plik**: `api/package.json`

**Cel**: Przejść na runner wspierany przez plugin v1 i dodać plugin. Skrypt `test` bez
zmian (`vitest run`) — jedno polecenie dla wszystkich warstw.

**Umowa**: `devDependencies.vitest` = `^4.1.0`; nowa `devDependencies["@cloudflare/vitest-plugin"]`
= `^1.1.3`. Bez `@cloudflare/vitest-pool-workers`, bez MSW. `package-lock.json`
zaktualizowany przez `npm install` w `api/`.

#### 2. Konfiguracja Vitest

**Plik**: `api/vitest.config.ts`

**Cel**: Zastąpić harness `node` poolem workerd; D1 budowane z `api/migrations/`; sekrety
i zmienne jawne, niezależne od `api/.dev.vars`.

**Umowa**: `defineConfig(async () => ({ plugins: [cloudflareTest({...})], test: {...} }))`.
Plugin: `wrangler: { configPath: './wrangler.toml' }`, `miniflare.bindings`:
`TEST_MIGRATIONS: await readD1Migrations(<ścieżka do api/migrations rozwiązana względem
pliku konfiguracji>)`, `JWT_SECRET: 'test-secret'`, `OPENAI_API_KEY: 'sk-test-never-real'`,
`ENVIRONMENT: 'test'`. `test.include: ['src/**/*.test.ts', 'test/**/*.test.ts']`,
`test.setupFiles: ['./test/setup.ts']`. Opcja `environment` usunięta (plugin nie wspiera
własnego środowiska/runnera). Komentarz w pliku wyjaśnia nadpisanie `.dev.vars`.

#### 3. Setup harnessu

**Plik**: `api/test/setup.ts` (nowy)

**Cel**: Zbudować schemat z migracji w każdym pliku testowym i zablokować wyjście do sieci.

**Umowa**: Na górze pliku `await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` z
`cloudflare:test` (idempotentne przez tabelę `d1_migrations`; biegnie raz na plik dzięki
izolacji per plik). `beforeEach`: `vi.spyOn(globalThis, 'fetch').mockImplementation(...)`
rzucający `Error('Unmocked fetch: ' + url)`. `afterEach`: `vi.restoreAllMocks()`.
Niezmiennik: testy `lib/`, które same wołają `vi.spyOn(globalThis, 'fetch')
.mockResolvedValue(...)`, nadpisują implementację guarda (Vitest reużywa istniejącego
spy'a). Jeśli spike pokaże, że tak nie jest, guard przenosi się do helpera `mockOpenAI`
(punkt 5), a setup zostaje z samymi migracjami — decyzja odnotowana w §6.7.

#### 4. Typy i tsconfig

**Plik**: `api/test/env.d.ts` (nowy), `api/tsconfig.json`

**Cel**: `env` z `cloudflare:test` typowany jako `Bindings` + `TEST_MIGRATIONS`; katalog
`test/` objęty `npm run typecheck`.

**Umowa**: `tsconfig.compilerOptions.types` = `["@cloudflare/workers-types",
"@cloudflare/vitest-plugin/types"]`; `include` = `["src/**/*.ts", "test/**/*.ts"]`.
`env.d.ts` rozszerza typ środowiska testowego o `TEST_MIGRATIONS:
import('cloudflare:test').D1Migration[]` w kształcie wymaganym przez `types` pluginu
(w docs v1: `declare namespace Cloudflare { interface Env {...} }`; w starym poolu:
`declare module 'cloudflare:test' { interface ProvidedEnv extends Bindings {...} }`) —
implementator wybiera ten, który plugin faktycznie deklaruje w swoim `.d.ts`.
`worker-configuration.d.ts` pozostaje niewymagany.

#### 5. Helpery testowe

**Plik**: `api/test/db.ts`, `api/test/openai-mock.ts`, `api/test/request.ts` (nowe)

**Cel**: Jedno miejsce na zasiewanie danych, mock OpenAI i wywołanie aplikacji z kontrolą
`waitUntil`, żeby testy ryzyk czytały się jak scenariusze, nie jak konfiguracja.

**Umowa**:
- `db.ts`: `seedUser(env, label?) → { id: number; token: string }` (bezpośredni
  `INSERT INTO users (email, password_hash)` z unikalnym e-mailem, np. z `crypto.randomUUID()`;
  token przez `signSession(id, env.JWT_SECRET)` z `api/src/lib/jwt.ts`);
  `readSituation(env, id)` → surowy wiersz `situations` lub `null`;
  `readFlashcards(env, situationId)` → tablica wierszy; `withTrigger(env, name, sql)` →
  zakłada trigger i rejestruje nazwę do zdjęcia; `resetDb(env)` → `DROP TRIGGER IF EXISTS`
  dla zarejestrowanych, `DELETE FROM flashcards`, `DELETE FROM situations`,
  `DELETE FROM users`, usunięcie wszystkich obiektów z `env.AUDIO_BUCKET`.
- `openai-mock.ts`: `whisperResponse(text, status=200)` → `Response` text/plain;
  `chatResponse(cards, status=200)` → `Response` w kształcie Chat Completions (jak w
  `api/src/lib/flashcards.test.ts`); `mockOpenAI({ transcription?, chat? })` →
  `vi.spyOn(globalThis, 'fetch').mockImplementation(...)` routujący po URL
  (`.../v1/audio/transcriptions`, `.../v1/chat/completions`); brak wpisu lub inny URL →
  rzut `Unmocked fetch: <url>`; zwraca spy do asercji na liczbie wywołań.
- `request.ts`: `postSituation(env, token, { audioBytes?, name?, durationMs? })` → buduje
  `FormData` z polem `audio` (`File`, domyślnie `nagranie.m4a`, kilka bajtów) i opcjonalnym
  `duration_ms`, `Request('http://test/situations', POST, Authorization: Bearer)`,
  `ctx = createExecutionContext()`, `res = await app.fetch(req, env, ctx)`; zwraca
  `{ res, ctx }` (wołający decyduje, czy i jak czeka na `ctx`); `getSituations(env, token)`
  i `getProposals(env, token)` → `Response` z odpowiednich tras, z własnym `ctx`.
  `app` importowane z `api/src/index.ts`.

#### 6. Spike harnessu

**Plik**: `api/test/harness.test.ts` (nowy)

**Cel**: Potwierdzić w tym repo trzy założenia, na których stoją Fazy 2–3, zanim powstaną
testy ryzyk. To testy właściwości harnessu, nie ryzyk.

**Umowa** (trzy testy, `afterEach(resetDb)`):
1. **Szczęściowa ścieżka przez cały łańcuch**: `mockOpenAI` (Whisper → tekst, chat → 2 karty,
   jedna `is_variant: true`) → `postSituation` → `201`, ciało bez `audio_key` i `user_id`,
   `status: 'pending'`, `flashcards_status: 'pending'` → `await waitOnExecutionContext(ctx)`
   → wiersz `status='done'`, `transcript` = tekst z mocka, 2 karty `status='proposed'` z
   `is_variant` 0/1, `flashcards_status='done'`, `env.AUDIO_BUCKET.list()` pusty, spy
   `fetch` wywołany dokładnie 2 razy.
2. **Trigger przerywa zapis D1**: `withTrigger` `BEFORE INSERT ON flashcards` z
   `RAISE(ABORT, 'wstrzyknięty błąd D1')` → bezpośredni `env.DB.prepare('INSERT INTO
   flashcards ...').run()` odrzuca z komunikatem zawierającym wstrzyknięty tekst; po
   `DROP TRIGGER` ten sam `INSERT` przechodzi.
3. **Odrzucona obietnica tła obala test**: trigger `BEFORE UPDATE OF status ON situations
   WHEN NEW.status = 'failed'` + Whisper `500` → `postSituation` daje `201`;
   `await expect(waitOnExecutionContext(ctx)).rejects.toThrow()`; wiersz nadal
   `status='pending'`. (Dokumentuje właściwość harnessu: nic w `waitUntil` nie ginie po
   cichu. Nie jest to test ryzyka — ten przypadek w kategoriach użytkownika pokrywa
   reguła wieku z Fazy 2.)

Deliberate-break dla spike'a: usunąć `mockOpenAI` z testu 1 → test pada z `Unmocked fetch:
https://api.openai.com/v1/audio/transcriptions` (nie z błędem 401 OpenAI).

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `cd api && npm install` kończy się bez błędów; `npm ls vitest @cloudflare/vitest-plugin`
  pokazuje 4.1.x i 1.x
- `cd api && npm test` zielone: 20 istniejących testów `lib/` + 3 testy `test/harness.test.ts`
- `cd api && npm run typecheck` zielone (obejmuje `test/**/*.ts`)
- `git status` nie pokazuje zmian w `api/.wrangler/` (testy nie dotykają lokalnego stanu dev)

#### Weryfikacja ręczna:

- Deliberate-break guarda: po usunięciu `mockOpenAI` z testu szczęśliwej ścieżki błąd
  brzmi `Unmocked fetch: ...`, nie 401/403 OpenAI; mock przywrócony
- Uruchomienie `npm test` z tymczasowo przeniesionym `api/.dev.vars` daje identyczny wynik
  (harness nie zależy od pliku); plik przywrócony
- Na Windows 11 suite kończy się bez wiszącego procesu (dopuszczalny szum `EBUSY` przy
  sprzątaniu katalogu tymczasowego nie zmienia kodu wyjścia)

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 2. Jeśli
test 3 spike'a nie odrzuca (Hono nie przekazuje `ctx`) lub test 2 nie rzuca (trigger
nieobsługiwany w miniflare), zatrzymaj się i wróć do `/10x-plan` — Fazy 2–3 zakładają
oba fakty.

---

## Faza 2: Ryzyko #1 — nagranie nie przepada

### Przegląd

Testy dowodzące, że nieudana transkrypcja kończy się widocznym `failed`, a nieudany zapis
w POST zwraca czytelny błąd bez wiersza-widma i osieroconego audio; test reguły wieku
`pending` jako `it.fails`; poprawka POST z S-01 F2; follow-up dla reguły wieku.

### Wymagane zmiany:

#### 1. Testy ryzyka #1

**Plik**: `api/src/routes/situations.integration.test.ts` (nowy; `describe('Ryzyko #1: nagranie nie przepada')`)

**Cel**: Zakodować obserwowalne skutki z §2 („co dowodzi ochrony”), niezależnie od
implementacji poprawki.

**Umowa** (`afterEach(resetDb)`, użytkownik z `seedUser` per test):
- **T1.1 Whisper odpowiada non-2xx** (`mockOpenAI({ transcription: whisperResponse('rate
  limited', 429) })`): `201`; `await waitOnExecutionContext(ctx)` **rozwiązuje się** (brak
  odrzucenia); wiersz `status='failed'`, `transcript` `null`; `getSituations` zwraca ten
  wiersz ze `status: 'failed'`; chat **nie** został wywołany (spy: 1 wywołanie).
  Deliberate-break: usunąć `UPDATE ... 'failed'` z `catch` w `transcribeAndFinalize` →
  wiersz zostaje `pending` → czerwony.
- **T1.2 Zapis wiersza pada po udanym uploadzie** (`withTrigger` `BEFORE INSERT ON
  situations` z `RAISE(ABORT, ...)`, `mockOpenAI` bez wpisów): odpowiedź `500`,
  nagłówek `content-type` zawiera `application/json`, ciało `{ error: <niepusty string> }`;
  `SELECT COUNT(*) FROM situations` dla użytkownika = 0; `env.AUDIO_BUCKET.list().objects`
  puste; `waitOnExecutionContext(ctx)` rozwiązuje się (nic nie zaplanowano); `fetch` nie
  wywołany. **Czerwony przed poprawką** (500 text/plain, plik zostaje).
  Deliberate-break: po poprawce usunąć sprzątanie R2 z `catch` → bucket niepusty → czerwony.
- **T1.3 Stary `pending` jest z listy widoczny jako `failed`** — `it.fails` z komentarzem
  wskazującym `follow-ups/stale-pending-server-rule.md`: bezpośredni `INSERT INTO
  situations (user_id, status, audio_key, created_at) VALUES (?, 'pending', ?,
  datetime('now', '-150 seconds'))` → `getSituations` → wiersz obecny ze `status: 'failed'`.
  Dziś asercja pada (serwer oddaje `pending`) → `it.fails` zielony. Po realizacji
  follow-upu test zacznie przechodzić, `it.fails` zgłosi błąd i wymusi zmianę na `it`.
- **T1.4 Świeży `pending` zostaje `pending`**: jak T1.3, ale `datetime('now', '-30 seconds')`
  → `status: 'pending'`. Zwykły `it`; chroni przed nadgorliwą przyszłą poprawką.

#### 2. Obsługa błędu zapisu w POST

**Plik**: `api/src/routes/situations.ts` (handler `POST /`)

**Cel**: Nieudany `INSERT` po udanym `R2.put` ma zwracać czytelny JSON 500 i nie zostawiać
pliku (S-01 F2). Martwa gałąź `if (!row)` znika lub staje się częścią tej samej ścieżki.

**Umowa**: `R2.put` i `INSERT ... RETURNING *` w jednym `try`; w `catch`: `console.error`,
best-effort `AUDIO_BUCKET.delete(audioKey)` we własnym `try/catch` (błąd sprzątania nie
zmienia odpowiedzi), zwrot `c.json({ error: 'Nie udało się zapisać sytuacji.' }, 500)`
(istniejący komunikat). Po `try` zachowanie bez zmian: `waitUntil` + `201`. Komentarz
nagłówkowy pliku uzupełniony o tę ścieżkę.

#### 3. Follow-up dla reguły wieku

**Plik**: `context/changes/testing-worker-harness-background-jobs/follow-ups/stale-pending-server-rule.md` (nowy)

**Cel**: Utrwalić decyzję (próg 2 minuty, uzasadnienie: 4× limit `waitUntil` 30 s po
odpowiedzi; przegląd S-01 F3 Fix A) i warunek zamknięcia, żeby `it.fails` nie zamienił się w
trwały wyjątek.

**Umowa**: Sekcje: decyzja i próg; dwie opcje realizacji (mapowanie w `GET /situations`
przy odczycie vs uzgadniający `UPDATE`; obie muszą też objąć licznik `generatingCount`
dla `done` + `flashcards_status='pending'` starszych niż próg); wpływ na klienta
(`ORPHAN_MS` 60 s → wyrównanie lub usunięcie maskowania); okno północy UTC w T1.3
(ryzyko #6); kryterium zamknięcia: T1.3 zmienione z `it.fails` na `it` i zielone;
sugerowany moment: najbliższy slice dotykający `situations.ts` (S-04) albo chore.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- Przed poprawką POST: `cd api && npx vitest run -t "Ryzyko #1"` pokazuje T1.2 czerwony,
  T1.1/T1.3/T1.4 zielone (T1.3 jako expected-fail)
- Po poprawce: `cd api && npm test` w całości zielone
- `cd api && npm run typecheck` zielone
- Plik `follow-ups/stale-pending-server-rule.md` istnieje

#### Weryfikacja ręczna:

- Deliberate-break T1.1 i T1.2 wykonane (kod przywrócony, suite zielone)
- Ręcznie przez `wrangler dev` (port 3030): upload z niepoprawnym `Authorization` daje
  401 jak dotąd; poprawny upload nadal daje `201` w czasie poniżej sekundy (poprawka nie
  zmieniła ścieżki szczęśliwej)

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 3.

---

## Faza 3: Ryzyko #2 — fiszki wszystko-albo-nic

### Przegląd

Testy dowodzące, że po udanej transkrypcji zapis kart jest atomowy, transkrypt i `done`
przeżywają każdy błąd generowania, a zadanie tła nigdy nie kończy się odrzuconą obietnicą
po `done`; poprawki: `DB.batch` (follow-up S-03) i rozdzielenie `try` (S-03 F1).

### Wymagane zmiany:

#### 1. Testy ryzyka #2

**Plik**: `api/src/routes/situations.integration.test.ts` (`describe('Ryzyko #2: fiszki wszystko-albo-nic')`)

**Cel**: Obserwować liczbę kart i stany w D1 po błędach wstrzykniętych na krawędzi OpenAI
i na krawędzi D1; niezależnie od tego, jak poprawka osiąga atomowość.

**Umowa** (Whisper zawsze zwraca tekst; `afterEach(resetDb)`):
- **T2.1 Model odpowiada non-2xx** (`chat: chatResponse(null, 500)` lub odpowiedź bez
  `choices`): `waitOnExecutionContext` rozwiązuje się; wiersz `status='done'`, `transcript`
  = tekst z mocka, `flashcards_status='failed'`; `readFlashcards` = 0; `getProposals` →
  `proposals: []`, `generatingCount: 0`; bucket pusty. Deliberate-break: zamienić kolejność
  (generowanie przed `UPDATE ... 'done'`) → transkrypt `null` → czerwony.
- **T2.2 Błąd D1 w środku zapisu** (chat → 3 karty; `withTrigger` `BEFORE INSERT ON
  flashcards WHEN (SELECT COUNT(*) FROM flashcards) = 2` z `RAISE(ABORT, ...)`):
  `readFlashcards` = **0** i `flashcards_status='failed'`; `status='done'`, transkrypt
  zachowany; `waitOnExecutionContext` rozwiązuje się. **Czerwony przed poprawką**
  (2 karty + `failed`). Deliberate-break: po poprawce wrócić do pętli `.run()` → 2 karty →
  czerwony.
- **T2.3 Zapis stanu `failed` sam pada** (chat non-2xx; `withTrigger` `BEFORE UPDATE OF
  flashcards_status ON situations WHEN NEW.flashcards_status = 'failed'`): wiersz nadal
  `status='done'` z transkryptem; `flashcards_status` pozostaje `'pending'` (nic lepszego
  nie da się zrobić); `waitOnExecutionContext` **rozwiązuje się** (błąd zalogowany, nie
  propagowany). **Czerwony przed poprawką** (zewnętrzny `catch` nadpisuje `status='failed'`).
  Deliberate-break: po poprawce usunąć wewnętrzny `try/catch` wokół `UPDATE 'failed'` →
  odrzucenie lub `status='failed'` → czerwony.
- **T2.4 Model zwraca pustą listę** (`chat: chatResponse([])`): `readFlashcards` = 0 i
  `flashcards_status='failed'` — nigdy `done` bez kart; `status='done'`. Zielony dziś
  (generator rzuca na pustą listę); deliberate-break: tymczasowo usunąć rzut na pustą
  listę w `api/src/lib/flashcards.ts` → `done` z 0 kart → czerwony (przywrócić; sam guard w
  generatorze należy do Fazy 3 wdrożenia).
- **T2.5 Sukces po pełnej ścieżce**: chat → 10 kart (limit `MAX_CARDS`) → 10 kart
  `proposed`, `flashcards_status='done'`, `generatingCount: 0`. Uzupełnia spike o górną
  granicę rozmiaru batcha (11 zapytań w jednym `batch`, poniżej limitu 50 zapytań na
  wywołanie z `infrastructure.md`).

#### 2. Atomowy zapis kart

**Plik**: `api/src/routes/situations.ts` (`generateAndStoreFlashcards`)

**Cel**: Karty i `flashcards_status='done'` zapisywane w jednej transakcji D1
(follow-up S-03 `review-fixes.md`): albo wszystko, albo nic.

**Umowa**: `env.DB.batch([...cards.map(card => prepare(INSERT ...).bind(...)),
prepare(UPDATE situations SET flashcards_status='done' WHERE id = ?).bind(id)])`;
kolejność INSERTów jak dotąd; `catch` → `UPDATE flashcards_status='failed'` owinięty
własnym `try/catch`, który tylko loguje (funkcja **nigdy nie rzuca**). Komentarz nad
funkcją opisuje gwarancję atomowości i „nigdy nie rzuca”.

#### 3. Rozdzielenie `try` w finalizacji

**Plik**: `api/src/routes/situations.ts` (`transcribeAndFinalize`)

**Cel**: Po zapisaniu `status='done'` żadna późniejsza awaria (generowanie, zapis stanu
generowania, `R2.delete`) nie może nadpisać `status` ani zostawić odrzuconej obietnicy w
`waitUntil`.

**Umowa**: Trzy niezależne kroki: (1) `try { transcribe; UPDATE transcript, status='done' }
catch { log; UPDATE status='failed' owinięty własnym try/catch (log); return }`;
(2) `await generateAndStoreFlashcards(...)` (nie rzuca po zmianie z punktu 2);
(3) `try { AUDIO_BUCKET.delete } catch { log }`. Niezmiennik: jedyny zapis `status='failed'`
to gałąź błędu transkrypcji. Komentarz nagłówkowy pliku zaktualizowany (kolejność i
gwarancje).

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- Przed poprawkami: `cd api && npx vitest run -t "Ryzyko #2"` pokazuje T2.2 i T2.3
  czerwone, T2.1/T2.4/T2.5 zielone
- Po poprawkach: `cd api && npm test` w całości zielone (20 + 3 + testy ryzyk #1 i #2)
- `cd api && npm run typecheck` zielone

#### Weryfikacja ręczna:

- Deliberate-break T2.1, T2.2, T2.3, T2.4 wykonane (kod przywrócony, suite zielone)
- Smoke przez `wrangler dev` (port 3030) i skrypt `api/scripts/test-flashcards.ps1` z
  prawdziwym kluczem: jedno nagranie → transkrypt → propozycje na ekranie Fiszki
  (poprawka batcha nie zmieniła ścieżki szczęśliwej)

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 4.

---

## Faza 4: Ryzyko #4 domknięte + książka kucharska

### Przegląd

Deliberate-break migracji jako dowód ryzyka #4, wpisy §6.2 i §6.7 w `test-plan.md`,
aktualizacja §3/§4/§5/§8 planu testów i `change.md`. Bez nowego kodu.

### Wymagane zmiany:

#### 1. Dowód ryzyka #4 (bez nowego testu)

**Plik**: `api/migrations/0004_add_flashcard_variant_flag.sql` (tylko tymczasowe
przeniesienie w weryfikacji ręcznej)

**Cel**: Pokazać, że Worker wymieniający kolumnę, której migracja nie utworzyła, obala
suite przed deployem — bez snapshotu schematu.

**Umowa**: Przenieść 0004 poza `api/migrations/`, uruchomić `npm test`: spike i testy
ryzyk padają na `INSERT` kart (`is_variant`); przywrócić plik, suite zielone. Wynik
(które testy padły, jaki komunikat) zapisany w §6.7.

#### 2. Książka kucharska §6.2

**Plik**: `context/foundation/test-plan.md` (sekcja `### 6.2`)

**Cel**: Kanoniczna odpowiedź na „jak dodać test integracyjny Workera w tym projekcie”.

**Umowa**: Punkty w stylu §6.1: **Location** (`api/src/routes/<route>.integration.test.ts`
obok trasy; helpery w `api/test/`; setup `api/test/setup.ts`); **Naming**
(`<route>.integration.test.ts`; `describe` nazwany ryzykiem z §2); **Reference test**
(`api/src/routes/situations.integration.test.ts` — T2.2 jako wzorzec „błąd D1 na krawędzi
przez trigger”, T1.2 jako wzorzec „odpowiedź + stan D1 + stan R2”; `api/test/harness.test.ts`
jako wzorzec `waitOnExecutionContext`); **Run locally** (`cd api && npm test`; pojedynczy
plik: `npx vitest run src/routes/situations.integration.test.ts`); **Reguły** (mock tylko
`globalThis.fetch` przez `mockOpenAI`, nigdy D1/R2 od środka; błędy D1 przez
`withTrigger`; `afterEach(resetDb)` bo izolacja jest per plik; asercje na stanie D1
dopiero po `waitOnExecutionContext`; luki względem PRD jako `it.fails` z odnośnikiem do
follow-upu, nigdy `it.skip`); **Uwaga** (nie używać `exports.default.fetch` do asercji
na zadaniu tła).

#### 3. Notatka §6.7 i aktualizacja stanu planu testów

**Plik**: `context/foundation/test-plan.md` (sekcje `### 6.7`, `## 3`, `## 4`, `## 5`, `## 8`)

**Cel**: Odnotować, czego faza nauczyła, i uzgodnić stan planu z rzeczywistością.

**Umowa**: §6.7: 2–3 linie (Vitest 3→4, pułapka `.dev.vars`, wynik spike'a triggerów i
`waitOnExecutionContext`, wynik deliberate-break 0004, decyzja o guardzie `fetch`). §3
wiersz 1: `Status` = `complete`. §4 wiersz „integration (api, Worker + D1)”: wersja =
`vitest ^4.1 + @cloudflare/vitest-plugin ^1.1 (zainstalowane)`, `Notes` = lokalizacja
z §6.2; wiersz „unit (api, prymitywy)”: wersja `^4.1`, notatka „biegnie w workerd, jeden
pool”. §5 wiersz „unit + integration (api)”: `required (od Fazy 1; lokalnie `cd api && npm
test`)`. §8: „Stack versions last verified” = data zamknięcia fazy. Nagłówek „Last
updated” zaktualizowany.

#### 4. Zamknięcie zmiany

**Plik**: `context/changes/testing-worker-harness-background-jobs/change.md`

**Cel**: Stan zmiany odzwierciedla zakończenie wdrożenia.

**Umowa**: `updated:` = data zamknięcia; `status` zgodnie z konwencją `/10x-implement`;
w `## Notes` dopisek: „Faza zamknięta; follow-up: `follow-ups/stale-pending-server-rule.md`”.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `cd api && npm test` zielone po przywróceniu migracji 0004
- `grep -c "TBD — see §3 Phase 1" context/foundation/test-plan.md` = 0
- `grep -n "| 1 | Harness Workerów" context/foundation/test-plan.md` pokazuje `complete`

#### Weryfikacja ręczna:

- Deliberate-break 0004 wykonany i opisany w §6.7; plik przywrócony (`git status` czysty
  w `api/migrations/`)
- §6.2 przeczytane „na świeżo”: osoba bez kontekstu tej zmiany potrafi z niego dodać test
  nowej trasy

**Uwaga implementacyjna**: Po tej fazie plan jest w pełni `[x]`; kolejne uruchomienie
`/10x-test-plan` przejdzie do wiersza 2 tabeli §3.

---

## Strategia testowania

### Testy jednostkowe:

- Bez nowych; 20 istniejących w `api/src/lib/` biegnie w workerd jako dowód, że pool
  nie zmienia semantyki Web Crypto i mocka `fetch`.

### Testy integracyjne:

- `api/test/harness.test.ts`: właściwości harnessu (łańcuch end-to-end, trigger, odrzucona
  obietnica tła).
- `api/src/routes/situations.integration.test.ts`: T1.1–T1.4 (ryzyko #1), T2.1–T2.5
  (ryzyko #2). Każdy test ma deliberate-break; T1.3 jako `it.fails`.
- Ryzyko #4: własność harnessu (schemat wyłącznie z migracji) + deliberate-break 0004.

### Kroki testowania ręcznego:

1. Faza 1: usunąć mock z testu szczęśliwej ścieżki → komunikat guarda; przenieść `.dev.vars`
   → suite identyczne.
2. Faza 2–3: wykonać każdy nazwany deliberate-break, potwierdzić czerwony, przywrócić kod.
3. Faza 3: smoke z prawdziwym kluczem przez `wrangler dev` na porcie 3030.
4. Faza 4: przenieść migrację 0004 → suite czerwone → przywrócić.

## Uwagi dotyczące wydajności

- Każdy plik testowy startuje w izolacie workerd; przy 6 plikach koszt startu jest rzędu
  sekund, nie minut. Jeśli suite przekroczy ~30 s lokalnie, kandydatem do wydzielenia w
  osobny projekt `node` są testy `lib/` — decyzja odłożona (jeden pool).
- `waitOnExecutionContext` porzuca obietnice po 30 s; mocki zwracają natychmiast, więc
  żaden test nie zbliża się do tej granicy.

## Uwagi dotyczące migracji

- **Vitest 3 → 4**: istniejące testy używają `vi.spyOn`, `mockResolvedValue`,
  `toHaveBeenCalledOnce`, `vi.restoreAllMocks` — brak API usuniętego w 4.x. Jeśli po
  podniesieniu któryś test `lib/` padnie, to sygnał do zbadania (różnica Node/workerd), nie
  do przywrócenia środowiska `node`.
- **Brak migracji danych**: zmiany w `situations.ts` nie dotykają schematu; `DB.batch`
  działa na istniejących tabelach. Deploy tej zmiany nie wymaga `wrangler d1 migrations
  apply`.
- **Klient**: bez zmian; `ORPHAN_MS` pozostaje do czasu follow-upu.

## Referencje

- Powiązane badania: `context/changes/testing-worker-harness-background-jobs/research.md`
- Umowa jakościowa: `context/foundation/test-plan.md` §2 (ryzyka #1, #2, #4), §4, §5, §6
- Decyzje w archiwum: `context/archive/2026-06-07-capture-situation-by-voice/reviews/impl-review.md`
  (F2, F3), `context/archive/2026-06-09-same-context-variants/follow-ups/review-fixes.md`
  (`DB.batch`, checklista deployu), `context/archive/2026-06-09-same-context-variants/reviews/impl-review.md` (F1, F4)
- Wzorzec mocka: `api/src/lib/flashcards.test.ts:4-14`, `api/src/lib/transcription.test.ts:1-9`
- Lekcje: `context/foundation/lessons.md` (port 3030 dla `wrangler dev`)

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dodaj ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków. Zobacz `references/progress-format.md`.

### Faza 1: Harness workerd + spike

#### Automatyczne

- [x] 1.1 `npm install` w `api/` bez błędów; vitest 4.1.x i @cloudflare/vitest-plugin 1.x zainstalowane — f939d8e
- [x] 1.2 `npm test` zielone: 20 testów `lib/` + 3 testy `test/harness.test.ts` — f939d8e
- [x] 1.3 `npm run typecheck` zielone z `test/**/*.ts` — f939d8e
- [x] 1.4 `git status` bez zmian w `api/.wrangler/` — f939d8e

#### Ręczne

- [x] 1.5 Deliberate-break guarda `fetch`: błąd `Unmocked fetch: ...`, mock przywrócony — f939d8e
- [x] 1.6 Suite identyczne z tymczasowo przeniesionym `api/.dev.vars`; plik przywrócony — f939d8e
- [x] 1.7 Suite kończy się na Windows 11 bez wiszącego procesu — f939d8e

### Faza 2: Ryzyko #1 — nagranie nie przepada

#### Automatyczne

- [x] 2.1 Przed poprawką POST: T1.2 czerwony, T1.1/T1.3/T1.4 zielone — 9d0f856
- [x] 2.2 Po poprawce: `npm test` w całości zielone — 9d0f856
- [x] 2.3 `npm run typecheck` zielone — 9d0f856
- [x] 2.4 `follow-ups/stale-pending-server-rule.md` istnieje — 9d0f856

#### Ręczne

- [x] 2.5 Deliberate-break T1.1 i T1.2 wykonane, kod przywrócony — 9d0f856
- [x] 2.6 Smoke przez `wrangler dev` (3030): 401 bez tokenu, `201` poniżej sekundy z tokenem — 9d0f856

### Faza 3: Ryzyko #2 — fiszki wszystko-albo-nic

#### Automatyczne

- [x] 3.1 Przed poprawkami: T2.2 i T2.3 czerwone, T2.1/T2.4/T2.5 zielone
- [x] 3.2 Po poprawkach: `npm test` w całości zielone
- [x] 3.3 `npm run typecheck` zielone

#### Ręczne

- [x] 3.4 Deliberate-break T2.1–T2.4 wykonane, kod przywrócony
- [x] 3.5 Smoke z prawdziwym kluczem przez `wrangler dev` (3030): nagranie → transkrypt → propozycje

### Faza 4: Ryzyko #4 domknięte + książka kucharska

#### Automatyczne

- [ ] 4.1 `npm test` zielone po przywróceniu migracji 0004
- [ ] 4.2 Brak `TBD — see §3 Phase 1` w `test-plan.md`
- [ ] 4.3 Wiersz 1 tabeli §3 = `complete`

#### Ręczne

- [ ] 4.4 Deliberate-break 0004 wykonany, opisany w §6.7, plik przywrócony
- [ ] 4.5 §6.2 przeczytane na świeżo: wystarcza do dodania testu nowej trasy

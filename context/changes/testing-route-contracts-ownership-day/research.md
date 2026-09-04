---
date: 2026-09-04T13:01:25+02:00
researcher: Marek Kalita (Claude Code)
git_commit: 3d554c90d25aaca48c231441fcee34e1d450dc45
branch: main
repository: kali82marek/my-english-day
topic: "Faza 2 planu testów — kontrakty tras: własność (ryzyko #3), izolacja, dzień lokalny (ryzyko #6); możliwości harnessu workerd"
tags: [research, codebase, testing, api-routes, ownership, idor, day-boundary, utc, workerd-harness, situations, flashcards, requireAuth]
status: complete
last_updated: 2026-09-04
last_updated_by: Marek Kalita (Claude Code)
---

# Research: Faza 2 planu testów — kontrakty tras (własność, izolacja, dzień lokalny)

**Date**: 2026-09-04T13:01:25+02:00
**Researcher**: Marek Kalita (Claude Code)
**Git Commit**: 3d554c90d25aaca48c231441fcee34e1d450dc45
**Branch**: main
**Repository**: kali82marek/my-english-day

Permalinki: `https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/<ścieżka>#L<linia>` (skrót w tekście: `plik:linia`; pełne linki w sekcji *Code References*).

## Research Question

Verify for test-plan §3 Phase 2 (risks #3 cudze dane/IDOR, #6 dzień liczony w UTC): (1) which routes read/mutate situations and flashcards (incl. newer S-04/S-05 endpoints if present) and how ownership is enforced per route — router-level requireAuth vs per-query user_id scoping — and whether "foreign id → 404 / empty list" and "no token → 401 before touching D1" hold on every endpoint; (2) what the response DTOs expose (user_id, audio key, variant flag); (3) how "today" / the day boundary is computed for the day list and the "generuję…" counter (date('now') in SQL vs app-side, any timezone input from the client, DST handling); (4) how the Phase 1 workerd harness (test-plan §6.2) seeds users/tokens and whether it can control the clock and timezone for two seeded users.

## Summary

1. **Trasy i własność.** Aplikacja ma 10 tras; 8 poza `/health` i `/auth/{register,login}` jest chronionych. Oba routery danych zakładają `use('*', requireAuth)` **przed** rejestracją jakiejkolwiek trasy (`api/src/routes/situations.ts:177`, `api/src/routes/flashcards.ts:31`), a Hono po `app.route()` zamienia `*` na wzorzec obejmujący także goły `/situations` (sonda: `^/situations(?:|/.*)$`). Żadna trasa nie ucieka spod middleware. **Własność jest wymuszana per zapytanie**: każde z 9 zapytań SQL w trasach ma `user_id = ?` z tokenu (listy) lub `id = ? AND user_id = ?` (mutacje). Cudzy id → 404 na wszystkich trzech mutacjach (`DELETE /situations/:id`, `POST /flashcards/:id/accept`, `DELETE /flashcards/:id`), cudze wiersze nie wchodzą do żadnej z dwóch list. **Endpointów S-04/S-05 nie ma** — oba slice'y są `proposed` w roadmapie i grep nie znajduje żadnego kodu; nie istnieje też `GET /situations/:id` ani lista fiszek zaakceptowanych.
2. **401 przed D1** trzyma się dla braku nagłówka, złego formatu, złego podpisu, `alg` innego niż HS256 i tokenu z `exp` w przeszłości — `requireAuth` nie ma dostępu do `c.env.DB`, tylko weryfikuje JWT (`api/src/middleware/auth.ts:13-28`). Dwa zastrzeżenia: wydawane tokeny **nie mają `exp`** (`api/src/lib/jwt.ts:22`), więc „wygasły token" da się zasymulować tylko tokenem wybitym ręcznie; token **usuniętego użytkownika** przechodzi middleware i kończy się 200 z pustą listą, 404 na mutacjach albo 500 na `POST /situations` (FK po `R2.put`, plik sprzątany).
3. **DTO.** `SituationDTO` powstaje przez whitelistę `toDTO` (`situations.ts:57-66`): `{ id, status, transcript, duration_ms, flashcards_status, created_at }` — bez `user_id` i `audio_key`. `FlashcardDTO` z `/flashcards/proposals` **nie ma warstwy mapowania** — whitelistą jest wyłącznie lista kolumn w `SELECT` (`flashcards.ts:38`): `{ id, situation_id, type, front_en, back_pl, example_en, created_at }` — bez `user_id`, `status`, `is_variant`. `is_variant` (migracja 0004) nie jest selekcjonowane w żadnej trasie. `accept` odpowiada 200 z pustym ciałem, oba `DELETE` — 204.
4. **Dzień.** Granica dnia jest decydowana w **dwóch miejscach, oba w SQL D1, oba w UTC**: lista dnia `WHERE ... date(created_at) = date('now')` (`situations.ts:249`) i licznik `generatingCount` z tym samym filtrem (`flashcards.ts:47`). `created_at` to `TEXT DEFAULT (datetime('now'))` w UTC (`YYYY-MM-DD HH:MM:SS`, bez `Z`). Klient **nie wysyła** strefy, offsetu ani daty; nie ma `request.cf.timezone`, hardkodu `Europe/Warsaw` ani żadnej logiki DST. Lista propozycji **nie filtruje po dniu** (asymetria w jednej odpowiedzi). Decyzje S-01 F1 (jak liczyć dzień lokalny) i S-02 F4 (licznik) są nadal `PENDING`.
5. **Harness.** `seedUser(env, label)` wstawia użytkownika bezpośrednio (atrapa hasha, unikalny e-mail z `randomUUID`) i bije token przez `signSession(id, env.JWT_SECRET)` z sekretem `'test-secret'` z `vitest.config.mts` (`api/test/db.ts:46-60`). Dwóch użytkowników w jednym teście działa (zweryfikowane eksperymentem: B nie widzi wierszy A, `DELETE` tokenem B → 404). **Zegar**: `vi.setSystemTime` działa na `Date` w kodzie aplikacji (handler i `waitUntil`), ale **nie rusza SQLite `date('now')`** (zweryfikowane: pod fałszywym zegarem 2031 SQL zwrócił realny 2026-09-04). **Strefa**: niekontrolowalna — plugin 1.1.3 nie przekazuje `unsafeRuntimeEnv`, a na Windows izolat i tak raportuje `Europe/Warsaw` mimo `TZ=UTC` od miniflare (na Linux/CI będzie UTC). Jedyna dźwignia po stronie SQL to zasiew jawnego `created_at`. Brakuje helperów dla `DELETE`/`accept`, żądania bez nagłówka i zasiewu sytuacji/fiszek z wybranym czasem.

## Detailed Findings

### 1. Inwentarz tras i montaż middleware

Kolejność w `api/src/index.ts`: `cors` globalnie (`:10-18`) → `GET /health` (`:20-26`) → `app.route('/auth', authRouter)` (`:28`) → `app.route('/situations', situationsRouter)` (`:29`) → `app.route('/flashcards', flashcardsRouter)` (`:30`). Brak `app.onError` i `app.notFound` — obowiązują domyślne odpowiedzi Hono (text/plain).

| # | Metoda + ścieżka | Definicja | Tabele | Ochrona |
|---|---|---|---|---|
| 1 | `GET /health` | `api/src/index.ts:20-26` | — | publiczna |
| 2 | `POST /auth/register` | `api/src/routes/auth.ts:25-59` | `users` R+W | publiczna |
| 3 | `POST /auth/login` | `api/src/routes/auth.ts:61-87` | `users` R | publiczna |
| 4 | `GET /auth/me` | `api/src/routes/auth.ts:89-100` | `users` R | `requireAuth` per handler (`auth.ts:89`) |
| 5 | `POST /situations` | `api/src/routes/situations.ts:180-243` | `situations` W; w tle `situations` W + `flashcards` W | router `use('*', requireAuth)` (`situations.ts:177`) |
| 6 | `GET /situations` | `api/src/routes/situations.ts:246-255` | `situations` R | j.w. |
| 7 | `DELETE /situations/:id` | `api/src/routes/situations.ts:258-289` | `situations` R, `flashcards` W, `situations` W | j.w. |
| 8 | `GET /flashcards/proposals` | `api/src/routes/flashcards.ts:34-53` | `flashcards` R, `situations` R (licznik) | router `use('*', requireAuth)` (`flashcards.ts:31`) |
| 9 | `POST /flashcards/:id/accept` | `api/src/routes/flashcards.ts:56-75` | `flashcards` W | j.w. |
| 10 | `DELETE /flashcards/:id` | `api/src/routes/flashcards.ts:78-96` | `flashcards` W | j.w. |

- **Nic nie ucieka spod `requireAuth`.** `use('*')` jest zarejestrowane przed wszystkimi trasami obu routerów. Po `app.route()` wzorzec staje się `ALL /situations/*`; Hono buduje z tego regex `^/situations(?:|/.*)$` (`node_modules/hono/dist/cjs/router/reg-exp-router/router.js:30-34`), więc **goły `/situations` też jest objęty**. Sonda na zainstalowanym Hono 4.12.23: `GET /situations`, `POST /situations`, `DELETE /situations/5`, a nawet niedopasowane `GET /situations/5`, `PUT /situations`, `GET /flashcards` — wszystkie przechodzą przez middleware; `GET /situationsX` i `/health` — nie.
- **Skutek uboczny**: niedopasowana ścieżka pod chronionym prefiksem bez tokena → 401 JSON; z tokenem → domyślne Hono `404 Not Found` text/plain. Kontrakt błędów nie jest jednolicie JSON-owy.
- **Luźne dopasowanie parametru**: `DELETE /flashcards/proposals` trafia w `delete('/:id')` z `id='proposals'` → `parseInt` → NaN → 400 (`flashcards.ts:57-60`); `parseInt('5abc', 10)` = 5 → działa na id 5.
- **S-04/S-05**: brak jakiegokolwiek kodu (grep całego repo poza `node_modules`/`context` na `duplicate`, `review`, `srs`, `repetition`, `rating`, `grade` → wyłącznie `generatingCount`). Roadmapa: oba `proposed` (`context/foundation/roadmap.md:38-39`, `:122-146`), **żaden nie wymienia endpointów**. Faza 2 może kodować kontrakt wyłącznie dla 8 istniejących tras chronionych.

### 2. `requireAuth`: 401 przed D1

`api/src/middleware/auth.ts:13-28` — nagłówek (`:14-15`) → `verifySession(token, c.env.JWT_SECRET)` (`:21`) → `c.set('userId', payload.sub)` (`:26`). **Brak `c.env.DB`** w middleware. `verifySession` łapie każdy wyjątek `hono/jwt` i zwraca `null` (`api/src/lib/jwt.ts:39-41`); wymaga `typeof payload.sub === 'string'` (`jwt.ts:35`).

| Przypadek | Status / body | D1 przed odpowiedzią |
|---|---|---|
| brak `Authorization` | 401 `{ error: 'Brak tokenu uwierzytelniającego.' }` (`auth.ts:18`) | nie |
| nagłówek bez `Bearer ` (np. `Basic x`, sam JWT) | 401 j.w. (`startsWith` fałszywe → `token=''`) | nie |
| `Bearer ` + śmieci / zły podpis / `alg: none` / HS512 | 401 `{ error: 'Niepoprawny lub wygasły token.' }` (`auth.ts:23`) | nie |
| token z `exp` w przeszłości | 401 j.w. — ale **wydawane tokeny nie mają `exp`** (`jwt.ts:22`: payload to wyłącznie `{ sub }`); hono egzekwuje `exp` tylko gdy obecne | nie |
| `sub` nie-string | 401 j.w. (`jwt.ts:35`) | nie |
| `JWT_SECRET` niezdefiniowany lub pusty | **401** (nie 500): `verify` rzuca `TypeError`/`DataError`, złapane → `null`. Brak sekretu w prod wygląda jak „wszyscy wylogowani" | nie |
| **token usuniętego użytkownika** | middleware **przepuszcza** (brak lookupu) → `GET /auth/me` 401 `Użytkownik nie istnieje.` (`auth.ts:96`); listy → 200 pusto; mutacje → 404; `POST /situations` → `R2.put` OK, `INSERT` pada na FK `user_id REFERENCES users(id)` (`api/migrations/0002_create_situations.sql:9`) → `catch` → best-effort `R2.delete` → 500 `Nie udało się zapisać sytuacji.` (`situations.ts:222-231`) | tak |

Poboczne: `signSession` bez sekretu (`auth.ts:57`, `:85`) rzuca **niezłapane** → text/plain 500; w `register` wiersz usera jest już wstawiony (`:47-51`) → konto-widmo, kolejna próba → 409.

### 3. Typowanie `user_id`: string z tokenu vs INTEGER w kolumnach

| Warstwa | Typ | Dowód |
|---|---|---|
| `users.id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `api/migrations/0001_create_users.sql:7` |
| `situations.user_id`, `flashcards.user_id` | `INTEGER NOT NULL REFERENCES users(id)` | `0002_create_situations.sql:9`, `0003_create_flashcards.sql:10` |
| JWT `sub` | **string** — `sign({ sub: String(userId) }, ...)` | `api/src/lib/jwt.ts:22`, `SessionPayload.sub: string` (`:13-15`) |
| kontekst Hono | `Variables.userId: string` | `api/src/types.ts:15-17`; `middleware/auth.ts:26` |
| bind do D1 | JS string → TEXT | wszystkie `.bind(userId)`: `situations.ts:216, 251, 268, 282, 285`, tło `:102`; `flashcards.ts:40, 49, 66, 88`; `auth.ts:92` |

**Wszędzie TEXT jest bindowany przeciwko kolumnom INTEGER.** Działa wyłącznie dzięki afiniczności kolumny SQLite (parametr bez afiniczności jest konwertowany przy porównaniu z kolumną INTEGER). Sonda na SQLite 3.50.4 (silnik D1): `WHERE user_id = ?` z `'1'` trafia usera 1, z `'2'` — pusto; `INSERT ... VALUES ('1', ...)` daje `typeof(user_id) = 'integer'`; FK egzekwowane także z TEXT-owym parametrem; `UPDATE ... WHERE id=? AND user_id=? AND status='proposed'` → rowcount 0 dla cudzego, 1 dla własnego, 0 przy ponownym. **Pułapka**: `SELECT 1 = '1'` → `0` (bez kolumny nie ma afiniczności) — w kodzie takich porównań nie ma. To potwierdza notatkę z przeglądu S-02 („NIE jest błędem", `context/archive/2026-06-07-gated-ai-flashcard-generation/reviews/impl-review.md:21`). **Wniosek dla testów**: asercja „SQL zawiera `user_id`" nic tu nie sprawdza; sygnał daje wyłącznie test z dwoma zasianymi użytkownikami na realnej bazie.

### 4. Zakres własności per zapytanie

W `api/src/lib/*.ts` **nie ma żadnego SQL** (klienty OpenAI, hasło, JWT, walidacja). Wszystkie instrukcje na `situations`/`flashcards`:

| Gdzie | Instrukcja | Zakres własności | Decyzja 404 |
|---|---|---|---|
| `POST /situations` `situations.ts:214` | `INSERT INTO situations (user_id, status, audio_key, duration_ms) VALUES (?, 'pending', ?, ?) RETURNING *` | `user_id` z tokenu | n/d; błąd → 500 JSON + sprzątanie R2 |
| `GET /situations` `:249` | `SELECT id, user_id, transcript, status, audio_key, duration_ms, flashcards_status, created_at FROM situations WHERE user_id = ? AND date(created_at) = date('now') ORDER BY created_at DESC` | `user_id = ?` | n/d (pusta lista) |
| `DELETE /situations/:id` `:266` | `SELECT id, user_id, audio_key FROM situations WHERE id = ? AND user_id = ?` | `id AND user_id` | **SELECT poprzedzający**: `!row` → 404 `Sytuacja nie istnieje.` (`:271-273`) |
| `DELETE /situations/:id` `:281-285` | `DELETE FROM flashcards WHERE situation_id = ? AND user_id = ?`; `DELETE FROM situations WHERE id = ? AND user_id = ?` | oba z `user_id` | `meta.changes` nieczytane → 204 (`:288`) |
| `GET /flashcards/proposals` `flashcards.ts:38` | `SELECT id, situation_id, type, front_en, back_pl, example_en, created_at FROM flashcards WHERE user_id = ? AND status = 'proposed' ORDER BY created_at` | `user_id = ?` | n/d |
| `GET /flashcards/proposals` `:47` | `SELECT COUNT(*) AS count FROM situations WHERE user_id = ? AND status = 'done' AND flashcards_status = 'pending' AND date(created_at) = date('now')` | `user_id = ?` | n/d |
| `POST /flashcards/:id/accept` `:64` | `UPDATE flashcards SET status = 'accepted' WHERE id = ? AND user_id = ? AND status = 'proposed'` | `id AND user_id (AND status)` | `result.meta.changes === 0` → 404 `Fiszka nie istnieje.` (`:70-72`); **to samo 404 dla cudzej, nieistniejącej i własnej już zaakceptowanej** |
| `DELETE /flashcards/:id` `:86` | `DELETE FROM flashcards WHERE id = ? AND user_id = ?` | `id AND user_id` | `meta.changes === 0` → 404 (`:91-93`) |
| tło `transcribeAndFinalize` `situations.ts:146-154` | `UPDATE situations SET transcript = ?, status = 'done' WHERE id = ?`; `... status = 'failed' WHERE id = ?` | **bez `user_id`** | — |
| tło `generateAndStoreFlashcards` `:97-105`, `:111-113` | `INSERT INTO flashcards (situation_id, user_id, ...) VALUES (?, ?, ...)` + `UPDATE situations SET flashcards_status = 'done' WHERE id = ?` w jednym `DB.batch`; `failed` w `catch` | `user_id` = `userId` z domknięcia handlera POST (`:235`) | — |

- **Tło jest bezpieczne mimo braku `user_id` w `UPDATE ... WHERE id = ?`**: `situationId` pochodzi z `RETURNING *` własnego `INSERT` (`:217`, `:235`), nigdy z wejścia użytkownika; `userId` to ten sam string z tokenu. **Wyścig z DELETE**: użytkownik kasuje sytuację w trakcie zadania tła → `DB.batch` z INSERTami pada na FK `situation_id REFERENCES situations(id)` → cały batch cofnięty → `UPDATE ... failed WHERE id = ?` dotyka 0 wierszy bez błędu. `AUTOINCREMENT` (`0002:8`, `0003:8`) wyklucza ponowne użycie id, więc stare zadanie nie zapisze pod cudzą nową sytuacją.
- **Brak wyroczni istnienia**: 404 ma identyczne ciało i status dla „nie istnieje", „cudze" i (accept) „już zaakceptowane", bo warunek własności siedzi w tym samym `WHERE` co id.
- `DELETE /situations/:id`: `AUDIO_BUCKET.delete` (`:275-277`) **nie jest w try/catch** — błąd R2 → text/plain 500 i wiersz zostaje (S-01 F4, wciąż `PENDING`). W harnessie R2 `delete` brakującego klucza nie rzuca, więc zasiew z `audio_key` bez obiektu w buckecie jest bezpieczny.

### 5. Kształt DTO i wycieki

W `api/src/types.ts` **nie ma typów DTO** (tylko `Bindings`/`Variables`/`AppEnv`, `:7-22`). DTO są lokalne w trasach i ręcznie zduplikowane na froncie (`src/lib/api.ts:125-134` `Situation`, `:180-188` `Flashcard`, `:24-27` `AuthUser`) oraz w teście integracyjnym (`api/src/routes/situations.integration.test.ts:21-28`). Front i API są zgodne pole w pole.

| Endpoint | Odpowiedź | `user_id` | `audio_key` / R2 / URL | `is_variant` | `status` wewn. |
|---|---|---|---|---|---|
| `POST /auth/register` 201, `POST /auth/login` 200 | `{ token, user: { id, email } }` (`auth.ts:58`, `:86`) — bez `password_hash`, `created_at` | — | — | — | — |
| `GET /auth/me` | `{ user: { id, email } }` (`auth.ts:91-99`) | — | — | — | — |
| `POST /situations` 201 | `SituationDTO` `{ id, status, transcript, duration_ms, flashcards_status, created_at }` przez `toDTO(row)` (`situations.ts:57-66`, `:242`) | **nie** (whitelist) | **nie** | — | `status`, `flashcards_status` jawnie eksponowane |
| `GET /situations` | `{ situations: SituationDTO[] }` (`:254`) — `SELECT` zawiera `user_id` i `audio_key` (`:249`), zdejmuje je `.map(toDTO)` | nie | nie | — | j.w. |
| `DELETE /situations/:id` | 204 bez ciała (`:288`) | — | — | — | — |
| `GET /flashcards/proposals` | `{ proposals: FlashcardDTO[], generatingCount }` (`flashcards.ts:52`); `FlashcardDTO = { id, situation_id, type, front_en, back_pl, example_en, created_at }` (`:18-26`) | nie (nie w `SELECT`) | — | **nie** (nie w `SELECT :38`) | nie (`status` nie w `SELECT`) |
| `POST /flashcards/:id/accept` | **200 z pustym ciałem** (`c.body(null, 200)`, `:74`; front obchodzi ręcznie `src/lib/api.ts:88-92`) | — | — | — | — |
| `DELETE /flashcards/:id` | 204 bez ciała (`:95`) | — | — | — | — |

- **`SELECT *` w trasach: brak.** Jedyne `RETURNING *` (`situations.ts:214`) idzie do `row` i przez whitelistę `toDTO`. `SELECT *` występuje tylko w helperach testowych (`api/test/db.ts:64, 70`).
- **`GET /flashcards/proposals` nie ma warstwy mapowania** — `results` idzie prosto do JSON; ochroną przed wyciekiem `is_variant`/`user_id`/`status` jest wyłącznie lista kolumn w `SELECT`. Dopisanie kolumny do tego `SELECT` = natychmiastowy wyciek. To najsłabszy punkt kontraktu DTO i naturalny deliberate-break.
- Istniejące asercje wycieku: `api/test/harness.test.ts:46-47` (`not.toHaveProperty('audio_key')`, `not.toHaveProperty('user_id')`) — tylko `POST /situations`, tylko dwie nazwy.
- Klucz R2 zawiera id użytkownika (`situations/${userId}/...`, `situations.ts:202`) — nigdy nie eksponowany; jedyne miejsce, gdzie `userId` trafia poza D1.
- Drobiazg: `flashcards.example_en` jest w DB nullable (`0003:14`), DTO/front deklarują `string`; kod nigdy nie wstawia NULL (schemat LLM), ale ręczny zasiew może.

### 6. Granica dnia: gdzie, jak, w jakiej strefie

**Storage.** Wszystkie trzy tabele: `created_at TEXT NOT NULL DEFAULT (datetime('now'))` (`0001:10`, `0002:14`, `0003:16`). Żaden `INSERT` w kodzie nie podaje `created_at` → zawsze DEFAULT = `YYYY-MM-DD HH:MM:SS` **UTC**, bez `T`, bez `Z`. Klient to wie i dokleja `Z` przy parsowaniu (`src/app/(app)/index.tsx:21-28`, `src/components/situation-list.tsx:37-39`). Jedyny znacznik z JS to optymistyczny wiersz tymczasowy na kliencie (`index.tsx:121`), nigdy nie wysyłany.

**Gdzie decyduje się dzień:**

| Powierzchnia | Decyduje | Wyrażenie | Strefa | Obserwowalność z poziomu trasy |
|---|---|---|---|---|
| Lista dnia `GET /situations` | SQL (`situations.ts:249`) | `date(created_at) = date('now')` | UTC (obie strony) | **Tak** — filtr serwerowy; test widzi inkluzję/ekskluzję po odpowiedzi, ale steruje wyłącznie `created_at` (SQL `now` niekontrolowalne, §8) |
| Licznik „Generuję fiszki…" `generatingCount` | SQL (`flashcards.ts:47`) | `status='done' AND flashcards_status='pending' AND date(created_at) = date('now')` | UTC | **Tak** — zasiać `done`/`pending` z `created_at` w dniu UTC (licznik 1) vs poza (0). Uwaga: sytuacja jeszcze w transkrypcji (`status='pending'`) **nie** wlicza się |
| Lista propozycji `proposals` | SQL (`flashcards.ts:38`) | `status='proposed'` — **bez dnia** | n/d (wszystkie dni) | Tak — propozycja sprzed dnia nadal wraca; asymetria w jednej odpowiedzi |
| Etykieta „· Generuję fiszki…" przy wierszu | JS klienta (`situation-list.tsx:62-66`) | `status==='done' && flashcards_status==='pending'` | dziedziczy UTC z listy | Pośrednio — test trasy widzi pole `flashcards_status` w DTO |
| Godzina `HH:mm` na karcie | JS klienta (`situation-list.tsx:38-44`) | `toLocaleTimeString([], …)` | **strefa urządzenia** | Nie — serwer oddaje surowy tekst UTC |

- **Klient nie filtruje po dniu** (`index.tsx:37-48`, `:66-77` — scala po `id`); wiersze, które serwer po północy UTC przestał zwracać, znikają lokalnie przy następnym `refresh`. Efekt dla Warszawy (UTC+1/+2): po lokalnej północy do 01:00/02:00 wczorajsze nagrania wciąż są na liście „dziś"; nagranie z lokalnego 00:00–01:00/02:00 należy do UTC-„wczoraj" i **znika o lokalnej 01:00/02:00**. Rozjazd „godzina lokalna na karcie vs dzień UTC" jest widoczny dla użytkownika.
- **Wejście strefy: nie istnieje.** Handlery nie czytają żadnego query paramu (`c.req.query` nie występuje w `situations.ts`/`flashcards.ts`); jedyny czytany nagłówek to `Authorization` (`middleware/auth.ts:14`). Klient wysyła tylko `Authorization` i `Content-Type` (`src/lib/api.ts:71-79`). Brak `request.cf.timezone`, `Intl`, `timeZone`, `Europe/Warsaw`, `+02:00`, `getTimezoneOffset`, `localtime`, `strftime`, `unixepoch` w `api/` i `src/`. `Bindings` bez TZ (`api/src/types.ts:7-13`), `wrangler.toml` bez `[vars]` o strefie (`api/wrangler.toml:6-7`).
- **DST: brak jakiejkolwiek obsługi.** Jedyne stałe ms to czasy pollingu/limitów (`POLL_MS`, `ORPHAN_MS`, `POLL_LIMIT_MS`), nie offsety.
- **Runtime**: serwerowy JS w ogóle nie liczy dnia — cała decyzja siedzi w SQLite, którego `'now'` jest UTC niezależnie od TZ hosta. Kod nie polega na semantyce czasu lokalnego; jest jawnie i konsekwentnie UTC — czyli konsekwentnie niezgodny z PRD „dzień użytkownika" dla strefy UTC+.
- **Znany artefakt w istniejącym teście**: `situations.integration.test.ts:115-117` (T1.3, `it.fails`) sieje `datetime('now', '-150 seconds')` → przez ~2,5 min po północy UTC wiersz wypada z listy dnia.
- **Kotwice DST 2026** (do zasiewu w testach): przejście na CEST 2026-03-29 01:00 UTC; powrót na CET 2026-10-25 01:00 UTC. „23:30 Warszawy" = `21:30Z` latem, `22:30Z` zimą.

### 7. Harness Fazy 1: zasiew użytkowników i tokenów

Wersje: `@cloudflare/vitest-plugin` 1.1.3 (zagnieżdżony `miniflare 5.20260831.0-alpha` + `workerd 1.20260831.1`), `vitest 4.1.11`, `hono 4.12.23`, `wrangler 4.95.0`.

- **`seedUser(env, label = 'user')`** (`api/test/db.ts:46-60`): `INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id` z atrapą hasha `'pbkdf2$1$test$test'` (`:51-54`) — `POST /auth/login` dla takiego usera **nie zadziała**, ale nie jest potrzebny. E-mail `` `${label}-${crypto.randomUUID()}@test.invalid` `` (`:50`) — dwa wywołania nigdy nie kolidują. Zwraca `{ id: number; token: string }`; token przez `signSession(row.id, env.JWT_SECRET)` (`:59`) tym samym `hono/jwt` co Worker, sekretem `'test-secret'` z `api/vitest.config.mts:28` (`miniflare.bindings` nadpisuje `.dev.vars`).
- **Token bez `iat`/`exp`** → przesuwanie zegara testu nie unieważnia tokenów.
- **Dwóch użytkowników w jednym teście**: tanie i bezpieczne. Jedyny stan modułowy w `db.ts` to `registeredTriggers` (`:86`), niezwiązany. Zweryfikowane eksperymentem w scratchpadzie: `seedUser(env,'alice')`, `seedUser(env,'bob')` → id 2, 3, różne tokeny; B nie widzi wierszy A (`GET /situations` → 0); `DELETE /situations/<idA>` tokenem B → **404**, wiersz zostaje.
- **Helpery `api/test/request.ts`** biorą `token: string`: `postSituation(env, token, options)` (`:34-59`) → `{ res, ctx }`; `getSituations(env, token)` (`:67`), `getProposals(env, token)` (`:72`) przez prywatny, nieeksportowany `getJson` (`:61-64`). Nagłówek zawsze `Authorization: Bearer ${token}` (`:26-28`). **Brak** helpera „bez nagłówka" / „nagłówek nie-Bearer" (obejście `token=''` daje `Bearer ` → 401 „Brak tokenu", `'bogus'` → 401 — zweryfikowane, ale nie da się helperem pominąć nagłówka). **Brak** helperów dla `DELETE /situations/:id`, `POST /flashcards/:id/accept`, `DELETE /flashcards/:id`, `GET /auth/me`.
- **Zasiew danych**: `env.DB.prepare(...)` z dowolnym `user_id` i `created_at` działa. Wzorzec `seedPending` istnieje, ale jest **prywatny w pliku testowym** (`situations.integration.test.ts:38-46`): `INSERT INTO situations (user_id, status, audio_key, created_at) VALUES (?, 'pending', ?, datetime('now', ?))`. `date(created_at)` akceptuje też ISO z offsetem: zweryfikowane `date('2026-09-04T23:30:00+02:00')` → `2026-09-04` (SQLite normalizuje do UTC); jawne `'2032-12-31 23:59:00'` wraca 1:1. Odczyt: `readSituation(env, id)` (`db.ts:63-65`), `readFlashcards(env, situationId)` (`:68-75`). **Brak** `seedSituation`/`seedFlashcard` w `db.ts`, `readFlashcard(id)`, `readSituationsOf(userId)`.
- **Izolacja i sprzątanie**: per plik (własny izolat i własne D1; id startują od 1 w każdym pliku). `resetDb` (`db.ts:106-122`): `DROP TRIGGER` → `DELETE flashcards → situations → users` (kolejność FK) → opróżnienie bucketu. `DELETE FROM users` usuwa obu zasianych — dwóch użytkowników działa z obecnym `afterEach(() => resetDb(env))`. `AUTOINCREMENT` nie resetuje `sqlite_sequence` po `DELETE` → nigdy nie hardkodować id.
- **Suite dziś**: `cd api && npm test` → 6 plików, 31 passed + 1 expected fail (T1.3), ~5,6 s.

### 8. Harness: kontrola zegara i strefy (zweryfikowane eksperymentalnie)

Eksperymenty w scratchpadzie (osobny `vitest.config.mts` wskazujący na `api/wrangler.toml` i `api/migrations`; repo nietknięte).

| Dźwignia | `Date` w kodzie aplikacji | SQLite `date('now')` / DEFAULT `created_at` | Status |
|---|---|---|---|
| `vi.setSystemTime()` (bez fake timers) | **Tak** — handler i `waitUntil` widzą fałszywą datę (`/health` zwrócił 2030-06-15) | **Nie** — pod zegarem 2031 SQL zwrócił realny `2026-09-04 11:04:49`; DEFAULT przy INSERT = realny czas | zweryfikowane |
| `vi.useFakeTimers()` (+ `setSystemTime`) | Tak; pełny potok `POST → waitUntil → mock Whisper → mock chat → DB.batch` skończył `done/done` w 47 ms (w `src/` brak `setTimeout`/`AbortSignal.timeout`) | Nie | zweryfikowane |
| `vi.useFakeTimers({ toFake: ['Date'] })` | Tak | Nie | zweryfikowane |
| Jawne `created_at` w `INSERT` (ISO `Z`/`+02:00` lub `'YYYY-MM-DD HH:MM:SS'`, albo `datetime('now', '±N seconds' / 'start of day')`) | n/d | **Tak — jedyna dźwignia po stronie SQL** | zweryfikowane |
| `miniflare.unsafeRuntimeEnv.TZ` przez plugin | Nie — plugin 1.1.3 nie przekazuje tej opcji (do `Miniflare` idą tylko `log`, `handleStructuredLogs`, `verbose`, `inspectorPort`, `unsafeModuleFallbackService`, `workers`; `dist/pool/index.mjs:63288-63330`) | Nie | zweryfikowane (zero efektu) |
| `compatibility_date`/`flags` (`wrangler.toml:3-4`) | Nie | Nie | z odczytu |
| Zamrożenie `Date.now()` (Spectre) | Lokalnie **nie występuje** (pętla bez I/O ~400 ms → `Date.now()` przesunięte o 397 ms, także w handlerze); prod zamraża do następnego I/O | Nie | lokalnie zweryfikowane; prod z dokumentacji |
| `Intl.DateTimeFormat(..., { timeZone: 'Europe/Warsaw' })` w kodzie aplikacji | Tak (jawna strefa działa w izolacie; sformatowało `13:04`) | Nie | zweryfikowane |

- **Pułapka `setSystemTime`**: przecieka do kolejnych testów w tym samym pliku; `vi.restoreAllMocks()` z `api/test/setup.ts:30-32` **nie** go cofa — cofa tylko `vi.useRealTimers()`. Między plikami nie przecieka.
- **Strefa izolatu (odkrycie Windows)**: miniflare spawnuje workerd z `TZ=UTC` (`miniflare/dist/src/index.js:65118-65123`), ale na tej maszynie izolat raportuje `getTimezoneOffset() = -120`, `Intl.DateTimeFormat().resolvedOptions().timeZone = 'Europe/Warsaw'` — ICU/V8 na Windows nie honoruje `TZ` (nawet `TZ=America/New_York node -e ...` daje Warszawę). Na Linux/CI będzie UTC. **Worker pod testem widzi Warszawę lokalnie, a UTC w CI i w prod.** Dziś kod nie zależy od TZ izolatu (`toISOString()` + SQL `date('now')`), ale każdy przyszły `getHours()/getDate()/toLocale*` bez jawnego `timeZone` da inne wyniki lokalnie niż w CI.
- **Wniosek**: harness **nie może** sprawić, by Worker „myślał, że jest w Europe/Warsaw" w sposób sterowalny i przenośny. Dźwignie: (i) wartości zasiewane/wysyłane przez test (`created_at`, ewentualny param/nagłówek klienta), (ii) `vi.setSystemTime` w UTC dla strony JS, (iii) jawne `timeZone` w `Intl` po stronie aplikacji, które test może sprawdzać.

### 9. Konsekwencje dla planu Fazy 2 (koszt × sygnał)

**Ryzyko #3 — w pełni obserwowalne dziś, bez luk kodu do zamknięcia.** Każdy z 8 chronionych endpointów da się przetestować dwoma zasianymi użytkownikami na realnym D1; oczekiwania wynikają wprost z zarchiwizowanych planów (404 nie 403; listy bez cudzych wierszy; DTO bez `user_id`/`audio_key`/`is_variant`/`status`). Macierz do pokrycia:

| Endpoint | Cudzy id / cudze wiersze | Bez tokenu | Zły token | DTO |
|---|---|---|---|---|
| `GET /situations` | lista A nie zawiera wierszy B | 401, D1 nietknięte (obserwowalne: brak zapytania? nie — obserwuj skutek: 401 nawet z pustą bazą/bez zasiewu) | 401 | klucze dokładnie `{id,status,transcript,duration_ms,flashcards_status,created_at}` |
| `DELETE /situations/:id` | 404, wiersz i fiszki B zostają | 401 | 401 | 204 bez ciała |
| `POST /situations` | n/d (tworzy pod tokenem) | 401 przed `R2.put` (bucket pusty po żądaniu) | 401 | jak wyżej (już w `harness.test.ts:46-47`) |
| `GET /flashcards/proposals` | `proposals` bez fiszek B; `generatingCount` liczy tylko sytuacje A | 401 | 401 | klucze dokładnie `{id,situation_id,type,front_en,back_pl,example_en,created_at}`; brak `is_variant` **także dla fiszki zasianej z `is_variant=1`** |
| `POST /flashcards/:id/accept` | 404, `status` fiszki B nadal `proposed` | 401 | 401 | 200 puste ciało; **ponowna akceptacja własnej → 404** |
| `DELETE /flashcards/:id` | 404, fiszka B zostaje | 401 | 401 | 204 |
| `GET /auth/me` | n/d | 401 | 401 | `{ user: { id, email } }`, bez `password_hash` |

- **„401 przed dotknięciem D1"** — obserwowalny skutek, nie lustro: `POST /situations` bez tokenu → 401 i `env.AUDIO_BUCKET.list()` puste, `SELECT COUNT(*) FROM situations` = 0; dla `GET` wystarczy 401 na pustej bazie (żaden wiersz nie powstaje) plus opcjonalnie trigger `BEFORE INSERT/UPDATE/DELETE` z `RAISE(ABORT)` jako sonda „ktoś dotknął tabeli" — istniejący mechanizm `withTrigger` (`db.ts:93`).
- **Asercja DTO jako dokładny zbiór kluczy** (`Object.keys(x).sort()` `toEqual` lista z `src/lib/api.ts`), nie `not.toHaveProperty` trzech nazw — łapie każdy addytywny wyciek (`SELECT` bez mapowania w `flashcards.ts:38`), a wzorcem jest kontrakt z frontem, nie implementacja.
- **Deliberate-breaks dostępne**: usunięcie `AND user_id = ?` z `flashcards.ts:64` (cudza akceptacja przechodzi); przeniesienie `flashcardsRouter.use('*', requireAuth)` poniżej pierwszej trasy; dopisanie `is_variant` lub `user_id` do `SELECT` w `flashcards.ts:38`; usunięcie `.map(toDTO)` w `situations.ts:254`.
- **Poza zakresem lub obserwacja**: token usuniętego usera (500 na `POST`), brak `exp` w tokenach, text/plain 404 z tokenem na niedopasowanej ścieżce, niezłapany `R2.delete` (S-01 F4) — warte odnotowania w planie jako follow-upy, nie jako testy Fazy 2, chyba że plan uzna inaczej.

**Ryzyko #6 — obserwowalne na poziomie trasy, ale wyrocznia PRD nie ma dziś kanału wejścia.**

- Co test *może* dziś deterministycznie dowieść na realnym zegarze: zasiew `created_at = datetime('now','start of day')` → w liście / licznik 1; `datetime('now','start of day','-1 second')` → poza listą / licznik 0; `datetime('now','-1 day')` → poza. To jest **asercja obecnego UTC** — dokładnie anty-wzorzec z §2 planu. Nadaje się co najwyżej jako test regresji kształtu odpowiedzi, nie jako dowód ryzyka #6.
- Co test *musi* zakodować (PRD `US-01`, `FR-006`, `FR-009`, `prd.md:44-46, 71, 79, 101`): sytuacja nagrana o 23:30 czasu Warszawy jest na liście „dziś" i liczy się jako „generuję" do lokalnej północy; to samo po obu stronach DST. Z `vi.setSystemTime` kontrolującym `Date` w JS (ale nie SQL) i zasiewem `created_at` w UTC, taki test jest dziś **czerwony z definicji** — SQL `date('now')` liczy realny dzień, więc wiersz z 2026-03-28 nigdy nie będzie „dziś". Kształt: `it.fails` z follow-upem, jak T1.3 (§6.2 planu), do czasu decyzji S-01 F1.
- **Każda z dwóch poprawek PENDING przenosi decyzję o dniu z SQL `date('now')` do JS** (Fix A: klient przekazuje granice lokalnego dnia, serwer filtruje zakresem `[start, koniec)`; Fix B: serwer liczy dzień w `Europe/Warsaw` przez `Intl` z jawnym `timeZone`). W obu przypadkach `vi.setSystemTime` + zasiew `created_at` w UTC stają się wystarczającą dźwignią, a test z `it.fails` zmieni się na `it` bez przepisywania asercji — pod warunkiem, że kształt żądania (ewentualny param/nagłówek Fix A) żyje w jednym helperze `request.ts`, nie w asercjach.
- **Przenośność**: asercje tylko na UTC lub jawnym `timeZone`; nigdy `getHours()`/`toLocale*` bez strefy (lokalnie Warszawa, w CI UTC).
- **Anty-flake**: nie siać `datetime('now','-N seconds')` w testach dnia; używać `'start of day'` lub jawnych wartości absolutnych z `vi.setSystemTime`.

## Code References

Permalinki do commitu `3d554c9`:

- [`api/src/index.ts:20-30`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/index.ts#L20-L30) — montaż `/health`, `/auth`, `/situations`, `/flashcards`; brak `onError`/`notFound`
- [`api/src/middleware/auth.ts:13-28`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/middleware/auth.ts#L13-L28) — `requireAuth`: nagłówek → `verifySession` → `c.set('userId')`; bez D1
- [`api/src/lib/jwt.ts:22`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/lib/jwt.ts#L22) — payload `{ sub: String(userId) }`, bez `exp`
- [`api/src/routes/situations.ts:177`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/situations.ts#L177) — `situationsRouter.use('*', requireAuth)` przed trasami
- [`api/src/routes/situations.ts:57-66`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/situations.ts#L57-L66) — `toDTO` whitelist `SituationDTO`
- [`api/src/routes/situations.ts:214`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/situations.ts#L214) — `INSERT ... RETURNING *` (`user_id` z tokenu)
- [`api/src/routes/situations.ts:249`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/situations.ts#L249) — lista dnia: `WHERE user_id = ? AND date(created_at) = date('now')` (UTC)
- [`api/src/routes/situations.ts:266-288`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/situations.ts#L266-L288) — `DELETE /:id`: SELECT z `id AND user_id` → 404; `R2.delete` bez try/catch; kasowanie fiszek i sytuacji
- [`api/src/routes/situations.ts:97-113`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/situations.ts#L97-L113) — tło: `INSERT flashcards` z `userId` z domknięcia + `flashcards_status='done'` w `DB.batch`
- [`api/src/routes/flashcards.ts:31`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/flashcards.ts#L31) — `flashcardsRouter.use('*', requireAuth)`
- [`api/src/routes/flashcards.ts:38`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/flashcards.ts#L38) — `SELECT` propozycji = jedyna whitelista DTO (bez `user_id`, `status`, `is_variant`)
- [`api/src/routes/flashcards.ts:47`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/flashcards.ts#L47) — `generatingCount` z filtrem dnia UTC
- [`api/src/routes/flashcards.ts:64-74`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/flashcards.ts#L64-L74) — `accept`: `UPDATE ... WHERE id = ? AND user_id = ? AND status = 'proposed'`, `meta.changes === 0` → 404, `c.body(null, 200)`
- [`api/src/routes/flashcards.ts:86-95`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/flashcards.ts#L86-L95) — `DELETE /:id`: `WHERE id = ? AND user_id = ?`, 404/204
- [`api/src/types.ts:7-22`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/types.ts#L7-L22) — `Bindings`/`Variables` (`userId: string`); brak typów DTO
- [`api/migrations/0001_create_users.sql:7-10`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/migrations/0001_create_users.sql#L7-L10), [`0002_create_situations.sql:8-14`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/migrations/0002_create_situations.sql#L8-L14), [`0003_create_flashcards.sql:8-16`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/migrations/0003_create_flashcards.sql#L8-L16) — INTEGER `id`/`user_id` z FK, `created_at TEXT DEFAULT (datetime('now'))`
- [`api/migrations/0004_add_flashcard_variant_flag.sql`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/migrations/0004_add_flashcard_variant_flag.sql) — `is_variant`
- [`api/test/db.ts:46-60`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/test/db.ts#L46-L60) — `seedUser`: bezpośredni INSERT + `signSession`
- [`api/test/db.ts:106-122`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/test/db.ts#L106-L122) — `resetDb`
- [`api/test/request.ts:26-72`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/test/request.ts#L26-L72) — helpery żądań (zawsze `Bearer`, prywatny `getJson`)
- [`api/test/setup.ts:22-32`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/test/setup.ts#L22-L32) — `applyD1Migrations`, `afterEach(vi.restoreAllMocks)` (nie cofa `setSystemTime`)
- [`api/test/harness.test.ts:46-47`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/test/harness.test.ts#L46-L47) — istniejąca asercja braku `audio_key`/`user_id` w `POST /situations`
- [`api/src/routes/situations.integration.test.ts:38-46`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/src/routes/situations.integration.test.ts#L38-L46) — prywatny `seedPending` z `datetime('now', ?)`
- [`api/vitest.config.mts:26-31`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/api/vitest.config.mts#L26-L31) — `JWT_SECRET: 'test-secret'` w `miniflare.bindings`
- [`src/lib/api.ts:125-134`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/src/lib/api.ts#L125-L134), [`:180-188`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/src/lib/api.ts#L180-L188) — typy `Situation`/`Flashcard` na froncie (wzorzec dla asercji zbioru kluczy)
- [`src/app/(app)/index.tsx:21-28`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/src/app/(app)/index.tsx#L21-L28) — klient dokleja `Z` do `created_at` (wie, że serwer oddaje UTC)
- [`src/components/situation-list.tsx:37-44`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/src/components/situation-list.tsx#L37-L44) — godzina w strefie urządzenia (`toLocaleTimeString`)
- [`src/app/(app)/flashcards.tsx:51-54`](https://github.com/kali82marek/my-english-day/blob/3d554c90d25aaca48c231441fcee34e1d450dc45/src/app/(app)/flashcards.tsx#L51-L54) — klient bierze `generatingCount` z serwera, nie liczy sam

## Architecture Insights

- **Własność = jeden wzorzec w każdym zapytaniu, zero warstwy pośredniej.** Nie ma repozytorium, guarda ani helpera „`assertOwnership`"; każdy handler sam wpisuje `user_id = ?` w `WHERE`. To działa i jest tanie, ale znaczy, że każdy nowy endpoint (S-04/S-05) może zapomnieć klauzuli bez żadnego sygnału z typów — jedynym strażnikiem będzie test dwóch użytkowników. Faza 2 powinna zostawić w `§6.3` wzorzec, który S-04/S-05 skopiują.
- **404 zamiast 403 jest decyzją projektową od S-01** (`archive/…capture-situation-by-voice/plan.md:147`) i wynika naturalnie z konstrukcji: warunek własności w tym samym `WHERE` co id, decyzja po `meta.changes` lub wstępnym `SELECT`. Konsekwencja: brak wyroczni istnienia — dobrze — ale też brak rozróżnienia „już zaakceptowana" od „cudza" w `accept`.
- **DTO są zdefiniowane przez `SELECT`, nie przez typ.** `SituationDTO` ma mapowanie (`toDTO`), `FlashcardDTO` nie ma. Zbiór kluczy DTO żyje w trzech miejscach ręcznie (trasa, `src/lib/api.ts`, test integracyjny). Test zbioru kluczy jest jedynym mechanizmem wykrycia addytywnego wycieku.
- **`user_id` jako string w całym API** (JWT `sub` → kontekst → bind) przeciw INTEGER w bazie — poprawne przez afiniczność, ale niewidoczne dla TypeScript. Test dwóch użytkowników jest jedynym miejscem, gdzie ta konwersja jest wykonywana naprawdę.
- **Dzień = SQL `date('now')` w dwóch miejscach, oba UTC, bez kanału na strefę.** Klient wie, że serwer mówi UTC (dokleja `Z`) i pokazuje lokalną godzinę, ale nie ma głosu w sprawie dnia. Każda poprawka przeniesie decyzję o dniu z SQLite do JS (klient lub `Intl` z jawnym `timeZone`), co jednocześnie uczyni ją kontrolowalną przez `vi.setSystemTime`.
- **Harness kontroluje `Date` w izolacie, nie zegar SQLite.** To rozdzielenie jest trwałe (workerd + D1 w jednym procesie, ale SQLite ma własny VFS-owy zegar). Testy czasu muszą projektować dane względem realnego UTC albo czekać na przeniesienie logiki dnia do JS.
- **TZ izolatu jest nieprzenośne** (Windows: strefa hosta; Linux/CI/prod: UTC). Reguła dla kodu i testów: tylko `toISOString()`/UTC lub jawny `timeZone`.

## Historical Context (from prior changes)

**Ryzyko #3 (własność):**
- `context/archive/2026-06-02-minimal-auth-app-spine/plan.md:160` — kontrakt 401 middleware („na brak/niepoprawny token → 401"); `:383` — konwencja: slice'y dodają tabele z `user_id` FK i „filtrują per zalogowany użytkownik".
- `context/archive/2026-06-07-capture-situation-by-voice/plan.md:147` — **„Zwróć `204` lub `404` jeśli nie należy/istnieje"** (decyzja 404, nie 403); `:149` — „`audio_key` nie jest eksponowany klientowi"; `:368-369` — 2.6/2.7 (izolacja, cudza sytuacja → 404) odhaczone **ręcznie**; `reviews/impl-review.md:28` — przegląd potwierdza brak wycieku, nie otwiera findingu.
- `context/archive/2026-06-07-gated-ai-flashcard-generation/plan.md:165-168` — `accept`/`DELETE` 200/404 i 204/404, DTO bez `status` i `user_id`; `:296` — test własności **zaplanowany, nigdy nie napisany**; `:361` — 2.6 odhaczone ręcznie; `reviews/impl-review.md:21` — string vs INTEGER „zweryfikowane, NIE jest błędem, brak akcji".
- `context/archive/2026-06-09-same-context-variants/plan.md:20` — **„`is_variant` tylko server-side — DTO `/proposals` go NIE eksponuje"**; `:36` — brak nowych endpointów; `reviews/impl-review.md:21` — payload bez flagi sprawdzony ręcznie.
- `context/archive/2026-09-03-testing-worker-harness-background-jobs/plan.md:108-109` — własność/dzień jawnie odłożone do Fazy 2; `research.md:192` — string/INTEGER „to teren Fazy 2"; `plan.md:272` — jedyna istniejąca asercja DTO (`POST /situations` bez `audio_key`/`user_id`).
- PRD: `context/foundation/prd.md:105` — „każdy użytkownik widzi tylko swoje dane"; `:110` — „każdy użytkownik ma swoją zamkniętą bazę"; `:117` — Open Question #2 (zachowanie dla niezalogowanego) **nierozstrzygnięte** — test może kodować 401, nie kształt komunikatu.

**Ryzyko #6 (dzień):**
- `context/archive/2026-06-07-capture-situation-by-voice/plan.md:146` — wyrażenie `date(created_at)=date('now')` **jest w samym planie**; `reviews/impl-review.md:33-50` — **F1 ⚠️ „Lista dnia liczy dzień w UTC" — Decision: PENDING**; Fix A ⭐ (klient przekazuje granice lokalnego dnia, serwer filtruje zakresem; blind spot: czy ufać zegarowi klienta) vs Fix B (hardkod Europe/Warsaw; łamie się przy DST i dla innych stref).
- `context/archive/2026-06-07-gated-ai-flashcard-generation/plan.md:164` — plan `generatingCount` **bez** filtru dnia; `reviews/impl-review.md:66-74` — **F4 🔭 „generatingCount liczy tylko dzień bieżący" — EXTRA poza planem, „Brak akcji — świadomy tradeoff spójny z `GET /situations`", Decision: PENDING**.
- `context/archive/2026-09-03-testing-worker-harness-background-jobs/research.md:184` — „`date('now')` jest w UTC i w SQLite, i w workerd"; `plan.md:160-163` i `follow-ups/stale-pending-server-rule.md:58-65` — okno ~2,5 min po północy UTC w T1.3 przekazane do ryzyka #6 / Fazy 2; `follow-ups/stale-pending-server-rule.md:31-33` — reguła wieku `pending` musi objąć także `generatingCount` (sprzężenie ryzyk #1 i #6).
- PRD oracle (bez słowa „UTC" ani liczby): `prd.md:44-46` (US-01 „wieczorem widzi wygenerowane fiszki"), `:67` (FR-005 „wiele sytuacji w ciągu dnia"), `:71` (FR-006 „z zapisanych sytuacji dnia"), `:79` (FR-009 „propozycje fiszek dnia"), `:101` („wieczorem otwiera aplikację, widzi gotowe propozycje fiszek z sytuacji dnia"), `:25` (persona: „sięga po telefon w momencie, gdy właśnie przeżył taką sytuację"). Sformułowanie „23:30 czasu Warszawy" istnieje tylko w `test-plan.md:52, 69`.

## Related Research

- `context/archive/2026-09-03-testing-worker-harness-background-jobs/research.md` — badanie Fazy 1: harness, zadania tła, `date('now')` w UTC (`:184`), string/INTEGER (`:192`), najtańszy zasiew użytkownika (`:191`).
- `context/archive/2026-06-07-capture-situation-by-voice/research.md`, `context/archive/2026-06-07-gated-ai-flashcard-generation/research.md`, `context/archive/2026-06-09-same-context-variants/research.md` — badania slice'ów, które wprowadziły trasy i DTO.

## Open Questions

1. **Kanał wejścia dla dnia lokalnego (S-01 F1, PENDING).** Bez decyzji Fix A / Fix B test ryzyka #6 kodujący PRD jest `it.fails`. Plan musi zdecydować: (a) `it.fails` + follow-up (zgodne z §6.2 planu testów, zero zmian w kodzie produkcyjnym), czy (b) Faza 2 wnosi poprawkę razem z testem (jak Faza 1 wniosła S-01 F2 i follow-up S-03). Jeśli (b) — która opcja; zauważ, że Fix A przenosi kontrakt do żądania (test musi wysłać granice dnia — trzymać w jednym helperze), a Fix B wymaga jawnego `timeZone` w `Intl` (lokalny izolat na Windows i tak jest w Warszawie, więc test bez jawnej strefy przeszedłby lokalnie i padł w CI).
2. **Czy `generatingCount` ma podążać za tą samą regułą dnia co lista (S-02 F4, PENDING)?** Test może utrwalić spójność „licznik = ta sama reguła dnia co lista" bez asercji, że reguła to UTC. Do potwierdzenia w planie.
3. **Sprzężenie z regułą wieku `pending` (follow-up Fazy 1).** Reguła 2 min ma objąć `generatingCount`; oba filtry (wiek i dzień) siedzą w tych samych dwóch zapytaniach. Plan Fazy 2 powinien uniknąć testu, który po wejściu follow-upu ryzyka #1 zacznie się mylić z testem dnia (zasiew `created_at` względem `now` w obu).
4. **Zakres 401**: czy Faza 2 testuje `GET /auth/me` (jedyna trasa wykrywająca usuniętego usera) i scenariusz „token usuniętego użytkownika" (500 na `POST /situations`), czy odkłada je jako obserwacje? Rekomendacja: 401 bez tokenu / zły token na wszystkich 8 trasach jako jedna parametryzowana macierz; usunięty user jako follow-up.
5. **Text/plain 404 z tokenem na niedopasowanej ścieżce** i **brak `exp` w tokenach** — poza ryzykami #3/#6; kandydaci do `--refresh` lub follow-upu, nie do Fazy 2.
6. **Helpery do dodania w `api/test/`** (produkt uboczny Fazy 2, do zapisania w `§6.3`/`§6.4`): generyczny `call(env, { method, path, token?, headers?, body? })` z możliwością pominięcia `Authorization`; `deleteSituation`, `acceptFlashcard`, `deleteFlashcard`, `getMe`; `seedSituation(env, userId, { status?, flashcardsStatus?, createdAt?, transcript?, audioKey? })` i `seedFlashcard(env, { situationId, userId, status?, isVariant?, createdAt? })` w `db.ts` (przeniesienie prywatnego `seedPending`); `readFlashcard(id)`, `readSituationsOf(userId)`; `afterEach(() => vi.useRealTimers())` przy każdym użyciu `setSystemTime`.

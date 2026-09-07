# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-04

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "<the
   team is worried about X, and the failure would surface somewhere in
   <area>>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `api/src/`, `api/migrations/`
(wykluczone: `context/`, `assets/`, `scripts/`, `node_modules/`). Skan 30-dniowy
pominięty: tylko 2 commity w kodzie w tym oknie (zabezpieczenie „<5”). Prawdopodobieństwo
w §2 opiera się na roadmapie, archiwum i wywiadzie; churn z całego cyklu życia
(od 2026-06-02: `api/src/lib` 12, `src/app/(app)` 9, `api/src/routes` 8 commitów)
jest wyłącznie mapą, gdzie kod się kumuluje.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Nagranie cicho przepada: sytuacja wisi w „transkrybuję…” na zawsze (ubite zadanie tła, błąd zapisu stanu), po restarcie aplikacji wraca wieczny `pending`, albo zapis pada gołym 500 z osieroconym plikiem audio, a użytkownik myśli, że zapisał | High | High | PRD guardrail „bez zapisów nie ma fiszek”, US-01; archive S-01 `reviews/impl-review.md` F2, F3 (decyzje PENDING); interview Q1, Q4 |
| 2 | Wieczorem brak fiszek lub połowa: generowanie w tle failuje po cichu lub zapisuje część kart i zostawia stan niespójny; użytkownik otwiera Fiszki, nic nie ma, nie wie dlaczego; metryka ≥70% akceptacji niepoliczalna | High | High | PRD FR-006, FR-010, Success Criteria; roadmap S-02 gwiazda przewodnia; archive S-02 review F1, S-03 review F1 + `follow-ups/review-fixes.md` (atomowy zapis odroczony); interview Q1, Q4 |
| 3 | Cudze dane (nadużycie, IDOR): zalogowany użytkownik z cudzym id odczytuje, akceptuje lub kasuje nie swoją sytuację/fiszkę, albo lista zwraca cudze wiersze | High | Medium | PRD Access Control „każdy widzi tylko swoje dane”; archive F-01/S-01/S-02 plany: własność weryfikowana wyłącznie ręcznie; roadmap S-04/S-05 dodadzą nowe endpointy |
| 4 | Nowy Worker na starej bazie produkcyjnej: kod wymienia kolumnę, której migracja nie utworzyła, generowanie failuje dla wszystkich użytkowników; nikt nie sprawdza kolejności migracja → deploy | High | Medium | archive S-03 review F4 + follow-ups (checklista deployu); roadmap Baseline: brak CI, deploy ręczny; infrastructure.md: rollback nie cofa D1 |
| 5 | Zmiana promptu, schematu lub modelu psuje kontrakt po cichu: nieznany `type`, brak flagi wariantu, pusta lista lub 30 kart przeciekają do bazy i UI (etykieta typu `undefined`) | Medium | High | PRD FR-006, FR-007; roadmap S-04 dotknie generatora; archive S-02 review F2 (brak CHECK na enumach), S-03 review F2; churn `api/src/lib/` 12 commitów (cały cykl życia) |
| 6 | Dzień liczony w UTC: sytuacja nagrana późnym wieczorem w Polsce ląduje w „wczoraj”/„jutro”; lista dnia i licznik „generuję…” kłamią między północą lokalną a 01:00–02:00, dwa razy w roku inaczej (DST) | Medium | High | PRD US-01 „wieczorem widzi fiszki z sytuacji dnia”; archive S-01 review F1 (PENDING), S-02 review F4 (wzorzec powielony) |

Nie dopchnięte do mapy (High × Low lub Medium × Low; obserwacja/smoke, nie test):
bramka auth migająca logowaniem po restarcie (kod stabilny od czerwca, brak runnera
frontu); format audio z urządzenia nieakceptowany przez Whisper (awaria żyje w presecie
nagrywania, zob. lessons.md; ręczny smoke na urządzeniu); pętla uploadów generująca koszt
Whisper/gpt-4o (zamknięta aplikacja, mała baza użytkowników; wyzwalacz `--refresh`).

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Nieudana lub ubita transkrypcja kończy się widocznym `failed` („nagraj ponownie”) w ograniczonym czasie, nigdy wiecznym `pending`; nieudany zapis zwraca czytelny błąd i nie zostawia osieroconego audio | „201 + zadanie tła = rekord się sfinalizuje”; „60 s limit w kliencie to załatwia” (maskuje; serwer po restarcie dalej zwraca `pending`) | punkt wejścia finalizacji w tle; kto i kiedy pisze przejścia `pending`/`done`/`failed`; kolejność kasowania audio względem zapisu; jak lista dnia mapuje stary `pending`; wartość i rola limitu w kliencie | integration w workerd (Worker + izolowane D1 z migracjami + mock OpenAI na krawędzi sieci), z kontrolą zakończenia zadania tła | tylko szczęśliwa ścieżka `done`; mockowanie D1/R2 od środka; przepisanie stałej 60 s z klienta do asercji |
| #2 | Po udanej transkrypcji albo wszystkie karty są propozycjami i stan generowania to `done`, albo zero kart i `failed`; nigdy część kart + `failed`; transkrypt nigdy nie ginie przez błąd generowania; `failed` jest obserwowalne w logu | „`done` implikuje, że karty istnieją”; „pętla jest mała, częściowy błąd to teoria”; „Structured Outputs gwarantuje niepustą listę” | kolejność kroków w zadaniu tła; strategia zapisu kart (pętla vs batch; follow-up otwarty); bezpiecznik idempotencji; co licznik „generuję” liczy i jak filtruje dzień | integration w workerd z błędem wstrzykniętym na krawędzi D1 (w środku zapisu) i na krawędzi OpenAI | test, który przechodzi tylko przez odbicie implementacji batcha; asercje na tekście logu; nadmierne mockowanie D1 |
| #3 | Przy danych dwóch użytkowników każdy endpoint odczytu/mutacji zwraca 404 lub pustą listę dla cudzych id; bez tokena 401 przed dotknięciem bazy; DTO nie wycieka `user_id`, klucza audio ani flagi wariantu | „requireAuth na routerze = własność wymuszona”; „404 z planu jest utrzymane w nowych endpointach S-04/S-05” | jak id użytkownika z tokena trafia do SQL (string vs INTEGER, affinity); pełna lista endpointów; kształt DTO każdej odpowiedzi | integration na poziomie tras z dwoma zasianymi użytkownikami | tylko własny użytkownik (szczęśliwa ścieżka); asercja, że tekst SQL zawiera `user_id` (lustro implementacji) |
| #4 | Migracje aplikują się od zera po kolei, a zapytania kodu działają na schemacie zbudowanym wyłącznie z migracji; Worker wymieniający nieistniejącą kolumnę obala suite przed deployem | „addytywne migracje = kolejność nieważna”; „lokalne D1 == produkcyjne D1” | katalog migracji i narzędzie aplikowania; jak harness buduje bazę testową; checklista deployu z follow-upów S-03 | setup harnessu integration (migracje w setupie testów; produkt uboczny Fazy 1) + bramka checklisty pre-deploy | snapshot wyniku `PRAGMA table_info` (migawka bez znaczenia); test tekstu SQL migracji |
| #5 | Dla zdegenerowanej odpowiedzi modelu (nieznany `type`, brak flagi, pusta lista, 30 kart, pusty front) generator odrzuca (→ `failed`, zero wierszy) lub przycina deterministycznie; żądanie zawsze niesie ścisły schemat z wymaganymi polami | „strict:true = nie trzeba kodu obronnego”; „jakość treści = kontrakt” (treść poza zakresem, §7) | definicja schematu i lista pól wymaganych; ścieżka parsowania i limit kart; gdzie `type` trafia w UI | unit/contract z mockiem fetch (rozszerzenie istniejących testów generatora) | asercja dokładnego tekstu promptu (blokuje iterację promptu); sędzia LLM oceniający angielski |
| #6 | Sytuacja nagrana 23:30 czasu Warszawy jest na liście „dziś” i liczy się jako „generuję” do lokalnej północy, nie do północy UTC; zachowanie trzyma się przez DST | „`date('now')` to dziś”; „użytkownicy są tylko w PL, hardkod wystarczy” (decyzja PENDING; test koduje zachowanie z PRD, nie wybraną poprawkę) | które endpointy filtrują po dniu; czy klient przekazuje granicę dnia lub offset; stan decyzji S-01 F1 | integration na trasach z kontrolowanym czasem i strefą | asercja obecnego wyniku UTC (problem wyroczni); zamrożony offset w asercji |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Harness Workerów + zadania w tle | Udowodnić, że zadanie tła zawsze kończy się widocznym stanem, bez utraty nagrania i bez połowicznych zapisów; harness workerd z izolowanym D1 i migracjami | #1, #2, #4 | integration (workerd, izolowane D1 z migracjami, mock OpenAI na krawędzi sieci) | complete | `context/changes/testing-worker-harness-background-jobs/` |
| 2 | Kontrakty tras: własność, izolacja, dzień | Udowodnić, że użytkownik widzi i zmienia tylko swoje dane i właściwy dzień lokalny | #3, #6 | integration na poziomie tras (dwóch użytkowników, kontrolowany czas) | complete | `context/archive/2026-09-04-testing-route-contracts-ownership-day/` |
| 3 | Kontrakt generatora LLM | Udowodnić, że zdegenerowana odpowiedź modelu nie przecieka do bazy ani UI | #5 | unit/contract (mock fetch) | change opened | `context/changes/testing-llm-generator-contract/` |
| 4 | Bramki jakości | Zablokować podłogę: jedno lokalne polecenie (lint + typecheck + testy API) i checklista deployu; CI nazwane, konfiguracja w lekcji CI | cross-cutting | gates | not started | — |

Warstwa AI-natywna: brak osobnej fazy. Wywiad (Q5) wyklucza sędziego LLM na treści
i przegląd wizualny; pozostały kandydat (agentowy smoke w przeglądarce na buildzie web)
nie bije kosztem × sygnałem testów integracyjnych i jest tylko opcjonalnym wierszem w §4.
Runner frontu (`jest-expo`) świadomie poza wdrożeniem: żadne ryzyko top-6 nie wymaga go
jako najtańszej warstwy (zob. §7, §8).

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

Profil bazy testowej na 2026-09-03: **sparse**. Vitest skonfigurowany w `api/`
(środowisko `node`, bez bindingów D1/R2), 4 pliki testowe (20 testów) wyłącznie w
`api/src/lib/`: hasło, JWT, klient transkrypcji, generator fiszek. Zero testów tras,
middleware, migracji i frontu. Brak CI.

Po Fazie 1 wdrożenia (2026-09-03): wszystkie testy API biegną w jednym poolu workerd
(`api/vitest.config.mts`) na D1 zbudowanym wyłącznie z `api/migrations/`; 6 plików,
32 testy (31 zielonych + 1 `it.fails` jako otwarty follow-up): 20 jednostkowych w
`api/src/lib/`, 3 testy właściwości harnessu w `api/test/`, 9 integracyjnych trasy
`/situations`. Nadal brak testów frontu i CI.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit (api, prymitywy) | Vitest | ^4.1 (api/package.json) | istnieje; biegnie w workerd, jeden pool z testami integracyjnymi (od Fazy 1); Web Crypto + mock `fetch` |
| integration (api, Worker + D1) | Vitest + `@cloudflare/vitest-plugin` (dawniej `vitest-pool-workers`) — checked: 2026-09-03 | vitest ^4.1 + @cloudflare/vitest-plugin ^1.1 (zainstalowane) | `api/src/routes/<route>.integration.test.ts` obok trasy, helpery i setup w `api/test/` (zob. §6.2); izolowane D1 per plik testowy ze schematem wyłącznie z `api/migrations/` |
| API mocking | mock globalnego `fetch` na krawędzi sieci (istniejący wzorzec w testach generatora i transkrypcji) | n/a | brak MSW; Worker używa natywnego `fetch`; nigdy nie mockować D1/R2 od środka |
| front unit | none — deliberately outside this rollout | n/a | ścieżka, gdy zajdzie potrzeba: `jest-expo` + `@testing-library/react-native` (SDK 56, React 19; `react-test-renderer` nie wspiera React 19) — checked: 2026-09-03 |
| e2e (mobile) | none automated — ręczny smoke na urządzeniu wg sekcji Manual zarchiwizowanych planów | n/a | ścieżka, gdy zajdzie potrzeba: Maestro (black-box, YAML) — checked: 2026-09-03; Detox tylko przy potrzebie gray-box |
| accessibility | none | n/a | poza zakresem MVP |
| (optional) AI-native | agentowy smoke eksploracyjny w przeglądarce na buildzie web (skill `claude-in-chrome`) — checked: 2026-09-03 | n/a | Kiedy NIE używać: nigdy jako bramka regresji; nigdy dla ścieżki z mikrofonem (automatyzacja przeglądarki nie steruje nagrywaniem wiarygodnie); nigdy zamiast testu integracyjnego, który już istnieje. Użycie: jednorazowy przegląd ekranu Fiszki przed deployem, gdy zmienił się przegląd |

**Stack grounding tools (current session):**
- Docs: none — Context7 ani MCP dokumentacji frameworków niedostępne w sesji; oparto się na oficjalnych stronach Cloudflare i Expo znalezionych przez wyszukiwarkę; checked: 2026-09-03
- Search: wbudowane WebSearch (nie MCP; Exa.ai niedostępne) — potwierdzono: zmianę nazwy `@cloudflare/vitest-pool-workers` → `@cloudflare/vitest-plugin` (changelog Cloudflare 2026-08-19) i przepis na izolowane D1 z migracjami; `jest-expo` + RNTL jako oficjalną ścieżkę SDK 56; Maestro jako domyślną rekomendację e2e RN 2026; checked: 2026-09-03
- Runtime/browser: Playwright MCP niedostępne; skill `claude-in-chrome` dostępny — possible use: opcjonalny smoke web (zob. tabela); checked: 2026-09-03
- Provider/platform: MCP Cloudflare/GitHub niedostępne w sesji; `wrangler` CLI lokalnie (d1 migrations, tail, deploy) jest jedynym narzędziem bramek pre-deploy — quality-gate relevance: checklista migracja → deploy (§5); checked: 2026-09-03

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck (front: `expo lint`, `tsc --noEmit`; api: `npm run typecheck`) | local; CI planned | required (dziś ręcznie, per plan slice'a); jedno polecenie required after §3 Phase 4 | dryf składni i typów, rozjazd typów DTO front ↔ api |
| unit + integration (api) | local; CI planned | required (od Fazy 1; lokalnie `cd api && npm test`) | regresje zadań tła, przejść stanu, migracji, własności, dnia, kontraktu generatora |
| e2e on critical flows | ręczny smoke na urządzeniu (nagranie → `pending` → transkrypt → Fiszki → akceptuj), checklista z sekcji Manual zarchiwizowanych planów | required manually before deploy; not automated in this rollout (zob. §7) | format audio z urządzenia, uprawnienia mikrofonu, bramka auth po restarcie |
| pre-prod smoke: migracja przed deployem | local (`wrangler d1 migrations apply --remote` → `wrangler deploy`), checklista z follow-upów S-03 | required after §3 Phase 4 | Worker na starej bazie (Risk #4) |
| post-edit hook | local (agent loop) | recommended after §3 Phase 4 (konfiguracja hooków należy do Lekcji 3) | regresje testów api w czasie edycji |
| visual diff (deterministic) | — | excluded (§7, interview Q5) | — |
| multimodal visual review | — | excluded (§7, interview Q5) | — |

CI (GitHub Actions) jest zaparkowane w roadmapie i należy do lekcji CI; ten plan nazywa
bramki, które CI ma uruchamiać (dwa pierwsze wiersze), a Faza 4 dostarcza jedno lokalne
polecenie, które CI później wywoła bez zmian.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test (api, czysta funkcja bez bindingów)

- **Location**: `api/src/lib/` obok modułu pod testem.
- **Naming**: `<module>.test.ts` (włączane przez `src/**/*.test.ts` w `api/vitest.config.mts`).
- **Reference test**: `api/src/lib/flashcards.test.ts` (mock `fetch` na krawędzi sieci, asercje na kształcie żądania i mapowaniu błędów); `api/src/lib/password.test.ts` (prymityw Web Crypto).
- **Run locally**: `cd api && npm test`.
- **Uwaga**: ten wzorzec NIE nadaje się do niczego, co dotyka D1/R2 ani `executionCtx` — to §6.2.

### 6.2 Adding an integration test (Worker + izolowane D1 + zadanie tła)

- **Location**: `api/src/routes/<route>.integration.test.ts` obok trasy pod testem. Helpery w `api/test/`: `db.ts` (`seedUser`, `readSituation`, `readFlashcards`, `withTrigger`, `raiseAbort`, `resetDb`), `openai-mock.ts` (`mockOpenAI`, `whisperResponse`, `chatResponse`), `request.ts` (`postSituation`, `getSituations`, `getProposals`). Setup wspólny dla każdego pliku: `api/test/setup.ts` (schemat z `api/migrations/` przez `applyD1Migrations` + guard „niezamockowany `fetch` rzuca”). Konfiguracja: `api/vitest.config.mts` (pool workerd z bindingami z `wrangler.toml`, sekrety testowe nadpisujące `.dev.vars`).
- **Naming**: `<route>.integration.test.ts` (włączane przez `src/**/*.test.ts`). Jeden `describe` na ryzyko, nazwany numerem i tytułem z §2 (`describe('Ryzyko #2: fiszki wszystko-albo-nic')`). Tytuł testu: `T<ryzyko>.<n>` + obserwowalny skutek w kategoriach użytkownika („→ zero kart i `failed`”), nigdy nazwa funkcji. Nazwany deliberate-break w komentarzu nad testem.
- **Reference test**: `api/src/routes/situations.integration.test.ts` — T2.2 jako wzorzec „błąd D1 w środku zapisu wstrzyknięty triggerem na krawędzi” (`withTrigger` + `raiseAbort`, warunek `WHEN` na liczbie wierszy), T1.2 jako wzorzec „odpowiedź HTTP + stan D1 + stan R2 po błędzie”, T1.3 jako wzorzec `it.fails` z follow-upem; `api/test/harness.test.ts` jako wzorzec `createExecutionContext` → `app.fetch(req, env, ctx)` → `waitOnExecutionContext(ctx)` i dowód, że odrzucona obietnica w `waitUntil` obala test.
- **Run locally**: `cd api && npm test` (cały suite, ~3 s). Pojedynczy plik: `cd api && npx vitest run src/routes/situations.integration.test.ts`. Pojedyncze ryzyko: `cd api && npx vitest run -t "Ryzyko #2"`.
- **Reguły**:
  - Sieć: mockuj wyłącznie `globalThis.fetch` przez `mockOpenAI({ transcription?, chat? })`; brak wpisu lub inny adres rzuca `Unmocked fetch: <url>`, więc test nigdy nie wychodzi do sieci. Zwrócony spy służy do asercji na liczbie wywołań („chat nie wywołany po błędzie Whisper”).
  - D1/R2 nigdy od środka: obserwuj skutek (`readSituation`, `readFlashcards`, `env.AUDIO_BUCKET.list()`, odpowiedź `GET`), nie wywołania bindingu. Błędy D1 wstrzykuj na krawędzi: `withTrigger(env, 'test_<co>', \`BEFORE INSERT ON <tabela> [WHEN ...] ${raiseAbort('wstrzyknięty błąd D1')}\`)` na schemacie z migracji; trigger schodzi w `resetDb`. Awarii R2 nie symulujemy (§ „Czego NIE robimy” planu Fazy 1).
  - Izolacja jest per PLIK testowy, nie per test: każdy plik integracyjny ma `afterEach(() => resetDb(env))` (czyści `flashcards` → `situations` → `users`, zdejmuje triggery, opróżnia bucket), a użytkownika zasiewa `seedUser(env)` per test z unikalnym e-mailem. Trigger z `WHEN (SELECT COUNT(*) ...)` liczy wiersze całego pliku — działa tylko dzięki temu sprzątaniu.
  - Zadanie tła: `postSituation` zwraca `{ res, ctx }`; asercje na stanie D1/R2 są poprawne dopiero po `await waitOnExecutionContext(ctx)`. Gdy kontrakt brzmi „brak odrzuconej obietnicy w tle”, koduj to jawnie: `await expect(waitOnExecutionContext(ctx)).resolves.toBeUndefined()`. Mocki muszą odpowiadać natychmiast — po 30 s `waitOnExecutionContext` porzuca obietnice z ostrzeżeniem.
  - Luka względem PRD (zachowanie wymagane, kodu brak, poprawka poza zmianą): `it.fails` z komentarzem wskazującym plik w `follow-ups/` — nigdy `it.skip` ani usunięcie testu. Gdy follow-up wejdzie, `it.fails` zgłosi błąd i wymusi zmianę na `it`.
  - Każdy test ma nazwany deliberate-break (zmiana w kodzie, która MUSI go zaczerwienić); wykonaj go przed zamknięciem fazy i przywróć kod. Test, który oczekuje `failed`, jest ślepy na dryf schematu — sukces ścieżki szczęśliwej musi mieć własny test (zob. §6.7, deliberate-break 0004).
- **Uwaga**: nie używaj `exports.default.fetch` (dawne `SELF.fetch`) do asercji na zadaniu tła — ta ścieżka nie czeka na `waitUntil`. W pluginie v1 nie ma `isolatedStorage` ani `fetchMock` z dawnego `vitest-pool-workers`. `vi.spyOn(globalThis, 'fetch')` z `test/setup.ts` jest reużywany, więc `mockOpenAI` (i `vi.spyOn(...).mockResolvedValue` w testach `lib/`) nadpisuje guard bez konfliktu. Komunikat `Using secrets defined in .dev.vars` na starcie każdego pliku jest oczekiwany i nieszkodliwy — sekrety z `vitest.config.mts` mają pierwszeństwo, a suite daje identyczny wynik bez tego pliku.

### 6.3 Adding a test for a new API endpoint (własność, izolacja, 401/404)

- **Location**: dwa miejsca na trasę. (1) **Brama 401** — jedna macierz dla całej aplikacji w `api/src/middleware/auth.integration.test.ts` (tabela `PROTECTED_ROUTES` + strażnik kompletności T3.3). (2) **Własność i kształt DTO** — `api/src/routes/<route>.integration.test.ts` obok trasy, w `describe('Ryzyko #3: cudze dane (IDOR)')`. Helpery w `api/test/`: `request.ts` (`call(env, { method?, path, token?, headers?, body? })` — JEDYNE miejsce budujące `Request`; pominięty `token` = żądanie bez nagłówka `Authorization`; `audioForm`; helpery tras `postSituation`, `getSituations`, `deleteSituation`, `getProposals`, `acceptFlashcard`, `deleteFlashcard`, `getMe`), `db.ts` (`seedUser`, `seedSituation`, `seedFlashcard`, `readSituation`, `readSituationsOf`, `readFlashcard`, `readFlashcards`, `withWriteTripwire`, `resetDb`), `dto.ts` (typy-lustra `SituationDTO`/`FlashcardDTO`/`AuthUserDTO`, listy `SITUATION_DTO_KEYS`/`FLASHCARD_DTO_KEYS`/`AUTH_USER_DTO_KEYS`, `keysOf`).
- **Naming**: `describe('Ryzyko #3: cudze dane (IDOR)')` w pliku trasy; macierz: `describe('Ryzyko #3: cudze dane (IDOR) — brama 401')`. Tytuł `T3.<n>` + skutek w kategoriach użytkownika, z OBOMA ramionami w tytule („cudzy id → 404 i fiszka ofiary nadal `proposed`; własny → 200 z pustym ciałem…”). W macierzy tytuł to `T3.1 $name …` / `T3.2 $name …`, gdzie `name` = `METHOD /ścieżka/:param` dokładnie tak, jak Hono raportuje w `app.routes` (np. `POST /flashcards/:id/accept`). Deliberate-break nazwany w komentarzu nad testem — osobny dla każdej asercji, którą ma zaczerwienić („(a) usuń `.map(toDTO)` → klucze; (b) usuń `user_id = ? AND` → wiersz Boba”).
- **Reference test**: `auth.integration.test.ts` — T3.1/T3.2 (`expectGateHolds`) jako wzorzec „401 JSON `{ error }` + skutek: wiersze ofiary równe migawkom sprzed wywołania, `readSituationsOf` długości 1, bucket pusty, `fetch` niewywołany, `waitOnExecutionContext` bez odrzucenia; tripwire niejawny (zapis dałby 500 zamiast 401)”; T3.3 jako strażnik kompletności macierzy względem `app.routes`. `flashcards.integration.test.ts` — T3.7 jako wzorzec „cudze → 404 + ramię kontrolne własne → 200 + ponowna operacja → 404”; T3.6 jako wzorzec dokładnego zbioru kluczy z fiszką zasianą `isVariant: true` i asercją, że flaga NAPRAWDĘ siedzi w D1 (brak klucza to decyzja trasy, nie pusty zasiew). `situations.integration.test.ts` — T3.4 (lista tylko własna, każdy wiersz o kluczach DTO), T3.5 (kasowanie: cudze → 404 z nietkniętymi fiszkami ofiary; własne → 204). `auth.integration.test.ts` w `routes/` — T3.9 (`GET /auth/me`: koperta `['user']` + `AUTH_USER_DTO_KEYS`).
- **Run locally**: `cd api && npx vitest run -t "Ryzyko #3"` (macierz + własność, T3.1–T3.9). Sama macierz: `cd api && npx vitest run src/middleware/auth.integration.test.ts`. Cały suite: `cd api && npm test`.
- **Przepis dla nowej trasy chronionej** (np. `GET /flashcards/accepted` w S-05) — cztery kroki, żaden opcjonalny:
  1. `api/test/request.ts`: helper trasy (`getAccepted(env, token)` przez prywatny `getJson`; mutacja z `:id` — jak `acceptFlashcard`). W teście nigdy `new Request`.
  2. `api/src/middleware/auth.integration.test.ts`: wiersz `{ name: 'GET /flashcards/accepted', method: 'GET', path: () => '/flashcards/accepted' }` w `PROTECTED_ROUTES` (trasa z `:id` bierze id z `VictimIds`; trasa czytająca ciało dostaje `body: () => …` z realnym ciałem). T3.1/T3.2 dostają po jednym nowym przypadku; T3.3 jest czerwony, DOPÓKI wiersza nie ma — nowa trasa nie przechodzi niezauważona.
  3. `api/test/dto.ts`: jeśli odpowiedź ma nowy kształt — typ-lustro + literał `Record<keyof <DTO>, true>` + posortowana lista; ten sam typ w `src/lib/api.ts` (osobne `tsconfig`, rozjazdu nie wykrywa typecheck — zmieniaj oba naraz). Kształt istniejący (`FlashcardDTO`) — reużyj listę.
  4. `api/src/routes/flashcards.integration.test.ts`, w `describe('Ryzyko #3 …')`: `T3.10 GET /flashcards/accepted → tylko własne zaakceptowane o kluczach DTO` — `alice` i `bob` po jednej fiszce `status: 'accepted'` (`seedFlashcard`) plus jedna `proposed` Alice; odpowiedź Alice: `ids` równe `[aliceAcceptedId]`, `keysOf(card)` `toEqual(FLASHCARD_DTO_KEYS)`, `keysOf(body)` = dokładna koperta; deliberate-break w komentarzu: „usuń `user_id = ? AND` z zapytania → karta Boba na liście”. Mutacja dostaje dodatkowo ramię kontrolne „własny → 2xx i wiersz zmieniony” oraz migawkę wiersza ofiary przed/po.
- **Reguły**:
  - **Ramię kontrolne jest obowiązkowe**: każdy test własności ma ramię „cudze” (404 / brak na liście / wiersz ofiary równy migawce) ORAZ ramię „własne” (2xx / wiersz zmieniony / znika z listy). Bez ramienia kontrolnego trasa zwracająca 404 na wszystko byłaby zielona.
  - **404, nie 403** dla cudzego id (decyzja od S-01) — bez wyroczni istnienia: ten sam status i ciało `{ error }` dla cudzego, nieistniejącego i (w `accept`) już zaakceptowanego. Asertuj status + `content-type` JSON + `{ error: <niepusty string> }`, nie tekst komunikatu.
  - **DTO zawsze jako dokładny zbiór kluczy**: `expect(keysOf(x)).toEqual(<DTO>_KEYS)`, nigdy `not.toHaveProperty`. Trasa bez warstwy mapowania (dziś `GET /flashcards/proposals`) wycieka każdą kolumnę dopisaną do `SELECT`, a lista „czego nie ma” tego nie łapie. Kopertę odpowiedzi też asertuj (`['generatingCount', 'proposals']`, `['user']`).
  - **Skutek, nie implementacja**: żadnych asercji na tekście SQL („zapytanie zawiera `user_id`” nic nie dowodzi — `user_id` z tokenu to string bindowany przeciw kolumnie INTEGER i działa wyłącznie przez afiniczność SQLite, niewidoczną dla TypeScript) ani na wywołaniach bindingu D1/R2. Jedynym dowodem własności jest dwóch zasianych użytkowników na realnym D1 z migracji.
  - **Dwóch użytkowników per test jest tanie**: `seedUser(env, 'alice')`, `seedUser(env, 'bob')` (unikalny e-mail z `randomUUID`, token tym samym sekretem co Worker); `afterEach(() => resetDb(env))` sprząta obu. Nigdy nie hardkoduj id (`AUTOINCREMENT` nie resetuje sekwencji po `DELETE`). Gdy test ma wykryć brak `WHERE id = ?`, drugi użytkownik musi poprzedzać ofiarę w OBU porządkach skanu — rowid i alfabetycznym (indeks UNIQUE na `email` pokrywa `SELECT id, email`) — stąd `aaron`, nie `bob` w T3.9.
  - **Kolejność w macierzy**: zasiew ofiary i jej danych → migawki (`readSituation`/`readFlashcard`) → `withWriteTripwire(env)` → `mockOpenAI()` bez wpisów → wywołanie. Tripwire założony PRZED zasiewem zablokowałby sam zasiew; nazwy jego triggerów są stałe, więc jeden test uzbraja go raz, `resetDb` zdejmuje.
  - **Dwa warianty tokenu i ani jednego więcej**: brak nagłówka oraz token podpisany innym sekretem z TYM SAMYM `sub` ofiary (`signSession(victim.id, 'not-the-secret')`). Kryptografię tokenu (śmieci, manipulacja, `alg`) pokrywa `api/src/lib/jwt.test.ts`; §7 zakazuje rozszerzania prymitywów auth na trasach. Bramę 401 dowodzi WYŁĄCZNIE macierz — nie duplikuj „bez tokenu → 401” w pliku trasy.
  - **Realne ciało w macierzy**: trasa czytająca ciało (multipart) dostaje w macierzy to samo ciało co szczęśliwa ścieżka (`audioForm()`), żeby brama stała przed parsowaniem i przed `R2.put` (deliberate-break DB-B: middleware poniżej trasy → obiekt w buckecie, `INSERT` na tripwire → 500).
  - **Rejestruj trasy jawną metodą** (`get`/`post`/`delete`), nie `app.all()` — wpisy `ALL` wyglądają dla T3.3 jak middleware i byłyby niewidoczne.
- **Uwaga**: czerwony test własności PRZED deliberate-break to nieznana luka w kodzie, nie „drobna poprawka” — zatrzymaj się i wróć do `/10x-plan`. Token usuniętego użytkownika (przechodzi middleware; 500 na `POST /situations`, 200 pusto na listach), text/plain 404 Hono z tokenem na niedopasowanej ścieżce i brak `exp` w tokenach są celowo POZA tym wzorcem (zob. §6.7, Faza 2).

### 6.4 Adding a test for a day-boundary or time-dependent behavior

- **Location**: `describe('Ryzyko #6: dzień liczony w UTC')` w pliku trasy, która filtruje po dniu (dziś `api/src/routes/situations.integration.test.ts`; lista dnia `GET /situations` i licznik `generatingCount` z `GET /flashcards/proposals` w jednym opisie — jeden zasiany wiersz `status: 'done'`, `flashcardsStatus: 'pending'`, transkrypt niepusty jest JEDNOCZEŚNIE „na liście” i „generujący”, więc dowodzi obu powierzchni). Dźwignie: strona SQL — `seedSituation(env, userId, { createdAt })` / `seedFlashcard(env, { …, createdAt })` z `toSqlDatetime` w `api/test/db.ts` (`Date` albo gotowy string `YYYY-MM-DD HH:MM:SS` UTC; pominięty `createdAt` = DEFAULT kolumny); strona JS — `vi.setSystemTime(new Date(iso))` + `afterEach(() => vi.useRealTimers())` w tym samym `describe`.
- **Naming**: `T6.<n>`; tabela `DAY_CASES` jako stała pliku z kolumnami `label` (lokalny „dziś” + strona przejścia DST, np. `2026-03-30 CEST (dzień po 03-29)`), `direction` (`A` inkluzja / `B` ekskluzja), `createdAt` (SQL UTC), `now` (ISO `Z`); nad każdym wierszem komentarz „czas lokalny → czas lokalny (offset)”. Tytuł `T6.1 $label: …` opisuje regułę w kategoriach użytkownika („nagranie po lokalnej północy, przed północą UTC, jest na liście «dziś» i liczy się jako generujące”), nigdy offset ani strefę w asercji.
- **Reference test**: T6.1 — `it.fails.each` na wierszach inkluzji tabeli wyroczni (czerwone z definicji do follow-upu `context/changes/testing-route-contracts-ownership-day/follow-ups/local-day-boundary.md`); T6.2 — `it.each` wiersz-strażnik z nazwanym deliberate-break (filtr dnia usunięty z OBU zapytań → 4 czerwone); T1.3/T1.4 (ten sam plik) — wiek względem realnego zegara (`createdAt: new Date(Date.now() - N * 1000)`); test właściwości „zasiew z jawnym czasem zapisuje 1:1” w `api/test/harness.test.ts` — dowód, że dźwignia SQL działa (bez niego `it.fails` byłby ślepy na zepsuty zasiew).
- **Run locally**: `cd api && npx vitest run -t "Ryzyko #6"` (oczekiwane dziś: 4 expected-fail + 4 zielone). Strażnik przecieku zegara: `cd api && npx vitest run src/routes/situations.integration.test.ts` musi dać ten sam wynik co cały `npm test`.
- **Reguły**:
  - **Dwa zegary, nie jeden**: SQL `now` w D1 (`date('now')`, `datetime('now')`, DEFAULT kolumn `created_at`) to ZAWSZE realny UTC; `vi.setSystemTime` (z fake timers lub bez) steruje wyłącznie `Date` w JS izolatu (handler, `waitUntil`). Zachowanie liczone w SQL da się sterować TYLKO zasiewem jawnego `created_at`; zachowanie liczone w JS — `setSystemTime`. Test ustawia oba: zasiew (SQL) → `vi.setSystemTime(now)` tuż przed wywołaniem trasy (JS). Dziś dzień liczy wyłącznie SQL, więc `setSystemTime` nie ma wpływu — to przygotowanie pod poprawkę (Fix A/B przenoszą decyzję o dniu do JS i test zacznie przechodzić bez zmiany asercji).
  - **Strefa izolatu jest nieprzenośna i nie da się jej ustawić**: na Windows izolat raportuje strefę hosta (Warszawa) mimo `TZ=UTC` od miniflare; na Linux/CI i w prod — UTC; plugin 1.1.3 nie przekazuje `unsafeRuntimeEnv`. Kod i asercje wyłącznie w UTC (`toISOString()`) albo z jawnym `timeZone` w `Intl` (`'Europe/Warsaw'`); NIGDY `getHours()`, `getDate()`, `toLocale*` bez `timeZone`, `getTimezoneOffset()`. Test bez jawnej strefy przeszedłby lokalnie i padł w CI (albo odwrotnie).
  - **Wyrocznia z PRD jako jawna tabela „czas lokalny ↔ chwila UTC”** (chwile policzone przez ICU: `Intl.DateTimeFormat` z `timeZone: 'Europe/Warsaw'`, Node 24), po obu stronach OBU przejść DST; asercje wyłącznie na odpowiedzi tras (na liście / poza listą, licznik 1 / 0), nigdy na offsecie ani na obecnym wyniku UTC („asercja obecnego UTC” to anty-wzorzec z §2 — utrwala błąd zamiast go nazwać).
  - **Daty tabeli w przeszłości względem realnego zegara**: data, którą realny `date('now')` dopiero osiągnie, zrówna się z zasiewem w konkretny dzień roku i przekręci wynik (stąd jesienna strona tabeli to przejście 2025-10-26, nie 2026-10-25; reguły strefy są te same). Nigdy `datetime('now', '-N seconds')` w testach dnia — okno północy UTC (T1.3 przez ~2,5 min po północy wypada z listy dnia).
  - **`it.fails` tylko dla wiersza, który dziś PADA** — `it.fails` zgłasza „expected test to fail”, gdy test przechodzi. Pod realnym `date('now')` zasiany wiersz nigdy nie jest „dziś”: asercje inkluzji padają (→ `it.fails.each`), asercje ekskluzji przechodzą trywialnie przez odległą datę, nie przez regułę (→ zwykły `it.each` z nazwanym deliberate-break; pełny sygnał dopiero po poprawce). Wiersz `it.fails`, który zaczyna przechodzić BEZ poprawki, oznacza zepsuty zasiew lub odczyt (sprawdź test właściwości zasiewu), nie powód do zmiany modyfikatora; po poprawce zmień na `it` bez przepisywania asercji. `it.fails.each` działa w Vitest 4.1.
  - **Sprzątanie zegara**: `vi.setSystemTime` przecieka między testami w pliku, a `vi.restoreAllMocks()` z `api/test/setup.ts` go NIE cofa — cofa tylko `vi.useRealTimers()`. Każdy `describe` używający `setSystemTime` ma własne `afterEach(() => vi.useRealTimers())`. Między plikami nie przecieka.
  - **Kształt żądania tylko w `request.ts`**: jeśli poprawka wprowadzi parametr od klienta (Fix A: granice dnia lokalnego), liczy go JEDEN helper z `Date.now()` i jawnego `timeZone`; asercje testów dnia nie zmieniają się.
  - **Sprzężenie z regułą wieku `pending`** (follow-up Fazy 1, próg 2 min; oba filtry — wiek i dzień — siedzą w tych samych dwóch zapytaniach): wiersze, które mają „liczyć się”, siej w wieku poniżej progu (T6.1: 60 s między `createdAt` a `now`), żeby wynik nie zależał od kolejności realizacji obu poprawek. Test, który po zmianie z `it.fails` na `it` sieje wiersz „sprzed N s”, musi zostać w obrębie dnia.
- **Uwaga**: `vi.useFakeTimers()` nie jest potrzebne — w `api/src` nie ma `setTimeout`/`AbortSignal.timeout`, samo `vi.setSystemTime` wystarcza i nie zamraża pętli zdarzeń. Tokeny sesji nie mają `iat`/`exp`, więc przesunięcie zegara ich nie unieważnia. Jedyny test czasu w repo, który NIE jest testem dnia (wiek `pending`, T1.3/T1.4), sieje względem realnego `Date.now()` i celowo nie używa `setSystemTime`.

### 6.5 Adding a generator contract test (odpowiedź LLM → dane)

- TBD — see §3 Phase 3 dla wzorca „zdegenerowana odpowiedź modelu → odrzucenie lub deterministyczne przycięcie; schemat niesie pola wymagane”.

### 6.6 Adding an e2e test

- Not in this rollout. Ręczny smoke na urządzeniu według sekcji Manual w
  `context/archive/<slice>/plan.md`. Promocja do Maestro wymaga `--refresh` (zob. §8).

### 6.7 Per-rollout-phase notes

(Optional. After each phase lands, /10x-implement appends a 2-3 line note
here capturing anything surprising the rollout phase taught.)

**Faza 1 — Harness Workerów + zadania w tle** (zamknięta 2026-09-03; `context/changes/testing-worker-harness-background-jobs/`):

- **Runner**: `@cloudflare/vitest-plugin` v1 wymaga Vitest ^4.1, więc Vitest 3.2 → 4.1 (jedyna ścieżka na Vitest 3 to nieutrzymywany `vitest-pool-workers@0.12`). Plugin jest ESM-only, stąd `api/vitest.config.ts` → `api/vitest.config.mts`. Wszystkie 20 testów `lib/` przeszło w workerd bez zmian w kodzie testów; drugi projekt `node` okazał się zbędny.
- **Pułapka `.dev.vars`**: przy `wrangler.configPath` plugin sam wczytuje `api/.dev.vars` z prawdziwym kluczem OpenAI (log „Using secrets defined in .dev.vars” przy każdym pliku testowym). `miniflare.bindings` ma pierwszeństwo, więc sekrety testowe nadpisują plik; suite bez `.dev.vars` daje identyczny wynik. Guard „niezamockowany `fetch` rzuca” został w `test/setup.ts` (Vitest reużywa jednego spy'a, `mockOpenAI` go nadpisuje) — wariant z guardem w helperze nie był potrzebny.
- **Spike potwierdził oba założenia**: trigger `RAISE(ABORT)` przerywa `INSERT`/`UPDATE` w miniflare D1 (parser wymaga `BEGIN`/`END` wielkimi literami, workers-sdk #10998); `waitOnExecutionContext` obejmuje `c.executionCtx.waitUntil` z Hono i odrzucona obietnica obala test. Po poprawkach Fazy 3 aplikacja z założenia nie zostawia już odrzuconej obietnicy, więc tę właściwość dowodzi trasa-sonda Hono w `harness.test.ts`, nie trasa produkcyjna.
- **Deliberate-break 0004** (migracja `is_variant` przeniesiona poza `api/migrations/`, `npm test` → exit 1): 3 czerwone z 32 — spike „szczęśliwa ścieżka” (`flashcards_status` `failed` zamiast `done`), spike „trigger RAISE(ABORT)” (`D1_ERROR: table flashcards has no column named is_variant: SQLITE_ERROR` zamiast wstrzykniętego komunikatu) i T2.5 (0 kart zamiast 10); log Workera: „Generowanie fiszek dla sytuacji N nie powiodło się: … no column named is_variant”. Lekcja: T2.1–T2.4 (oczekujące `failed` / zera kart) zostały ZIELONE — dryf schematu wygląda dla nich jak każdy inny błąd generowania. Dowód ryzyka #4 niosą testy szczęśliwej ścieżki; każda nowa kolumna używana przez kod potrzebuje testu, który oczekuje sukcesu.
- **Poprawki z archiwum weszły razem z testami** (test czerwony → poprawka → zielony → deliberate-break): JSON 500 + sprzątanie R2 w `POST /situations` (S-01 F2), karty + `flashcards_status='done'` w jednym `DB.batch` (follow-up S-03), rozdzielony `try` w finalizacji tak, że nic po `done` nie nadpisuje stanu (S-03 F1). Otwarty follow-up: serwerowa reguła wieku `pending` (próg 2 min; T1.3 jako `it.fails`, `follow-ups/stale-pending-server-rule.md`).

**Faza 2 — Kontrakty tras: własność, izolacja, dzień** (zamknięta 2026-09-04; `context/changes/testing-route-contracts-ownership-day/`):

- **Chronionych tras jest 7, nie 8** (brief i badanie liczyły o jeden za dużo: 10 tras − 3 publiczne). T3.3 porównuje macierz 401 z `app.routes` i pilnuje liczby — nowa trasa S-04/S-05 bez wiersza w `PROTECTED_ROUTES` obala suite. `app.routes` po `app.route()` niesie pełne ścieżki; wpisy middleware (`use('*')` → `method: 'ALL'`, `requireAuth` per handler na `/auth/me`) trzeba odfiltrować, a trasa z `app.all()` byłaby dla strażnika niewidoczna.
- **`it.fails` przyjmuje tylko wiersze, które dziś padają.** Pod realnym `date('now')` są to wyłącznie asercje inkluzji („powinno być na liście”), stąd 4 × `it.fails.each` + 4 × `it.each` (nie 8 × `it.fails`) i jesienne przejście 2025-10-26 zamiast 2026-10-25 — data w przyszłości zrównałaby się z realnym dniem dwa razy w roku i przekręciła test. `vi.setSystemTime` nie rusza zegara SQLite (zweryfikowane: pod zegarem 2031 SQL oddał realny 2026-09-04); jedyna dźwignia SQL to jawny `created_at`. `it.fails.each` działa w Vitest 4.1.11.
- **Tripwire `RAISE(ABORT)` na każdym zapisie do `situations`/`flashcards`** (`withWriteTripwire`, sześć triggerów o stałych nazwach) jako obserwowalny dowód „bez zapisu”: trasa, która mimo braku tokenu coś zapisze, odpowiada 500 zamiast 401 — bez mockowania bindingu. Zakładać PO zasiewie ofiary (zasiew też jest zapisem); własny test właściwości w `harness.test.ts` dowodzi, że jest uzbrojony i że `resetDb` go zdejmuje.
- **Deliberate-breaks — wszystkie czerwone, kod przywrócony, zero zmian produkcyjnych** (każde oczekiwanie ryzyka #3 było spełnione przed testem): macierz DB-A…DB-D (middleware routera przeniesione poniżej pierwszej trasy → 500/200 zamiast 401 na jej wierszach; DB-B dodatkowo zostawia obiekt w buckecie, widoczny w asercji; `requireAuth` zdjęte z `/me` → 500; trasa-sonda `/probe` → T3.3); własność 9/9 (T3.4–T3.9: usunięcie `.map(toDTO)` lub `user_id = ?` z list, licznika i mutacji, `SELECT *` w `/me`, `is_variant` dopisane do `SELECT` propozycji — każda zmiana czerwieni dokładnie swój test); dzień: filtr `date(created_at) = date('now')` usunięty z obu zapytań → 4 wiersze T6.2. Pułapka po drodze: bez `WHERE id = ?` w `/me` SQLite może skanować po indeksie UNIQUE na `email` (pokrywa `SELECT id, email`), więc drugi użytkownik musi poprzedzać ofiarę w OBU porządkach — `aaron`, nie `bob`; z „bob” deliberate-break byłby niewidoczny. Smoke dwóch kont przez `wrangler dev` (3030): cudzy `DELETE` → 404, ofiara nadal widzi swoją sytuację.
- **Zaparkowane obserwacje** (poza top-6; kandydaci do `--refresh`, bez testów i follow-upów): token usuniętego użytkownika przechodzi middleware (brak lookupu w D1) → 500 na `POST /situations` (FK po `R2.put`, plik sprzątany), 200 pusto na listach, 404 na mutacjach; text/plain 404 Hono z tokenem na niedopasowanej ścieżce pod chronionym prefiksem (kontrakt błędów nie jest jednolicie JSON-owy); wydawane tokeny nie mają `exp` (FR-002: sesja permanentna). Otwarty follow-up: `follow-ups/local-day-boundary.md` (Fix A / Fix B bez wyboru; T6.1 jako `it.fails` do decyzji S-01 F1 / S-02 F4). Suite po Fazie 2: 9 plików, 63 testy (58 zielonych + 5 `it.fails`: T1.3 + 4 × T6.1), ~4 s.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Jakość treści z LLM** (naturalność angielskiego, trafność doboru typu, czy wariant trzyma kontekst) — to ocena ręczna i metryka akceptacji ≥70% z PRD, nie test automatyczny. Testujemy wyłącznie kontrakt strukturalny (Risk #5). Re-evaluate if wskaźnik akceptacji spadnie poniżej 70% przez dwa tygodnie. (Source: Phase 2 interview Q5.)
- **Wygląd i snapshoty UI** (theming, kolory, ikony tabów, migawki komponentów, deterministyczny visual diff, przegląd multimodalny) — ciągle się psują i nic nie wykrywają. Re-evaluate if pojawi się system designu lub drugi front. (Source: Phase 2 interview Q5.)
- **Runner frontu (`jest-expo`)** — żadne ryzyko top-6 nie wymaga go jako najtańszej warstwy; drugi runner to koszt dla solo dewelopera przy blokerze `capacity`. Re-evaluate at `--refresh` when S-05 wprowadzi logikę odstępów powtórek po stronie klienta lub gdy root layout / bramka auth zmieni się ponownie. (Source: Phase 3 brief, cost × signal.)
- **Automatyczne e2e mobilne** (Maestro/Detox) — ręczna checklista na urządzeniu pokrywa ścieżkę krytyczną przy skali MVP. Re-evaluate if pojawi się więcej niż jeden tester lub CI. (Source: Phase 3 brief, cost × signal.)
- **Prymitywy auth** (hash hasła, podpis/weryfikacja JWT) — już pokryte w `api/src/lib/`; nie rozszerzać. (Source: profil bazy testowej, Phase 1.)
- **Format audio z urządzenia** — awaria żyje w presecie nagrywania (lessons.md); test serwerowy byłby lustrem. Ręczny smoke na urządzeniu przy każdej zmianie zależności audio lub SDK. (Source: challenger pass, Phase 3.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-03
- Stack versions last verified: 2026-09-03
- AI-native tool references last verified: 2026-09-03

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (w szczególności: S-05 wnosi
  logikę odstępów po stronie klienta; aplikacja otwiera się na szerszą bazę
  użytkowników → nadużycie zasobów / koszt LLM),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner, CI wired),
- §7 negative-space no longer matches what the team believes.

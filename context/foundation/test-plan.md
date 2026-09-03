# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-03

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
| 2 | Kontrakty tras: własność, izolacja, dzień | Udowodnić, że użytkownik widzi i zmienia tylko swoje dane i właściwy dzień lokalny | #3, #6 | integration na poziomie tras (dwóch użytkowników, kontrolowany czas) | not started | — |
| 3 | Kontrakt generatora LLM | Udowodnić, że zdegenerowana odpowiedź modelu nie przecieka do bazy ani UI | #5 | unit/contract (mock fetch) | not started | — |
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

- TBD — see §3 Phase 2 dla wzorca „dwóch użytkowników, cudzy id → 404, lista bez cudzych wierszy, DTO bez wycieku”.

### 6.4 Adding a test for a day-boundary or time-dependent behavior

- TBD — see §3 Phase 2 dla wzorca „kontrolowany zegar i strefa; oczekiwanie z PRD, nie z implementacji”.

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

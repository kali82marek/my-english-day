# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-09

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
| 1 | Harness Workerów + zadania w tle | Udowodnić, że zadanie tła zawsze kończy się widocznym stanem, bez utraty nagrania i bez połowicznych zapisów; harness workerd z izolowanym D1 i migracjami | #1, #2, #4 | integration (workerd, izolowane D1 z migracjami, mock OpenAI na krawędzi sieci) | complete | `context/archive/2026-09-03-testing-worker-harness-background-jobs/` |
| 2 | Kontrakty tras: własność, izolacja, dzień | Udowodnić, że użytkownik widzi i zmienia tylko swoje dane i właściwy dzień lokalny | #3, #6 | integration na poziomie tras (dwóch użytkowników, kontrolowany czas) | complete | `context/archive/2026-09-04-testing-route-contracts-ownership-day/` |
| 3 | Kontrakt generatora LLM | Udowodnić, że zdegenerowana odpowiedź modelu nie przecieka do bazy ani UI | #5 | unit/contract (mock fetch) | complete | `context/archive/2026-09-07-testing-llm-generator-contract/` |
| 4 | Bramki jakości | Zablokować podłogę: jedno lokalne polecenie (lint + typecheck + testy API) i checklista deployu; CI nazwane, konfiguracja w lekcji CI | cross-cutting | gates | complete | `context/archive/2026-09-09-testing-quality-gates/` |

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
| lint + typecheck (front: `expo lint`, `tsc --noEmit`; api: `npm run typecheck`) | local: `npm run gate` (kroki 1–4); CI planned | required — `npm run gate` (front: `expo lint --max-warnings 0`, `tsc --noEmit`; api: `npm run typecheck`) | dryf składni i typów, rozjazd typów DTO front ↔ api |
| unit + integration (api) | local; CI planned; w `npm run gate` (krok 5) | required (od Fazy 1; lokalnie `cd api && npm test`) | regresje zadań tła, przejść stanu, migracji, własności, dnia, kontraktu generatora |
| e2e on critical flows | ręczny smoke na urządzeniu (nagranie → `pending` → transkrypt → Fiszki → akceptuj), checklista z sekcji Manual zarchiwizowanych planów | required manually before deploy; not automated in this rollout (zob. §7) | format audio z urządzenia, uprawnienia mikrofonu, bramka auth po restarcie |
| pre-prod smoke: migracja przed deployem | `context/deployment/deploy-checklist.md` (kroki 2–6: `wrangler whoami` → `d1 migrations list --remote` → `d1 migrations apply --remote` → `wrangler deploy` → `/health`) | required (ręcznie, przed każdym deployem Workera) | Worker na starej bazie (Risk #4) |
| post-edit hook | local (agent loop) | recommended (konfiguracja hooków należy do Lekcji 3) | regresje testów api w czasie edycji |
| visual diff (deterministic) | — | excluded (§7, interview Q5) | — |
| multimodal visual review | — | excluded (§7, interview Q5) | — |

CI (GitHub Actions) jest zaparkowane w roadmapie i należy do lekcji CI; ten plan nazywa
bramki, które CI ma uruchamiać (dwa pierwsze wiersze). Faza 4 dostarczyła (2026-09-09)
jedno lokalne polecenie — `npm run gate` w katalogu głównym (zob. §6.8) — i CI ma wywołać
dokładnie to polecenie, bez zmian, po `npm ci` w katalogu głównym i w `api/`.

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

- **Location**: `api/src/routes/<route>.integration.test.ts` obok trasy pod testem. Helpery w `api/test/`: `db.ts` (`seedUser`, `readSituation`, `readFlashcards`, `withTrigger`, `raiseAbort`, `resetDb`), `openai-mock.ts` (`mockOpenAI`, `whisperResponse`, `whisperVerboseResponse` — segmenty `verbose_json` z `no_speech_prob` do testów ciszy, `chatResponse`), `request.ts` (`postSituation`, `getSituations`, `getProposals`). Setup wspólny dla każdego pliku: `api/test/setup.ts` (schemat z `api/migrations/` przez `applyD1Migrations` + guard „niezamockowany `fetch` rzuca”). Konfiguracja: `api/vitest.config.mts` (pool workerd z bindingami z `wrangler.toml`, sekrety testowe nadpisujące `.dev.vars`).
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

- **Location**: dwie warstwy, obie obowiązkowe. (1) **Żądanie i parser** — `api/src/lib/flashcards.test.ts`, `describe('Ryzyko #5: kontrakt generatora')`; mock `fetch` przez `vi.spyOn(globalThis, 'fetch').mockResolvedValue(<Response>)` (§6.1), żądanie czytane z `fetchSpy.mock.calls[0][1].body`; wywołanie zawsze przez publiczne `generateFlashcards(transcript, apiKey)` — parser i walidator są prywatne i tak mają zostać. (2) **Dowód „nie przecieka do bazy ani do propozycji”** — `describe('Ryzyko #5: kontrakt generatora')` w `api/src/routes/situations.integration.test.ts` (§6.2; `postAndFinish`, `readFlashcards`, `readSituation`, `readProposals`). Buildery odpowiedzi Chat Completions — WYŁĄCZNIE w `api/test/openai-mock.ts`: `chatResponse(cards, status?)` dla poprawnych list (`content = JSON.stringify({ flashcards })`), `chatResponseRaw({ content, refusal?, finish_reason? }, status?)` dla odpowiedzi zdegenerowanych (odmowa, ucięcie, nie-JSON, `content: null`). Oba wpisują `refusal: null` i `finish_reason: 'stop'` domyślnie — jak żywa odpowiedź.
- **Naming**: `T5.<n>` + skutek: warstwa parsera „→ cała odpowiedź odrzucona” / „→ dokładnie pierwsze 10 z tablicy”; warstwa integracyjna „→ `failed`, zero kart, propozycje puste”. `it.each` z `$label` dla wariantów TEJ SAMEJ klasy (flaga `is_variant`, pole tekstowe, kształt `content`, kształt `flashcards`); wyrocznie jako stałe pliku testowego z cytatem źródła (`CARD_TYPES`, `REQUIRED_CARD_FIELDS`, `MAX_CARDS_ORACLE`). Deliberate-break w komentarzu nad testem, osobny dla każdej asercji, którą ma zaczerwienić.
- **Reference test**: T5.1 (kontrakt żądania: `required` i `enum` porównywane jako posortowane zbiory, typy pól, `messages[0].role === 'system'`, `messages.at(-1)` = transkrypt — nigdy snapshot schematu ani tekst promptu); T5.2 (`it.each` limit 10 hardkodowany z cytatem przeglądu S-03 F2, wynik = pierwsze N w kolejności tablicy); T5.3 (odsiew pustych `front_en`/`back_pl` przed liczeniem limitu, pusty `example_en` zostaje); T5.5/T5.7 (helper `expectContractRejection` — `toBeInstanceOf(Error)` + `not.toBeInstanceOf(SyntaxError)` + `not.toBeInstanceOf(TypeError)`); T5.9 (tekst odmowy z fixture'a w `err.message` — dowód, że `refusal` jest czytany, nie lustro komunikatu); T5.11 + T5.12 (para „→ `failed`” + ramię kontrolne: projekcja `{ front_en, type, is_variant }` z D1 równa fixture'owi i mapa `front_en → type` w DTO propozycji).
- **Run locally**: `cd api && npx vitest run -t "Ryzyko #5"` (23 przypadki: 20 jednostkowych + 3 integracyjne). Sam parser: `cd api && npx vitest run src/lib/flashcards.test.ts`. Cały suite: `cd api && npm test`.
- **Przepis dla nowego pola karty** (np. `difficulty` z S-05) — obie strony naraz, bo schemat żądania i walidator odpowiedzi to jeden kontrakt:
  1. `api/src/lib/flashcards.ts`: pole w `RESPONSE_FORMAT` (`properties` + `required`) ORAZ w `assertGeneratedCard` (typ sprawdzany jawnie; enum — stała `as const` obok `CARD_TYPES`, użyta w obu miejscach); pole w `GeneratedCard`. Bind w `generateAndStoreFlashcards` (`situations.ts`) + migracja addytywna (`ALTER TABLE … ADD COLUMN … DEFAULT`), jeśli pole idzie do D1.
  2. `api/src/lib/flashcards.test.ts`: wyrocznia z PRD/planu slice'a, nie z kodu — nazwa pola w `REQUIRED_CARD_FIELDS` (T5.1 czerwony, dopóki `required` nie zawiera pola), dozwolone wartości jako stała z cytatem; wiersz w T5.7 („brak pola → cała odpowiedź odrzucona”, plus wartość złego typu) i — gdy pole jest enumem — osobny test wartości spoza enumu w środku poprawnych (jak T5.5). `cards(n)` w teście jednostkowym i `makeCards(n)` w integracyjnym dostają pole, inaczej wszystkie testy szczęśliwej ścieżki padną na walidatorze.
  3. `api/src/routes/situations.integration.test.ts`: pole w jawnym fixture T5.12 i w projekcji (wartość zapisana 1:1, INTEGER dla booleanów); jeśli DTO propozycji ma je nieść — w mapie DTO oraz w `test/dto.ts` według §6.3 (krok 3). Bez ramienia kontrolnego walidator odrzucający wszystko byłby zielony.
  4. Deliberate-break przed zamknięciem: usuń nowe sprawdzenie z `assertGeneratedCard` → wiersz T5.7 (i test enumu) czerwony; usuń pole z `required` → T5.1 czerwony; kod przywrócony.
- **Reguły**:
  - **Wyrocznia z produktu, nigdy z implementacji**: `MAX_CARDS`, `RESPONSE_FORMAT`, `CARD_TYPES`, `GeneratedCard` NIE są importowane do testów; stałe testu mają cytat (PRD `prd.md:99` — trzy typy, FR-006 — AI dobiera podzbiór; plan S-02 — cztery pola tekstowe; plan S-03 — `is_variant` boolean per karta; przegląd S-03 F2 — limit 10, o którym PRD milczy). Zmiana limitu w kodzie MA zaczerwienić T5.2 — to sygnał do świadomej zmiany obu stron, nie do „naprawy” testu.
  - **Żądanie asertowane jako role i zbiory**: `messages` jako role i kształt (system pierwszy, transkrypt ostatni; bez asercji na liczbie wiadomości — miejsce na few-shot), schemat jako posortowane zbiory `required`/`enum` + typy pól + `additionalProperties: false` + `strict: true`; nigdy snapshot obiektu schematu (wyrocznia z implementacji) ani tekst promptu (blokowałby iterację promptu — §2 ryzyko #5 „Unikać”).
  - **Dwie klasy odpowiedzi, dwa skutki, osobne testy**: naruszenie kontraktu strukturalnego (`type` spoza trójki, `is_variant` nie-boolean lub brak, brak/`null`/nie-string pola tekstowego, nie-JSON, `refusal`, `flashcards` nie-tablica) = CAŁA odpowiedź odrzucona → `failed`, nigdy „wadliwa karta odsiana”; pusta treść (`front_en`/`back_pl` z samych białych znaków) = odsiew PRZED liczeniem limitu, pusty `example_en` legalny (prompt dopuszcza go dla `sentence`). Nie mieszać obu klas w jednym `it.each`; wadliwą kartę stawiać w ŚRODKU poprawnych (dowód atomowości).
  - **„→ rzut” asertowany klasą błędu, nie tekstem**: `expectContractRejection` odrzuca `SyntaxError`/`TypeError` — test ślepy na klasę byłby zielony także dla „naprawy” `TypeError` przez `?.`, która przepuści kartę bez pola do INSERT (`red-run-phase3.md` w folderze zmiany: 5 × `TypeError`, 2 × `SyntaxError` przed walidatorem). Jedyny dopuszczalny tekst w asercji to ten z fixture'a (`refusal`); nigdy `rejects.toThrow(<polski komunikat>)`.
  - **Każdy test „→ `failed`” ma partnera z wartościami zapisanych kolumn** (T5.12: projekcja `{ front_en, type, is_variant }` równa fixture'owi z `is_variant` jako 0/1 w kolejności tablicy — `readFlashcards` sortuje po `id`, `DB.batch` wstawia po kolei) — walidator odrzucający wszystko przechodzi każdy test odrzucenia (reguła §6.2, deliberate-break 0004).
  - **Guard „pusta lista → rzut” zostaje w generatorze** (T5.4, T2.4): od S-04 „zero kart po deduplikacji” JEST odrębnym, legalnym wynikiem warstwy zapisu (`api/src/lib/dedup.ts`, testy D1.x w `dedup.test.ts` i D2.1–D2.4 w `situations.integration.test.ts`; same duplikaty → `done` bez kart, D2.4) — przeniesienie guarda zaczerwieni T5.4 i to jest sygnał do rozmowy, nie do usunięcia testu.
  - **Test jednostkowy widzi tylko parser**: „nie przecieka do bazy” wymaga pary z §6.2 (T5.11), która widzi poprawkę niezależnie od tego, czy żyje w parserze, czy (w przyszłości) w `CHECK` D1. Jakość treści (angielskość, trafność typu, kontekst wariantu) jest poza zakresem (§7) — bez sędziego LLM; walidator ręczny obok wzorca `lib/validation.ts`, bez `zod`.
- **Uwaga**: żywa odpowiedź Chat Completions niesie `refusal: null` w KAŻDEJ wiadomości, `finish_reason: 'stop'` oraz pola, których parser nie czyta (`annotations: []`, `logprobs: null`) — walidator sprawdza `typeof refusal === 'string' && refusal !== ''`, nigdy obecność pola, i ignoruje pola dodatkowe (smoke: `smoke-phase4.md` w folderze zmiany). `CHECK` na enumach w D1 NIE jest addytywne w SQLite — to przebudowa tabeli (`follow-ups/enum-check-migration.md`, S-02 F2 bez wyboru). Fallback etykiety typu na froncie (`TYPE_LABELS[card.type]`) i `example_en.trim()` są poza wzorcem (brak runnera frontu, §7) — dowodzone pośrednio przez `proposals: []` po zdegenerowanej odpowiedzi i `type` z trójki w DTO.

**Testy slice'ów poza mapą ryzyk §2** (od S-04): `describe('S-NN / FR-NNN: …')` z tytułami `D<faza>.<n>` (S-04) / `R<faza>.<n>` (S-05) — te same reguły co §6.1/§6.2 (wyrocznia z PRD, deliberate-break, helpery, DTO jako `keysOf`), inna etykieta, bo ryzyko nie ma numeru w §2.

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

**Faza 3 — Kontrakt generatora LLM** (zamknięta 2026-09-07; `context/changes/testing-llm-generator-contract/`):

- **Przeciek był realny, nie hipotetyczny**: przed walidatorem karta `type: 'idiom'` szła z modelu prosto do `INSERT` (front pokazałby pustą plakietkę), brak `is_variant` stawał się cicho `0` (a `'true'`/`1` — wariantem), brak `example_en` zapisywał `NULL` (front pada na `.trim()`). Z 20 testów T5.x **14 było czerwonych przed poprawką** (`red-run-phase3.md`): 6 przez `resolves` (T5.5 `'idiom'`; T5.6 × 3 flaga; T5.7 brak/`null` `example_en`), 5 przez `TypeError` (T5.7 brak `front_en`/`back_pl`, `front_en: 42`; T5.10 × 2 `flashcards` nie-tablica), 2 przez `SyntaxError` (T5.8 zwykły tekst, ucięty JSON z `finish_reason: 'length'`), 1 przez mylący komunikat „bez treści” bez tekstu odmowy (T5.9). Żaden nie był zielony przed poprawką — badanie §2 trafiło w każdą ścieżkę; T5.1–T5.4 (żądanie, limit, odsiew, pusto) były zielone od razu.
- **Walidator w parserze jako druga linia po Structured Outputs** (`parseGeneratedCards` + `assertGeneratedCard` w `api/src/lib/flashcards.ts`; kolejność: `refusal` → `content` → `JSON.parse` w `try/catch` → `Array.isArray` → każda karta → odsiew pustych → limit → pusto = rzut). Decyzja: naruszenie schematu = złamany kontrakt, CAŁA odpowiedź odrzucona (nigdy odsiew wadliwej karty); komentarz „parsujemy bez kodu obronnego” usunięty — założenie „`strict:true` = bez kodu obronnego” (plany S-02/S-03) obalone po raz drugi (pierwszy: S-03 F2 → `MAX_CARDS`). Bez `zod`, bez zmian w `situations.ts` (koercja `? 1 : 0` po walidacji jest tożsamością); harness: `chatResponseRaw` w `openai-mock.ts` jako jedyne źródło kształtu Chat Completions (kopia z testu jednostkowego usunięta).
- **Asercja klasy błędu jako sygnał „zamierzone vs przypadkowe”**: `expectContractRejection` (`Error`, nie `SyntaxError`/`TypeError`) odróżnia rzut domenowy od wyjątku z gołego `JSON.parse`/`.trim()`; bez niej „naprawa” `TypeError` przez `?.` przepuściłaby kartę bez pola do INSERT, a test byłby zielony. `instanceof` działa, bo test i moduł biegną w tym samym izolacie workerd.
- **`CHECK` w SQLite = przebudowa tabeli**, nie addytywny `ALTER` (przegląd S-02 F2 zakładał „addytywne CHECK to standard w SQLite”, Confidence HIGH): `CREATE flashcards_new` → `INSERT … SELECT` → `DROP` → `RENAME` → indeksy. Follow-up bez wyboru: `follow-ups/enum-check-migration.md` (A: migracja 0005 z przebudową + `example_en NOT NULL DEFAULT ''`; B: accept-as-risk z walidatorem jako jedyną obroną; moment: S-04 albo `--refresh` przy drugiej ścieżce zapisu fiszek).
- **Deliberate-breaks — wszystkie czerwone, kod przywrócony**: żądanie (usunięty `enum`, `example_en` poza `required`, `additionalProperties: true`, zamiana kolejności `messages`) → T5.1; `MAX_CARDS = 12` / bez `slice` → T5.2; zamiana filtr/`slice` / bez filtra → T5.3; bez guarda pustej listy → T5.4 + T2.4; każde sprawdzenie walidatora zdjęte osobno → dokładnie swoje wiersze T5.5–T5.10; walidator bez `type` → T5.11 „idiom” (3 wiersze z `'idiom'`, `done`), a wiersz „odmowa” zostaje zielony — pada na `content: null`, jego deliberate-break żyje w T5.9; bind `'word'` / bind `0` w `situations.ts` → T5.12. **Smoke** z prawdziwym kluczem (gpt-4o, `wrangler dev` 3030, `scripts/sample.wav` — kawiarnia): 8 propozycji (5 `phrase`, 2 `word`, 1 `sentence`; 5 bazowych + 3 warianty na końcu tablicy; karta `sentence` z `example_en: ""`), `flashcards_status='done'`, `generatingCount: 0`; surowa odpowiedź: `refusal: null`, `finish_reason: 'stop'`, dodatkowo `annotations: []` i `logprobs: null` (ignorowane przez parser) — `smoke-phase4.md`.
- **Zaparkowane obserwacje** (kandydaci do `--refresh`, bez testów i follow-upów): przy >10 kart warianty (koniec tablicy) giną pierwsze — S-04 (dedup) powinien decydować o kolejności ucinania; (S-04 tego NIE podjął: dedup działa PO ucięciu do 10 w generatorze, duplikaty zajmują miejsca w limicie — nadal zaparkowane;) żądanie bez `max_tokens`, `temperature`, timeoutu i retry (jedyny realny scenariusz ucięcia to limit modelu, `finish_reason: 'length'`); białe znaki w zapisanych polach nienormalizowane (`trim` jest tylko predykatem odsiewu); front: `TYPE_LABELS[card.type]` bez fallbacku i `example_en.trim()` bez guarda (brak runnera frontu, §7). Suite po Fazie 3: 9 plików, 86 testów (81 zielonych + 5 `it.fails`), ~4 s.

**Faza 4 — Bramki jakości** (zamknięta 2026-09-09; `context/changes/testing-quality-gates/`):

- **Dwa założenia z `change.md` obalone przez badanie**: (a) `&&` w skryptach npm PROPAGUJE kod wyjścia na Windows — npm uruchamia skrypty w `cmd.exe` (`npm config get script-shell` = null), nie w PowerShell; zmierzone: `npm --prefix api run typecheck` z wstrzykniętym błędem typu → exit 2, po usunięciu → 0, `cmd1 && echo X` z `cmd1` = exit 1 nie drukuje X. Problem `&&` w PowerShell 5.1 dotyczy WYŁĄCZNIE łańcuchów wpisywanych ręcznie w konsoli (błąd parsera, nie „fałszywie zielone”). (b) `tsc` obala NIE brak `.expo/types/router.d.ts` (exit 0 — `Href` degraduje się do `string`, utrata cicha), lecz brak `expo-env.d.ts` (exit 2: `src/components/animated-icon.web.tsx:5` TS2307, `src/constants/theme.ts:6` TS2882).
- **`npx expo customize tsconfig.json`** = jedyna nieinteraktywna regeneracja typed routes i `expo-env.d.ts` w SDK 56 (`@expo/cli` `customize/typescript.js` → `startTypeScriptServices()` bez dev servera); 3 s, exit 0, `git status` czysty — pod warunkiem, że `tsconfig.json#include` ma już `.expo/types/**/*.ts` i `expo-env.d.ts`, a `.gitignore` ma `expo-env.d.ts` (w przeciwnym razie krok dopisuje je do tych śledzonych plików i brudzi drzewo — samonaprawa, ale w CI widoczna). `expo export` typów NIE generuje; `expo typegen` nie istnieje. Notatka S-05 „wymaga `expo start`” była prawdziwa, ale niepełna.
- **`expo lint` domyślnie nie przekazuje `--max-warnings`** (`@expo/cli` `lint/lintAsync.js:153-155`) → warningi nigdy wcześniej nie obalały lintu; bramka używa `--max-warnings 0` (baseline dziś: 0 warningów).
- **Deliberate-breaks — każda warstwa obala bramkę, kod przywrócony** (2026-09-09, commit bf8202e): lint (nieużywany import w `src/`) → exit 1 „too many warnings (maximum: 0)”, vitest nieosiągnięty; tsc front TS2322 → exit 2; tsc api TS2322 → exit 2; test z fałszywą asercją → exit 1 „1 failed | 103 passed”; świeży checkout (`expo-env.d.ts` + `.expo/types/` usunięte) → exit 0, oba pliki zregenerowane w kroku 1. Po przywróceniu każdej warstwy → exit 0. Cała bramka ≈ 20 s (3 + 4 + 3 + 2 + 7).
- **Checklista deployu wyjęta z archiwum**: jedyny zapis „migracja przed Workerem” żył w zarchiwizowanym follow-upie S-03 (`review-fixes.md`), a kanoniczny `deploy-plan.md` pomijał krok migracji — teraz `context/deployment/deploy-checklist.md` (bramka → `whoami` → `list --remote` → `apply --remote` → `deploy` → `/health` → smoke Manual → front). Migracja 0005 (`add_flashcard_review_state`) nadal czeka na produkcję (wiersz Manual: wykonać PRZED Workerem z S-05); następny numer migracji: 0006 (follow-up `enum-check-migration.md` mówi „0005” — slot zajęty).

### 6.8 Running the full gate before commit/deploy

- **Command**: `npm run gate` (katalog główny). Kroki w kolejności z `package.json`: (1) `expo customize tsconfig.json` → (2) `expo lint --max-warnings 0` → (3) `tsc --noEmit` → (4) `npm --prefix api run typecheck` → (5) `npm --prefix api test`. Czas ≈ 20 s (3 + 4 + 3 + 2 + 7). Exit ≠ 0 = stop: nic do commitu ani deployu. Pojedyncze warstwy: `npm run lint`, `npm run typecheck` (front), `cd api && npm run typecheck`, `cd api && npm test`.
- **Fresh checkout**: `npm install` w katalogu głównym ORAZ w `api/` (dwa pakiety, brak workspaces; `npm --prefix api run typecheck` bez `api/node_modules` pada z mylącym „tsc not found”). `expo-env.d.ts` i `.expo/types/` są gitignored — bramka regeneruje je w kroku 1 przez `expo customize tsconfig.json` (jedyna nieinteraktywna droga w SDK 56; `expo export` ich nie generuje). Nigdy nie uruchamiaj `expo start` tylko po to, żeby powstały. Krok 1 zakłada ukończone `npm ci`: gdy `typescript` lub `@types/react` nie rozwiązują się z `node_modules`, `expo customize` doinstalowuje je przez `expo install` bez pytania (sieć + mutacja `package.json`/lockfile), a błąd tego kroku jest połykany (exit 0) — w CI ustaw `EXPO_NO_TYPESCRIPT_SETUP=1` (pomija tylko bootstrap zależności, generacja typów zostaje) i `EXPO_NO_TELEMETRY=1`. Node ≥ 20.19 (Expo SDK 56); lokalnie 24.x.
- **Reading red**: lint → plik/reguła w wyjściu ESLint; warningi też obalają (`--max-warnings 0`, komunikat „too many warnings (maximum: 0)”). tsc front → `TS2307`/`TS2882` przy imporcie CSS/assetu = brak `expo-env.d.ts`: uruchom ponownie CAŁĄ bramkę, nie goły `tsc`. tsc api → jak dotąd (`cd api && npm run typecheck`). vitest → §6.2 (pojedyncze ryzyko: `cd api && npx vitest run -t "Ryzyko #N"`); vitest jest krokiem 5, więc czerwony lint/tsc oznacza, że testy w ogóle nie biegły.
- **Before deploy**: `context/deployment/deploy-checklist.md` — bramka jest krokiem 1; migracja D1 (`d1 migrations apply --remote`) PRZED `wrangler deploy`; `wrangler rollback` NIE cofa D1 (cofnięcie migracji = osobna migracja w przód).
- **Reguły**:
  - Żadnych kroków interaktywnych (`wrangler login`, prompty) ani zależnych od sekretów (`.dev.vars`) w bramce — harness API ma sekrety testowe w `api/vitest.config.mts`, a CI ma wywołać `npm run gate` bez zmian po `npm ci` w obu katalogach.
  - Bez wrapperów `.ps1`/`.sh` i bez `concurrently`: skrypty npm biegną w `cmd.exe`/`sh`, gdzie `&&` propaguje kod wyjścia (zmierzone na Windows, §6.7 Faza 4); wrapper PowerShell wymagałby `$LASTEXITCODE` po każdym natywnym poleceniu, równoległość nie jest warta zależności przy ~20 s.
  - Nowy krok bramki wymaga nowego wiersza deliberate-break w planie tej zmiany (dowód, że krok obala `npm run gate`, a nie tylko „przechodzi”).
  - CI wywołuje `npm run gate` bez zmian — nie duplikuj listy kroków w YAML.
- **Uwaga**: brak `.expo/types/router.d.ts` NIE obala `tsc` — `Href` degraduje się do `string | HrefObject`, więc błędna ścieżka w `<Link href>` kompiluje się (cicha utrata typed routes). Dlatego regeneracja jest krokiem bramki, a nie reakcją na czerwony `tsc`.

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

- Strategy (§1–§5) last reviewed: 2026-09-09 (§5 po Fazie 4)
- Stack versions last verified: 2026-09-03
- AI-native tool references last verified: 2026-09-03

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (w szczególności: S-05 wnosi
  logikę odstępów po stronie klienta; aplikacja otwiera się na szerszą bazę
  użytkowników → nadużycie zasobów / koszt LLM),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner, CI wired),
- §7 negative-space no longer matches what the team believes.

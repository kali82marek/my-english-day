# Faza 1 wdrożenia testów: harness Workerów i zadania w tle — Krótki plan

> Pełny plan: `context/changes/testing-worker-harness-background-jobs/plan.md`
> Badania: `context/changes/testing-worker-harness-background-jobs/research.md`

## Co i dlaczego

Budujemy harness testów integracyjnych dla Workera API w workerd (Vitest 4.1 +
`@cloudflare/vitest-plugin` v1, izolowane D1 z `api/migrations/`, mock OpenAI na krawędzi
sieci, kontrola zadania tła) i piszemy testy, które dowodzą trzech ryzyk z
`test-plan.md` §2: nagranie cicho przepada (#1), wieczorem brak fiszek lub połowa (#2),
nowy Worker na starej bazie (#4). Tam, gdzie test ujawnia, że kod nie spełnia PRD,
wchodzą trzy małe poprawki już zdecydowane w archiwum.

## Punkt wyjścia

Vitest 3.2 w środowisku `node`, 20 testów prymitywów w `api/src/lib/`, zero testów tras i
zadania tła. Cały łańcuch `POST /situations` → transkrypcja → karty żyje w jednym pliku:
karty zapisywane pętlą (część + `failed` możliwa), `INSERT` w POST bez `try` (goły 500 i
osierocone audio), jeden `try` nadpisujący `done` na `failed` po błędach późniejszych,
brak serwerowej reguły wieku `pending` (klient maskuje po 60 s).

## Pożądany stan końcowy

`cd api && npm test` uruchamia wszystkie testy API w workerd na schemacie zbudowanym
wyłącznie z migracji, bez sieci i bez `.dev.vars`, i jest zielone — może być bramką z §5.
Nieudana transkrypcja kończy się `failed`, nieudany zapis daje JSON 500 bez wiersza i bez
pliku, zapis kart jest atomowy, transkrypt i `done` przeżywają każdy błąd generowania.
Reguła wieku `pending` (2 min) jest zakodowana jako `it.fails` z follow-upem. §6.2 książki
kucharskiej mówi, jak dodać kolejny test integracyjny.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
| --- | --- | --- | --- |
| Runner | Vitest 4.1 + `@cloudflare/vitest-plugin` v1 | Jedyna utrzymywana ścieżka; stary pool na Vitest 3 jest porzucony, a istniejące testy nie używają API łamanego przez 4.x | Badania / Plan |
| Zakres poprawek | Małe, zdecydowane w archiwum: POST `try/catch` + sprzątanie R2, `DB.batch`, rozdzielenie `try` | Suite ma lądować zielone i być bramką; każda poprawka ma już decyzję (S-01 F2, S-03 follow-up, S-03 F1) | Plan |
| Reguła wieku `pending` | Próg 2 minuty; test `it.fails` + follow-up, bez implementacji | Realizacja to decyzja produktowa (Fix A S-01 F3); 2 min = 4× limit `waitUntil`, uzasadnienie niezależne od klienta | Plan |
| Lokalizacja testów | `api/src/routes/<route>.integration.test.ts` obok tras; helpery i setup w `api/test/` | Spójne z §6.1 (test obok modułu); sufiks odróżnia warstwę bez drugiego katalogu | Plan |
| Pool | Jeden pool workerd dla `lib/` i integracji | Najprostsza konfiguracja; różnica Node/workerd, jeśli się pojawi, jest sygnałem | Badania / Plan |
| Mock sieci | `vi.spyOn(globalThis, 'fetch')` + guard „niezamockowany rzuca”; bez MSW | Istniejący wzorzec repo; plugin ładuje `.dev.vars` z prawdziwym kluczem, więc guard jest obowiązkowy | Badania / test-plan §4 |
| Błędy D1 | Trigger SQL `RAISE(ABORT)` zakładany w teście, nigdy mock D1 od środka | Test „nigdy część kart + `failed`” niezależny od tego, jak poprawka osiąga atomowość | Badania |
| Ryzyko #4 | Bez osobnego testu schematu; harness na migracjach + deliberate-break 0004 | Snapshot `PRAGMA` to anty-wzorzec z §2; suite na schemacie z migracji jest dowodem | test-plan §2 / Plan |

## Zakres

**W zakresie:**
- Podniesienie Vitest, plugin, `vitest.config.ts`, `api/test/` (setup, typy, helpery), tsconfig
- Spike harnessu (3 testy właściwości) i 9 testów ryzyk #1/#2 z nazwanym deliberate-break
- Trzy poprawki w `api/src/routes/situations.ts`
- Follow-up `stale-pending-server-rule.md`, wpisy §6.2/§6.7, aktualizacja §3/§4/§5/§8

**Poza zakresem:**
- Realizacja reguły wieku `pending` i zmiany klienta (`ORPHAN_MS`)
- Globalny `app.onError`, symulacja awarii R2, bezpiecznik idempotencji generowania
- Kontrakt generatora (Faza 3 wdrożenia), własność/dzień (Faza 2), CI/hooki/jedno polecenie (Faza 4)
- Drugi projekt Vitest `node`

## Architektura / Podejście

Test → `app.fetch(req, env, ctx)` z `createExecutionContext()` → asercje na odpowiedzi →
`await waitOnExecutionContext(ctx)` → asercje na wierszu `situations`, tabeli `flashcards`
i `env.AUDIO_BUCKET.list()`. OpenAI zamockowane per URL (`mockOpenAI`), błędy D1
wstrzykiwane triggerem (`withTrigger`), sprzątanie `resetDb` w `afterEach` (izolacja w
pluginie jest per plik). Migracje aplikowane w `test/setup.ts` z `TEST_MIGRATIONS`
(binding z `readD1Migrations`), sekrety nadpisane w `miniflare.bindings`.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Harness workerd + spike | Vitest 4.1 + plugin, migracje w setupie, guard `fetch`, helpery; 20 starych testów zielone w workerd; 3 testy właściwości harnessu | Trigger `RAISE(ABORT)` lub `waitOnExecutionContext` z Hono nie działa w miniflare 5.x → powrót do `/10x-plan` |
| 2. Ryzyko #1 | T1.1–T1.4, poprawka POST (JSON 500 + sprzątanie R2), follow-up reguły wieku | `it.fails` zamieni się w trwały wyjątek, jeśli follow-up nie ma właściciela |
| 3. Ryzyko #2 | T2.1–T2.5, `DB.batch`, rozdzielenie `try` | Regresja ścieżki szczęśliwej po przebudowie finalizacji (smoke z prawdziwym kluczem) |
| 4. Ryzyko #4 + książka kucharska | Deliberate-break 0004, §6.2/§6.7, §3 `complete` | §6.2 opisujące wzorzec z research zamiast tego, który powstał |

**Wymagania wstępne:** Node 24 i `npm` w `api/`; `api/.dev.vars` lokalnie (do smoke'a, nie
do testów); port 3030 wolny dla `wrangler dev`.
**Szacowany wysiłek:** ~3–4 sesje w 4 fazach (Faza 1 najdłuższa: spike i podniesienie runnera).

## Otwarte ryzyka i założenia

- Założenie: `vi.spyOn(globalThis, 'fetch')` w testach `lib/` nadpisuje guard z `setup.ts`
  (Vitest reużywa spy'a). Jeśli nie, guard przenosi się do `mockOpenAI`.
- Założenie: `applyD1Migrations` w `setupFiles` biegnie raz per plik i jest idempotentne.
- Kształt augmentacji typów `env` w pluginie v1 (`Cloudflare.Env` vs `ProvidedEnv`) do
  potwierdzenia w `.d.ts` pluginu.
- Test T1.3 ma okno ~2,5 min po północy UTC (ryzyko #6); dziś niegroźne (`it.fails`).
- Vitest 4 może zmienić zachowanie któregoś z 20 testów `lib/` — traktować jako sygnał.

## Kryteria sukcesu (podsumowanie)

- Jedno polecenie `cd api && npm test` biegnie w workerd na schemacie z migracji, bez sieci,
  i jest zielone; usunięcie migracji 0004 je czerwieni.
- Każdy z 9 testów ryzyk ma wykonany deliberate-break; T1.2, T2.2, T2.3 były czerwone przed
  poprawkami i zielone po nich.
- §6.2 w `test-plan.md` wystarcza, by osoba bez kontekstu dodała test nowej trasy; wiersz 1
  tabeli §3 = `complete`.

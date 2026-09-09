---
date: 2026-09-09T16:35:00+02:00
researcher: Claude (10x-research)
git_commit: 2cc915b
branch: main
repository: my-english-day
topic: "Faza 4 test-planu: bramki jakości — jedno lokalne polecenie (lint + typecheck + testy API) i checklista deployu (Risk #4)"
tags: [research, codebase, quality-gates, npm-scripts, expo-typed-routes, wrangler, d1-migrations, test-plan-phase-4]
status: complete
last_updated: 2026-09-09
last_updated_by: Claude (10x-research)
---

# Research: Bramki jakości — jedno polecenie bramki i checklista migracja → deploy

**Date**: 2026-09-09T16:35:00+02:00
**Researcher**: Claude (10x-research)
**Git Commit**: 2cc915b
**Branch**: main
**Repository**: my-english-day

## Research Question

Ugruntować Fazę 4 `context/foundation/test-plan.md` („Bramki jakości”): (1) czy JEDNO polecenie z katalogu głównego może uruchomić `expo lint`, `tsc --noEmit` (front), `npm run typecheck` i `npm test` (api) i kończyć się niezerowym kodem, gdy dowolna warstwa pada — na Windows/PowerShell i na świeżym checkout (typed routes gitignored); (2) jaki jest dzisiejszy przepływ deployu, gdzie żyje checklista migracja → deploy i co musi zawierać (Risk #4, migracja 0005 niezaaplikowana zdalnie); (3) które wiersze §5 są „required after §3 Phase 4” i co ma zyskać §6.

## Summary

- **Cztery warstwy są dziś zielone i tanie**: `npx tsc --noEmit` 3 s, `npx expo lint` 4 s (0 warningów), `api: npm run typecheck` 2 s, `api: npm test` 7 s (11 plików, 103 zielone + 5 `it.fails`). Cała bramka to ~20 s. Pomiar własny 2026-09-09, commit 2cc915b.
- **Brak agregatu**: root `package.json` nie ma `typecheck` ani skryptu bramki; nie ma workspaces, `concurrently`, `npm-run-all`, husky, `.github/`, hooków w `.claude/settings.json`. Bramka istnieje tylko jako cztery ręczne polecenia wypisywane w planach slice'ów (`package.json:40-51`, `api/package.json:5-11`).
- **Kody wyjścia propagują się na Windows** — wytyczna „`&&` nie propaguje w PowerShell/npm” jest **skorygowana**: skrypty npm biegną w `cmd.exe` (`npm config get script-shell` = null → domyślna powłoka), nie w PowerShell. Zmierzone: `npm exec -c 'node -e "process.exit(2)"'` → 2; `npm --prefix api run typecheck` z wstrzykniętym błędem typu → 2, po usunięciu → 0; łańcuch `cmd1 && echo X` z `cmd1` = exit 1 → X nie drukowane, exit 1. Prosty skrypt npm z `&&` jest poprawną bramką na tej maszynie; PowerShell 5.1 jest problemem TYLKO gdy użytkownik wpisuje łańcuch ręcznie w konsoli, nie przez `npm run`.
- **Typed routes — wytyczna skorygowana w dwóch miejscach**. (a) Brak `.expo/types/router.d.ts` **nie** obala `tsc` (zmierzone: exit 0) — `Href` degraduje się do `string | HrefObject` (`node_modules/expo-router/build/typed-routes/types.d.ts:50-52`), więc utrata jest **cicha** (złe ścieżki przestają być łapane). (b) To brak **`expo-env.d.ts`** (też gitignored, `.gitignore:10`) obala `tsc` — zmierzone: 2 błędy (`src/components/animated-icon.web.tsx:5` CSS module, `src/constants/theme.ts:6` `@/global.css`). Oba pliki generuje bez dev servera **`npx expo customize tsconfig.json`** (3 s, exit 0, nie brudzi gita, nie nadpisuje `tsconfig.json`); w SDK 56 nie ma `expo typegen`, a `expo export` typów nie generuje.
- **Checklista deployu żyje wyłącznie w zarchiwizowanym follow-upie** S-03 (`context/archive/2026-06-09-same-context-variants/follow-ups/review-fixes.md:11-17`); kanoniczny `context/deployment/deploy-plan.md:47-56` **pomija krok migracji**. Migracja `0005_add_flashcard_review_state.sql` jest zaaplikowana tylko `--local` (S-05 `smoke-phase2.md:3`), a Worker z S-05 czyta nowe kolumny — dług deployu jest realny. `wrangler` w powłoce nieinteraktywnej nie jest zalogowany (`wrangler whoami` → „not authenticated”), więc stanu zdalnego nie da się zweryfikować bez `wrangler login` — checklista musi mieć krok „zaloguj/sprawdź `d1 migrations list --remote`” przed `apply`.
- **§5**: wiersze 130 (jedno polecenie lint+typecheck) i 133 (pre-prod smoke migracja → deploy) są „required after §3 Phase 4”; wiersz 134 (post-edit hook) „recommended after Phase 4” — poza zakresem (Lekcja 3). §6 nie ma dziś wpisu „jak uruchomić pełną bramkę” — polecenia uruchomień są rozproszone (`test-plan.md:153, 161`).

## Detailed Findings

### 1. Skrypty i runner — co istnieje, czego nie ma

- Root `package.json:40-51`: `start`, `reset-project`, `android`, `ios`, `web`, `lint` (`expo lint`), `api:dev` (`cd api && npm run dev`), `api:deploy` (`cd api && npm run deploy`), `web:export`, `web:deploy`. **Brak `typecheck`** — front typecheck jest ad hoc `npx tsc --noEmit` (tak zapisywany w planach, np. `context/archive/2026-09-09-srs-review-session/plan.md:14`).
- `api/package.json:5-11`: `dev` (`wrangler dev --port 3030`), `deploy` (`wrangler deploy`), `cf-typegen`, `test` (`vitest run`), `typecheck` (`tsc --noEmit`).
- Brak `workspaces` w root (grep), więc świeży checkout wymaga `npm install` w root **i** w `api/`. `npm --prefix api run typecheck` z brakującym `node_modules` w `api/` pada niezerowo (`tsc` not found) — nie jest to ciche pominięcie, ale komunikat jest mylący; bramka może wypisać jasną wskazówkę.
- Root skrypty `api:*` używają `cd api && …` — wzorzec już przyjęty w repo i działający w cmd.exe/sh. Alternatywa `npm --prefix api run <x>` działa z dowolnego cwd (zmierzone) i nie zależy od `cd`.
- Wersje: node v24.16.0, npm 12.0.2, TypeScript root ~6.0.3, api ~5.7.0, wrangler 4.95.0 (dostępny 4.130.0 — bez znaczenia dla bramki).
- Nie ma: `.github/`, `.husky/`, `lint-staged`, `concurrently`, `npm-run-all`, `scripts/` z bramką (tylko `scripts/reset-project.js`), hooków w `.claude/settings.json` (tylko `permissions` + `enabledPlugins`), `AGENTS.md`, `api/README.md`. README root to nietknięty boilerplate `create-expo-app` (linie 16, 33, 40-41).

### 2. Propagacja kodów wyjścia na Windows (zmierzone)

| Próba | Wynik |
|---|---|
| `npm config get script-shell` | `null` → npm używa domyślnej powłoki (`cmd.exe` na Windows, `sh` na Unix) |
| `npm exec -c 'node -e "process.exit(2)"'; echo $?` | `2` |
| `npm --prefix api run typecheck` z plikiem `api/src/__gate_probe__.ts` (`const x: number = "s"`) | exit `2`; po usunięciu pliku exit `0` |
| `npm exec -c 'node -e "process.exit(1)" && echo SHOULD_NOT_PRINT'` | nic nie wydrukowane, exit `1` |

Wniosek: wytyczna z `change.md:16` („bramka, która przechodzi, bo `&&` nie propaguje kodu wyjścia w PowerShell/npm na Windows”) dotyczy tylko ręcznego wpisywania łańcucha w PowerShell 5.1 (tam `&&` to błąd parsera, więc nic nie ruszy — nie „fałszywie zielone”). Skrypt npm z `&&` jest bezpieczny. Realne ryzyko „fałszywie zielonego” to: (a) skrypt, który uruchamia warstwy przez `;` lub osobne `npm run` bez sprawdzania kodu; (b) skrypt w PowerShell (`.ps1`) bez `$LASTEXITCODE` po każdym natywnym poleceniu; (c) `expo lint` bez `--max-warnings 0` (warningi nie obalają — `node_modules/expo/node_modules/@expo/cli/build/src/lint/lintAsync.js:153-155`, domyślnie flaga nie jest przekazywana; `resolveOptions.js:75`). Zmierzone: `npx expo lint --max-warnings 0` → exit 0 dziś (baseline 0 warningów).

### 3. Typed routes i `expo-env.d.ts` — co naprawdę obala `tsc`

- `tsconfig.json:14-19` `include`: `**/*.ts`, `**/*.tsx`, `.expo/types/**/*.ts`, `expo-env.d.ts`; `exclude` (`:20-23`): `node_modules`, `api`. `extends: expo/tsconfig.base` (`skipLibCheck: true`, `moduleResolution: bundler`).
- `expo-env.d.ts` (3 linie): `/// <reference types="expo/types" />` → `node_modules/expo/types/index.d.ts:1-9` (m.in. `metro-require`, deklaracje assetów/CSS). `app.json:48-51`: `experiments.typedRoutes: true`, `reactCompiler: true`.
- Oba pliki gitignored (`.gitignore:7` `.expo/`, `:10` `expo-env.d.ts`) i nieśledzone (`git ls-files` pusto). `git check-ignore -v .expo/types/router.d.ts` → `.gitignore:7`.
- **Deliberate-break A** (tylko `router.d.ts` usunięty): `npx tsc --noEmit` → exit **0**. Powód: `node_modules/expo-router/build/typed-routes/types.d.ts:7-9` deklaruje pusty `namespace ExpoRouter { interface __routes {} }`, a `:50-52` `Href<T> = T extends { href: any } ? T['href'] : string | HrefObject` — bez augmentacji `href="/nieistniejaca"` kompiluje się. Konsumenci typowanych ścieżek: `src/components/external-link.tsx:1,5` (`Href & string`), `src/app/(auth)/register.tsx:123` i `login.tsx:123` (`<Link href>`), `src/components/app-tabs.web.tsx:24,27,30`; zero `useRouter`/`router.push`/`Redirect`.
- **Deliberate-break B** (tylko `expo-env.d.ts` usunięty): `tsc` → exit **2**: `src/components/animated-icon.web.tsx(5,21) TS2307 './animated-icon.module.css'`, `src/constants/theme.ts(6,8) TS2882 '@/global.css'`.
- **Regeneracja bez dev servera**: `CI=1 npx expo customize tsconfig.json` → „Using src/app as the root directory for Expo Router. Generating: tsconfig.json”, exit 0, **3 s**, tworzy oba pliki (`router.d.ts` 2877 B, `expo-env.d.ts` 110 B), `git status` czysty (nie nadpisuje `tsconfig.json` ani `.gitignore` — wpisy już są). Po regeneracji `tsc` exit 0. Mechanika: `@expo/cli/build/src/customize/templates.js:92-103` (`tsconfig.json` special-cased → `customize/typescript.js:60-78` → `startTypeScriptServices()` bez serwera → `type-generation/routes.js:104` `regenerateDeclarations` raz). Inne ścieżki: `expo start` / `expo run:*` (`DevServerManager.js:233,237`); `expo export` **nie** generuje (`export/exportApp.js:160` → `startMetroAsync` bez `bootstrapTypeScriptAsync`). W SDK 56 (`@expo/cli` 56.1.14, `build/bin/cli:103-125`) brak `typegen`/`types`. Flaga `EXPO_NO_TYPESCRIPT_SETUP` wyłącza setup (`utils/env.js:92-93`).
- Notatka z S-05 impl-review (`context/archive/2026-09-09-srs-review-session/reviews/impl-review.md:175`) mówi „wymaga `expo start`” — to prawda, ale niepełna; `customize tsconfig.json` jest tańszą, nieinteraktywną drogą i to ona powinna być krokiem bramki.

### 4. Harness testów API a świeży checkout

- `api/vitest.config.mts:14-19, 23-33`: plugin czyta `wrangler.toml`; `miniflare.bindings` nadpisują `.dev.vars` (`JWT_SECRET: 'test-secret'`, `OPENAI_API_KEY: 'sk-test-never-real'`, `ENVIRONMENT: 'test'`, `TEST_MIGRATIONS` z `readD1Migrations('./migrations')`). Komentarz w konfiguracji: „harness nie zależy od `.dev.vars` (w CI go nie będzie)”. Log „Using secrets defined in .dev.vars” ×9 to tylko informacja pluginu — nie zależność.
- `api/.dev.vars` gitignored (`api/.gitignore:8`, root `.gitignore:48`); zawiera klucze `JWT_SECRET`, `OPENAI_API_KEY` (nazwy, nie wartości). Testy nie wymagają pliku.
- Czas: 5.61 s wewnątrz vitest (setup 9.31 s łącznie w workerach), ~7 s od `npm test` do zakończenia. Schemat D1 budowany wyłącznie z `api/migrations/` (0001–0005) — Risk #4 w warstwie testów już pokryty (test-plan §6.7 Faza 1, „deliberate-break 0004”).

### 5. Przepływ deployu i checklista (Risk #4)

- Cel: `api/wrangler.toml:1-17` — `name = "my-english-day-api"`, D1 `my-english-day-db` (`database_id 9bc5…`), `migrations_dir = "migrations"`, R2 `my-english-day-audio`. Front: Pages `my-english-day` (`package.json:49-50`; `context/deployment/deploy-plan.md:12-15`: `https://my-english-day.pages.dev`, `https://my-english-day-api.kali82marek.workers.dev`, `/health`).
- `context/deployment/deploy-plan.md:47-56` „Deploy commands”: `cd api && npx wrangler deploy`; `npx expo export --platform web`; `npx wrangler pages deploy dist …` — **bez `d1 migrations apply`**; `:63` „Skonfigurować GitHub Actions CI/CD” w „Następne kroki”.
- Jedyna napisana checklista: `context/archive/2026-06-09-same-context-variants/follow-ups/review-fixes.md:11-17` (S-03 F4): 1. `cd api && npx wrangler d1 migrations apply my-english-day-db --remote`, 2. `npx wrangler deploy`. Źródło: `reviews/impl-review.md:68-76` tamże. Faza 1 test-planu już to flagowała: `context/archive/2026-09-03-testing-worker-harness-background-jobs/research.md:72-73, 181, 312, 330`.
- Per-slice „Migration Notes” powtarzają regułę: `…capture-situation-by-voice/plan.md:326-327` (0002 + `r2 bucket create`), `…gated-ai-flashcard-generation/plan.md:319` (0003), `…same-context-variants/plan.md:152` (0004), `…srs-review-session/plan.md:274` (0005 „PRZED deployem Workera z Fazy 2 (trasa czyta nowe kolumny)”; brak backfillu, `due_at IS NULL` = wszystkie zaakceptowane w pierwszej sesji).
- **Stan migracji**: lokalnie `npx wrangler d1 migrations list my-english-day-db --local` → „No migrations to apply!” (0001–0005 zastosowane). Zdalnie: `--remote` → „In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN”; `wrangler whoami` → „You are not authenticated. Please run `wrangler login`”. Historia: 0005 z commitu 661bd97 (S-05 p1); S-05 `smoke-phase2.md:3` „zastosowana lokalnie”. **Nikt nie zaaplikował 0005 na produkcję; Worker z S-05 nie został jeszcze zdeployowany** (brak dowodu deployu po 661bd97 w artefaktach).
- `infrastructure.md:79`: `wrangler rollback` nie cofa D1 → migracje wymagają osobnego rollbacku; `:77` preview `wrangler deploy --env preview`; `:80` agent może: deploy, rollback, secret put, tail, D1 queries. `roadmap.md:62` „Brak CI/CD”, `:171` CI zaparkowane. `tech-stack.md:8-10` stary, niezrealizowany zamiar (`testflight`, `github-actions`).
- „Addytywne migracje = kolejność nieważna” — **fałsz w obie strony**: (a) stary kod na nowej bazie jest bezpieczny, ale **nowy kod na starej bazie** failuje (`is_variant` w INSERT — S-03 F4; kolumny review state w trasach S-05); (b) 0005 wymaga 0004 (`srs plan.md:274`); (c) `CHECK` na enumach w SQLite to przebudowa tabeli, nieaddytywna, z oknem deployu (`…testing-llm-generator-contract/follow-ups/enum-check-migration.md:35-50`); (d) S-05 impl-review `:88-89`: nowy indeks ma stary jako prefiks — `DROP INDEX` w przyszłej migracji. Kolizja nazw: `enum-check-migration.md` nadal nazywa swoją nienapisaną migrację „0005”, a slot 0005 zajął S-05 → następna to 0006.
- Skrypty ręcznych smoke'ów: `api/scripts/smoke-situations.ps1:1-25`, `api/scripts/test-flashcards.ps1:1-21` (wymaga migracji `--local`) — niepodpięte do npm; kandydaci na wiersze checklisty „po deployu”.

### 6. §5 i §6 test-planu — co Faza 4 ma zmienić

- `test-plan.md:130` lint+typecheck: „required (dziś ręcznie…); jedno polecenie required after §3 Phase 4” → po Fazie 4: `required` z nazwą polecenia.
- `:131` unit+integration: już `required` (`cd api && npm test`) — bramka agregująca ma go zawierać.
- `:132` e2e ręczne: „required manually before deploy; checklista z sekcji Manual zarchiwizowanych planów” — checklista deployu powinna do niej odsyłać (S-04 Manual 2.3–2.4, S-05 Manual 2.3, 3.3–3.6 nadal `[ ]`).
- `:133` pre-prod smoke migracja → deploy: „required after §3 Phase 4” → `required` + ścieżka checklisty.
- `:134` post-edit hook: „recommended after §3 Phase 4 (Lekcja 3)” — **nie ruszać** poza zmianą „after Phase 4” → „recommended (konfiguracja w Lekcji 3)”.
- `:138-140`: „Faza 4 dostarcza jedno lokalne polecenie, które CI później wywoła bez zmian” — polecenie musi być bezinteraktywne (`CI=1`, `--max-warnings 0`, bez `wrangler login`).
- §6: brak podsekcji o bramce; polecenia uruchomień w `:153, 161` (`cd api && npm test`, `-t "Ryzyko #N"`). §6.7 zbiera notatki per faza (`:239-269`). §7 (`:271-279`) wyklucza runner frontu i e2e automatyczne — bramka nie ma tego zmieniać.
- `CLAUDE.md:9-14` jest przeterminowane („Brak skonfigurowanych testów”, brak `api:*`/`web:*`, `:41` „backend jeszcze nie wybrany”) — agent czytający CLAUDE.md nie znajdzie bramki; sekcja „Build & Development Commands” to naturalne miejsce na jedną linię o poleceniu bramki i wskaźnik na checklistę. (Uwaga: `CLAUDE.md` to plik reguł — edycja ograniczona do sekcji poleceń; nie dotykać bloku lekcji.)

### 7. Najtańszy projekt bramki (hipoteza dla `/10x-plan`)

- **Jeden skrypt npm w root** (`"gate"` lub `"check"`), łańcuch `&&` w kolejności rosnącego kosztu: `expo customize tsconfig.json` (3 s, gwarantuje `expo-env.d.ts`/`router.d.ts`) → `expo lint --max-warnings 0` (4 s) → `tsc --noEmit` (3 s) → `npm --prefix api run typecheck` (2 s) → `npm --prefix api test` (7 s). Dodatkowo `"typecheck": "tsc --noEmit"` w root dla symetrii z `api/`. Bez `concurrently` (równoległość nie jest warta zależności przy ~20 s). Bez `.ps1`/`.sh` (dwa pliki do utrzymania, `$LASTEXITCODE` pułapka).
- Dowód „każda warstwa obala”: deliberate-break per warstwa — plik z błędem ESLint (np. nieużywany import w `src/`), plik z błędem typu w `src/`, plik z błędem typu w `api/src/`, test z `expect(1).toBe(2)` — każdy osobno → niezerowy exit skryptu; usunięcie → 0. Plus „świeży checkout”: usunąć `expo-env.d.ts` i `.expo/types/` → bramka zielona (regeneracja w środku).
- **Checklista deployu**: plik w `context/deployment/` (obok `deploy-plan.md`, który dziś jest niepełny) — kroki: bramka zielona → `wrangler login`/`whoami` → `d1 migrations list --remote` (co czeka) → `d1 migrations apply --remote` → `wrangler deploy` → `/health` → smoke ręczny (Manual rows) → dla frontu `web:export` + `web:deploy`. Dług: 0005 na produkcję przy najbliższym deployu; kolejna migracja to 0006. Odnośnik z `deploy-plan.md` i `CLAUDE.md`. Weryfikacja checklisty przez faktyczny deploy wymaga `wrangler login` — wiersz **Manual**.
- Spekulatywne / poza zakresem: test tekstu SQL migracji, migawka `PRAGMA` (test-plan #4 anti-pattern); hook post-edit (Lekcja 3); YAML CI (lekcja CI) — ale skrypt ma być tym, co CI wywoła bez zmian; runner frontu (§7).

## Code References

- `package.json:40-51` — skrypty root; brak `typecheck` i bramki; `api:*` używa `cd api && …`
- `api/package.json:5-11` — `test: vitest run`, `typecheck: tsc --noEmit`, `deploy: wrangler deploy`
- `api/wrangler.toml:1-17` — nazwa Workera, D1 `my-english-day-db`, `migrations_dir`, R2
- `api/vitest.config.mts:14-19, 23-33` — bindingi testowe nadpisują `.dev.vars`; migracje z `./migrations`
- `api/migrations/0001…0005` — pięć migracji; 0005 z commitu 661bd97
- `tsconfig.json:14-23` — `include` z `.expo/types/**/*.ts` i `expo-env.d.ts`; `exclude: api`
- `expo-env.d.ts:1` — `/// <reference types="expo/types" />` (gitignored, `.gitignore:10`)
- `.gitignore:7,8,10,46-49` — `.expo/`, `dist/`, `expo-env.d.ts`, `api/.wrangler/`, `api/.dev.vars`
- `app.json:48-51` — `experiments.typedRoutes: true`
- `node_modules/expo-router/build/typed-routes/types.d.ts:7-9, 50-52` — `Href` degraduje się do `string` bez augmentacji
- `node_modules/expo/node_modules/@expo/cli/build/src/customize/templates.js:92-103` — `tsconfig.json` → `customize/typescript.js:60-78` → generacja typów bez serwera
- `node_modules/expo/node_modules/@expo/cli/build/src/export/exportApp.js:160` — `export` nie generuje typów
- `node_modules/expo/node_modules/@expo/cli/build/src/lint/lintAsync.js:153-155`, `resolveOptions.js:75` — `--max-warnings` przekazywane tylko gdy jawnie podane
- `src/components/animated-icon.web.tsx:5`, `src/constants/theme.ts:6` — miejsca, które padają bez `expo-env.d.ts`
- `src/components/external-link.tsx:1,5`, `src/app/(auth)/login.tsx:123`, `register.tsx:123`, `src/components/app-tabs.web.tsx:24-30` — konsumenci typowanych `href`
- `eslint.config.js:1-10` — `eslint-config-expo/flat`, `ignores: dist/*`
- `context/deployment/deploy-plan.md:12-15, 47-56, 58-64` — kanoniczne polecenia deployu bez migracji; URL-e prod
- `context/foundation/infrastructure.md:77-81, 98-102, 104-109` — rollback nie cofa D1; CI out of scope
- `context/foundation/roadmap.md:62, 171` — brak CI, CI zaparkowane
- `context/foundation/test-plan.md:50, 67, 82, 128-140, 153, 161, 239-279` — Risk #4, §3 wiersz 4, §5 tabela, §6 run commands, §6.7, §7
- `CLAUDE.md:9-14, 41` — przeterminowana sekcja poleceń
- `.claude/settings.json` — tylko `permissions` (allow `npm *`, `npx *`, `node *`; ask `git push`), brak `hooks`
- `api/scripts/smoke-situations.ps1:1-25`, `api/scripts/test-flashcards.ps1:1-21` — ręczne smoke'i niepodpięte do npm

## Architecture Insights

- Dwa niezależne pakiety npm (root Expo, `api/` Worker) bez workspaces; agregacja tylko przez `cd api && …` lub `npm --prefix api`. Front i API mają różne wersje TypeScript (6.0 vs 5.7) — celowo osobne `tsc`.
- Generowane artefakty TS frontu są celowo poza gitem (konwencja Expo); każda bramka, która ma działać na świeżym checkout/CI, musi je wytworzyć jako pierwszy krok.
- Harness API jest hermetyczny (bindingi testowe, migracje z katalogu, guard niezamockowanego `fetch` w `test/setup.ts`) — jedyna warstwa, która nie ma pułapki świeżego checkoutu poza `npm install`.
- Deploy jest ręczny i dwunożny (Pages + Worker); jedyny krok z kolejnością krytyczną (migracja → Worker) nie jest zapisany w kanonicznym dokumencie deployu, tylko w archiwum.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-same-context-variants/reviews/impl-review.md:68-76` + `follow-ups/review-fixes.md:11-17` — narodziny checklisty migracja → deploy (S-03 F4).
- `context/archive/2026-09-03-testing-worker-harness-background-jobs/research.md:72-73, 181, 312, 330` i `plan.md:44, 518, 625` — Faza 1: harness = migracje jako jedyne źródło schematu; „bramka pre-deploy należy do Fazy 4”.
- `context/archive/2026-09-07-testing-llm-generator-contract/plan.md:694-695, 825` i `follow-ups/enum-check-migration.md:35-60` — deploy dotyka ryzyka #4; nieaddytywna migracja CHECK; kolizja numeru „0005”.
- `context/archive/2026-09-09-srs-review-session/plan.md:14, 272-274, 305-322`, `plan-brief.md:61`, `smoke-phase2.md:3`, `reviews/impl-review.md:88-89, 174-175` — 0005 tylko lokalnie; Manual rows otwarte; „typed routes wymagają `expo start`” (niepełne); `DROP INDEX` do przyszłej migracji.
- `context/archive/2026-09-09-duplicate-card-filtering/plan.md:162-164, 194-197` — brak migracji; Manual 2.3–2.4 otwarte.
- `context/changes/bootstrap-verification/verification.md:23-25, 97-99` — stary zamiar CI/TestFlight nigdy nie zrealizowany.

## Related Research

- `context/archive/2026-09-03-testing-worker-harness-background-jobs/research.md` — harness i migracje (Risk #4 warstwa testów).
- `context/archive/2026-09-07-testing-llm-generator-contract/research.md` — kontrakt generatora (poprzednia faza).

## Open Questions

- Stan migracji na produkcji jest nieznany z tej sesji (brak `wrangler login`); zakładamy 0001–0004 zaaplikowane (deploye S-01–S-03), 0005 nie. Do potwierdzenia przez `d1 migrations list --remote` w checkliście — wiersz Manual.
- Czy `expo customize tsconfig.json` zachowuje się identycznie na CI bez `CI=1`? Lokalnie z `CI=1` nie pytało o nic; w planie zapisać `CI=1` jako część polecenia lub sprawdzić bez flagi w deliberate-break „świeży checkout”.
- Nazwa skryptu (`gate` vs `check` vs `verify`) — decyzja planu; `check` jest najczęstszą konwencją npm, `gate` zgadza się ze słownictwem test-planu §5.

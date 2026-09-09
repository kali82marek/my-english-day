# Faza 4 wdrożenia testów: bramki jakości (jedno polecenie bramki + checklista deployu) — Plan implementacji

## Przegląd

Zablokować podłogę jakości projektu dwoma artefaktami: (1) jednym poleceniem `npm run gate`
z katalogu głównego, które w kolejności rosnącego kosztu regeneruje typy Expo, lintuje front
z zerową tolerancją warningów, typuje front i API i uruchamia suite API — i kończy się
niezerowym kodem, gdy dowolna warstwa pada; (2) checklistą deployu w `context/deployment/`
z krytyczną kolejnością migracja → Worker (ryzyko #4), która dziś żyje wyłącznie w
zarchiwizowanym follow-upie S-03. Faza zamyka §3 test-planu (wiersz 4), przenosi wiersze §5
z „required after §3 Phase 4” na `required` i dodaje wzorzec §6.8 „jak uruchomić pełną
bramkę”. Zero kodu produkcyjnego, zero nowych zależności, zero YAML CI.

## Analiza obecnego stanu

- Cztery warstwy bramki istnieją i są zielone (`research.md` §Summary, pomiar 2026-09-09,
  commit 2cc915b): `npx tsc --noEmit` 3 s, `npx expo lint` 4 s (0 warningów),
  `api: npm run typecheck` 2 s, `api: npm test` 7 s (11 plików, 103 + 5 `it.fails`).
  Razem ≈ 20 s. Żadne polecenie ich nie agreguje; plany slice'ów wypisują je ręcznie.
- Root `package.json:40-51` nie ma `typecheck` ani bramki; `api:*` używa `cd api && …`.
  Brak workspaces, `concurrently`, `npm-run-all`, husky, `.github/`, hooków w
  `.claude/settings.json`.
- Skrypty npm biegną w `cmd.exe` (`script-shell` = null) — `&&` propaguje kody wyjścia
  (zmierzone: exit 2 przez `npm --prefix api run typecheck` z wstrzykniętym błędem).
  Wytyczna „`&&` nie propaguje w PowerShell/npm” dotyczy tylko ręcznego wpisywania łańcucha
  w PowerShell 5.1 — nie skryptów npm (`research.md` §2).
- Świeży checkout: `.expo/types/router.d.ts` i `expo-env.d.ts` są gitignored. Brak
  `router.d.ts` **nie** obala `tsc` (utrata precyzji `Href` → `string`, cicha); brak
  `expo-env.d.ts` obala (`src/components/animated-icon.web.tsx:5`,
  `src/constants/theme.ts:6`). `npx expo customize tsconfig.json` regeneruje oba w 3 s bez
  dev servera, git zostaje czysty (`research.md` §3). W SDK 56 nie ma `expo typegen`;
  `expo export` typów nie generuje.
- `expo lint` domyślnie nie przekazuje `--max-warnings` — warningi nigdy nie obalają
  (`@expo/cli/build/src/lint/lintAsync.js:153-155`). `--max-warnings 0` działa (exit 0 dziś).
- Harness API nie zależy od `.dev.vars` (bindingi testowe w `api/vitest.config.mts:23-33`).
- Deploy: `context/deployment/deploy-plan.md:47-56` podaje polecenia **bez** kroku migracji;
  jedyna checklista migracja → deploy: `context/archive/2026-06-09-same-context-variants/follow-ups/review-fixes.md:11-17`.
  Migracja 0005 zaaplikowana tylko `--local` (S-05 `smoke-phase2.md:3`); Worker S-05 czyta
  nowe kolumny i nie był deployowany. `wrangler` nie jest zalogowany w powłoce
  nieinteraktywnej (`whoami` → „not authenticated”). Następna migracja to 0006
  (`enum-check-migration.md` nadal mówi „0005”). `wrangler rollback` nie cofa D1
  (`infrastructure.md:79`).
- `CLAUDE.md:9-14` twierdzi „Brak skonfigurowanych testów”, nie zna `api:*`/`web:*`;
  `:41` „backend jeszcze nie wybrany” — agent czytający plik reguł nie znajdzie bramki.
- test-plan §5 (`:130`, `:133`) „required after §3 Phase 4”; `:134` hook „recommended after
  Phase 4 (Lekcja 3)”; §6 nie ma wpisu o pełnej bramce; §6.7 zbiera notatki per faza.

## Pożądany stan końcowy

- `npm run gate` z katalogu głównego: exit 0 na czystym drzewie **i** na drzewie bez
  `expo-env.d.ts`/`.expo/types/`; exit ≠ 0, gdy pada dowolna z warstw (lint, tsc front,
  tsc api, test api) — udowodnione deliberate-breakiem per warstwa. `npm run typecheck` w
  root jako symetryczny odpowiednik `api/`.
- `context/deployment/deploy-checklist.md` istnieje, jest podlinkowany z `deploy-plan.md`
  i z sekcji poleceń `CLAUDE.md`, i zawiera kroki w kolejności: bramka → login →
  `migrations list --remote` → `migrations apply --remote` → `wrangler deploy` → `/health` →
  smoke ręczny → front `web:export` + `web:deploy`, plus rejestr długu (0005, 0006, DROP INDEX).
- `test-plan.md`: §5 wiersze `required` z nazwą polecenia/ścieżką checklisty; §6.8
  „Running the full gate before commit/deploy”; §6.7 notatka Fazy 4; `Last updated` i §8
  zaktualizowane. `CLAUDE.md` sekcja poleceń zgodna z rzeczywistością.
- Weryfikacja: wiersze `## Postęp` (kody wyjścia deliberate-breaków, grep na linki i
  kolejność kroków). Faktyczny deploy 0005 na produkcję to wiersz **Ręczny** — wymaga
  `wrangler login` i decyzji użytkownika o momencie wdrożenia.

### Kluczowe odkrycia:

- `research.md` §2 — tabela pomiarów propagacji kodów wyjścia (npm exec → 2; `--prefix`
  → 2/0; łańcuch `&&` → 1). Skrypt npm z `&&` jest bezpieczny; nie potrzeba `.ps1`/`.sh`.
- `research.md` §3 — deliberate-break A/B: tylko brak `expo-env.d.ts` obala `tsc`;
  `expo customize tsconfig.json` (`@expo/cli/build/src/customize/templates.js:92-103` →
  `customize/typescript.js:60-78`) to jedyna nieinteraktywna regeneracja w SDK 56.
- `research.md` §5 — stan migracji: lokalnie „No migrations to apply!” (0001–0005);
  zdalnie nieweryfikowalne bez `CLOUDFLARE_API_TOKEN`/`wrangler login`.
- `test-plan.md:138-140` — „Faza 4 dostarcza jedno lokalne polecenie, które CI później
  wywoła bez zmian” → polecenie bezinteraktywne, bez `wrangler login`, bez `.dev.vars`.
- Wzorzec dokumentacyjny §6.1–§6.5: punkty **Location / Naming / Reference / Run locally /
  Reguły / Uwaga** — §6.8 ma ten sam kształt.

## Czego NIE robimy

- Nie piszemy YAML GitHub Actions ani żadnej konfiguracji CI (lekcja CI; roadmap „Parked”).
  Bramka ma być poleceniem, które CI wywoła bez zmian — i tyle.
- Nie konfigurujemy hooków (post-edit, pre-commit, husky) — Lekcja 3; §5 wiersz 134 zostaje
  `recommended`.
- Nie dodajemy zależności (`concurrently`, `npm-run-all`, `cross-env`) ani wrapperów
  `.ps1`/`.sh` — 20-sekundowa bramka nie uzasadnia równoległości; dwa wrappery to podwójne
  utrzymanie i pułapka `$LASTEXITCODE`.
- Nie dodajemy runnera frontu ani e2e automatycznego (§7 test-planu).
- Nie testujemy tekstu SQL migracji, nie robimy migawek `PRAGMA` (anty-wzorzec ryzyka #4).
- Nie aplikujemy migracji 0005 na produkcję ani nie deployujemy Workera w ramach wierszy
  automatycznych — to decyzja i działanie użytkownika (wiersz Ręczny; wymaga `wrangler login`).
- Nie przepisujemy `deploy-plan.md` (rekord historyczny z 2026-05-28) — tylko odsyłacz do
  checklisty i korekta sekcji „Deploy commands”.
- Nie edytujemy bloku lekcji 10xDevs w `CLAUDE.md` (linie od „## 10xDevs AI Toolkit”) — tylko
  sekcja „Build & Development Commands” i jedno zdanie o backendzie w „Kontekst produktowy”.
- Nie zmieniamy §1–§4 ani §7 test-planu; §3 wiersz 4 na `complete` przestawia orkiestrator
  `/10x-test-plan`, nie ten plan.
- Nie dodajemy root `npm test` — bramka jest jednym wejściem; `cd api && npm test` zostaje
  poleceniem szybkim (§6.2).

## Podejście do implementacji

Trzy fazy w kolejności koszt × sygnał: najpierw sama bramka (najwięcej sygnału, ~20 s
weryfikacji, deliberate-breaki jako dowód), potem checklista deployu (ryzyko #4, dokument +
odsyłacze), na końcu utrwalenie w test-planie i pliku reguł. Każda faza kończy się
własnym commitem. Bramka to jeden skrypt npm z `&&`, kolejność: regeneracja typów (3 s,
usuwa pułapkę świeżego checkoutu) → lint (4 s, najtańszy sygnał składni) → `tsc` front (3 s)
→ `tsc` api (2 s) → testy api (7 s, najdroższe). Dowód „każda warstwa obala” to pięć
deliberate-breaków wykonanych i cofniętych w tej samej fazie, z kodami wyjścia zapisanymi w
`## Postęp`.

## Krytyczne szczegóły implementacji

- **Czas i cykl życia**: `expo customize tsconfig.json` MUSI być pierwszym krokiem bramki —
  `tsc` po nim widzi `expo-env.d.ts`. Polecenie z podanym plikiem nie pyta (`customizeAsync.js:43-49`);
  z `CI=1` też nie. Na drzewie, gdzie pliki już są, nadpisuje je identyczną treścią i nie
  brudzi gita (zmierzone). Jeśli kiedyś zacznie brudzić `tsconfig.json`, to znak dryfu
  `include` — wtedy poprawić `tsconfig.json`, nie usuwać kroku.
- **Debugowanie i obserwowalność**: deliberate-breaki wykonywać przez tymczasowe pliki
  (`src/__gate_probe__.tsx`, `api/src/__gate_probe__.ts`, `api/src/lib/__gate_probe__.test.ts`)
  i usuwać je przed commitem; `git status --short` po fazie musi pokazać tylko `package.json`
  (Faza 1). Kod wyjścia czytać w Bashu przez `echo $?` bezpośrednio po `npm run gate` (nie
  przez `| tail`, który go maskuje).

## Faza 1: Bramka lokalna `npm run gate`

### Przegląd

Jeden skrypt npm w root uruchamia pięć kroków łańcuchem `&&`; drugi skrypt `typecheck`
daje symetrię z `api/`. Dowód: pięć deliberate-breaków (lint, tsc front, tsc api, test api,
świeży checkout), każdy z oczekiwanym kodem wyjścia.

### Wymagane zmiany:

#### 1. Skrypty w root

**Plik**: `package.json` (sekcja `scripts`)

**Cel**: Jedno wejście do pełnej bramki dla człowieka, agenta i przyszłego CI; `typecheck`
w root, żeby `npm run typecheck` znaczyło to samo w obu pakietach.

**Umowa**: Dwa nowe skrypty, bez nowych zależności, bez zmian w istniejących:
- `"typecheck": "tsc --noEmit"`
- `"gate": "expo customize tsconfig.json && expo lint --max-warnings 0 && tsc --noEmit && npm --prefix api run typecheck && npm --prefix api test"`

Kolejność jest umową (koszt rosnąco; regeneracja typów pierwsza). `npm --prefix api` zamiast
`cd api &&` — działa z dowolnego cwd i nie zostawia powłoki w `api/` (istniejące `api:*`
zostają jak są). Bez `npx` w skrypcie — npm dodaje `node_modules/.bin` do PATH.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `npm run gate` na czystym drzewie → exit 0; w wyjściu widoczne „Generating: tsconfig.json”,
  wynik ESLint, oraz podsumowanie vitest „11 passed” (liczba plików bez zmian)
- `npm run typecheck` (root) → exit 0; `git status --short` → tylko `package.json`
- Deliberate-break „lint”: `src/__gate_probe__.tsx` z nieużywanym importem lub błędem reguły
  `eslint-config-expo` (np. `import { useState } from 'react'; export default function P() { return null }`)
  → `npm run gate` exit ≠ 0 **zanim** uruchomi się `tsc` (w wyjściu brak podsumowania vitest);
  po usunięciu pliku → exit 0
- Deliberate-break „tsc front”: `src/__gate_probe__.tsx` z `const x: number = 's'; export default x;`
  → exit ≠ 0 (TS2322), brak podsumowania vitest; po usunięciu → exit 0
- Deliberate-break „tsc api”: `api/src/__gate_probe__.ts` z `const x: number = 's'; export {};`
  → exit ≠ 0 (kod z `npm --prefix api run typecheck`, jak w badaniu: 2), brak podsumowania
  vitest; po usunięciu → exit 0
- Deliberate-break „test api”: `api/src/lib/__gate_probe__.test.ts` z
  `import { it, expect } from 'vitest'; it('gate probe', () => { expect(1).toBe(2) })`
  → exit ≠ 0 (vitest: 1 failed); po usunięciu → exit 0
- Deliberate-break „świeży checkout”: usunąć `expo-env.d.ts` i katalog `.expo/types/`
  → `npm run gate` exit 0 i oba pliki odtworzone; `git status --short` → tylko `package.json`
- `git diff --name-only HEAD` → dokładnie `package.json`; commit
  `chore(testing-quality-gates): jedno polecenie bramki npm run gate (p1)`

#### Weryfikacja ręczna:

- W interaktywnym PowerShell (bez `CI=1`) `npm run gate` przechodzi bez pytań i kończy się
  w ~20–30 s; `$LASTEXITCODE` = 0

**Uwaga implementacyjna**: Po zakończeniu tej fazy i pomyślnym przejściu wszystkich
automatycznych weryfikacji, zatrzymaj się tutaj, aby uzyskać ręczne potwierdzenie od
człowieka, że testy ręczne zakończyły się sukcesem, zanim przejdziesz do następnej fazy.
Bloki faz używają zwykłych punktorów — odpowiadające im pola wyboru `- [ ]` dla tych
elementów znajdują się w sekcji `## Progress` na dole planu.

---

## Faza 2: Checklista deployu (ryzyko #4) + odsyłacze

### Przegląd

Kolejność migracja → Worker przestaje żyć w archiwum. Nowy plik obok rekordu deployu,
odsyłacze z `deploy-plan.md` i `CLAUDE.md`, rejestr długu migracyjnego. Faktyczne wdrożenie
0005 to wiersz ręczny.

### Wymagane zmiany:

#### 1. Checklista

**Plik**: `context/deployment/deploy-checklist.md` (nowy)

**Cel**: Jedno miejsce, które człowiek i agent otwierają przed każdym deployem; koduje
regułę S-03 F4 i to, że `rollback` nie cofa D1.

**Umowa**: Frontmatter (`project`, `updated: 2026-09-09`, `source:` S-03 F4 + test-plan Risk #4).
Sekcje:
- **Przed deployem** — 1. `npm run gate` zielone (link do §6.8); 2. `cd api && npx wrangler whoami`
  (jeśli „not authenticated” → `npx wrangler login`; w powłoce nieinteraktywnej wymagany
  `CLOUDFLARE_API_TOKEN`); 3. `npx wrangler d1 migrations list my-english-day-db --remote`
  — zapisz, co czeka.
- **Backend (kolejność obowiązkowa)** — 4. `npx wrangler d1 migrations apply my-english-day-db --remote`
  (migracje addytywne są bezpieczne dla STAREGO kodu; NOWY kod na starej bazie failuje —
  dlatego migracja pierwsza); 5. `npx wrangler deploy`; 6. `GET /health` na URL Workera
  (z `deploy-plan.md`); 7. smoke ręczny — otwarte wiersze Manual ostatnich slice'ów
  (S-04 2.3–2.4, S-05 2.3, 3.3–3.6; ścieżki do `context/archive/2026-09-09-*/plan.md`) i
  `api/scripts/smoke-situations.ps1` jako pomoc.
- **Frontend** — 8. `npm run web:export`; 9. `npm run web:deploy`; 10. otwórz
  `https://my-english-day.pages.dev`, zaloguj się, sprawdź „Nauka”.
- **Rollback** — `npx wrangler rollback` cofa Worker, NIE cofa D1 (`infrastructure.md:79`);
  migracja cofana osobną migracją w przód.
- **Rejestr długu migracyjnego** (tabela: migracja | stan lokalnie | stan produkcja | źródło):
  0001–0004 zaaplikowane (deploye S-01–S-03; do potwierdzenia przez `list --remote`);
  0005 `add_flashcard_review_state` — lokalnie tak, produkcja **nie** (S-05 `smoke-phase2.md`);
  następny numer: **0006** (follow-up `enum-check-migration.md` nadal mówi „0005” — slot zajęty);
  dług: `DROP INDEX` starego indeksu (S-05 impl-review F, `reviews/impl-review.md:88-89`).
- **Reguła**: każda zmiana z nową migracją dopisuje wiersz do rejestru w swoim planie
  (§Uwagi dotyczące migracji) i tutaj przy deployu.

#### 2. Odsyłacz w rekordzie deployu

**Plik**: `context/deployment/deploy-plan.md` (sekcja `### Deploy commands`, `### Następne kroki`)

**Cel**: Kto trafi na stary rekord, zobaczy, że kolejność jest w checkliście.

**Umowa**: Nad blokiem kodu w „Deploy commands” jedno zdanie: „Pełna kolejność (migracja
D1 PRZED `wrangler deploy`, smoke, rollback): `deploy-checklist.md`.” W bloku backendu
dopisać linię `npx wrangler d1 migrations apply my-english-day-db --remote` przed
`npx wrangler deploy`. W „Następne kroki” oznaczyć 1–3 jako wykonane (`~~…~~` lub „(done)”)
i dodać „Checklista deployu: `deploy-checklist.md` (2026-09-09)”. Reszta pliku nietknięta.

#### 3. Sekcja poleceń w pliku reguł

**Plik**: `CLAUDE.md` (sekcje „Build & Development Commands” i „Kontekst produktowy”)

**Cel**: Agent czytający reguły znajduje bramkę i checklistę; znika fałsz „brak testów”.

**Umowa**: W „Build & Development Commands” zastąpić linię „Brak skonfigurowanych testów…”
trzema: `npm run gate` — pełna bramka (regeneracja typów Expo, lint, typecheck front+api,
testy api; ~20 s; wymagany przed commitem i deployem; szczegóły `context/foundation/test-plan.md`
§6.8); `npm run typecheck` — sam front; `cd api && npm test` / `npm run typecheck` —
sam backend (harness workerd, `context/foundation/test-plan.md` §6). Dodać linię o deployu:
`npm run api:deploy` / `npm run web:deploy` — TYLKO wg `context/deployment/deploy-checklist.md`
(migracja D1 przed Workerem). W „Kontekst produktowy” zastąpić zdanie „Backend … jeszcze nie
wybrany” na: backend to Cloudflare Worker (Hono + D1 + R2) w `api/`; deploy wg checklisty.
Blok „## 10xDevs AI Toolkit” bez zmian.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `test -f context/deployment/deploy-checklist.md`
- `grep -n "migrations apply" context/deployment/deploy-checklist.md` pojawia się PRZED
  `grep -n "wrangler deploy"` (mniejszy numer linii); `grep -c "0006"` ≥ 1; `grep -c "rollback"` ≥ 1
- `grep -n "deploy-checklist.md" context/deployment/deploy-plan.md CLAUDE.md` → po ≥ 1 trafieniu
  w każdym; `grep -n "migrations apply" context/deployment/deploy-plan.md` → 1 trafienie
- `grep -c "Brak skonfigurowanych testów" CLAUDE.md` → 0; `grep -n "npm run gate" CLAUDE.md` → ≥ 1;
  `git diff CLAUDE.md` nie dotyka linii od „## 10xDevs AI Toolkit” w dół
- `npm run gate` → exit 0 (dokumentacja nie rusza kodu; kontrola regresji)
- `git diff --name-only HEAD` → dokładnie `CLAUDE.md`, `context/deployment/deploy-plan.md`,
  `context/deployment/deploy-checklist.md`; commit
  `docs(testing-quality-gates): checklista deployu migracja → Worker (p2)`

#### Weryfikacja ręczna:

- `cd api && npx wrangler login` + `npx wrangler d1 migrations list my-english-day-db --remote`
  — potwierdzić, że czeka dokładnie 0005 (rejestr długu zaktualizowany, jeśli jest inaczej)
- Przejść checklistę naprawdę: `apply --remote` → `deploy` → `/health` 200 → smoke wierszy
  Manual S-05 (2.3 „grade”, 3.3–3.6 tab „Nauka”) na produkcji; odhaczyć wiersz 0005 w rejestrze

---

## Faza 3: test-plan §5/§6.8/§6.7 + zamknięcie

### Przegląd

Bramki stają się `required` z nazwą; książka kucharska dostaje wzorzec „pełna bramka”;
notatka §6.7 zapisuje, czego faza nauczyła (skorygowane założenia). Bez edycji §1–§4, §7.

### Wymagane zmiany:

#### 1. §5 Quality Gates

**Plik**: `context/foundation/test-plan.md` (tabela §5, akapit pod tabelą)

**Cel**: Tabela mówi prawdę o tym, co jest wymuszane i czym.

**Umowa**: Wiersz „lint + typecheck”: Where → `local: npm run gate (krok 1–4); CI planned`;
Required → `required — npm run gate (front: expo lint --max-warnings 0, tsc --noEmit; api:
npm run typecheck)`. Wiersz „unit + integration (api)”: Where dopisać `; w npm run gate (krok 5)`.
Wiersz „pre-prod smoke: migracja przed deployem”: Where → `context/deployment/deploy-checklist.md`
(kroki 2–6); Required → `required (ręcznie, przed każdym deployem Workera)`. Wiersz „post-edit
hook”: Required → `recommended (konfiguracja hooków należy do Lekcji 3)` — bez „after Phase 4”.
Akapit pod tabelą: „Faza 4 dostarczyła `npm run gate` (2026-09-09); CI ma wywołać dokładnie
to polecenie po `npm ci` w root i `api/`.”

#### 2. §6.8 — Running the full gate before commit/deploy

**Plik**: `context/foundation/test-plan.md` (nowa podsekcja `### 6.8` wstawiona PO §6.7, żeby
numeracja 6.1–6.7 pozostała stabilna dla odsyłaczy w archiwum)

**Cel**: Kanoniczna odpowiedź na „co uruchomić przed commitem/deployem i co znaczy czerwone”.

**Umowa**: Punkty w stylu §6.1–§6.5:
- **Command**: `npm run gate` (root); kroki i kolejność z `package.json`; ~20 s; exit ≠ 0 =
  stop. Pojedyncze warstwy: `npm run lint`, `npm run typecheck`, `cd api && npm run typecheck`,
  `cd api && npm test`.
- **Fresh checkout**: `npm install` w root i w `api/`; `expo-env.d.ts` i `.expo/types/` są
  gitignored — bramka je regeneruje (`expo customize tsconfig.json`), nie uruchamiać
  `expo start` tylko po to.
- **Reading red**: lint → plik/reguła w wyjściu ESLint (warningi też obalają);
  tsc front → `TS2307`/`TS2882` na CSS/asset = brak `expo-env.d.ts` (uruchom bramkę od
  początku, nie sam `tsc`); tsc api → jak dotąd; vitest → §6.2 (pojedyncze ryzyko
  `-t "Ryzyko #N"`).
- **Before deploy**: `context/deployment/deploy-checklist.md` — bramka to krok 1; migracja
  D1 przed Workerem; `rollback` nie cofa D1.
- **Reguły**: nie dodawać do bramki kroków interaktywnych (login, prompt) ani zależnych od
  sekretów (`.dev.vars`); nie dodawać `.ps1`/`.sh` wrapperów; nowy krok = nowy deliberate-break
  w planie zmiany; CI wywołuje `npm run gate` bez zmian.
- **Uwaga**: brak `router.d.ts` NIE obala `tsc` — `Href` degraduje się do `string` (cicha
  utrata typowania ścieżek); dlatego regeneracja jest w bramce, nie „gdy `tsc` padnie”.

#### 3. Notatka §6.7, nagłówek, §8

**Plik**: `context/foundation/test-plan.md` (sekcja `### 6.7`, linia `Last updated`, §8)

**Cel**: Utrwalić skorygowane założenia, żeby `--refresh` ich nie odkrywał na nowo.

**Umowa**: Wpis „**Faza 4 — Bramki jakości** (zamknięta 2026-09-09;
`context/changes/testing-quality-gates/`)” z 3–4 punktami: (a) dwa założenia z change.md
skorygowane przez badanie — `&&` w skryptach npm propaguje na Windows (cmd.exe), a `tsc`
obala nie brak `router.d.ts`, lecz brak `expo-env.d.ts`; (b) `expo customize tsconfig.json`
jako jedyna nieinteraktywna regeneracja w SDK 56 (`expo export` nie generuje); (c) `expo lint`
bez `--max-warnings` nigdy nie obala; (d) wyniki deliberate-breaków (kody wyjścia z Fazy 1)
i czas bramki; (e) checklista deployu przeniesiona z archiwum S-03 do `context/deployment/`,
0005 czeka na produkcję. `Last updated: 2026-09-09`. §8: „Strategy (§1–§5) last reviewed:
2026-09-09 (§5 po Fazie 4)”.

#### 4. Zamknięcie zmiany

**Plik**: `context/changes/testing-quality-gates/change.md`

**Cel**: Epilog dla `/10x-archive` i kolejnej sesji.

**Umowa**: `status: implemented`, `updated`, akapit „Faza zamknięta 2026-09-09” w Notes:
co dostarczono (skrypty, checklista, §5/§6.8/§6.7), co ręczne zostało (deploy 0005).
Wiersz §3 test-planu na `complete` przestawia orkiestrator — nie tu.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `grep -c "required after §3 Phase 4" context/foundation/test-plan.md` → 0;
  `grep -c "recommended after §3 Phase 4"` → 0
- `grep -n "^### 6.8" context/foundation/test-plan.md` → 1 trafienie; `grep -c "npm run gate"` ≥ 3
  (§5, §6.8, §6.7)
- `git diff HEAD -- context/foundation/test-plan.md` — hunki wyłącznie w §5, §6.7, §6.8,
  nagłówku `Last updated` i §8 (żadnego w §1–§4, §6.1–§6.6, §7)
- `npm run gate` → exit 0
- `git diff --name-only HEAD` → `context/foundation/test-plan.md`,
  `context/changes/testing-quality-gates/change.md`; commit
  `docs(testing-quality-gates): test-plan §5 required, §6.8 pełna bramka, §6.7 notatka (p3)`

#### Weryfikacja ręczna:

- §6.8 przeczytane na świeżo: wystarcza, żeby ktoś spoza sesji uruchomił bramkę na świeżym
  checkout i wiedział, co zrobić z czerwonym

---

## Strategia testowania

### Testy jednostkowe:

- Brak nowych testów kodu — faza dostarcza bramkę, nie testy.

### Testy integracyjne:

- „Testem” bramki są deliberate-breaki Fazy 1 (pięć warstw + świeży checkout) z kodami
  wyjścia w `## Postęp`; nie zostają w repo.

### Kroki testowania ręcznego:

1. Interaktywny PowerShell: `npm run gate`, bez pytań, `$LASTEXITCODE` = 0.
2. `wrangler login` → `d1 migrations list --remote` → zgodność z rejestrem długu.
3. Przejście checklisty przy najbliższym deployu (0005 → produkcja), smoke S-05 na prod.

## Uwagi dotyczące wydajności

Bramka ≈ 20 s (customize 3 + lint 4 + tsc 3 + tsc api 2 + vitest 7). Sekwencyjnie — bez
równoległości; jeśli suite API przekroczy ~60 s, rozważyć `concurrently` w osobnej zmianie.

## Uwagi dotyczące migracji

Brak nowych migracji. Ta zmiana dokumentuje, że 0005 czeka na produkcję i że następny numer
to 0006. Deploy Workera w ramach tej zmiany nie jest wymagany (zero zmian w `api/src`).

## Referencje

- Badanie: `context/changes/testing-quality-gates/research.md`
- Zmiana: `context/changes/testing-quality-gates/change.md`
- test-plan: `context/foundation/test-plan.md:50, 67, 82, 128-140, 142-147, 239-269, 281-293`
- Checklista źródłowa: `context/archive/2026-06-09-same-context-variants/follow-ups/review-fixes.md:11-17`
- Rekord deployu: `context/deployment/deploy-plan.md:47-64`
- Infrastruktura: `context/foundation/infrastructure.md:77-81`
- Dług 0005: `context/archive/2026-09-09-srs-review-session/plan.md:272-274`, `smoke-phase2.md:3`, `reviews/impl-review.md:88-89, 175`
- Typed routes: `node_modules/expo/node_modules/@expo/cli/build/src/customize/templates.js:92-103`,
  `node_modules/expo-router/build/typed-routes/types.d.ts:50-52`
- Lint warnings: `node_modules/expo/node_modules/@expo/cli/build/src/lint/lintAsync.js:153-155`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dodaj ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków. Zobacz `references/progress-format.md`.

### Faza 1: Bramka lokalna `npm run gate`

#### Automatyczne

- [x] 1.1 `npm run gate` na czystym drzewie → exit 0; „Generating: tsconfig.json”, wynik ESLint, „11 passed” w wyjściu — bf8202e
- [x] 1.2 `npm run typecheck` (root) → exit 0; `git status --short` → tylko `package.json` — bf8202e
- [x] 1.3 Deliberate-break lint (`src/__gate_probe__.tsx`) → exit ≠ 0 bez podsumowania vitest; po usunięciu → 0 — bf8202e
- [x] 1.4 Deliberate-break tsc front (`src/__gate_probe__.tsx`, TS2322) → exit ≠ 0 bez vitest; po usunięciu → 0 — bf8202e
- [x] 1.5 Deliberate-break tsc api (`api/src/__gate_probe__.ts`) → exit ≠ 0 bez vitest; po usunięciu → 0 — bf8202e
- [x] 1.6 Deliberate-break test api (`api/src/lib/__gate_probe__.test.ts`, 1 failed) → exit ≠ 0; po usunięciu → 0 — bf8202e
- [x] 1.7 Świeży checkout: usunięte `expo-env.d.ts` + `.expo/types/` → `npm run gate` exit 0, pliki odtworzone, git czysty poza `package.json` — bf8202e
- [x] 1.8 `git diff --name-only HEAD` = `package.json`; commit `chore(testing-quality-gates): … (p1)` — bf8202e

#### Ręczne

- [ ] 1.9 Interaktywny PowerShell bez `CI=1`: `npm run gate` bez pytań, ~20–30 s, `$LASTEXITCODE` = 0

### Faza 2: Checklista deployu (ryzyko #4) + odsyłacze

#### Automatyczne

- [x] 2.1 `context/deployment/deploy-checklist.md` istnieje; `migrations apply` przed `wrangler deploy`; zawiera „0006” i „rollback” — 1244f64
- [x] 2.2 `deploy-checklist.md` podlinkowany z `deploy-plan.md` i `CLAUDE.md`; `deploy-plan.md` ma linię `migrations apply` — 1244f64
- [x] 2.3 `CLAUDE.md`: 0 × „Brak skonfigurowanych testów”, ≥ 1 × `npm run gate`; blok „## 10xDevs AI Toolkit” nietknięty — 1244f64
- [x] 2.4 `npm run gate` → exit 0 — 1244f64
- [x] 2.5 `git diff --name-only HEAD` = `CLAUDE.md`, `context/deployment/deploy-plan.md`, `context/deployment/deploy-checklist.md`; commit `docs(testing-quality-gates): … (p2)` — 1244f64

#### Ręczne

- [ ] 2.6 `wrangler login` + `d1 migrations list --remote`: czeka dokładnie 0005 (rejestr długu zgodny)
- [ ] 2.7 Checklista przejściona naprawdę: 0005 `apply --remote` → `deploy` → `/health` 200 → smoke Manual S-05 na produkcji; rejestr odhaczony

### Faza 3: test-plan §5/§6.8/§6.7 + zamknięcie

#### Automatyczne

- [x] 3.1 0 × „required after §3 Phase 4” i 0 × „recommended after §3 Phase 4” w `test-plan.md`
- [x] 3.2 `### 6.8` istnieje; ≥ 3 × `npm run gate` w `test-plan.md`
- [x] 3.3 Hunki diffu `test-plan.md` wyłącznie w §5, §6.7, §6.8, `Last updated`, §8
- [x] 3.4 `npm run gate` → exit 0
- [ ] 3.5 `git diff --name-only HEAD` = `test-plan.md`, `change.md` (status `implemented`); commit `docs(testing-quality-gates): … (p3)`

#### Ręczne

- [ ] 3.6 §6.8 przeczytane na świeżo: wystarcza do uruchomienia bramki na świeżym checkout i interpretacji czerwonego

<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Faza 4 wdrożenia testów — bramki jakości (`npm run gate` + checklista deployu)

- **Plan**: context/changes/testing-quality-gates/plan.md
- **Zakres**: Fazy 1–3 z 3 (pełny przegląd planu; commity bf8202e, 1244f64, d1e8ca6, 41fbc04)
- **Data**: 2026-09-09
- **Werdykt**: ZAAKCEPTOWANY
- **Ustalenia**: 0 krytycznych, 2 ostrzeżenia, 5 obserwacji

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność z planem | PASS — 8/8 pozycji MATCH (F1 #1; F2 #1–#3; F3 #1–#4) |
| Dyscyplina zakresu | PASS — diff = `package.json` (2 linie skryptów), `CLAUDE.md` (2 hunki nad blokiem lekcji), `deploy-plan.md`, `deploy-checklist.md`, `test-plan.md` (§5/§6.7/§6.8/§8) + artefakty zmiany; brak zależności, `.github/`, hooków, root `npm test` |
| Bezpieczeństwo i jakość | WARNING (2 ustalenia, oba naprawione w przeglądzie) |
| Architektura | PASS |
| Spójność wzorców | PASS (obserwacja F7 bez działania) |
| Kryteria sukcesu | PASS — wszystkie wiersze Automated ponownie uruchomione 2026-09-09; Manual 1.9, 2.6, 2.7, 3.6 oczekujące (bez podpisów na ślepo) |

## Automatyczna weryfikacja (uruchomiona w przeglądzie)

- `npm run gate` → exit 0 (customize → lint --max-warnings 0 → tsc → api typecheck → api test: 11 plików, 103 + 5 expected fail); `npm run typecheck` → exit 0
- checklista: `4. … migrations apply` linia 19 < `5. … wrangler deploy` linia 21; „0006” ×1; „rollback” ×4; odsyłacze w `deploy-plan.md` ×2 i `CLAUDE.md` ×2; `migrations apply` w `deploy-plan.md` ×1
- `CLAUDE.md`: 0 × „Brak skonfigurowanych testów”, 1 × `npm run gate`; hunki `@@ -14 +14,4` i `@@ -41 +44` (blok „## 10xDevs AI Toolkit” nietknięty)
- `test-plan.md`: 0/0 × „required/recommended after §3 Phase 4”; `### 6.8` ×1; `npm run gate` ×7; hunki `-130`, `-133`, `-139`, `+270,21`, `-283`
- Agent 2 zweryfikował w `@expo/cli` 56: `--max-warnings 0` i `=0` oba akceptowane (`utils/variadic.js`), `customize tsconfig.json` bez promptu, brak TTY/sieci/sekretów w bramce; wrangler 4.95: `d1 migrations list … --remote`, `rollback [version-id]`, `versions list` istnieją; CR bytes 0 przed/po w `CLAUDE.md`, `package.json`, `test-plan.md`; 8 ścieżek cytowanych w checkliście istnieje.

## Ustalenia

### F1 — `wrangler rollback` w checkliście jest interaktywny bez `--yes -m`

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: context/deployment/deploy-checklist.md:36
- **Szczegóły**: `npx wrangler rollback [VERSION_ID]` bez `-y/--yes` i `-m/--message` pyta o potwierdzenie i powód; checklista flaguje `login` jako niebezpieczny w powłoce nieinteraktywnej, a `infrastructure.md:80` przypisuje rollback agentowi. `versions list` pokazuje 10 ostatnich.
- **Poprawka**: dopisać `--yes -m "<powód>"` i notkę o interaktywności.
- **Decyzja**: FIXED (w przeglądzie, 2026-09-09)

### F2 — Krok 1 bramki może doinstalować zależności i połknąć błąd przy niepełnym `node_modules`

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: package.json:48 (krok `expo customize tsconfig.json`)
- **Szczegóły**: `customize/typescript.js` wywołuje `TypeScriptProjectPrerequisite.bootstrapAsync({ skipPrompt: true, isProjectMutable: true })` — gdy `typescript`/`@types/react` nie rozwiązują się, `expo install` doinstalowuje je bez pytania (sieć, mutacja `package.json`/lockfile), a wyjątek jest logowany i połykany (exit 0). Po pełnym `npm ci` nieszkodliwe; przy niepełnym `node_modules` „sprawdzenie” staje się mutacją.
- **Poprawka A ⭐ Zalecana**: udokumentować w §6.8 warunek „po `npm ci`” i zalecić `EXPO_NO_TYPESCRIPT_SETUP=1` w CI (pomija tylko bootstrap zależności; `startTypeScriptServices` nadal generuje typy).
  - Siła: zero zmian w skrypcie; CI dostaje deterministyczny krok.
  - Kompromis: zależy od tego, że czytelnik §6.8 zastosuje flagę.
  - Pewność: HIGH — kod `@expo/cli` przeczytany przez agenta 2.
  - Martwy punkt: nie uruchomiono bramki z `EXPO_NO_TYPESCRIPT_SETUP=1` — zweryfikować przy podłączaniu CI.
- **Poprawka B**: wpisać flagę na stałe do skryptu (`cross-env EXPO_NO_TYPESCRIPT_SETUP=1 expo customize …`).
  - Siła: działa wszędzie bez pamiętania.
  - Kompromis: składnia `VAR=x cmd` nie działa w cmd.exe — wymagałoby `cross-env` (nowa zależność, zakazana w planie).
  - Pewność: MEDIUM.
  - Martwy punkt: brak.
- **Decyzja**: FIXED via Fix A (w przeglądzie, 2026-09-09)

### F3 — §6.7: „`git status` czysty” jest warunkowe

- **Ważność**: 💡 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: context/foundation/test-plan.md:273
- **Szczegóły**: czystość gita po `expo customize` zależy od tego, że `tsconfig.json#include` i `.gitignore` już mają wpisy; na innym checkout krok dopisuje je do śledzonych plików (samonaprawa, ale brudzi drzewo CI).
- **Poprawka**: doprecyzować warunek w notatce.
- **Decyzja**: FIXED (w przeglądzie, 2026-09-09)

### F4 — Brak przypiętej wersji Node dla CI

- **Ważność**: 💡 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: package.json (brak `engines`), test-plan.md:139-141
- **Szczegóły**: brak `engines`/`.node-version`; lokalnie Node 24.16, SDK 56 wymaga ≥ 20.19. Wzmianka o `npm ci` w §5 nie nazywa wersji Node. Jedyne wyjście sieciowe bramki to telemetria Expo (`EXPO_NO_TELEMETRY=1`).
- **Poprawka**: jedna linia w §6.8 (dodana) + `engines`/`.node-version` przy podłączaniu CI → `follow-ups/ci-node-version-and-deploy-record-pii.md`.
- **Decyzja**: FIXED (notka w §6.8) + DEFERRED (`engines` w follow-upie)

### F5 — `change.md`: „kody wyjścia w Postępie 1.3–1.7” — są w §6.7

- **Ważność**: 💡 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Zgodność z planem
- **Lokalizacja**: context/changes/testing-quality-gates/change.md:21
- **Szczegóły**: wiersze Postępu 1.3–1.7 mają „exit ≠ 0” + SHA; faktyczne kody (1, 2, 2, 1, 0) są w test-plan §6.7. Treść nie ginie, wskazanie było niedokładne.
- **Poprawka**: przeredagować zdanie w epilogu.
- **Decyzja**: FIXED (w przeglądzie, 2026-09-09)

### F6 — Rekord deployu zawiera e-mail i account ID Cloudflare (stan sprzed zmiany)

- **Ważność**: 💡 OBSERWACJA
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: context/deployment/deploy-plan.md:28
- **Szczegóły**: nowa checklista nie dodaje żadnych sekretów/PII (tylko publiczny URL `/health`); para e-mail + account ID w `deploy-plan.md` istniała wcześniej i jest poza zakresem zmiany. Nie są to sekrety, ale przy upublicznieniu repo warto je usunąć.
- **Poprawka**: decyzja użytkownika → `follow-ups/ci-node-version-and-deploy-record-pii.md`.
- **Decyzja**: DEFERRED (follow-up)

### F7 — Frontmatter i nagłówek checklisty różnią się od sąsiadów; §6.8 ma klucze runbooka, nie przepisu

- **Ważność**: 💡 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: context/deployment/deploy-checklist.md:1-7; context/foundation/test-plan.md:278-289
- **Szczegóły**: klucze `project/updated/source` vs `project/deployed_at/platform/status` w `deploy-plan.md`; H1 vs H2; §6.8 używa Command/Fresh checkout/Reading red zamiast Location/Naming/Reference — celowo, bo to nie przepis na test; `Reguły`/`Uwaga` wspólne.
- **Poprawka**: brak — akceptowalne dla runbooka.
- **Decyzja**: ACCEPTED

## Uwagi

- Wątpliwość agenta 1 co do „1 failed | 103 passed” w §6.7: pełne wyjście vitest w Fazie 1 brzmiało `Tests 1 failed | 103 passed | 5 expected fail (109)` — zapis poprawny (pominięto tylko człon `expected fail`). DISMISSED.
- Otwarte wiersze Manual (lista kontrolna dla człowieka): 1.9, 2.6, 2.7, 3.6 — w tym deploy migracji 0005 na produkcję wg `context/deployment/deploy-checklist.md`.

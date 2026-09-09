---
change_id: testing-quality-gates
title: "Faza 4 testów: bramki jakości (jedno lokalne polecenie lint + typecheck + testy API, checklista deployu)"
status: archived
created: 2026-09-09
updated: 2026-09-09
archived_at: 2026-09-09T15:01:03Z
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Bramki jakości".
Risks covered: cross-cutting (podłoga pod #1–#6; bezpośrednio Risk #4 przez checklistę migracja → deploy).
Test types planned: gates — jedno lokalne polecenie (lint + typecheck front i api + testy API) oraz checklista deployu; CI tylko nazwane (konfiguracja YAML należy do lekcji CI), post-edit hook tylko zalecany (Lekcja 3).
Risk response intent:
- Bramka lokalna: jedno polecenie z katalogu głównego uruchamia `expo lint`, `tsc --noEmit` (front), `npm run typecheck` i `npm test` (api) i kończy się niezerowym kodem, gdy którakolwiek warstwa pada — dowód: deliberate-break w każdej warstwie osobno obala polecenie. Kwestionować: „skrypty już istnieją, wystarczy je wypisać w README”; „typed routes w `.expo/` są zawsze na dysku” (na świeżym checkout `tsc` wymaga wcześniej `expo start`). Unikać: bramki, która przechodzi, bo `&&` nie propaguje kodu wyjścia w PowerShell/npm na Windows; bramki, która cicho pomija warstwę przy braku narzędzia.
- Checklista pre-deploy (Risk #4): udokumentowana i wykonywalna kolejność `wrangler d1 migrations apply my-english-day-db --remote` → `wrangler deploy`, z wpisem o migracji 0005 czekającej na produkcję; kwestionować „addytywne migracje = kolejność nieważna”; unikać testu tekstu SQL migracji i migawek `PRAGMA`.
- §5 tabela bramek: po wdrożeniu wiersze „required after §3 Phase 4” przechodzą na `required` z nazwą polecenia; §6 dostaje wzorzec „jak uruchomić pełną bramkę przed commitem/deployem”.
After creating the folder, follow the downstream continuation rule.

Faza zamknięta 2026-09-09; dostarczono: skrypty `gate` i `typecheck` w root `package.json` (customize → lint --max-warnings 0 → tsc → api typecheck → api test, ≈ 20 s; pięć deliberate-breaków — wiersze Postępu 1.3–1.7, kody wyjścia w test-plan §6.7, bf8202e); `context/deployment/deploy-checklist.md` z kolejnością migracja D1 → Worker, rollbackiem i rejestrem długu migracyjnego (0005 → produkcja, następna 0006), odsyłacze w `deploy-plan.md` i `CLAUDE.md` (1244f64); test-plan §5 `required — npm run gate`, §6.8 pełna bramka, notatka §6.7 Faza 4, §8. Ręcznie zostało: 1.9 (bramka w interaktywnym PowerShell), 2.6 (`wrangler login` + `d1 migrations list --remote`), 2.7 (deploy 0005 na produkcję wg checklisty + smoke S-05), 3.6 (§6.8 przeczytane na świeżo).

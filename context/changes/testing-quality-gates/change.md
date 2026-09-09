---
change_id: testing-quality-gates
title: "Faza 4 testów: bramki jakości (jedno lokalne polecenie lint + typecheck + testy API, checklista deployu)"
status: preparing
created: 2026-09-09
updated: 2026-09-09
archived_at: null
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

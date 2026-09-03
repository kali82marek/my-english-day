---
change_id: testing-worker-harness-background-jobs
title: Faza 1 wdrożenia testów: harness Workerów i zadania w tle
status: implementing
created: 2026-09-03
updated: 2026-09-03
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Harness Workerów + zadania w tle".
Risks covered: #1 Nagranie cicho przepada (wieczny `pending` po ubitym zadaniu tła lub goły 500 z osieroconym audio), #2 Wieczorem brak fiszek lub połowa (ciche `failed` generowania lub częściowe wiersze przy błędzie w środku zapisu), #4 Nowy Worker na starej bazie produkcyjnej (kod wymienia kolumnę, której migracja nie utworzyła).
Test types planned: integration (workerd przez @cloudflare/vitest-plugin, izolowane D1 z migracjami z api/migrations/, mock OpenAI na krawędzi sieci; obecny harness `node` w api/vitest.config.ts nie obejmuje bindingów).
Risk response intent:
- #1: udowodnić, że nieudana lub ubita transkrypcja kończy się widocznym `failed` w ograniczonym czasie, nigdy wiecznym `pending`, a nieudany zapis zwraca czytelny błąd bez osieroconego audio; zakwestionować „201 + zadanie tła = rekord się sfinalizuje" i „60 s limit w kliencie to załatwia"; unikać testu tylko szczęśliwej ścieżki i mockowania D1/R2 od środka.
- #2: udowodnić, że po udanej transkrypcji albo wszystkie karty są propozycjami i stan generowania to `done`, albo zero kart i `failed`, nigdy część kart + `failed`, a transkrypt nigdy nie ginie przez błąd generowania; zakwestionować „`done` implikuje, że karty istnieją" i „Structured Outputs gwarantuje niepustą listę"; unikać testu przechodzącego tylko przez odbicie implementacji batcha (follow-up DB.batch z archive S-03 jest otwarty).
- #4: udowodnić, że migracje aplikują się od zera po kolei, a zapytania kodu działają na schemacie zbudowanym wyłącznie z migracji, więc Worker wymieniający nieistniejącą kolumnę obala suite przed deployem; zakwestionować „addytywne = kolejność nieważna" i „lokalne D1 == produkcyjne D1"; unikać snapshotu PRAGMA table_info.
After creating the folder, follow the downstream continuation rule (next natural command: /10x-research).

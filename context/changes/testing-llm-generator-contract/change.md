---
change_id: testing-llm-generator-contract
title: "Faza 3 testów: kontrakt generatora LLM (zdegenerowana odpowiedź modelu nie przecieka do bazy ani UI)"
status: new
created: 2026-09-07
updated: 2026-09-07
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Kontrakt generatora LLM".
Risks covered: #5 (Zmiana promptu, schematu lub modelu psuje kontrakt po cichu: nieznany `type`, brak flagi wariantu, pusta lista lub 30 kart przeciekają do bazy i UI, etykieta typu `undefined`; źródła: PRD FR-006, FR-007; roadmap S-04 dotknie generatora; archive S-02 review F2 (brak CHECK na enumach), S-03 review F2; churn `api/src/lib/` 12 commitów).
Test types planned: unit/contract z mockiem fetch (rozszerzenie istniejących testów generatora); bez sędziego LLM, bez nowej infrastruktury — harness z Fazy 1 (test-plan §6.1/§6.2) już istnieje.
Risk response intent:
- #5: dla zdegenerowanej odpowiedzi modelu (nieznany `type`, brak flagi wariantu, pusta lista, 30 kart, pusty front) generator odrzuca (job → `failed`, zero wierszy w bazie) lub przycina deterministycznie; żądanie do modelu zawsze niesie ścisły schemat z polami wymaganymi. Kwestionować: „strict:true po stronie API = nie trzeba kodu obronnego”; „jakość treści = kontrakt” (treść jest poza zakresem, §7). Unikać: asercji dokładnego tekstu promptu (blokuje iterację promptu); sędziego LLM oceniającego angielski; wyroczni zaczerpniętej z implementacji parsera (oczekiwane wartości mają pochodzić z PRD FR-006/FR-007 i schematu produktu).
Cookbook target: ostatnia podfaza planu wypełnia §6.5 „Adding a generator contract test (odpowiedź LLM → dane)”.
After creating the folder, follow the downstream continuation rule.

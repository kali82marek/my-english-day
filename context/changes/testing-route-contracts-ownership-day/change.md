---
change_id: testing-route-contracts-ownership-day
title: Faza 2 testów: kontrakty tras (własność, izolacja, dzień lokalny)
status: implementing
created: 2026-09-04
updated: 2026-09-04
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Kontrakty tras: własność, izolacja, dzień".
Risks covered: #3 (Cudze dane / IDOR: zalogowany użytkownik z cudzym id odczytuje, akceptuje lub kasuje nie swoją sytuację/fiszkę, albo lista zwraca cudze wiersze), #6 (Dzień liczony w UTC: sytuacja nagrana późnym wieczorem w Polsce ląduje w „wczoraj"/„jutro"; lista dnia i licznik „generuję…" kłamią między północą lokalną a 01:00–02:00, dwa razy w roku inaczej przez DST).
Test types planned: integration na poziomie tras (dwóch zasianych użytkowników, kontrolowany czas i strefa) w istniejącym harnessie workerd z izolowanym D1 z migracjami (produkt Fazy 1, zob. test-plan §6.2).
Risk response intent:
- #3: przy danych dwóch użytkowników każdy endpoint odczytu/mutacji zwraca 404 lub pustą listę dla cudzych id; bez tokena 401 przed dotknięciem bazy; DTO nie wycieka user_id, klucza audio ani flagi wariantu. Kwestionować: „requireAuth na routerze = własność wymuszona"; „404 z planu jest utrzymane w nowych endpointach S-04/S-05". Unikać: tylko własny użytkownik (szczęśliwa ścieżka); asercja, że tekst SQL zawiera user_id (lustro implementacji).
- #6: sytuacja nagrana 23:30 czasu Warszawy jest na liście „dziś" i liczy się jako „generuję" do lokalnej północy, nie do północy UTC; zachowanie trzyma się przez DST. Kwestionować: „date('now') to dziś"; „użytkownicy są tylko w PL, hardkod wystarczy" (decyzja PENDING; test koduje zachowanie z PRD, nie wybraną poprawkę). Unikać: asercja obecnego wyniku UTC (problem wyroczni); zamrożony offset w asercji.
After creating the folder, follow the downstream continuation rule.

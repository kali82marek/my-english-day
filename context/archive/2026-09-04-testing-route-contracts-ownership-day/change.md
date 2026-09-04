---
change_id: testing-route-contracts-ownership-day
title: Faza 2 testów: kontrakty tras (własność, izolacja, dzień lokalny)
status: archived
created: 2026-09-04
updated: 2026-09-04
archived_at: 2026-09-04T16:59:48Z
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Kontrakty tras: własność, izolacja, dzień".
Risks covered: #3 (Cudze dane / IDOR: zalogowany użytkownik z cudzym id odczytuje, akceptuje lub kasuje nie swoją sytuację/fiszkę, albo lista zwraca cudze wiersze), #6 (Dzień liczony w UTC: sytuacja nagrana późnym wieczorem w Polsce ląduje w „wczoraj"/„jutro"; lista dnia i licznik „generuję…" kłamią między północą lokalną a 01:00–02:00, dwa razy w roku inaczej przez DST).
Test types planned: integration na poziomie tras (dwóch zasianych użytkowników, kontrolowany czas i strefa) w istniejącym harnessie workerd z izolowanym D1 z migracjami (produkt Fazy 1, zob. test-plan §6.2).
Risk response intent:
- #3: przy danych dwóch użytkowników każdy endpoint odczytu/mutacji zwraca 404 lub pustą listę dla cudzych id; bez tokena 401 przed dotknięciem bazy; DTO nie wycieka user_id, klucza audio ani flagi wariantu. Kwestionować: „requireAuth na routerze = własność wymuszona"; „404 z planu jest utrzymane w nowych endpointach S-04/S-05". Unikać: tylko własny użytkownik (szczęśliwa ścieżka); asercja, że tekst SQL zawiera user_id (lustro implementacji).
- #6: sytuacja nagrana 23:30 czasu Warszawy jest na liście „dziś" i liczy się jako „generuję" do lokalnej północy, nie do północy UTC; zachowanie trzyma się przez DST. Kwestionować: „date('now') to dziś"; „użytkownicy są tylko w PL, hardkod wystarczy" (decyzja PENDING; test koduje zachowanie z PRD, nie wybraną poprawkę). Unikać: asercja obecnego wyniku UTC (problem wyroczni); zamrożony offset w asercji.
After creating the folder, follow the downstream continuation rule.

Faza zamknięta 2026-09-04 (5 faz: helpery harnessu, macierz 401, własność i DTO per trasa, ryzyko #6 jako `it.fails`, książka kucharska §6.3/§6.4/§6.7). Follow-up otwarty: `follow-ups/local-day-boundary.md` (granica dnia lokalnego — Fix A / Fix B bez wyboru; T6.1 jako `it.fails` do decyzji S-01 F1 / S-02 F4). Chronionych tras jest 7 (nie 8, jak w briefie i podsumowaniu badania) — T3.3 pilnuje liczby. Zero zmian w kodzie produkcyjnym.

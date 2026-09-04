# Follow-up: granica dnia lokalnego (lista dnia i licznik „generuję…" liczą dzień w UTC)

- **Źródło**: `context/foundation/test-plan.md` §2 ryzyko #6 („dzień liczony w UTC");
  przegląd S-01 F1 ⚠️ „Lista dnia liczy dzień w UTC, nie w strefie użytkownika"
  (`context/archive/2026-06-07-capture-situation-by-voice/reviews/impl-review.md`, Fix A ⭐ /
  Fix B, **Decision: PENDING** od 2026-06-07); przegląd S-02 F4 🔭 „`generatingCount` liczy
  tylko dzień bieżący" (`context/archive/2026-06-07-gated-ai-flashcard-generation/reviews/impl-review.md`,
  wzorzec powielony, **Decision: PENDING**). Wyrocznia z PRD: `context/foundation/prd.md:44-46`
  (US-01 „wieczorem widzi wygenerowane fiszki"), `:71` (FR-006 „z zapisanych sytuacji dnia"),
  `:79` (FR-009 „propozycje fiszek dnia"), `:101` („wieczorem otwiera aplikację, widzi gotowe
  propozycje fiszek z sytuacji dnia"). PRD nie wymienia ani „UTC", ani strefy — „dzień" jest
  dniem użytkownika.
- **Zakodowane jako**: `describe('Ryzyko #6: dzień liczony w UTC')` w
  `api/src/routes/situations.integration.test.ts` — tabela `DAY_CASES` (8 wierszy, 4 daty
  po obu stronach obu przejść DST × 2 kierunki): **T6.1** `it.fails.each` (4 wiersze
  inkluzji: „nagranie po lokalnej północy, przed północą UTC, jest na liście «dziś» i liczy
  się jako generujące") i **T6.2** `it.each` (4 wiersze ekskluzji: „nagranie 23:30 czasu
  Warszawy po lokalnej północy nie jest na liście «dziś» i nie liczy się"). T6.1 jest
  czerwony z definicji, dopóki dzień liczy SQL `date('now')` — nie wolno go zamienić na
  `it.skip` ani usunąć. Wiersz z tabeli, który dziś **przechodzi**, oznacza zepsuty zasiew
  lub odczyt (test właściwości „zasiew z jawnym czasem zapisuje 1:1" w
  `api/test/harness.test.ts`), nie powód do zmiany modyfikatora.
- **Status**: otwarty (decyzja produktowa poza zmianą `testing-route-contracts-ownership-day`;
  plan §„Czego NIE robimy").

## Wyrocznia

Dzień użytkownika to dzień kalendarzowy w `Europe/Warsaw` (jedyna strefa użytkowników MVP;
PRD nie zna innej). Sytuacja nagrana o 23:30 czasu Warszawy jest na liście „dziś"
(`GET /situations`) i liczy się jako „generuję…" (`generatingCount` w
`GET /flashcards/proposals`) **do lokalnej północy**, nie do północy UTC — po obu stronach
obu przejść DST (CET→CEST ostatnia niedziela marca 01:00Z, CEST→CET ostatnia niedziela
października 01:00Z). Nagranie z 00:30 lokalnie należy do nowego dnia, choć w UTC jest
jeszcze „wczoraj".

Wyrocznia złożona z regułą wieku `pending` (follow-up Fazy 1,
`context/archive/2026-09-03-testing-worker-harness-background-jobs/follow-ups/stale-pending-server-rule.md`):
**sytuacja generująca (`status = 'done'`, `flashcards_status = 'pending'`), młodsza niż
próg wieku, liczy się jako „generuję…" wtedy i tylko wtedy, gdy jej dzień lokalny to dziś.**
Lista dnia i licznik stosują **tę samą** regułę dnia (S-02 F4: licznik jest „spójny z
`GET /situations`" — po poprawce ma pozostać spójny, tylko z właściwym dniem).

Tabela wyroczni (te same wartości co `DAY_CASES` w teście; chwile policzone przez ICU,
Node 24, `Intl.DateTimeFormat` z `timeZone: 'Europe/Warsaw'`):

| Kierunek | Lokalny „dziś" | Nagranie (`created_at`, UTC) = czas lokalny | Odczyt (`now`, UTC) = czas lokalny | Oczekiwanie |
|---|---|---|---|---|
| A | 2026-03-28 (CET, dzień przed 03-29) | `2026-03-27 23:59:30` = 00:59:30 CET 03-28 | `2026-03-28T00:00:30Z` = 01:00:30 CET 03-28 | na liście, licznik 1 |
| A | 2026-03-30 (CEST, dzień po 03-29) | `2026-03-29 23:59:30` = 01:59:30 CEST 03-30 | `2026-03-30T00:00:30Z` = 02:00:30 CEST 03-30 | na liście, licznik 1 |
| A | 2025-10-25 (CEST, dzień przed 10-26) | `2025-10-24 23:59:30` = 01:59:30 CEST 10-25 | `2025-10-25T00:00:30Z` = 02:00:30 CEST 10-25 | na liście, licznik 1 |
| A | 2025-10-27 (CET, dzień po 10-26) | `2025-10-26 23:59:30` = 00:59:30 CET 10-27 | `2025-10-27T00:00:30Z` = 01:00:30 CET 10-27 | na liście, licznik 1 |
| B | 2026-03-28 | `2026-03-27 22:30:00` = 23:30 CET 03-27 | `2026-03-27T23:30:00Z` = 00:30 CET 03-28 | poza listą, licznik 0 |
| B | 2026-03-30 | `2026-03-29 21:30:00` = 23:30 CEST 03-29 | `2026-03-29T22:30:00Z` = 00:30 CEST 03-30 | poza listą, licznik 0 |
| B | 2025-10-25 | `2025-10-24 21:30:00` = 23:30 CEST 10-24 | `2025-10-24T22:30:00Z` = 00:30 CEST 10-25 | poza listą, licznik 0 |
| B | 2025-10-27 | `2025-10-26 22:30:00` = 23:30 CET 10-26 | `2025-10-26T23:30:00Z` = 00:30 CET 10-27 | poza listą, licznik 0 |

Jesienne przejście 2026 (2026-10-25) jest celowo pominięte: to przyszłość względem realnego
zegara, a zasiana data, którą realny `date('now')` dopiero osiągnie, przekręciłaby `it.fails`
w konkretny dzień roku. Reguły strefy są identyczne w 2025 i 2026, więc sygnał jest ten sam.
Wszystkie daty tabeli muszą pozostać w przeszłości.

## Opcje poprawki (bez wyboru — decyzja produktowa)

Obie opcje przenoszą decyzję o dniu z SQL `date('now')` (realny UTC, niekontrolowalny
z testu) do JS, przez co `vi.setSystemTime` + zasiew `created_at` w UTC stają się
wystarczającą dźwignią i T6.1 zmienia się z `it.fails` na `it` **bez przepisywania asercji**.
Obie muszą objąć **oba** zapytania: listę dnia (`GET /` w `api/src/routes/situations.ts`)
i licznik `generatingCount` (`GET /proposals` w `api/src/routes/flashcards.ts`).

1. **Fix A — klient przekazuje granice dnia lokalnego** (przegląd S-01: ⭐ w chwili
   przeglądu). Klient liczy `[start, koniec)` lokalnego dnia w strefie urządzenia i wysyła je
   (query param lub nagłówek); serwer filtruje zakresem `created_at >= ? AND created_at < ?`
   w UTC. Zalety: poprawne dla każdej strefy, bez hardkodu. Blind spot: zaufanie zegarowi i
   strefie klienta (błędny zegar telefonu = błędny dzień; parametr z zewnątrz trzeba
   walidować). Skutek testowy: **jeden** helper w `api/test/request.ts` (`getSituations`,
   `getProposals`) liczy granice z `Date.now()` i jawnego `timeZone: 'Europe/Warsaw'` przez
   `Intl` — kształt żądania żyje wyłącznie tam, asercje T6.x bez zmian. Zmiana kontraktu
   `GET` po stronie frontu (`src/lib/api.ts`).
2. **Fix B — serwer liczy dzień w `Europe/Warsaw`**. Serwer wyznacza granice lokalnego dnia
   z `Date.now()` przez `Intl.DateTimeFormat` z **jawnym** `timeZone: 'Europe/Warsaw'`
   (DST z ICU, nie stały offset) i filtruje tym samym zakresem w UTC. Zalety: zero zmian
   klienta i kontraktu, jedno miejsce, testowalne przez `vi.setSystemTime`. Blind spot:
   użytkownicy poza Polską dostają dzień warszawski; jawny `timeZone` jest obowiązkowy,
   bo izolat na Windows i tak jest w Warszawie (test bez strefy przeszedłby lokalnie i padł
   w CI). Skutek testowy: żaden poza zmianą modyfikatora T6.1.

Bez rekomendacji w tym follow-upie: wybór zależy od tego, czy produkt zakłada użytkowników
poza PL (PRD milczy; §2 planu testów: „użytkownicy są tylko w PL, hardkod wystarczy" to
założenie do zakwestionowania, nie fakt). Stały offset (+1/+2) nie jest opcją — łamie się
dwa razy w roku, T6.2 to wyłapie.

## Przenośność (reguły dla poprawki i testów)

- SQL `now` w D1 (`date('now')`, DEFAULT `datetime('now')`) to **zawsze realny UTC**;
  `vi.setSystemTime` steruje wyłącznie `Date` w JS izolatu. Jedyną dźwignią czasu po stronie
  SQL jest jawny `created_at` (`seedSituation`/`toSqlDatetime` w `api/test/db.ts`).
- Strefa izolatu jest nieprzenośna: na Windows plugin 1.1.3 nie przekazuje `TZ` i izolat
  raportuje strefę hosta (Warszawa); na Linux/CI i w prod — UTC. Kod i testy: tylko
  `toISOString()`/UTC albo jawny `timeZone` w `Intl`; **nigdy** `getHours()`, `getDate()`,
  `toLocale*` bez `timeZone`, nigdy `getTimezoneOffset()`.
- `vi.setSystemTime` przecieka między testami w pliku; `vi.restoreAllMocks()` z
  `api/test/setup.ts` go nie cofa — każdy `describe` z `setSystemTime` ma własne
  `afterEach(() => vi.useRealTimers())`.
- Nigdy `datetime('now', '-N seconds')` w testach dnia (okno północy UTC); daty tabeli
  absolutne i w przeszłości.

## Sprzężenie z regułą wieku `pending`

Oba filtry — wiek (follow-up Fazy 1, próg 2 min) i dzień (ten follow-up) — siedzą w **tych
samych dwóch zapytaniach** (lista dnia, licznik). Konsekwencje:

- T6.1 sieje nagranie w wieku dokładnie 60 s względem `now` (23:59:30 → 00:00:30) właśnie
  po to, by po wejściu reguły wieku wiersz nadal liczył się jako generujący; asercje T6.x
  nie zmienią wyniku po realizacji reguły wieku.
- T1.3 (`it.fails`, 150 s `pending` → `failed`) po zmianie na `it` musi uwzględnić dzień:
  zasiew sprzed 150 s przez ~2,5 min po lokalnej (po poprawce) lub UTC (dziś) północy
  wypada z listy dnia. Rozwiązanie: zasiew w obrębie dnia (`created_at` przesunięty tylko
  wewnątrz bieżącego dnia) albo asercja przez bezpośredni odczyt D1.
- Kolejność realizacji jest dowolna, ale slice realizujący jedną regułę powinien
  dopisać drugą do tych samych zapytań albo jawnie zostawić drugi follow-up otwarty.

## Kryterium zamknięcia

- T6.1 w `api/src/routes/situations.integration.test.ts` zmienione z `it.fails.each` na
  `it.each` i zielone (4 wiersze); T6.2 nadal zielone (4 wiersze).
- Przy Fix A: kształt żądania (granice dnia) dodany wyłącznie w `api/test/request.ts`;
  asercje T6.x nietknięte. Przy Fix B: `timeZone` jawny w kodzie serwera.
- `cd api && npm test` zielone w całości (bez nowych `it.fails`).
- Wpis w `context/foundation/test-plan.md` §6.7 o realizacji i wybranej opcji; §6.4
  zaktualizowane, jeśli dźwignia testowa się zmieniła.

## Sugerowany moment

Slice rozstrzygający S-01 F1 — najbliższy dotykający `api/src/routes/situations.ts`
(np. S-04 `duplicate-card-filtering`) — albo osobny chore po zamknięciu Fazy 2 wdrożenia
testów, najlepiej razem z regułą wieku `pending` (te same dwa zapytania). Nie realizować w
zmianie `testing-route-contracts-ownership-day` (plan §„Czego NIE robimy").

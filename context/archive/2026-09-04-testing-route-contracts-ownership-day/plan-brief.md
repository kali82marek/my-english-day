# Faza 2 wdrożenia testów: kontrakty tras (własność, izolacja, dzień lokalny) — Krótki plan

> Pełny plan: `context/changes/testing-route-contracts-ownership-day/plan.md`
> Badania: `context/changes/testing-route-contracts-ownership-day/research.md`

## Co i dlaczego

Piszemy na harnessie workerd z Fazy 1 testy integracyjne tras, które dowodzą ryzyka #3 z
`test-plan.md` §2 (cudze dane / IDOR) na każdej z 7 chronionych tras i kodują wyrocznię PRD dla
ryzyka #6 (dzień liczony w UTC) jako `it.fails` z follow-upem. Własność jest dziś weryfikowana
wyłącznie ręcznie w zarchiwizowanych planach, DTO propozycji chroni tylko lista kolumn w `SELECT`,
a decyzje o dniu lokalnym (S-01 F1, S-02 F4) wiszą jako `PENDING` od czerwca.

## Punkt wyjścia

Harness: workerd + izolowane D1 z migracji, `seedUser`, mock OpenAI na krawędzi sieci, triggery
`RAISE(ABORT)`; 31 testów zielonych + 1 `it.fails`. Brakuje wywołania bez nagłówka, helperów
`DELETE`/`accept`/`me`, zasiewu z jawnym `created_at` (prywatny `seedPending` z `datetime('now',
'-N s')`) i sprzątania `vi.setSystemTime`. Własność siedzi w każdym `WHERE` (`user_id` jako string
przeciw INTEGER, działa przez afiniczność); 404 zamiast 403; `date('now')` w UTC w dwóch
zapytaniach; `vi.setSystemTime` nie rusza zegara SQLite; strefa izolatu na Windows = host, w CI UTC.

## Pożądany stan końcowy

Bez tokenu lub ze sfałszowanym tokenem każda chroniona trasa zwraca 401, a wiersze ofiary, bucket
i sieć są nietknięte (tripwire na zapisach). Dla dwóch użytkowników cudzy id → 404 z nietkniętym
wierszem, listy i licznik tylko własne, ponowna akceptacja → 404, DTO czterech odpowiedzi to
dokładnie klucze z `src/lib/api.ts` (bez `is_variant` nawet dla fiszki z `is_variant=1`). Nowa
trasa chroniona bez wiersza w macierzy obala test kompletności. Ryzyko #6: tabela ośmiu jawnych
chwil UTC dla czasów Warszawy po obu stronach obu przejść DST — 4 wiersze `it.fails`, 4 strażniki —
plus follow-up bez wyboru poprawki. §6.3 i §6.4 książki kucharskiej wypełnione; §1–§5 nietknięte.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
| --- | --- | --- | --- |
| Warstwa | Tylko integracja tras w workerd, dwóch użytkowników per test, realne D1 | Jedyny test, w którym konwersja string→INTEGER i `WHERE` są wykonywane naprawdę | Badania / brief |
| Układ plików | Macierz 401 obok middleware; własność/DTO w pliku każdej trasy; #6 w pliku `situations` | §6.2 „test obok modułu”, jeden `describe` na ryzyko; S-04/S-05 dopiszą wiersz w swoim pliku | Plan |
| Dowód „401 przed D1” | Skutek (401 JSON, wiersze ofiary, bucket, `fetch`) + tripwire `RAISE(ABORT)` na zapisach | Obserwowalne bez mockowania; łapie zapis no-op i middleware przeniesiony poniżej trasy | Plan |
| Warianty tokenu | 2: brak nagłówka, token z innym sekretem | Kryptografię pokrywa `jwt.test.ts`; §7 zakazuje rozszerzania prymitywów auth | Badania / test-plan §7 |
| Kompletność macierzy | Test porównujący tabelę z `app.routes` | Zamyka „404 utrzymane w nowych endpointach S-04/S-05” bez czytania kodu przy każdym slice'u | Plan |
| DTO | Dokładny zbiór kluczy z `dto.ts` powiązany typem `Record<keyof DTO, true>` z lustrem `src/lib/api.ts` | Łapie każdy addytywny wyciek; wzorcem jest kontrakt z frontem, nie implementacja | Badania / Plan |
| Ryzyko #6 | `it.fails.each` 4 wiersze inkluzji + `it.each` 4 strażniki ekskluzji; bez Fix A/B | Pod realnym `date('now')` tylko inkluzje padają — `it.fails` na wierszu przechodzącym zgłasza błąd | Badania / Plan |
| Daty tabeli DST | 2026-03-28/30 i **2025**-10-25/27 | Jesień 2026 jest w przyszłości: zasiew zrównałby się z realnym dniem dwa razy w roku | Plan |
| Sprzężenie z regułą wieku | Wiersze „liczy się” mają wiek 60 s | Follow-up Fazy 1 obejmie `generatingCount`; test ma być poprawny pod każdą kolejnością obu poprawek | Badania / Plan |
| Obserwacje spoza ryzyk | Notatka w §6.7, bez testów i follow-upów | Token usuniętego usera, text/plain 404, brak `exp` — żadne nie jest top-6 | Plan |
| Kod produkcyjny | Zero zmian; czerwony test przed deliberate-break = powrót do `/10x-plan` | Badanie potwierdziło każde oczekiwanie #3; poprawka #6 to decyzja produktowa | brief / Badania |

## Zakres

**W zakresie:**
- Helpery: `call` bez nagłówka, `audioForm`, `deleteSituation`/`acceptFlashcard`/`deleteFlashcard`/`getMe`, `seedSituation`/`seedFlashcard`/`toSqlDatetime`, `readFlashcard`/`readSituationsOf`, `withWriteTripwire`, `dto.ts`; 2 testy właściwości harnessu
- Macierz 401 (7 × 2) + kompletność; T3.4–T3.9 własność/DTO; T6.1/T6.2; follow-up `local-day-boundary.md`
- §6.3, §6.4, notatka §6.7, `change.md`

**Poza zakresem:**
- Fix A/B dnia lokalnego, reguła wieku `pending`, zmiany klienta, jakikolwiek kod produkcyjny
- Token usuniętego użytkownika, text/plain 404, `exp`, `app.onError`, awarie R2, S-04/S-05
- Edycje §1–§5 planu testów (status §3 przestawia orkiestrator), CI, hooki, front, e2e

## Architektura / Podejście

Test → `call(env, { method, path, token?, body? })` (jedyne miejsce budujące `Request`) →
asercje na odpowiedzi → odczyt stanu ofiary (`readSituation`/`readFlashcard`/`readSituationsOf`,
`env.AUDIO_BUCKET.list()`). Zasiew przez `seedUser`/`seedSituation`/`seedFlashcard` z jawnym
`created_at`; tripwire przez `withTrigger`, sprzątany w `resetDb`. DTO porównywane z listami
kluczy w `dto.ts`. Ryzyko #6: zasiew UTC + `vi.setSystemTime(now)` + `afterEach(useRealTimers)`.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Helpery harnessu | `request.ts`/`db.ts`/`dto.ts`, `seedPending` usunięty, 2 testy właściwości | Refaktor T1.3/T1.4 zmienia semantykę wieku (musi zostać „N s przed realnym now”) |
| 2. Brama 401 | 7 × 2 przypadków + kompletność z `app.routes`; DB-A…DB-D | Kształt `app.routes` inny niż w sondzie → strażnik do przepisania, macierz bez zmian |
| 3. Własność i DTO | T3.4–T3.9 w trzech plikach tras, ramię kontrolne w każdym | Czerwony test przed deliberate-break = nieznana luka, powrót do planu |
| 4. Ryzyko #6 | T6.1 `it.fails.each` ×4, T6.2 ×4, follow-up | Wiersz T6.1 przechodzący dziś = zepsuty zasiew, nie „poprawka weszła” |
| 5. Książka kucharska | §6.3, §6.4, §6.7, `change.md` | Opis wzorca z badania zamiast tego, który powstał |

**Wymagania wstępne:** Node 24 i `npm` w `api/`; suite Fazy 1 zielone na `main`; port 3030
wolny do smoke'a w Fazie 3.
**Szacowany wysiłek:** ~2–3 sesje w 5 fazach (Fazy 2–3 najdłuższe: 15 + 6 testów z deliberate-breaks).

## Otwarte ryzyka i założenia

- Założenie: `app.routes` w Hono 4.12 po `app.route()` niesie pełne ścieżki, a wpisy middleware
  mają `method: 'ALL'` lub `handler === requireAuth` (sonda w Node; do potwierdzenia w izolacie).
- Założenie: `it.fails.each` działa w Vitest 4.1.11 (`fails` jest w łańcuchu, `each` czyta jego
  kontekst — z odczytu źródła, nie z uruchomienia).
- Założenie: `vi.setSystemTime` bez fake timers + `vi.useRealTimers()` w `afterEach` nie
  przecieka do kolejnych testów pliku (zweryfikowane w badaniu; T1.4/T3.x są tego strażnikami).
- Brief i podsumowanie badania mówią „8 tras chronionych” — jest 7; T3.3 pilnuje liczby.
- T6.2 jest dziś zielony z powodu odległej daty, nie reguły — pełny sygnał po poprawce dnia.

## Kryteria sukcesu (podsumowanie)

- `cd api && npm test` zielone z 5 expected-fail (T1.3 + 4× T6.1); każdy z nazwanych
  deliberate-breaks czerwieni dokładnie swój test; zero zmian poza `*.test.ts` i `api/test/`.
- Dodanie trasy bez wiersza w macierzy 401 obala suite; dopisanie `is_variant` do `SELECT`
  propozycji obala suite.
- §6.3 wystarcza, by bez kontekstu tej zmiany dodać test własności dla trasy S-04/S-05; §6.4 —
  by nie powtórzyć odkrycia „`setSystemTime` nie rusza SQL”.

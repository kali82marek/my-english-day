# Faza 3 wdrożenia testów: kontrakt generatora LLM — Krótki plan

> Pełny plan: `context/changes/testing-llm-generator-contract/plan.md`
> Badania: `context/changes/testing-llm-generator-contract/research.md`

## Co i dlaczego

Przypinamy kontrakt generatora fiszek (ryzyko #5 z `test-plan.md` §2) testami jednostkowymi
na mocku `fetch` i jednym blokiem integracyjnym, oraz zamykamy lukę, którą badanie ujawniło:
dziś karta z `type: 'idiom'` idzie z modelu prosto do bazy i do pustej plakietki na ekranie
Fiszki, brak flagi wariantu staje się cicho kartą bazową, a uszkodzony JSON czy odmowa modelu
kończą się `failed` przypadkowo. Zmiana promptu, schematu lub modelu (S-04 dotknie generatora)
ma czerwienić test, a nie psuć dane po cichu.

## Punkt wyjścia

Generator wysyła poprawny ścisły schemat, ale test przypina z niego tylko `strict` i
`is_variant`. Parser przycina do 10 i odsiewa puste, lecz nie waliduje ani `type`, ani
obecności pól, ani typu flagi; `refusal` i `finish_reason` nie są czytane. Baza nie ma `CHECK`
(S-02 F2 `PENDING`), trasa propozycji nie mapuje wierszy. Harness z Faz 1–2 istnieje; helper
`chatResponse` jest zduplikowany i nie umie dać odmowy ani nie-JSON-u. Suite: 63 testy.

## Pożądany stan końcowy

Usunięcie `enum`, pola z `required` lub `additionalProperties` ze schematu czerwieni T5.1.
Każda odpowiedź spoza kontraktu (obcy `type`, zła flaga, brak pola, nie-JSON, odmowa,
nie-tablica) kończy się **zamierzonym** rzutem domenowym i `failed` z zerem wierszy i pustymi
propozycjami; 30 kart → pierwsze 10; puste odsiane; poprawna mieszanka zapisuje własne
`type` i `is_variant` per karta. §6.5 mówi, jak dodać kolejny test kontraktu; follow-up
nazywa koszt `CHECK` w SQLite.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
| --- | --- | --- | --- |
| Gdzie żyje guard | Walidator w parserze generatora; **cała odpowiedź** odrzucana przy naruszeniu | Naruszenie schematu to złamany kontrakt (zmiana modelu/schematu), nie treść; jedna warstwa, którą widzi unit i integracja | Plan |
| Poprawka vs `it.fails` | Poprawka w tej fazie, po czerwonych testach (precedens Fazy 1) | Zmiana mała i lokalna (jeden moduł `api/src/lib/`), suite ma zostać bramką z §5 | Plan |
| Zakres jawnych odrzuceń | Jeden walidator: `refusal`, pusty `content`, nie-JSON, nie-tablica, każda karta (enum, 4 stringi, boolean) | Każde `failed` zamierzone i czytelne w `wrangler tail`; test asertuje klasę błędu, nie tekst | Badania (Open Q3) / Plan |
| `CHECK` w D1 (S-02 F2) | Follow-up bez wyboru + wpis w §6.7 | SQLite nie dodaje `CHECK` przez `ALTER` — przebudowa tabeli to zmiana produkcyjna spoza fazy testowej | Plan |
| Wyrocznia limitu | 10 hardkodowane w teście z cytatem S-03 F2; `MAX_CARDS` nieimportowany | PRD milczy o liczbie; zmiana limitu w kodzie ma zaczerwienić test | Badania (Open Q2) |
| Pusta lista → rzut | Zostaje w generatorze | S-04: „zero kart po deduplikacji” ma być odrębnym wynikiem warstwy zapisu | Badania (§9) |
| Prompt systemowy | Asercja roli i kształtu `messages`, nigdy tekstu | Anty-wzorzec §2: blokuje iterację promptu | test-plan §2 |
| Klasa odrzucenia | Asercja „`Error`, nie `SyntaxError`/`TypeError`” + tekst odmowy z fixture'a | Test ślepy na klasę jest zielony także dla `?.`, które przepuści kartę bez pola | Badania (Architecture Insights) |
| Weryfikacja ręczna | Smoke z prawdziwym kluczem przez `wrangler dev` (3030) | Jedyny dowód, że żywa odpowiedź (`refusal: null`, `finish_reason`) przechodzi przez walidator | Plan |

## Zakres

**W zakresie:**
- `chatResponseRaw` w `api/test/openai-mock.ts`; koniec z kopią helpera w teście jednostkowym
- T5.1–T5.10 w `api/src/lib/flashcards.test.ts` (20 przypadków, 14 czerwonych przed poprawką)
- Walidator w `api/src/lib/flashcards.ts` (bez zod), komentarz „bez kodu obronnego” przepisany
- T5.11–T5.12 w `situations.integration.test.ts`; smoke z prawdziwym kluczem
- `follow-ups/enum-check-migration.md`, §6.5, notatka §6.7, zamknięcie `change.md`

**Poza zakresem:**
- Migracja `CHECK` (0005), edycja archiwum S-02, fallback `TYPE_LABELS` i `example_en.trim()` na froncie
- `max_tokens`/timeout/retry w żądaniu, kolejność ucinania wariantów, normalizacja białych znaków
- Jakość treści (§7), sędzia LLM, runner frontu, CI/hooki (Faza 4 wdrożenia), follow-upy Faz 1–2
- Edycja §1–§5 planu testów (status wiersza 3 należy do orkiestratora)

## Architektura / Podejście

Test jednostkowy → `vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse | chatResponseRaw)`
→ `generateFlashcards(transcript, key)` → asercje na ciele żądania (zbiory pól/enumu, role
`messages`) albo na wyniku (kolejność/liczba kart) albo na klasie odrzucenia. W generatorze:
non-2xx → `refusal` → `content` → `JSON.parse` w `try` → `Array.isArray` → walidacja każdej
karty (pierwsza wadliwa odrzuca całość) → filtr pustych → `slice(0, 10)` → pusto → rzut.
Test integracyjny: `postAndFinish` → `readFlashcards` (zero wierszy albo dokładne `type`/`is_variant`)
+ `GET /flashcards/proposals`. Wyrocznie jako stałe testu z cytatem PRD/archiwum.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Harness | `chatResponseRaw`, `chatResponse` jako nakładka, import w teście `lib/`; suite bez zmiany (63) | Refaktor zmieni `chatResponse(null, 500)` (T2.1/T2.3) |
| 2. Żądanie + przycięcie | T5.1–T5.4 (6 przypadków), zero zmian produkcyjnych, deliberate-breaks | Test czerwony przed deliberate-break = nieznana luka → `/10x-plan` |
| 3. Odrzucenie + walidator | T5.5–T5.10 (14 czerwonych → walidator → zielone), komentarz modułu | Walidator odrzuca coś legalnego (pusty `example_en`, `refusal: null`) — smoke w Fazie 4 |
| 4. Integracja | T5.11 (×2) + T5.12, smoke z prawdziwym kluczem | Żywy kształt odpowiedzi OpenAI inny niż w mocku → `failed` w produkcji |
| 5. Follow-up + książka | `enum-check-migration.md`, §6.5, §6.7, `change.md` | §6.5 opisujące wzorzec z badania zamiast tego, który powstał |

**Wymagania wstępne:** Node 24 i `npm` w `api/`; `api/.dev.vars` lokalnie (do smoke'a, nie do
testów); port 3030 wolny; Fazy 1–2 wdrożenia zamknięte (harness, `readFlashcards`,
`postAndFinish`).
**Szacowany wysiłek:** ~2 sesje w 5 fazach (Faza 3 najdłuższa: 14 czerwonych testów i walidator).

## Otwarte ryzyka i założenia

- Założenie: żywa odpowiedź Chat Completions zawsze niesie `refusal: null` i `finish_reason`;
  walidator sprawdza wartość, nie obecność pola. Weryfikacja: smoke (Faza 4).
- Założenie: `instanceof SyntaxError/TypeError` działa w izolacie workerd (ten sam realm dla
  testu i modułu). Jeśli nie — asercja klasy przez `err.name`.
- Zmiana zachowania produkcyjnego: odpowiedź, która dziś zapisałaby kartę bez `example_en`
  lub z obcym `type`, po zmianie da `failed` — zamierzone, widoczne jako brak fiszek z tej
  sytuacji.
- Liczby testów w kryteriach (69/83/86) zakładają dokładnie tyle wierszy `it.each`, ile
  wymienia plan; odchylenie o wiersz to korekta kryterium, nie błąd.
- T5.11 wiersz „odmowa” nie ma własnego deliberate-break na warstwie integracyjnej (odmowa
  pada na `content` także bez czytania `refusal`) — jego deliberate-break żyje w T5.9.

## Kryteria sukcesu (podsumowanie)

- `cd api && npm test` zielone (86 testów, 5 `it.fails` bez zmian); każdy z T5.1–T5.12 ma
  wykonany deliberate-break; T5.5–T5.10 były czerwone przed walidatorem.
- Zdegenerowana odpowiedź modelu kończy się `failed`, zerem wierszy i pustymi propozycjami;
  poprawna mieszanka zapisuje własne `type` i `is_variant`; smoke z prawdziwym kluczem daje
  propozycje z poprawnymi typami.
- §6.5 wystarcza, by osoba bez kontekstu dodała test nowego pola karty po obu stronach;
  S-02 F2 ma follow-up z nazwanym kosztem.

# Faza 3 wdrożenia testów: kontrakt generatora LLM (odpowiedź modelu → dane) — Plan implementacji

## Przegląd

Przypinamy kontrakt generatora fiszek (ryzyko #5 z `context/foundation/test-plan.md` §2) na
istniejącym harnessie: testami jednostkowymi z mockiem `fetch` (§6.1) dla **żądania** (ścisły
schemat z pełną listą pól wymaganych, enum `type`, kształt `messages`) i **parsera**
(deterministyczne przycięcie do 10, odsiew pustych, odrzucenie każdej odpowiedzi spoza
kontraktu), oraz jednym blokiem integracyjnym w workerd (§6.2) jako obserwowalnym dowodem
„zdegenerowana odpowiedź nie przecieka do bazy ani do propozycji”.

Badanie wykazało, że dziś nieznany `type` (np. `'idiom'`) idzie z modelu prosto do `INSERT`,
brak `is_variant` staje się cicho `0`, brak `example_en` zapisuje `NULL`, a uszkodzony JSON,
`refusal` i nie-tablica kończą się `failed` **przypadkowo** (`SyntaxError`/`TypeError` w gołym
`catch` wywołującego). Decyzje tej sesji: guard żyje **w parserze generatora** i odrzuca
**całą odpowiedź** przy naruszeniu kontraktu (naruszenie schematu = złamany kontrakt, nie
treść); poprawka wchodzi **w tej fazie** razem z czerwonymi testami (precedens Fazy 1);
**jeden walidator** czyni każdą ścieżkę `failed` zamierzoną i czytelną w logu; `CHECK` w D1
(S-02 F2) trafia do follow-upu bez wyboru — w SQLite wymaga przebudowy tabeli, nie
addytywnego `ALTER`. Plan kończy się podfazą, która wypełnia §6.5 książki kucharskiej,
dopisuje notatkę Fazy 3 do §6.7 i zamyka `change.md` (bez edycji §1–§5; wiersz 3 tabeli §3
przestawia orkiestrator `/10x-test-plan`).

## Analiza obecnego stanu

Szczegóły i permalinki: `context/changes/testing-llm-generator-contract/research.md`.

- **Żądanie** (`api/src/lib/flashcards.ts:52-80, 92-99`): `strict: true`,
  `additionalProperties: false` na obu poziomach, `required` × 5, `enum` na `type`, `messages:
  [system, user(transcript)]`. Test przypina tylko `strict` i `is_variant`
  (`flashcards.test.ts:37, 40-43`) — usunięcie `enum` z `type` lub `front_en` z `required` nie
  czerwieni niczego.
- **Parser** (`flashcards.ts:107-124`): trzy klasy zachowań. Jawne odrzucenie: non-2xx, brak
  `content`, pusta lista. Deterministyczne przycięcie: filtr pustych `front_en`/`back_pl`
  **przed** `slice(0, MAX_CARDS)`. **Przeciek bez kontroli**: `type` spoza trójki idzie do
  `INSERT` (`situations.ts:102`), brak `is_variant` → koercja `? 1 : 0` → karta bazowa, brak
  `example_en` → `NULL` w kolumnie nullable (front rzuca na `.trim()`). Uszkodzony JSON,
  `finish_reason: 'length'`, `refusal` (`content: null`), `flashcards` nie-tablica, brak
  `front_en`/`back_pl` → `failed` **przypadkowo** (`SyntaxError`/`TypeError` z gołego
  `JSON.parse`/`.trim()`/`.filter`), `refusal` i `finish_reason` nie są czytane.
- **Baza i trasa**: zero `CHECK` w czterech migracjach (enumy tylko w komentarzach SQL);
  `GET /flashcards/proposals` oddaje wiersze bez mapowania; front `TYPE_LABELS[card.type]` bez
  fallbacku → pusta plakietka. Poprawka fallbacku na froncie jest poza fazą (§7: brak runnera
  frontu; przeciek ma zostać zatrzymany przed bazą).
- **Założenie „strict:true = bez kodu obronnego”** to udokumentowana decyzja (plan S-02 :42,
  plan S-03 :22, komentarz `flashcards.ts:115`), obalona raz (S-03 F2 → `MAX_CARDS`); S-02 F2
  (brak `CHECK`) jest `PENDING` bez follow-upu.
- **Harness**: `chatResponse` zduplikowany (`api/test/openai-mock.ts:31-36` i
  `flashcards.test.ts:9-14`); żaden nie potrafi dać `refusal`, `content: null`,
  `finish_reason` ani nie-JSON-owego `content`. `readFlashcards`, `seedUser`, `postSituation`,
  `getProposals`, `makeCards`, `postAndFinish`, `readProposals` istnieją. Suite: 9 plików,
  63 testy (58 zielonych + 5 `it.fails`), ~7 s.
- **Wyrocznia**: trzy zamknięte typy (PRD Business Logic `prd.md:99`); AI dobiera podzbiór
  (FR-006 `prd.md:71`); cztery pola tekstowe karty (plan S-02); `is_variant` boolean per
  karta i warianty w tej samej tablicy (plan S-03 :19-24); **limit 10 z przeglądu S-03 F2**
  (`context/archive/2026-06-09-same-context-variants/reviews/impl-review.md:49-56`), nie z PRD
  i nie ze stałej w kodzie.
- **S-04** (filtr duplikatów) wejdzie między `generateFlashcards` a `DB.batch`; „zero kart po
  deduplikacji” stanie się nowym legalnym przypadkiem warstwy zapisu — guard „pusta lista →
  rzut” musi zostać w generatorze, gdzie jest.

## Pożądany stan końcowy

Po zakończeniu planu `cd api && npm test` jest zielone (plus 5 dotychczasowych `it.fails`) i:

- **Żądanie**: usunięcie `enum` z `type`, dowolnego pola z `required`, `additionalProperties`
  z karty albo zamiana ról w `messages` czerwieni T5.1; treść promptu systemowego pozostaje
  wolna do iteracji.
- **Parser**: 30 kart → dokładnie pierwsze 10 z tablicy; puste `front_en`/`back_pl` odsiane
  przed liczeniem limitu; wszystkie puste lub pusta lista → rzut. Każda odpowiedź spoza
  kontraktu (`type` spoza trójki, `is_variant` nie-boolean lub brak, brak lub nie-string
  któregokolwiek z czterech pól tekstowych, nie-JSON, `refusal`, `flashcards` nie-tablica)
  → **zamierzony** rzut domenowy (nie `SyntaxError`/`TypeError`), cała odpowiedź odrzucona,
  tekst odmowy modelu w komunikacie.
- **Baza i propozycje**: dla zdegenerowanej odpowiedzi `flashcards_status='failed'`, zero
  wierszy, `proposals: []`, `status='done'` z transkryptem zachowane, brak odrzuconej
  obietnicy w tle. Dla mieszanki poprawnych kart każdy wiersz ma własne `type` i `is_variant`
  (0/1) w kolejności tablicy, a DTO propozycji niesie `type` z trójki.
- **Harness**: `chatResponseRaw` w `api/test/openai-mock.ts` jako jedyne źródło kształtu
  odpowiedzi Chat Completions (z `refusal: null` jak w realnej odpowiedzi OpenAI);
  `flashcards.test.ts` bez lokalnej kopii.
- `test-plan.md` §6.5 wypełnione, §6.7 z notatką Fazy 3; `follow-ups/enum-check-migration.md`
  utrwala koszt i obie opcje S-02 F2 bez wyboru; §1–§5 nietknięte.

Weryfikacja: kryteria sukcesu każdej fazy + sekcja `## Postęp`.

### Kluczowe odkrycia:

- `api/src/lib/flashcards.ts:116` — rzutowanie `as { flashcards: GeneratedCard[] }` jest
  kłamstwem dla TS; jedyny punkt, w którym można odrzucić `type: 'idiom'` przed `INSERT`.
- `api/src/lib/flashcards.ts:119-121` — kolejność filtr → `slice` (puste karty nie zużywają
  miejsc z limitu); `:122-124` — jedyny guard „`done` ⇒ ≥1 karta” (T2.4 na nim stoi).
- `api/src/routes/situations.ts:94-105` — `generateAndStoreFlashcards` binduje `card.type` i
  `card.is_variant ? 1 : 0` bez walidacji; `:106` gołe `catch` → `failed`. Poprawka w
  generatorze nie wymaga zmian w wywołującym.
- `api/src/lib/flashcards.test.ts:22-44` — istniejący test żądania jest testem transportu
  (URL, metoda, `Bearer`, `model`) z dwiema asercjami schematu (`:40-43`), które T5.1 przejmie.
- `api/test/openai-mock.ts:31-36` — `chatResponse(flashcards, status)`; T2.1/T2.3 wołają
  `chatResponse(null, 500)` — refaktor musi to zachować.
- `api/test/db.ts:36-47, 200` — `FlashcardRow` z `type: string`, `is_variant: number`;
  `readFlashcards` `ORDER BY id` = kolejność `DB.batch`.
- `api/migrations/0003_create_flashcards.sql:14` — `example_en TEXT` nullable; front
  `src/components/flashcard-card.tsx:38-39` robi `example_en.trim()` — walidator wymaga
  `example_en` jako string, więc generator nigdy nie wyprodukuje `NULL`.
- `api/tsconfig.json` `include: ["src/**/*.ts", "test/**/*.ts"]` — `src/lib/*.test.ts` może
  importować `../../test/openai-mock` (tak robią testy integracyjne z `src/routes/`).
- Realna odpowiedź Chat Completions zawiera pole `refusal: null` w **każdej** wiadomości
  (nie tylko przy odmowie) i `finish_reason` (`stop` | `length` | `content_filter`);
  walidator traktuje `null`/`''` jako brak odmowy, a builder to odzwierciedla.
- SQLite nie wspiera `ALTER TABLE ... ADD CONSTRAINT`: `CHECK` na `flashcards.type` to
  przebudowa tabeli (`CREATE` nowa → `INSERT ... SELECT` → `DROP` → `RENAME` → indeksy) —
  dlatego S-02 F2 nie jest „addytywne”, wbrew założeniu przeglądu.

## Czego NIE robimy

- Nie dodajemy `zod` (jest w `package-lock.json`, nieużywany) ani runnera frontu; walidator
  to ręczna funkcja obok istniejącego wzorca `lib/validation.ts` (§7).
- Nie piszemy migracji `CHECK` (0005) — follow-up bez wyboru; nie edytujemy zarchiwizowanego
  przeglądu S-02.
- Nie naprawiamy fallbacku `TYPE_LABELS` na froncie ani `example_en.trim()`; nie testujemy
  frontu (§7). Objaw UI jest dowodzony pośrednio: `proposals: []` po zdegenerowanej
  odpowiedzi i `type` z trójki w DTO na ścieżce szczęśliwej.
- Nie asertujemy treści promptu systemowego (tylko rola i kształt `messages`), nie robimy
  snapshotu obiektu schematu, nie importujemy `MAX_CARDS`, `RESPONSE_FORMAT` ani
  `GeneratedCard` do testów jako wyroczni (wyrocznie hardkodowane w teście z cytatem).
- Nie asertujemy polskiego tekstu komunikatów błędów generatora. Jedyny tekst asertowany w
  odrzuceniu to **tekst odmowy z fixture'a** (`refusal`) — dowód, że odmowa jest czytana, nie
  lustro komunikatu.
- Nie oceniamy jakości treści (angielskość, trafność typu, kontekst wariantu) — §7; bez
  sędziego LLM.
- Nie dodajemy `max_tokens`, `temperature`, timeoutu ani retry do żądania (badanie §1 —
  obserwacja, nie ryzyko #5); nie zmieniamy `MODEL`.
- Nie zmieniamy kolejności ucinania przy >10 kart (warianty na końcu tablicy giną pierwsze —
  obserwacja dla S-04/`--refresh`, badanie Open Question 5) ani nie normalizujemy białych
  znaków w zapisanych polach.
- Nie przenosimy guarda „pusta lista → rzut” z generatora do warstwy zapisu (S-04 potrzebuje
  rozróżnienia „model dał pusto” od „wszystko odfiltrowane”).
- Nie realizujemy follow-upów Faz 1–2 (reguła wieku `pending`, dzień lokalny); nie
  konfigurujemy CI, hooków ani jednego polecenia (Faza 4 wdrożenia).
- Nie edytujemy §1–§5 planu testów (status wiersza 3 tabeli §3 i liczniki §4 są własnością
  orkiestratora).

## Podejście do implementacji

1. **Harness najpierw, bez zmiany wyniku suite**: jeden surowy builder odpowiedzi chatu
   (`chatResponseRaw`) w `api/test/openai-mock.ts`, `chatResponse` jako cienka nakładka,
   koniec z duplikatem w teście jednostkowym. Suite ma dać identyczny wynik (63 testy) —
   dowód, że refaktor helpera nie zmienił semantyki.
2. **Cost × signal, od najtańszego**: kontrakt żądania i przycięcie to czyste asercje na
   mocku `fetch` bez zmian produkcyjnych (Faza 2); odrzucenie wymaga poprawki (Faza 3);
   dowód „nie przecieka do bazy” to jeden blok integracyjny (Faza 4).
3. **Test przed poprawką, klasą odrzucenia jako sygnał**: testy Fazy 3 są czerwone przed
   poprawką — te, gdzie dziś przecieka, przez `resolves`; te, gdzie dziś pada przypadkowo,
   przez asercję „rzut domenowy, nie `SyntaxError`/`TypeError`”. Bez tej asercji test byłby
   zielony także dla przyszłej „naprawy” `TypeError` przez `?.`, która przepuści kartę bez
   pola (badanie, Architecture Insights).
4. **Wyrocznia z produktu, nie z kodu**: stałe testu `CARD_TYPES`, `REQUIRED_CARD_FIELDS`,
   `MAX_CARDS_ORACLE = 10` hardkodowane z cytatem (PRD `:99`, plan S-02/S-03, przegląd S-03 F2).
   Zmiana limitu w kodzie MA zaczerwienić test — to sygnał do świadomej zmiany wyroczni.
5. **Ramię kontrolne obowiązkowe**: każdy test „→ `failed`” ma partnera na ścieżce
   szczęśliwej asertującego **wartości** zapisanych kolumn (`type`, `is_variant`) — walidator
   odrzucający wszystko byłby inaczej zielony (§6.2, lekcja deliberate-break 0004).
6. **Deliberate-break per test, książka kucharska na końcu**: §6.5 opisuje wzorzec, który
   faktycznie powstał; follow-up S-02 F2 nazywa koszt przebudowy tabeli, którego przegląd nie
   znał.

## Krytyczne szczegóły implementacji

- **Sekwencjonowanie stanu (kolejność walidacji w generatorze)** — non-2xx → `refusal`
  niepusty → `content` pusty/`null` → `JSON.parse` w `try/catch` → `Array.isArray(flashcards)`
  → walidacja każdej karty (cała odpowiedź odrzucana przy pierwszej wadliwej) → filtr pustych
  `front_en`/`back_pl` → `slice(0, MAX_CARDS)` → pusto → rzut. `refusal` **przed** `content`,
  bo przy odmowie `content` jest `null` i sprawdzenie treści dałoby mylący komunikat „bez
  treści” (dzisiejsze zachowanie). Filtr pustych i limit zostają **po** walidacji: pusty
  string jest zgodny ze schematem (treść, nie kontrakt) — odsiew, nie odrzucenie.
- **Realna odpowiedź OpenAI niesie `refusal: null` zawsze** — walidator sprawdza
  `typeof refusal === 'string' && refusal !== ''`, nie `'refusal' in message`; builder
  `chatResponseRaw` wpisuje `refusal: null` domyślnie, żeby test szczęśliwej ścieżki ćwiczył
  ten sam kształt co produkcja. Smoke z prawdziwym kluczem (Faza 4) jest jedynym dowodem
  zgodności z żywym API.
- **Asercja „rzut domenowy”** — jedno wywołanie `generateFlashcards(...).catch((e) => e)`,
  potem `toBeInstanceOf(Error)`, `not.toBeInstanceOf(SyntaxError)`,
  `not.toBeInstanceOf(TypeError)`. `instanceof` działa, bo test i moduł biegną w tym samym
  izolacie workerd. Nigdy `rejects.toThrow(<polski tekst>)`.
- **Refaktor `chatResponse` musi zachować `chatResponse(null, 500)`** (T2.1, T2.3): ciało
  `{"flashcards":null}` ze statusem 500 — generator odrzuca na `res.ok` zanim dotknie treści.
- **Kolejność wierszy w D1** — `readFlashcards` sortuje po `id`; `DB.batch` wstawia w
  kolejności tablicy, więc asercja „zapisane w kolejności fixture'a” jest poprawna bez
  własnego sortowania w teście.

## Faza 1: Harness — surowy builder odpowiedzi chatu

### Przegląd

Jedno miejsce budujące odpowiedź Chat Completions w dowolnym kształcie (`content`
string|null, `refusal`, `finish_reason`, status HTTP); `chatResponse` jako nakładka;
`flashcards.test.ts` bez lokalnej kopii. Zero zmian produkcyjnych, zero zmian liczby testów.

### Wymagane zmiany:

#### 1. Surowy builder i nakładka

**Plik**: `api/test/openai-mock.ts`

**Cel**: Testy Fazy 3 muszą wyprodukować odmowę modelu, uciętą odpowiedź i nie-JSON-owy
`content` bez składania JSON w teście; kształt odpowiedzi ma żyć w jednym miejscu.

**Umowa**:
- `export type ChatMessageRaw = { content: string | null; refusal?: string | null;
  finish_reason?: 'stop' | 'length' | 'content_filter' }`.
- `chatResponseRaw(message: ChatMessageRaw, status = 200): Response` → ciało
  `{ choices: [{ index: 0, finish_reason: message.finish_reason ?? 'stop', message: { role:
  'assistant', content: message.content, refusal: message.refusal ?? null } }] }`,
  `Content-Type: application/json`. **`refusal: null` obecne zawsze** (jak w realnej
  odpowiedzi OpenAI).
- `chatResponse(flashcards: unknown, status = 200)` = `chatResponseRaw({ content:
  JSON.stringify({ flashcards }) }, status)` — sygnatura i zachowanie bez zmian
  (`chatResponse(null, 500)` nadal działa).
- Komentarz nagłówkowy: „kształt Chat Completions żyje TYLKO tutaj (dawniej kopia w
  `src/lib/flashcards.test.ts`); `chatResponse` dla poprawnych list, `chatResponseRaw` dla
  odpowiedzi zdegenerowanych”.

#### 2. Import zamiast kopii

**Plik**: `api/src/lib/flashcards.test.ts`

**Cel**: Rozszerzenie helpera ma sięgać obu warstw testów.

**Umowa**: Lokalna funkcja `chatResponse` (`:8-14`) usunięta; `import { chatResponse,
chatResponseRaw } from '../../test/openai-mock'`. Test „odpowiedź bez treści → wyjątek”
(`:80-86`) przepisany na `chatResponseRaw({ content: null })` (ten sam skutek: rzut na brak
treści; `refusal: null`). Pozostałe 5 testów bez zmian.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `cd api && npm test` zielone: 9 plików, 63 testy (58 + 5 expected-fail) — liczba
  identyczna jak przed fazą
- `cd api && npm run typecheck` zielone
- `grep -rn "function chatResponse" api/` znajduje dokładnie 1 definicję (`api/test/openai-mock.ts`)
- `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` puste (zero zmian produkcyjnych)

#### Weryfikacja ręczna:

- Nagłówek `openai-mock.ts` przeczytany: bez kontekstu tej zmiany wiadomo, kiedy użyć
  `chatResponse`, a kiedy `chatResponseRaw`

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 2.

---

## Faza 2: Ryzyko #5 — kontrakt żądania i deterministyczne przycięcie (zero zmian produkcyjnych)

### Przegląd

Nowy `describe('Ryzyko #5: kontrakt generatora')` w `api/src/lib/flashcards.test.ts`
z T5.1–T5.4. Wszystkie zielone od razu (badanie: te oczekiwania są dziś spełnione); każdy
ma nazwany deliberate-break. Wyrocznie jako stałe pliku testowego z cytatem.

### Wymagane zmiany:

#### 1. Wyrocznie testu

**Plik**: `api/src/lib/flashcards.test.ts` (stałe pliku, nad `describe`)

**Cel**: Oczekiwania pochodzą z produktu i archiwum, nie z implementacji; zmiana w kodzie
ma zaczerwienić test i wymusić świadomą zmianę wyroczni.

**Umowa**: `CARD_TYPES = ['word', 'phrase', 'sentence']` z komentarzem „PRD Business Logic
`prd.md:99` — trzy zamknięte typy; AI dobiera podzbiór (FR-006)”;
`REQUIRED_CARD_FIELDS = ['type', 'front_en', 'back_pl', 'example_en', 'is_variant']` z
komentarzem „cztery pola karty: plan S-02 `archive/2026-06-07-gated-ai-flashcard-generation/plan.md`;
`is_variant` boolean per karta: plan S-03 `archive/2026-06-09-same-context-variants/plan.md:19-24`”;
`MAX_CARDS_ORACLE = 10` z komentarzem „decyzja przeglądu S-03 F2
`archive/2026-06-09-same-context-variants/reviews/impl-review.md:49-56`, NIE PRD (PRD milczy o
liczbie) i NIE stała `MAX_CARDS` z implementacji — celowo nie importowana”. Lokalny helper
`cards(n)` (jak `makeCards` w teście integracyjnym: typy rotacyjnie, `card <i>`/`karta <i>`,
`is_variant: i % 2 === 1`). Import `chatResponse`/`chatResponseRaw` z Fazy 1.

#### 2. T5.1 — kontrakt żądania

**Plik**: `api/src/lib/flashcards.test.ts` (`describe('Ryzyko #5: kontrakt generatora')`)

**Cel**: Żądanie zawsze niesie ścisły schemat z pełną listą pól wymaganych i zamkniętym
enumem; prompt systemowy jest obecny jako rola, nie jako tekst.

**Umowa** — **T5.1 żądanie niesie ścisły schemat: pięć pól wymaganych, zamknięty enum
`type`, brak dodatkowych właściwości; wiadomość systemowa przed transkryptem jako ostatnią
wiadomością użytkownika**:
- Zachowanie: `mockResolvedValue(chatResponse(cards(2)))` → `generateFlashcards(transcript,
  'sk-test')` → `payload = JSON.parse(init.body)`; asercje: `response_format.type ===
  'json_schema'`; `json_schema.strict === true`; `schema.additionalProperties === false`;
  `schema.required` `toEqual(['flashcards'])`; `items.additionalProperties === false`;
  `[...items.required].sort()` `toEqual([...REQUIRED_CARD_FIELDS].sort())` (**dokładnie**, nie
  `toContain`); `[...items.properties.type.enum].sort()` `toEqual([...CARD_TYPES].sort())`;
  `items.properties.is_variant.type === 'boolean'`; `items.properties.front_en.type`,
  `back_pl.type`, `example_en.type` === `'string'`; `messages[0].role === 'system'` i
  `typeof messages[0].content === 'string'` z długością > 0; `messages.at(-1)` `toEqual({
  role: 'user', content: transcript })`. **Bez** asercji na liczbie wiadomości (miejsce na
  przyszłe few-shot) i **bez** asercji na treści promptu.
- Regresja: usunięcie `enum` przy zmianie schematu; wypadnięcie pola z `required` (S-04
  dotknie generatora); `additionalProperties` zdjęte „żeby model miał luz”; zamiana modelu
  na taki bez Structured Outputs (`strict` znika); prompt wstrzyknięty jako `user` zamiast
  `system`.
- Źródło: badanie §1, §7 (wiersz „żądanie zawsze niesie ścisły schemat” — prawdziwe, słabo
  przypięte); test-plan §2 #5.
- Przypadek brzegowy: `required` porównywane jako zbiór (kolejność w schemacie nieistotna),
  `enum` również — test nie zamraża kolejności.
- Anty-wzorzec uniknięty: snapshot obiektu schematu (wyrocznia z implementacji); asercja
  tekstu promptu (blokuje iterację — §2).
- Deliberate-breaks (każdy osobno → czerwony, kod przywrócony): (a) usuń `enum` z
  `properties.type` (`flashcards.ts:69`); (b) usuń `'example_en'` z `items.required` (`:67`);
  (c) `additionalProperties: true` na `items` (`:66`); (d) zamień kolejność `messages` (`:95-98`).
- Istniejący test `:22-44`: asercje schematu `:40-43` (komentarz S-03, `toContain('is_variant')`,
  `is_variant.type`) **usunięte** — T5.1 je przejmuje; reszta (URL, metoda, `Bearer`, `model`,
  `messages.at(-1)`) zostaje jako test transportu.

#### 3. T5.2–T5.4 — deterministyczne przycięcie i odsiew

**Plik**: `api/src/lib/flashcards.test.ts` (ten sam `describe`)

**Cel**: Nadmiar kart i puste karty kończą się deterministycznym przycięciem; brak
jakiejkolwiek użytecznej karty kończy się rzutem (który wywołujący zamienia na `failed`).

**Umowa**:
- **T5.2 `it.each([[10, 10], [11, 10], [30, 10]])` — model zwraca $n kart → dokładnie
  pierwsze $expected z tablicy, w jej kolejności**: `chatResponse(cards(n))` → wynik
  `toHaveLength(expected)`; `result.map(front_en)` `toEqual(cards(n).slice(0, expected).map(front_en))`
  (kolejność tablicy); `expected` to `MAX_CARDS_ORACLE`, nie import.
  - Regresja: usunięcie `slice` przy refaktorze S-04; podniesienie limitu bez zmiany
    wyroczni (świadoma decyzja ma zmienić obie strony).
  - Źródło: badanie §2 (wiersz „>10 kart”), Open Question 2; S-03 F2 jako wyrocznia.
  - Brzeg: dokładnie 10 → 10 (granica nie jest „< 10”); 30 z treści ryzyka #5.
  - Anty-wzorzec: import `MAX_CARDS`; asercja komunikatu.
  - Deliberate-break: zmień `MAX_CARDS` na 12 (`flashcards.ts:17`) → wiersze 11 i 30 czerwone;
    osobno usuń `.slice(...)` (`:121`) → czerwone.
- **T5.3 puste `front_en` lub `back_pl` są odsiewane przed liczeniem limitu; reszta w
  kolejności**: fixture 12 kart, gdzie karta 1 ma `front_en: '   '`, a karta 3 `back_pl: ''`
  → wynik `toHaveLength(10)` (10 pełnych z 12: karty 2, 4–12 — puste nie zużywają miejsc),
  `result.map(front_en)` równe odpowiedniej projekcji fixture'a; żadna karta z pustym
  polem w wyniku.
  - Regresja: zamiana kolejności filtr/`slice` (pusta karta zużywa miejsce → 9 kart);
    usunięcie filtra (pusty front trafia do INSERT — `NOT NULL` nie łapie pustego stringa,
    `0003:12-13`).
  - Źródło: badanie §2 (wiersz „wszystkie karty z pustym…”), §4 (brak `CHECK(length > 0)`).
  - Brzeg: białe znaki (`'   '`) traktowane jak puste (predykat `trim`); pusty `example_en`
    **nie** jest odsiewany (prompt `flashcards.ts:39` dopuszcza pusty dla `sentence`) —
    jedna karta w fixture ma `example_en: ''` i musi zostać w wyniku.
  - Anty-wzorzec: asercja, że wartość została „przycięta” (`trim` jest tylko predykatem —
    normalizacja to obserwacja poza ryzykiem #5).
  - Deliberate-break: zamień kolejność `.filter`/`.slice` (`:119-121`) → 9 kart → czerwony;
    osobno usuń `.filter(...)` → 10 kart z pustą → czerwony.
- **T5.4 wszystkie karty puste → rzut (guard zostaje w generatorze — S-04)**:
  `chatResponse([3 karty z pustym front_en])` → `await expect(...).rejects.toThrow()`
  (bez tekstu). Komentarz nad testem: „Guard «pusta lista → rzut» MUSI zostać w generatorze:
  po S-04 «zero kart po deduplikacji» będzie odrębnym, legalnym wynikiem warstwy zapisu
  (badanie §9); T2.4 w `situations.integration.test.ts` dowodzi tego samego niezmiennika od
  strony bazy”.
  - Regresja: przeniesienie guarda do `generateAndStoreFlashcards` przy S-04 (generator
    zwróci `[]`, T5.4 czerwony — sygnał do rozmowy, nie do usunięcia testu).
  - Źródło: badanie §2, §9; test-plan §2 #5 („pusta lista”).
  - Brzeg: „wszystkie puste” (nie `[]` — to pokrywa istniejący test `:75-78`) — filtr
    redukuje do zera, ścieżka inna niż pusta tablica z modelu.
  - Anty-wzorzec: asercja tekstu `/fiszek/i` (istniejący test `:77` ją ma — zostawiamy,
    nie powielamy).
  - Deliberate-break: usuń `if (cards.length === 0) throw` (`:122-124`) → `resolves` z `[]`
    → czerwony (T2.4 też).

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `cd api && npx vitest run -t "Ryzyko #5"` zielone: T5.1 (1) + T5.2 (3 wiersze) + T5.3 (1)
  + T5.4 (1) = 6 przypadków
- `cd api && npm test` zielone: 69 testów (64 + 5 expected-fail)
- `cd api && npm run typecheck` zielone
- `grep -n "MAX_CARDS\|RESPONSE_FORMAT" api/src/lib/flashcards.test.ts` nie znajduje importu
  ani odwołania do stałych implementacji (dozwolone tylko `MAX_CARDS_ORACLE` i cytaty w
  komentarzach)
- `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` puste

#### Weryfikacja ręczna:

- Deliberate-breaks T5.1 (a–d), T5.2 (2), T5.3 (2), T5.4 (1) wykonane: każda zmiana czerwieni
  dokładnie swój test (T5.4 dodatkowo T2.4), kod przywrócony, suite zielone

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 3. Jeśli
którykolwiek test T5.1–T5.4 jest czerwony **przed** deliberate-break, to nieznana luka
(badanie mówi, że te oczekiwania są dziś spełnione) — zatrzymaj się i wróć do `/10x-plan`.

---

## Faza 3: Ryzyko #5 — odrzucenie odpowiedzi spoza kontraktu + walidator w generatorze

### Przegląd

T5.5–T5.10 kodują „każda odpowiedź spoza kontraktu → zamierzony rzut domenowy, cała
odpowiedź odrzucona”. Przed poprawką **wszystkie są czerwone** (przeciek → `resolves`;
odrzucenie przypadkowe → `SyntaxError`/`TypeError`; odmowa → komunikat bez tekstu odmowy).
Potem jeden walidator w `api/src/lib/flashcards.ts`, zielone, deliberate-breaks.

### Wymagane zmiany:

#### 1. Testy odrzucenia

**Plik**: `api/src/lib/flashcards.test.ts` (ten sam `describe('Ryzyko #5: kontrakt generatora')`)

**Cel**: Przypiąć, że naruszenie kontraktu strukturalnego jest odrzucane **świadomie**
(klasa błędu domenowa), a nie przez przypadkowy wyjątek, który przyszły `?.` może wyciszyć.

**Umowa** — lokalny helper `expectContractRejection(promise)`: `const err = await
promise.catch((e) => e); expect(err).toBeInstanceOf(Error);
expect(err).not.toBeInstanceOf(SyntaxError); expect(err).not.toBeInstanceOf(TypeError);
return err`. Komentarz: „dwa rodzaje odrzucenia (badanie, Architecture Insights) — test
ślepy na klasę błędu jest zielony także dla «naprawy» `TypeError` przez `?.`, która przepuści
kartę bez pola do INSERT”.

- **T5.5 karta o `type` spoza trójki (`'idiom'`) → cała odpowiedź odrzucona**:
  `chatResponse([cards(1)[0], { ...cards(2)[1], type: 'idiom' }, cards(3)[2]])` →
  `expectContractRejection`. **Czerwony przed poprawką** (`resolves` z 3 kartami).
  - Regresja: zmiana modelu/fallback bez enum; edycja schematu; „poluzowanie” walidatora.
  - Źródło: badanie §2 (wiersz „nieznany `type`” — ani nie odrzuca, ani nie przycina), §5
    (objaw `TYPE_LABELS[...] = undefined`); S-02 F2.
  - Brzeg: wadliwa karta w **środku** poprawnych — dowód „cała odpowiedź”, nie „wadliwa
    karta odsiana” (decyzja tej sesji: naruszenie schematu = złamany kontrakt).
  - Anty-wzorzec: asercja tylko „`failed`” bez dowodu zera wierszy (to Faza 4); import
    `GeneratedCard`.
  - Deliberate-break po poprawce: usuń sprawdzenie `type` z walidatora → `resolves` → czerwony.
- **T5.6 `it.each` — `is_variant` $label → cała odpowiedź odrzucona**: wiersze: brak pola
  (`delete card.is_variant`), string `'true'`, liczba `1`. **Czerwone przed poprawką**
  (koercja `? 1 : 0` u wywołującego przepuszcza każdą z nich).
  - Regresja: wypadnięcie `is_variant` z `required` (jedyna dzisiejsza asercja to
    `toContain`); model oddający `"true"`.
  - Źródło: badanie §2 (wiersz „brak `is_variant`”), §3 (koercja `situations.ts:102`); plan
    S-03 :19-24 (boolean per karta).
  - Brzeg: wartości „prawdopodobne” (`'true'`, `1`), które koercja `? 1 : 0` zamienia w
    wariant — cicha zmiana znaczenia, nie awaria.
  - Anty-wzorzec: asercja, że karta bez flagi „staje się bazowa” (utrwaliłaby koercję).
  - Deliberate-break: usuń `typeof is_variant === 'boolean'` z walidatora → 3 wiersze czerwone.
- **T5.7 `it.each` — $label → cała odpowiedź odrzucona**: wiersze: brak `front_en`, brak
  `back_pl`, brak `example_en`, `example_en: null`, `front_en: 42`. **Czerwone przed
  poprawką**: brak `front_en`/`back_pl` i `42` → `TypeError` z `.trim()` (klasa błędu);
  brak/`null` `example_en` → `resolves` (D1 zapisze `NULL`, front rzuci na `.trim()`).
  - Regresja: `?.trim()` „naprawiające” `TypeError`; wypadnięcie `example_en` z `required`.
  - Źródło: badanie §2 (wiersze „brak `front_en`/`back_pl`”, „brak `example_en`”), §5
    (`flashcard-card.tsx:38-39`), Open Question 4.
  - Brzeg: `example_en` to jedyne pole nullable w D1 — pusty string legalny (T5.3), `null`
    i brak nielegalne.
  - Anty-wzorzec: asercja tekstu komunikatu; asercja, że `example_en` „dostaje domyślne `''`”
    (to byłaby cicha naprawa danych, nie kontrakt).
  - Deliberate-break: usuń sprawdzenie `typeof example_en === 'string'` → wiersze
    `example_en` czerwone; osobno zamień walidację `front_en` na `?.trim()` → wiersz `42`
    lub „brak `front_en`” czerwony (klasa `TypeError` lub `resolves`).
- **T5.8 `it.each` — `content` $label → odrzucenie domenowe, nie `SyntaxError`**: wiersze:
  zwykły tekst (`chatResponseRaw({ content: 'Oto fiszki: ...' })`), ucięty JSON z
  `finish_reason: 'length'` (`content: '{"flashcards":[{"type":"word","front_en":"inv'`).
  **Czerwone przed poprawką** (`SyntaxError` z gołego `JSON.parse`).
  - Regresja: przyszły `try { JSON.parse } catch { return [] }` (cisza zamiast sygnału) —
    wtedy pusta lista rzuca, ale komunikat kłamie; przede wszystkim: test dokumentuje, że
    odrzucenie jest projektowane.
  - Źródło: badanie §2 (wiersz „uszkodzony JSON / `finish_reason: 'length'`”), Open Question 3.
  - Brzeg: `finish_reason: 'length'` — jedyny realny scenariusz ucięcia (brak `max_tokens`
    w żądaniu = limit modelu); walidator może dołączyć `finish_reason` do komunikatu (jakość
    logu), test tego **nie** asertuje.
  - Anty-wzorzec: asercja `rejects.toThrow(SyntaxError)` (utrwaliłaby przypadek).
  - Deliberate-break: usuń `try/catch` wokół `JSON.parse` → `SyntaxError` → 2 wiersze czerwone.
- **T5.9 odmowa modelu (`refusal`, `content: null`) → odrzucenie z tekstem odmowy w błędzie**:
  `chatResponseRaw({ content: null, refusal: 'I cannot generate flashcards for this input.' })`
  → `err = await expectContractRejection(...)`; `expect(err.message).toContain('I cannot
  generate flashcards for this input.')`. **Czerwony przed poprawką** (komunikat „bez treści”,
  `refusal` nieczytany).
  - Regresja: `wrangler tail` pokazujące „bez treści” dla odmowy (mylący log — ryzyko #2
    wymaga obserwowalnego `failed`).
  - Źródło: badanie §2 (wiersz „brak/pusty `content` (w tym `refusal`)”), Open Question 3.
  - Brzeg: `refusal` obecne jako `null` na ścieżce szczęśliwej (T5.1/T5.2 przez
    `chatResponse` mają `refusal: null`) — walidator nie może odrzucać na samej obecności
    pola.
  - Anty-wzorzec: asercja polskiego tekstu komunikatu. Tekst odmowy pochodzi z fixture'a —
    asercja dowodzi, że `refusal` jest **czytany**, nie jaki jest komunikat.
  - Deliberate-break: przestań czytać `refusal` (walidator sprawdza tylko `content`) →
    komunikat „bez treści” bez tekstu odmowy → czerwony.
- **T5.10 `it.each` — `flashcards` $label → odrzucenie domenowe, nie `TypeError`**: wiersze:
  obiekt zamiast tablicy (`chatResponseRaw({ content: JSON.stringify({ flashcards: cards(1)[0] }) })`),
  string (`{ flashcards: 'word: invoice' }`). **Czerwone przed poprawką** (`TypeError` z
  `.filter`).
  - Regresja: `?? []` rozszerzone na „cokolwiek nie-tablicowe → []” (cisza).
  - Źródło: badanie §2 (wiersz „`flashcards` nie-tablica”).
  - Brzeg: `flashcards: null` pokrywa dziś `?? []` → pusta → rzut; po poprawce `null` też
    jest „nie-tablicą” (walidator nie musi go wyróżniać).
  - Anty-wzorzec: asercja tekstu.
  - Deliberate-break: usuń `Array.isArray` z walidatora (zostaw `?? []`) → `TypeError` →
    2 wiersze czerwone.

#### 2. Walidator w generatorze

**Plik**: `api/src/lib/flashcards.ts`

**Cel**: Każda odpowiedź spoza kontraktu strukturalnego kończy się zamierzonym rzutem
domenowym (cała odpowiedź odrzucona, komunikat użyteczny w `wrangler tail`); ścieżka
szczęśliwa, odsiew pustych i limit 10 bez zmian; guard „pusta lista → rzut” zostaje.

**Umowa**:
- `const CARD_TYPES = ['word', 'phrase', 'sentence'] as const;` używane w `RESPONSE_FORMAT`
  (`enum: [...CARD_TYPES]` — schemat nadal literałem `as const`) i w walidatorze;
  `GeneratedCard['type']` = `(typeof CARD_TYPES)[number]`.
- Typ ciała odpowiedzi rozszerzony: `choices?: { finish_reason?: string; message?: {
  content?: string | null; refusal?: string | null } }[]`.
- Prywatna funkcja parsująco-walidująca (np. `parseGeneratedCards(message, finishReason):
  GeneratedCard[]`), nieeksportowana (testy idą przez `generateFlashcards` + mock `fetch`,
  §6.1). Kolejność jak w „Krytycznych szczegółach”: `refusal` niepusty string → `throw new
  Error('Model odmówił wygenerowania fiszek: <refusal>')`; `content` pusty/`null` → rzut
  „bez treści” (jak dziś); `JSON.parse` w `try/catch` → rzut domenowy z `finish_reason` w
  komunikacie (`'…(finish_reason: length)'`); `!Array.isArray(parsed?.flashcards)` → rzut;
  każda karta: obiekt, `CARD_TYPES.includes(type)`, `typeof front_en/back_pl/example_en ===
  'string'`, `typeof is_variant === 'boolean'` — pierwsza wadliwa → rzut z indeksem i
  nazwą pola (`'Karta 2 spoza kontraktu: type="idiom"'`); dopiero potem istniejący
  `filter` → `slice(0, MAX_CARDS)` → rzut na pusto. Wszystkie rzuty przez `new Error(...)`
  (nigdy rethrow `SyntaxError`/`TypeError`).
- Komentarz nagłówkowy modułu przepisany: „Structured Outputs wymusza kształt po stronie
  dostawcy; walidator w parserze jest drugą linią obrony — naruszenie kontraktu (zmiana
  modelu, schematu, odmowa, ucięcie) odrzuca **całą** odpowiedź → `failed`, nigdy częściowy
  zapis kart spoza kontraktu (ryzyko #5, `test-plan.md` §2). Puste `front_en`/`back_pl` to
  treść, nie kontrakt — odsiew, nie odrzucenie. Guard «pusta lista → rzut» zostaje tutaj
  celowo (S-04: zero kart po deduplikacji będzie odrębnym wynikiem warstwy zapisu)”.
  Komentarz `:115` („parsujemy bez kodu obronnego”) usunięty.
- Bez `zod`; bez zmian w `situations.ts` (koercja `? 1 : 0` zostaje — po walidacji jest
  tożsamością na booleanie).

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- Przed poprawką: `cd api && npx vitest run -t "Ryzyko #5"` pokazuje T5.5 (1), T5.6 (3),
  T5.7 (5), T5.8 (2), T5.9 (1), T5.10 (2) = **14 czerwonych**, T5.1–T5.4 zielone; wynik
  zapisany (które przez `resolves`, które przez klasę błędu) do notatki §6.7
- Po poprawce: `cd api && npx vitest run -t "Ryzyko #5"` zielone: 20 przypadków
- `cd api && npm test` w całości zielone: 83 testy (78 + 5 expected-fail); T2.1–T2.5, T3.x,
  T6.x bez zmian wyniku
- `cd api && npm run typecheck` zielone
- `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` = dokładnie
  `api/src/lib/flashcards.ts`
- `grep -n "zod" api/src/lib/flashcards.ts` puste

#### Weryfikacja ręczna:

- Deliberate-breaks T5.5, T5.6, T5.7 (2), T5.8, T5.9, T5.10 wykonane: każdy czerwieni
  dokładnie swoje wiersze, kod przywrócony, suite zielone
- `wrangler tail`-owy komunikat dla odmowy przeczytany w logu testu (opcjonalnie
  `console.error` z `situations.ts:108` widoczny w wyjściu Vitest): zawiera tekst odmowy

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej, zanim przejdziesz do Fazy 4. Jeśli
któryś z T5.5–T5.10 jest **zielony przed** poprawką, badanie się myli o tej ścieżce —
zapisz który i dlaczego (klasa błędu?) do §6.7, nie zmieniaj asercji „na siłę”.

---

## Faza 4: Ryzyko #5 — dowód integracyjny (nie przecieka do bazy ani do propozycji)

### Przegląd

Jeden `describe('Ryzyko #5: kontrakt generatora')` w `api/src/routes/situations.integration.test.ts`
(po bloku ryzyka #2): zdegenerowana odpowiedź → `failed`, zero wierszy, `proposals: []`;
mieszanka poprawnych kart → zapisane **wartości** `type` i `is_variant` i `type` w DTO.
Ta warstwa widzi poprawkę niezależnie od tego, czy żyje w parserze, czy (w przyszłości) w
`CHECK`. Smoke z prawdziwym kluczem.

### Wymagane zmiany:

#### 1. Testy integracyjne

**Plik**: `api/src/routes/situations.integration.test.ts` (nowy `describe`, reużycie
`TRANSCRIPT`, `makeCards`, `postAndFinish`, `readProposals`; import `chatResponseRaw`)

**Cel**: Obserwowalny skutek w kategoriach użytkownika: po zdegenerowanej odpowiedzi
wieczorem ekran Fiszki jest pusty z `failed` (nie: karta z pustą plakietką), a po poprawnej
— każda karta ma swój typ i pochodzenie.

**Umowa** (nagłówek `describe`: „Ta warstwa dowodzi «nie przecieka do bazy» niezależnie od
miejsca poprawki; T5.11 bez T5.12 byłby zielony dla walidatora odrzucającego wszystko”):
- **T5.11 `it.each` — model zwraca $label → `flashcards_status=failed`, zero kart, propozycje
  puste; `done` z transkryptem zachowane, brak odrzucenia w tle**: wiersze:
  `['kartę o typie spoza kontraktu', chatResponse([...makeCards(3) z drugą kartą type: 'idiom'])]`,
  `['odmowę (refusal, content null)', chatResponseRaw({ content: null, refusal: '…' })]`.
  `id = await postAndFinish(token, chat)` (w środku `waitOnExecutionContext` `resolves`);
  `readFlashcards(env, id)` `toHaveLength(0)`; `readSituation`: `flashcards_status === 'failed'`,
  `status === 'done'`, `transcript === TRANSCRIPT`; `readProposals(token)`: `proposals`
  `toEqual([])`, `generatingCount === 0`.
  - Regresja: przeciek `'idiom'` do INSERT (dziś realny — przed Fazą 3 wiersz 1 byłby
    czerwony: 3 karty, `done`); walidator przeniesiony/wyłączony; przyszła poprawka w
    `situations.ts` łapiąca błąd walidatora i zapisująca „to, co się dało”.
  - Źródło: badanie Summary 5, §5 (objaw UI), §7 (wiersz „najtańsza warstwa… plus jeden
    test integracyjny”); test-plan §2 #5 („przeciekają do bazy i UI”).
  - Brzeg: wadliwa karta w środku poprawnych (nie pierwsza) — dowód atomowości odrzucenia
    („nigdy 2 karty + failed”, spójne z ryzykiem #2).
  - Anty-wzorzec: asercja tylko `failed` bez `readFlashcards` długości 0 i bez `proposals: []`.
  - Deliberate-break: usuń sprawdzenie `type` z walidatora (`flashcards.ts`) → wiersz 1:
    3 wiersze z `'idiom'`, `done` → czerwony; wiersz 2 pozostaje zielony (odmowa pada na
    `content`). Osobno: przestań czytać `refusal` → wiersz 2 nadal `failed` (na braku
    treści) — **ten wiersz nie ma własnego deliberate-break na tej warstwie**; jego
    deliberate-break żyje w T5.9 (tekst odmowy). Zapisać to w komentarzu.
- **T5.12 mieszanka typów i wariantów → każda karta zapisana z własnym `type` i
  `is_variant` w kolejności tablicy; DTO propozycji niesie `type` z trójki**: jawny fixture
  6 kart (nie `makeCards` — wartości mają być czytelne w asercji): `('word', false)`,
  `('phrase', true)`, `('sentence', false)`, `('word', true)`, `('sentence', true)`,
  `('phrase', false)` z unikalnymi `front_en`; jedna karta `sentence` z `example_en: ''`.
  `readFlashcards(env, id).map(({ front_en, type, is_variant }) => ...)` `toEqual` projekcji
  fixture'a z `is_variant` jako `1`/`0` (INTEGER); `readProposals(token).proposals`:
  `toHaveLength(6)`, każda `['word','phrase','sentence']` `toContain(card.type)` (stała
  lokalna z cytatem PRD `:99`, nie import), mapa `front_en → type` równa fixture'owi;
  `flashcards_status === 'done'`.
  - Regresja: INSERT bindujący stałą zamiast `card.type`; `card.is_variant ? 1 : 0` → `0`
    (dziś żaden T2.x nie asertuje tych kolumn — T2.5 tylko `front_en` i `status`); walidator
    odrzucający poprawną mieszankę (np. `example_en: ''` uznane za wadliwe).
  - Źródło: badanie §6 („żaden T2.x nie asertuje zapisanych kolumn `type` ani `is_variant`”);
    §6.2 reguła „test oczekujący `failed` jest ślepy na dryf — sukces ma własny test”;
    T3.6 (`is_variant=1` z zasiewu, nie z generatora).
  - Brzeg: pusty `example_en` na ścieżce szczęśliwej (legalny, T5.3); wariant jako
    **ostatnia** karta nie jest ucinany (6 < 10).
  - Anty-wzorzec: asercja `toEqual(makeCards(6))` na surowych wierszach (zależność od
    kolumn `id`/`created_at`); import `GeneratedCard`.
  - Deliberate-breaks: (a) w `situations.ts:102` bind `'word'` zamiast `card.type` →
    czerwony; (b) bind `0` zamiast `card.is_variant ? 1 : 0` → czerwony.

#### 2. Smoke z prawdziwym kluczem

**Plik**: brak zmian; `api/scripts/test-flashcards.ps1`, `wrangler dev --port 3030`
(`lessons.md`), `api/.dev.vars`

**Cel**: Jedyny dowód, że żywa odpowiedź gpt-4o (z `refusal: null`, `finish_reason: 'stop'`)
przechodzi przez nowy walidator; mock zna kształt tylko z dokumentacji.

**Umowa**: jedno nagranie → transkrypt → `GET /flashcards/proposals` z ≥1 kartą, każda z
`type` z trójki; ekran Fiszki (lub odpowiedź JSON) bez pustej plakietki typu. Wynik
(liczba kart, typy, czy `refusal: null` było w surowej odpowiedzi — sprawdzić w logu
`wrangler dev` lub przez tymczasowy `console.log` usunięty przed commitem) zapisany do §6.7.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `cd api && npx vitest run -t "Ryzyko #5"` zielone: 20 jednostkowych + T5.11 (2) + T5.12 (1)
  = 23 przypadki
- `cd api && npm test` w całości zielone: 86 testów (81 + 5 expected-fail), ~8 s
- `cd api && npm run typecheck` zielone
- `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` = dokładnie
  `api/src/lib/flashcards.ts` (bez zmian w `situations.ts`)

#### Weryfikacja ręczna:

- Deliberate-breaks T5.11 (walidator bez `type`) i T5.12 (a, b) wykonane, kod przywrócony,
  suite zielone
- Smoke przez `wrangler dev` (3030) z prawdziwym kluczem: nagranie → transkrypt →
  propozycje z poprawnymi typami; brak `failed` na ścieżce szczęśliwej; obserwacja o
  `refusal`/`finish_reason` w żywej odpowiedzi zanotowana

**Uwaga implementacyjna**: Po zakończeniu tej fazy i zielonych weryfikacjach automatycznych
zatrzymaj się na potwierdzenie weryfikacji ręcznej (zwłaszcza smoke), zanim przejdziesz do
Fazy 5. Jeśli smoke daje `failed` z komunikatem walidatora, żywy kształt odpowiedzi różni się
od założeń — zatrzymaj się, zapisz surową odpowiedź (bez klucza) i wróć do `/10x-plan`.

---

## Faza 5: Follow-up S-02 F2 + książka kucharska §6.5 + notatka §6.7 + zamknięcie

### Przegląd

Kanoniczna odpowiedź na „jak dodać test kontraktu generatora”, utrwalenie kosztu `CHECK` w
SQLite bez wyboru opcji, notatka z tego, czego faza nauczyła, zamknięcie `change.md`. Bez
nowego kodu, bez edycji §1–§5.

### Wymagane zmiany:

#### 1. Follow-up: `CHECK` na enumach

**Plik**: `context/changes/testing-llm-generator-contract/follow-ups/enum-check-migration.md` (nowy)

**Cel**: S-02 F2 przestaje być bezpańskim `PENDING`; koszt, którego przegląd nie znał, jest
nazwany; wybór odłożony do slice'a dotykającego migracji.

**Umowa**: Sekcje: **Źródło** (S-02 review F2 `PENDING`,
`context/archive/2026-06-07-gated-ai-flashcard-generation/reviews/impl-review.md:37-54`;
badanie Fazy 3 §4; ryzyko #5 §2); **Co domyka Faza 3** (walidator w parserze: `type` z
trójki, `is_variant` boolean, cztery stringi — jedyna dzisiejsza ścieżka zapisu `type` to
generator; T5.5/T5.11 dowodzą); **Co zostaje** (zapis spoza generatora — dziś nie istnieje;
enumy `flashcards.status`, `situations.status`, `situations.flashcards_status` też bez
`CHECK`; `example_en` nullable mimo `required` w schemacie); **Koszt** (SQLite: brak `ALTER
TABLE … ADD CONSTRAINT` — `CHECK` na istniejącej tabeli = przebudowa: `CREATE TABLE
flashcards_new (… CHECK (type IN (…)) …)` → `INSERT INTO flashcards_new SELECT …` → `DROP
TABLE flashcards` → `ALTER TABLE … RENAME` → odtworzenie `idx_flashcards_user_status`,
`idx_flashcards_situation`; FK z `situations`; deploy dotyka ryzyka #4 — kolejność
migracja → deploy z checklisty S-03; harness aplikuje migrację automatycznie, T5.11/T5.12
zobaczą skutek bez zmian); **Opcje bez wyboru** (A: migracja 0005 z przebudową jak wyżej +
`NOT NULL DEFAULT ''` na `example_en`; B: accept-as-risk z walidatorem parsera jako jedyną
obroną — blind spot: przyszły zapis spoza generatora); **Kryterium zamknięcia** (decyzja
zapisana; przy A: migracja zaaplikowana, T5.11/T5.12 zielone, deliberate-break „usuń `type`
z walidatora” pada na `CHECK` zamiast przeciekać, wpis w §6.7); **Sugerowany moment**
(S-04 — dotyka generatora i `situations.ts`; albo `--refresh` gdy pojawi się druga ścieżka
zapisu fiszek).

#### 2. §6.5 — test kontraktu generatora (odpowiedź LLM → dane)

**Plik**: `context/foundation/test-plan.md` (sekcja `### 6.5`)

**Cel**: Wzorzec, który S-04 (filtr duplikatów dotykający generatora) skopiuje bez czytania
tej zmiany.

**Umowa**: Punkty w stylu §6.2–§6.4:
- **Location**: żądanie i parser — `api/src/lib/flashcards.test.ts`, `describe('Ryzyko #5:
  kontrakt generatora')` (mock `fetch` przez `vi.spyOn(globalThis, 'fetch').mockResolvedValue`,
  §6.1); dowód „nie przecieka do bazy” — `describe('Ryzyko #5 …')` w
  `api/src/routes/situations.integration.test.ts` (§6.2). Buildery: `chatResponse(cards)` dla
  poprawnych list, `chatResponseRaw({ content, refusal?, finish_reason? })` dla
  zdegenerowanych — oba w `api/test/openai-mock.ts`, jedyne źródło kształtu Chat Completions.
- **Naming**: `T5.<n>` + skutek („→ cała odpowiedź odrzucona”, „→ `failed`, zero kart,
  propozycje puste”); `it.each` z `$label` dla wariantów tej samej klasy (flaga, pole,
  `content`); deliberate-break w komentarzu, osobny dla każdej asercji.
- **Reference test**: T5.1 (kontrakt żądania ze stałymi-wyroczniami i asercją zbiorów, nie
  snapshotem), T5.2 (limit hardkodowany z cytatem S-03 F2), T5.5/T5.7 (helper
  `expectContractRejection` — rzut domenowy, nie `SyntaxError`/`TypeError`), T5.9 (tekst z
  fixture'a jako dowód czytania `refusal`), T5.11 + T5.12 (para „→ `failed`” + ramię
  kontrolne z wartościami kolumn).
- **Run locally**: `cd api && npx vitest run -t "Ryzyko #5"` (23 przypadki); sam parser:
  `cd api && npx vitest run src/lib/flashcards.test.ts`.
- **Reguły**: wyrocznia z PRD/archiwum, nigdy z implementacji (`MAX_CARDS`, `RESPONSE_FORMAT`,
  `GeneratedCard` nie są importowane; stałe testu z cytatem — zmiana limitu w kodzie MA
  zaczerwienić test); `messages` asertowane jako role i kształt, nigdy tekst promptu;
  schemat jako zbiory pól/enumu, nigdy snapshot; „→ rzut” asertowany klasą (domenowy) bez
  tekstu komunikatu — jedyny dopuszczalny tekst to ten z fixture'a (`refusal`); naruszenie
  kontraktu = cała odpowiedź odrzucona, pusta treść = odsiew (dwie różne klasy — nie mieszać
  w jednym `it.each`); każdy test „→ `failed`” ma partnera z wartościami zapisanych kolumn;
  guard „pusta lista → rzut” zostaje w generatorze (S-04: „zero po dedup” to wynik warstwy
  zapisu); jakość treści poza zakresem (§7); bez zod; test jednostkowy widzi tylko parser —
  „nie przecieka do bazy” wymaga pary z §6.2.
- **Uwaga**: `refusal: null` i `finish_reason` są w każdej żywej odpowiedzi — builder je
  odzwierciedla; walidator nie może odrzucać na obecności pola. `CHECK` w D1 nie jest
  addytywne w SQLite (zob. `follow-ups/enum-check-migration.md`). Fallback etykiety typu na
  froncie i `example_en.trim()` są poza wzorcem (brak runnera frontu, §7).

#### 3. Notatka §6.7 i nagłówek

**Plik**: `context/foundation/test-plan.md` (sekcja `### 6.7`, linia `Last updated`)

**Cel**: Odnotować, czego faza nauczyła; nie dotykać §1–§5.

**Umowa**: Blok „**Faza 3 — Kontrakt generatora LLM** (zamknięta <data>;
`context/changes/testing-llm-generator-contract/`)”, 4–6 linii: przeciek był realny
(`'idiom'` do INSERT, brak flagi → `0`, brak `example_en` → `NULL`) i 14 testów było
czerwonych przed poprawką (lista: które przez `resolves`, które przez klasę błędu);
walidator w parserze jako druga linia po Structured Outputs (decyzja: cała odpowiedź, nie
odsiew; komentarz „bez kodu obronnego” usunięty); asercja klasy błędu jako sygnał
„zamierzone vs przypadkowe”; `CHECK` w SQLite = przebudowa tabeli (follow-up); wynik
deliberate-breaks i smoke (kształt żywej odpowiedzi: `refusal: null`, `finish_reason`);
zaparkowane obserwacje (kolejność ucinania wariantów, brak `max_tokens`/timeoutu, białe
znaki niezormalizowane, fallback `TYPE_LABELS`) jako kandydaci do `--refresh`; suite po
Fazie 3: 9 plików, 86 testów (81 + 5 `it.fails`). `Last updated` = data zamknięcia.
**Żadnej edycji** w §1–§5.

#### 4. Zamknięcie zmiany

**Plik**: `context/changes/testing-llm-generator-contract/change.md`

**Cel**: Stan zmiany odzwierciedla zakończenie wdrożenia.

**Umowa**: `updated:` = data zamknięcia; `status` zgodnie z konwencją `/10x-implement`; w
`## Notes` dopisek: „Faza zamknięta; poprawka: walidator w `api/src/lib/flashcards.ts`
(cała odpowiedź odrzucana); follow-up: `follow-ups/enum-check-migration.md` (S-02 F2)”.

### Kryteria sukcesu:

#### Automatyczna weryfikacja:

- `grep -c "TBD — see §3 Phase 3" context/foundation/test-plan.md` = 0
- `git diff -U0 -- context/foundation/test-plan.md | grep '^@@'` — każdy hunk poza linią
  `Last updated` leży za nagłówkiem `## 6. Cookbook Patterns` (§1–§5 nietknięte)
- Plik `follow-ups/enum-check-migration.md` istnieje
- `cd api && npm test` zielone (bez zmian względem Fazy 4)

#### Weryfikacja ręczna:

- §6.5 przeczytane „na świeżo”: osoba bez kontekstu potrafi dodać test nowego pola karty
  (np. `difficulty` z przyszłego S-05) po obu stronach — schemat żądania i walidator — i
  wie, że wyrocznia idzie z PRD, nie z kodu

**Uwaga implementacyjna**: Po tej fazie plan jest w pełni `[x]`; kolejne uruchomienie
`/10x-test-plan` przejdzie do wiersza 4 tabeli §3 (bramki jakości).

---

## Strategia testowania

### Testy jednostkowe:

- `api/src/lib/flashcards.test.ts`, `describe('Ryzyko #5: kontrakt generatora')`: T5.1
  (żądanie), T5.2–T5.4 (przycięcie/odsiew/pusto), T5.5–T5.10 (odrzucenie domenowe). 20
  przypadków; 14 czerwonych przed walidatorem. Istniejące 6 testów `describe('generateFlashcards')`
  zostają (asercje schematu `:40-43` przeniesione do T5.1).

### Testy integracyjne:

- `api/src/routes/situations.integration.test.ts`, `describe('Ryzyko #5: kontrakt generatora')`:
  T5.11 (2 wiersze: `'idiom'`, `refusal`) + T5.12 (mieszanka → kolumny i DTO). Harness bez
  zmian poza `chatResponseRaw`.

### Kroki testowania ręcznego:

1. Faza 1: przeczytać nagłówek `openai-mock.ts`.
2. Faza 2–4: wykonać każdy nazwany deliberate-break, potwierdzić czerwony, przywrócić kod.
3. Faza 3: przed poprawką zapisać listę czerwonych testów i klasę błędu każdego.
4. Faza 4: smoke z prawdziwym kluczem przez `wrangler dev` na porcie 3030
   (`api/scripts/test-flashcards.ps1`); zanotować `refusal`/`finish_reason` z żywej odpowiedzi.
5. Faza 5: przeczytać §6.5 na świeżo.

## Uwagi dotyczące wydajności

- Walidator to pętla po ≤ kilkudziesięciu kartach w zadaniu tła — pomijalne. Nowe testy
  jednostkowe nie dotykają D1; dwa dodatkowe testy integracyjne dodają ~0,5 s (suite ~8 s).
- `waitOnExecutionContext` porzuca obietnice po 30 s; wszystkie mocki odpowiadają natychmiast.

## Uwagi dotyczące migracji

- Brak migracji w tej zmianie. Deploy nie wymaga `wrangler d1 migrations apply`. Wiersze już
  w produkcji (jeśli kiedykolwiek przeciekł `type` spoza trójki) nie są naprawiane — poza
  zakresem; `CHECK` i ewentualny backfill w follow-upie.
- Zmiana zachowania produkcyjnego: odpowiedź modelu, która dziś zapisałaby karty z `type`
  spoza trójki lub bez `example_en`, po zmianie kończy się `failed` (widoczne dla
  użytkownika jako brak fiszek z tej sytuacji). To zamierzone — ryzyko #5.
- Klient (`src/`) bez zmian.

## Referencje

- Powiązane badania: `context/changes/testing-llm-generator-contract/research.md`
- Umowa jakościowa: `context/foundation/test-plan.md` §2 (#5), §6.1, §6.2, §6.7, §7
- Wyrocznie: `context/foundation/prd.md:71-74, 99`;
  `context/archive/2026-06-07-gated-ai-flashcard-generation/plan.md` (pola karty),
  `reviews/impl-review.md:37-54` (S-02 F2);
  `context/archive/2026-06-09-same-context-variants/plan.md:19-24` (`is_variant`),
  `reviews/impl-review.md:49-56` (limit 10)
- Poprzednie fazy: `context/archive/2026-09-03-testing-worker-harness-background-jobs/plan.md`
  (precedens „test czerwony → poprawka → zielony”, T2.4/T2.5),
  `context/archive/2026-09-04-testing-route-contracts-ownership-day/plan.md` (T3.6 —
  `is_variant` z zasiewu; reguła ramienia kontrolnego)
- Wzorce w kodzie: `api/src/lib/flashcards.test.ts:22-44`, `api/test/openai-mock.ts:31-36`,
  `api/src/routes/situations.integration.test.ts:133-159, 161-264`
- Lekcje: `context/foundation/lessons.md` (port 3030 dla `wrangler dev`)

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dodaj ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków. Zobacz `references/progress-format.md`.

### Faza 1: Harness — surowy builder odpowiedzi chatu

#### Automatyczne

- [x] 1.1 `npm test` zielone: 9 plików, 63 testy (58 + 5 expected-fail), liczba bez zmian — 7c087d7
- [x] 1.2 `npm run typecheck` zielone — 7c087d7
- [x] 1.3 `grep -rn "function chatResponse" api/` = 1 definicja (`api/test/openai-mock.ts`) — 7c087d7
- [x] 1.4 `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` puste — 7c087d7

#### Ręczne

- [x] 1.5 Nagłówek `openai-mock.ts` przeczytany: wiadomo, kiedy `chatResponse`, a kiedy `chatResponseRaw` — 7c087d7

### Faza 2: Ryzyko #5 — kontrakt żądania i deterministyczne przycięcie

#### Automatyczne

- [x] 2.1 `npx vitest run -t "Ryzyko #5"` zielone: 6 przypadków (T5.1–T5.4) — 150d044
- [x] 2.2 `npm test` zielone: 69 testów (64 + 5 expected-fail) — 150d044
- [x] 2.3 `npm run typecheck` zielone — 150d044
- [x] 2.4 Brak importu/odwołania do `MAX_CARDS`/`RESPONSE_FORMAT` w `flashcards.test.ts` — 150d044
- [x] 2.5 `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` puste — 150d044

#### Ręczne

- [x] 2.6 Deliberate-breaks T5.1 (a–d), T5.2 (2), T5.3 (2), T5.4 (1) wykonane, kod przywrócony, suite zielone — 150d044

### Faza 3: Ryzyko #5 — odrzucenie odpowiedzi spoza kontraktu + walidator w generatorze

#### Automatyczne

- [x] 3.1 Przed poprawką: T5.5–T5.10 = 14 czerwonych, T5.1–T5.4 zielone; lista z klasą błędu zapisana — 48eccb3
- [x] 3.2 Po poprawce: `npx vitest run -t "Ryzyko #5"` zielone: 20 przypadków — 48eccb3
- [x] 3.3 `npm test` zielone: 83 testy (78 + 5 expected-fail) — 48eccb3
- [x] 3.4 `npm run typecheck` zielone — 48eccb3
- [x] 3.5 `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` = dokładnie `api/src/lib/flashcards.ts`; brak `zod` — 48eccb3

#### Ręczne

- [x] 3.6 Deliberate-breaks T5.5, T5.6, T5.7 (2), T5.8, T5.9, T5.10 wykonane, kod przywrócony, suite zielone — 48eccb3
- [x] 3.7 Komunikat odmowy widoczny w logu testu z tekstem odmowy — 48eccb3

### Faza 4: Ryzyko #5 — dowód integracyjny

#### Automatyczne

- [x] 4.1 `npx vitest run -t "Ryzyko #5"` zielone: 23 przypadki (20 + T5.11 ×2 + T5.12) — 0340ccf
- [x] 4.2 `npm test` zielone: 86 testów (81 + 5 expected-fail) — 0340ccf
- [x] 4.3 `npm run typecheck` zielone — 0340ccf
- [x] 4.4 `git diff --name-only HEAD -- api/src | grep -v '\.test\.ts$'` = dokładnie `api/src/lib/flashcards.ts` — 0340ccf

#### Ręczne

- [x] 4.5 Deliberate-breaks T5.11 (walidator bez `type`) i T5.12 (a, b) wykonane, kod przywrócony, suite zielone — 0340ccf
- [x] 4.6 Smoke z prawdziwym kluczem przez `wrangler dev` (3030): propozycje z poprawnymi typami; obserwacja `refusal`/`finish_reason` zanotowana — 0340ccf

### Faza 5: Follow-up S-02 F2 + książka kucharska §6.5 + notatka §6.7 + zamknięcie

#### Automatyczne

- [x] 5.1 Brak `TBD — see §3 Phase 3` w `test-plan.md`
- [x] 5.2 Hunki diffu `test-plan.md` wyłącznie w §6 (+ `Last updated`)
- [x] 5.3 `follow-ups/enum-check-migration.md` istnieje
- [x] 5.4 `npm test` zielone (bez zmian względem Fazy 4)

#### Ręczne

- [x] 5.5 §6.5 przeczytane na świeżo: wystarcza do dodania testu nowego pola karty po obu stronach

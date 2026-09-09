---
date: 2026-09-07T12:39:40+02:00
researcher: Marek Kalita (Claude Code)
git_commit: 87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b
branch: main
repository: kali82marek/my-english-day
topic: "Faza 3 planu testów — kontrakt generatora LLM (ryzyko #5): zdegenerowana odpowiedź modelu nie przecieka do bazy ani UI"
tags: [research, codebase, testing, llm-contract, structured-outputs, flashcards, generator, openai-mock, d1-schema, type-labels]
status: complete
last_updated: 2026-09-07
last_updated_by: Marek Kalita (Claude Code)
---

# Research: Faza 3 planu testów — kontrakt generatora LLM (ryzyko #5)

**Date**: 2026-09-07T12:39:40+02:00
**Researcher**: Marek Kalita (Claude Code)
**Git Commit**: 87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b
**Branch**: main
**Repository**: kali82marek/my-english-day

Permalinki: `https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/<ścieżka>#L<linia>` (skrót w tekście: `plik:linia`; pełne linki w sekcji *Code References*; commit lokalny — linki rozwiążą się po `git push`).

## Research Question

Ugruntować ryzyko #5 z `context/foundation/test-plan.md` §2 w kodzie: dla zdegenerowanej odpowiedzi modelu (nieznany `type`, brak flagi wariantu, pusta lista, 30 kart, pusty front) generator ma odrzucać (job → `failed`, zero wierszy) lub przycinać deterministycznie, a żądanie do modelu ma zawsze nieść ścisły schemat z polami wymaganymi. Zweryfikować wskazówki odpowiedzi (kwestionować „strict:true = nie trzeba kodu obronnego” i „jakość treści = kontrakt”), zlokalizować istniejące testy generatora, wskazać najtańszą użyteczną warstwę, oznaczyć ryzyka spekulatywne i mylące dowody hot-spotów. Dodatkowo: gdzie `type` dociera do UI (objaw „etykieta `undefined`”) i czy S-04 (filtr duplikatów) dotknie tej samej ścieżki.

## Summary

1. **Ścieżka awarii jest jednopunktowa i nieobroniona na żadnej warstwie poza schematem żądania.** Generator (`api/src/lib/flashcards.ts`) wysyła ścisły schemat (`strict: true`, enum na `type`, pięć pól `required`, `additionalProperties: false`), a odpowiedź parsuje gołym `JSON.parse` z komentarzem „Structured Outputs gwarantuje kształt — parsujemy bez kodu obronnego”. Baza nie ma żadnego `CHECK` (enum `type`/`status` żyje tylko w komentarzach SQL), trasa `GET /flashcards/proposals` oddaje wiersze bez warstwy mapowania, a front robi `TYPE_LABELS[card.type]` bez fallbacku. Nieznany `type` przechodzi z modelu do pustej plakietki w UI bez jednego punktu kontroli.
2. **Wskazówka odpowiedzi z §2 jest dziś spełniona tylko częściowo.** Pusta lista → `failed` (jawny rzut), 30 kart → 10 (`slice`), pusty `front_en`/`back_pl` → odsiew. Nieznany `type` → **przecieka**. Brakująca flaga `is_variant` → cicho `0` (koercja `? 1 : 0`). Uszkodzony JSON, `refusal`, `finish_reason: 'length'`, brakujące pole tekstowe → `failed`, ale **przypadkowo** (niezłapany `SyntaxError`/`TypeError` w gołym `catch` wywołującego), z mylącym komunikatem w logu.
3. **Założenie „strict:true = brak kodu obronnego” jest udokumentowaną decyzją, nie przeoczeniem** (plan S-02 :42, plan S-03 :22). Przegląd S-03 F2 obalił je dla liczby kart (`MAX_CARDS = 10` + filtr pustych, NAPRAWIONE), przegląd S-02 F2 (brak `CHECK` na enumach → `TYPE_LABELS[...] = undefined`) pozostaje **PENDING bez follow-upu**. Faza 3 dziedziczy ten otwarty wątek.
4. **Istniejące testy generatora (6 jednostkowych) pokrywają szczęśliwą ścieżkę, 429, pustą listę i brak `content`.** Schemat żądania jest przypięty tylko fragmentarycznie (`strict`, `is_variant` w `required` i jako `boolean`); enum `type`, pełna lista `required`, `additionalProperties` i limit kart nie mają żadnej asercji. Helper `chatResponse` z `api/test/openai-mock.ts` jest zduplikowany w teście jednostkowym i nie potrafi wyprodukować `refusal`, `finish_reason` ani nie-JSON-owego `content`.
5. **Najtańsza warstwa: unit/contract z mockiem `fetch` (§6.1) dla żądania i parsera, plus jeden test integracyjny (§6.2) jako dowód obserwowalny „nieznany `type` → `failed`, zero wierszy, puste propozycje”.** Test integracyjny jest potrzebny, bo poprawka luki może wylądować w generatorze albo w migracji `CHECK` — unit widzi tylko pierwsze.
6. **Wyrocznia z PRD jest wąska, ale wystarczająca:** trzy zamknięte typy (PRD Business Logic :99), AI dobiera podzbiór (FR-006 — jeden typ w odpowiedzi jest poprawny), warianty w tym samym wyjściu (decyzja planu S-03, nie PRD). **PRD nie podaje żadnej liczby kart** — „10” pochodzi z przeglądu S-03 F2, nie z produktu. Test przycięcia musi cytować tę decyzję jako wyrocznię, nie importować stałej z kodu.
7. **Ryzyko nie jest spekulatywne, a dowód hot-spotów nie jest mylący:** wszystkie pięć podscenariuszy z §2 ma konkretną ścieżkę w 127-liniowym module w `api/src/lib/`, który §2 cytuje jako katalog churnu. Jedna korekta sformułowania: dla nieznanego `type` kod dziś ani nie odrzuca, ani nie przycina — test tego scenariusza będzie **czerwony przed deliberate-break**, co wg reguły §6.3 oznacza „znana luka, decyzja w `/10x-plan`” (poprawka razem z testem, jak w Fazie 1, albo `it.fails` + follow-up, jak w Fazie 2).

## Detailed Findings

### 1. Żądanie do modelu — co jest przypięte schematem

`api/src/lib/flashcards.ts:13-17`:
```ts
const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';
// Twardy sufit kart na sytuację (baza + warianty). Strict mode nie wspiera
// maxItems, więc limit egzekwujemy po stronie kodu.
const MAX_CARDS = 10;
```

Schemat `api/src/lib/flashcards.ts:52-80` (skrót, pola istotne dla kontraktu):
```ts
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'flashcards',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['flashcards'],
      properties: { flashcards: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'front_en', 'back_pl', 'example_en', 'is_variant'],
        properties: {
          type: { type: 'string', enum: ['word', 'phrase', 'sentence'] },
          front_en: { type: 'string' }, back_pl: { type: 'string' },
          example_en: { type: 'string' }, is_variant: { type: 'boolean' },
        } } } },
    },
  },
} as const;
```

Ciało żądania `flashcards.ts:92-99`: `model`, `response_format`, `messages: [system, user(transcript)]`. **Nieobecne** (grep w `api/src/` bez trafień): `max_tokens`/`max_completion_tokens`, `temperature`, `seed`, timeout/`AbortSignal`, retry, `minItems`/`maxItems` (komentarz :15-16 tłumaczy: strict mode ich nie wspiera). Prompt systemowy to jeden literał `flashcards.ts:30-49` (~1180 znaków), prosi o „~2-3 WARIANTY … w tej samej tablicy `flashcards`” (:43-49).

Typ wewnętrzny `GeneratedCard` `flashcards.ts:19-27`: `type: 'word' | 'phrase' | 'sentence'`, `front_en`, `back_pl`, `example_en`, `is_variant: boolean` (snake_case).

### 2. Parsowanie odpowiedzi — macierz zachowań dziś

`api/src/lib/flashcards.ts:102-127`:
```ts
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI zwrócił ${res.status}: ${detail.slice(0, 500)}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI zwrócił odpowiedź bez treści.');
  }
  // Structured Outputs gwarantuje kształt — parsujemy bez kodu obronnego.
  const parsed = JSON.parse(content) as { flashcards: GeneratedCard[] };
  // Strict mode nie wspiera maxItems ani limitów długości — górny limit kart
  // i odsiew pustych egzekwujemy w kodzie.
  const cards = (parsed.flashcards ?? [])
    .filter((card) => card.front_en.trim() !== '' && card.back_pl.trim() !== '')
    .slice(0, MAX_CARDS);
  if (cards.length === 0) {
    throw new Error('Model nie wygenerował żadnych fiszek.');
  }
```

| Scenariusz z §2 / rozszerzony | Zachowanie dziś | Ocena względem „odrzuca lub przycina” |
|---|---|---|
| non-2xx | rzut ze statusem + 500 znaków ciała (:102-105) | odrzuca, jawnie |
| brak / pusty `content` (w tym `refusal` → `content: null`) | rzut „bez treści” (:111-113); `refusal` nie jest czytany (:107-109) | odrzuca, ale komunikat mylący |
| pusta lista `[]` | rzut „nie wygenerował żadnych fiszek” (:122-124) | odrzuca, jawnie |
| wszystkie karty z pustym `front_en`/`back_pl` | filtr :120 → pusto → ten sam rzut | odrzuca, jawnie |
| >10 kart (np. 30) | `slice(0, 10)` :121, **wg kolejności tablicy** — warianty na końcu są ucinane pierwsze | przycina deterministycznie |
| nieznany `type` (np. `'idiom'`) | **brak walidacji** — rzutowanie :116 to kłamstwo dla TS; karta idzie do INSERT | **ani nie odrzuca, ani nie przycina** |
| brak `is_variant` | **brak walidacji**; koercja `card.is_variant ? 1 : 0` w wywołującym (`situations.ts:102`) → cicho karta bazowa | **nie odrzuca**; cicha zmiana znaczenia |
| brak `front_en`/`back_pl` | `TypeError` z `.trim()` na `undefined` :120 → gołe `catch` wywołującego → `failed` | odrzuca **przypadkowo** |
| brak `example_en` | `undefined` do bind → D1 zapisze NULL (kolumna nullable) | **nie odrzuca**; front padnie (zob. §5) |
| uszkodzony JSON w `content` / `finish_reason: 'length'` | `SyntaxError` z gołego `JSON.parse` :116 → `failed` | odrzuca **przypadkowo**; `finish_reason` nie jest czytany |
| `flashcards` nie-tablica (obiekt/string) | `?? []` :119 chroni tylko `null`/`undefined`; `.filter` rzuci `TypeError` → `failed` | odrzuca przypadkowo |
| nadmiarowe pola w karcie | ignorowane (INSERT bierze jawne pola) | nieszkodliwe |
| białe znaki wokół `front_en` | `.trim()` jest tylko predykatem; wartość zapisana **bez** przycięcia | nie normalizuje (obserwacja, nie ryzyko #5) |

`zod@4.4.3` jest w `api/package-lock.json:58`, ale nie jest używany w `api/src/`.

### 3. Wywołujący — jak błąd generatora staje się `failed`

`api/src/routes/situations.ts:88-120` `generateAndStoreFlashcards`: `try { cards = await generateFlashcards(...); DB.batch([...INSERT × n, UPDATE flashcards_status='done']) } catch (err) { console.error(...); UPDATE flashcards_status='failed' }`.

- Gołe `catch (err)` :106 — wszystkie klasy błędów (HTTP, rzut generatora, `SyntaxError`, `TypeError`, błąd D1) zapadają się w to samo `failed`. Stąd „odrzucenie” dla uszkodzonego JSON jest dziś prawdziwe, ale niezamierzone.
- Atomowość: INSERT-y i `done` w jednym `DB.batch` :99-105 (produkt Fazy 1; T2.2 tego pilnuje). Pusta lista nigdy nie dociera do batcha (rzut wcześniej).
- INSERT :96-97 binduje `card.type` i `card.is_variant ? 1 : 0` :102 wprost — **żadnej walidacji między generatorem a D1**.
- Funkcja nigdy nie rzuca (:79-87); biegnie w `c.executionCtx.waitUntil` (:234-240). `status='done'` sytuacji zapisany przed generowaniem (:145-149) — awaria generatora nie cofa transkryptu.

Warianty (S-03): **jedno wywołanie, nie dwa** — model sam etykietuje `is_variant` (wymagane w schemacie :67); flaga wędruje model → `GeneratedCard` → bind → kolumna z `api/migrations/0004_add_flashcard_variant_flag.sql:12` (`INTEGER NOT NULL DEFAULT 0`). Nic nie pilnuje proporcji baza/wariant ani tego, że `slice` nie utnie wszystkich wariantów.

### 4. Schemat D1 — brak drugiej linii obrony

`api/migrations/0003_create_flashcards.sql:7-17`: `type TEXT NOT NULL` (enum tylko w komentarzu), `front_en`/`back_pl` `TEXT NOT NULL` bez `CHECK(length > 0)` (pusty string legalny), `example_en TEXT` **nullable**, `status TEXT NOT NULL DEFAULT 'proposed'` bez CHECK. `situations.flashcards_status` (:27) — `TEXT NOT NULL DEFAULT 'pending'`, dozwolone wartości tylko w komentarzu :25. `grep -rn CHECK api/migrations/` → zero trafień w czterech plikach. Przegląd S-02 F2 proponował `CHECK` w migracji 0004 — numer zajął `is_variant`, CHECK nigdy nie powstał.

### 5. Trasa i front — gdzie `type` staje się `undefined`

- `api/src/routes/flashcards.ts:37-41`: `SELECT id, situation_id, type, front_en, back_pl, example_en, created_at FROM flashcards WHERE user_id = ? AND status = 'proposed' ORDER BY created_at` → `.all<FlashcardDTO>()` → `c.json({ proposals: results, ... })` :52. `FlashcardDTO` :18-26 deklaruje unię trzech typów, ale to nieweryfikowany generic. Brak warstwy mapowania (potwierdzone w Fazie 2, `flashcards.integration.test.ts:70-72`).
- `src/lib/api.ts:180-188` typ `Flashcard` z `type: 'word' | 'phrase' | 'sentence'`; `apiFetch` :196-201 rzutuje JSON bez walidacji. `is_variant` nie istnieje po stronie klienta (celowo, S-03).
- `src/components/flashcard-card.tsx:22-27` `TYPE_LABELS: Record<Flashcard['type'], string>` i :45 `{TYPE_LABELS[card.type]}` — **bez fallbacku**; dla wartości spoza unii React Native renderuje pustą kolorową plakietkę (padding z `styles.typeBadge`), bez wyjątku. Jedyne miejsce w `src/` mapujące `type`.
- Sąsiednia pułapka `flashcard-card.tsx:38-39`: `card.example_en.trim()` — NULL z D1 (kolumna nullable, brak `example_en` w karcie → `undefined` → NULL) **rzuca** `TypeError` w komponencie. Schemat `required` chroni przed tym tylko dopóki jest w `required`.
- Ekran `src/app/(app)/flashcards.tsx:51-54, 111, 131-150`: jedna karta naraz, pusta lista obsłużona trójstanowo („Generuję…”, „Część fiszek mogła się nie wygenerować…”, „Brak fiszek do przejrzenia.”). Ekran nie dotyka `type`.

### 6. Istniejące testy — co już jest przypięte

`api/src/lib/flashcards.test.ts` (87 linii, 6 testów), wzorzec `vi.spyOn(globalThis, 'fetch').mockResolvedValue(...)` + `afterEach(vi.restoreAllMocks)`; lokalna kopia `chatResponse` :9-14.

| :linia | tytuł | asercje |
|---|---|---|
| :22 | buduje żądanie z modelem gpt-4o, Structured Outputs i transkryptem | URL, POST, `Bearer sk-test`, `model`, `response_format.type`, `strict === true`, `messages.at(-1)` = user/transcript, `item.required` **zawiera** `is_variant`, `is_variant.type === 'boolean'` (:28-43) |
| :46 | parsuje fiszki z odpowiedzi | `toHaveLength(2)`, `cards[0].front_en` |
| :53 | przenosi flagę `is_variant` z mieszanki | `toEqual(mixed)`, 2 warianty, `apple` nie-wariant |
| :68 | non-2xx → wyjątek | 429 → `/429/` |
| :75 | pusta lista → wyjątek | `chatResponse([])` → `/fiszek/i` |
| :80 | brak treści → wyjątek | `{ choices: [{ message: {} }] }` → `/treści/i` |

**Nie asertowane:** enum `type` (:69), pełna lista `required` (:66), `additionalProperties: false`, `json_schema.name`, top-level `required: ['flashcards']`, `MAX_CARDS`, filtr pustych, prompt systemowy (`messages[0]` — zgodnie z anty-wzorcem §2 ma tak zostać).

`api/src/routes/situations.integration.test.ts` Ryzyko #2 (T2.1–T2.5, :161-270): fixture `makeCards(n)` :133-142 (typy rotacyjnie, `is_variant: i % 2 === 1`); T2.4 :233 pusta lista → `failed` (komentarz :229-232 jawnie deleguje guard generatora do Fazy 3); T2.5 :246 dokładnie 10 kart → `done` (uzasadnienie: górna granica batcha D1, nie kontrakt). **Żaden T2.x nie asertuje zapisanych kolumn `type` ani `is_variant`.**

Helpery: `api/test/openai-mock.ts:31-36` `chatResponse(flashcards: unknown, status = 200)` — zawsze opakowuje `JSON.stringify({ flashcards })` w `choices[0].message.content`; **nie potrafi** dać `refusal`, `finish_reason`, `content: null`, nie-JSON-owego `content` ani uszkodzonego ciała HTTP. `mockOpenAI` :49-63 routuje po URL, nieznany URL → `Unmocked fetch`. `api/test/db.ts`: `readFlashcards(env, situationId)` :200 (`FlashcardRow` z `type: string`, `is_variant: number` :36-47), `seedFlashcard` :150 z `type?`/`isVariant?`, `resetDb` :262. `api/test/dto.ts:28-36, 72` `FlashcardDTO`/`FLASHCARD_DTO_KEYS`. Konfiguracja: `api/vitest.config.mts:36-38` (`include: src/**/*.test.ts, test/**/*.test.ts`, `setupFiles`), `api/package.json:9-10` (`test`, `typecheck`).

### 7. Weryfikacja wskazówek odpowiedzi z §2

| Element §2 | Werdykt | Uzasadnienie |
|---|---|---|
| „generator odrzuca (→ `failed`, zero wierszy) lub przycina deterministycznie” | **Częściowo prawdziwe** | Pusta lista, 30 kart, pusty front: tak, jawnie. Nieznany `type`: **nie** (przecieka). Brak flagi: nie (koercja do 0). Uszkodzony JSON/`refusal`/brak pola: tak, ale przypadkowo. |
| „żądanie zawsze niesie ścisły schemat z wymaganymi polami” | **Prawdziwe, słabo przypięte** | Schemat istnieje (:52-80); test pilnuje tylko `strict` i `is_variant`. Usunięcie `enum` z `type` lub `front_en` z `required` nie zaczerwieni niczego. |
| Kwestionować „strict:true = nie trzeba kodu obronnego” | **Potwierdzone jako realne założenie w kodzie i archiwum** | Komentarz `flashcards.ts:115`; plan S-02 :42, plan S-03 :22. Obalone raz (S-03 F2 → `MAX_CARDS`). Pozostały wektor: zmiana modelu/fallback/edycja schematu bez enum — test kontraktu żądania + guard w parserze zamykają go niezależnie od OpenAI. |
| Kwestionować „jakość treści = kontrakt” | **Trzyma się** | §7 wyklucza ocenę treści; kontrakt strukturalny to enum, pola, liczba, niepustość. Test nie może asertować, że `front_en` jest „po angielsku”. |
| Najtańsza warstwa: unit/contract z mockiem `fetch` | **Potwierdzone, z jednym dodatkiem** | Unit (§6.1) dla żądania i parsera. Plus **jeden** test integracyjny (§6.2) `T5.x nieznany type → failed, zero kart, propozycje puste` — jedyna warstwa, która widzi poprawkę niezależnie od tego, czy wyląduje w generatorze, czy w `CHECK` migracji, i jedyna, która dowodzi „nie przecieka do bazy”. |
| Anty-wzorzec: asercja tekstu promptu | **Aktualny** | Dziś test asertuje tylko `messages.at(-1)`; utrzymać. Pole `messages[0].role === 'system'` jest dopuszczalne (kształt, nie treść). |
| Anty-wzorzec: sędzia LLM | **Aktualny** | Brak w repo, nie wprowadzać. |
| Anty-wzorzec: wyrocznia z parsera | **Doprecyzowany** | Oczekiwania: trzy typy z PRD :99; podzbiór typów OK (FR-006 :71-72); `is_variant` jako boolean per karta i warianty w tej samej tablicy (decyzja S-03 plan :19-22); **limit 10 z S-03 review F2 :55-56**, nie z PRD ani ze stałej `MAX_CARDS` — test cytuje decyzję i hardkoduje 10. |
| Dowód hot-spotów `api/src/lib/` | **Nie jest mylący** | Awaria żyje dokładnie w `api/src/lib/flashcards.ts`; wywołujący w `api/src/routes/situations.ts` tylko przekazuje. |
| Ryzyko spekulatywne? | **Nie** | Każdy podscenariusz ma ścieżkę w kodzie. „Brak flagi” pod działającym strict jest mało prawdopodobny od OpenAI, ale ryzyko §2 brzmi „zmiana schematu”, a usunięcie `is_variant` z `required` nie zaczerwieni dziś niczego poza jedną asercją `toContain`. |

### 8. Objaw w UI i granica zakresu

Objaw „etykieta `undefined`” jest w pełni ugruntowany (§5), ale **poprawka fallbacku w `TYPE_LABELS` i test frontu są poza tą fazą**: §7 wyklucza runner frontu, a przeciek ma zostać zatrzymany przed bazą, nie zamaskowany na ekranie. Test integracyjny na `GET /flashcards/proposals` (pusta lista propozycji po zdegenerowanej odpowiedzi) jest najbliższym obserwowalnym dowodem dla użytkownika bez frontu.

### 9. S-04 i ta sama ścieżka

Filtr duplikatów (FR-008) musi porównać nowe karty z bazą użytkownika **między** `generateFlashcards` a `DB.batch` — czyli w `generateAndStoreFlashcards` (`situations.ts:88-120`) lub jako nowy krok w `lib/`. Testy Fazy 3 przypinają kontrakt generatora **przed** tą zmianą: po S-04 „zero kart po deduplikacji” stanie się nowym, legalnym przypadkiem (dziś zero kart = `failed`), więc T2.4 i nowe testy Fazy 3 muszą rozróżniać „model dał pusto” od „wszystko odfiltrowane”. To argument, by guard „pusta lista → rzut” został w generatorze (gdzie jest), a nie wędrował do warstwy zapisu.

## Code References

- [`api/src/lib/flashcards.ts:13-17`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/lib/flashcards.ts#L13-L17) — `MODEL`, `MAX_CARDS = 10` z komentarzem o braku `maxItems` w strict mode
- [`api/src/lib/flashcards.ts:19-27`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/lib/flashcards.ts#L19-L27) — `GeneratedCard` (snake_case, `is_variant: boolean`)
- [`api/src/lib/flashcards.ts:30-49`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/lib/flashcards.ts#L30-L49) — prompt systemowy (nie asertować treści)
- [`api/src/lib/flashcards.ts:52-80`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/lib/flashcards.ts#L52-L80) — `RESPONSE_FORMAT`: `strict`, `additionalProperties: false`, `required` × 5, `enum` na `type`
- [`api/src/lib/flashcards.ts:92-99`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/lib/flashcards.ts#L92-L99) — ciało żądania (brak `max_tokens`, `temperature`, timeoutu)
- [`api/src/lib/flashcards.ts:102-127`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/lib/flashcards.ts#L102-L127) — parser: gołe `JSON.parse`, filtr pustych, `slice(0, MAX_CARDS)`, rzut na pustą listę; brak walidacji `type`/pól
- [`api/src/routes/situations.ts:88-120`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/routes/situations.ts#L88-L120) — `generateAndStoreFlashcards`: gołe `catch` → `failed`; INSERT binduje `card.type` i `card.is_variant ? 1 : 0` bez walidacji
- [`api/src/routes/situations.ts:145-149, 164, 234-240`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/routes/situations.ts#L145-L149) — `done` przed generowaniem; wywołanie w `waitUntil`
- [`api/src/routes/flashcards.ts:18-26, 37-41, 52`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/routes/flashcards.ts#L18-L26) — `FlashcardDTO` jako nieweryfikowany generic; SELECT bez mapowania
- [`api/migrations/0003_create_flashcards.sql:7-17, 25-27`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/migrations/0003_create_flashcards.sql#L7-L17) — brak `CHECK`; `example_en` nullable; `flashcards_status` bez CHECK
- [`api/migrations/0004_add_flashcard_variant_flag.sql:12`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/migrations/0004_add_flashcard_variant_flag.sql#L12) — `is_variant INTEGER NOT NULL DEFAULT 0`
- [`src/lib/api.ts:180-188, 196-201`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/src/lib/api.ts#L180-L188) — typ `Flashcard`, rzutowanie bez walidacji
- [`src/components/flashcard-card.tsx:22-27, 38-39, 43-47`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/src/components/flashcard-card.tsx#L22-L27) — `TYPE_LABELS` bez fallbacku; `example_en.trim()` rzuca na NULL
- [`src/app/(app)/flashcards.tsx:51-54, 111, 131-150`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/src/app/(app)/flashcards.tsx#L51-L54) — konsumpcja propozycji, obsługa pustej listy
- [`api/src/lib/flashcards.test.ts:9-14, 22-43, 46-85`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/lib/flashcards.test.ts#L9-L14) — lokalny `chatResponse`, 6 testów, asercje żądania
- [`api/src/lib/transcription.ts:32-41`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/lib/transcription.ts#L32-L41), [`transcription.test.ts:11-49`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/transcription.test.ts#L11-L49) — bliźniaczy wzorzec (non-2xx → rzut, pusto → rzut)
- [`api/src/routes/situations.integration.test.ts:133-153, 161-270`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/routes/situations.integration.test.ts#L133-L153) — `makeCards`, `postAndFinish`, T2.1–T2.5
- [`api/src/routes/flashcards.integration.test.ts:70-75`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/src/routes/flashcards.integration.test.ts#L70-L75) — T3.6: brak `is_variant` w DTO mimo 1 w D1
- [`api/test/openai-mock.ts:26-63`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/test/openai-mock.ts#L26-L63) — `whisperResponse`, `chatResponse`, `mockOpenAI` (bez `refusal`/`finish_reason`)
- [`api/test/setup.ts:22-32`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/test/setup.ts#L22-L32) — migracje + guard niezamockowanego `fetch`
- [`api/test/db.ts:36-47, 150, 200, 262`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/test/db.ts#L36-L47) — `FlashcardRow`, `seedFlashcard`, `readFlashcards`, `resetDb`
- [`api/test/dto.ts:28-36, 72, 78`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/test/dto.ts#L28-L36) — `FlashcardDTO`, `FLASHCARD_DTO_KEYS`, `keysOf`
- [`api/vitest.config.mts:29, 36-38`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/vitest.config.mts#L29); [`api/package.json:9-10`](https://github.com/kali82marek/my-english-day/blob/87cf1ddd4bb9c3df9b6b5ac2598685fe56a06f2b/api/package.json#L9-L10)

## Architecture Insights

- **Kontrakt jest trójwarstwowy tylko na papierze.** Enum `type` istnieje jako: schemat JSON do OpenAI (egzekwowany przez dostawcę), komentarz SQL, typ TS w trzech miejscach (`GeneratedCard`, `FlashcardDTO` api, `Flashcard` front) i klucze `TYPE_LABELS`. Żadna z tych warstw nie sprawdza wartości w runtime po stronie projektu. Rozjazd między nimi wykrywa wyłącznie test, bo osobne `tsconfig` api/front nie widzą się nawzajem (reguła z §6.3).
- **Dwa rodzaje „odrzucenia”:** jawne rzuty domenowe (`non-2xx`, „bez treści”, „żadnych fiszek”) i przypadkowe wyjątki JS (`SyntaxError`, `TypeError`) — oba kończą w tym samym `failed` przez gołe `catch`. Test, który asertuje tylko `failed`, nie odróżni ich i przejdzie także wtedy, gdy ktoś „naprawi” `TypeError` przez `?.` i przepuści kartę bez `front_en` do INSERT (NOT NULL zatrzyma, ale `example_en` już nie). Asercje na `readFlashcards` (zero wierszy) i na kształcie/wartościach zapisanych kolumn są tu obowiązkowe.
- **`chatResponse` musi zyskać drugi, surowy tryb** (np. `chatResponseRaw({ content, refusal?, finish_reason? })` w `api/test/openai-mock.ts`), a `flashcards.test.ts` powinien przestać duplikować helper — inaczej rozszerzenie jednej kopii nie sięga drugiej.
- **Wzorzec §6.1 nadaje się do żądania i parsera** (czysta funkcja, mock `fetch`), ale dowód „nie przecieka do bazy” wymaga §6.2 — analogicznie do Fazy 1, gdzie T2.4 sprawdza niezmiennik warstwy zapisu, a nie guard generatora.
- **Ten sam bliźniaczy kształt w `transcription.ts`** (`non-2xx` → rzut ze statusem, pusto → rzut) sugeruje, że przyszły guard walidacji odpowiedzi może być jedną małą funkcją `assertGeneratedCard(card)` obok `validation.ts`, bez zod — ale to decyzja `/10x-plan`.

## Historical Context (from prior changes)

- `context/archive/2026-06-07-gated-ai-flashcard-generation/plan.md:42, 63, 115-146, 155` — decyzja „Structured Outputs eliminuje kod obronny”; miękkie „~3-5” tylko w prompcie; pusty wynik → `failed`; schemat bez `minItems`/`maxItems`.
- `context/archive/2026-06-07-gated-ai-flashcard-generation/reviews/impl-review.md:37-54` — **F2 PENDING**: brak `CHECK` na enumach; Fix A = CHECK w migracji (numer 0004 zajęty później), Fix B = accept-as-risk z blind spotem „zmiany modelu/fallbacku”.
- `context/archive/2026-06-09-same-context-variants/plan.md:19-24, 131` — jedno wywołanie, `is_variant` wymuszone schematem, „brak kodu obronnego”, AI dobiera liczbę.
- `context/archive/2026-06-09-same-context-variants/reviews/impl-review.md:49-56` — **F2 NAPRAWIONE**: `MAX_CARDS = 10` + filtr pustych; „nie polegać na `maxItems` w strict mode”. **Źródło liczby 10.**
- `context/archive/2026-09-03-testing-worker-harness-background-jobs/research.md:163, 326` — gwarancja „`done` ⇒ karty” jest jednopunktowa w generatorze; S-02 F2 wskazane jako „teren Fazy 3”.
- `context/archive/2026-09-03-testing-worker-harness-background-jobs/plan.md:105-107, 249-254, 444-452` — jawne wyłączenie kontraktu generatora z Fazy 1; projekt `chatResponse`; T2.4/T2.5 i ich uzasadnienie.
- `context/archive/2026-09-04-testing-route-contracts-ownership-day/research.md:125`, `plan.md:234, 426-432` — brak warstwy mapowania w propozycjach; T3.6; `seedFlashcard` z `type?`.
- `context/foundation/prd.md:71-74, 99` — FR-006/FR-007 i Business Logic: trzy typy, AI dobiera; **brak liczby kart**.
- `context/foundation/test-plan.md:51, 68, 81, 211-213, 246` — ryzyko #5, wskazówka odpowiedzi, wiersz Fazy 3, placeholder §6.5, wyłączenie jakości treści.

## Related Research

- `context/archive/2026-09-03-testing-worker-harness-background-jobs/research.md` — harness workerd, `chatResponse`, niezmiennik wszystko-albo-nic
- `context/archive/2026-09-04-testing-route-contracts-ownership-day/research.md` — kształt DTO propozycji, brak mapowania, `seedFlashcard`

## Open Questions

1. **Gdzie ma żyć guard na nieznany `type` (i brak flagi / pola)?** Opcje: (a) walidacja w parserze generatora — odrzuć całą odpowiedź (→ `failed`) albo odrzuć tylko wadliwe karty (→ deterministyczne przycięcie, pusto → `failed`); (b) `CHECK` w nowej migracji 0005 (zamyka S-02 F2 Fix A; batch pada → `failed`; dotyka ryzyka #4, ale harness aplikuje migracje, więc test to obejmie); (c) oba. Test integracyjny T5 jest zielony przy każdej z opcji; test jednostkowy tylko przy (a)/(c). Decyzja należy do `/10x-plan`; bez poprawki test nieznanego `type` jest czerwony przed deliberate-break (reguła §6.3 → `it.fails` + follow-up albo poprawka w fazie, jak Faza 1).
2. **Czy wyrocznią limitu jest 10?** PRD milczy; 10 to decyzja przeglądu S-03 F2. Test powinien cytować ją jako źródło i nie importować `MAX_CARDS`. Jeśli plan uzna liczbę za dowolną, asercja „≤ 10” jest nadal jedyną, która wykryje usunięcie `slice`.
3. **Czy przypadkowe odrzucenia (`SyntaxError`, `TypeError`) mają zostać jawne?** Zachowanie użytkownika (`failed`, zero wierszy) jest już spełnione; jawny komunikat i odczyt `refusal`/`finish_reason` to jakość logu, nie ryzyko #5. Test może przypiąć „→ rzut” bez wymuszania treści komunikatu (anty-wzorzec: asercja tekstu błędu).
4. **`example_en` nullable w D1 vs `card.example_en.trim()` na froncie** — poza ryzykiem #5 (schemat `required` chroni), kandydat do `--refresh` lub do tej samej migracji `CHECK`/`NOT NULL DEFAULT ''`, jeśli plan wybierze opcję (b).
5. **Kolejność ucinania przy >10 kart** (warianty na końcu tablicy giną pierwsze) — deterministyczne, ale czy produktowo pożądane? Poza zakresem testu kontraktu; notatka dla S-04/`--refresh`.

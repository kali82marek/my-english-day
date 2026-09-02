# Warianty fiszek w obrębie tego samego kontekstu (S-03) Implementation Plan

## Overview

Po wygenerowaniu fiszek bazowych z transkryptu sytuacji (S-02) system dokłada **warianty** — rozszerzenia ściśle w obrębie tego samego kontekstu (ten sam sklep/rozmowa, podmienione detale: inny produkt, inna kwota, inne pytanie). Warianty uczą elastyczności językowej zamiast papugowania jednej frazy (FR-007, deklarowana w PRD „kluczowa wartość"). Generowanie zostaje w **jednym wywołaniu LLM** — rozszerzamy istniejący prompt i schemat Structured Outputs tak, by ten sam call zwracał fiszki bazowe ORAZ ~2-3 warianty, oznaczając każdą kartę flagą pochodzenia. Warianty zapisywane są jako zwykłe propozycje (`status='proposed'`) z flagą `is_variant` widoczną tylko po stronie serwera. To slice **S-03** — wzbogaca działający pipeline generowania, równoległy do S-04 (dedup) i S-05 (powtórki).

## Current State Analysis

S-02 jest wdrożony i dostarcza kompletny pipeline generowania, na którym budujemy:

- **Generowanie (jedno wywołanie)**: `generateFlashcards(transcript, apiKey): Promise<GeneratedCard[]>` w `api/src/lib/flashcards.ts` — OpenAI Chat Completions (`gpt-4o`), `response_format` z `json_schema` (`strict: true`). `GeneratedCard = { type, front_en, back_pl, example_en }`. System prompt po polsku celuje w Kryterium sukcesu ≥70% (`api/src/lib/flashcards.ts:24-34`). Schemat: obiekt `{ flashcards: [...] }`, każdy item `required: [type, front_en, back_pl, example_en]`, `additionalProperties: false` (`flashcards.ts:37-64`).
- **Wpięcie w tle**: `generateAndStoreFlashcards(env, situationId, userId, transcript)` w `api/src/routes/situations.ts:71-98` — w `waitUntil` po udanej transkrypcji; pętla `INSERT INTO flashcards (situation_id, user_id, type, front_en, back_pl, example_en)` (`situations.ts:79-85`), potem `UPDATE situations SET flashcards_status='done'`; błąd → `'failed'`. Własny try/catch nie wywraca transkrypcji ani kasowania R2.
- **Dane**: tabela `flashcards` (`api/migrations/0003_create_flashcards.sql`) — `situation_id`, `user_id`, `type`, `front_en`, `back_pl`, `example_en`, `status` (`proposed`|`accepted`), `created_at`. Indeksy `(user_id, status)` i `(situation_id)`. Brak rozróżnienia bazowa/wariant.
- **Przegląd (front)**: `GET /flashcards/proposals` zwraca `FlashcardDTO` (`api/src/routes/flashcards.ts:17-26`) — bez `status` i `user_id`. Ekran `src/app/(app)/flashcards.tsx` pokazuje propozycje jedna po drugiej (kolejka), `src/components/flashcard-card.tsx` renderuje kartę z badge'm typu. Typ `Flashcard` i `flashcardsApi` w `src/lib/api.ts:180-210`.
- **Testy**: `api/src/lib/flashcards.test.ts` (5 testów — budowa żądania, parsowanie, mapowanie błędów). Runner `vitest`; `npm run typecheck` = `tsc --noEmit`.

### Key Discoveries:

- **Jedno wywołanie, nie dwa** — warianty dochodzą przez rozszerzenie istniejącego promptu i schematu, nie przez drugi call. Zero dodatkowego kosztu/latencji, pipeline `waitUntil` nietknięty (`situations.ts:122-123`).
- **`is_variant` tylko server-side** — DTO `/proposals` go NIE eksponuje (jak dziś `status`/`user_id`); front nie wymaga żadnej zmiany. UX przeglądu pozostaje jednorodny (warianty wmieszane niewidocznie).
- **Kolumna addytywna** — `ALTER TABLE flashcards ADD COLUMN is_variant INTEGER NOT NULL DEFAULT 0` (stały default) — istniejące wiersze stają się bazowe (`0`), istniejący INSERT nie wymaga zmian, brak backfillu. Wzorzec jak `0003` (`ALTER situations ADD COLUMN flashcards_status`).
- **Structured Outputs wymusza flagę** — `is_variant` jako `boolean` w schemacie (`required`, `additionalProperties: false` utrzymane) — model MUSI oznaczyć każdą kartę, brak kodu obronnego (jak komentarz w `flashcards.ts:99`).
- **AI dobiera liczbę** — prompt prosi o ~2-3 warianty zależnie od bogactwa sytuacji; uboga sytuacja może dać mniej, schemat nie wymusza sztywnej liczby (tablica `flashcards` bez `minItems`).
- **SQLite boolean = INTEGER** — `is_variant` przechowywany jako `0`/`1`; w INSERT mapujemy `card.is_variant ? 1 : 0`.
- **Lekcja zespołu**: dev server zawsze na porcie **3030** (`context/foundation/lessons.md`).

## What We're NOT Doing

- **Brak osobnego ekranu / sekcji wariantów** — warianty płyną tą samą kolejką `/proposals` co bazowe; żadnej zmiany w `flashcards.tsx`/`flashcard-card.tsx`.
- **Brak oznaczania wariantów w UI** — UX niewidoczne; `is_variant` nie trafia do DTO ani typu `Flashcard` na froncie.
- **Brak regeneracji / „daj więcej wariantów" na żądanie** — sytuacja generuje raz (`flashcards_status` przechodzi `pending`→`done`/`failed` i nie wraca, jak w S-02).
- **Brak edycji wariantów** — spójne z FR-009: w MVP tylko akceptuj/odrzuć.
- **Brak filtrowania duplikatów wariantów** — dedup to S-04; warianty z definicji nie są duplikatami (FR-008: „synonimy i warianty to różne fiszki i zostają").
- **Brak instrumentacji / analityki akceptacji** — weryfikacja strukturalna + manualna ocena jakości; observability nie istnieje jeszcze w projekcie (roadmap baseline).
- **Brak drugiego wywołania LLM** — generowanie wariantów dzieli ten sam call co bazowe.
- **Brak nowych endpointów** — warianty przechodzą istniejącym `GET /flashcards/proposals`; akceptacja/odrzucenie bez zmian.

## Implementation Approach

Slice jest **wyłącznie backendowy**. Rozszerzamy jeden typ, jeden schemat, jeden prompt i jeden INSERT, plus addytywna migracja. Najpierw warstwa danych (kolumna `is_variant`), potem generowanie: prompt instruuje model, by po fiszkach bazowych (z tego, co się wydarzyło) dołożył ~2-3 warianty ściśle w obrębie tego samego kontekstu, każdą kartę oznaczając `is_variant`. Schemat Structured Outputs wymusza obecność flagi. Zapis w tle dokłada kolumnę do INSERT (`card.is_variant ? 1 : 0`). Cykl `flashcards_status`, kasowanie R2, izolacja po `user_id`, DTO i cały front zostają bez zmian.

## Phase 1: Warstwa danych (Worker)

### Overview

Addytywna migracja dokładająca kolumnę `is_variant` do `flashcards`. Bez logiki — fundament pod oznaczanie generowanych wariantów w Fazie 2.

### Changes Required:

#### 1. Migracja: kolumna pochodzenia fiszki

**File**: `api/migrations/0004_add_flashcard_variant_flag.sql`

**Intent**: Odróżnić fiszki bazowe (z tego, co się wydarzyło) od wariantów (rozszerzenia kontekstu) na poziomie danych — pod pomiar i przyszłe S-04, bez ekspozycji na froncie.

**Contract**: `ALTER TABLE flashcards ADD COLUMN is_variant INTEGER NOT NULL DEFAULT 0;` — wartości `0` (bazowa) | `1` (wariant). Addytywne, stały default: istniejące wiersze stają się bazowe, istniejący INSERT z S-02 nadal działa (kolumna przyjmuje default), brak backfillu. Wzorzec jak `ALTER` w `0003`.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto lokalnie: `cd api && npx wrangler d1 migrations apply my-english-day-db --local`
- Typecheck przechodzi: `cd api && npm run typecheck`

#### Manual Verification:

- Kolumna `is_variant` istnieje w `flashcards` z domyślną `0` (`cd api && npx wrangler d1 execute my-english-day-db --local --command "PRAGMA table_info(flashcards)"`).
- Istniejące wiersze (jeśli są) mają `is_variant = 0`.

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poproś o ręczne potwierdzenie przed Fazą 2.

---

## Phase 2: Generowanie wariantów (LLM + zapis)

### Overview

Rozszerzenie pojedynczego wywołania generowania o warianty: typ, schemat Structured Outputs i system prompt, oraz zapis flagi `is_variant` w INSERT. Plus aktualizacja testów jednostkowych generatora.

### Changes Required:

#### 1. Typ, schemat i prompt generatora

**File**: `api/src/lib/flashcards.ts`

**Intent**: Sprawić, by ten sam call OpenAI zwracał fiszki bazowe i ~2-3 warianty w obrębie tego samego kontekstu, każdą oznaczoną flagą pochodzenia. Schemat wymusza obecność flagi (bez kodu obronnego).

**Contract**:
- `GeneratedCard` rozszerzony o `is_variant: boolean`.
- Schemat Structured Outputs (`RESPONSE_FORMAT`): w `properties` itemu dodać `is_variant: { type: 'boolean' }`; dopisać `'is_variant'` do `required`; zachować `additionalProperties: false`.
- `SYSTEM_PROMPT` rozszerzony: po instrukcji o fiszkach bazowych dodać sekcję o wariantach — wygeneruj dodatkowo ~2-3 warianty ściśle w obrębie tego samego kontekstu (ta sama sytuacja/miejsce/rozmowa, podmienione detale: inny produkt, inna kwota, inne pytanie), NIE wychodząc poza kontekst; warianty mają uczyć elastyczności, nie być oderwane; oznacz `is_variant: true` dla wariantów i `is_variant: false` dla fiszek z tego, co faktycznie opisano. Liczba wariantów dobrana do bogactwa sytuacji (uboga → mniej).
- Parsowanie bez zmian strukturalnych — `parsed.flashcards` niesie teraz pole `is_variant` na każdej karcie.

#### 2. Zapis flagi w generowaniu w tle

**File**: `api/src/routes/situations.ts`

**Intent**: Utrwalić pochodzenie każdej karty przy zapisie propozycji.

**Contract**: W `generateAndStoreFlashcards` rozszerzyć `INSERT INTO flashcards` o kolumnę `is_variant` i bind `card.is_variant ? 1 : 0` (SQLite boolean = INTEGER). Reszta (pętla, `UPDATE flashcards_status`, try/catch, kolejność względem kasowania R2) bez zmian.

#### 3. Testy generatora

**File**: `api/src/lib/flashcards.test.ts`

**Intent**: Pokryć rozszerzony kontrakt — schemat zawiera `is_variant`, parsowanie przenosi flagę, mieszanka bazowych i wariantów wraca poprawnie.

**Contract**: Zaktualizować istniejące asercje budowy żądania o obecność `is_variant` w schemacie (`required` + `properties`). Dodać/rozszerzyć test parsowania o mock odpowiedzi z mieszanką `is_variant: true/false` i sprawdzić, że `GeneratedCard[]` niesie flagę. Mock `fetch` jak w istniejących testach.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `cd api && npm run typecheck`
- Testy przechodzą: `cd api && npm test`

#### Manual Verification:

- `cd api && npx wrangler dev --port 3030`; po nagraniu sytuacji (ścieżka S-01/S-02) i transkrypcji, w `flashcards` dla tej sytuacji istnieją wiersze `is_variant=1` (~2-3) obok bazowych `is_variant=0` (`wrangler d1 execute ... --local --command "SELECT type, front_en, is_variant FROM flashcards WHERE situation_id=<id>"`).
- Manualna ocena jakości: warianty trzymają się tego samego kontekstu co transkrypt (to samo miejsce/rozmowa, podmienione detale), nie są oderwane ani nie powielają dosłownie fiszek bazowych.
- Regresja: `GET /flashcards/proposals` nadal zwraca propozycje bez pola `is_variant`; ekran „Fiszki" działa bez zmian (warianty wmieszane); `flashcards_status` przechodzi `pending`→`done`; akceptuj/odrzuć działają.

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poproś o ręczne potwierdzenie (wymaga realnego klucza OpenAI + wdrożonego S-02) — w tym o ocenę jakości wariantów.

---

## Testing Strategy

### Unit Tests:

- `generateFlashcards` — schemat żądania zawiera `is_variant` (`required` + `properties.is_variant.type === 'boolean'`); parsowanie odpowiedzi z mieszanką `is_variant: true/false` zwraca `GeneratedCard[]` z poprawną flagą; mapowanie non-2xx i pustej listy na wyjątek bez zmian (mock `fetch`).

### Integration Tests:

- Przeciw `wrangler dev`: po transkrypcji sytuacja `done` → wiersze `flashcards` z mieszanką `is_variant=0/1`; `flashcards_status='done'`; `GET /flashcards/proposals` zwraca wszystkie propozycje (bazowe + warianty) bez pola `is_variant`; akceptacja/odrzucenie i izolacja po `user_id` bez regresji.

### Manual Testing Steps:

1. Zaloguj się, nagraj polską sytuację z wyraźnym kontekstem (np. zakupy: „byłem w sklepie, kupiłem jabłka za 5 zł, zapytałem o pomidory").
2. Poczekaj na transkrypt i generowanie; w D1 sprawdź `SELECT type, front_en, is_variant FROM flashcards WHERE situation_id=<id>` — powinny być fiszki bazowe (`0`) i ~2-3 warianty (`1`).
3. Oceń jakość: warianty trzymają ten sam kontekst (sklep/zakupy), podmieniają detale (inny owoc, inna kwota, inne pytanie), nie są oderwane.
4. Otwórz zakładkę „Fiszki" — warianty wmieszane w kolejkę, nieodróżnialne, akceptuj/odrzuć działają.
5. Wymuś błąd generowania (zły klucz) — `flashcards_status='failed'`, transkrypt zachowany, brak częściowych wierszy.

## Performance Considerations

- Generowanie pozostaje jednym wywołaniem LLM na sytuację — koszt/latencja praktycznie bez zmian względem S-02 (większa odpowiedź o ~2-3 karty). Brak drugiego callu świadomie wybrany pod roadmapową niewiadomą o koszcie.
- Pętla INSERT rośnie o ~2-3 wiersze; nieistotne przy generowaniu w tle (`waitUntil`). (Ewentualna zamiana na `DB.batch` to znana, osobna optymalizacja z review S-02 — poza zakresem tego slice'a.)

## Migration Notes

- Nowa migracja `0004_add_flashcard_variant_flag.sql` — addytywna, wymaga istniejącej tabeli `flashcards` (migracja `0003` z S-02). Stosować lokalnie (`--local`) i na produkcji (`wrangler d1 migrations apply my-english-day-db --remote`) przy deployu.
- Brak nowych bindingów (używa `DB` + `OPENAI_API_KEY`). Brak backfillu — `DEFAULT 0` czyni istniejące wiersze bazowymi.

## References

- Roadmap: `context/foundation/roadmap.md` (S-03, Stream B, równoległy do S-04/S-05)
- PRD: `context/foundation/prd.md` (FR-007, FR-008, Business Logic, Kryterium sukcesu ≥70%)
- Prerekwizyt (wdrożony): `context/changes/gated-ai-flashcard-generation/plan.md` (kontrakt generowania, `flashcards`)
- Generator: `api/src/lib/flashcards.ts:24-106`
- Wpięcie w tle: `api/src/routes/situations.ts:71-98`
- Migracja S-02: `api/migrations/0003_create_flashcards.sql`
- Lekcja: dev na porcie 3030 (`context/foundation/lessons.md`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Warstwa danych (Worker)

#### Automated

- [x] 1.1 Migracja stosuje się czysto lokalnie (`wrangler d1 migrations apply --local`) — f29082b
- [x] 1.2 Typecheck przechodzi (`api && npm run typecheck`) — f29082b

#### Manual

- [ ] 1.3 Kolumna `is_variant` istnieje w `flashcards` z domyślną `0`
- [ ] 1.4 Istniejące wiersze mają `is_variant = 0`

### Phase 2: Generowanie wariantów (LLM + zapis)

#### Automated

- [x] 2.1 Typecheck przechodzi (`api && npm run typecheck`) — e56b110
- [x] 2.2 Testy przechodzą (`api && npm test`) — e56b110

#### Manual

- [ ] 2.3 Po transkrypcji w `flashcards` istnieją wiersze `is_variant=1` (~2-3) obok bazowych `is_variant=0`
- [ ] 2.4 Warianty trzymają się kontekstu (podmienione detale), nie powielają dosłownie fiszek bazowych
- [ ] 2.5 Regresja: `GET /flashcards/proposals` bez pola `is_variant`; ekran „Fiszki" i akceptuj/odrzuć działają

# Generowanie fiszek AI z akceptacją (S-02) Implementation Plan

## Overview

Po zapisaniu i stranskrybowaniu sytuacji (S-01) system **automatycznie, w tle** generuje z każdego transkryptu zestaw angielskich fiszek (AI dobiera typy: słówko / zwrot / zdanie, ~3-5 na sytuację). Użytkownik otwiera wieczorem zakładkę „Fiszki", przegląda propozycje jedna po drugiej i każdą akceptuje lub odrzuca; zaakceptowane od razu trafiają do bazy nauki (wiersze `status='accepted'`), odrzucone są kasowane. To slice **S-02 — gwiazda przewodnia** roadmapy: pierwszy moment, w którym da się zmierzyć główne Kryterium sukcesu PRD („≥70% fiszek akceptowanych bez poprawek").

## Current State Analysis

W kodzie jest wyłącznie **F-01** (auth). **S-01 (`capture-situation-by-voice`) ma zatwierdzony plan, ale NIE jest jeszcze zaimplementowany** — brak tabeli `situations`, routera `/situations`, klienta Whisper, audio. S-02 jest twardo zależne od S-01 i buduje na jego kontrakcie.

**Backend (Hono Worker, `api/`):**
- Tabela `users` (`api/migrations/0001_create_users.sql`); raw SQL + `RETURNING`, bez ORM.
- Middleware `requireAuth` (`api/src/middleware/auth.ts`) → `c.set('userId', payload.sub)` (string), pobierane przez `c.get('userId')`.
- `api/src/index.ts`: CORS + `GET /health` + `app.route('/auth', authRouter)`. Typy środowiska w `api/src/types.ts` (`AppEnv` = `Bindings` + `Variables`).
- Wzorzec endpointu chronionego (`api/src/routes/auth.ts:25-100`): `c.env.DB.prepare(...).bind(...).first<T>()`, odpowiedzi `c.json({...}, status)`, komunikaty po polsku. Walidacja własna (`api/src/lib/validation.ts`).
- Test runner: `vitest`; `npm run typecheck` = `tsc --noEmit`. Dev: `wrangler dev --port 3030`.
- `OPENAI_API_KEY` ustawiony w Cloudflare wg roadmapy; w kodzie **referencowany dopiero od S-01** (typ w `Bindings` dochodzi w Fazie 1 S-01).

**Kontrakt z S-01, na którym budujemy (z `capture-situation-by-voice/plan.md`):**
- Tabela `situations`: `id` (INTEGER PK), `user_id` (FK users), `transcript` (TEXT NULL), `status` (`pending`|`done`|`failed`), `audio_key` (TEXT NULL), `duration_ms` (INTEGER NULL), `created_at` (TEXT). Migracja `0002_create_situations.sql`.
- Router `api/src/routes/situations.ts` z `POST/GET/DELETE /situations`. **Kluczowy punkt wpięcia S-02:** funkcja `transcribeAndFinalize(...)` uruchamiana przez `c.executionCtx.waitUntil(...)`; jej gałąź sukcesu robi `UPDATE situations SET transcript=?, status='done' WHERE id=?`. Tu dokładamy generowanie fiszek.
- `GET /situations` zwraca wiersze dnia bieżącego; kształt wiersza do klienta: `{ id, status, transcript, duration_ms, created_at }`.
- Front: typ `Situation` i `situationsApi.{create,list,remove}` w `src/lib/api.ts`; ekran `(app)/index.tsx` z listą sytuacji dnia + polling dopóki istnieją `pending`.

**Frontend (Expo SDK 56, `src/`):**
- Routing chroniony: `src/app/_layout.tsx` → `Stack.Protected` na `(app)`/`(auth)` wg `status` z `useAuth()` (`src/contexts/auth-context.tsx`).
- Nawigacja: `src/components/app-tabs.tsx` — `NativeTabs` z dwoma trigger'ami: `index` (Home) i `explore` (placeholder z szablonu, `src/app/(app)/explore.tsx`). Ikony z `@/assets/images/tabIcons/*.png`.
- Klient `apiFetch<T>(path, opts)` (`src/lib/api.ts:67`) z auto-`Authorization: Bearer`, `ApiError` z polem `status`. Stan przez React Context + lokalny `useState`. Theming: `ThemedText`/`ThemedView`, `Colors`, `Spacing` (`src/constants/theme.ts`).
- `app.json` → `extra.apiBaseUrl` (domyślnie `http://localhost:3030`).

## Desired End State

Zalogowany użytkownik, który nagrał sytuacje (S-01), po ich transkrypcji widzi w zakładce „Fiszki" gotowe propozycje fiszek angielskich. Każda fiszka ma: angielski front, polskie tłumaczenie, typ (słówko/zwrot/zdanie) i — gdy sensowny — angielski przykład użycia. Użytkownik przegląda je pojedynczo i klika **Akceptuj** (fiszka → baza nauki) lub **Odrzuć** (fiszka znika). Gdy generowanie wciąż trwa, zakładka pokazuje stan „generuję…" i sama się odświeża; przy braku propozycji — czytelny stan pusty.

**Weryfikacja:** na urządzeniu/symulatorze (z wdrożonym S-01) — nagranie sytuacji → po transkrypcji w ciągu kilku-kilkunastu sekund w zakładce „Fiszki" pojawia się ~3-5 propozycji; `POST /flashcards/:id/accept` przenosi fiszkę do `accepted`, odrzucenie kasuje wiersz; `GET /flashcards/proposals` zwraca wyłącznie propozycje (`status='proposed'`) zalogowanego użytkownika; restart aplikacji zachowuje stan (dane w D1).

### Key Discoveries:

- **S-01 jest prerekwizytem niezaimplementowanym** — generowanie wpina się w `transcribeAndFinalize` z `api/src/routes/situations.ts` (plik tworzony w S-01). Bez wdrożonego S-01 Faza 2 nie ma się w co wpiąć.
- Wzorzec endpointu chronionego do skopiowania 1:1: `authRouter` (`api/src/routes/auth.ts:25-100`) — raw SQL, `RETURNING`, `requireAuth`, `c.get('userId')`, komunikaty PL.
- `c.executionCtx.waitUntil(...)` utrzymuje invocation po zwróceniu odpowiedzi — generowanie idzie tym samym kanałem co transkrypcja w S-01 (nie blokuje odpowiedzi HTTP).
- OpenAI Chat Completions ze **Structured Outputs** (`response_format: { type: 'json_schema', strict: true }`) gwarantuje kształt JSON bez parsowania-na-nadzieję — eliminuje kod obronny na walidację odpowiedzi LLM.
- `flashcards.status` potrzebuje tylko `'proposed' | 'accepted'` (odrzucone są kasowane, nie przechowywane).
- Idempotencję generowania pilnuje **`situations.flashcards_status`** (`pending`|`done`|`failed`): generuj tylko gdy `pending`, ustaw `done`/`failed` po próbie — chroni przed podwójnym generowaniem i daje frontowi sygnał „generuję…".
- SQLite `ALTER TABLE situations ADD COLUMN flashcards_status TEXT NOT NULL DEFAULT 'pending'` jest dozwolone (stały default) — addytywne, istniejący `INSERT` z S-01 nie wymaga zmian.
- Nawigacja: `NativeTabs` w `src/components/app-tabs.tsx` — zamiana trigger'a `explore` na `flashcards` + przepisanie ekranu `(app)/explore.tsx`.
- Lekcja zespołu: dev server zawsze na porcie **3030**.

## What We're NOT Doing

- **Brak filtrowania duplikatów (FR-008)** — to S-04. Na małej/pustej bazie duplikatów nie ma; świadomie odłożone.
- **Brak wariantów w obrębie kontekstu (FR-007)** — to S-03. S-02 generuje fiszki tylko z tego, co w transkrypcie.
- **Brak sesji powtórek / SRS (FR-011, FR-012)** — to S-05. „Baza nauki" w S-02 = po prostu wiersze `status='accepted'`; bez pól SRS (interwały, oceny) — dochodzą w S-05.
- **Brak edycji fiszek** — FR-009 wprost: tylko akceptuj/odrzuć w MVP.
- **Brak ekranu listy zaakceptowanych fiszek** — S-02 kończy się na akceptacji; przeglądanie bazy nauki to domena S-05.
- **Brak ręcznego przycisku „generuj"** — generowanie jest automatyczne po transkrypcji.
- **Brak przechowywania odrzuconych** — odrzucenie kasuje wiersz (decyzja użytkownika).
- **Brak Cloudflare Queues / Durable Objects** — `waitUntil` wystarcza dla MVP (jak w S-01).
- **Brak regeneracji na żądanie** — sytuacja generuje fiszki dokładnie raz (`flashcards_status` przechodzi `pending`→`done`/`failed` i nie wraca).

## Implementation Approach

Generowanie w tle, sprzęgnięte z transkrypcją S-01. Gdy `transcribeAndFinalize` z S-01 zakończy transkrypcję sukcesem (`status='done'`), w tym samym `waitUntil` dokładamy krok: wywołanie LLM (gpt-4o + Structured Outputs) na transkrypcie, `INSERT` zwróconych fiszek (`status='proposed'`) i `UPDATE situations SET flashcards_status='done'`; przy błędzie/pustym wyniku → `flashcards_status='failed'`. Front w zakładce „Fiszki" pobiera propozycje (`GET /flashcards/proposals`), renderuje je pojedynczo z przyciskami, a dopóki istnieją sytuacje w trakcie generowania (`status='done'` + `flashcards_status='pending'`) — krótko odpytuje (jak polling z S-01), z twardym limitem wieku chroniącym przed osieroconym `pending`. Akceptacja woła `POST /flashcards/:id/accept`, odrzucenie `DELETE /flashcards/:id`. Fazowanie jest lustrem S-01: najpierw warstwa danych Workera, potem generowanie + endpointy, potem klient front, na końcu ekran + nawigacja.

## Critical Implementation Details

- **Timing & lifecycle** — generowanie MUSI biec wyłącznie w `c.executionCtx.waitUntil(...)`, po wysłaniu odpowiedzi `201` z `POST /situations` (S-01). Kolejność w tle: (1) transkrypcja → `status='done'`, (2) generowanie fiszek → `INSERT` + `flashcards_status='done'`, dopiero potem (3) `DELETE` z R2 (logika S-01). Generowanie nie może opóźniać kroku transkrypcji ani kasowania R2 w sposób tracący dane.
- **State sequencing** — `flashcards_status` zmienia się dopiero PO udanym transkrypcie; jeśli transkrypcja zakończy się `failed`, generowanie się nie odpala, a front nie traktuje takiej sytuacji jako „generuję" (polling fiszek warunkowany `situation.status==='done'`). Idempotencja: generuj tylko gdy `flashcards_status==='pending'`.
- **User experience spec** — generowanie jest niewidoczne na ścieżce nagrywania (NFR szybkości dotyczy zapisu sytuacji, nie fiszek). W zakładce „Fiszki" trwające generowanie ma czytelny stan „generuję fiszki…" z auto-odświeżaniem; po wyczerpaniu propozycji — stan pusty („Brak fiszek do przejrzenia"). Twardy limit wieku pollingu (~90 s od `created_at` sytuacji) zamienia osierocone `flashcards_status='pending'` na stan błędu i zatrzymuje odpytywanie.

## Phase 1: Warstwa danych (Worker)

### Overview

Tworzy tabelę `flashcards` i dokłada kolumnę `flashcards_status` do `situations`. Bez logiki HTTP — fundament danych pod generowanie i endpointy z Fazy 2.

### Changes Required:

#### 1. Migracja: tabela flashcards + kolumna stanu generowania

**File**: `api/migrations/0003_create_flashcards.sql`

**Intent**: Tabela fiszek per-użytkownik, zakotwiczona w sytuacji, z cyklem propose/accept; oraz kolumna na `situations` śledząca stan generowania (idempotencja + sygnał dla frontu).

**Contract**: Tabela `flashcards`: `id` (INTEGER PK AUTOINCREMENT), `situation_id` (INTEGER NOT NULL REFERENCES situations(id)), `user_id` (INTEGER NOT NULL REFERENCES users(id)), `type` (TEXT NOT NULL — `word`|`phrase`|`sentence`), `front_en` (TEXT NOT NULL), `back_pl` (TEXT NOT NULL), `example_en` (TEXT NULL — może być puste, gł. dla typu `sentence`), `status` (TEXT NOT NULL DEFAULT 'proposed' — `proposed`|`accepted`), `created_at` (TEXT NOT NULL DEFAULT (datetime('now'))). Indeksy: `idx_flashcards_user_status` na `(user_id, status)` (pod listę propozycji i bazę nauki), `idx_flashcards_situation` na `(situation_id)`. Plus: `ALTER TABLE situations ADD COLUMN flashcards_status TEXT NOT NULL DEFAULT 'pending';` (wartości `pending`|`done`|`failed`).

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto lokalnie: `cd api && npx wrangler d1 migrations apply my-english-day-db --local`
- Typecheck przechodzi: `cd api && npm run typecheck`

#### Manual Verification:

- Tabela `flashcards` istnieje w lokalnym D1 z poprawnym schematem (`wrangler d1 execute ... --local --command "PRAGMA table_info(flashcards)"`).
- Kolumna `flashcards_status` istnieje w `situations` z domyślną wartością `pending` (`PRAGMA table_info(situations)`).

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poproś o ręczne potwierdzenie przed Fazą 2. Wymaga wdrożonej migracji `0002` z S-01 (tabela `situations` musi istnieć, by `ALTER` zadziałał).

---

## Phase 2: Generowanie fiszek + endpointy (API)

### Overview

Klient LLM generujący fiszki, wpięcie go w cykl transkrypcji z S-01 oraz trzy chronione endpointy `/flashcards` (proposals/accept/reject). Ekspozycja `flashcards_status` w `GET /situations`.

### Changes Required:

#### 1. Klient generowania fiszek (LLM)

**File**: `api/src/lib/flashcards.ts`

**Intent**: Zamienia polski transkrypt sytuacji na zestaw angielskich fiszek przez OpenAI Chat Completions ze Structured Outputs. AI dobiera typy do sytuacji i liczbę w widełkach ~3-5. Prompt celuje w Kryterium sukcesu (≥70% akceptacji): poprawny, naturalny angielski osadzony w opisanej sytuacji.

**Contract**: `export async function generateFlashcards(transcript: string, apiKey: string): Promise<GeneratedCard[]>` gdzie `GeneratedCard = { type: 'word'|'phrase'|'sentence'; front_en: string; back_pl: string; example_en: string }`. POST na `https://api.openai.com/v1/chat/completions`, `model: 'gpt-4o'`, `response_format` ze ścisłym `json_schema`. System prompt (po polsku, opisujący zadanie): wejście to potoczny polski opis przeżytej sytuacji; wygeneruj ~3-5 fiszek angielskich dobranych typami do sytuacji; `front_en` poprawny naturalny angielski, `back_pl` zwięzłe tłumaczenie, `example_en` przykład użycia (pusty string dopuszczalny dla `sentence`). Rzuca błąd przy odpowiedzi non-2xx lub pustej liście (przechwytywane przez wywołującego → `flashcards_status='failed'`).

Schemat Structured Outputs (kształt wymuszany — wszystkie pola `required`, `additionalProperties: false`):

```json
{
  "name": "flashcards",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["flashcards"],
    "properties": {
      "flashcards": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "front_en", "back_pl", "example_en"],
          "properties": {
            "type": { "type": "string", "enum": ["word", "phrase", "sentence"] },
            "front_en": { "type": "string" },
            "back_pl": { "type": "string" },
            "example_en": { "type": "string" }
          }
        }
      }
    }
  }
}
```

#### 2. Wpięcie generowania w cykl transkrypcji (S-01)

**File**: `api/src/routes/situations.ts` (plik z S-01)

**Intent**: Po udanej transkrypcji, w tym samym `waitUntil`, wygenerować i zapisać fiszki oraz zaktualizować `flashcards_status`. To jedyny trigger generowania (auto po transkrypcji).

**Contract**: W gałęzi sukcesu `transcribeAndFinalize` (po `UPDATE ... status='done'`, przed/obok `DELETE` z R2): wywołaj `generateFlashcards(transcript, c.env.OPENAI_API_KEY)`; przy sukcesie `INSERT INTO flashcards (situation_id, user_id, type, front_en, back_pl, example_en, status) VALUES (...)` dla każdej karty (status domyślnie `proposed`) i `UPDATE situations SET flashcards_status='done' WHERE id=?`; przy błędzie/pustym wyniku `UPDATE situations SET flashcards_status='failed' WHERE id=?`. Generowanie owinięte własnym `try/catch` — nie może wywrócić finalizacji transkrypcji ani kasowania R2. `user_id` brany z wiersza sytuacji (transkrypcja w tle nie ma `c.get('userId')`).

#### 3. Router fiszek

**File**: `api/src/routes/flashcards.ts`

**Intent**: Trzy chronione trasy realizujące przegląd i bramkę akceptacji. Wzorować się na `api/src/routes/auth.ts` (raw SQL, `requireAuth`, odpowiedzi PL).

**Contract**:
- `GET /proposals` (requireAuth): `SELECT` fiszek `WHERE user_id=? AND status='proposed'` (z `situation_id`, `type`, `front_en`, `back_pl`, `example_en`, `created_at`), ORDER BY `created_at`. Dodatkowo policz sytuacje w trakcie generowania: `SELECT COUNT(*) FROM situations WHERE user_id=? AND status='done' AND flashcards_status='pending'`. Zwróć `{ proposals: [...], generatingCount: number }`.
- `POST /:id/accept` (requireAuth): sprawdź własność, `UPDATE flashcards SET status='accepted' WHERE id=? AND user_id=? AND status='proposed'`. Zwróć `200`/`404`.
- `DELETE /:id` (requireAuth, odrzucenie): sprawdź własność, `DELETE FROM flashcards WHERE id=? AND user_id=?`. Zwróć `204`/`404`.

**Contract (kształt fiszki zwracanej do klienta)**: `{ id: number, situation_id: number, type: 'word'|'phrase'|'sentence', front_en: string, back_pl: string, example_en: string, created_at: string }`. `status` i `user_id` nieeksponowane (lista to z definicji `proposed`).

#### 4. Rejestracja routera + ekspozycja stanu generowania

**File**: `api/src/index.ts`, `api/src/routes/situations.ts`

**Intent**: Podpiąć router fiszek pod chronioną ścieżką i udostępnić frontowi `flashcards_status` na liście sytuacji (dla feedbacku „generuję…" na Home, opcjonalnie).

**Contract**: `app.route('/flashcards', flashcardsRouter)` w `index.ts`. W `GET /situations` (S-01) dodać `flashcards_status` do `SELECT` i do kształtu zwracanego wiersza.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `cd api && npm run typecheck`
- Testy (jeśli dodane) przechodzą: `cd api && npm test`

#### Manual Verification:

- `wrangler dev --port 3030`; po nagraniu sytuacji (ścieżka S-01) i transkrypcji, w ciągu kilku-kilkunastu sekund `GET /flashcards/proposals` zwraca ~3-5 fiszek z poprawnym angielskim i polskim tłumaczeniem.
- `flashcards_status` sytuacji przechodzi `pending`→`done` po udanym generowaniu; przy wymuszonym błędzie LLM → `failed`, a transkrypt i tak pozostaje `done` (generowanie nie wywraca transkrypcji).
- `POST /flashcards/:id/accept` ustawia `status='accepted'` (fiszka znika z `proposals`); `DELETE /flashcards/:id` usuwa wiersz.
- Izolacja: `GET /flashcards/proposals` i akcje akceptuj/odrzuć działają tylko na fiszkach zalogowanego użytkownika (cudza fiszka → `404`).

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poproś o ręczne potwierdzenie (wymaga realnego klucza OpenAI + wdrożonego S-01) przed Fazą 3.

---

## Phase 3: Klient API + typy (front)

### Overview

Rozszerzenie klienta API o operacje na fiszkach i typ `Flashcard` oraz dołożenie `flashcards_status` do typu `Situation`. Bez ekranów — czysta warstwa danych frontu.

### Changes Required:

#### 1. Klient API dla fiszek + rozszerzenie typu Situation

**File**: `src/lib/api.ts`

**Intent**: Dodać `flashcardsApi.{listProposals, accept, reject}` (wzorem `authApi`) i typ `Flashcard`; rozszerzyć `Situation` o `flashcards_status`.

**Contract**:
- Typ `Flashcard = { id: number; situation_id: number; type: 'word'|'phrase'|'sentence'; front_en: string; back_pl: string; example_en: string; created_at: string }` (eksportowany).
- `flashcardsApi.listProposals(): Promise<{ proposals: Flashcard[]; generatingCount: number }>` — `GET /flashcards/proposals`.
- `flashcardsApi.accept(id: number): Promise<void>` — `POST /flashcards/:id/accept`.
- `flashcardsApi.reject(id: number): Promise<void>` — `DELETE /flashcards/:id`.
- Typ `Situation` (z S-01) rozszerzony o `flashcards_status: 'pending'|'done'|'failed'`.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck` (lub `npx tsc --noEmit`)
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- `flashcardsApi.listProposals()` przeciw `wrangler dev` zwraca propozycje i `generatingCount` (zweryfikowane logiem/devtools).

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poproś o ręczne potwierdzenie przed Fazą 4.

---

## Phase 4: Ekran przeglądu + nawigacja (front)

### Overview

Zamiana placeholderowego taba `explore` na tab „Fiszki" z ekranem przeglądu: jedna karta naraz, przyciski Akceptuj/Odrzuć, polling w trakcie generowania, stany puste/błędu. Domyka pętlę S-02 end-to-end.

### Changes Required:

#### 1. Tab „Fiszki" w nawigacji

**File**: `src/components/app-tabs.tsx`

**Intent**: Zamienić trigger `explore` na `flashcards` (etykieta „Fiszki", odpowiednia ikona).

**Contract**: `NativeTabs.Trigger name="flashcards"` z `Label` „Fiszki". Ikona: reużyć istniejącego assetu z `@/assets/images/tabIcons/` lub dodać nowy plik ikony fiszek. Nazwa trigger'a musi odpowiadać nazwie pliku ekranu w `(app)/`.

#### 2. Komponent karty fiszki

**File**: `src/components/flashcard-card.tsx`

**Intent**: Renderuje pojedynczą propozycję: `front_en` (wyróżniony), `back_pl`, typ (znacznik) i `example_en` gdy niepusty; dwa przyciski Akceptuj/Odrzuć. Style z `Colors`/`Spacing`.

**Contract**: `export function FlashcardCard({ card, onAccept, onReject }: { card: Flashcard; onAccept: () => void; onReject: () => void })`. Themed components, bez magic numbers. `example_en` ukryty gdy pusty.

#### 3. Ekran przeglądu fiszek + orkiestracja stanu

**File**: `src/app/(app)/flashcards.tsx` (zastępuje `explore.tsx` — usuń stary plik)

**Intent**: Połączyć pobieranie propozycji, prezentację jedna-karta-naraz, akceptację/odrzucenie i polling w trakcie generowania.

**Contract**: Na mount i `useFocusEffect` → `flashcardsApi.listProposals()`. Renderuj pierwszą propozycję z kolejki; Akceptuj → `flashcardsApi.accept(id)` + zdejmij z kolejki; Odrzuć → `flashcardsApi.reject(id)` + zdejmij z kolejki (optymistycznie, z cofnięciem przy błędzie sieci). Dopóki `generatingCount > 0` → krótki polling (`setInterval` ~2-3 s) odświeża `listProposals()`; stop gdy `generatingCount === 0`. **Twardy limit pollingu:** zatrzymaj odpytywanie po ~90 s bez postępu i pokaż stan informacyjny (część fiszek mogła się nie wygenerować). Stany: pusta kolejka + `generatingCount===0` → „Brak fiszek do przejrzenia"; pusta kolejka + `generatingCount>0` → „Generuję fiszki…". Zachowaj dostęp do wylogowania (jest na Home — bez regresji).

#### 4. (Opcjonalnie) feedback „generuję…" na liście sytuacji

**File**: `src/app/(app)/index.tsx` (ekran z S-01)

**Intent**: Na karcie sytuacji ze `status='done'` i `flashcards_status='pending'` pokazać dyskretny wskaźnik „generuję fiszki…", by użytkownik wiedział, że warto zajrzeć do zakładki Fiszki.

**Contract**: Wykorzystać `situation.flashcards_status` (dostępny od Fazy 3) do warunkowego renderu wskaźnika. Zmiana addytywna, nie zmienia logiki S-01.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- Pełna ścieżka na urządzeniu (z wdrożonym S-01): nagranie sytuacji → po transkrypcji zakładka „Fiszki" pokazuje propozycje; w trakcie generowania widać stan „generuję…", który sam się odświeża.
- Akceptuj przenosi fiszkę do bazy nauki (znika z przeglądu, w D1 `status='accepted'`); Odrzuć kasuje fiszkę (znika z przeglądu i z bazy).
- Po przejrzeniu wszystkich propozycji widać stan pusty.
- Osierocone generowanie (wymuszony brak finalizacji) po ~90 s przestaje być odpytywane i pokazuje stan informacyjny.
- Brak regresji w logowaniu/wylogowaniu, routingu chronionym i ekranie sytuacji (S-01).

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poproś o końcowe ręczne potwierdzenie pełnej ścieżki E2E (nagranie → transkrypt → fiszki → akceptacja).

---

## Testing Strategy

### Unit Tests:

- `generateFlashcards` — poprawne budowanie żądania (model, `response_format` z `json_schema`, transkrypt w wiadomości), parsowanie `flashcards` z odpowiedzi, mapowanie odpowiedzi non-2xx i pustej listy na wyjątek (mock `fetch`).
- Router fiszek — egzekwowanie własności w `accept`/`reject` (cudza fiszka → `404`), filtr `status='proposed'` w `proposals`.

### Integration Tests:

- Przeciw `wrangler dev`: po wpięciu generowania, sytuacja `done` → `flashcards_status='done'` + wiersze `proposed`; `accept` przenosi do `accepted` i znika z `proposals`; `reject` kasuje; izolacja po `user_id`.

### Manual Testing Steps:

1. Zaloguj się, nagraj polską sytuację (S-01), poczekaj na transkrypt.
2. Otwórz zakładkę „Fiszki" — w trakcie generowania stan „generuję…", potem ~3-5 propozycji.
3. Zaakceptuj kilka, odrzuć kilka — zaakceptowane w bazie (`accepted`), odrzucone skasowane.
4. Przejrzyj wszystkie — stan pusty.
5. Wymuś błąd generowania (zły klucz / odcięta sieć po transkrypcji) — `flashcards_status='failed'`, transkrypt zachowany, brak wiecznego „generuję".
6. Wyloguj/zaloguj — routing chroniony działa, propozycje odtworzone.

## Performance Considerations

- Generowanie poza ścieżką krytyczną nagrywania (`waitUntil`) — NFR szybkości zapisu (S-01) nietknięty.
- „Jedno wywołanie na sytuację" + gpt-4o: koszt rośnie liniowo z liczbą sytuacji dnia; miękki limit ~3-5 fiszek ogranicza rozmiar odpowiedzi. Jeśli koszt/latencja przeszkadzają — model trzymany w jednym miejscu (`flashcards.ts`), łatwa podmiana na `gpt-4o-mini`.
- Polling listy propozycji aktywny tylko gdy `generatingCount > 0`; zatrzymywany po finalizacji i twardym limicie wieku — brak ciągłego odpytywania.

## Migration Notes

- Nowa migracja `0003_create_flashcards.sql` — addytywna; `ALTER` na `situations` wymaga istniejącej tabeli (migracja `0002` z S-01). Stosować lokalnie (`--local`) i na produkcji (`wrangler d1 migrations apply my-english-day-db --remote`) przy deployu.
- Brak nowych bindingów (używa `DB` + `OPENAI_API_KEY`). `OPENAI_API_KEY` musi być w `Bindings` (`api/src/types.ts`) — dodawany w Fazie 1 S-01; jeśli S-02 implementowane przed tym krokiem, dodać typ tutaj.

## References

- Roadmap: `context/foundation/roadmap.md` (S-02, gwiazda przewodnia, Stream A)
- PRD: `context/foundation/prd.md` (US-01, FR-006/009/010, Kryterium sukcesu ≥70%, Business Logic)
- Prerekwizyt: `context/changes/capture-situation-by-voice/plan.md` (kontrakt `situations`, `transcribeAndFinalize`)
- Wzorzec endpointu: `api/src/routes/auth.ts:25-100`
- Middleware auth: `api/src/middleware/auth.ts`
- Klient API: `src/lib/api.ts:67`
- Nawigacja: `src/components/app-tabs.tsx`
- Lekcja: dev na porcie 3030 (`context/foundation/lessons.md`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Warstwa danych (Worker)

#### Automated

- [x] 1.1 Migracja stosuje się czysto lokalnie (`wrangler d1 migrations apply --local`) — ad63434
- [x] 1.2 Typecheck przechodzi (`api && npm run typecheck`) — ad63434

#### Manual

- [ ] 1.3 Tabela `flashcards` istnieje w lokalnym D1 z poprawnym schematem
- [ ] 1.4 Kolumna `flashcards_status` istnieje w `situations` z domyślną `pending`

### Phase 2: Generowanie fiszek + endpointy (API)

#### Automated

- [x] 2.1 Typecheck przechodzi (`api && npm run typecheck`)
- [x] 2.2 Testy przechodzą (`api && npm test`)

#### Manual

- [x] 2.3 Po transkrypcji `GET /flashcards/proposals` zwraca ~3-5 poprawnych fiszek
- [x] 2.4 `flashcards_status` przechodzi `pending`→`done`; przy błędzie LLM → `failed`, transkrypt zachowany
- [x] 2.5 `accept` ustawia `status='accepted'` (znika z proposals); `DELETE` kasuje wiersz
- [x] 2.6 Izolacja po `user_id` (cudza fiszka → `404`)

### Phase 3: Klient API + typy (front)

#### Automated

- [ ] 3.1 Typecheck przechodzi (`npm run typecheck`)
- [ ] 3.2 Lint przechodzi (`npm run lint`)

#### Manual

- [ ] 3.3 `flashcardsApi.listProposals()` zwraca propozycje + `generatingCount` przeciw `wrangler dev`

### Phase 4: Ekran przeglądu + nawigacja (front)

#### Automated

- [ ] 4.1 Typecheck przechodzi (`npm run typecheck`)
- [ ] 4.2 Lint przechodzi (`npm run lint`)

#### Manual

- [ ] 4.3 Pełna ścieżka E2E: nagranie → transkrypt → fiszki w zakładce „Fiszki"
- [ ] 4.4 Akceptuj → fiszka w bazie (`accepted`, znika z przeglądu)
- [ ] 4.5 Odrzuć → fiszka skasowana (znika z przeglądu i bazy)
- [ ] 4.6 Stan pusty po przejrzeniu wszystkich; stan „generuję…" w trakcie
- [ ] 4.7 Osierocone generowanie po ~90 s → stan informacyjny, polling zatrzymany
- [ ] 4.8 Brak regresji w auth, routingu chronionym i ekranie sytuacji (S-01)

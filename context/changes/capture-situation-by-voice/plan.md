# Przechwytywanie sytuacji głosem (S-01) — Implementation Plan

## Overview

Dajemy zalogowanemu użytkownikowi możliwość nagrania po polsku przeżytej sytuacji jednym naciśnięciem, optymistycznego zapisu w kilka chwil, transkrypcji w tle (OpenAI Whisper) bez kroku edycji oraz przeglądu listy sytuacji dnia. To slice S-01 roadmapy — pierwsze ogniwo Streamu A prowadzące do gwiazdy przewodniej S-02 (generowanie fiszek), budowane na gotowym szkielecie auth F-01.

## Current State Analysis

F-01 dostarczył kompletny, uwierzytelniony szkielet — S-01 dokłada do niego pierwszą funkcję produktową, nie scaffolduje od zera.

**Backend (Hono Worker, `api/`):**
- Jedna tabela `users` (`api/migrations/0001_create_users.sql`); raw SQL + `RETURNING`, bez ORM.
- Middleware `requireAuth` (`api/src/middleware/auth.ts`) waliduje JWT i wstrzykuje `c.set('userId', payload.sub)` (string); pobierane przez `c.get('userId')`.
- `api/src/index.ts`: CORS + `GET /health` + `app.route('/auth', authRouter)`. Typ `AppEnv` w `api/src/types.ts`.
- `wrangler.toml`: binding D1 `DB`, `compatibility_flags = ["nodejs_compat"]`, `migrations_dir = "migrations"`. Sekrety `JWT_SECRET` (w `.dev.vars` lokalnie) i `OPENAI_API_KEY` (ustawiony w Cloudflare wg roadmapy, **niereferencowany w kodzie**).
- **Brak**: R2, multipart/form-data, jakiejkolwiek integracji OpenAI/Whisper, tabel produktowych.
- Walidacja własna (`api/src/lib/validation.ts`), odpowiedzi `c.json({...}, status)`, komunikaty po polsku. Test runner: `vitest`; `npm run typecheck` = `tsc --noEmit`. Dev: `wrangler dev --port 3030`.

**Frontend (Expo SDK 56, `src/`):**
- Routing chroniony: `src/app/_layout.tsx` → `Stack.Protected` na `(app)` / `(auth)` wg `status` z `useAuth()` (`src/contexts/auth-context.tsx`).
- Sesja w `expo-secure-store` (`src/lib/session.ts`). Klient `apiFetch<T>(path, opts)` z auto-`Authorization: Bearer` (`src/lib/api.ts:67`), `ApiError` z polem `status`, `authApi.{register,login,me}`.
- Theming: `ThemedText`/`ThemedView`, `Colors`, `Spacing` (`src/constants/theme.ts`); hook `useTheme()`.
- `(app)/index.tsx` to placeholder „Witaj <email>" + wylogowanie; `(app)/explore.tsx` to przykład z szablonu.
- **Brak**: audio (zero `expo-av`/`expo-audio`), global-state (tylko React Context), data-fetching lib.
- Stan zarządzany przez React Context + lokalny `useState`. `app.json` → `extra.apiBaseUrl` (domyślnie `http://localhost:3030`).

## Desired End State

Zalogowany użytkownik otwiera ekran główny, naciska duży przycisk i mówi po polsku. Po zatrzymaniu (lub auto-stopie na 120 s) sytuacja **natychmiast** pojawia się na liście dnia ze stanem „transkrybuję…"; w ciągu kilku sekund stan zmienia się na gotowy transkrypt (lub „nie udało się — nagraj ponownie" przy błędzie). Użytkownik może nagrać dowolną liczbę sytuacji i usunąć błędne. Dane są izolowane per-użytkownik.

**Weryfikacja:** na urządzeniu/symulatorze — nagranie → wiersz `pending` < 1 s → transkrypt po kilku sekundach; `GET /situations` zwraca tylko dzisiejsze sytuacje zalogowanego użytkownika; `DELETE` usuwa wiersz i (jeśli istnieje) plik R2; restart aplikacji zachowuje listę (dane w D1).

### Key Discoveries:

- Wzorzec endpointu chronionego do skopiowania: `authRouter.post('/register', ...)` z `c.env.DB.prepare(...).bind(...).first()` (`api/src/routes/auth.ts:25-59`).
- `requireAuth` + `c.get('userId')` (`api/src/middleware/auth.ts`) — gotowe do nałożenia na trasy `/situations`.
- `ctx.waitUntil` dostępny w Hono jako `c.executionCtx.waitUntil(...)` — utrzymuje invocation po zwróceniu odpowiedzi (klucz dla wariantu optymistycznego).
- Audio w multipart parsuje Hono `await c.req.parseBody()` → `File`; bufor trzymamy w pamięci i przekazujemy do Whisper bez ponownego czytania z R2.
- `apiFetch` ustawia `Content-Type: application/json` — dla `FormData` trzeba ten nagłówek pominąć (runtime sam ustawi `multipart/form-data; boundary=...`).
- Na Expo SDK 56 `expo-av` jest usunięte — nagrywanie przez **`expo-audio`** (`useAudioRecorder` + `requestRecordingPermissionsAsync`).
- Migracje: pliki `NNNN_<opis>.sql` w `api/migrations/`, stosowane przez Wrangler D1 (`migrations_dir`).
- Lekcja zespołu: dev server zawsze na porcie **3030** (już tak skonfigurowany w `api/package.json`).

## What We're NOT Doing

- **Brak generowania fiszek** — to S-02. S-01 kończy się na zapisanej, stranskrybowanej sytuacji.
- **Brak edycji transkryptu** — FR-004 wprost (akceptacja sensu przez AI w S-02).
- **Brak trwałego przechowywania audio** — plik R2 jest tymczasowy, kasowany po udanej transkrypcji; zostaje wyłącznie przy błędzie (hak na przyszłe ponowienie).
- **Brak retry-z-listy / status-machine w UI** — nieudana transkrypcja → komunikat „nagraj ponownie", nie przycisk ponowienia per-pozycja.
- **Brak historii sprzed dziś** — lista pokazuje tylko sytuacje dnia bieżącego.
- **Brak ekranu szczegółów sytuacji** — pełny transkrypt na karcie listy.
- **Brak odtwarzania audio** — sytuacje są tekstowe (zgodnie z PRD).
- **Brak Cloudflare Queues / Durable Objects** — `ctx.waitUntil` wystarcza dla MVP.

## Implementation Approach

Optymistyczny zapis z transkrypcją w tle. `POST /situations` przyjmuje audio (multipart), zapisuje plik do R2 (klucz tymczasowy), wstawia wiersz `situations` ze statusem `pending` i **natychmiast** zwraca 201 z wierszem (potwierdzenie < 1 s — kryterium NFR). W tym samym wywołaniu `c.executionCtx.waitUntil(...)` uruchamia transkrypcję: Whisper z `language=pl` na buforze trzymanym w pamięci; sukces → `UPDATE transcript, status='done'` + `DELETE` obiektu R2; błąd → `status='failed'` (plik R2 zostaje). Frontend pokazuje listę dnia, odświeża ją po powrocie na ekran i krótko odpytuje, dopóki istnieją wiersze `pending`. Fazowanie jest lustrem F-01: najpierw warstwa danych/storage Workera, potem endpointy, potem klient front, na końcu ekrany.

## Critical Implementation Details

- **Timing & lifecycle** — odpowiedź 201 MUSI wyjść przed rozpoczęciem transkrypcji; transkrypcja idzie wyłącznie przez `c.executionCtx.waitUntil(p)` (nie `await`), inaczej tracimy „natychmiastowy zapis". Bufor audio czytany raz z multipart i współdzielony: zapis do R2 i wejście do Whisper z tej samej kopii.
- **State sequencing** — kolejność w tle: (1) transkrypcja, (2) `UPDATE` wiersza, (3) `DELETE` z R2 dopiero po potwierdzonym `UPDATE`. Skasowanie R2 przed udanym zapisem transkryptu utraciłoby jedyną kopię przy awarii zapisu do D1.
- **User experience spec** — przycisk nagrywania ma natychmiastowy feedback wizualny (stan „nagrywam" + licznik czasu); po `stop` sytuacja pojawia się na liście jako `pending` zanim sieć potwierdzi (optymistyczny wiersz lokalny), zastępowany realnym wierszem z odpowiedzi 201.

## Phase 1: Warstwa danych + storage (Worker)

### Overview

Tworzy tabelę `situations`, binding R2 na audio i aktualizuje typy środowiska Workera. Bez logiki HTTP — tylko fundament danych/storage pod endpointy z Fazy 2.

### Changes Required:

#### 1. Migracja tabeli situations

**File**: `api/migrations/0002_create_situations.sql`

**Intent**: Tabela przechowująca sytuacje per-użytkownik z transkryptem, statusem cyklu transkrypcji i opcjonalnym kluczem audio R2. Izolacja danych przez FK do `users`.

**Contract**: Kolumny: `id` (INTEGER PK AUTOINCREMENT), `user_id` (INTEGER NOT NULL REFERENCES users(id)), `transcript` (TEXT, NULL do czasu transkrypcji), `status` (TEXT NOT NULL DEFAULT 'pending' — wartości `pending` | `done` | `failed`), `audio_key` (TEXT NULL — klucz R2, kasowany po sukcesie), `duration_ms` (INTEGER NULL), `created_at` (TEXT NOT NULL DEFAULT (datetime('now'))). Indeks `idx_situations_user_created` na `(user_id, created_at)` pod listę dnia.

#### 2. Binding R2 na audio

**File**: `api/wrangler.toml`

**Intent**: Dodać bucket R2 na tymczasowe pliki audio, obok istniejącego bindingu D1.

**Contract**: Sekcja `[[r2_buckets]]` z `binding = "AUDIO_BUCKET"` i `bucket_name = "my-english-day-audio"`. Bucket utworzony wcześniej przez `wrangler r2 bucket create my-english-day-audio`.

#### 3. Typy środowiska Workera

**File**: `api/src/types.ts`

**Intent**: Rozszerzyć `AppEnv` o nowy binding R2 i sekret OpenAI, tak by handlery miały typowany dostęp do `c.env.AUDIO_BUCKET` i `c.env.OPENAI_API_KEY`.

**Contract**: W `Bindings` dodać `AUDIO_BUCKET: R2Bucket` oraz `OPENAI_API_KEY: string`. (`R2Bucket` z `@cloudflare/workers-types`, już w devDependencies.)

#### 4. Lokalny sekret OpenAI dla dev

**File**: `api/.dev.vars`

**Intent**: Umożliwić lokalną transkrypcję przez `wrangler dev` bez sięgania do produkcyjnego sekretu.

**Contract**: Dodać linię `OPENAI_API_KEY="<klucz-dev>"`. Plik jest git-ignorowany (jak istniejący `JWT_SECRET`).

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto lokalnie: `cd api && npx wrangler d1 migrations apply my-english-day-db --local`
- Typecheck przechodzi: `cd api && npm run typecheck`
- `wrangler types` regeneruje typy bez błędu: `cd api && npm run cf-typegen`

#### Manual Verification:

- Tabela `situations` istnieje w lokalnym D1 z poprawnym schematem (sprawdzone `wrangler d1 execute ... --local --command "PRAGMA table_info(situations)"`).
- Bucket R2 `my-english-day-audio` istnieje na koncie Cloudflare.

**Implementation Note**: Po ukończeniu fazy i przejściu automatycznej weryfikacji zatrzymaj się i poproś o ręczne potwierdzenie przed Fazą 2.

---

## Phase 2: Endpointy sytuacji + transkrypcja (API)

### Overview

Trzy chronione endpointy `/situations` (create/list/delete) oraz klient Whisper. Tu żyje wariant optymistyczny (`waitUntil`) i cykl życia pliku R2.

### Changes Required:

#### 1. Klient transkrypcji Whisper

**File**: `api/src/lib/transcription.ts`

**Intent**: Cienki proxy do OpenAI Audio Transcriptions, zwracający tekst lub sygnał błędu. Hint języka polskiego dla jakości.

**Contract**: `export async function transcribeAudio(file: { data: ArrayBuffer; name: string; type: string }, apiKey: string): Promise<string>`. POST `multipart/form-data` na `https://api.openai.com/v1/audio/transcriptions` z polami `file`, `model` (`whisper-1`), `language=pl`, `response_format=text`. Rzuca błąd przy odpowiedzi non-2xx lub pustym tekście (przechwytywane przez wywołującego → `status='failed'`).

#### 2. Router sytuacji

**File**: `api/src/routes/situations.ts`

**Intent**: Zarejestrować trzy chronione trasy realizujące optymistyczny zapis, listę dnia i usuwanie. Wzorować się na `api/src/routes/auth.ts` (raw SQL, `RETURNING`, odpowiedzi po polsku).

**Contract**:
- `POST /` (multipart): parsuj `audio` (`File`) i opcjonalne `duration_ms`; walidacja obecności i rozmiaru pliku (odrzuć puste). Zapisz bufor do R2 pod `situations/{userId}/{uuid}.{ext}`. `INSERT INTO situations (user_id, status, audio_key, duration_ms) VALUES (?, 'pending', ?, ?) RETURNING *`. Zwróć `201` z wierszem. Następnie `c.executionCtx.waitUntil(transcribeAndFinalize(...))` — funkcja: `transcribeAudio` → przy sukcesie `UPDATE situations SET transcript=?, status='done' WHERE id=?` potem `AUDIO_BUCKET.delete(audio_key)`; przy błędzie `UPDATE situations SET status='failed' WHERE id=?` (bez kasowania R2).
- `GET /` (requireAuth): `SELECT * FROM situations WHERE user_id=? AND date(created_at)=date('now') ORDER BY created_at DESC`. Zwróć `{ situations: [...] }`.
- `DELETE /:id` (requireAuth): pobierz wiersz, sprawdź własność (`user_id`), jeśli `audio_key` istnieje → `AUDIO_BUCKET.delete(...)`, `DELETE FROM situations WHERE id=? AND user_id=?`. Zwróć `204` lub `404` jeśli nie należy/istnieje.

**Contract (kształt wiersza zwracanego do klienta)**: `{ id: number, status: 'pending'|'done'|'failed', transcript: string|null, duration_ms: number|null, created_at: string }`. `audio_key` nie jest eksponowany klientowi.

#### 3. Rejestracja routera i limit rozmiaru

**File**: `api/src/index.ts`

**Intent**: Podpiąć router sytuacji pod chronioną ścieżką.

**Contract**: `app.route('/situations', situationsRouter)` (z `requireAuth` nałożonym wewnątrz routera lub przy montażu). Odrzucenie zbyt dużego pliku (np. > ~25 MB, limit Whisper) jako `400`.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `cd api && npm run typecheck`
- Testy (jeśli dodane) przechodzą: `cd api && npm test`

#### Manual Verification:

- `wrangler dev --port 3030` uruchomiony; `POST /situations` z plikiem audio i tokenem zwraca `201` z `status: 'pending'` w < 1 s.
- Po kilku sekundach `GET /situations` pokazuje tę sytuację ze `status: 'done'` i niepustym `transcript` (polski tekst).
- Plik R2 zniknął po udanej transkrypcji; przy wymuszonym błędzie (np. zły klucz) `status: 'failed'` i plik R2 pozostaje.
- `GET /situations` zwraca wyłącznie dzisiejsze sytuacje zalogowanego użytkownika (izolacja po `user_id`).
- `DELETE /situations/:id` usuwa wiersz; próba usunięcia cudzej sytuacji → `404`.

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poproś o ręczne potwierdzenie (wymaga realnego klucza OpenAI + pliku audio) przed Fazą 3.

---

## Phase 3: Nagrywanie + klient API (front)

### Overview

Instalacja `expo-audio`, hook nagrywania z uprawnieniami i limitami długości oraz rozszerzenie klienta API o operacje na sytuacjach (z obsługą `FormData`). Bez ekranów — czysta warstwa logiki/danych frontu.

### Changes Required:

#### 1. Zależność audio + uprawnienia

**File**: `package.json`, `app.json`

**Intent**: Dodać `expo-audio` i zadeklarować uprawnienie do mikrofonu (iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO`).

**Contract**: `npx expo install expo-audio`. W `app.json` plugin `expo-audio` z `microphonePermission` (komunikat po polsku) lub odpowiednie wpisy w `ios.infoPlist` / `android.permissions`.

#### 2. Hook nagrywania

**File**: `src/hooks/use-audio-recorder.ts`

**Intent**: Owinąć `expo-audio` w prosty interfejs: prośba o uprawnienie, start/stop, licznik czasu, twarde reguły min 1 s / auto-stop 120 s. Zwraca URI nagrania + czas trwania.

**Contract**: `export function useAudioRecorder(): { isRecording: boolean; durationMs: number; start: () => Promise<void>; stop: () => Promise<{ uri: string; durationMs: number } | null> }`. `stop` zwraca `null`, jeśli nagranie < 1000 ms (odrzucone jako puste). Wewnętrzny timer auto-wywołuje `stop` na 120000 ms. Brak uprawnienia → `start` rzuca/zwraca błąd obsłużony w UI.

#### 3. Klient API dla sytuacji + obsługa FormData

**File**: `src/lib/api.ts`

**Intent**: Dodać `situationsApi.{create,list,remove}` i nauczyć `apiFetch` nie ustawiać `Content-Type` dla ciała `FormData`.

**Contract**:
- W `apiFetch`: jeśli `opts.body instanceof FormData`, NIE ustawiać `Content-Type` (runtime ustawi `multipart/form-data; boundary`). `Authorization` nadal dołączany.
- `situationsApi.create(audio: { uri: string; name: string; type: string }, durationMs: number): Promise<Situation>` — buduje `FormData` (`audio`, `duration_ms`), `POST /situations`.
- `situationsApi.list(): Promise<{ situations: Situation[] }>` — `GET /situations`.
- `situationsApi.remove(id: number): Promise<void>` — `DELETE /situations/:id`.
- Typ `Situation = { id: number; status: 'pending'|'done'|'failed'; transcript: string|null; duration_ms: number|null; created_at: string }` (eksportowany).

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck` (lub `npx tsc --noEmit`)
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- Na urządzeniu/symulatorze pierwsze nagranie prosi o zgodę na mikrofon (komunikat po polsku).
- `start`/`stop` produkuje poprawny `uri` audio; nagranie < 1 s jest odrzucane; nagranie dłuższe niż 120 s zatrzymuje się samo.
- `situationsApi.create(...)` z realnym nagraniem zwraca wiersz `pending` (zweryfikowane logiem/devtools przeciw `wrangler dev`).

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poproś o ręczne potwierdzenie (test mikrofonu na urządzeniu) przed Fazą 4.

---

## Phase 4: Ekran nagrywania + lista (front)

### Overview

Przepisuje ekran główny `(app)/index.tsx` na: przycisk nagrywania u góry + lista sytuacji dnia ze statusami i swipe-delete. Domyka pętlę S-01 end-to-end.

### Changes Required:

#### 1. Komponent przycisku nagrywania

**File**: `src/components/record-button.tsx`

**Intent**: Duży, jednoznaczny przycisk z natychmiastowym feedbackiem stanu (idle / nagrywam + licznik). Spina się z `useAudioRecorder`.

**Contract**: `export function RecordButton({ onCaptured }: { onCaptured: (audio, durationMs) => void })`. Tap startuje/stopuje; po `stop` z ważnym nagraniem woła `onCaptured`. Style z `Colors`/`Spacing` (bez magic numbers).

#### 2. Karta i lista sytuacji

**File**: `src/components/situation-list.tsx` (lista + karta, lub `situation-card.tsx` osobno)

**Intent**: Renderuje sytuacje dnia: `pending` → wskaźnik „transkrybuję…", `done` → transkrypt + czas, `failed` → „Nie udało się — nagraj ponownie". Swipe/przycisk usuwa.

**Contract**: `export function SituationList({ situations, onDelete }: { situations: Situation[]; onDelete: (id: number) => void })`. Renderuje przez `FlatList`; swipe-to-delete przez `ReanimatedSwipeable` z `react-native-gesture-handler/ReanimatedSwipeable` (legacy `Swipeable` jest deprecated w RNGH 2.31 — `reanimated` 4.x i `react-native-gesture-handler` 2.31.1 już w zależnościach) z potwierdzeniem; wymaga `GestureHandlerRootView` u korzenia (zweryfikować, czy root layout je montuje — jeśli nie, dodać). Pusty stan („Brak sytuacji dnia — nagraj pierwszą").

#### 3. Przepisany ekran główny + orkiestracja stanu

**File**: `src/app/(app)/index.tsx`

**Intent**: Połączyć przycisk i listę; zarządzać pobieraniem, optymistycznym wstawieniem i odświeżaniem dopóki są `pending`.

**Contract**: Lokalny stan `situations`. Na mount i na `useFocusEffect` → `situationsApi.list()`. `onCaptured` → optymistycznie dodać tymczasowy wiersz `pending`, wywołać `situationsApi.create(...)`, zastąpić realnym wierszem z odpowiedzi (lub oznaczyć `failed` przy błędzie sieci). Ekran S-01 to jeden widok: nagrywanie + lista — nie wprowadzać dodatkowej nawigacji.

**Reguła scalania stanu (jedno źródło tożsamości):** wiersz tymczasowy nosi kliencki `tempId` (typ lokalny `LocalSituation = Situation & { tempId?: string }`); realny wiersz z 201 zastępuje ten o danym `tempId`. Wyniki `list()` scalać po serwerowym `id`, a NIE nadpisywać stanu ślepo listą z serwera — zachować wiersze tymczasowe wciąż „w locie" (z `tempId`, jeszcze bez `id`), inaczej `useFocusEffect`/polling trafiający między optymistycznym insertem a odpowiedzią 201 zdubluje albo zgubi wiersz. Dopóki któraś sytuacja ma `status === 'pending'`, krótki polling (`setInterval` ~2 s) odświeża `list()`; stop po braku `pending`. **Twardy limit odpytywania:** dla każdego wiersza `pending` liczyć wiek od `created_at`; po przekroczeniu ~60 s bez przejścia w `done`/`failed` przestać go odpytywać i renderować jak stan błędu („Nie udało się — nagraj ponownie"). Chroni przed osieroconym `pending` (ubity/przekroczony `waitUntil`, błąd `UPDATE`) i nieskończonym `setInterval`. `onDelete` → `situationsApi.remove(id)` + usunięcie z listy. Zachować nagłówek z e-mailem/wylogowaniem lub przenieść je sensownie (nie usuwać `signOut`).

#### 4. Usunięcie szablonowej zakładki Explore

**File**: `src/components/app-tabs.tsx`, `src/components/app-tabs.web.tsx`, `src/app/(app)/explore.tsx`

**Intent**: Grupa `(app)` ma tab-navigator z leftoverową zakładką „Explore" z szablonu Expo. End state S-01 to jeden ekran (nagraj + lista), więc zakładkę usuwamy, by nie wysłać szablonowego UI.

**Contract**: Usunąć `NativeTabs.Trigger name="explore"` z obu wariantów `app-tabs.{tsx,web.tsx}` i skasować ekran `(app)/explore.tsx`. Jeśli po usunięciu zostaje pojedyncza zakładka, rozważyć zwinięcie tab-navigatora do zwykłego ekranu — opcjonalne, nie blokujące (taby mogą zostać z samą zakładką „Home" pod przyszłe slice'y). Nie ruszać bramki auth ani `_layout.tsx` grupy poza wymianą zawartości.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- Pełna ścieżka na urządzeniu: tap → mowa po polsku → stop → sytuacja `pending` widoczna < 1 s → po kilku sekundach transkrypt.
- Wiele nagrań w jednej sesji dodaje wiele pozycji (FR-005).
- Swipe-delete usuwa sytuację (znika z listy i z bazy).
- Wymuszony błąd transkrypcji pokazuje stan „nagraj ponownie".
- Osierocony `pending` (wymuszony brak finalizacji w tle) po ~60 s przechodzi w stan „nagraj ponownie", a polling się zatrzymuje.
- Restart aplikacji zachowuje dzisiejsze sytuacje; po północy lista dnia jest pusta (tylko dzisiejsze).
- Szablonowa zakładka „Explore" nie pojawia się już w UI (na natywie i web).
- Brak regresji w logowaniu/wylogowaniu i routingu chronionym.

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poproś o końcowe ręczne potwierdzenie pełnej ścieżki E2E.

---

## Testing Strategy

### Unit Tests:

- `transcribeAudio` — poprawne budowanie żądania, mapowanie błędu non-2xx i pustego tekstu na wyjątek (mock `fetch`).
- Walidacja uploadu — odrzucenie pustego/zbyt dużego pliku.
- `use-audio-recorder` — reguła min 1 s (odrzucenie) i auto-stop (mock timera), jeśli środowisko testowe frontu zostanie skonfigurowane.

### Integration Tests:

- `POST /situations` → `GET /situations` przeciw `wrangler dev`: wiersz `pending` → `done` z transkryptem; izolacja po `user_id`; `DELETE` egzekwuje własność.

### Manual Testing Steps:

1. Zaloguj się, nagraj krótką polską wypowiedź, potwierdź wiersz `pending` < 1 s i transkrypt po chwili.
2. Nagraj 3 sytuacje pod rząd — wszystkie na liście.
3. Usuń jedną swipe — znika z listy i bazy.
4. Wymuś błąd (np. odłącz sieć po nagraniu lub zły klucz) — stan „nagraj ponownie".
5. Nagranie < 1 s — odrzucone; nagranie > 120 s — auto-stop.
6. Wyloguj/zaloguj — routing chroniony działa, lista dnia odtworzona.

## Performance Considerations

- Kryterium NFR: potwierdzenie **zapisu** < 1 s — gwarantowane przez optymistyczny `201` przed transkrypcją (`waitUntil`).
- Whisper proxy to fetch-and-forward — nie obciąża limitu CPU Workera (free tier). Bufor audio czytany raz, współdzielony R2/Whisper.
- Limit 120 s na nagranie ogranicza rozmiar uploadu, czas transkrypcji i koszt OpenAI.
- Polling listy aktywny tylko gdy istnieją wiersze `pending`; zatrzymywany po finalizacji — brak ciągłego odpytywania.

## Migration Notes

- Nowa migracja `0002_create_situations.sql` — addytywna, bez zmian w `users`. Stosować lokalnie (`--local`) i na produkcji (`wrangler d1 migrations apply my-english-day-db --remote`) przy deployu.
- Binding R2 wymaga utworzenia bucketu (`wrangler r2 bucket create my-english-day-audio`) przed deployem Workera.

## References

- Roadmap: `context/foundation/roadmap.md` (S-01, Stream A)
- PRD: `context/foundation/prd.md` (US-01, FR-003/004/005, NFR, Guardrails)
- Infra: `context/foundation/infrastructure.md` (Cloudflare Workers + R2 + Queues — tu używamy R2 + waitUntil)
- Wzorzec endpointu: `api/src/routes/auth.ts:25-100`
- Middleware auth: `api/src/middleware/auth.ts`
- Klient API: `src/lib/api.ts:67`
- Lekcja: dev na porcie 3030 (`context/foundation/lessons.md`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Warstwa danych + storage (Worker)

#### Automated

- [x] 1.1 Migracja stosuje się czysto lokalnie (`wrangler d1 migrations apply --local`) — 8d207c4
- [x] 1.2 Typecheck przechodzi (`api && npm run typecheck`) — 8d207c4
- [x] 1.3 `wrangler types` regeneruje typy bez błędu (`cf-typegen`) — 8d207c4

#### Manual

- [x] 1.4 Tabela `situations` istnieje w lokalnym D1 z poprawnym schematem — 8d207c4
- [x] 1.5 Bucket R2 `my-english-day-audio` istnieje na koncie Cloudflare

### Phase 2: Endpointy sytuacji + transkrypcja (API)

#### Automated

- [x] 2.1 Typecheck przechodzi (`api && npm run typecheck`) — 8a2a474
- [x] 2.2 Testy przechodzą (`api && npm test`) — 8a2a474

#### Manual

- [x] 2.3 `POST /situations` zwraca `201` ze `status: 'pending'` w < 1 s — 8a2a474
- [x] 2.4 Po kilku sekundach `GET /situations` pokazuje `status: 'done'` z polskim transkryptem — 8a2a474
- [x] 2.5 Plik R2 skasowany po sukcesie; przy błędzie `status: 'failed'` i plik pozostaje — 8a2a474
- [x] 2.6 `GET /situations` zwraca tylko dzisiejsze sytuacje zalogowanego użytkownika — 8a2a474
- [x] 2.7 `DELETE /situations/:id` usuwa wiersz; cudza sytuacja → `404` — 8a2a474

### Phase 3: Nagrywanie + klient API (front)

#### Automated

- [x] 3.1 Typecheck przechodzi (`npm run typecheck`) — b8b3cfa
- [x] 3.2 Lint przechodzi (`npm run lint`) — b8b3cfa

#### Manual

- [x] 3.3 Pierwsze nagranie prosi o zgodę na mikrofon (po polsku) — aca8819
- [x] 3.4 `start`/`stop` produkuje poprawny `uri`; < 1 s odrzucone; > 120 s auto-stop — aca8819
- [x] 3.5 `situationsApi.create(...)` zwraca wiersz `pending` przeciw `wrangler dev` — aca8819

### Phase 4: Ekran nagrywania + lista (front)

#### Automated

- [x] 4.1 Typecheck przechodzi (`npm run typecheck`) — aca8819
- [x] 4.2 Lint przechodzi (`npm run lint`) — aca8819

#### Manual

- [x] 4.3 Pełna ścieżka E2E: tap → mowa → `pending` < 1 s → transkrypt — aca8819
- [x] 4.4 Wiele nagrań w sesji dodaje wiele pozycji (FR-005) — aca8819
- [x] 4.5 Swipe-delete usuwa sytuację z listy i bazy — aca8819
- [x] 4.6 Wymuszony błąd pokazuje stan „nagraj ponownie" — aca8819
- [x] 4.7 Restart aplikacji zachowuje dzisiejsze sytuacje; lista pokazuje tylko dzisiejsze — aca8819
- [x] 4.8 Brak regresji w logowaniu/wylogowaniu i routingu chronionym — aca8819
- [x] 4.9 Osierocony `pending` po ~60 s → stan błędu i zatrzymany polling — aca8819
- [x] 4.10 Szablonowa zakładka „Explore" usunięta z UI (natywne + web) — aca8819

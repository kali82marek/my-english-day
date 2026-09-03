---
date: 2026-09-03T18:03:22+02:00
researcher: Marek Kalita (Claude Code)
git_commit: b7843e8f94430bd11615d5c4e146d8176993b896
branch: main
repository: kali82marek/my-english-day
topic: "Faza 1 wdrożenia testów: harness Workerów i zadania w tle — gdzie w kodzie żyją ryzyka #1, #2, #4 z test-plan.md i czego wymaga harness workerd"
tags: [research, codebase, testing, workerd, vitest, d1, r2, waitUntil, migrations, situations, flashcards]
status: complete
last_updated: 2026-09-03
last_updated_by: Marek Kalita (Claude Code)
---

# Research: Faza 1 wdrożenia testów — harness Workerów i zadania w tle

**Date**: 2026-09-03T18:03:22+02:00
**Researcher**: Marek Kalita (Claude Code)
**Git Commit**: b7843e8f94430bd11615d5c4e146d8176993b896
**Branch**: main
**Repository**: kali82marek/my-english-day

Permalinki poniżej wskazują na commit `b7843e8`. `context/foundation/test-plan.md`
i ten folder zmiany są jeszcze niezacommitowane, więc cytowane są ścieżką lokalną.

## Research Question

Brief z `change.md` (Faza 1 planu `context/foundation/test-plan.md` §3):

1. **Ryzyko #1** (nagranie cicho przepada): gdzie jest punkt wejścia finalizacji w tle,
   kto i kiedy pisze przejścia `pending`/`done`/`failed`, jaka jest kolejność kasowania
   audio względem zapisu, jak lista dnia mapuje stary `pending`, jaka jest wartość i
   rola limitu w kliencie. Cel testu: ubita lub nieudana transkrypcja kończy się
   widocznym `failed` w ograniczonym czasie, nieudany zapis zwraca czytelny błąd bez
   osieroconego audio.
2. **Ryzyko #2** (wieczorem brak fiszek lub połowa): kolejność kroków w zadaniu tła,
   strategia zapisu kart (pętla vs batch), bezpiecznik idempotencji, co liczy licznik
   „generuję”. Cel testu: wszystko-albo-nic, nigdy część kart + `failed`, transkrypt
   nie ginie przez błąd generowania.
3. **Ryzyko #4** (nowy Worker na starej bazie): katalog migracji i narzędzie
   aplikowania, jak harness ma budować bazę testową, checklista deployu.
4. **Harness**: co konkretnie trzeba zainstalować i skonfigurować, żeby testy
   integracyjne biegły w workerd z izolowanym D1 zbudowanym z `api/migrations/`,
   mockiem OpenAI na krawędzi sieci i kontrolą zakończenia zadania tła. Obecny
   harness `node` w `api/vitest.config.ts` nie obejmuje bindingów.

## Summary

- **Całe zadanie tła to jeden łańcuch w `api/src/routes/situations.ts`**:
  `POST /situations` → `c.executionCtx.waitUntil(transcribeAndFinalize)` →
  `generateAndStoreFlashcards`. Wszystkie pięć przejść stanu (`status`: pending/done/failed,
  `flashcards_status`: done/failed) pisze ten jeden plik; kolumna `flashcards_status`
  startuje z DEFAULT `'pending'` w migracji 0003. Żaden inny kod nie czyta ani nie
  uzgadnia tych stanów po stronie serwera.
- **Ryzyko #1 potwierdzone w trzech miejscach**: (a) wyjątek `INSERT` po udanym `R2.put`
  wychodzi z handlera bez `try` i bez `app.onError`, więc Hono zwraca domyślne 500
  `Internal Server Error` (text/plain), a plik audio zostaje; gałąź sprzątająca `!row`
  jest martwa, bo `first()` z `RETURNING` rzuca zamiast zwracać `null`; (b) jeśli zadanie
  tła zostanie anulowane albo sam `UPDATE ... 'failed'` w `catch` rzuci, wiersz zostaje
  `pending` na zawsze i `GET /situations` oddaje go surowo; (c) platforma: `waitUntil`
  ma 30 s zegara ściennego po wysłaniu odpowiedzi, a zadanie robi sekwencyjnie Whisper
  (nagranie do 120 s) i gpt-4o; anulowanie jest ciche dla wiersza. Klient maskuje to
  lokalnym postarzaniem `pending` po 60 s (`ORPHAN_MS`), przyklejonym wbrew serwerowi.
- **Ryzyko #2 potwierdzone**: karty idą pętlą `INSERT ... .run()` po jednej, każda w
  osobnej niejawnej transakcji D1; błąd przy karcie N zostawia 1..N-1 jako `proposed`
  i ustawia `flashcards_status='failed'`. Follow-up `DB.batch` z S-03 jest zakolejkowany
  i niezrealizowany. Dziś `done` implikuje co najmniej jedną kartę tylko dlatego, że
  `generateFlashcards` rzuca na pustą listę. Transkrypt przeżywa błąd generowania, ale
  jeśli w `catch` generowania rzuci `UPDATE 'failed'`, wyjątek wpada do zewnętrznego
  `catch` i **nadpisuje `status='failed'` sytuacji z zapisanym transkryptem**.
- **Ryzyko #4**: cztery migracje z twardą kolejnością (0003 robi `ALTER TABLE situations`
  z 0002, 0004 `ALTER TABLE flashcards` z 0003); kod wymienia `flashcards_status` w
  trzech zapytaniach i `is_variant` w `INSERT`. Brak CI, deploy ręczny, checklista
  migracja → deploy żyje wyłącznie w `context/archive/.../follow-ups/review-fixes.md`.
  Harness z `readD1Migrations` + `applyD1Migrations` buduje schemat wyłącznie z
  `api/migrations/` w kolejności numerów, więc zła kolejność lub brakująca kolumna
  obala cały suite bez snapshotu `PRAGMA`.
- **Harness wymaga decyzji o wersji Vitest**: `@cloudflare/vitest-plugin@1.1.3` (nazwa po
  zmianie z 2026-08-19) wymaga `vitest ^4.1`; repo ma 3.2.6. Jedyna droga na Vitest 3
  to stare `@cloudflare/vitest-pool-workers@0.12.21` (nieutrzymywane, stary workerd).
  Rekomendacja: podnieść Vitest do 4.1 i wziąć plugin v1. Ścieżka bezpośrednia
  `app.fetch(req, env, ctx)` + `waitOnExecutionContext(ctx)` daje deterministyczną
  kontrolę `waitUntil` (odrzucona obietnica tła obala test), mock `fetch` przez
  `vi.spyOn(globalThis, 'fetch')` (`fetchMock` usunięte w v1), a błąd D1 „w środku
  zapisu” da się wstrzyknąć bez mockowania D1 od środka: `CREATE TRIGGER ... RAISE(ABORT)`
  założony w teście na schemacie z migracji.
- **Pułapka**: plugin z `wrangler.configPath` automatycznie ładuje `api/.dev.vars`
  (jest lokalnie, z prawdziwym `OPENAI_API_KEY`). Harness musi nadpisać sekrety w
  `miniflare.bindings` i blokować każdy niezamockowany `fetch`, inaczej test cicho
  uderzy w prawdziwe OpenAI.

## Detailed Findings

### 1. Punkt wejścia i kolejność kroków zadania tła

Plik: [api/src/routes/situations.ts](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts).

`POST /situations` (linie 143-193):

1. `parseBody` → walidacja pliku (147-152): brak pliku / 0 B → 400, > 25 MB → 400.
2. `audio.arrayBuffer()` czytany raz (164); klucz R2 `situations/<userId>/<uuid>.<ext>` (165).
3. `AUDIO_BUCKET.put(audioKey, data)` (167-169) — **bez try/catch**.
4. `INSERT INTO situations (...) VALUES (?, 'pending', ?, ?) RETURNING *` przez `.first()` (171-175) — **bez try/catch**.
5. Gałąź `if (!row)` (177-181) kasuje R2 i zwraca 500 `{ error: 'Nie udało się zapisać sytuacji.' }`. Ta gałąź jest praktycznie martwa: nieudany `INSERT` w D1 rzuca wyjątek, nie zwraca `null`.
6. `c.executionCtx.waitUntil(transcribeAndFinalize(...))` (184-190) — odpalone **po** zbudowaniu wiersza, odpowiedź 201 z DTO (192).

`transcribeAndFinalize` (111-135), jeden `try`:

1. `transcribeAudio(audio, OPENAI_API_KEY)` (119) → `fetch` na `api.openai.com/v1/audio/transcriptions` ([lib/transcription.ts:26](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/lib/transcription.ts#L26)); non-2xx lub pusty tekst → wyjątek.
2. `UPDATE situations SET transcript = ?, status = 'done'` (120-124).
3. `generateAndStoreFlashcards(...)` (126) — własny `try/catch` w środku.
4. `AUDIO_BUCKET.delete(audioKey)` (128).
5. `catch`: `console.error` + `UPDATE situations SET status = 'failed'` (129-133). Plik R2 zostaje („hak na retry” bez wpiętego UI).

`generateAndStoreFlashcards` (71-101):

1. `generateFlashcards(transcript, key)` (78) → `fetch` na `chat/completions` ([lib/flashcards.ts:86](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/lib/flashcards.ts#L86)); non-2xx, brak treści lub **pusta lista po filtrze** → wyjątek (102-124).
2. Pętla `for (const card of cards)` → osobny `INSERT INTO flashcards (...) VALUES (?,?,?,?,?,?,?)` + `.run()` na każdą kartę (79-86).
3. `UPDATE situations SET flashcards_status = 'done'` (87-91).
4. `catch`: `console.error` + `UPDATE situations SET flashcards_status = 'failed'` (92-100).

### 2. Kto i kiedy pisze przejścia stanów

| Przejście | Miejsce | Warunek | Co się dzieje, gdy to samo zapytanie rzuci |
|---|---|---|---|
| `status` → `pending` | `INSERT` w POST, [situations.ts:171-175](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L171-L175) | po udanym `R2.put` | wyjątek z handlera → Hono domyślne 500 text/plain (brak `app.onError` w [index.ts](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/index.ts)), plik R2 osierocony |
| `status` → `done` (+ `transcript`) | [situations.ts:120-124](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L120-L124) | po udanym Whisper | `catch` → `failed`; transkrypt nie zapisany; R2 zostaje |
| `flashcards_status` (DEFAULT `'pending'`) | migracja [0003:24](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/migrations/0003_create_flashcards.sql#L24) | zawsze przy `INSERT` | n/d |
| `flashcards_status` → `done` | [situations.ts:87-91](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L87-L91) | po **wszystkich** `INSERT` kart | wewnętrzny `catch` → `flashcards_status='failed'` **przy wszystkich kartach już w bazie** |
| `flashcards_status` → `failed` | [situations.ts:95-99](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L95-L99) | błąd LLM lub błąd którejkolwiek karty | wyjątek wypada do zewnętrznego `catch` → `status='failed'` sytuacji **mimo zapisanego transkryptu**; R2 nie skasowane |
| `status` → `failed` | [situations.ts:131-133](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L131-L133) | każdy wyjątek w `try` (Whisper, UPDATE, propagacja z generowania, `R2.delete`) | **nieobsłużone odrzucenie obietnicy w `waitUntil`** → wiersz zostaje `pending` na zawsze |

Dwa nieoczywiste wnioski z tabeli:

- `AUDIO_BUCKET.delete` (128) siedzi w tym samym `try`, więc błąd kasowania **po** udanej transkrypcji i udanym generowaniu nadpisuje `status='done'` na `'failed'`. UI pokaże „nagraj ponownie” dla sytuacji, która ma transkrypt i karty.
- Anulowanie zadania tła przez platformę (30 s, eksmisja izolatu) nie wykonuje żadnego `catch`. Wynik zależy od tego, gdzie w łańcuchu nastąpi cięcie: `pending` bez transkryptu, albo `done` + `flashcards_status='pending'` (wieczne „generuję”), albo karty zapisane + `flashcards_status='pending'`, zawsze z plikiem R2 w buckecie.

### 3. Kolejność kasowania audio względem zapisu

- Decyzja projektowa (S-01 plan, linia 62): transkrypcja → `UPDATE` → dopiero potem `DELETE` z R2. Kod trzyma tę kolejność i idzie dalej: kasuje **po próbie generowania** (128), więc plik żyje przez oba wywołania LLM.
- Osierocone audio powstaje w trzech scenariuszach: (1) wyjątek `INSERT` w POST (martwa gałąź `!row`), (2) każdy błąd transkrypcji lub propagowany błąd generowania (`catch` nie kasuje, celowo, „hak na retry”, którego nie ma), (3) anulowanie zadania tła. Żadna trasa nie sprząta plików `failed` poza `DELETE /:id` ([situations.ts:225-227](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L225-L227)), które użytkownik musi wywołać ręcznie.
- W teście stan R2 jest obserwowalny bez mockowania: `env.AUDIO_BUCKET.list()` na izolowanym buckecie miniflare.

### 4. Jak lista dnia i licznik „generuję” mapują stary `pending`

Serwer:

- `GET /situations` ([situations.ts:196-205](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L196-L205)): `WHERE user_id = ? AND date(created_at) = date('now')`, oddaje `status` surowo. **Brak jakiegokolwiek uzgadniania wieku** — Fix A z przeglądu S-01 F3 (odcięcie ~2 min po stronie serwera) pozostał PENDING.
- `GET /flashcards/proposals` ([routes/flashcards.ts:46-50](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/flashcards.ts#L46-L50)): `generatingCount` = `COUNT(*) ... status='done' AND flashcards_status='pending' AND date(created_at)=date('now')`. Osierocone generowanie liczy się jako „generuję” do północy UTC. Osierocona **transkrypcja** (`status='pending'`) nie wchodzi do tego licznika.

Klient (`src/`, bez permalinków w treści, bo to poza zakresem harnessu API):

- `src/app/(app)/index.tsx:18` `ORPHAN_MS = 60000`: na każdym ticku pollingu (`POLL_MS = 2000`, linia 15) wiersz `pending` starszy niż 60 s od `created_at` jest lokalnie przepisywany na `failed` (91-111). `mergeFromServer` (37-48) **przykleja** lokalne `failed`, gdy serwer nadal mówi `pending`. Po restarcie aplikacji wiersz wraca z serwera jako `pending` z oryginalnym `created_at`, więc pierwszy tick znów go postarza. To dokładnie maskowanie z rubryki „Must challenge” w planie: serwer po restarcie wciąż zwraca `pending`, tylko UI udaje `failed`.
- `src/hooks/use-audio-recorder.ts:22` `MAX_DURATION_MS = 120000`: auto-stop nagrania po 120 s. To nie jest limit uploadu ani pollingu; wyznacza górny rozmiar wejścia dla Whispera (do 120 s audio w jednym `waitUntil`).
- `src/app/(app)/flashcards.tsx:31` `POLL_LIMIT_MS = 90000`: osobne postarzanie licznika „generuję” na ekranie fiszek, resetowane przy każdym postępie.
- `src/lib/api.ts:81`: `fetch` bez `AbortController` i bez globalnego timeoutu.
- `src/components/situation-list.tsx:46-78`: `pending` → „Transkrybuję…”, `done` → transkrypt (+ „· Generuję fiszki…” gdy `flashcards_status==='pending'`), `failed` → „Nie udało się — nagraj ponownie.”. `flashcards_status` `done`/`failed` nie ma etykiety.

Wniosek dla testu ryzyka #1: „widoczny `failed` w ograniczonym czasie” to dziś obietnica klienta, nie serwera. Test serwerowy, który koduje zachowanie z PRD (stary `pending` wraca z listy jako `failed`, albo lista go nie oddaje jako `pending`), będzie czerwony do czasu zrealizowania Fix A z S-01 F3. To zamierzone: plan testów mówi „udowodnić”, nie „udokumentować stan obecny”.

### 5. Ryzyko #2: pętla zapisu, `done` a istnienie kart, transkrypt vs błąd generowania, idempotencja

- **Pętla vs batch**: [situations.ts:79-86](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L79-L86), po jednym `.run()` na kartę; D1 wykonuje każde zapytanie w niejawnej transakcji, więc wcześniejsze karty są trwale zapisane w chwili błędu. Wynik: 1..N-1 wierszy `proposed` + `flashcards_status='failed'`. Follow-up `DB.batch` (S-03 `follow-ups/review-fixes.md:5-9`) przewiduje jedno `env.DB.batch([...INSERTy, UPDATE done])`, atomowo. Test „nigdy część kart + `failed`” napisany przez obserwację (liczba kart w bazie vs stan) jest niezależny od tego, czy poprawka użyje batcha, transakcji czy sprzątania w `catch`.
- **Czy `done` implikuje karty?** Tak, ale tylko przez `generateFlashcards`, które rzuca na pustą listę ([flashcards.ts:119-124](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/lib/flashcards.ts#L119-L124)), oraz przez filtr pustych `front_en`/`back_pl` i `slice(0, MAX_CARDS=10)`. Nic w warstwie zapisu nie sprawdza `cards.length > 0` przed `UPDATE done`; gwarancja jest jednopunktowa i leży w module, który Faza 3 będzie zmieniać. Structured Outputs (`strict: true`, schemat 52-80) wymusza kształt elementu, ale **nie** `minItems`; pusta tablica jest schematowo poprawna.
- **Transkrypt vs błąd generowania**: `UPDATE transcript, status='done'` (120-124) wykonuje się **przed** generowaniem i generowanie ma własny `catch`, więc transkrypt nie ginie przez błąd LLM ani przez błąd `INSERT` karty. Wyjątek: gdy `UPDATE flashcards_status='failed'` (95-99) sam rzuci, propagacja do zewnętrznego `catch` ustawia `status='failed'`; kolumna `transcript` zostaje, ale UI pokaże „nagraj ponownie”.
- **Idempotencja**: plan S-02 (linia 44, 68) obiecał „generuj tylko gdy `flashcards_status==='pending'`”. Kod **nie sprawdza** `flashcards_status` przed generowaniem; dziś jedynym wyzwalaczem jest POST, więc podwójne generowanie jest nieosiągalne. Każdy przyszły retry (S-04, ręczne ponowienie) bez tego bezpiecznika zduplikuje karty. Test bezpiecznika nie należy do Fazy 1 (brak ścieżki wywołania), ale harness powinien to umożliwić.
- **Obserwowalność `failed`**: jedyny ślad to `console.error` (94, 130) widoczny w `wrangler tail`. Plan zabrania asercji na tekście logu; stan w D1 jest wystarczającą obserwacją.

### 6. Migracje i schemat (Ryzyko #4)

Katalog [api/migrations/](https://github.com/kali82marek/my-english-day/tree/b7843e8f94430bd11615d5c4e146d8176993b896/api/migrations), wskazany przez `migrations_dir = "migrations"` w [api/wrangler.toml:13](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/wrangler.toml#L13):

| Plik | Tworzy / zmienia | Zależy od |
|---|---|---|
| `0001_create_users.sql` | `users` + `idx_users_email` | — |
| `0002_create_situations.sql` | `situations` (FK `user_id → users`) + indeks | 0001 |
| `0003_create_flashcards.sql` | `flashcards` (FK do `situations`, `users`) + 2 indeksy + **`ALTER TABLE situations ADD COLUMN flashcards_status`** | 0002 |
| `0004_add_flashcard_variant_flag.sql` | **`ALTER TABLE flashcards ADD COLUMN is_variant`** | 0003 |

- Kolejność jest twarda: `ALTER` w 0003 wymaga tabeli z 0002, `ALTER` w 0004 tabeli z 0003, FK w 0002/0003 wymagają wcześniejszych tabel. „Addytywne = kolejność nieważna” jest fałszywe od 0003.
- Kolumny z migracji 0003/0004 wymieniane w kodzie: `flashcards_status` w `INSERT ... RETURNING *` → DTO (situations.ts:47-56), w `SELECT` listy dnia (199), w `COUNT` licznika (flashcards.ts:47), w dwóch `UPDATE` (88, 96); `is_variant` w `INSERT` kart (81). Worker z 0004 na bazie bez 0004 wywala `INSERT` kart → `flashcards_status='failed'` dla każdego użytkownika (dokładnie F4 z przeglądu S-03).
- Narzędzie aplikowania w produkcji: `npx wrangler d1 migrations apply my-english-day-db --remote`, potem `npx wrangler deploy` (S-03 `follow-ups/review-fixes.md:11-17`). Brak CI (roadmap Baseline, linia 62); `wrangler rollback` nie cofa D1 (infrastructure.md:79). Bramka pre-deploy należy do Fazy 4.
- Lokalny stan `api/.wrangler/state/v3/d1/` istnieje (dev server), ale harness go **nie** używa; plugin buduje świeże D1 w pamięci per plik testowy.
- D1 wymusza klucze obce zawsze („user queries cannot change this”, tylko `PRAGMA defer_foreign_keys`); lokalny workerd też je wymusza (issue #8512). `DELETE /:id` polega na tym (komentarz situations.ts:228-230) i kasuje fiszki przed sytuacją. Wprost sformułowanej gwarancji parytetu lokal/prod dla FK nie znaleziono; traktować jako UNCONFIRMED, ale obserwowalne w harnessie.
- `date('now')` jest w UTC i w SQLite, i w workerd (lokalny dev biegnie z `TZ=UTC`, jak produkcja). To utrzymuje ryzyko #6 poza Fazą 1.

### 7. Obecny harness i wzorce testów

- [api/vitest.config.ts](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/vitest.config.ts): `environment: 'node'`, `include: ['src/**/*.test.ts']`. Komentarz w pliku wprost mówi, że pool Workerów pominięto, bo prymitywy nie potrzebują bindingów.
- Cztery pliki testowe, wszystkie w `api/src/lib/`: `password`, `jwt`, `transcription`, `flashcards`. Wzorzec mocka sieci: `vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(...))` + `afterEach(vi.restoreAllMocks)` ([flashcards.test.ts:4-14](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/lib/flashcards.test.ts#L4-L14)). Helper `chatResponse(flashcards)` buduje odpowiedź Chat Completions; test transkrypcji zwraca `new Response('tekst', {status: 200})`.
- Zainstalowane (z `api/node_modules`): vitest 3.2.6, wrangler 4.95.0, miniflare 4.20260526.0, workerd 1.20260526.1, hono 4.12.23, `@cloudflare/workers-types` 4.20260527.1, Node 24.16. Pluginu Cloudflare do vitest brak.
- Tokeny do testów tras: `signSession(userId, secret)` z [lib/jwt.ts:18-23](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/lib/jwt.ts#L18-L23) (HS256, `sub` jako string, bez `exp`). Najtańsze zasianie użytkownika: bezpośredni `INSERT INTO users` + `signSession(id, env.JWT_SECRET)`; `/auth/register` też działa, ale liczy PBKDF2.
- `requireAuth` ([middleware/auth.ts:13-28](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/middleware/auth.ts#L13-L28)) wstawia `userId` jako **string**; kolumny `user_id` są INTEGER. SQLite stosuje afiniczność przy porównaniu i insercie, więc działa; to teren Fazy 2.
- Skrypty ręczne `api/scripts/smoke-situations.ps1` i `test-flashcards.ps1` biegną przeciw `wrangler dev` z prawdziwym kluczem OpenAI. Nie są substytutem harnessu i nie należy ich włączać do `npm test`.

### 8. Harness workerd: ustalenia zewnętrzne (checked: 2026-09-03)

**Pakiet i wersje**

- `@cloudflare/vitest-plugin@1.1.3` (zmiana nazwy z `@cloudflare/vitest-pool-workers`, changelog Cloudflare 2026-08-19): peer `vitest ^4.1.0`; wewnętrznie wrangler 4.128 i miniflare 5.x (własne zależności, niezależne od `wrangler ^4.95` w repo). Eksporty: `.` i `./types` (brak `./config`; strona docs wciąż pokazuje stary import, to nieaktualne). Źródła: https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/ , https://registry.npmjs.org/@cloudflare/vitest-plugin/latest
- **Vitest 3.2 nie jest wspierany przez v1** („requires Vitest 4.1 or later”). Jedyna opcja na Vitest 3: `@cloudflare/vitest-pool-workers@0.12.21` (peer `vitest 2.0.x - 3.2.x`, wrangler 4.72, miniflare 4.20260310), z API `defineWorkersConfig`, `isolatedStorage`, `SELF`, `fetchMock`. Przewodnik: https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-vitest-3-to-vitest-4/
- Codemod: `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`.

**Konfiguracja v1**

```ts
// api/vitest.config.ts (kształt, nie gotowy plik)
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('migrations'),
          JWT_SECRET: 'test-secret',
          OPENAI_API_KEY: 'sk-test', // nadpisuje .dev.vars
        },
      },
    }),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
}));
```

- Wartości `miniflare` są scalane z `wrangler.toml` z pierwszeństwem `miniflare`. **Własne `environment`/`runner` Vitest nie są wspierane**: obecne `environment: 'node'` musi zniknąć; testy jednostkowe z `lib/` pobiegną w workerd (używają tylko Web Crypto i mocka `fetch`, więc to bezpieczne) albo trafią do osobnego projektu przez `test.projects` w Vitest 4. Źródło: https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/
- **`.dev.vars` jest ładowane automatycznie**, gdy podano `wrangler.configPath` (pool → `unstable_getMiniflareWorkerOptions` → `getVarsForDev`; zweryfikowane w źródle `packages/vitest-plugin/src/pool/config.ts` i `packages/wrangler/src/dev/dev-vars.ts`, nieopisane w docs). W repo `api/.dev.vars` istnieje z prawdziwym kluczem. Nadpisanie w `miniflare.bindings` jest obowiązkowe; harness nie może też zależeć od obecności `.dev.vars` (w CI go nie będzie).
- Plugin dokłada flagi `nodejs_compat_v2` / `export_commonjs_default` w testach (docs ostrzegają o możliwej rozbieżności z produkcją).

**Migracje i izolacja**

```ts
// api/test/apply-migrations.ts
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
// Setup biegnie poza izolacją per plik i może biec wielokrotnie.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- `applyD1Migrations(db, migrations, table = 'd1_migrations')` wykonuje każdą migrację i wpis księgowy w jednym `db.batch()`, w kolejności z `readD1Migrations` (sortowanie po nazwie pliku). Nazwa tabeli księgowej zgadza się z wranglerem. Fixture: https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-plugin-examples/d1
- **`isolatedStorage` i `singleWorker` nie istnieją w v1** (usunięte w 0.13.0). Izolacja jest **per plik testowy**, zapisy w obrębie pliku trwają między testami. Sprzątanie per test trzeba robić ręcznie (`afterEach` z `DELETE`, unikalni użytkownicy per test, `DROP TRIGGER`). Źródło: https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/

**Kontrola zadania tła (`waitUntil`)**

- Ścieżka bezpośrednia: `const ctx = createExecutionContext(); const res = await app.fetch(req, env, ctx); await waitOnExecutionContext(ctx);` (`createExecutionContext`, `waitOnExecutionContext` z `cloudflare:test`; Hono ma sygnaturę `app.fetch(request, env, executionCtx)`). `waitOnExecutionContext` to pętla `Promise.allSettled` nad wszystkim przekazanym do `ctx.waitUntil`, łącznie z obietnicami dodanymi w trakcie; **odrzucona obietnica powoduje rzut (jeden błąd lub `AggregateError`) i test pada**; po 30 s niezakończone obietnice są porzucane z ostrzeżeniem `[vitest-plugin] ... waitUntil promise(s) did not resolve within 30s`. Źródło: https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/ , `src/worker/wait-until.ts`
- Ścieżka integracyjna `SELF.fetch` (w v1 zastąpiona przez `import { exports } from 'cloudflare:workers'; exports.default.fetch(...)`) biegnie w osobnym kontekście I/O i **nic nie czeka na jej `waitUntil`** (wywołania `waitForGlobalWaitUntil` usunięte w PR #11632). Dla asercji na stanie D1 po 201 trzeba używać ścieżki bezpośredniej albo pollować. Historia: https://github.com/cloudflare/workers-sdk/issues/6887
- Konsekwencja dla ryzyka #1: scenariusz „`UPDATE 'failed'` w `catch` rzuca” jest w harnessie widoczny jako **rzut z `waitOnExecutionContext`** przy wierszu wciąż `pending`; test może `await expect(waitOnExecutionContext(ctx)).rejects...` i potem zajrzeć do D1.

**Mock OpenAI na krawędzi sieci**

- `fetchMock` z `cloudflare:test` **usunięte w 0.13.0**. Docs: „Mock `globalThis.fetch` directly or use MSW”. `vi.spyOn(globalThis, 'fetch')` działa, bo Worker pod testem biegnie w tym samym izolacie co testy („any global mocks will apply to it too”); obejmuje wywołania z `waitUntil` (wniosek z tej samej deklaracji, nie z osobnego zapisu). To jest dokładnie istniejący wzorzec z `lib/*.test.ts`.
- Alternatywa: `@msw/cloudflare` (`setupNetwork()`, `network.use(http.post('https://api.openai.com/v1/audio/transcriptions', ...))`), fixture `fixtures/vitest-plugin-examples/request-mocking`. Handlery trwałe domyślnie, `{ once: true }` dla jednorazowych. API do asercji „czy wywołano” i `onUnhandledRequest` dla tej paczki: UNCONFIRMED. Źródło: https://github.com/mswjs/cloudflare
- Niezależnie od narzędzia: **każdy niezamockowany `fetch` musi rzucać**, żeby test nigdy nie wyszedł do sieci (`mockImplementation` z rzutem jako default, mocki per URL w teście).

**Wstrzyknięcie błędu D1 „w środku zapisu” bez mockowania D1**

- Brak udokumentowanego przepisu w docs ani społeczności. Udokumentowane klocki: D1 wspiera `CREATE TRIGGER` (lokalnie i zdalnie; `BEGIN` wielkimi literami, issue #10998), SQLite `RAISE(ABORT, msg)` przerywa instrukcję jako `SQLITE_CONSTRAINT`, każde zapytanie D1 to niejawna transakcja, więc wcześniejsze `INSERT` w pętli zostają. Wzorzec (niesprawdzony w tym repo):

```sql
CREATE TRIGGER fail_on_third BEFORE INSERT ON flashcards
WHEN (SELECT COUNT(*) FROM flashcards) = 2
BEGIN SELECT RAISE(ABORT, 'wstrzyknięty błąd D1'); END;
```

  `DROP TRIGGER` w `afterEach` (izolacja per plik go nie cofnie). Ten sam mechanizm na `situations` (`BEFORE INSERT` → 500 z osieroconym R2; `BEFORE UPDATE ... WHEN NEW.status='failed'` → wieczny `pending`) pokrywa scenariusze ryzyka #1 bez dotykania implementacji. Po wdrożeniu `DB.batch` trigger obali cały batch, więc ten sam test przejdzie na zielono. Źródła: https://developers.cloudflare.com/d1/sql-api/sql-statements/ , https://sqlite.org/lang_createtrigger.html
- Błędu R2 nie da się wstrzyknąć bez mockowania bindingu od środka; plan powinien ograniczyć asercje R2 do obserwacji stanu (`list()`), nie do symulacji awarii R2.

**TypeScript**

- `tsconfig` `types: ["@cloudflare/vitest-plugin/types", ...]` daje `cloudflare:test` i `cloudflare:workers`; `wrangler types` generuje `worker-configuration.d.ts` (w `.gitignore`, więc CI musi go regenerować albo typy trzeba dołożyć ręcznie). Typ bindingu testowego: `declare namespace Cloudflare { interface Env { TEST_MIGRATIONS: import('cloudflare:test').D1Migration[] } }`. Źródło: https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/
- Obecny `api/tsconfig.json` ma `types: ["@cloudflare/workers-types"]` i `include: ["src/**/*.ts"]`; katalog `test/` (setup) trzeba dołączyć.

**Windows 11**

- Wrangler wspiera Windows 11 oficjalnie. Znane historyczne problemy: szum `EBUSY ... rmdir ...\Temp\miniflare-...` przy zamykaniu (naprawione 2026-03-30, PR #13078), błędy startu przy ścieżkach z nie-ASCII (naprawione w 0.18.7), `vitest --inspect` wiesza się przy zajętym porcie 9229 (#10501). Ścieżka repo `D:\PROJEKTY\my-english-day` jest ASCII.

### 9. Fakty platformowe, które kotwiczą „Must challenge”

- „201 + zadanie tła = rekord się sfinalizuje” jest fałszywe z kontraktu platformy: `waitUntil` przedłuża wykonanie **do 30 s zegara ściennego po wysłaniu odpowiedzi**; przekroczenie loguje `waitUntil() tasks did not complete within the allowed time after invocation end and have been cancelled.` i nic więcej. Źródła: https://developers.cloudflare.com/workers/runtime-apis/context/ , https://developers.cloudflare.com/workers/platform/limits/
- W tych 30 s zadanie robi sekwencyjnie Whisper na nagraniu do 120 s (`MAX_DURATION_MS`) i gpt-4o na ~5-10 kart. Realne opóźnienia obu wywołań sumarycznie zbliżają się do limitu przy dłuższych nagraniach; harness tego nie zasymuluje (jego własny limit 30 s w `waitOnExecutionContext` uczyniłby taki test wolnym i kruchym). To kotwica dla decyzji projektowej (uzgadnianie wieku po stronie serwera), nie dla testu.
- CPU: Free 10 ms / Paid 30 s na żądanie (Error 1102 przy przekroczeniu). Fetch-and-forward mieści się w Free; `arrayBuffer()` pliku 25 MB i `FormData` to jedyne cięższe operacje.
- Odrzucone obietnice w `waitUntil` nie przerywają innych obietnic (`allSettled`), a nieobsłużone wyjątki z zadań asynchronicznych trafiają do Workers Logs / Tail; czy liczą się jako błędy w dashboardzie: UNCONFIRMED.
- Eksmisja izolatu następuje „after their events are properly resolved”; 30 s okresu łaski przy konserwacji pochodzi z bloga strony trzeciej: UNCONFIRMED.

## Code References

- [api/src/routes/situations.ts:143-193](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L143-L193) — `POST /situations`: R2.put → INSERT bez try → `waitUntil` → 201; martwa gałąź `!row` (177-181).
- [api/src/routes/situations.ts:111-135](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L111-L135) — `transcribeAndFinalize`: jedyny `try` obejmujący Whisper, UPDATE done, generowanie i `R2.delete`; `catch` → `status='failed'`.
- [api/src/routes/situations.ts:71-101](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L71-L101) — `generateAndStoreFlashcards`: pętla INSERT po karcie, UPDATE done po pętli, `catch` → `flashcards_status='failed'`.
- [api/src/routes/situations.ts:196-205](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/situations.ts#L196-L205) — `GET /situations`: filtr dnia UTC, `status` oddany surowo, brak uzgadniania wieku.
- [api/src/routes/flashcards.ts:46-50](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/routes/flashcards.ts#L46-L50) — `generatingCount`: `status='done' AND flashcards_status='pending' AND date(created_at)=date('now')`.
- [api/src/lib/flashcards.ts:82-127](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/lib/flashcards.ts#L82-L127) — `generateFlashcards`: rzut na non-2xx, brak treści, pustą listę; filtr pustych kart i `MAX_CARDS=10`.
- [api/src/lib/transcription.ts:18-44](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/lib/transcription.ts#L18-L44) — `transcribeAudio`: multipart do Whisper, rzut na non-2xx i pusty tekst.
- [api/src/index.ts:8-32](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/index.ts#L8-L32) — aplikacja Hono bez `app.onError`; eksport domyślny `app` (wejście dla `app.fetch(req, env, ctx)` w testach).
- [api/src/lib/jwt.ts:18-23](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/lib/jwt.ts#L18-L23) — `signSession`: wybijanie tokenów w setupie testów.
- [api/src/middleware/auth.ts:13-28](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/middleware/auth.ts#L13-L28) — `requireAuth`: `userId` jako string z `sub`.
- [api/migrations/0003_create_flashcards.sql:24](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/migrations/0003_create_flashcards.sql#L24) — `ALTER TABLE situations ADD COLUMN flashcards_status` (zależność od 0002).
- [api/migrations/0004_add_flashcard_variant_flag.sql:13](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/migrations/0004_add_flashcard_variant_flag.sql#L13) — `ALTER TABLE flashcards ADD COLUMN is_variant` (zależność od 0003).
- [api/wrangler.toml](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/wrangler.toml) — bindingi `DB` (`migrations_dir = "migrations"`), `AUDIO_BUCKET`, var `ENVIRONMENT`; sekrety `JWT_SECRET`, `OPENAI_API_KEY` poza plikiem.
- [api/vitest.config.ts](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/vitest.config.ts) — obecny harness `node`.
- [api/src/lib/flashcards.test.ts:1-19](https://github.com/kali82marek/my-english-day/blob/b7843e8f94430bd11615d5c4e146d8176993b896/api/src/lib/flashcards.test.ts#L1-L19) — wzorzec `vi.spyOn(globalThis, 'fetch')` + helper `chatResponse`.
- `src/app/(app)/index.tsx:15-18, 37-48, 91-111` — `POLL_MS`, `ORPHAN_MS=60000`, `mergeFromServer` przyklejające lokalne `failed`.
- `src/hooks/use-audio-recorder.ts:22` — `MAX_DURATION_MS=120000`.
- `src/app/(app)/flashcards.tsx:28-31, 85-97` — `POLL_MS=2500`, `POLL_LIMIT_MS=90000`.

## Architecture Insights

- **Jeden plik, jeden `try`, pięć stanów.** Cały cykl życia sytuacji i generowania jest liniowy i skupiony w `situations.ts`. To dobra wiadomość dla testów (jedno wejście `POST`, jeden `ctx` do wyczekania) i zła dla odporności: każde odstępstwo od szczęśliwej ścieżki kończy się w jednym z dwóch `catch`, a awaria samego `catch` lub anulowanie przez platformę nie ma żadnego uzgodnienia.
- **Stan „widoczny w ograniczonym czasie” jest własnością klienta.** Serwer nie ma pojęcia wieku `pending`; dwa niezależne limity w UI (60 s i 90 s) i przyklejanie lokalnego `failed` to trzy implementacje tej samej brakującej reguły serwerowej. Test Fazy 1 powinien kodować regułę po stronie API, gdzie ją da się udowodnić deterministycznie.
- **Zapis kart nie jest transakcją.** D1 daje atomowość tylko przez `batch()`; pętla `.run()` to N niezależnych commitów. Każdy test, który obserwuje liczbę kart w bazie po wstrzykniętym błędzie, jest niezależny od wyboru poprawki.
- **Harness = migracje jako jedyne źródło schematu.** `applyD1Migrations` na świeżym D1 per plik testowy sprawia, że każdy test tras jest jednocześnie testem „kod działa na schemacie z migracji”. Ryzyko #4 nie potrzebuje osobnego testu schematu; potrzebuje, żeby suite biegł wyłącznie na tym schemacie, plus bramki pre-deploy (Faza 4).
- **Mock sieci już ma wzorzec w repo.** `vi.spyOn(globalThis, 'fetch')` z `lib/*.test.ts` przenosi się 1:1 do pool Workerów (ten sam izolat). Nowością jest tylko wymóg „domyślnie rzucaj”, bo w teście integracyjnym pracują dwa różne URL-e OpenAI w jednym przebiegu.
- **Sekrety w harnessie muszą być jawne.** Automatyczne ładowanie `.dev.vars` przez plugin jest wygodne w dev i groźne w testach; jawne `miniflare.bindings` czyni harness niezależnym od lokalnego pliku i od CI.

## Historical Context (from prior changes)

- `context/archive/2026-06-07-capture-situation-by-voice/reviews/impl-review.md:52-60` — F2 (PENDING): brak obsługi błędów `R2.put`/`D1.INSERT` w POST, generyczny 500 Hono, osierocony plik.
- `context/archive/2026-06-07-capture-situation-by-voice/reviews/impl-review.md:62-79` — F3 (PENDING): osierocony `pending` nigdy nie uzgadniany serwerowo; Fix A = odcięcie wieku ~2 min w GET, Fix B = zaakceptować jako ograniczenie MVP.
- `context/archive/2026-06-07-capture-situation-by-voice/reviews/impl-review.md:81-89` — F4 (PENDING): niezabezpieczone `R2.delete` w DELETE blokuje kasowanie wiersza.
- `context/archive/2026-06-07-capture-situation-by-voice/plan.md:53, 57, 61-62` — decyzje: brak Queues/Durable Objects („`ctx.waitUntil` wystarcza dla MVP”), 201 przed transkrypcją, kolejność transkrypcja → UPDATE → DELETE R2.
- `context/archive/2026-06-07-capture-situation-by-voice/plan.md:264, 287` — reguła klienckiego limitu ~60 s i punkt checklisty ręcznej „osierocony `pending` po ~60 s przechodzi w nagraj ponownie”.
- `context/archive/2026-06-07-capture-situation-by-voice/plan-brief.md:56` — „R2 zostaje przy błędzie” bez wpiętego UI ponowienia; sugestia cron-cleanup.
- `context/archive/2026-06-07-gated-ai-flashcard-generation/plan.md:44, 59, 68-69` — obietnica idempotencji „generuj tylko gdy `pending`”, brak regeneracji na żądanie, limit 90 s pollingu w UI.
- `context/archive/2026-06-07-gated-ai-flashcard-generation/reviews/impl-review.md:27-35` — F1: pętla INSERT zamiast `DB.batch`, bez atomowości.
- `context/archive/2026-06-07-gated-ai-flashcard-generation/reviews/impl-review.md:37-54` — F2 (PENDING, bez follow-upu): brak CHECK na enumach `type`/`status` (teren Fazy 3).
- `context/archive/2026-06-07-gated-ai-flashcard-generation/reviews/impl-review.md:66-74` — F4 (zaakceptowane): `generatingCount` liczy tylko dzień bieżący UTC.
- `context/archive/2026-06-09-same-context-variants/reviews/impl-review.md:29-46` — F1: częściowe wiersze przy błędzie w środku pętli; decyzja: follow-up.
- `context/archive/2026-06-09-same-context-variants/follow-ups/review-fixes.md:5-9` — follow-up `DB.batch` (INSERTy + UPDATE done w jednym batchu), timing „przy najbliższej zmianie pipeline'u (S-04) albo jako chore”; **niezrealizowany**.
- `context/archive/2026-06-09-same-context-variants/follow-ups/review-fixes.md:11-17` — checklista deployu: `wrangler d1 migrations apply my-english-day-db --remote`, potem `wrangler deploy`.
- `context/archive/2026-06-09-same-context-variants/reviews/impl-review.md:68-76` — F4: nowy INSERT z `is_variant` na starej bazie failuje generowanie dla wszystkich.
- `context/foundation/infrastructure.md:58, 72-73, 79` — CPU 10 ms free / 30 s paid, 50 zapytań/wywołanie na free, `wrangler rollback` nie cofa D1.
- `context/foundation/roadmap.md:62, 171` — brak CI, deploy ręczny, CI zaparkowane.

## Related Research

Brak wcześniejszych `research.md` w `context/archive/**` i `context/changes/**` (zweryfikowane wyszukiwaniem). To pierwszy artefakt badawczy w projekcie.

## Open Questions

1. **Wersja Vitest (decyzja dla `/10x-plan`).** Plugin v1 wymaga `vitest ^4.1`, repo ma 3.2.6. Opcje: (A) podnieść Vitest do 4.1 i użyć `@cloudflare/vitest-plugin@1.x`; (B) zostać na 3.2 z `@cloudflare/vitest-pool-workers@0.12.21` (stare API, nieutrzymywane, workerd z marca 2026). Rekomendacja: A. Cztery istniejące pliki testowe nie używają API, które Vitest 4 łamie; v1 jest jedyną ścieżką utrzymywaną, a aktualny workerd wzmacnia argument „lokalne D1 ≈ produkcyjne D1” dla ryzyka #4. Koszt: utrata `isolatedStorage` per test (sprzątanie ręczne) i `fetchMock` (zastępowalny istniejącym `vi.spyOn`).
2. **Jeden pool czy dwa projekty.** Czy testy jednostkowe `lib/` mają biec w workerd razem z integracyjnymi (jedna konfiguracja, prostsze `npm test`), czy w osobnym projekcie `node` przez `test.projects`? Rekomendacja: jeden pool workerd; jeśli któryś test `lib/` zacznie się różnić między Node a workerd, to sygnał, nie koszt.
3. **Wstrzyknięcie błędu D1 przez TRIGGER** jest wzorcem złożonym z udokumentowanych klocków, ale niesprawdzonym w tym repo na miniflare 5.x. Plan powinien zacząć od spike'a (jeden test: trigger `BEFORE INSERT ON flashcards` → asercja rzutu) zanim zbuduje na tym trzy scenariusze.
4. **Oczekiwane zachowanie dla starego `pending` po stronie serwera** (Fix A z S-01 F3: mapowanie w GET czy osobny mechanizm) jest decyzją PENDING. Test Fazy 1 powinien kodować obserwowalny skutek z PRD („widoczny `failed` w ograniczonym czasie”), a nie wybraną poprawkę; wartość progu (60 s z klienta? 2 min z przeglądu?) trzeba ustalić w planie, nie przepisywać z klienta.
5. **Czy `waitOnExecutionContext` obejmuje `waitUntil` wywołane przez Hono** (`c.executionCtx.waitUntil` to ten sam obiekt `ctx` przekazany do `app.fetch`)? Z sygnatury Hono tak; wymaga potwierdzenia w spike'u razem z pytaniem 3.
6. **Regeneracja `worker-configuration.d.ts` w CI** (plik w `.gitignore`) i dołączenie `test/` do `tsconfig` — do rozstrzygnięcia w planie, żeby `npm run typecheck` obejmował setup harnessu.

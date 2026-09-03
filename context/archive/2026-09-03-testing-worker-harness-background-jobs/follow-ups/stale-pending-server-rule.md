# Follow-up: serwerowa reguła wieku `pending` (stary `pending` widoczny jako `failed`)

- **Źródło**: `context/foundation/test-plan.md` §2 ryzyko #1 („nagranie cicho przepada");
  przegląd S-01 F3 (`context/archive/2026-06-07-capture-situation-by-voice/reviews/impl-review.md`,
  Fix A ⭐), otwarty od 2026-06-07.
- **Zakodowane jako**: `it.fails` w `api/src/routes/situations.integration.test.ts` (T1.3
  „stary `pending` (150 s) jest z listy widoczny jako `failed`"). Test jest czerwony z
  definicji, dopóki reguła nie istnieje — nie wolno go zamienić na `it.skip` ani usunąć.
- **Status**: otwarty (decyzja produktowa poza zmianą `testing-worker-harness-background-jobs`).

## Decyzja i próg

Wiersz `situations` ze `status = 'pending'` starszy niż **2 minuty** (`created_at` w UTC,
jak `date('now')` w D1) ma być dla klienta widoczny jako `failed`. Serwer, nie klient, jest
źródłem prawdy o tym, że nagranie przepadło.

Uzasadnienie progu 2 minuty:

- `ctx.waitUntil` daje zadaniu tła **30 s zegara ściennego po wysłaniu odpowiedzi**
  (research §9, limity Workers). Jeśli wiersz po 4× tym limicie nadal jest `pending`, żadna
  transkrypcja już go nie sfinalizuje — zadanie zostało anulowane albo sam `UPDATE 'failed'`
  w `catch` padł (spike `api/test/harness.test.ts`, test 3).
- Nagranie ma twardy limit 120 s (`MAX_DURATION_MS` w kliencie), więc nawet wolny Whisper
  nie ma prawa legalnie trwać dłużej niż próg (blind spot Fix A z przeglądu S-01).
- Klient dziś maskuje ten sam przypadek po **60 s** (`ORPHAN_MS` w `src/app/(app)/index.tsx`);
  serwerowy próg jest celowo dłuższy, żeby serwer nigdy nie oznaczył jako `failed` czegoś,
  co zadanie tła może jeszcze sfinalizować.

## Opcje realizacji

Obie opcje muszą objąć **także** licznik `generatingCount` w `GET /flashcards/proposals`
(`status = 'done' AND flashcards_status = 'pending'` z dnia bieżącego): osierocone
generowanie starsze niż próg nie może liczyć się jako „generuję…" do północy UTC.

1. **Mapowanie przy odczycie** (`GET /situations`): warunek wieku w `SELECT` (np. `CASE WHEN
   status = 'pending' AND created_at < datetime('now', '-120 seconds') THEN 'failed' ELSE
   status END AS status`) albo mapowanie w `toDTO`. Zalety: zero zapisów, jeden plik,
   idempotentne. Wady: D1 nadal zawiera `pending`; każdy nowy czytelnik (`generatingCount`,
   przyszłe raporty) musi powtórzyć regułę.
2. **Uzgadniający `UPDATE`**: przed `SELECT` listy dnia (lub w osobnym mechanizmie) `UPDATE
   situations SET status = 'failed' WHERE user_id = ? AND status = 'pending' AND created_at <
   datetime('now', '-120 seconds')`. Zalety: baza jest źródłem prawdy, reguła w jednym
   miejscu, plik R2 można przy okazji skasować (osierocone audio z research §3). Wady: zapis
   przy odczycie; wymaga tego samego dla `flashcards_status` (`done` + `pending` starsze niż
   próg → `failed`).

Rekomendacja: opcja 2, bo domyka też osierocony plik R2 i licznik generowania jedną
regułą. Wybór należy do slice'u, który ją realizuje.

## Wpływ na klienta

- `ORPHAN_MS = 60000` w `src/app/(app)/index.tsx` i „przyklejanie" lokalnego `failed` w
  `mergeFromServer` stają się zbędne po realizacji: wyrównać do progu serwera (120 s) albo
  usunąć maskowanie i polegać na odpowiedzi serwera. Osobny limit `POLL_LIMIT_MS = 90000` na
  ekranie fiszek — to samo, po objęciu `generatingCount`.
- Bez zmiany klienta reguła serwerowa i tak działa (klient tylko wcześniej pokaże `failed`).

## Okno północy UTC (T1.3)

T1.3 sieje `created_at = datetime('now', '-150 seconds')`. Przez ~2,5 minuty po północy UTC
wiersz należy do „wczoraj" i wypada z listy dnia, więc test nie znajdzie wiersza. Dziś jest to
niegroźne (`it.fails` przechodzi niezależnie od powodu porażki). Po zmianie na zwykłe `it`
trzeba ten margines uwzględnić (np. asercja na wierszu przez bezpośredni odczyt D1 albo
zasianie z `created_at` przesuniętym tylko w obrębie dnia). Granica dnia to ryzyko #6,
Faza 2 wdrożenia planu testów.

## Kryterium zamknięcia

- T1.3 w `api/src/routes/situations.integration.test.ts` zmienione z `it.fails` na `it` i
  zielone; T1.4 (świeży `pending` zostaje `pending`) nadal zielone.
- `cd api && npm test` zielone w całości.
- Wpis w `context/foundation/test-plan.md` §6.7 o realizacji reguły.

## Sugerowany moment

Najbliższy slice dotykający `api/src/routes/situations.ts` (S-04) albo osobny chore po
zamknięciu Fazy 1 wdrożenia testów. Nie realizować w zmianie
`testing-worker-harness-background-jobs` (plan §„Czego NIE robimy").

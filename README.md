# My English Day

Nauka angielskiego z sytuacji, które naprawdę przeżyłeś.

Użytkownik nagrywa po polsku krótką sytuację z dnia („nie wiedziałem, jak poprosić w sklepie o fakturę”). Backend transkrybuje nagranie i generuje z niego angielskie fiszki (słowo, zwrot, zdanie z przykładem). Wieczorem użytkownik przegląda propozycje, akceptuje trafne lub odrzuca zbędne, a zaakceptowane trafiają do bazy nauki z powtórkami rozłożonymi w czasie (spaced repetition).

Grupa docelowa: samouk angielskiego na poziomie podstawowym, który potrzebuje języka w codziennych sytuacjach, nie na kursie.

## Jak to działa

1. **Nagraj** — jeden przycisk, kilka sekund mowy po polsku. Zapis jest optymistyczny: aplikacja odpowiada natychmiast, transkrypcja i generowanie fiszek dzieją się w tle.
2. **Przejrzyj** — ekran *Fiszki* pokazuje propozycje AI. Akceptuj albo odrzucaj. Propozycje są odsiewane względem Twojej bazy, żeby nie dublować tego, co już masz.
3. **Ucz się** — ekran *Powtórki* podaje fiszki, których pora nadeszła. Trzy oceny (Nie umiem / Prawie / Umiem) sterują uproszczonym algorytmem SM-2.

## Architektura

| Warstwa | Technologia | Katalog |
|---|---|---|
| Aplikacja (iOS, Android, web) | Expo + React Native, Expo Router, TypeScript | `src/` |
| API | Cloudflare Worker, Hono | `api/src/` |
| Baza danych | Cloudflare D1 (SQLite), migracje | `api/migrations/` |
| Pliki audio (tymczasowe) | Cloudflare R2 | binding `AUDIO_BUCKET` |
| AI | OpenAI Whisper (transkrypcja), GPT-4o ze Structured Outputs (fiszki) | `api/src/lib/` |
| Uwierzytelnianie | e-mail + hasło (PBKDF2), JWT | `api/src/routes/auth.ts` |

Każda tabela danych ma `user_id`; wszystkie trasy poza `/auth` wymagają tokenu, a cudze zasoby zwracają 404.

Endpointy API:

```
POST   /auth/register            POST   /auth/login             GET  /auth/me
POST   /situations               GET    /situations             DELETE /situations/:id
GET    /flashcards/proposals     POST   /flashcards/:id/accept  DELETE /flashcards/:id
GET    /flashcards/review        POST   /flashcards/:id/grade
GET    /health
```

## Uruchomienie lokalne

Wymagania: Node.js 20+, npm, konto Cloudflare (tylko do deployu), klucz OpenAI.

### Backend

```bash
cd api
npm install
```

Utwórz `api/.dev.vars` (plik jest w `.gitignore`):

```
OPENAI_API_KEY=sk-...
JWT_SECRET=dowolny-dlugi-losowy-ciag
```

Zastosuj migracje na lokalnej bazie i uruchom Workera:

```bash
npx wrangler d1 migrations apply my-english-day-db --local
npm run dev            # http://localhost:3030
```

### Aplikacja

W katalogu głównym:

```bash
npm install
npm start              # Expo dev server; `w` otwiera web, `a` Android, `i` iOS
```

Adres API czyta `extra.apiBaseUrl` z `app.json` (domyślnie `http://localhost:3030`, czyli symulator iOS i web). Emulator Androida: `http://10.0.2.2:3030`. Fizyczne urządzenie: adres IP komputera w sieci lokalnej.

## Testy i bramka jakości

```bash
cd api && npm test     # Vitest w workerd: izolowane D1 z migracjami, mock OpenAI na krawędzi sieci
npm run gate           # z katalogu głównego: lint + typecheck (front i api) + testy api, ~20 s
```

`npm run gate` jest wymagane przed każdym commitem i deployem. Testy są prowadzone przez plan oparty na ryzyku w `context/foundation/test-plan.md` (mapa ryzyk §2, jak dodać test §6).

## Deploy

Wyłącznie według `context/deployment/deploy-checklist.md`. Reguła nadrzędna: migracja D1 na produkcji przed `wrangler deploy`, bo rollback Workera nie cofa bazy.

```bash
npm run api:deploy     # Worker (po migracji --remote)
npm run web:export     # z EXPO_PUBLIC_API_BASE_URL wskazującym na Worker
npm run web:deploy     # Cloudflare Pages
```

## Dokumentacja projektu

Projekt powstał w przepływie 10xDevs: kod jest generowany z pisemnych podstaw w `context/`.

- `context/foundation/prd.md` — wymagania produktowe, persona, kryteria sukcesu, kontrola dostępu
- `context/foundation/shape-notes.md` — notatki z kształtowania pomysłu
- `context/foundation/roadmap.md` — kamienie milowe i slice'y
- `context/foundation/tech-stack.md` — wybór stosu
- `context/foundation/test-plan.md` — strategia testów oparta na ryzyku
- `context/foundation/infrastructure.md` — wybór platformy
- `context/archive/` — zamknięte zmiany (research, plan, przeglądy)
- `CLAUDE.md` — instrukcje dla agentów AI pracujących w repozytorium

## Licencja

MIT, patrz `LICENSE`.

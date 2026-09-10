---
project: my-english-day
updated: 2026-09-10
source: S-03 F4 (`context/archive/2026-06-09-same-context-variants/follow-ups/review-fixes.md`) + `context/foundation/test-plan.md` Risk #4 (Faza 4 „Bramki jakości”)
---

# Checklista deployu

Jedno miejsce, które człowiek i agent otwierają przed każdym deployem. Reguła nadrzędna: **migracja D1 PRZED `wrangler deploy`**, a `wrangler rollback` **nie cofa D1**. Polecenia `wrangler` uruchamiaj z katalogu `api/`; polecenia `npm run …` z katalogu głównego.

## Przed deployem

1. Bramka zielona: `npm run gate` (lint, typecheck front + api, testy api; ~20 s). Szczegóły: `context/foundation/test-plan.md` §6.8.
2. Logowanie: `cd api && npx wrangler whoami`. Jeśli „not authenticated” → `npx wrangler login`. W powłoce nieinteraktywnej (agent, CI) `login` nie działa — wymagany `CLOUDFLARE_API_TOKEN` w środowisku.
3. Stan migracji na produkcji: `npx wrangler d1 migrations list my-english-day-db --remote` — zapisz, które migracje czekają, i porównaj z rejestrem na dole.

## Backend (kolejność obowiązkowa)

4. `npx wrangler d1 migrations apply my-english-day-db --remote`
   Dlaczego pierwsza: migracje addytywne są bezpieczne dla STAREGO kodu (stare zapytania nie znają nowych kolumn), ale NOWY kod na starej bazie failuje (INSERT z `is_variant` — S-03; trasy czytające kolumny review state — S-05).
5. `npx wrangler deploy`
6. Health: `GET https://my-english-day-api.kali82marek.workers.dev/health` → 200.
7. Smoke ręczny — otwarte wiersze Manual ostatnich slice'ów:
   - S-04 2.3–2.4: `context/archive/2026-09-09-duplicate-card-filtering/plan.md`
   - S-05 2.3, 3.3–3.6: `context/archive/2026-09-09-srs-review-session/plan.md`
   Pomoc: `api/scripts/smoke-situations.ps1` (ręczny skrypt, niepodpięty do npm).

## Frontend

8. `npm run web:export` (= `npx expo export --platform web`) z adresem Workera w środowisku — `app.config.js` nadpisuje `extra.apiBaseUrl` z `app.json` (domyślnie `localhost:3030`, czyli eksport bez zmiennej celuje w localhost):
   - bash: `EXPO_PUBLIC_API_BASE_URL=https://my-english-day-api.kali82marek.workers.dev npm run web:export`
   - PowerShell: `$env:EXPO_PUBLIC_API_BASE_URL='https://my-english-day-api.kali82marek.workers.dev'; npm run web:export`
   Kontrola: `grep -o "workers.dev" dist/_expo/static/js/web/*.js | head -1` (musi być trafienie, `localhost:3030` nie może).
9. `npm run web:deploy` (= `npx wrangler pages deploy dist --project-name my-english-day`)
10. Otwórz `https://my-english-day.pages.dev`, zaloguj się, sprawdź tab „Nauka”.

## Rollback

- `npx wrangler rollback [VERSION_ID] --yes -m "<powód>"` cofa Worker do poprzedniej wersji (`npx wrangler versions list` — 10 ostatnich); bez `--yes -m` polecenie pyta interaktywnie o potwierdzenie i powód (agent/CI zawiśnie). **NIE cofa D1** (`context/foundation/infrastructure.md:79`).
- Migrację cofa się **osobną migracją w przód** (nowy numer z rejestru), nigdy przez edycję już zaaplikowanego pliku.
- Po nieudanym kroku 5: rollback Workera wystarcza — baza z nową addytywną migracją pozostaje zgodna ze starym kodem.

## Rejestr długu migracyjnego

| Migracja | Stan lokalnie | Stan produkcja | Źródło |
|---|---|---|---|
| 0001 `create_users` … 0004 `add_flashcard_variant_flag` | zaaplikowane | zaaplikowane 2026-09-10 (pierwszy pełny deploy; wcześniej NIE — `list --remote` pokazał 5 oczekujących, produkcja miała tylko stub z 2026-05-28) | `deploy-plan.md` |
| 0005 `add_flashcard_review_state` | zaaplikowana | zaaplikowana 2026-09-10 (przed Workerem 55099ca1) | `context/archive/2026-09-09-srs-review-session/plan.md` §Migration Notes |

- Następny numer migracji: **0006**. Follow-up `context/archive/2026-09-07-testing-llm-generator-contract/follow-ups/enum-check-migration.md` nadal mówi „0005” — slot zajęty przez S-05, użyć 0006.
- Dług: `DROP INDEX` starego indeksu (nowy indeks z 0005 ma stary jako prefiks) — S-05 impl-review `context/archive/2026-09-09-srs-review-session/reviews/impl-review.md:88-89`; wchodzi do przyszłej migracji.

## Reguła

Każda zmiana z nową migracją dopisuje wiersz do rejestru: w swoim planie (§Uwagi dotyczące migracji / Migration Notes) i tutaj — a przy deployu aktualizuje kolumnę „Stan produkcja”.

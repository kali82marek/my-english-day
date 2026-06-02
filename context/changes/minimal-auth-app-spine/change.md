---
change_id: minimal-auth-app-spine
title: Minimalny auth i uwierzytelniony szkielet aplikacji
status: implemented
created: 2026-06-02
updated: 2026-06-02
archived_at: null
---

## Notes

Roadmap F-01 (fundament, status `ready`) — wybrany jako start zamiast S-01, bo S-01 (`capture-situation-by-voice`) ma F-01 jako prerekwizyt, a auth jest w kodzie jeszcze `absent`.

Zakres (minimum, nie pełny system auth):
- Konto email + hasło: rejestracja i logowanie.
- Sesja trwała do wylogowania (przechowywanie sesji po stronie klienta).
- Routing chroniony w aplikacji Expo.
- Uwierzytelniony klient API (token w wywołaniach do Workera).
- Middleware auth po stronie Workera (Hono) — weryfikacja JWT.

Baseline (2026-05-31): Worker Hono z samym `GET /health` (`api/src/index.ts`); D1 podpięty jako binding `DB` (`api/wrangler.toml`), ale pusty (0 tabel, brak migracji/ORM); sekrety `JWT_SECRET` i `OPENAI_API_KEY` ustawione. Frontend: tylko ekrany szablonu Expo Router + theming.

PRD refs: FR-001, FR-002, sekcja Access Control.
Unlocks: S-01 (`capture-situation-by-voice`) → S-02 (gwiazda przewodnia) i wszystkie kolejne slice'y.

Open question (Owner: user, nie blokuje planu): co widzi niezalogowany użytkownik trafiający na chroniony ekran? — zob. Open Roadmap Question #2.

Guardrail: trzymać minimum, nie rozrastać do pełnego systemu auth (reset hasła, OAuth, weryfikacja email itd. → poza zakresem F-01).

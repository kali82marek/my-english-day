# Smoke Fazy 2 (S-05) — `wrangler dev --port 3030`, lokalne D1, bez OpenAI

Data: 2026-09-09. Migracja 0005 zastosowana lokalnie (`wrangler d1 migrations apply --local`).
Użytkownik zarejestrowany przez `POST /auth/register`; sytuacja + jedna fiszka `accepted`
(`invoice`) i jedna `proposed` zasiane przez `wrangler d1 execute --local`.

| Krok | Wywołanie | Wynik |
|---|---|---|
| 1 | `GET /flashcards/review` | `{ cards: [invoice], dueCount: 1, acceptedCount: 1 }` — propozycja NIE jest na liście; DTO bez kolumn SRS |
| 2 | `POST /flashcards/17/grade {"grade":"good"}` | 200, puste ciało |
| 3 | `GET /flashcards/review` | `{ cards: [], dueCount: 0, acceptedCount: 1 }`; w D1: `due_at` = +1 dzień, `interval_days=1`, `ease=2.5`, `repetitions=1`, `reviewed_at` ustawione |
| 4 | `POST …/grade {"grade":"again"}` | 200 |
| 5 | `GET /flashcards/review` | fiszka wraca (`dueCount: 1`) |
| 6 | `POST …/grade {"grade":"easy"}` | 400 `{ error: "Niepoprawna ocena." }` |
| 7 | `GET /flashcards/review` bez tokenu | 401 |

Wiersz ręczny 2.3 planu pozostaje do potwierdzenia przez człowieka (konwencja: wiersze Manual nie są odhaczane automatycznie); powyższe to dowód pomocniczy.

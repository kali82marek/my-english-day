-- Migration number: 0005 	 add flashcard review state
-- Slice S-05: sesja powtórek (spaced repetition) z 3 przyciskami oceny (FR-011, FR-012).
-- Stan powtórek żyje PRZY fiszce na serwerze (PRD Access Control: konto w chmurze,
-- dostęp z każdego urządzenia) — bez osobnej tabeli historii w MVP.
--
-- `due_at` jest NULL-owalne, bo `ALTER TABLE ... ADD COLUMN` w SQLite nie przyjmuje
-- niestałego DEFAULT (`datetime('now')`). NULL = „do powtórki od razu": świeżo
-- zaakceptowana fiszka (i każda dotąd zaakceptowana — brak backfillu) wchodzi do
-- pierwszej sesji bez zmian w `POST /flashcards/:id/accept`. Po ocenie kolumna niesie
-- `YYYY-MM-DD HH:MM:SS` UTC — ten sam format, co DEFAULT `created_at`.
--
-- Addytywne, stałe DEFAULT (wzorzec jak 0003/0004): istniejące INSERT-y z S-02/S-04
-- nadal działają, istniejące wiersze dostają stan „nowa fiszka".

-- Chwila następnej powtórki; NULL = od razu.
ALTER TABLE flashcards ADD COLUMN due_at TEXT;
-- Ostatni odstęp w dniach (0 = jeszcze nie oceniana lub „Nie umiem").
ALTER TABLE flashcards ADD COLUMN interval_days INTEGER NOT NULL DEFAULT 0;
-- Współczynnik łatwości (SM-2; podłoga 1.3 egzekwowana w kodzie).
ALTER TABLE flashcards ADD COLUMN ease REAL NOT NULL DEFAULT 2.5;
-- Długość bieżącej serii poprawnych odpowiedzi („Prawie"/„Umiem"); „Nie umiem" zeruje.
ALTER TABLE flashcards ADD COLUMN repetitions INTEGER NOT NULL DEFAULT 0;
-- Chwila ostatniej oceny; NULL = nigdy nie oceniana.
ALTER TABLE flashcards ADD COLUMN reviewed_at TEXT;

-- Indeks pod listę „do powtórki teraz": filtr po user_id + status + zakres due_at.
CREATE INDEX idx_flashcards_user_status_due ON flashcards (user_id, status, due_at);

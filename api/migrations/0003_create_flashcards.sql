-- Migration number: 0003 	 create flashcards
-- Slice S-02: fiszki AI generowane z transkryptu sytuacji, per użytkownik.
-- Izolacja danych przez user_id REFERENCES users(id) (konwencja z 0001/0002).
-- Cykl: 'proposed' (propozycja do przeglądu) -> 'accepted' (baza nauki).
-- Odrzucone fiszki są kasowane (DELETE), nie przechowywane.

CREATE TABLE flashcards (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  situation_id INTEGER NOT NULL REFERENCES situations(id),  -- z której sytuacji pochodzi
  user_id      INTEGER NOT NULL REFERENCES users(id),       -- izolacja per użytkownik
  type         TEXT    NOT NULL,                             -- 'word' | 'phrase' | 'sentence'
  front_en     TEXT    NOT NULL,                             -- angielski front fiszki
  back_pl      TEXT    NOT NULL,                             -- polskie tłumaczenie
  example_en   TEXT,                                         -- przykład użycia; może być pusty
  status       TEXT    NOT NULL DEFAULT 'proposed',          -- 'proposed' | 'accepted'
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Indeks pod listę propozycji i bazę nauki: filtr po user_id + status.
CREATE INDEX idx_flashcards_user_status ON flashcards (user_id, status);
-- Indeks pod wyszukiwanie fiszek danej sytuacji.
CREATE INDEX idx_flashcards_situation ON flashcards (situation_id);

-- Stan generowania fiszek dla sytuacji: idempotencja generowania + sygnał dla frontu.
-- 'pending' (jeszcze nie generowano) | 'done' (wygenerowano) | 'failed' (próba nieudana).
-- Addytywne: stały default, istniejący INSERT z S-01 nie wymaga zmian.
ALTER TABLE situations ADD COLUMN flashcards_status TEXT NOT NULL DEFAULT 'pending';

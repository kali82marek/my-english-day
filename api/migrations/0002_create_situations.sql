-- Migration number: 0002 	 create situations
-- Slice S-01: sytuacje przechwytywane głosem, per użytkownik.
-- Izolacja danych przez user_id REFERENCES users(id) (konwencja z 0001).
-- transcript NULL do czasu transkrypcji; status steruje cyklem (pending|done|failed);
-- audio_key to tymczasowy klucz R2, kasowany po udanej transkrypcji.

CREATE TABLE situations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  transcript  TEXT,                                       -- NULL dopóki nie ma transkryptu
  status      TEXT    NOT NULL DEFAULT 'pending',         -- 'pending' | 'done' | 'failed'
  audio_key   TEXT,                                       -- klucz R2; kasowany po sukcesie, zostaje przy błędzie
  duration_ms INTEGER,                                    -- długość nagrania w ms (opcjonalna)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Indeks pod listę dnia: filtr po user_id + sort/zakres po created_at.
CREATE INDEX idx_situations_user_created ON situations (user_id, created_at);

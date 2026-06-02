-- Migration number: 0001 	 create users
-- Pierwsza migracja projektu: tabela kont użytkowników.
-- Tabele danych produktowych (situations, flashcards) dodadzą slice'y S-01+
-- z kolumną user_id REFERENCES users(id) (konwencja izolacji danych per użytkownik).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,           -- znormalizowany lowercase (egzekwowane w warstwie API)
  password_hash TEXT    NOT NULL,                  -- pbkdf2$<iter>$<salt_b64>$<hash_b64>
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- UNIQUE na kolumnie email tworzy niejawny indeks unikalny; jawny indeks dla czytelności i pewności.
CREATE UNIQUE INDEX idx_users_email ON users (email);

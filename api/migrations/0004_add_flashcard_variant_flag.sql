-- Migration number: 0004 	 add flashcard variant flag
-- Slice S-03: warianty fiszek w obrębie tego samego kontekstu sytuacji (FR-007).
-- Odróżnia fiszki bazowe (z tego, co się wydarzyło) od wariantów (rozszerzenia
-- kontekstu: inny produkt/kwota/pytanie) na poziomie danych — pod pomiar i
-- przyszłe S-04 (dedup), bez ekspozycji na froncie.
--
-- Addytywne: stały DEFAULT 0 czyni istniejące wiersze bazowymi, istniejący
-- INSERT z S-02 nadal działa (kolumna przyjmuje default), brak backfillu.
-- Wzorzec jak ALTER w 0003 (situations.flashcards_status).
-- SQLite boolean = INTEGER: 0 (bazowa) | 1 (wariant).

ALTER TABLE flashcards ADD COLUMN is_variant INTEGER NOT NULL DEFAULT 0;

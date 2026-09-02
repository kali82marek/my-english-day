<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Warianty fiszek w obrębie tego samego kontekstu (S-03)

- **Plan**: context/changes/same-context-variants/plan.md
- **Zakres**: Faza 2 z 2 (pełny przegląd planu)
- **Data**: 2026-09-02
- **Werdykt**: ZAAKCEPTOWANO
- **Ustalenia**: 0 krytycznych, 1 ostrzeżenie, 4 obserwacje

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność z planem | PASS |
| Dyscyplina zakresu | WARNING |
| Bezpieczeństwo i jakość | WARNING |
| Architektura | PASS |
| Spójność wzorców | PASS |
| Kryteria sukcesu | PASS |

Automatyczna weryfikacja (2026-09-02): typecheck exit 0; testy 20/20 (4 pliki, w tym 6 testów flashcards); migracje idempotentne („No migrations to apply", wszystkie 4 zastosowane lokalnie). Ręczne kryteria 1.3–1.4 i 2.3–2.5 zweryfikowane tego samego dnia z dowodami (PRAGMA schematu, zliczenia `is_variant` w D1, payload `/flashcards/proposals` bez flagi, akceptuj/odrzuć przeklikane w UI web) — brak „podpisywania na ślepo".

Odchylenia od planu: zero (wszystkie kontrakty Fazy 1 i 2 MATCH; granice „What We're NOT Doing" dotrzymane — `is_variant` nie występuje nigdzie w `src/`, DTO proposals bez flagi, brak nowych endpointów i drugiego wywołania LLM).

Uwaga poza ustaleniami: zgłoszoną przez skan niespójność „CORS vs lekcja o porcie 3030" odrzucono jako fałszywie pozytywną — lekcja dotyczy portu API (3030), allowlista CORS originów frontendu (8081/19006); konfiguracja potwierdzona empirycznie tego dnia.

## Ustalenia

### F1 — Częściowe wiersze przy błędzie w środku pętli INSERT fiszek

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/src/routes/situations.ts:79-98
- **Szczegóły**: Karty wstawiane sekwencyjnie (`await .run()` w pętli). Błąd przy karcie N z M zostawia karty 1..N-1 w bazie jako `proposed` (widoczne w proposals), a `catch` ustawia `flashcards_status='failed'` — stan niespójny; przyszły retry wygenerowałby duplikaty. Pętla istniała przed zmianą, ale e56b110 ją modyfikuje, a scenariusz „stary schemat + nowy kod" (worker bez migracji 0004) zwiększa szansę wystąpienia. Plan jawnie odroczył `DB.batch` jako „znaną, osobną optymalizację z review S-02 — poza zakresem tego slice'a" (§Performance Considerations).
- **Poprawka A**: Zamień pętlę INSERT + UPDATE statusu na jedno `env.DB.batch([...])`.
  - Siła: Batch D1 wykonuje się w niejawnej transakcji — eliminuje częściowe wiersze i przyszłe duplikaty; redukuje ~9 round-tripów do 1.
  - Kompromis: Wykracza poza kontrakt tej zmiany; ścieżka `generateAndStoreFlashcards` nie ma testów, więc zmianę trzeba zweryfikować ręcznie.
  - Pewność: HIGH — transakcyjność batcha udokumentowana w D1, edycja wąska.
  - Martwy punkt: Brak testu integracyjnego, który by regresję wychwycił automatycznie.
- **Poprawka B ⭐ Zalecana**: Zostaw zgodnie z planem (świadome odroczenie) i zakolejkuj follow-up `DB.batch`.
  - Siła: Decyzja zakresu już podjęta i udokumentowana w planie; scenariusz wymaga awarii w środku pętli, a mechanizm retry w MVP nie istnieje (`failed` jest terminalny).
  - Kompromis: Okno ryzyka częściowych wierszy pozostaje do czasu follow-upu.
  - Pewność: MED — zależy od faktycznej realizacji follow-upu.
  - Martwy punkt: Częstość chwilowych błędów D1 w produkcji nieznana (brak observability — roadmap baseline).
- **Decyzja**: ZAŁATWIONE przez Poprawkę B — follow-up zakolejkowany w `follow-ups/review-fixes.md` (2026-09-02)

### F2 — Brak bezpiecznika na liczbę i długość generowanych kart

- **Ważność**: 💡 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/src/lib/flashcards.ts:59-73, 113-118
- **Szczegóły**: Prompt prosi o 3–5 kart + ~2–3 warianty, ale schemat nie ma `maxItems` ani limitów długości pól, a `max_tokens` nie jest ustawiony — zdegenerowana odpowiedź modelu może wstawić dziesiątki wierszy lub bardzo długie stringi.
- **Poprawka**: Po parsowaniu dodać `parsed.flashcards.slice(0, 10)` + odrzucenie kart z pustym `front_en`/`back_pl` (nie polegać na `maxItems` w strict mode).
- **Decyzja**: NAPRAWIONE — `MAX_CARDS = 10` + filtr pustych w `flashcards.ts`; typecheck i 20/20 testów po zmianie (2026-09-02)

### F3 — `catch` w zadaniach tła połyka błąd bez logowania (pre-existing)

- **Ważność**: 💡 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/src/routes/situations.ts:92-98, 127-131
- **Szczegóły**: Komunikat diagnostyczny budowany w `generateFlashcards` (status + 500 znaków ciała OpenAI) nigdzie nie trafia — w produkcji jedynym śladem awarii jest `flashcards_status='failed'`. Wzorzec istniał przed tą zmianą.
- **Poprawka**: `catch (err) { console.error(...) }` w obu miejscach — logi widoczne w `wrangler tail`.
- **Decyzja**: NAPRAWIONE — `console.error` z id sytuacji w obu catch; typecheck i 20/20 testów po zmianie (2026-09-02)

### F4 — Kolejność wdrożenia produkcyjnego: migracja przed deployem workera

- **Ważność**: 💡 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: api/migrations/0004_add_flashcard_variant_flag.sql + api/src/routes/situations.ts:81
- **Szczegóły**: Nowy INSERT wymienia `is_variant` jawnie — nowy kod na starej bazie produkcyjnej będzie failował generowanie (łagodnie: `failed`, transkrypt nietknięty). Migracja jest addytywna, więc bezpieczna kolejność: `wrangler d1 migrations apply my-english-day-db --remote`, dopiero potem `wrangler deploy`.
- **Poprawka**: Odnotować kolejność w epilogu zmiany / checkliście deployu (zgodnie z §Migration Notes planu).
- **Decyzja**: NAPRAWIONE — checklista deployu dopisana do `follow-ups/review-fixes.md` (2026-09-02)

### F5 — Zmiana poza planem: zakładka „Fiszki" w webowym tab-barze

- **Ważność**: 💡 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Dyscyplina zakresu
- **Lokalizacja**: src/components/app-tabs.web.tsx:28-30 (commit c0ee553)
- **Szczegóły**: +3 linie (`TabTrigger name="flashcards"`) spoza planu, dodane podczas weryfikacji manualnej, bo webowy tab-bar (pozostałość po starterze) nie miał dojścia do ekranu `/flashcards`. Nie narusza granic planu (zakaz dotyczył ekranów fiszek i ekspozycji `is_variant`), kopiuje istniejący wzorzec co do znaku, wydzielona w osobny, opisany commit.
- **Poprawka**: Brak działania — osobny commit wystarczająco dokumentuje; nie wymaga aneksu do planu.
- **Decyzja**: ZAAKCEPTOWANE — bez działania; commit c0ee553 dokumentuje zmianę (2026-09-02)

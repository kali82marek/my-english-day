# Follow-upy z przeglądu implementacji (2026-09-02)

> Kolejka dalszych działań z `reviews/impl-review.md`. Jedna pozycja = jedno wąskie zadanie do podjęcia poza zakresem zamkniętej zmiany.

## F1 — Atomowy zapis fiszek przez `DB.batch`

- **Źródło**: impl-review F1 (⚠️ OSTRZEŻENIE), decyzja: Poprawka B (odroczenie zgodne z planem, §Performance Considerations).
- **Zadanie**: W `api/src/routes/situations.ts` (`generateAndStoreFlashcards`, linie ~79–98) zamienić pętlę `INSERT` + końcowy `UPDATE situations SET flashcards_status='done'` na jedno `env.DB.batch([...])` — batch D1 wykonuje się w niejawnej transakcji (wszystko albo nic), co eliminuje częściowe wiersze `proposed` przy błędzie w środku pętli i przyszłe duplikaty przy ewentualnym retry; redukuje też ~9 round-tripów do 1.
- **Kiedy**: Przy najbliższej zmianie dotykającej pipeline'u generowania (naturalnie: S-04 dedup) albo jako drobny samodzielny chore. Warto sparować z testem ścieżki `generateAndStoreFlashcards` (dziś niepokrytej) — patrz nadchodzący test-plan (Moduł 3).

## F4 — Checklista najbliższego deployu produkcyjnego

- **Źródło**: impl-review F4 (💡 OBSERWACJA), decyzja: odnotować kolejność.
- **Zadanie**: Przy najbliższym wdrożeniu `api/` na produkcję zachować kolejność (migracja addytywna → bezpieczna dla starego kodu, ale nowy kod na starej bazie failuje generowanie):
  1. `cd api && npx wrangler d1 migrations apply my-english-day-db --remote`
  2. dopiero potem `npx wrangler deploy`
- **Kontekst**: nowy INSERT w `generateAndStoreFlashcards` wymienia kolumnę `is_variant` jawnie; §Migration Notes planu S-03 przewiduje ten krok.

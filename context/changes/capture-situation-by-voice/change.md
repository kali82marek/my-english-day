---
change_id: capture-situation-by-voice
title: Przechwytywanie sytuacji głosem — nagranie po polsku, transkrypcja i zapis
status: impl_reviewed
created: 2026-06-07
updated: 2026-06-08
archived_at: null
---

## Notes

Źródło: roadmap S-01 (`context/foundation/roadmap.md`), Stream A — krytyczna ścieżka do gwiazdy przewodniej S-02.

- **Outcome:** jednym naciśnięciem nagrać po polsku przeżytą sytuację → system transkrybuje bez kroku edycji i zapisuje → użytkownik widzi listę zapisanych sytuacji dnia.
- **PRD refs:** US-01, FR-003, FR-004, FR-005.
- **Prerekwizyt:** F-01 (`minimal-auth-app-spine`) — gotowy (auth + sesja + uwierzytelniony klient API).
- **Guardrail:** błyskawiczny zapis („kilka sekund" od naciśnięcia do potwierdzenia) — wolne nagrywanie/transkrypcja zabije nawyk.
- **Otwarte (Owner: user, non-blocking):** mierzalne progi szybkości („kilka sekund"). Por. Open Roadmap Question #1 (NFR).

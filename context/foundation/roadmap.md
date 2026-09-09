---
project: "My English Day"
version: 1
status: draft
created: 2026-05-31
updated: 2026-09-09
prd_version: 1
main_goal: speed
top_blocker: capacity
---

# Roadmap: My English Day

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Nauka angielskiego z oderwanych od życia fiszek jest mało skuteczna — słówka nie zostają w głowie, bo nie są powiązane z realnymi sytuacjami. "My English Day" pozwala samoukowi nagrać głosowo po polsku przeżytą sytuację, a AI zamienia ją w angielskie fiszki zakotwiczone w tym, co naprawdę się wydarzyło, do nauki metodą powtórek.

Wedge produktu — jedna cecha, której usunięcie czyni produkt nieodróżnialnym od zwykłego generatora fiszek — to fakt, że fiszki są (1) generowane przez AI z **własnej, przeżytej sytuacji użytkownika** opisanej głosem po polsku oraz (2) **bramkowane decyzją człowieka** (akceptuj/odrzuć), zanim trafią do nauki.

## North star

**S-02: Użytkownik dostaje fiszki AI z sytuacji i akceptuje lub odrzuca** — to kamień milowy walidacji: pierwszy moment, w którym mierzalne Kryterium sukcesu („≥70% fiszek akceptowanych bez poprawek") da się sprawdzić, więc decyduje o sensie całej reszty.

> Gwiazda przewodnia (north star) oznacza tu najmniejszą pełną ścieżkę, której udane dostarczenie udowadnia główną hipotezę produktu — umieszczoną tak wcześnie, jak pozwalają prerekwizyty, bo wszystko inne ma znaczenie tylko, jeśli to zadziała.

## At a glance

| ID    | Change ID                     | Outcome (użytkownik może …)                                         | Prerequisites | PRD refs                     | Status   |
| ----- | ----------------------------- | ------------------------------------------------------------------- | ------------- | ---------------------------- | -------- |
| F-01  | minimal-auth-app-spine        | (foundation) konto + trwała sesja + uwierzytelniony szkielet aplikacji | —             | FR-001, FR-002, Access Control | done     |
| S-01  | capture-situation-by-voice    | nagrać głosowo sytuację po polsku i zobaczyć ją zapisaną             | F-01          | US-01, FR-003, FR-004, FR-005 | done     |
| S-02  | gated-ai-flashcard-generation | dostać fiszki AI z sytuacji i zaakceptować lub odrzucić każdą        | S-01, F-01    | US-01, FR-006, FR-009, FR-010 | done     |
| S-03  | same-context-variants         | dostać warianty fiszek w obrębie tego samego kontekstu sytuacji      | S-02          | FR-007                        | done     |
| S-04  | duplicate-card-filtering      | mieć pewność, że nowe fiszki nie dublują jego istniejącej bazy       | S-02          | FR-008                        | done |
| S-05  | srs-review-session            | uczyć się z fiszek w sesji powtórek z 3 przyciskami oceny            | S-02          | US-01, FR-011, FR-012         | done |

## Streams

Navigation aid — grupuje elementy dzielące łańcuch prerekwizytów. Kanoniczna kolejność nadal żyje w grafie zależności poniżej; ta tabela to proponowana kolejność czytania w równoległych torach.

| Stream | Theme                  | Chain                       | Note                                                                 |
| ------ | ---------------------- | --------------------------- | ------------------------------------------------------------------- |
| A      | Spina i przechwytywanie | `F-01` → `S-01` → `S-02`    | Krytyczna ścieżka do gwiazdy przewodniej (S-02) — sekwencyjna.       |
| B      | Jakość generowania      | `S-03` / `S-04`             | Rozgałęzia się od `S-02`; oba slice'y równoległe względem siebie.    |
| C      | Pętla powtórek          | `S-05`                      | Rozgałęzia się od `S-02`; domyka US-01; równoległy do Streamu B.     |

(Każdy `F-NN` i `S-NN` pojawia się w dokładnie jednym streamie. Po S-02 streamy B i C są wzajemnie równoległe — to dźwignia przy blokerze `capacity`.)

## Baseline

Co jest już w kodzie na dzień `2026-05-31` (auto-research + potwierdzone przez użytkownika).
Fundamenty poniżej zakładają, że to istnieje, i NIE scaffoldują tego ponownie.

- **Frontend:** partial — Expo Router + theming działają, ale tylko ekrany szablonu (`src/app/index.tsx`, `src/app/explore.tsx`). Brak nagrywania audio, zarządzania stanem, klienta API, ekranów auth.
- **Backend / API:** partial — Worker Hono wdrożony (`api/src/index.ts`), tylko `GET /health`. Brak endpointów produktowych.
- **Data:** absent — D1 podpięty jako binding `DB` (`api/wrangler.toml`), ale baza pusta, 0 tabel, brak migracji i ORM.
- **Auth:** absent — brak hashowania haseł, JWT, handlerów logowania/rejestracji i middleware (sekret `JWT_SECRET` jednak ustawiony).
- **Deploy / infra:** present (partial) — `api/wrangler.toml` z bindingiem D1, sekrety `JWT_SECRET` i `OPENAI_API_KEY` ustawione, pierwszy deploy Worker + Pages wykonany. Brak CI/CD (`.github/workflows`).
- **Observability:** absent — brak logowania, śledzenia błędów i metryk w Workerze.

## Foundations

### F-01: Minimalny auth i szkielet aplikacji

- **Outcome:** (foundation) konto (email + hasło) zakładane i logowane, sesja trwała do wylogowania, uwierzytelniony szkielet aplikacji (przechowywanie sesji + routing chroniony + uwierzytelniony klient API) gotowy dla wszystkich slice'ów.
- **Change ID:** minimal-auth-app-spine
- **PRD refs:** FR-001, FR-002, sekcja Access Control
- **Unlocks:** S-01 (przechwytywanie sytuacji wymaga konta per-użytkownik i wywołań API z tokenem), S-02 oraz wszystkie kolejne slice'y; zdejmuje Open Roadmap Question #2 (zachowanie dla niezalogowanego użytkownika).
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Co dokładnie widzi niezalogowany użytkownik trafiający na chroniony ekran? — Owner: user. Block: no.
- **Risk:** Sekwencjonowane jako pierwsze, bo każdy slice produktowy potrzebuje tożsamości użytkownika i uwierzytelnionych wywołań API. Ryzyko: rozrost do pełnego systemu auth — trzymać minimum (rejestracja, logowanie, trwała sesja, middleware), resztę odłożyć. To enabler, nie ścieżka walidacji.
- **Status:** done

## Slices

### S-01: Przechwytywanie sytuacji głosem

- **Outcome:** użytkownik może jednym naciśnięciem nagrać po polsku przeżytą sytuację, system transkrybuje ją bez kroku edycji i zapisuje, a użytkownik widzi listę zapisanych sytuacji dnia.
- **Change ID:** capture-situation-by-voice
- **PRD refs:** US-01, FR-003, FR-004, FR-005
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Jakie są mierzalne progi szybkości („kilka sekund" od naciśnięcia do potwierdzenia)? — Owner: user. Block: no.
- **Risk:** Sekwencjonowane przed generowaniem, bo bez zapisanych sytuacji nie ma z czego generować fiszek. Główny guardrail PRD (błyskawiczny zapis) żyje tutaj — wolne nagrywanie zabije nawyk. Ryzyko: opóźnienie transkrypcji psujące „kilka sekund".
- **Status:** done

### S-02: Generowanie fiszek AI z akceptacją (gwiazda przewodnia)

- **Outcome:** użytkownik może wieczorem zobaczyć fiszki angielskie wygenerowane przez AI z sytuacji dnia (AI dobiera typy: słówka / zwroty / zdania) i każdą zaakceptować lub odrzucić; zaakceptowane od razu trafiają do bazy nauki.
- **Change ID:** gated-ai-flashcard-generation
- **PRD refs:** US-01, FR-006, FR-009, FR-010
- **Prerequisites:** S-01, F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Jaka strategia generowania (prompt + dobór typów fiszek) osiąga Kryterium sukcesu ≥70% akceptacji bez poprawek? — Owner: team. Block: no.
- **Risk:** Gwiazda przewodnia — sekwencjonowana tak wcześnie, jak pozwalają prerekwizyty, bo to najmniejszy fragment dający się wypuścić, który udowadnia rdzeń produktu (cel `speed`: najpierw ścieżka must-have do działającej pętli). Filtrowanie duplikatów (FR-008) świadomie odłożone do S-04: na pustej/małej bazie duplikatów nie ma, więc nie blokuje pierwszego wydania.
- **Status:** done

### S-03: Warianty w obrębie tego samego kontekstu

- **Outcome:** użytkownik może dostać warianty fiszek — rozszerzenia ściśle w obrębie tej samej sytuacji (ten sam sklep/rozmowa, inne detale: inny produkt, inna kwota, inne pytanie) — ucząc się elastyczności językowej, nie papugowania jednej frazy.
- **Change ID:** same-context-variants
- **PRD refs:** FR-007
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Ile wariantów na sytuację jest wartościowych zanim koszt wywołań AI przeważy korzyść? — Owner: team. Block: no.
- **Risk:** Sekwencjonowane po S-02, bo wzbogaca działający pipeline generowania. Warianty to must-have i deklarowana „kluczowa wartość" PRD, więc zostają na ścieżce; przy celu `speed` mogą iść równolegle z S-04/S-05, by nie wydłużać drogi do pełnej pętli. Ryzyko: warianty wychodzą poza kontekst lub zalewają przegląd.
- **Status:** done

### S-04: Filtrowanie duplikatów względem bazy użytkownika

- **Outcome:** użytkownik ma pewność, że nowe propozycje fiszek nie dublują jego istniejącej bazy — duplikat to dokładnie to samo słowo/zwrot; synonimy i warianty zostają jako osobne fiszki.
- **Change ID:** duplicate-card-filtering
- **PRD refs:** FR-008
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-05
- **Blockers:** —
- **Unknowns:**
  - Jak operacyjnie zdefiniować „duplikat" (dokładne dopasowanie vs normalizacja wielkości liter / interpunkcji)? — Owner: team. Block: no.
- **Risk:** Sekwencjonowane po S-02, bo dedup ma sens dopiero, gdy baza rośnie. Realizuje guardrail PRD „fiszki nie mogą się dublować". Ryzyko: zbyt agresywne filtrowanie usunie wartościowe synonimy/warianty (PRD wprost ostrzega).
- **Status:** done

### S-05: Sesja powtórek (spaced repetition)

- **Outcome:** użytkownik może rozpocząć sesję nauki z fiszkami z bazy, prezentowanymi według algorytmu powtórek, oceniając każdą trzema przyciskami: Nie umiem / Prawie / Umiem.
- **Change ID:** srs-review-session
- **PRD refs:** US-01, FR-011, FR-012
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:**
  - Jaki model odstępów odwzorować na 3 przyciski oceny? — Owner: team. Block: no.
- **Risk:** Sekwencjonowane po S-02, bo wymaga zaakceptowanych fiszek w bazie. Domyka pętlę US-01 i drugorzędne Kryterium sukcesu („uczy się codziennie z fiszek"). Ryzyko: model powtórek źle dobrany do 3 przycisków obniży retencję.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                     | Suggested issue title                                   | Ready for `/10x-plan` | Notes                                  |
| ---------- | ----------------------------- | ------------------------------------------------------- | --------------------- | -------------------------------------- |
| F-01       | minimal-auth-app-spine        | Minimalny auth + uwierzytelniony szkielet aplikacji     | done                  | Zarchiwizowano 2026-09-02              |
| S-01       | capture-situation-by-voice    | Nagrywanie i zapis sytuacji głosem                      | done                  | Zarchiwizowano 2026-09-02              |
| S-02       | gated-ai-flashcard-generation | Generowanie fiszek AI z akceptacją (gwiazda przewodnia) | done                  | Zarchiwizowano 2026-09-02              |
| S-03       | same-context-variants         | Warianty fiszek w tym samym kontekście                  | done                  | Zarchiwizowano 2026-09-02              |
| S-04       | duplicate-card-filtering      | Filtrowanie duplikatów fiszek                           | yes                   | S-02 done; równoległy z S-05           |
| S-05       | srs-review-session            | Sesja powtórek z 3 przyciskami oceny                    | yes                   | S-02 done; równoległy z S-04           |

## Open Roadmap Questions

1. **Jakie są konkretne mierzalne cele NFR (np. < 3 s na ścieżkę nagrania, płynność UI)?** — Owner: user. Block: gates progów weryfikacji S-01, nie blokuje planowania (`roadmap-wide`).
2. **Co widzi niezalogowany użytkownik próbujący użyć aplikacji?** — Owner: user. Block: dotyczy F-01 (routing chroniony), nie blokuje planowania.

## Parked

- **Grafiki/zdjęcia do fiszek** — Why parked: PRD §Non-Goals — MVP to fiszki wyłącznie tekstowe; grafiki w v2.
- **Współdzielenie fiszek między użytkownikami** — Why parked: PRD §Non-Goals — każdy ma zamkniętą bazę, brak społeczności.
- **Automatyczne wykrywanie sytuacji (GPS, kalendarz, mikrofon w tle)** — Why parked: PRD §Non-Goals — tylko ręczne nagrywanie głosowe.
- **Import z plików (PDF, zdjęcia, dokumenty)** — Why parked: PRD §Non-Goals — jedynym źródłem fiszek są nagrania głosowe.
- **Edycja fiszek w przeglądzie** — Why parked: FR-009 wprost odracza edycję do v2; w MVP tylko akceptuj/odrzuć.
- **CI/CD (auto-deploy on merge na GitHub Actions)** — Why parked: deploy ręczny już działa; przy blokerze `capacity` automatyzację dołożyć, gdy toil iteracji zacznie przeszkadzać (intencja w `tech-stack.md` hints).

## Done

(Pusta przy pierwszej generacji. `/10x-archive` dopisuje wpis tutaj — i przełącza Status elementu na `done` — gdy archiwizowana jest zmiana o pasującym Change ID. NIE wypełniać ręcznie.)

- **F-01: (foundation) konto (email + hasło) zakładane i logowane, sesja trwała do wylogowania, uwierzytelniony szkielet aplikacji (przechowywanie sesji + routing chroniony + uwierzytelniony klient API) gotowy dla wszystkich slice'ów.** — Zarchiwizowano 2026-09-02 → `context/archive/2026-06-02-minimal-auth-app-spine/`. Lekcja: —.
- **S-01: użytkownik może jednym naciśnięciem nagrać po polsku przeżytą sytuację, system transkrybuje ją bez kroku edycji i zapisuje, a użytkownik widzi listę zapisanych sytuacji dnia.** — Zarchiwizowano 2026-09-02 → `context/archive/2026-06-07-capture-situation-by-voice/`. Lekcja: —.
- **S-02: użytkownik może wieczorem zobaczyć fiszki angielskie wygenerowane przez AI z sytuacji dnia (AI dobiera typy: słówka / zwroty / zdania) i każdą zaakceptować lub odrzucić; zaakceptowane od razu trafiają do bazy nauki.** — Zarchiwizowano 2026-09-02 → `context/archive/2026-06-07-gated-ai-flashcard-generation/`. Lekcja: —.
- **S-03: użytkownik może dostać warianty fiszek — rozszerzenia ściśle w obrębie tej samej sytuacji (ten sam sklep/rozmowa, inne detale: inny produkt, inna kwota, inne pytanie) — ucząc się elastyczności językowej, nie papugowania jednej frazy.** — Zarchiwizowano 2026-09-02 → `context/archive/2026-06-09-same-context-variants/`. Lekcja: —.
- **S-04: użytkownik ma pewność, że nowe propozycje fiszek nie dublują jego istniejącej bazy — duplikat to dokładnie to samo słowo/zwrot; synonimy i warianty zostają jako osobne fiszki.** — Zarchiwizowano 2026-09-09 → `context/archive/2026-09-09-duplicate-card-filtering/`. Lekcja: —.
- **S-05: użytkownik może rozpocząć sesję nauki z fiszkami z bazy, prezentowanymi według algorytmu powtórek, oceniając każdą trzema przyciskami: Nie umiem / Prawie / Umiem.** — Zarchiwizowano 2026-09-09 → `context/archive/2026-09-09-srs-review-session/`. Lekcja: —.

---
project: "My English Day"
version: 1
status: draft
created: 2026-05-24
context_type: greenfield
product_type: mobile
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Nauka angielskiego z gotowych, oderwanych od życia fiszek jest mało skuteczna — słówka i zwroty nie zostają w głowie, bo nie są powiązane z realnymi sytuacjami, w których naprawdę byłyby potrzebne. Samouk angielskiego codziennie przeżywa momenty, w których chciałby coś powiedzieć po angielsku — w pracy, w sklepie, w rozmowie — ale nie wie jak. Te sytuacje przepadają i nigdy nie stają się materiałem do nauki.

Nikt nie łączy dziennika sytuacji z generowaniem fiszek. Istnieją aplikacje do fiszek (Anki, Quizlet) i istnieją dzienniki — ale żadne narzędzie nie pozwala zapisać sytuacji po polsku i automatycznie zamienić jej w materiał do nauki angielskiego zakotwiczony w tym, co faktycznie przeżyłeś.

## User & Persona

### Primary persona
Samouk angielskiego na poziomie podstawowym. Nie kursant, nie student — osoba, która uczy się sama, bo potrzebuje angielskiego w codziennych sytuacjach życiowych: w pracy, w sklepie, w kontakcie z klientami, w usługach. Realistycznie patrzy na swoje potrzeby — nie chce "znać angielski", chce umieć powiedzieć to, co naprawdę chce powiedzieć w sytuacjach, w których się znajduje. Sięga po telefon w momencie, gdy właśnie przeżył taką sytuację — lub chwilę po niej.

## Success Criteria

### Primary
- Co najmniej 70% fiszek wygenerowanych przez AI jest akceptowanych przez użytkownika bez poprawek — to dowodzi, że AI rozumie sytuacje i generuje trafny materiał do nauki.

### Secondary
- Użytkownik zapisuje sytuacje codziennie — nawyk zapisu się utrwalił.
- Użytkownik codziennie uczy się z fiszek i wykonuje powtórki.

### Guardrails
- Nagrywanie sytuacji musi być błyskawiczne — od otwarcia aplikacji do wysłania nagrania w kilka sekund. Jeśli jest wolne, użytkownik przestanie zapisywać, a bez zapisów nie ma fiszek.
- Fiszki nie mogą się dublować z istniejącą bazą użytkownika. Duplikaty podważają zaufanie do AI i mącą naukę.

## User Stories

### US-01: Użytkownik zapisuje sytuację i uczy się z niej wieczorem

- **Given** zalogowany użytkownik, który właśnie przeżył sytuację wymagającą angielskiego
- **When** naciśnie przycisk nagrywania i opisze sytuację głosowo po polsku
- **Then** sytuacja zostaje zapisana, a wieczorem widzi wygenerowane fiszki angielskie do akceptacji, po czym może uczyć się z nich w sesji powtórek

#### Acceptance Criteria
- Nagranie → transkrypcja → zapis w kilka sekund
- Fiszki gotowe do przeglądu gdy użytkownik otworzy aplikację wieczorem
- Akceptuj/odrzuć na każdej fiszce, zaakceptowane od razu w bazie nauki
- Sesja nauki z 3 przyciskami: Nie umiem / Prawie / Umiem

## Functional Requirements

### Rejestracja i logowanie
- FR-001: Użytkownik może założyć konto (email + hasło). Priority: must-have
  > Socrates: Counter-argument: rejestracja emailem odstraszy samouka? Resolution: kept; rejestracja to jednorazowy koszt, nie codzienne tarcie.
- FR-002: Użytkownik może zalogować się do aplikacji; sesja trwa permanentnie, dopóki użytkownik sam się nie wyloguje. Priority: must-have
  > Socrates: Counter-argument: logowanie za każdym razem łamie zasadę "jedno naciśnięcie i nagrywam". Resolution: zmieniono na sesję permanentną — logowanie jednorazowe.

### Zapis sytuacji
- FR-003: Użytkownik może jednym naciśnięciem przycisku nagrać wiadomość głosową opisującą sytuację po polsku. Priority: must-have
  > Socrates: Counter-argument: co jeśli użytkownik nie może mówić (autobus, biuro)? Resolution: kept; tylko głos — to serce produktu. Kto nie może mówić, nagra później.
- FR-004: System transkrybuje nagranie głosowe na tekst i zapisuje sytuację — bez etapu edycji transkrypcji. Priority: must-have
  > Socrates: Counter-argument: transkrypcja z potocznego polskiego może być niedokładna. Resolution: kept; AI generujące fiszki zinterpretuje sens. Dodatkowy krok edycji łamie zasadę szybkości.
- FR-005: Użytkownik może zapisywać wiele sytuacji w ciągu dnia (dowolna liczba, bez limitu). Priority: must-have
  > Socrates: Counter-argument: 50 sytuacji = 200 fiszek do przejrzenia wieczorem. Resolution: kept; samouk sam reguluje ile nagrywa.

### Generowanie fiszek
- FR-006: System generuje fiszki angielskie z zapisanych sytuacji dnia — AI decyduje, które typy (pojedyncze słówka, zwroty, pełne zdania) pasują do danej sytuacji. Priority: must-have
  > Socrates: Counter-argument: generowanie wszystkich trzech typów z każdej sytuacji = za dużo fiszek. Resolution: zmieniono; AI dobiera typy do sytuacji, nie generuje zawsze wszystkich.
- FR-007: System generuje warianty sytuacji — rozszerzenia ściśle w obrębie tego samego kontekstu (ten sam sklep, ta sama rozmowa, inne detale — inny produkt, inna kwota, inne pytanie). Priority: must-have
  > Socrates: Counter-argument: warianty = dodatkowe wywołania AI i więcej fiszek, może wystarczą same fiszki z tego co się wydarzyło? Resolution: kept; warianty uczą elastyczności językowej, nie papugowania jednej frazy. To kluczowa wartość.
- FR-008: System sprawdza bazę fiszek użytkownika i nie tworzy duplikatów. Duplikat = to samo słowo/zwrot; synonimy i warianty to różne fiszki i zostają. Priority: must-have
  > Socrates: Counter-argument: zbyt ścisłe filtrowanie usunie wartościowe warianty. Resolution: zmieniono; duplikat to tylko dokładna powtórka, nie synonim.

### Przegląd i akceptacja
- FR-009: Użytkownik może przeglądać propozycje fiszek dnia i każdą zaakceptować lub odrzucić (bez edycji w MVP). Priority: must-have
  > Socrates: Counter-argument: co jeśli fiszka jest blisko ale nie idealna — brak edycji? Resolution: kept; prostsze. Jeśli fiszka nie pasuje — odrzucasz. Edycja w v2.
- FR-010: Zaakceptowane fiszki trafiają od razu do bazy nauki. Priority: must-have

### Nauka i powtórki
- FR-011: Użytkownik może rozpocząć sesję nauki z fiszkami z bazy. Priority: must-have
- FR-012: System prezentuje fiszki w oparciu o algorytm powtórek (spaced repetition) z 3 przyciskami oceny: Nie umiem / Prawie / Umiem. Priority: must-have
  > Socrates: Counter-argument: pełny model Anki (4 przyciski) daje precyzyjniejsze odstępy. Resolution: zmieniono na 3 przyciski — złoty środek między precyzją a prostotą. "Prawie" łapie kluczowe "wiem, ale nie do końca" bez stresu mikrodecyzji.

## Non-Functional Requirements

- Cały proces nagrania sytuacji — od naciśnięcia przycisku do potwierdzenia wysłania — zamyka się w kilku sekundach. Długie czekanie na transkrypcję lub potwierdzenie zniechęci użytkownika do zapisywania sytuacji.
- Aplikacja działa płynnie na telefonie — to główne urządzenie samouka, który nagrywa sytuacje w biegu, na ulicy, przy przystanku.

## Business Logic

Aplikacja przekształca potoczny, nieformalny opis sytuacji po polsku — nagrany głosowo, niekoniecznie poprawny składniowo — w poprawne angielskie zwroty, zdania i słówka osadzone w kontekście tej sytuacji, wraz z wariantami tego samego kontekstu, filtrując duplikaty z istniejącej bazy użytkownika.

Wejście: notatka głosowa po polsku, potoczna mowa opisująca przeżytą sytuację ("byłem w sklepie, chciałem kupić jabłka, kosztowały tyle i tyle, zapytałem panią czy są pomidory"). Użytkownik nie musi mówić poprawnie — opisuje co przeżył swoimi słowami.

Wyjście: zestaw fiszek angielskich w trzech możliwych typach (AI dobiera typy do sytuacji): pojedyncze słówka, zwroty, pełne zdania. Każda fiszka jest zakotwiczona w konkretnej sytuacji użytkownika. Dodatkowo generowane są warianty — rozszerzenia ściśle w obrębie tego samego kontekstu (ten sam sklep, ta sama rozmowa, inne detale). Fiszki identyczne z już istniejącymi w bazie użytkownika nie są tworzone.

Jak użytkownik spotyka wynik: wieczorem otwiera aplikację, widzi gotowe propozycje fiszek z sytuacji dnia, akceptuje lub odrzuca, zaakceptowane trafiają do bazy nauki.

## Access Control

Login przez email + hasło. Konto w chmurze — fiszki i sytuacje przechowywane na serwerze, dostępne z każdego urządzenia. Płaski model uprawnień: każdy użytkownik widzi tylko swoje dane, brak ról, brak admina.

## Non-Goals

- Bez grafik/zdjęć do fiszek — MVP to fiszki wyłącznie tekstowe. Generowanie grafik w v2; przy większej skali rozważyć współdzielenie grafik między użytkownikami, żeby nie generować duplikatów.
- Bez współdzielenia fiszek między użytkownikami — każdy użytkownik ma swoją zamkniętą bazę, brak społeczności ani udostępniania.
- Bez automatycznego wykrywania sytuacji (GPS, kalendarz, mikrofon w tle) — tylko ręczne nagrywanie głosowe przez użytkownika.
- Bez importu z plików (PDF, zdjęcia, dokumenty) — jedynym źródłem fiszek są nagrania głosowe użytkownika.

## Open Questions

1. **Jakie są konkretne mierzalne cele NFR?** — "kilka sekund" i "płynnie" to cele jakościowe; brak konkretnych liczb (np. < 3s, 60 fps). Kto rozstrzyga: użytkownik. Block: nie (MVP można budować z jakościowymi celami, ale warto doprecyzować przed testami).
2. **Co widzi niezalogowany użytkownik próbujący użyć aplikacji?** — Access Control opisuje model uprawnień, ale nie definiuje zachowania dla niezalogowanego użytkownika trafiającego na chroniony ekran. Kto rozstrzyga: użytkownik. Block: nie.

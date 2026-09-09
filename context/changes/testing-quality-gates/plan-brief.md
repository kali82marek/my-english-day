# Faza 4 testów: bramki jakości — Krótki plan

> Pełny plan: `context/changes/testing-quality-gates/plan.md`
> Badania: `context/changes/testing-quality-gates/research.md`

## Co i dlaczego

Jedno polecenie `npm run gate` z katalogu głównego (regeneracja typów Expo → lint z zerową
tolerancją warningów → `tsc` front → `tsc` api → testy api), które pada, gdy pada cokolwiek,
oraz checklista deployu z obowiązkową kolejnością migracja D1 → `wrangler deploy` (ryzyko #4
test-planu). Dziś cztery bramki są ręczne i rozproszone po planach, a jedyna checklista żyje
w zarchiwizowanym follow-upie S-03; migracja 0005 czeka na produkcję.

## Punkt wyjścia

Wszystkie cztery warstwy są zielone i tanie (≈ 20 s łącznie), ale nie ma agregatu, root nie
ma `typecheck`, `expo lint` nie obala na warningach, a `tsc` na świeżym checkout pada z braku
gitignored `expo-env.d.ts`. `deploy-plan.md` pomija krok migracji; `CLAUDE.md` twierdzi, że
testów nie ma.

## Pożądany stan końcowy

`npm run gate` → 0 na czystym i „świeżym” drzewie, ≠ 0 przy błędzie w dowolnej warstwie
(pięć deliberate-breaków jako dowód). `context/deployment/deploy-checklist.md` podlinkowany
z rekordu deployu i z `CLAUDE.md`, z rejestrem długu migracyjnego (0005 → prod, następna 0006).
test-plan §5 mówi `required — npm run gate`, §6.8 opisuje pełną bramkę, §6.7 zapisuje lekcje.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Forma bramki | Jeden skrypt npm z `&&`, bez `.ps1`/`.sh`, bez `concurrently` | Skrypty npm biegną w cmd.exe — `&&` propaguje kody (zmierzone); 20 s nie uzasadnia równoległości ani drugiego pliku | Badania |
| Nazwa skryptu | `gate` (+ `typecheck` w root) | Zgodne ze słownictwem §5 test-planu; `typecheck` symetryczne z `api/` | Plan |
| Kolejność kroków | customize → lint → tsc → tsc api → vitest | Koszt rosnąco; regeneracja typów pierwsza usuwa pułapkę świeżego checkoutu | Badania |
| Regeneracja typów | `expo customize tsconfig.json` w bramce | Jedyna nieinteraktywna droga w SDK 56; `expo export` nie generuje; git zostaje czysty | Badania |
| Lint | `expo lint --max-warnings 0` | Domyślnie warningi nigdy nie obalają; baseline ma 0 warningów | Badania |
| Wejście do api | `npm --prefix api run …` | Działa z dowolnego cwd; istniejące `api:*` z `cd api` nietknięte | Plan |
| Dowód | Deliberate-break per warstwa + „świeży checkout”, kody wyjścia w Postępie | Bramka bez dowodu obalania to lista poleceń w README | Badania |
| Checklista | `context/deployment/deploy-checklist.md` obok `deploy-plan.md` | Tam agent szuka deployu; archiwum jest tylko do odczytu | Plan |
| Deploy 0005 | Wiersz Ręczny (login, decyzja użytkownika) | `wrangler` niezalogowany w powłoce nieinteraktywnej; deploy to działanie nieodwracalne dla D1 | Badania |
| CI / hooki | Nazwane, nie konfigurowane | Lekcja CI i Lekcja 3; bramka to polecenie, które CI wywoła bez zmian | Plan |
| CLAUDE.md | Tylko sekcja poleceń + zdanie o backendzie | Plik reguł; blok lekcji nietykalny | Plan |

## Zakres

**W zakresie:** skrypty `gate` i `typecheck` w root; `deploy-checklist.md`; odsyłacze w
`deploy-plan.md` i `CLAUDE.md`; test-plan §5, §6.8, §6.7, §8; epilog `change.md`.

**Poza zakresem:** YAML CI, hooki, nowe zależności, runner frontu, e2e automatyczne, testy
SQL migracji / `PRAGMA`, faktyczny deploy 0005 (wiersz ręczny), przepisywanie `deploy-plan.md`,
root `npm test`.

## Architektura / Podejście

`package.json` → `gate` = pięć kroków łańcuchem; `api/` wywoływane przez `--prefix`.
Dokumentacja w trzech miejscach o różnych czytelnikach: checklista (człowiek przed deployem),
`CLAUDE.md` (agent na starcie sesji), test-plan §5/§6.8 (kontrakt jakości). Dowód działania
to deliberate-breaki, nie testy w repo.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Bramka `npm run gate` | Dwa skrypty w root, pięć deliberate-breaków z kodami wyjścia | `expo customize` zaczyna brudzić `tsconfig.json`/`.gitignore` na innym stanie drzewa |
| 2. Checklista deployu | `deploy-checklist.md` + odsyłacze + korekta `CLAUDE.md` | Rejestr długu błędny bez `list --remote` (wiersz ręczny) |
| 3. test-plan + zamknięcie | §5 `required`, §6.8, §6.7, §8; `change.md` implemented | Diff wychodzący poza §5/§6.7/§6.8 |

**Wymagania wstępne:** commit 589968b (research), `npm install` w root i `api/` (już jest).
**Szacowany wysiłek:** 1 sesja, 3 fazy, 3 commity; ~30 min pracy agenta + ręczny deploy.

## Otwarte ryzyka i założenia

- Stan migracji na produkcji zakładany (0001–0004 tak, 0005 nie) — potwierdza wiersz 2.6.
- `expo customize tsconfig.json` bez `CI=1` w interaktywnej powłoce nie pyta (wg
  `customizeAsync.js:43-49`) — potwierdza wiersz 1.9.
- Deliberate-break lint zależy od tego, że `eslint-config-expo` zgłasza nieużywany import
  jako warning/error — przy `--max-warnings 0` obie klasy obalają.

## Kryteria sukcesu (podsumowanie)

- Człowiek i agent uruchamiają JEDNO polecenie i wiedzą w 20 s, czy wolno commitować.
- Przed deployem nikt nie musi szukać w archiwum, w jakiej kolejności migrować i deployować.
- test-plan §5 nie ma już „required after Phase 4”; `--refresh` nie odkrywa skorygowanych założeń na nowo.

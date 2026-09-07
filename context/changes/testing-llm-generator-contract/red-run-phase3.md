# Faza 3 — czerwony przebieg przed poprawką (wejście do notatki §6.7)

Stan: testy T5.5–T5.10 dodane do `api/src/lib/flashcards.test.ts`, walidator jeszcze
nieobecny (kod produkcyjny jak w `150d044`). Polecenie:
`cd api && npx vitest run src/lib/flashcards.test.ts -t "Ryzyko #5"`.

Wynik: **6 zielonych (T5.1–T5.4), 14 czerwonych** — zgodnie z przewidywaniem planu.

| Test | Klasa odrzucenia przed poprawką | Co to znaczy |
|---|---|---|
| T5.5 `type: 'idiom'` | **`resolves`** z 3 kartami | przeciek do INSERT |
| T5.6 `is_variant` brak pola | `resolves` | koercja `? 1 : 0` → karta bazowa |
| T5.6 `is_variant: 'true'` | `resolves` | koercja → wariant |
| T5.6 `is_variant: 1` | `resolves` | koercja → wariant |
| T5.7 brak `example_en` | `resolves` | `NULL` w D1, front pada na `.trim()` |
| T5.7 `example_en: null` | `resolves` | j.w. |
| T5.7 brak `front_en` | **`TypeError`** (`Cannot read properties of undefined`) | odrzucenie przypadkowe |
| T5.7 brak `back_pl` | `TypeError` | odrzucenie przypadkowe |
| T5.7 `front_en: 42` | `TypeError` (`card.front_en.trim is not a function`) | odrzucenie przypadkowe |
| T5.8 zwykły tekst | **`SyntaxError`** (`Unexpected token 'O'`) | gołe `JSON.parse` |
| T5.8 ucięty JSON, `finish_reason: 'length'` | `SyntaxError` (`Unterminated string in JSON`) | gołe `JSON.parse` |
| T5.9 odmowa (`refusal`, `content: null`) | rzut domenowy, ale komunikat „bez treści” **bez tekstu odmowy** | `refusal` nieczytany |
| T5.10 `flashcards` = obiekt | `TypeError` (`.filter is not a function`) | `?? []` chroni tylko `null` |
| T5.10 `flashcards` = string | `TypeError` | j.w. |

Podsumowanie klas: 6 × `resolves` (przeciek), 5 × `TypeError`, 2 × `SyntaxError`,
1 × mylący komunikat. Żaden z T5.5–T5.10 nie był zielony przed poprawką — badanie §2
nie myliło się o żadnej ścieżce.

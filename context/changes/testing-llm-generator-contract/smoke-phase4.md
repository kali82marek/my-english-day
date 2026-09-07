# Faza 4 — deliberate-breaks i smoke z prawdziwym kluczem (wejście do notatki §6.7)

## Deliberate-breaks (kod przywrócony, suite 86 testów zielona)

| Zmiana | Skutek |
|---|---|
| walidator bez sprawdzenia `type` (`assertGeneratedCard`, `flashcards.ts`) | T5.11 „typ spoza kontraktu” **czerwony** (`expected 3 to have length 0` — 3 wiersze z `'idiom'`, `done`); wiersz „odmowa” zielony (pada na `content: null`, jak przewidziano — jego deliberate-break żyje w T5.9) |
| `situations.ts`: bind `'word'` zamiast `card.type` | T5.12 **czerwony** (projekcja `type`) |
| `situations.ts`: bind `0` zamiast `card.is_variant ? 1 : 0` | T5.12 **czerwony** (projekcja `is_variant`) |

## Smoke (2026-09-07, `wrangler dev --port 3030`, klucz z `.dev.vars`, gpt-4o)

Wejście: `api/scripts/sample.wav` (kawiarnia: latte na mleku owsianym, na miejscu/na
wynos, płatność kartą, paragon). Transkrypt `done` po ~6 s, `flashcards_status='done'`,
`generatingCount: 0`, **8 propozycji** — każda z `type` z trójki: 5 × `phrase`, 2 × `word`,
1 × `sentence`. 5 kart bazowych + 3 warianty (`is_variant: true` na końcu tablicy);
karta `sentence` przyszła z `example_en: ""` (legalne, jak w T5.3/T5.12). Brak `failed`.

Kształt żywej odpowiedzi (tymczasowy `console.log` w `generateFlashcards`, usunięty
przed commitem):

```
choices[0] = {
  index: 0,
  message: { role: 'assistant', content: '{"flashcards":[…]}', refusal: null, annotations: [] },
  logprobs: null,
  finish_reason: 'stop'
}
```

Potwierdzone założenia builderów i walidatora: `refusal: null` obecne w zwykłej
odpowiedzi (nie tylko przy odmowie), `finish_reason: 'stop'`. Nowe w żywej odpowiedzi,
nieobecne w mocku i ignorowane przez parser: `message.annotations: []`, `logprobs: null`
— pola dodatkowe nie są sygnałem (walidator czyta tylko `content`/`refusal`/`finish_reason`).

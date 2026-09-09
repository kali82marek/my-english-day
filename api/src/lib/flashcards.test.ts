import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateFlashcards } from './flashcards';
import { chatResponse, chatResponseRaw } from '../../test/openai-mock';

afterEach(() => {
  vi.restoreAllMocks();
});

const CARDS = [
  { type: 'word', front_en: 'invoice', back_pl: 'faktura', example_en: 'Send me the invoice.', is_variant: false },
  { type: 'sentence', front_en: 'Could you repeat that?', back_pl: 'Możesz powtórzyć?', example_en: '', is_variant: false },
];

// ---------------------------------------------------------------------------
// Wyrocznie kontraktu generatora (ryzyko #5, test-plan §2) — z produktu i archiwum,
// NIGDY z implementacji. Zmiana w kodzie MA zaczerwienić test: to sygnał do
// świadomej zmiany wyroczni, nie do „dopasowania” asercji.
// ---------------------------------------------------------------------------

// PRD Business Logic `context/foundation/prd.md:99` — trzy zamknięte typy fiszek;
// AI dobiera podzbiór do treści (FR-006), więc jeden typ w odpowiedzi jest poprawny.
const CARD_TYPES = ['word', 'phrase', 'sentence'];

// Cztery pola tekstowe karty: plan S-02
// `context/archive/2026-06-07-gated-ai-flashcard-generation/plan.md`;
// `is_variant` boolean per karta, warianty w tej samej tablicy: plan S-03
// `context/archive/2026-06-09-same-context-variants/plan.md:19-24`.
const REQUIRED_CARD_FIELDS = ['type', 'front_en', 'back_pl', 'example_en', 'is_variant'];

// Twardy sufit kart na sytuację: decyzja przeglądu S-03 F2
// `context/archive/2026-06-09-same-context-variants/reviews/impl-review.md:49-56`.
// NIE PRD (PRD milczy o liczbie) i NIE stała `MAX_CARDS` z implementacji — celowo
// nie importowana: podniesienie limitu w kodzie ma zaczerwienić T5.2.
const MAX_CARDS_ORACLE = 10;

/** Fixture n poprawnych kart (jak `makeCards` w teście integracyjnym): typy rotacyjnie, co druga wariant. */
function cards(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: CARD_TYPES[i % CARD_TYPES.length],
    front_en: `card ${i + 1}`,
    back_pl: `karta ${i + 1}`,
    example_en: `Example ${i + 1}.`,
    is_variant: i % 2 === 1,
  }));
}

const TRANSCRIPT = 'Dziś byłem w banku.';

describe('generateFlashcards', () => {
  it('buduje żądanie z modelem gpt-4o, Structured Outputs i transkryptem w wiadomości', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(CARDS));

    const cards = await generateFlashcards('Dziś byłem w banku.', 'sk-test');

    expect(cards).toEqual(CARDS);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');

    const payload = JSON.parse(init?.body as string);
    expect(payload.model).toBe('gpt-4o');
    expect(payload.response_format.type).toBe('json_schema');
    expect(payload.response_format.json_schema.strict).toBe(true);
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'Dziś byłem w banku.' });
    // Kształt schematu (required, enum, additionalProperties) pilnuje T5.1 poniżej.
  });

  it('parsuje fiszki z odpowiedzi modelu', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(CARDS));
    const cards = await generateFlashcards('cokolwiek', 'sk-test');
    expect(cards).toHaveLength(2);
    expect(cards[0].front_en).toBe('invoice');
  });

  it('przenosi flagę is_variant z mieszanki fiszek bazowych i wariantów', async () => {
    const mixed = [
      { type: 'word', front_en: 'apple', back_pl: 'jabłko', example_en: 'I bought an apple.', is_variant: false },
      { type: 'word', front_en: 'tomato', back_pl: 'pomidor', example_en: 'I bought a tomato.', is_variant: true },
      { type: 'phrase', front_en: 'how much is it', back_pl: 'ile to kosztuje', example_en: 'How much is it?', is_variant: true },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(mixed));

    const cards = await generateFlashcards('Byłem w sklepie.', 'sk-test');

    expect(cards).toEqual(mixed);
    expect(cards.filter((c) => c.is_variant)).toHaveLength(2);
    expect(cards.find((c) => c.front_en === 'apple')?.is_variant).toBe(false);
  });

  it('odpowiedź non-2xx → wyjątek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    await expect(generateFlashcards('x', 'sk-test')).rejects.toThrow(/429/);
  });

  it('pusta lista fiszek → wyjątek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse([]));
    await expect(generateFlashcards('x', 'sk-test')).rejects.toThrow(/fiszek/i);
  });

  it('odpowiedź bez treści → wyjątek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponseRaw({ content: null }));
    await expect(generateFlashcards('x', 'sk-test')).rejects.toThrow(/treści/i);
  });
});

/**
 * Ryzyko #5 (test-plan §2): zmiana promptu, schematu lub modelu psuje kontrakt po cichu.
 * Warstwa jednostkowa widzi tylko żądanie i parser (mock `fetch`, §6.1); dowód
 * „nie przecieka do bazy” żyje w `routes/situations.integration.test.ts` (§6.2).
 * Wyrocznie: stałe u góry pliku (PRD / archiwum), nie implementacja.
 */
describe('Ryzyko #5: kontrakt generatora', () => {
  /** Ciało ostatniego żądania do OpenAI jako obiekt. */
  async function requestPayload(chat: Response) {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(chat);
    await generateFlashcards(TRANSCRIPT, 'sk-test');
    const [, init] = fetchMock.mock.calls[0];
    return JSON.parse(init?.body as string);
  }

  // Deliberate-breaks (każdy osobno → czerwony, potem kod przywrócony):
  // (a) usuń `enum` z `properties.type`; (b) usuń 'example_en' z `items.required`;
  // (c) `additionalProperties: true` na `items`; (d) zamień kolejność `messages`.
  it('T5.1 żądanie niesie ścisły schemat: pięć pól wymaganych, zamknięty enum type, brak dodatkowych właściwości; wiadomość systemowa przed transkryptem jako ostatnią wiadomością użytkownika', async () => {
    const payload = await requestPayload(chatResponse(cards(2)));

    expect(payload.response_format.type).toBe('json_schema');
    const jsonSchema = payload.response_format.json_schema;
    expect(jsonSchema.strict).toBe(true);
    expect(jsonSchema.schema.additionalProperties).toBe(false);
    expect(jsonSchema.schema.required).toEqual(['flashcards']);

    const items = jsonSchema.schema.properties.flashcards.items;
    expect(items.additionalProperties).toBe(false);
    // Zbiory, nie kolejność — test nie zamraża układu schematu, tylko jego zawartość.
    expect([...items.required].sort()).toEqual([...REQUIRED_CARD_FIELDS].sort());
    expect([...items.properties.type.enum].sort()).toEqual([...CARD_TYPES].sort());
    expect(items.properties.is_variant.type).toBe('boolean');
    expect(items.properties.front_en.type).toBe('string');
    expect(items.properties.back_pl.type).toBe('string');
    expect(items.properties.example_en.type).toBe('string');

    // Rola i kształt wiadomości, nie treść promptu (iteracja promptu ma być wolna).
    // Bez asercji na liczbie wiadomości — miejsce na przyszłe few-shot.
    expect(payload.messages[0].role).toBe('system');
    expect(typeof payload.messages[0].content).toBe('string');
    expect(payload.messages[0].content.length).toBeGreaterThan(0);
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: TRANSCRIPT });
  });

  // Deliberate-breaks: `MAX_CARDS = 12` w implementacji → wiersze 11 i 30 czerwone;
  // osobno usuń `.slice(...)` → czerwone.
  it.each([
    [10, MAX_CARDS_ORACLE],
    [11, MAX_CARDS_ORACLE],
    [30, MAX_CARDS_ORACLE],
  ])('T5.2 model zwraca %i kart → dokładnie pierwsze %i z tablicy, w jej kolejności', async (n, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(cards(n)));

    const result = await generateFlashcards(TRANSCRIPT, 'sk-test');

    expect(result).toHaveLength(expected);
    expect(result.map((c) => c.front_en)).toEqual(
      cards(n).slice(0, expected).map((c) => c.front_en),
    );
  });

  // Deliberate-breaks: zamień kolejność `.filter`/`.slice` → 9 kart → czerwony;
  // osobno usuń `.filter(...)` → 10 kart z pustą → czerwony.
  it('T5.3 puste front_en lub back_pl są odsiewane przed liczeniem limitu; reszta w kolejności', async () => {
    const fixture = cards(12);
    fixture[0].front_en = '   '; // karta 1: białe znaki = pusta (predykat trim)
    fixture[2].back_pl = ''; // karta 3: pusty tył
    fixture[4].example_en = ''; // karta 5: pusty przykład jest LEGALNY (prompt dopuszcza dla "sentence")
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(fixture));

    const result = await generateFlashcards(TRANSCRIPT, 'sk-test');

    // 10 pełnych z 12: karty 2, 4–12 — puste nie zużywają miejsc z limitu.
    expect(result).toHaveLength(MAX_CARDS_ORACLE);
    expect(result.map((c) => c.front_en)).toEqual([
      'card 2', 'card 4', 'card 5', 'card 6', 'card 7',
      'card 8', 'card 9', 'card 10', 'card 11', 'card 12',
    ]);
    for (const card of result) {
      expect(card.front_en.trim()).not.toBe('');
      expect(card.back_pl.trim()).not.toBe('');
    }
    expect(result.find((c) => c.front_en === 'card 5')?.example_en).toBe('');
  });

  // Guard «pusta lista → rzut» MUSI zostać w generatorze: «zero kart po deduplikacji»
  // (S-04, `lib/dedup.ts`) jest odrębnym, legalnym wynikiem warstwy zapisu (`done` bez
  // kart — D2.4 w `situations.integration.test.ts`), a pusta lista z modelu nadal awarią;
  // T2.4 tamże dowodzi tego niezmiennika od strony bazy.
  // Przypadek „wszystkie puste” (nie `[]` — to pokrywa test „pusta lista fiszek” wyżej):
  // filtr redukuje do zera, ścieżka inna niż pusta tablica z modelu.
  // Deliberate-break: usuń `if (cards.length === 0) throw` → resolves z [] → czerwony (T2.4 też).
  it('T5.4 wszystkie karty puste → rzut (guard zostaje w generatorze — S-04)', async () => {
    const allEmpty = cards(3).map((c) => ({ ...c, front_en: '' }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(allEmpty));

    await expect(generateFlashcards(TRANSCRIPT, 'sk-test')).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // T5.5–T5.10: naruszenie kontraktu strukturalnego → CAŁA odpowiedź odrzucona,
  // zamierzonym rzutem domenowym. Dwa rodzaje odrzucenia (badanie, Architecture
  // Insights): jawny rzut domenowy vs przypadkowy `SyntaxError`/`TypeError` z gołego
  // `JSON.parse`/`.trim()`/`.filter`. Test ślepy na klasę błędu jest zielony także
  // dla „naprawy” `TypeError` przez `?.`, która przepuści kartę bez pola do INSERT.
  // Jedyny tekst asertowany to tekst odmowy z fixture'a (T5.9) — dowód, że `refusal`
  // jest czytany, nie lustro komunikatu.
  // -------------------------------------------------------------------------

  /** Odrzucenie domenowe: `Error`, ale nie `SyntaxError` ani nie `TypeError`. */
  async function expectContractRejection(promise: Promise<unknown>): Promise<Error> {
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect(err).not.toBeInstanceOf(TypeError);
    return err as Error;
  }

  /**
   * Trzy poprawne karty z wadliwą w ŚRODKU (dowód „cała odpowiedź”, nie „wadliwa
   * karta odsiana”). Pole ustawione na `undefined` znika z JSON (`JSON.stringify`
   * pomija je) — tak fixture wyraża „brak pola”.
   */
  function withMiddleCard(patch: Record<string, unknown>) {
    const [a, b, c] = cards(3);
    return [a, { ...b, ...patch }, c];
  }

  // Deliberate-break (po poprawce): usuń sprawdzenie `type` z walidatora → resolves → czerwony.
  it("T5.5 karta o type spoza trójki ('idiom') → cała odpowiedź odrzucona", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(withMiddleCard({ type: 'idiom' })));

    await expectContractRejection(generateFlashcards(TRANSCRIPT, 'sk-test'));
  });

  // Wartości „prawdopodobne”, które koercja `? 1 : 0` u wywołującego zamieniłaby w wariant
  // — cicha zmiana znaczenia, nie awaria. Bez asercji, że karta bez flagi „staje się bazowa”.
  // Deliberate-break: usuń `typeof is_variant === 'boolean'` z walidatora → 3 wiersze czerwone.
  it.each([
    ['brak pola', { is_variant: undefined }],
    ["string 'true'", { is_variant: 'true' }],
    ['liczba 1', { is_variant: 1 }],
  ])('T5.6 is_variant: %s → cała odpowiedź odrzucona', async (_label, patch) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(withMiddleCard(patch)));

    await expectContractRejection(generateFlashcards(TRANSCRIPT, 'sk-test'));
  });

  // `example_en` to jedyne pole nullable w D1: pusty string legalny (T5.3), `null` i brak
  // nielegalne (front robi `example_en.trim()`). Bez asercji, że pole „dostaje domyślne ''”.
  // Deliberate-breaks: usuń `typeof example_en === 'string'` → wiersze example_en czerwone;
  // osobno zamień walidację front_en na `?.trim()` → wiersz 42 / „brak front_en” czerwony.
  it.each([
    ['brak front_en', { front_en: undefined }],
    ['brak back_pl', { back_pl: undefined }],
    ['brak example_en', { example_en: undefined }],
    ['example_en: null', { example_en: null }],
    ['front_en: 42', { front_en: 42 }],
  ])('T5.7 %s → cała odpowiedź odrzucona', async (_label, patch) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(withMiddleCard(patch)));

    await expectContractRejection(generateFlashcards(TRANSCRIPT, 'sk-test'));
  });

  // `finish_reason: 'length'` — jedyny realny scenariusz ucięcia (brak `max_tokens` w
  // żądaniu = limit modelu). Walidator może dołączyć `finish_reason` do komunikatu, test
  // tego nie asertuje. Nigdy `rejects.toThrow(SyntaxError)` — utrwaliłoby przypadek.
  // Deliberate-break: usuń `try/catch` wokół `JSON.parse` → SyntaxError → 2 wiersze czerwone.
  it.each([
    ['zwykły tekst', chatResponseRaw({ content: 'Oto fiszki: invoice — faktura, ...' })],
    [
      "ucięty JSON (finish_reason: 'length')",
      chatResponseRaw({ content: '{"flashcards":[{"type":"word","front_en":"inv', finish_reason: 'length' }),
    ],
  ])('T5.8 content: %s → odrzucenie domenowe, nie SyntaxError', async (_label, response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await expectContractRejection(generateFlashcards(TRANSCRIPT, 'sk-test'));
  });

  // Na ścieżce szczęśliwej `refusal` jest obecne jako `null` (builder to odzwierciedla) —
  // walidator nie może odrzucać na samej obecności pola. Tekst odmowy pochodzi z fixture'a.
  // Deliberate-break: przestań czytać `refusal` → komunikat „bez treści” bez tekstu odmowy → czerwony.
  it('T5.9 odmowa modelu (refusal, content: null) → odrzucenie z tekstem odmowy w błędzie', async () => {
    const refusal = 'I cannot generate flashcards for this input.';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponseRaw({ content: null, refusal }));

    const err = await expectContractRejection(generateFlashcards(TRANSCRIPT, 'sk-test'));

    expect(err.message).toContain(refusal);
  });

  // `flashcards: null` pokrywa dziś `?? []` → pusta → rzut; po poprawce `null` też jest
  // „nie-tablicą” (walidator nie musi go wyróżniać).
  // Deliberate-break: usuń `Array.isArray` z walidatora → TypeError z `.filter` → 2 wiersze czerwone.
  it.each([
    ['obiekt zamiast tablicy', { flashcards: cards(1)[0] }],
    ['string', { flashcards: 'word: invoice' }],
  ])('T5.10 flashcards: %s → odrzucenie domenowe, nie TypeError', async (_label, body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponseRaw({ content: JSON.stringify(body) }));

    await expectContractRejection(generateFlashcards(TRANSCRIPT, 'sk-test'));
  });
});

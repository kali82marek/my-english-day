/**
 * Generator fiszek — OpenAI Chat Completions ze Structured Outputs.
 *
 * Bierze polski transkrypt sytuacji i zwraca zestaw angielskich fiszek (~3-5),
 * z typami dobranymi przez model do treści. `response_format` z `json_schema`
 * (`strict: true`) wymusza kształt odpowiedzi po stronie dostawcy; walidator w
 * parserze (`parseGeneratedCards`) jest drugą linią obrony — naruszenie kontraktu
 * (zmiana modelu, schematu, odmowa, ucięcie, karta spoza schematu) odrzuca CAŁĄ
 * odpowiedź → wyjątek → `flashcards_status='failed'`, nigdy częściowy zapis kart
 * spoza kontraktu (ryzyko #5, `context/foundation/test-plan.md` §2).
 * Puste `front_en`/`back_pl` to treść, nie kontrakt — odsiew, nie odrzucenie.
 * Guard «pusta lista → rzut» zostaje tutaj celowo: pusta lista Z MODELU to awaria
 * (`failed`), natomiast zero kart PO deduplikacji (`lib/dedup.ts`, S-04) to odrębny,
 * legalny wynik warstwy zapisu (`done` bez nowych kart). Każdy wyjątek stąd jest zamierzony
 * (`new Error`, nigdy przepuszczony `SyntaxError`/`TypeError`) i czytelny w logu;
 * wywołujący zamienia go na `failed` (transkrypt sytuacji zostaje nietknięty).
 *
 * Wzorzec „fetch-and-forward" + komunikaty PL — jak `lib/transcription.ts`.
 */

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';
// Twardy sufit kart na sytuację (baza + warianty). Strict mode nie wspiera
// maxItems, więc limit egzekwujemy po stronie kodu.
const MAX_CARDS = 10;

// Trzy zamknięte typy fiszek (PRD Business Logic) — jedno źródło dla schematu
// żądania i walidatora odpowiedzi.
const CARD_TYPES = ['word', 'phrase', 'sentence'] as const;

export type GeneratedCard = {
  type: (typeof CARD_TYPES)[number];
  front_en: string;
  back_pl: string;
  example_en: string;
  // Pochodzenie karty: false = fiszka bazowa (z tego, co opisano),
  // true = wariant (ten sam kontekst, podmienione detale). Tylko server-side.
  is_variant: boolean;
};

// System prompt celuje w Kryterium sukcesu PRD: ≥70% fiszek akceptowanych bez poprawek.
const SYSTEM_PROMPT = `Jesteś nauczycielem angielskiego tworzącym fiszki dla Polaka uczącego się języka.
Na wejściu dostajesz potoczny polski opis przeżytej dziś sytuacji.
Wygeneruj 3-5 angielskich fiszek osadzonych w tej sytuacji, dobierając typy do treści:
- "word" — pojedyncze słówko,
- "phrase" — zwrot / kolokacja,
- "sentence" — całe zdanie przydatne w tej sytuacji.
Zasady:
- front_en: poprawny, naturalny angielski (to, czego użytkownik ma się nauczyć),
- back_pl: zwięzłe polskie tłumaczenie,
- example_en: krótki angielski przykład użycia; dla typu "sentence" możesz zostawić pusty string.
Twórz fiszki realnie przydatne w opisanej sytuacji, nie oderwane od kontekstu.
Te fiszki oznacz "is_variant": false (pochodzą z tego, co faktycznie opisano).

Następnie dołóż dodatkowo ~2-3 WARIANTY — ściśle w obrębie tego samego kontekstu
(ta sama sytuacja/miejsce/rozmowa), z podmienionymi detalami: inny produkt, inna
kwota, inne pytanie, inny rozmówca w tej samej scenie. Warianty mają uczyć
elastyczności językowej w tej sytuacji, NIE wychodź poza jej kontekst i NIE
powielaj dosłownie fiszek bazowych. Każdy wariant oznacz "is_variant": true.
Liczbę wariantów dobierz do bogactwa sytuacji — uboga sytuacja może dać mniej
(lub żadnego), bogata 2-3. Warianty zwróć w tej samej tablicy "flashcards".`;

// Schemat Structured Outputs — wszystkie pola required, additionalProperties: false.
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'flashcards',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['flashcards'],
      properties: {
        flashcards: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'front_en', 'back_pl', 'example_en', 'is_variant'],
            properties: {
              type: { type: 'string', enum: [...CARD_TYPES] },
              front_en: { type: 'string' },
              back_pl: { type: 'string' },
              example_en: { type: 'string' },
              is_variant: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
} as const;

export async function generateFlashcards(
  transcript: string,
  apiKey: string,
): Promise<GeneratedCard[]> {
  const res = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: RESPONSE_FORMAT,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI zwrócił ${res.status}: ${detail.slice(0, 500)}`);
  }

  const body = (await res.json()) as ChatCompletionBody;
  const choice = body.choices?.[0];
  return parseGeneratedCards(choice?.message, choice?.finish_reason);
}

// Kształt Chat Completions w zakresie, który czytamy. Realna odpowiedź niesie
// `refusal: null` w KAŻDEJ wiadomości (nie tylko przy odmowie) — obecność pola
// nie jest sygnałem; sygnałem jest niepusty string.
type ChatMessage = { content?: string | null; refusal?: string | null };
type ChatCompletionBody = {
  choices?: { finish_reason?: string; message?: ChatMessage }[];
};

/**
 * Parser + walidator odpowiedzi modelu. Kolejność: odmowa → brak treści → JSON →
 * `flashcards` tablicą → każda karta w kontrakcie (pierwsza wadliwa odrzuca całość)
 * → odsiew pustych → limit → pusto = rzut. `refusal` PRZED `content`, bo przy odmowie
 * `content` jest `null` i „bez treści" byłoby mylącym komunikatem w logu.
 */
function parseGeneratedCards(
  message: ChatMessage | undefined,
  finishReason: string | undefined,
): GeneratedCard[] {
  if (typeof message?.refusal === 'string' && message.refusal !== '') {
    throw new Error(`Model odmówił wygenerowania fiszek: ${message.refusal}`);
  }
  const content = message?.content;
  if (!content) {
    throw new Error('OpenAI zwrócił odpowiedź bez treści.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `Odpowiedź modelu nie jest poprawnym JSON (finish_reason: ${finishReason ?? 'brak'}).`,
    );
  }

  const flashcards = (parsed as { flashcards?: unknown } | null)?.flashcards;
  if (!Array.isArray(flashcards)) {
    throw new Error('Odpowiedź modelu spoza kontraktu: `flashcards` nie jest tablicą.');
  }
  const validated = flashcards.map(assertGeneratedCard);

  // Strict mode nie wspiera maxItems ani limitów długości — górny limit kart
  // i odsiew pustych egzekwujemy w kodzie. Pusty string jest zgodny ze schematem
  // (treść, nie kontrakt), więc odsiew, nie odrzucenie — i dopiero PO walidacji.
  const cards = validated
    .filter((card) => card.front_en.trim() !== '' && card.back_pl.trim() !== '')
    .slice(0, MAX_CARDS);
  if (cards.length === 0) {
    throw new Error('Model nie wygenerował żadnych fiszek.');
  }

  return cards;
}

const CARD_TEXT_FIELDS = ['front_en', 'back_pl', 'example_en'] as const;

/** Jedna karta w kontrakcie: `type` z trójki, trzy stringi, `is_variant` boolean. */
function assertGeneratedCard(card: unknown, index: number): GeneratedCard {
  const label = `Karta ${index + 1} spoza kontraktu`;
  if (typeof card !== 'object' || card === null || Array.isArray(card)) {
    throw new Error(`${label}: nie jest obiektem.`);
  }
  const raw = card as Record<string, unknown>;

  const type = raw.type;
  if (typeof type !== 'string' || !(CARD_TYPES as readonly string[]).includes(type)) {
    throw new Error(`${label}: type=${JSON.stringify(type)}`);
  }
  for (const field of CARD_TEXT_FIELDS) {
    if (typeof raw[field] !== 'string') {
      throw new Error(`${label}: ${field}=${JSON.stringify(raw[field])}`);
    }
  }
  if (typeof raw.is_variant !== 'boolean') {
    throw new Error(`${label}: is_variant=${JSON.stringify(raw.is_variant)}`);
  }

  return {
    type: type as GeneratedCard['type'],
    front_en: raw.front_en as string,
    back_pl: raw.back_pl as string,
    example_en: raw.example_en as string,
    is_variant: raw.is_variant,
  };
}

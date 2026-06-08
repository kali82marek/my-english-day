/**
 * Generator fiszek — OpenAI Chat Completions ze Structured Outputs.
 *
 * Bierze polski transkrypt sytuacji i zwraca zestaw angielskich fiszek (~3-5),
 * z typami dobranymi przez model do treści. `response_format` z `json_schema`
 * (`strict: true`) wymusza kształt odpowiedzi — bez kodu obronnego na parsowanie.
 * Każda odpowiedź non-2xx lub pusta lista → wyjątek, który wywołujący zamienia
 * na `flashcards_status='failed'` (transkrypt sytuacji zostaje nietknięty).
 *
 * Wzorzec „fetch-and-forward" + komunikaty PL — jak `lib/transcription.ts`.
 */

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

export type GeneratedCard = {
  type: 'word' | 'phrase' | 'sentence';
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
              type: { type: 'string', enum: ['word', 'phrase', 'sentence'] },
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

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI zwrócił odpowiedź bez treści.');
  }

  // Structured Outputs gwarantuje kształt — parsujemy bez kodu obronnego.
  const parsed = JSON.parse(content) as { flashcards: GeneratedCard[] };
  if (!parsed.flashcards || parsed.flashcards.length === 0) {
    throw new Error('Model nie wygenerował żadnych fiszek.');
  }

  return parsed.flashcards;
}

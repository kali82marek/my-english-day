/**
 * Mock OpenAI na krawędzi sieci — jedyne miejsce, gdzie testy integracyjne dotykają
 * `fetch`. Worker pod testem biegnie w tym samym izolacie co testy, więc spy na
 * `globalThis.fetch` obejmuje też wywołania z zadania tła (`ctx.waitUntil`).
 *
 * Routing po URL: `mockOpenAI({ transcription, chat })` — brak wpisu albo inny adres
 * → `Unmocked fetch: <url>` (test nigdy nie wychodzi do sieci). Odpowiedzi budują
 * `whisperResponse` / `whisperVerboseResponse` (Whisper `verbose_json`) oraz para builderów Chat Completions.
 *
 * Kształt odpowiedzi Chat Completions żyje TYLKO tutaj (dawniej kopia w
 * `src/lib/flashcards.test.ts`). Dwa buildery, dwa zastosowania:
 * - `chatResponse(flashcards)` — poprawna lista kart (ścieżka szczęśliwa, limit,
 *   odsiew pustych); `content` to `JSON.stringify({ flashcards })`.
 * - `chatResponseRaw({ content, refusal?, finish_reason? })` — odpowiedź zdegenerowana:
 *   odmowa modelu (`content: null` + `refusal`), ucięcie (`finish_reason: 'length'`),
 *   nie-JSON-owy `content`, `content: null`. Testy kontraktu generatora (ryzyko #5)
 *   sięgają po niego, gdy sam JSON kart nie wystarcza do opisania odpowiedzi.
 * Oba wpisują `refusal: null` domyślnie — realna odpowiedź OpenAI niesie to pole
 * w KAŻDEJ wiadomości, nie tylko przy odmowie.
 */
import { vi } from 'vitest';

export const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

type FetchInput = Parameters<typeof fetch>[0];

/** Adres żądania niezależnie od tego, czy `fetch` dostał string, `URL` czy `Request`. */
export function requestUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Jeden segment odpowiedzi `verbose_json` Whisper — w zakresie, którego używa kod. */
export type WhisperSegment = { text: string; no_speech_prob?: number };

/**
 * Odpowiedź Whisper `verbose_json` z jawnymi segmentami — do testów filtra ciszy
 * (`no_speech_prob`) i halucynacji. `text` to złączenie segmentów, jak w realnej odpowiedzi.
 */
export function whisperVerboseResponse(segments: WhisperSegment[], status = 200): Response {
  const body = {
    task: 'transcribe',
    language: 'polish',
    duration: segments.length * 2,
    text: segments.map((s) => s.text).join(' '),
    segments: segments.map((s, i) => ({
      id: i,
      start: i * 2,
      end: i * 2 + 2,
      text: s.text,
      no_speech_prob: s.no_speech_prob ?? 0.01,
      avg_logprob: -0.3,
    })),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Odpowiedź Whisper: sukces → `verbose_json` z jednym segmentem mowy (`no_speech_prob`
 * niski); status non-2xx → surowe ciało tekstowe błędu (jak realny błąd API).
 */
export function whisperResponse(text: string, status = 200): Response {
  if (status < 200 || status >= 300) {
    return new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });
  }
  return whisperVerboseResponse([{ text }], status);
}

/** Surowy kształt wiadomości asystenta w `choices[0]` — jak w realnej odpowiedzi OpenAI. */
export type ChatMessageRaw = {
  content: string | null;
  refusal?: string | null;
  finish_reason?: 'stop' | 'length' | 'content_filter';
};

/**
 * Odpowiedź Chat Completions w dowolnym kształcie (odmowa, ucięcie, nie-JSON).
 * `refusal: null` i `finish_reason: 'stop'` domyślnie — jak w żywej odpowiedzi.
 */
export function chatResponseRaw(message: ChatMessageRaw, status = 200): Response {
  const body = JSON.stringify({
    choices: [
      {
        index: 0,
        finish_reason: message.finish_reason ?? 'stop',
        message: {
          role: 'assistant',
          content: message.content,
          refusal: message.refusal ?? null,
        },
      },
    ],
  });
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

/** Odpowiedź Chat Completions z poprawną listą `flashcards` zaszytą w `message.content`. */
export function chatResponse(flashcards: unknown, status = 200): Response {
  return chatResponseRaw({ content: JSON.stringify({ flashcards }) }, status);
}

export type OpenAIMocks = {
  /** Odpowiedź dla `POST /v1/audio/transcriptions`. */
  transcription?: Response;
  /** Odpowiedź dla `POST /v1/chat/completions`. */
  chat?: Response;
};

/**
 * Instaluje mock `fetch` routujący po URL. Zwraca spy do asercji na liczbie wywołań
 * (np. „chat NIE został wywołany po błędzie Whisper" = 1 wywołanie).
 */
export function mockOpenAI(mocks: OpenAIMocks = {}) {
  const routes = new Map<string, Response>();
  if (mocks.transcription) routes.set(TRANSCRIPTIONS_URL, mocks.transcription);
  if (mocks.chat) routes.set(CHAT_COMPLETIONS_URL, mocks.chat);

  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = requestUrl(input);
    const response = routes.get(url);
    if (!response) {
      throw new Error(`Unmocked fetch: ${url}`);
    }
    // Ciało `Response` da się odczytać tylko raz — każde wywołanie dostaje kopię.
    return response.clone();
  });
}

/**
 * Mock OpenAI na krawędzi sieci — jedyne miejsce, gdzie testy integracyjne dotykają
 * `fetch`. Worker pod testem biegnie w tym samym izolacie co testy, więc spy na
 * `globalThis.fetch` obejmuje też wywołania z zadania tła (`ctx.waitUntil`).
 *
 * Routing po URL: `mockOpenAI({ transcription, chat })` — brak wpisu albo inny adres
 * → `Unmocked fetch: <url>` (test nigdy nie wychodzi do sieci). Odpowiedzi budują
 * `whisperResponse` (Whisper zwraca `text/plain`) i `chatResponse` (kształt Chat
 * Completions jak w `src/lib/flashcards.test.ts`).
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

/** Odpowiedź Whisper (`response_format=text` → surowy transkrypt w ciele). */
export function whisperResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });
}

/** Odpowiedź Chat Completions z `flashcards` zaszytymi w `message.content`. */
export function chatResponse(flashcards: unknown, status = 200): Response {
  const body = JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ flashcards }) } }],
  });
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
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

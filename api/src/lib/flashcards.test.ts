import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateFlashcards } from './flashcards';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Buduje odpowiedź Chat Completions z `flashcards` zaszytymi w `message.content`. */
function chatResponse(flashcards: unknown, status = 200): Response {
  const body = JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ flashcards }) } }],
  });
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

const CARDS = [
  { type: 'word', front_en: 'invoice', back_pl: 'faktura', example_en: 'Send me the invoice.' },
  { type: 'sentence', front_en: 'Could you repeat that?', back_pl: 'Możesz powtórzyć?', example_en: '' },
];

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
  });

  it('parsuje fiszki z odpowiedzi modelu', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(chatResponse(CARDS));
    const cards = await generateFlashcards('cokolwiek', 'sk-test');
    expect(cards).toHaveLength(2);
    expect(cards[0].front_en).toBe('invoice');
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
    const body = JSON.stringify({ choices: [{ message: {} }] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(generateFlashcards('x', 'sk-test')).rejects.toThrow(/treści/i);
  });
});

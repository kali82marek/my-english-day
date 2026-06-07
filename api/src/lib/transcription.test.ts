import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeAudio } from './transcription';

const AUDIO = { data: new ArrayBuffer(8), name: 'nagranie.m4a', type: 'audio/m4a' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transcribeAudio', () => {
  it('buduje żądanie multipart z modelem, językiem pl i formatem text', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('cześć, to test', { status: 200 }));

    const text = await transcribeAudio(AUDIO, 'sk-test');

    expect(text).toBe('cześć, to test');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const form = init?.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('pl');
    expect(form.get('response_format')).toBe('text');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('przycina białe znaki transkryptu', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('  wynik z marginesem  \n', { status: 200 }),
    );
    expect(await transcribeAudio(AUDIO, 'sk-test')).toBe('wynik z marginesem');
  });

  it('odpowiedź non-2xx → wyjątek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    await expect(transcribeAudio(AUDIO, 'sk-test')).rejects.toThrow(/429/);
  });

  it('pusty transkrypt → wyjątek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('   ', { status: 200 }));
    await expect(transcribeAudio(AUDIO, 'sk-test')).rejects.toThrow(/pusty/i);
  });
});

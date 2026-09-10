import { describe, it, expect, vi, afterEach } from 'vitest';
import { speechTextFromVerbose, stripHallucinations, transcribeAudio } from './transcription';
import { whisperResponse, whisperVerboseResponse } from '../../test/openai-mock';

const AUDIO = { data: new ArrayBuffer(8), name: 'nagranie.m4a', type: 'audio/m4a' };
const AMARA = 'Napisy stworzone przez społeczność Amara.org';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transcribeAudio', () => {
  it('buduje żądanie multipart z modelem, językiem pl i formatem verbose_json', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(whisperResponse('cześć, to test'));

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
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('łączy segmenty mowy spacją i przycina białe znaki', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      whisperVerboseResponse([{ text: '  wynik ' }, { text: ' z marginesem  \n' }]),
    );
    expect(await transcribeAudio(AUDIO, 'sk-test')).toBe('wynik z marginesem');
  });

  it('odpowiedź non-2xx → wyjątek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(whisperResponse('rate limited', 429));
    await expect(transcribeAudio(AUDIO, 'sk-test')).rejects.toThrow(/429/);
  });

  it('pusty transkrypt → wyjątek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(whisperVerboseResponse([{ text: '   ' }]));
    await expect(transcribeAudio(AUDIO, 'sk-test')).rejects.toThrow(/nie wykrył mowy/i);
  });

  it('ciało nie-JSON → wyjątek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('cześć', { status: 200 }));
    await expect(transcribeAudio(AUDIO, 'sk-test')).rejects.toThrow(/sparsować/i);
  });
});

/**
 * Cisza: nagranie bez mowy nie może stać się transkryptem (a potem fiszkami).
 * Deliberate-break: ustaw `NO_SPEECH_THRESHOLD = 1` i wyczyść `HALLUCINATION_PHRASES`
 * → segment Amara przechodzi → czerwony.
 */
describe('cisza i halucynacje Whisper', () => {
  it('S1 wszystkie segmenty z wysokim no_speech_prob → wyjątek „brak mowy", nawet z tekstem Amara', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      whisperVerboseResponse([{ text: AMARA, no_speech_prob: 0.93 }]),
    );
    await expect(transcribeAudio(AUDIO, 'sk-test')).rejects.toThrow(/nie wykrył mowy/i);
  });

  it('S2 segment nie-mowy jest odrzucany, mowa zostaje', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      whisperVerboseResponse([
        { text: 'Nie umiałem poprosić o fakturę.', no_speech_prob: 0.05 },
        { text: AMARA, no_speech_prob: 0.88 },
      ]),
    );
    expect(await transcribeAudio(AUDIO, 'sk-test')).toBe('Nie umiałem poprosić o fakturę.');
  });

  it('S3 halucynacja z niskim no_speech_prob (model jej „pewny") → wyjątek po filtrze fraz', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      whisperVerboseResponse([{ text: AMARA, no_speech_prob: 0.02 }]),
    );
    await expect(transcribeAudio(AUDIO, 'sk-test')).rejects.toThrow(/halucynacj/i);
  });

  it('S4 halucynacja doklejona do prawdziwej mowy → zostaje sama mowa', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      whisperVerboseResponse([
        { text: 'Klient zapytał o rabat.', no_speech_prob: 0.03 },
        { text: 'Dziękuję za uwagę.', no_speech_prob: 0.2 },
      ]),
    );
    expect(await transcribeAudio(AUDIO, 'sk-test')).toBe('Klient zapytał o rabat.');
  });

  it('S5 odpowiedź bez `segments` degraduje się do `text` z filtrem fraz', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: `Szef kazał mi zadzwonić. ${AMARA}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await transcribeAudio(AUDIO, 'sk-test')).toBe('Szef kazał mi zadzwonić.');
  });
});

describe('stripHallucinations', () => {
  it('nie rusza zwykłego tekstu', () => {
    expect(stripHallucinations('Zapytałem, czy mogę zapłacić kartą.')).toBe(
      'Zapytałem, czy mogę zapłacić kartą.',
    );
  });

  it('porównuje bez wielkości liter i interpunkcji', () => {
    expect(stripHallucinations('NAPISY STWORZONE PRZEZ SPOŁECZNOŚĆ AMARA.ORG!!!')).toBe('');
    expect(stripHallucinations('dziękuję za uwagę')).toBe('');
  });

  it('wycina frazę ze środka i sprząta podwójne spacje oraz interpunkcję brzegową', () => {
    expect(stripHallucinations(`W sklepie, ${AMARA}, nie wiedziałem jak zapytać.`)).toBe(
      'W sklepie, nie wiedziałem jak zapytać.',
    );
  });
});

describe('speechTextFromVerbose', () => {
  it('segment dokładnie na progu 0.6 jest jeszcze mową', () => {
    expect(speechTextFromVerbose({ segments: [{ text: 'a', no_speech_prob: 0.6 }] })).toBe('a');
    expect(speechTextFromVerbose({ segments: [{ text: 'a', no_speech_prob: 0.61 }] })).toBe('');
  });

  it('brak no_speech_prob traktuje jak mowę', () => {
    expect(speechTextFromVerbose({ segments: [{ text: 'a' }] })).toBe('a');
  });
});

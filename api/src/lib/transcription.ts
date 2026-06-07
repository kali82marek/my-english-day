/**
 * Cienki proxy do OpenAI Audio Transcriptions (Whisper).
 *
 * Fetch-and-forward: bierze bufor audio (czytany raz z multipart, współdzielony
 * z zapisem do R2) i wysyła do Whisper z hintem języka polskiego. Zwraca czysty
 * tekst transkryptu. Każda odpowiedź non-2xx lub pusty tekst → wyjątek, który
 * wywołujący zamienia na `status='failed'` (transkrypt zostaje NULL, plik R2 trwa).
 */

const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

export type AudioInput = {
  data: ArrayBuffer;
  name: string;
  type: string;
};

export async function transcribeAudio(file: AudioInput, apiKey: string): Promise<string> {
  const form = new FormData();
  // Nazwa pliku niesie rozszerzenie — Whisper wykrywa po nim format kontenera.
  form.append('file', new Blob([file.data], { type: file.type }), file.name);
  form.append('model', 'whisper-1');
  form.append('language', 'pl');
  form.append('response_format', 'text');

  const res = await fetch(TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Whisper zwrócił ${res.status}: ${detail.slice(0, 500)}`);
  }

  // response_format=text → ciało to surowy transkrypt.
  const transcript = (await res.text()).trim();
  if (transcript.length === 0) {
    throw new Error('Whisper zwrócił pusty transkrypt.');
  }

  return transcript;
}

/**
 * Cienki proxy do OpenAI Audio Transcriptions (Whisper) + filtr ciszy.
 *
 * Fetch-and-forward: bierze bufor audio (czytany raz z multipart, współdzielony
 * z zapisem do R2) i wysyła do Whisper z hintem języka polskiego. Zwraca czysty
 * tekst transkryptu. Każda odpowiedź non-2xx, pusty tekst lub brak mowy → wyjątek,
 * który wywołujący zamienia na `status='failed'` (transkrypt zostaje NULL, plik R2 trwa).
 *
 * Cisza i halucynacje: na nagraniu bez mowy Whisper nie zwraca pustego tekstu, tylko
 * „halucynuje” frazy z danych treningowych („Napisy stworzone przez społeczność
 * Amara.org", „Dziękuję za uwagę"), z których generator robił fiszki. Dwie warstwy
 * obrony, obie na podstawie `response_format=verbose_json`:
 * 1. segmenty z `no_speech_prob` powyżej progu są odrzucane (model sam ocenia, że to
 *    nie mowa) — to łapie ciszę i szum niezależnie od treści halucynacji;
 * 2. z pozostałego tekstu wycinane są znane frazy-halucynacje (lista zamknięta,
 *    porównanie po normalizacji) — to łapie przypadki, gdy model jest ich „pewny".
 * Gdy po obu warstwach nie zostaje nic, rzucamy „brak mowy". Odpowiedź bez `segments`
 * (nieoczekiwany kształt) degraduje się do samego `text` + warstwy 2.
 */

const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

// Próg z dekodera Whisper (`no_speech_threshold` = 0.6): segment powyżej niego model
// uznaje za nie-mowę. Nie łączymy z `avg_logprob` jak oryginał — dla nagrań
// z telefonu wolimy odrzucić za dużo (użytkownik nagra ponownie) niż przepuścić szum.
const NO_SPEECH_THRESHOLD = 0.6;

/**
 * Znane halucynacje Whisper dla języka polskiego (i angielskie odpowiedniki, bo model
 * bywa je miesza). Porównanie po `normalize` — bez wielkości liter i interpunkcji.
 * Lista zamknięta i krótka: każda pozycja to fraza, której użytkownik nigdy nie
 * powie jako opisu własnej sytuacji.
 */
const HALLUCINATION_PHRASES = [
  'napisy stworzone przez społeczność amara org',
  'napisy wygenerowane automatycznie',
  'napisy stworzone przez społeczność',
  'subtitles by the amara org community',
  'dziękuję za uwagę',
  'dziękuję za oglądanie',
  'dziękuje za uwagę',
  'dziękuje za oglądanie',
  'do zobaczenia w następnym odcinku',
  'zapraszam na kolejny film',
  'thank you for watching',
  'thanks for watching',
].map(normalize);

export type AudioInput = {
  data: ArrayBuffer;
  name: string;
  type: string;
};

/** Kształt `verbose_json` w zakresie, którego używamy. */
type VerboseTranscription = {
  text?: string;
  segments?: { text?: string; no_speech_prob?: number }[];
};

/** Klucz porównania fraz: małe litery, bez interpunkcji, pojedyncze spacje. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Wycina znane halucynacje z tekstu. Porównanie na znormalizowanej kopii, ale zwracany
 * jest tekst oryginalny bez dopasowanych fragmentów — tylko gdy CAŁY tekst (po
 * normalizacji) składa się z halucynacji, wynik jest pusty. Częściowe trafienie
 * (halucynacja doklejona do prawdziwej mowy) usuwa tylko frazę.
 */
export function stripHallucinations(text: string): string {
  let normalized = normalize(text);
  if (normalized.length === 0) return '';

  let matched = false;
  for (const phrase of HALLUCINATION_PHRASES) {
    if (normalized.includes(phrase)) {
      normalized = normalized.split(phrase).join(' ').replace(/\s+/g, ' ').trim();
      matched = true;
    }
  }
  if (!matched) return text.trim();
  if (normalized.length === 0) return '';

  // Zostało coś prawdziwego obok halucynacji — oddaj oryginał z wyciętymi frazami.
  // Fraza zabiera ze sobą spacje PRZED i interpunkcję PO sobie („, ", „." halucynacji),
  // ale nie interpunkcję przed — kropka kończąca poprzednie zdanie zostaje.
  const between = String.raw`[\s.,!?;:"'-]*`;
  let cleaned = text;
  for (const phrase of HALLUCINATION_PHRASES) {
    const words = phrase.split(' ').map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = String.raw`\s*` + words.join(between) + between;
    cleaned = cleaned.replace(new RegExp(pattern, 'giu'), ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Tekst mowy z odpowiedzi `verbose_json`: segmenty poniżej progu `no_speech_prob`
 * połączone spacją; bez `segments` — pole `text`. Bez filtra halucynacji.
 */
export function speechTextFromVerbose(body: VerboseTranscription): string {
  if (!Array.isArray(body.segments)) {
    return (body.text ?? '').trim();
  }
  return body.segments
    .filter((s) => (s.no_speech_prob ?? 0) <= NO_SPEECH_THRESHOLD)
    .map((s) => (s.text ?? '').trim())
    .filter((t) => t.length > 0)
    .join(' ')
    .trim();
}

export async function transcribeAudio(file: AudioInput, apiKey: string): Promise<string> {
  const form = new FormData();
  // Nazwa pliku niesie rozszerzenie — Whisper wykrywa po nim format kontenera.
  form.append('file', new Blob([file.data], { type: file.type }), file.name);
  form.append('model', 'whisper-1');
  form.append('language', 'pl');
  form.append('response_format', 'verbose_json');

  const res = await fetch(TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Whisper zwrócił ${res.status}: ${detail.slice(0, 500)}`);
  }

  let body: VerboseTranscription;
  try {
    body = (await res.json()) as VerboseTranscription;
  } catch {
    throw new Error('Whisper zwrócił odpowiedź, której nie da się sparsować.');
  }

  const speech = speechTextFromVerbose(body);
  if (speech.length === 0) {
    throw new Error('Whisper nie wykrył mowy (cisza lub szum).');
  }

  const transcript = stripHallucinations(speech);
  if (transcript.length === 0) {
    throw new Error('Whisper zwrócił wyłącznie halucynację (brak mowy w nagraniu).');
  }

  return transcript;
}

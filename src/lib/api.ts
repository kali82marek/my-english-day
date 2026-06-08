/**
 * Klient API — jedno miejsce wywołań do Workera.
 *
 * Bazowy URL czytany z `expo.extra.apiBaseUrl` (app.json) przez expo-constants.
 * Brak wartości → jawny błąd przy starcie (nie ciche `undefined`, które
 * skończyłoby się nieczytelnym „network request failed"). Token sesji jest
 * dołączany automatycznie jako `Authorization: Bearer <jwt>`, gdy istnieje.
 */

import Constants from 'expo-constants';
import { File } from 'expo-file-system';

import { getToken } from '@/lib/session';

const apiBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;

if (!apiBaseUrl) {
  throw new Error(
    'Brak expo.extra.apiBaseUrl w konfiguracji (app.json). Ustaw bazowy URL Workera.',
  );
}

/** Kontrakt usera zwracany przez Worker (`/auth/*`). */
export type AuthUser = {
  id: number;
  email: string;
};

/** Odpowiedź register/login: token + dane usera. */
export type AuthResponse = {
  token: string;
  user: AuthUser;
};

/**
 * Błąd HTTP z API. Niesie status i czytelny komunikat — wywołujący rozróżnia
 * 401 (złe dane / brak sesji), 409 (email zajęty) i błędy walidacji (400).
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type ErrorBody = {
  error?: string;
  errors?: string[];
};

function messageFromBody(body: ErrorBody | null, fallback: string): string {
  if (body?.errors && body.errors.length > 0) {
    return body.errors.join(' ');
  }
  if (body?.error) {
    return body.error;
  }
  return fallback;
}

/**
 * Fetch do Workera z automatycznym tokenem. Rzuca `ApiError` dla odpowiedzi
 * nie-2xx (w tym 401 — nie połykamy go). Zwraca sparsowane JSON dla 2xx.
 */
export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken();

  const headers = new Headers(opts.headers);
  // Dla `FormData` NIE ustawiamy `Content-Type` — runtime sam dołoży
  // `multipart/form-data; boundary=...`. Ręczne ustawienie zepsułoby boundary.
  if (!(opts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${apiBaseUrl}${path}`, { ...opts, headers });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorBody | null;
    throw new ApiError(res.status, messageFromBody(body, `Błąd żądania (${res.status}).`));
  }

  // Część endpointów nie zwraca ciała (np. accept → 200 puste, delete → 204).
  // `res.json()` na pustym body rzuca SyntaxError, co fałszywie wywracało akcję
  // (rollback) mimo sukcesu serwera. Czytamy tekst i parsujemy tylko gdy niepusty.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

type Credentials = {
  email: string;
  password: string;
};

/** Cienkie wrappery na endpointy auth z Phase 2. */
export const authApi = {
  register(credentials: Credentials): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },

  login(credentials: Credentials): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },

  me(): Promise<{ user: AuthUser }> {
    return apiFetch<{ user: AuthUser }>('/auth/me', { method: 'GET' });
  },
};

/**
 * Sytuacja zwracana przez Worker (`/situations`). `audio_key` NIE jest eksponowany
 * klientowi (kształt = DTO z `api/src/routes/situations.ts`).
 */
export type Situation = {
  id: number;
  status: 'pending' | 'done' | 'failed';
  transcript: string | null;
  duration_ms: number | null;
  created_at: string;
  // Stan generowania fiszek (S-02): 'pending' = w toku, 'done' = gotowe,
  // 'failed' = generowanie nie powiodło się (transkrypt i tak zachowany).
  flashcards_status: 'pending' | 'done' | 'failed';
};

/** Plik audio do uploadu — `uri` z `expo-audio`, plus nazwa i typ MIME. */
export type AudioUpload = {
  uri: string;
  name: string;
  type: string;
};

/** Operacje na sytuacjach dnia (S-01). */
export const situationsApi = {
  /**
   * Optymistyczny zapis: wysyła audio (multipart) i dostaje wiersz `pending`.
   * `FormData` z polem-plikiem w kształcie RN (`{ uri, name, type }`).
   */
  async create(audio: AudioUpload, durationMs: number): Promise<Situation> {
    // Globalny `fetch` w Expo SDK 56 to WinterCG fetch. Jego `convertFormData`
    // NIE obsługuje natywnego wariantu RN `{ uri }` ani Bloba z `ArrayBuffer`
    // (RN-owy `Blob`). Akceptuje za to część będącą obiektem z metodą `bytes()`
    // oraz polami `name`/`type` (nagłówki multipart). Wczytujemy nagranie do bajtów
    // przez `expo-file-system` i dokładamy taką część — `name` z rozszerzeniem
    // `.m4a` jest kluczowe (serwer i Whisper wykrywają format po nazwie pliku).
    const bytes = new Uint8Array(await new File(audio.uri).arrayBuffer());
    const filePart = { name: audio.name, type: audio.type, bytes: async () => bytes };

    const form = new FormData();
    form.append('audio', filePart as unknown as Blob);
    form.append('duration_ms', String(durationMs));

    return apiFetch<Situation>('/situations', { method: 'POST', body: form });
  },

  list(): Promise<{ situations: Situation[] }> {
    return apiFetch<{ situations: Situation[] }>('/situations', { method: 'GET' });
  },

  remove(id: number): Promise<void> {
    return apiFetch<void>(`/situations/${id}`, { method: 'DELETE' });
  },
};

/**
 * Propozycja fiszki zwracana przez Worker (`/flashcards/proposals`). Kształt = DTO
 * z `api/src/routes/flashcards.ts`; `status` i `user_id` nieeksponowane (lista to
 * z definicji `proposed`). `example_en` bywa pustym stringiem (gł. dla `sentence`).
 */
export type Flashcard = {
  id: number;
  situation_id: number;
  type: 'word' | 'phrase' | 'sentence';
  front_en: string;
  back_pl: string;
  example_en: string;
  created_at: string;
};

/** Operacje na fiszkach (S-02): przegląd propozycji + bramka akceptacji. */
export const flashcardsApi = {
  /**
   * Propozycje do przejrzenia + licznik sytuacji w trakcie generowania
   * (`generatingCount` > 0 → front odpytuje, dopóki nie spadnie do 0).
   */
  listProposals(): Promise<{ proposals: Flashcard[]; generatingCount: number }> {
    return apiFetch<{ proposals: Flashcard[]; generatingCount: number }>(
      '/flashcards/proposals',
      { method: 'GET' },
    );
  },

  accept(id: number): Promise<void> {
    return apiFetch<void>(`/flashcards/${id}/accept`, { method: 'POST' });
  },

  reject(id: number): Promise<void> {
    return apiFetch<void>(`/flashcards/${id}`, { method: 'DELETE' });
  },
};

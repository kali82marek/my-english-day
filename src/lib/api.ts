/**
 * Klient API — jedno miejsce wywołań do Workera.
 *
 * Bazowy URL czytany z `expo.extra.apiBaseUrl` (app.json) przez expo-constants.
 * Brak wartości → jawny błąd przy starcie (nie ciche `undefined`, które
 * skończyłoby się nieczytelnym „network request failed"). Token sesji jest
 * dołączany automatycznie jako `Authorization: Bearer <jwt>`, gdy istnieje.
 */

import Constants from 'expo-constants';

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
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${apiBaseUrl}${path}`, { ...opts, headers });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorBody | null;
    throw new ApiError(res.status, messageFromBody(body, `Błąd żądania (${res.status}).`));
  }

  return res.json() as Promise<T>;
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

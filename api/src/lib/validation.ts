/**
 * Wspólne reguły walidacji email/hasła — by komunikaty były spójne front↔API.
 * Reguły celowo lekkie (MVP): email niepusty + prosty format, hasło min. 8 znaków.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 8;

export type Credentials = {
  email: string;
  password: string;
};

/** Normalizuje email do porównań i zapisu (trim + lowercase). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Waliduje dane logowania/rejestracji. Zwraca listę komunikatów błędów
 * (pusta = poprawne). Email jest sprawdzany po normalizacji.
 */
export function validateCredentials(input: {
  email?: unknown;
  password?: unknown;
}): string[] {
  const errors: string[] = [];

  const email = typeof input.email === 'string' ? normalizeEmail(input.email) : '';
  if (email.length === 0) {
    errors.push('Email jest wymagany.');
  } else if (!EMAIL_RE.test(email)) {
    errors.push('Niepoprawny format email.');
  }

  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length === 0) {
    errors.push('Hasło jest wymagane.');
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków.`);
  }

  return errors;
}

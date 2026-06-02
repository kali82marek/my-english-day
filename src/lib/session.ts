/**
 * Warstwa sesji — odczyt/zapis/kasowanie tokenu w bezpiecznym storage.
 *
 * Platforma docelowa = natywna (iOS/Android), gdzie token trafia do
 * `expo-secure-store` (Keychain / Keystore). `expo-secure-store` nie działa
 * na web, więc dostęp jest owinięty: na web używamy ulotnego fallbacku w
 * pamięci, by aplikacja się nie wywalała (sesja nie przetrwa odświeżenia —
 * web nie jest celem weryfikacji, zob. plan: Critical Implementation Details).
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'auth_session_token';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

// Ulotny fallback dla web (i innych nie-natywnych celów).
let memoryToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (!isNative) {
    return memoryToken;
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  if (!isNative) {
    memoryToken = token;
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  if (!isNative) {
    memoryToken = null;
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

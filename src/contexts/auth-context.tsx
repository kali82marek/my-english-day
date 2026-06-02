/**
 * AuthProvider — globalny stan sesji dla całej aplikacji.
 *
 * Trzy stany (zob. plan: Critical Implementation Details — kolejność bramki):
 *  - `loading`         — hydratacja sesji w toku (odczyt tokenu + GET /auth/me),
 *  - `authenticated`   — token ważny, `user` ustawiony,
 *  - `unauthenticated` — brak tokenu lub token odrzucony.
 *
 * Bramka (Phase 4) NIE przekierowuje w stanie `loading`, inaczej zalogowany
 * użytkownik mignąłby ekranem logowania przy każdym starcie.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { authApi, type AuthUser } from '@/lib/api';
import { clearToken, setToken } from '@/lib/session';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type Credentials = {
  email: string;
  password: string;
};

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (credentials: Credentials) => Promise<void>;
  register: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  // Hydratacja przy starcie: odczyt tokenu z secure-store i potwierdzenie
  // sesji przez GET /auth/me. Każdy błąd (brak tokenu, 401, sieć) → wylogowany.
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { user: me } = await authApi.me();
        if (active) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch {
        if (active) {
          setUser(null);
          setStatus('unauthenticated');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (credentials: Credentials) => {
    const { token, user: signedIn } = await authApi.login(credentials);
    await setToken(token);
    setUser(signedIn);
    setStatus('authenticated');
  }, []);

  const register = useCallback(async (credentials: Credentials) => {
    const { token, user: created } = await authApi.register(credentials);
    await setToken(token);
    setUser(created);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, register, signOut }),
    [status, user, signIn, register, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth musi być użyty wewnątrz <AuthProvider>.');
  }
  return ctx;
}

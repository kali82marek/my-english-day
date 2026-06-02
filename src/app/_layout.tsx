import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/contexts/auth-context';

/**
 * Root layout — bramka auth + nawigator.
 *
 * Drzewo owinięte w `AuthProvider` (stan sesji) i `ThemeProvider`. Zamiast
 * renderować `AppTabs` bezpośrednio, root renderuje `Stack` z dwiema grupami
 * gated po statusie sesji (zob. `RootNavigator`). Grupy w nawiasach NIE zmieniają
 * URL (`/`, `/explore` zostają).
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <RootNavigator />
      </ThemeProvider>
    </AuthProvider>
  );
}

/**
 * Bramka: gating grup po statusie sesji.
 *  - `loading`         — żadna grupa nie jest dostępna; splash overlay zakrywa
 *                        ekran, więc NIE migamy ekranem logowania (zob. plan:
 *                        Critical Implementation Details — kolejność bramki),
 *  - `authenticated`   — dostępna chroniona grupa `(app)` (taby),
 *  - `unauthenticated` — dostępna publiczna grupa `(auth)` (login/register).
 *
 * `Stack.Protected` automatycznie odsyła ze ścieżki, której strażnik jest
 * fałszywy, do pierwszej dostępnej — bez ręcznych redirectów i bez wyścigu
 * „nawigacja przed zamontowaniem roota".
 */
function RootNavigator() {
  const { status } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'authenticated'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'unauthenticated'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

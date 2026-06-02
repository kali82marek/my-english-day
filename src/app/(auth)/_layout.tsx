import { Stack } from 'expo-router';

/**
 * Layout publicznej grupy `(auth)` — prosty stos dla ekranów logowania i
 * rejestracji, bez tabów i bez nagłówka. Renderowany przez root layout tylko
 * dla niezalogowanego użytkownika (bramka).
 */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

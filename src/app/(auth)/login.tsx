import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lekka walidacja spójna z API (email + hasło min. 8 znaków). */
function validate(email: string, password: string): string | null {
  if (!email.trim() || !EMAIL_RE.test(email.trim())) {
    return 'Podaj poprawny adres email.';
  }
  if (password.length < 8) {
    return 'Hasło musi mieć co najmniej 8 znaków.';
  }
  return null;
}

export default function LoginScreen() {
  const { signIn } = useAuth();
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    const validationError = validate(email, password);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signIn({ email: email.trim(), password });
      // Sukces → bramka w root layout przekieruje na ekran główny.
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Nieprawidłowy email lub hasło.');
      } else {
        setError(err instanceof Error ? err.message : 'Nie udało się zalogować.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = [
    styles.input,
    { color: theme.text, backgroundColor: theme.backgroundElement },
  ];

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Zaloguj się
          </ThemedText>

          <TextInput
            style={inputStyle}
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!submitting}
          />
          <TextInput
            style={inputStyle}
            placeholder="Hasło"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!submitting}
          />

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundSelected" style={styles.button}>
              {submitting ? (
                <ActivityIndicator color={theme.text} />
              ) : (
                <ThemedText type="smallBold">Zaloguj</ThemedText>
              )}
            </ThemedView>
          </Pressable>

          <ThemedView style={styles.footer}>
            <ThemedText type="small" themeColor="textSecondary">
              Nie masz konta?{' '}
            </ThemedText>
            <Link href="/register" replace>
              <ThemedText type="linkPrimary">Załóż konto</ThemedText>
            </Link>
          </ThemedView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  input: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    fontSize: 16,
  },
  button: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  error: {
    color: '#e5484d',
  },
  pressed: {
    opacity: 0.7,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.two,
  },
});

import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ContentColumnWidth, Radius, Spacing } from '@/constants/theme';
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

export default function RegisterScreen() {
  const { register } = useAuth();
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
      await register({ email: email.trim(), password });
      // Sukces → auto-login; bramka w root layout wpuszcza na ekran główny.
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Ten email jest już zajęty.');
      } else {
        setError(err instanceof Error ? err.message : 'Nie udało się założyć konta.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = [
    styles.input,
    {
      color: theme.text,
      backgroundColor: theme.background,
      borderColor: theme.border,
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.brand}>
            <BrandMark size={56} />
            <ThemedText type="subtitle">My English Day</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>
              Angielski z sytuacji, które naprawdę przeżyłeś
            </ThemedText>
          </View>

          <Card style={styles.card}>
            <ThemedText type="subtitle" style={styles.title}>
              Załóż konto
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
              placeholder="Hasło (min. 8 znaków)"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
            />

            {error && (
              <ThemedText type="small" themeColor="danger">
                {error}
              </ThemedText>
            )}

            <Button label="Załóż konto" onPress={onSubmit} loading={submitting} />

            <View style={styles.footer}>
              <ThemedText type="small" themeColor="textSecondary">
                Masz już konto?{' '}
              </ThemedText>
              <Link href="/login" replace>
                <ThemedText type="linkPrimary">Zaloguj się</ThemedText>
              </Link>
            </View>
          </Card>
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
    maxWidth: ContentColumnWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  brand: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  tagline: {
    textAlign: 'center',
  },
  card: {
    gap: Spacing.three,
  },
  title: {
    marginBottom: Spacing.one,
  },
  input: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.button,
    borderWidth: 1,
    fontSize: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.two,
  },
});

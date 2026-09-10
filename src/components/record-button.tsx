/**
 * Przycisk nagrywania (S-01) — jeden duży, jednoznaczny element z natychmiastowym
 * feedbackiem stanu. Spina się z `useAudioRecorder`: tap startuje nagrywanie,
 * kolejny tap je kończy. Po zatrzymaniu z ważnym nagraniem (≥ 1 s) woła `onCaptured`
 * z plikiem audio i czasem trwania; krótsze nagranie hook odrzuca (zwraca `null`).
 *
 * Stan „nagrywam" jest widoczny od razu (kolor + licznik), zanim cokolwiek poleci
 * do sieci — to część UX-spec planu (optymistyczny feedback). Bezczynny przycisk ma
 * kolor akcentu marki; czerwień jest zarezerwowana dla trwającego nagrania.
 */

import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAudioRecorder } from '@/hooks/use-audio-recorder';
import { useTheme } from '@/hooks/use-theme';
import { showAlert } from '@/lib/alert';
import type { AudioUpload } from '@/lib/api';

/**
 * Rozszerzenie z URI pliku nagrania (`file:///…/rec.m4a` → `m4a`). Dla `blob:` URI
 * z przeglądarki zwraca `null` — tam format zna dopiero `situationsApi.create`
 * (po odczycie MIME Bloba), więc nazwa poniżej jest tylko placeholderem.
 */
function extFromUri(uri: string): string | null {
  if (uri.startsWith('blob:')) return null;
  const last = uri.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot < 0 || dot === last.length - 1) return null;
  return last.slice(dot + 1).toLowerCase();
}

/** `mm:ss` z milisekund — licznik czasu nagrania. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function RecordButton({
  onCaptured,
}: {
  onCaptured: (audio: AudioUpload, durationMs: number) => void;
}) {
  const { isRecording, durationMs, start, stop } = useAudioRecorder();
  const colors = useTheme();

  const handlePress = useCallback(async () => {
    try {
      if (isRecording) {
        const result = await stop();
        if (result) {
          // Preset HIGH_QUALITY = kontener MPEG-4 (`.m4a`) natywnie — Whisper wykrywa
          // format po rozszerzeniu nazwy, więc niesiemy je z URI nagrania. Na web
          // (`blob:` URI) nazwa jest placeholderem — właściwe rozszerzenie dopasowuje
          // `situationsApi.create` po MIME Bloba (webm/mp4 zależnie od przeglądarki).
          const ext = extFromUri(result.uri) ?? 'm4a';
          onCaptured(
            { uri: result.uri, name: `sytuacja.${ext}`, type: `audio/${ext}` },
            result.durationMs,
          );
        }
      } else {
        await start();
      }
    } catch (err) {
      showAlert(
        'Nagrywanie',
        err instanceof Error ? err.message : 'Nie udało się nagrać sytuacji.',
      );
    }
  }, [isRecording, start, stop, onCaptured]);

  const background = isRecording ? colors.danger : colors.tint;
  const foreground = isRecording ? '#FFFFFF' : colors.onTint;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={isRecording ? 'Zakończ nagrywanie' : 'Nagraj sytuację'}
      style={({ pressed }) => [styles.button, { backgroundColor: background }, pressed && styles.pressed]}>
      <View style={styles.content}>
        <View style={[styles.iconRing, { borderColor: foreground }]}>
          <View
            style={[
              isRecording ? styles.stopSquare : styles.recordDot,
              { backgroundColor: foreground },
            ]}
          />
        </View>
        <View style={styles.labels}>
          <ThemedText type="subtitle" style={{ color: foreground }}>
            {isRecording ? formatDuration(durationMs) : 'Nagraj sytuację'}
          </ThemedText>
          <ThemedText type="small" style={[styles.hint, { color: foreground }]}>
            {isRecording ? 'Nagrywam… dotknij, aby zakończyć' : 'Opowiedz po polsku, co się wydarzyło'}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.card,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  iconRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  stopSquare: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  labels: {
    flex: 1,
    gap: Spacing.half,
  },
  hint: {
    opacity: 0.85,
  },
  pressed: {
    opacity: 0.85,
  },
});

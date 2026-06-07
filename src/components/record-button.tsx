/**
 * Przycisk nagrywania (S-01) — jeden duży, jednoznaczny element z natychmiastowym
 * feedbackiem stanu. Spina się z `useAudioRecorder`: tap startuje nagrywanie,
 * kolejny tap je kończy. Po zatrzymaniu z ważnym nagraniem (≥ 1 s) woła `onCaptured`
 * z plikiem audio i czasem trwania; krótsze nagranie hook odrzuca (zwraca `null`).
 *
 * Stan „nagrywam" jest widoczny od razu (kolor + licznik), zanim cokolwiek poleci
 * do sieci — to część UX-spec planu (optymistyczny feedback).
 */

import { useCallback } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAudioRecorder } from '@/hooks/use-audio-recorder';
import type { AudioUpload } from '@/lib/api';

// Czerwień stanu nagrywania — semantyczny akcent, którego nie ma w palecie motywu.
const RECORDING_COLOR = '#E5484D';

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

  const handlePress = useCallback(async () => {
    try {
      if (isRecording) {
        const result = await stop();
        if (result) {
          // Preset HIGH_QUALITY = kontener MPEG-4 (`.m4a`) — Whisper wykrywa format
          // po rozszerzeniu nazwy, więc niesiemy je z URI nagrania.
          const ext = result.uri.split('.').pop()?.toLowerCase() || 'm4a';
          onCaptured(
            { uri: result.uri, name: `sytuacja.${ext}`, type: `audio/${ext}` },
            result.durationMs,
          );
        }
      } else {
        await start();
      }
    } catch (err) {
      Alert.alert(
        'Nagrywanie',
        err instanceof Error ? err.message : 'Nie udało się nagrać sytuacji.',
      );
    }
  }, [isRecording, start, stop, onCaptured]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.button,
        isRecording ? styles.buttonRecording : styles.buttonIdle,
        pressed && styles.pressed,
      ]}>
      <View style={styles.content}>
        {isRecording ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <View style={styles.dot} />
        )}
        <ThemedText type="smallBold" style={styles.label}>
          {isRecording ? `Nagrywam… ${formatDuration(durationMs)}` : 'Nagraj sytuację'}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIdle: {
    backgroundColor: RECORDING_COLOR,
  },
  buttonRecording: {
    backgroundColor: '#B91C1C',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: Spacing.two,
    height: Spacing.two,
    borderRadius: Spacing.one,
    backgroundColor: '#ffffff',
  },
  label: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.8,
  },
});

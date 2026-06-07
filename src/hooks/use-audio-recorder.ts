/**
 * Hook nagrywania — cienka owijka na `expo-audio` z prostym interfejsem dla UI.
 *
 * Reguły twarde (S-01):
 *  - minimalna długość 1 s — krótsze nagranie traktujemy jako puste (`stop` → null),
 *  - auto-stop na 120 s — chroni rozmiar uploadu, czas i koszt transkrypcji.
 *
 * Format: `RecordingPresets.HIGH_QUALITY` = kontener MPEG-4 (`.m4a`, AAC) na obu
 * platformach — wspierany przez Whispera. NIE używamy `LOW_QUALITY` (na Androidzie
 * to `.3gp`, którego Whisper odrzuca — patrz lekcja o formatach audio).
 */

import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder as useExpoAudioRecorder,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 120000;
const TICK_MS = 200;

export type RecordingResult = { uri: string; durationMs: number };

export function useAudioRecorder(): {
  isRecording: boolean;
  durationMs: number;
  start: () => Promise<void>;
  stop: () => Promise<RecordingResult | null>;
} {
  const recorder = useExpoAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref do najświeższej wersji `stop`, by tick auto-stopu nie wołał starej domknięcia.
  const stopRef = useRef<(() => Promise<RecordingResult | null>) | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    clearTimer();
    // `currentTime` to sekundy nagrania — bardziej wiarygodne niż własny licznik.
    const finalMs = Math.round(recorder.currentTime * 1000);
    await recorder.stop();
    setIsRecording(false);
    setDurationMs(0);

    const uri = recorder.uri;
    if (!uri || finalMs < MIN_DURATION_MS) {
      return null;
    }
    return { uri, durationMs: finalMs };
  }, [recorder, clearTimer]);

  // Trzymaj `stopRef` zsynchronizowane (bez mutacji refa w trakcie renderu).
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = useCallback(async (): Promise<void> => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Brak zgody na dostęp do mikrofonu.');
    }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();

    setDurationMs(0);
    setIsRecording(true);

    clearTimer();
    intervalRef.current = setInterval(() => {
      const ms = Math.round(recorder.currentTime * 1000);
      setDurationMs(ms);
      if (ms >= MAX_DURATION_MS) {
        void stopRef.current?.();
      }
    }, TICK_MS);
  }, [recorder, clearTimer]);

  // Sprzątanie timera przy odmontowaniu — żaden interwał nie przeżywa ekranu.
  useEffect(() => clearTimer, [clearTimer]);

  return { isRecording, durationMs, start, stop };
}

/**
 * Alerty działające na obu platformach.
 *
 * `Alert.alert` z react-native jest na web pustą funkcją (react-native-web nie
 * implementuje alertów), więc błędy ginęły bez śladu. Na web używamy natywnych
 * okien przeglądarki (`window.alert` / `window.confirm`), na urządzeniu — RN Alert.
 */

import { Alert, Platform } from 'react-native';

/** Komunikat jednoprzyciskowy (błąd, informacja). */
export function showAlert(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/** Potwierdzenie akcji destrukcyjnej: „Anuluj" / `confirmLabel`. */
export function confirmAction(options: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel?: () => void;
}): void {
  const { title, message, confirmLabel, onConfirm, onCancel } = options;
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    } else {
      onCancel?.();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Anuluj', style: 'cancel', onPress: onCancel },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

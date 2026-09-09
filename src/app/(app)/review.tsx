/**
 * Ekran sesji powtórek (S-05) — domyka pętlę US-01: nauka z zaakceptowanych fiszek.
 *
 * Serwer oddaje fiszki „do powtórki teraz" (`reviewApi.listDue`); sesja to lokalna
 * kolejka pokazywana po jednej (`queue[0]`). Karta jest najpierw nieodsłonięta (polska
 * strona), po „Pokaż odpowiedź" użytkownik ocenia: „Nie umiem" przenosi kartę na koniec
 * kolejki (wraca jeszcze w tej sesji), „Prawie"/„Umiem" zdejmują ją. Oceny są
 * optymistyczne — przy błędzie sieci karta wraca na początek kolejki.
 *
 * Odsłonięcie jest resetowane JAWNIE po każdej ocenie: przy jednej karcie „Nie umiem"
 * zostawia ten sam `queue[0]`, więc zmiana `key` nie zresetowałaby stanu.
 *
 * Pusta kolejka ma dwa znaczenia rozróżniane przez `acceptedCount`: pusta baza nauki
 * (zachęta do akceptacji propozycji) albo „na dziś wszystko powtórzone".
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReviewCard } from '@/components/review-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { reviewApi, type Flashcard, type ReviewGrade } from '@/lib/api';

export default function ReviewScreen() {
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [acceptedCount, setAcceptedCount] = useState(0);
  // Czy serwer miał więcej fiszek do powtórki niż jedna porcja (limit API) — po sesji
  // podpowiadamy ponowne wejście; porównanie z bieżącą kolejką byłoby fałszywie prawdziwe.
  const [moreDue, setMoreDue] = useState(false);
  const [loading, setLoading] = useState(true);
  // Liczba fiszek ocenionych „Prawie"/„Umiem" w tej sesji (zdjętych z kolejki).
  const [sessionDone, setSessionDone] = useState(0);

  const load = useCallback(async () => {
    try {
      const { cards, dueCount: due, acceptedCount: accepted } = await reviewApi.listDue();
      setQueue(cards);
      setMoreDue(due > cards.length);
      setAcceptedCount(accepted);
      setRevealed(false);
    } catch {
      // Cicho — kolejny focus spróbuje ponownie; brak sieci nie wywala ekranu.
    } finally {
      setLoading(false);
    }
  }, []);

  // Pobranie na wejściu i przy każdym powrocie na ekran.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Ocena: optymistycznie przestaw kolejkę; przy błędzie sieci przywróć kartę na początek.
  const grade = useCallback((card: Flashcard, g: ReviewGrade) => {
    setRevealed(false);
    const removed = g !== 'again';
    setQueue((prev) => {
      const rest = prev.filter((c) => c.id !== card.id);
      return removed ? rest : [...rest, card];
    });
    if (removed) {
      setSessionDone((n) => n + 1);
    }

    reviewApi.grade(card.id, g).catch(() => {
      setQueue((prev) => (prev.some((c) => c.id === card.id) ? prev : [card, ...prev]));
      if (removed) {
        setSessionDone((n) => Math.max(0, n - 1));
      }
    });
  }, []);

  const current = queue[0];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Nauka</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Do powtórki: {queue.length}
          </ThemedText>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : current ? (
          <ReviewCard
            key={current.id}
            card={current}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            onGrade={(g) => grade(current, g)}
          />
        ) : acceptedCount === 0 ? (
          <View style={styles.centered}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centeredText}>
              Brak fiszek w bazie nauki. Zaakceptuj propozycje w zakładce Fiszki.
            </ThemedText>
          </View>
        ) : (
          <View style={styles.centered}>
            <ThemedText type="default" style={styles.centeredText}>
              Na dziś wszystko powtórzone
            </ThemedText>
            {sessionDone > 0 && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centeredText}>
                Oceniono: {sessionDone}
              </ThemedText>
            )}
            {moreDue && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centeredText}>
                Wróć na ekran, aby pobrać kolejną porcję.
              </ThemedText>
            )}
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    paddingBottom: BottomTabInset,
  },
  header: {
    paddingTop: Spacing.three,
    gap: Spacing.half,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    gap: Spacing.two,
  },
  centeredText: {
    textAlign: 'center',
  },
});

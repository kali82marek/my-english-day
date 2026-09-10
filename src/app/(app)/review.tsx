/**
 * Ekran sesji powtórek (S-05) — domyka pętlę US-01: nauka z zaakceptowanych fiszek.
 *
 * Serwer oddaje fiszki „do powtórki teraz" (`reviewApi.listDue`); sesja to lokalna
 * kolejka pokazywana po jednej (`queue[0]`). Karta jest najpierw nieodsłonięta (polska
 * strona), po „Pokaż odpowiedź" użytkownik ocenia: „Nie umiem" przenosi kartę na koniec
 * kolejki (wraca jeszcze w tej sesji), „Prawie"/„Umiem" zdejmują ją. Oceny są
 * optymistyczne — przy błędzie sieci karta wraca na początek kolejki.
 *
 * Odsłonięcie jest resetowane JAWNIE po każdej ocenie (i po rollbacku): `ReviewCard` jest
 * bezstanowa, a przy jednej karcie „Nie umiem" zostawia ten sam `queue[0]` — zmiana `key`
 * niczego by nie zresetowała.
 *
 * Strażnik `pendingRef` (jak `decidedRef` w `flashcards.tsx`): ocena w locie + refokus
 * (`load` podmienia kolejkę listą z serwera) nie może przywrócić karty do drugiej oceny.
 *
 * Pusta kolejka ma dwa znaczenia rozróżniane przez `acceptedCount`: pusta baza nauki
 * (zachęta do akceptacji propozycji) albo „na dziś wszystko powtórzone".
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScreenHeader } from '@/components/card';
import { ReviewCard } from '@/components/review-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
  // Id-ki fiszek z oceną w locie — refokus w trakcie żądania nie może przywrócić karty
  // z serwera do podwójnej oceny (dwa „Umiem" = 3 dni zamiast 1).
  const pendingRef = useRef<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const { cards, dueCount: due, acceptedCount: accepted } = await reviewApi.listDue();
      setQueue(cards.filter((c) => !pendingRef.current.has(c.id)));
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

    pendingRef.current.add(card.id);
    reviewApi
      .grade(card.id, g)
      .catch(() => {
        // Karta wraca na początek nieodsłonięta — użytkownik mógł już odsłonić następną.
        setRevealed(false);
        setQueue((prev) => (prev.some((c) => c.id === card.id) ? prev : [card, ...prev]));
        if (removed) {
          setSessionDone((n) => Math.max(0, n - 1));
        }
      })
      .finally(() => {
        pendingRef.current.delete(card.id);
      });
  }, []);

  const current = queue[0];
  const colors = useTheme();

  return (
    <Screen>
      <ScreenHeader title="Nauka" caption={`Do powtórki: ${queue.length}`} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.tint} />
        </View>
      ) : current ? (
        <ReviewCard
          card={current}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onGrade={(g) => grade(current, g)}
        />
      ) : acceptedCount === 0 ? (
        <View style={styles.centered}>
          <ThemedText type="default" style={styles.centeredText}>
            Baza nauki jest pusta
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centeredText}>
            Zaakceptuj propozycje w zakładce Fiszki, a pojawią się tu do powtórki.
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    gap: Spacing.one,
  },
  centeredText: {
    textAlign: 'center',
  },
});

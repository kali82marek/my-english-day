/**
 * Karta pojedynczej propozycji fiszki (S-02).
 *
 * Renderuje jedną fiszkę naraz: angielski front (wyróżniony), polskie tłumaczenie,
 * znacznik typu (słówko/zwrot/zdanie) oraz — gdy niepusty — angielski przykład
 * użycia. Pod spodem dwa przyciski: Akceptuj (→ baza nauki) i Odrzuć (→ kasacja).
 *
 * Czysta prezentacja: decyzje (akceptacja/odrzucenie) deleguje przez callbacki do
 * ekranu przeglądu (`src/app/(app)/flashcards.tsx`).
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Flashcard } from '@/lib/api';

const ACCEPT_COLOR = '#30A46C';
const REJECT_COLOR = '#E5484D';

/** Etykiety typów po polsku — `type` z API jest po angielsku. */
const TYPE_LABELS: Record<Flashcard['type'], string> = {
  word: 'słówko',
  phrase: 'zwrot',
  sentence: 'zdanie',
};

export function FlashcardCard({
  card,
  onAccept,
  onReject,
}: {
  card: Flashcard;
  onAccept: () => void;
  onReject: () => void;
}) {
  // `example_en` bywa pustym stringiem (gł. dla typu `sentence`) — ukrywamy wtedy sekcję.
  const hasExample = card.example_en.trim().length > 0;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView type="backgroundSelected" style={styles.typeBadge}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {TYPE_LABELS[card.type]}
        </ThemedText>
      </ThemedView>

      <ThemedText type="subtitle">{card.front_en}</ThemedText>
      <ThemedText type="default" themeColor="textSecondary">
        {card.back_pl}
      </ThemedText>

      {hasExample && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.example}>
          {card.example_en}
        </ThemedText>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={onReject}
          style={({ pressed }) => [styles.button, styles.rejectButton, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={styles.buttonLabel}>
            Odrzuć
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={onAccept}
          style={({ pressed }) => [styles.button, styles.acceptButton, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={styles.buttonLabel}>
            Akceptuj
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  example: {
    fontStyle: 'italic',
    marginTop: Spacing.one,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: ACCEPT_COLOR,
  },
  rejectButton: {
    backgroundColor: REJECT_COLOR,
  },
  buttonLabel: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.7,
  },
});

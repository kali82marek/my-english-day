/**
 * Karta jednej fiszki w sesji powtórek (S-05).
 *
 * Kierunek PL→EN: zawsze widać polską stronę (`back_pl`) z podpisem „Jak powiesz to po
 * angielsku?" i znacznik typu. Nieodsłonięta karta ma jeden szeroki przycisk „Pokaż
 * odpowiedź"; odsłonięta pokazuje angielski front (wyróżniony), przykład użycia (gdy
 * niepusty) i trzy przyciski oceny: Nie umiem / Prawie / Umiem (FR-012).
 *
 * Czysta prezentacja: stan odsłonięcia i decyzje deleguje przez callbacki do ekranu
 * sesji (`src/app/(app)/review.tsx`).
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TYPE_LABELS } from '@/constants/flashcards';
import { Spacing } from '@/constants/theme';
import type { Flashcard, ReviewGrade } from '@/lib/api';

// Kolory ocen: czerwień/zieleń jak akcje przeglądu (`flashcard-card.tsx`), bursztyn dla „Prawie".
const AGAIN_COLOR = '#E5484D';
const HARD_COLOR = '#F5A524';
const GOOD_COLOR = '#30A46C';
const REVEAL_COLOR = '#3c87f7';

/** Trzy oceny w kolejności od „nie umiem" do „umiem" — etykiety PL żyją tylko tutaj. */
const GRADE_BUTTONS: { grade: ReviewGrade; label: string; color: string }[] = [
  { grade: 'again', label: 'Nie umiem', color: AGAIN_COLOR },
  { grade: 'hard', label: 'Prawie', color: HARD_COLOR },
  { grade: 'good', label: 'Umiem', color: GOOD_COLOR },
];

export function ReviewCard({
  card,
  revealed,
  onReveal,
  onGrade,
}: {
  card: Flashcard;
  revealed: boolean;
  onReveal: () => void;
  onGrade: (grade: ReviewGrade) => void;
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

      <ThemedText type="small" themeColor="textSecondary">
        Jak powiesz to po angielsku?
      </ThemedText>
      <ThemedText type="subtitle">{card.back_pl}</ThemedText>

      {revealed ? (
        <>
          <View style={styles.answer}>
            <ThemedText type="subtitle">{card.front_en}</ThemedText>
            {hasExample && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.example}>
                {card.example_en}
              </ThemedText>
            )}
          </View>

          <View style={styles.actions}>
            {GRADE_BUTTONS.map(({ grade, label, color }) => (
              <Pressable
                key={grade}
                onPress={() => onGrade(grade)}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: color },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  {label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <Pressable
          onPress={onReveal}
          style={({ pressed }) => [styles.button, styles.revealButton, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={styles.buttonLabel}>
            Pokaż odpowiedź
          </ThemedText>
        </Pressable>
      )}
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
  answer: {
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  example: {
    fontStyle: 'italic',
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
  revealButton: {
    flex: 0,
    marginTop: Spacing.three,
    backgroundColor: REVEAL_COLOR,
  },
  buttonLabel: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.7,
  },
});

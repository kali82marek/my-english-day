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

import { StyleSheet, View } from 'react-native';

import { Button, type ButtonVariant } from '@/components/button';
import { Card, TypeBadge } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Flashcard, ReviewGrade } from '@/lib/api';

/** Trzy oceny w kolejności od „nie umiem" do „umiem" — etykiety PL żyją tylko tutaj. */
const GRADE_BUTTONS: { grade: ReviewGrade; label: string; variant: ButtonVariant }[] = [
  { grade: 'again', label: 'Nie umiem', variant: 'danger' },
  { grade: 'hard', label: 'Prawie', variant: 'warning' },
  { grade: 'good', label: 'Umiem', variant: 'success' },
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
  const colors = useTheme();
  // `example_en` bywa pustym stringiem (gł. dla typu `sentence`) — ukrywamy wtedy sekcję.
  const hasExample = card.example_en.trim().length > 0;

  return (
    <Card>
      <TypeBadge type={card.type} />

      <View style={styles.prompt}>
        <ThemedText type="small" themeColor="textSecondary">
          Jak powiesz to po angielsku?
        </ThemedText>
        <ThemedText type="subtitle">{card.back_pl}</ThemedText>
      </View>

      {revealed ? (
        <>
          <View style={[styles.answer, { borderTopColor: colors.border }]}>
            <ThemedText type="title" style={{ color: colors.tint }}>
              {card.front_en}
            </ThemedText>
            {hasExample && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.example}>
                {card.example_en}
              </ThemedText>
            )}
          </View>

          <View style={styles.actions}>
            {GRADE_BUTTONS.map(({ grade, label, variant }) => (
              <Button
                key={grade}
                label={label}
                variant={variant}
                onPress={() => onGrade(grade)}
                style={styles.action}
              />
            ))}
          </View>
        </>
      ) : (
        <Button label="Pokaż odpowiedź" onPress={onReveal} style={styles.reveal} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  prompt: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  answer: {
    marginTop: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
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
  action: {
    flex: 1,
    paddingHorizontal: Spacing.one,
  },
  reveal: {
    marginTop: Spacing.three,
  },
});

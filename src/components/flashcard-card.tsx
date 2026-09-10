/**
 * Karta pojedynczej propozycji fiszki (S-02).
 *
 * Renderuje jedną fiszkę naraz: angielski front (wyróżniony), polskie tłumaczenie,
 * znacznik typu (słówko/zwrot/zdanie) oraz — gdy niepusty — angielski przykład
 * użycia. Pod spodem dwa przyciski: Odrzuć (→ kasacja) i Akceptuj (→ baza nauki).
 *
 * Czysta prezentacja: decyzje (akceptacja/odrzucenie) deleguje przez callbacki do
 * ekranu przeglądu (`src/app/(app)/flashcards.tsx`).
 */

import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card, TypeBadge } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Flashcard } from '@/lib/api';

export function FlashcardCard({
  card,
  onAccept,
  onReject,
}: {
  card: Flashcard;
  onAccept: () => void;
  onReject: () => void;
}) {
  const colors = useTheme();
  // `example_en` bywa pustym stringiem (gł. dla typu `sentence`) — ukrywamy wtedy sekcję.
  const hasExample = card.example_en.trim().length > 0;

  return (
    <Card>
      <TypeBadge type={card.type} />

      <View style={styles.body}>
        <ThemedText type="title">{card.front_en}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {card.back_pl}
        </ThemedText>
      </View>

      {hasExample && (
        <View style={[styles.example, { borderLeftColor: colors.tint }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.exampleText}>
            {card.example_en}
          </ThemedText>
        </View>
      )}

      <View style={styles.actions}>
        <Button label="Odrzuć" variant="secondary" onPress={onReject} style={styles.action} />
        <Button label="Akceptuj" variant="primary" onPress={onAccept} style={styles.action} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  example: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.three,
    marginTop: Spacing.two,
  },
  exampleText: {
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  action: {
    flex: 1,
  },
});

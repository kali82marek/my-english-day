import { StyleSheet, View, type ViewProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Flashcard } from '@/lib/api';
import { TYPE_LABELS } from '@/constants/flashcards';

/** Karta: biała (ciemna) powierzchnia z cienką ramką i jednym promieniem dla całej aplikacji. */
export function Card({ style, ...rest }: ViewProps) {
  const colors = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.backgroundElement, borderColor: colors.border },
        style,
      ]}
      {...rest}
    />
  );
}

/** Znacznik typu fiszki (słówko / zwrot / zdanie) w miękkim kolorze akcentu. */
export function TypeBadge({ type }: { type: Flashcard['type'] }) {
  const colors = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: colors.tintSoft }]}>
      <ThemedText type="smallBold" style={[styles.badgeText, { color: colors.tint }]}>
        {TYPE_LABELS[type]}
      </ThemedText>
    </View>
  );
}

/** Nagłówek ekranu: tytuł + opcjonalny podpis (licznik, data). */
export function ScreenHeader({ title, caption }: { title: string; caption?: string }) {
  return (
    <View style={styles.header}>
      <ThemedText type="title">{title}</ThemedText>
      {caption ? (
        <ThemedText type="small" themeColor="textSecondary">
          {caption}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Radius.badge,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  header: {
    gap: Spacing.half,
  },
});

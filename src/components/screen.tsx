import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, ContentColumnWidth, Spacing, WebTabBarHeight } from '@/constants/theme';

/**
 * Szkielet ekranu w grupie `(app)`: tło strony, bezpieczne krawędzie, miejsce na pasek
 * zakładek (dół natywnie, góra na web) i wąska, wyśrodkowana kolumna treści na web.
 */
export function Screen({ children, style, ...rest }: ViewProps) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={[styles.column, style]} {...rest}>
          {children}
        </View>
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
    paddingTop: WebTabBarHeight,
    paddingBottom: BottomTabInset,
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: ContentColumnWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
});

import { StyleSheet, Text, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Znak marki — kwadrat w kolorze akcentu z monogramem „ED”. Zastępuje logo Expo ze
 * startera; używany w pasku zakładek (web), nagłówku ekranu głównego i na ekranach auth.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  const colors = useTheme();
  return (
    <View
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: colors.tint },
      ]}>
      <Text style={[styles.letters, { color: colors.onTint, fontSize: size * 0.42 }]}>ED</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.button,
  },
  letters: {
    fontWeight: 800,
    letterSpacing: -0.5,
  },
});

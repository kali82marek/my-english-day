import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

/**
 * Jeden przycisk dla całej aplikacji. `primary` = akcent marki (akcja główna ekranu),
 * `secondary` = neutralny (akcje poboczne), kolory semantyczne = oceny i decyzje.
 * Wysokość 48 pt (cel dotyku), promień i wagi fontu spójne z kartami.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useTheme();
  const filled = variant !== 'secondary';
  const background = {
    primary: colors.tint,
    secondary: colors.backgroundSelected,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  }[variant];
  const foreground = filled ? '#FFFFFF' : colors.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background },
        (pressed || disabled) && styles.dimmed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <ThemedText type="smallBold" style={{ color: foreground }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: {
    opacity: 0.7,
  },
});

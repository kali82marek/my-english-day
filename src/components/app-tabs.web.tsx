import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { SymbolView } from 'expo-symbols';
import { Pressable, View, StyleSheet, useWindowDimensions } from 'react-native';

import { BrandMark } from './brand-mark';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/auth-context';
import { useTheme } from '@/hooks/use-theme';

/** Nazwa ikony Material Symbols (web) dla każdej zakładki. */
type TabIcon = 'mic' | 'style' | 'school';

/**
 * Górny pasek zakładek na web: marka po lewej, trzy zakładki na środku, wylogowanie
 * po prawej. Ekrany rezerwują pod niego miejsce przez `WebTabBarHeight`.
 */
export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton icon="mic">Nagraj</TabButton>
          </TabTrigger>
          <TabTrigger name="flashcards" href="/flashcards" asChild>
            <TabButton icon="style">Fiszki</TabButton>
          </TabTrigger>
          <TabTrigger name="review" href="/review" asChild>
            <TabButton icon="school">Nauka</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({
  children,
  isFocused,
  icon,
  ...props
}: TabTriggerSlotProps & { icon: TabIcon }) {
  const colors = useTheme();
  const color = isFocused ? colors.tint : colors.textSecondary;

  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'tintSoft' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <SymbolView tintColor={color} name={{ ios: 'circle', web: icon }} size={18} />
        <ThemedText type="smallBold" style={{ color }}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const colors = useTheme();
  const { signOut } = useAuth();
  // Nazwa marki widoczna od szerokości tabletu; na wąskim oknie zostaje sam znak.
  const { width } = useWindowDimensions();
  const showBrandText = width >= 640;

  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView
        type="backgroundElement"
        style={[styles.innerContainer, { borderColor: colors.border }]}>
        <View style={styles.brand}>
          <BrandMark size={28} />
          {showBrandText && <ThemedText type="smallBold">My English Day</ThemedText>}
        </View>

        <View style={styles.tabs}>{props.children}</View>

        <Pressable onPress={signOut} style={({ pressed }) => pressed && styles.pressed}>
          <View style={styles.signOut}>
            <SymbolView
              tintColor={colors.textSecondary}
              name={{ ios: 'circle', web: 'logout' }}
              size={16}
            />
            <ThemedText type="small" themeColor="textSecondary">
              Wyloguj
            </ThemedText>
          </View>
        </Pressable>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    top: 0,
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    zIndex: 10,
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.badge,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginRight: 'auto',
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.badge,
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginLeft: 'auto',
  },
});

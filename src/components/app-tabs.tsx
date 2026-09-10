import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';

/**
 * Natywne zakładki (iOS/Android). Ikony systemowe: SF Symbols na iOS, Material na
 * Androidzie — bez własnych PNG. Wariant web: `app-tabs.web.tsx`.
 */
export default function AppTabs() {
  const colors = useTheme();

  return (
    <NativeTabs
      backgroundColor={colors.backgroundElement}
      indicatorColor={colors.tintSoft}
      iconColor={{ default: colors.textSecondary, selected: colors.tint }}
      labelStyle={{
        default: { color: colors.textSecondary },
        selected: { color: colors.tint },
      }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Nagraj</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'mic', selected: 'mic.fill' }} md="mic" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="flashcards">
        <NativeTabs.Trigger.Label>Fiszki</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'rectangle.on.rectangle', selected: 'rectangle.fill.on.rectangle.fill' }}
          md="style"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="review">
        <NativeTabs.Trigger.Label>Nauka</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'graduationcap', selected: 'graduationcap.fill' }}
          md="school"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

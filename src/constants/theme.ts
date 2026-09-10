/**
 * Motyw aplikacji — kolory (light/dark), fonty, odstępy i stałe layoutu.
 *
 * Paleta: neutralne tło strony i kart + jeden akcent marki (`tint`, morska zieleń)
 * używany do akcji głównych, aktywnej zakładki i linków. Kolory semantyczne
 * (`success`, `warning`, `danger`) są zarezerwowane dla ocen i stanów, nie dla dekoracji.
 * Komponenty biorą kolory WYŁĄCZNIE stąd (`ThemedView`, `ThemedText`, `useTheme`).
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#15181D',
    textSecondary: '#5F6673',
    background: '#F5F6F8',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E8EAEE',
    border: '#E2E5EA',
    tint: '#0D9488',
    tintSoft: '#CCFBF1',
    onTint: '#FFFFFF',
    success: '#2E9E63',
    warning: '#D98F1B',
    danger: '#DC4A4F',
  },
  dark: {
    text: '#F2F3F5',
    textSecondary: '#A3A9B4',
    background: '#0E0F12',
    backgroundElement: '#1A1C21',
    backgroundSelected: '#272A31',
    border: '#2C2F36',
    tint: '#2DD4BF',
    tintSoft: '#134E4A',
    onTint: '#042F2E',
    success: '#3DBE78',
    warning: '#F2A93B',
    danger: '#F0625F',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Kolor tła splash / overlay startowego — ten sam co `expo-splash-screen` w `app.json`. */
export const SplashColor = '#0D9488';

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Promienie zaokrągleń — karty i przyciski mają jeden, spójny promień. */
export const Radius = {
  card: 20,
  button: 14,
  badge: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
/** Szerokość kolumny treści na web — ekrany z jedną kartą nie rozciągają się na 800 px. */
export const ContentColumnWidth = 560;
/** Wysokość górnego paska zakładek na web (`app-tabs.web.tsx`) — ekrany robią pod niego miejsce. */
export const WebTabBarHeight = Platform.OS === 'web' ? 72 : 0;

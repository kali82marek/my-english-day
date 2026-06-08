import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecordButton } from '@/components/record-button';
import { SituationList, type LocalSituation } from '@/components/situation-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/auth-context';
import { situationsApi, type AudioUpload, type Situation } from '@/lib/api';

// Co ile odpytujemy serwer, dopóki istnieją wiersze `pending`.
const POLL_MS = 2000;
// Twardy limit: po tym czasie bez finalizacji uznajemy `pending` za osierocony
// (ubity/przekroczony `waitUntil`, błąd UPDATE) i renderujemy jak stan błędu.
const ORPHAN_MS = 60000;

/**
 * Czas utworzenia w ms. Serwer: `YYYY-MM-DD HH:MM:SS` (UTC); wiersz tymczasowy: ISO.
 * Sprowadzamy oba do formy parsowalnej; niepewny parse traktujemy jak „świeży".
 */
function createdAtMs(createdAt: string): number {
  const iso = createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? Date.now() : ms;
}

/**
 * Scala stan lokalny z listą serwera po `id` (a NIE nadpisuje ślepo):
 *  - wiersze tymczasowe „w locie" (bez `id`) zostają na górze,
 *  - realne wiersze bierzemy z serwera,
 *  - lokalna decyzja o timeoucie wygrywa: jeśli lokalnie `failed`, a serwer wciąż
 *    `pending` (osierocony `waitUntil`), nie cofamy do `pending`.
 */
function mergeFromServer(prev: LocalSituation[], server: Situation[]): LocalSituation[] {
  const localById = new Map(prev.filter((r) => r.id != null).map((r) => [r.id, r]));
  const tempRows = prev.filter((r) => r.id == null);
  const realRows: LocalSituation[] = server.map((s) => {
    const local = localById.get(s.id);
    if (local && local.status === 'failed' && s.status === 'pending') {
      return { ...s, status: 'failed' };
    }
    return { ...s };
  });
  return [...tempRows, ...realRows];
}

/**
 * Ekran główny S-01 — jeden widok: przycisk nagrywania + lista sytuacji dnia.
 *
 * Optymistyczny zapis: po nagraniu wstawiamy lokalny wiersz `pending` (z `tempId`)
 * zanim sieć potwierdzi; odpowiedź 201 zastępuje go realnym wierszem. Dopóki jakaś
 * sytuacja jest `pending`, krótki polling odświeża listę; po finalizacji (lub
 * timeoucie osieroconego `pending`) polling się zatrzymuje.
 */
export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const [situations, setSituations] = useState<LocalSituation[]>([]);
  // Id-ki usuwane (optymistycznie) — strażnik przed wyścigiem: polling/`mergeFromServer`
  // ufa serwerowi, więc bez tego wiersz wracał, gdy GET wyścignął DELETE. Przy realnym
  // błędzie DELETE id jest zdejmowane i `refresh()` przywraca wiersz.
  const deletingRef = useRef<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const { situations: server } = await situationsApi.list();
      setSituations((prev) =>
        mergeFromServer(prev, server).filter(
          (r) => r.id == null || !deletingRef.current.has(r.id),
        ),
      );
    } catch {
      // Cicho — kolejny tick / focus spróbuje ponownie; brak sieci nie wywala ekranu.
    }
  }, []);

  // Pobranie na wejściu i przy każdym powrocie na ekran.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const hasPending = situations.some((r) => r.status === 'pending');

  // Polling aktywny tylko gdy istnieją wiersze `pending`. Każdy tick: (1) osierocone
  // `pending` (wiek > ORPHAN_MS) flipujemy w `failed` — to zatrzyma polling, (2) gdy
  // wciąż są żywe `pending`, odświeżamy z serwera.
  useEffect(() => {
    if (!hasPending) {
      return;
    }
    const interval = setInterval(() => {
      setSituations((prev) => {
        const now = Date.now();
        let changed = false;
        const next = prev.map((r) => {
          if (r.status === 'pending' && now - createdAtMs(r.created_at) > ORPHAN_MS) {
            changed = true;
            return { ...r, status: 'failed' as const };
          }
          return r;
        });
        return changed ? next : prev;
      });
      void refresh();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [hasPending, refresh]);

  const handleCaptured = useCallback((audio: AudioUpload, durationMs: number) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: LocalSituation = {
      id: null,
      tempId,
      status: 'pending',
      transcript: null,
      duration_ms: durationMs,
      created_at: new Date().toISOString(),
      flashcards_status: 'pending',
    };
    setSituations((prev) => [optimistic, ...prev]);

    situationsApi
      .create(audio, durationMs)
      .then((real) => {
        // Zastąp wiersz tymczasowy realnym (po `tempId`) — staje się wierszem z `id`.
        setSituations((prev) =>
          prev.map((r) => (r.tempId === tempId ? { ...real, tempId: undefined } : r)),
        );
      })
      .catch(() => {
        setSituations((prev) =>
          prev.map((r) => (r.tempId === tempId ? { ...r, status: 'failed' } : r)),
        );
      });
  }, []);

  const handleDelete = useCallback(
    (id: number) => {
      // Optymistyczne usunięcie + strażnik (chroni przed powrotem wiersza, gdy polling
      // wyścignie DELETE). Przy błędzie: zdejmij strażnika i przywróć stan z serwera.
      deletingRef.current.add(id);
      setSituations((prev) => prev.filter((r) => r.id !== id));
      situationsApi.remove(id).catch(() => {
        deletingRef.current.delete(id);
        void refresh();
      });
    },
    [refresh],
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.email}>
            {user?.email ?? '—'}
          </ThemedText>
          <Pressable onPress={signOut} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundElement" style={styles.signOutButton}>
              <ThemedText type="smallBold">Wyloguj</ThemedText>
            </ThemedView>
          </Pressable>
        </View>

        <RecordButton onCaptured={handleCaptured} />

        <View style={styles.listWrapper}>
          <SituationList situations={situations} onDelete={handleDelete} />
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
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    paddingBottom: BottomTabInset,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  email: {
    flexShrink: 1,
  },
  signOutButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  listWrapper: {
    flex: 1,
  },
});

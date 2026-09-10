/**
 * Lista sytuacji dnia (S-01) + karta pojedynczej sytuacji.
 *
 * Renderuje stany cyklu transkrypcji:
 *  - `pending` → wskaźnik „Transkrybuję…",
 *  - `done`    → transkrypt + godzina nagrania + stan fiszek (generuję / gotowe /
 *                nie powstały); „Generuję…" tylko w limicie czasu `GENERATING_LIMIT_MS`
 *                liczonym od `now` przekazanego z ekranu (osierocone generowanie nie
 *                kręci kółka w nieskończoność),
 *  - `failed`  → „Nie udało się — nagraj ponownie".
 *
 * Usuwanie: swipe w lewo odsłania przycisk „Usuń"; tap pyta o potwierdzenie i
 * dopiero wtedy woła `onDelete`. Swipe (`ReanimatedSwipeable`) wymaga
 * `GestureHandlerRootView` u korzenia drzewa — montowane w `src/app/_layout.tsx`.
 *
 * Wiersze „w locie" (optymistyczne, jeszcze bez serwerowego `id`) nie są usuwalne —
 * panel swipe pojawia się tylko dla wierszy z realnym `id`.
 */

import { useCallback, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/alert';
import type { Situation } from '@/lib/api';

/**
 * Sytuacja w stanie lokalnym ekranu. Wiersz optymistyczny niesie kliencki `tempId`
 * i nie ma jeszcze serwerowego `id` (`null`); realny wiersz z odpowiedzi 201 go
 * zastępuje (patrz reguła scalania w `src/app/(app)/index.tsx`).
 */
export type LocalSituation = Omit<Situation, 'id'> & { id: number | null; tempId?: string };

// Limit „żywego" generowania fiszek od chwili nagrania: transkrypcja (do 60 s) +
// generowanie. Po nim wiersz z `flashcards_status='pending'` traktujemy jak osierocony.
export const GENERATING_LIMIT_MS = 120000;

/**
 * Czas utworzenia w ms. Serwer: `YYYY-MM-DD HH:MM:SS` (UTC); wiersz tymczasowy: ISO.
 * Sprowadzamy oba do formy parsowalnej; niepewny parse traktujemy jak „świeży".
 */
export function createdAtMs(createdAt: string): number {
  const iso = createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? Date.now() : ms;
}

/** Czy fiszki tej sytuacji jeszcze się generują (transkrypt jest, limit nie minął). */
export function isGenerationLive(item: LocalSituation, now: number): boolean {
  return (
    item.status === 'done' &&
    item.flashcards_status === 'pending' &&
    now - createdAtMs(item.created_at) <= GENERATING_LIMIT_MS
  );
}

/** Godzina `HH:mm` z `created_at` (SQLite `datetime('now')`, UTC). */
function formatTime(createdAt: string): string {
  const date = new Date(`${createdAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatusLine({ item, now }: { item: LocalSituation; now: number }) {
  const colors = useTheme();

  if (item.status === 'pending') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator size="small" color={colors.tint} />
        <ThemedText type="small" themeColor="textSecondary">
          Transkrybuję…
        </ThemedText>
      </View>
    );
  }

  if (item.status === 'failed') {
    return (
      <ThemedText type="small" style={{ color: colors.danger }}>
        Nie udało się — nagraj ponownie.
      </ThemedText>
    );
  }

  return (
    <View style={styles.statusRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {formatTime(item.created_at)}
      </ThemedText>
      {item.flashcards_status === 'pending' &&
        (isGenerationLive(item, now) ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              ·
            </ThemedText>
            <ActivityIndicator size="small" color={colors.tint} />
            <ThemedText type="small" style={{ color: colors.tint }}>
              Generuję fiszki…
            </ThemedText>
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            · Fiszki jeszcze nie gotowe
          </ThemedText>
        ))}
      {item.flashcards_status === 'done' && (
        <ThemedText type="small" themeColor="textSecondary">
          · Fiszki gotowe
        </ThemedText>
      )}
      {item.flashcards_status === 'failed' && (
        <ThemedText type="small" style={{ color: colors.danger }}>
          · Fiszki się nie wygenerowały
        </ThemedText>
      )}
    </View>
  );
}

function SituationCard({ item, now }: { item: LocalSituation; now: number }) {
  return (
    <Card style={styles.card}>
      {item.status === 'done' && <ThemedText type="default">{item.transcript ?? ''}</ThemedText>}
      <StatusLine item={item} now={now} />
    </Card>
  );
}

function SituationRow({
  item,
  now,
  onDelete,
}: {
  item: LocalSituation;
  now: number;
  onDelete: (id: number) => void;
}) {
  const swipeRef = useRef<SwipeableMethods>(null);
  const colors = useTheme();

  const confirmDelete = useCallback(() => {
    if (item.id == null) {
      return;
    }
    const id = item.id;
    confirmAction({
      title: 'Usuń sytuację',
      message: 'Czy na pewno chcesz usunąć tę sytuację?',
      confirmLabel: 'Usuń',
      onConfirm: () => onDelete(id),
      onCancel: () => swipeRef.current?.close(),
    });
  }, [item.id, onDelete]);

  // Wiersz „w locie" (bez serwerowego `id`) nie jest usuwalny — renderuj bez swipe.
  if (item.id == null) {
    return <SituationCard item={item} now={now} />;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={Spacing.five}
      renderRightActions={() => (
        <Pressable
          style={[styles.deleteAction, { backgroundColor: colors.danger }]}
          onPress={confirmDelete}>
          <ThemedText type="smallBold" style={styles.deleteLabel}>
            Usuń
          </ThemedText>
        </Pressable>
      )}>
      <SituationCard item={item} now={now} />
    </ReanimatedSwipeable>
  );
}

export function SituationList({
  situations,
  now,
  onDelete,
}: {
  situations: LocalSituation[];
  /** Chwila ostatniego odświeżenia — do oceny, czy generowanie fiszek jest jeszcze żywe. */
  now: number;
  onDelete: (id: number) => void;
}) {
  if (situations.length === 0) {
    return (
      <View style={styles.empty}>
        <ThemedText type="default" style={styles.emptyText}>
          Jeszcze nic dzisiaj
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
          Nagraj pierwszą sytuację — wieczorem znajdziesz z niej fiszki.
        </ThemedText>
      </View>
    );
  }

  return (
    <FlatList
      data={situations}
      keyExtractor={(item) => item.tempId ?? String(item.id)}
      renderItem={({ item }) => <SituationRow item={item} now={now} onDelete={onDelete} />}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  card: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
  },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    marginLeft: Spacing.two,
    borderRadius: Radius.card,
  },
  deleteLabel: {
    color: '#ffffff',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    gap: Spacing.one,
  },
  emptyText: {
    textAlign: 'center',
  },
});

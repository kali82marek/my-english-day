/**
 * Lista sytuacji dnia (S-01) + karta pojedynczej sytuacji.
 *
 * Renderuje stany cyklu transkrypcji:
 *  - `pending` → wskaźnik „Transkrybuję…",
 *  - `done`    → transkrypt + godzina nagrania,
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
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { confirmAction } from '@/lib/alert';
import type { Situation } from '@/lib/api';

/**
 * Sytuacja w stanie lokalnym ekranu. Wiersz optymistyczny niesie kliencki `tempId`
 * i nie ma jeszcze serwerowego `id` (`null`); realny wiersz z odpowiedzi 201 go
 * zastępuje (patrz reguła scalania w `src/app/(app)/index.tsx`).
 */
export type LocalSituation = Omit<Situation, 'id'> & { id: number | null; tempId?: string };

const DELETE_COLOR = '#E5484D';

/** Godzina `HH:mm` z `created_at` (SQLite `datetime('now')`, UTC). */
function formatTime(createdAt: string): string {
  const date = new Date(`${createdAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function SituationCard({ item }: { item: LocalSituation }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {item.status === 'pending' && (
        <ThemedText type="small" themeColor="textSecondary">
          Transkrybuję…
        </ThemedText>
      )}

      {item.status === 'done' && (
        <>
          <ThemedText type="default">{item.transcript ?? ''}</ThemedText>
          <View style={styles.metaRow}>
            <ThemedText type="small" themeColor="textSecondary">
              {formatTime(item.created_at)}
            </ThemedText>
            {item.flashcards_status === 'pending' && (
              <ThemedText type="small" themeColor="textSecondary">
                · Generuję fiszki…
              </ThemedText>
            )}
          </View>
        </>
      )}

      {item.status === 'failed' && (
        <ThemedText type="small" style={styles.failedText}>
          Nie udało się — nagraj ponownie.
        </ThemedText>
      )}
    </ThemedView>
  );
}

function SituationRow({
  item,
  onDelete,
}: {
  item: LocalSituation;
  onDelete: (id: number) => void;
}) {
  const swipeRef = useRef<SwipeableMethods>(null);

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
    return <SituationCard item={item} />;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={Spacing.five}
      renderRightActions={() => (
        <Pressable style={styles.deleteAction} onPress={confirmDelete}>
          <ThemedText type="smallBold" style={styles.deleteLabel}>
            Usuń
          </ThemedText>
        </Pressable>
      )}>
      <SituationCard item={item} />
    </ReanimatedSwipeable>
  );
}

export function SituationList({
  situations,
  onDelete,
}: {
  situations: LocalSituation[];
  onDelete: (id: number) => void;
}) {
  if (situations.length === 0) {
    return (
      <View style={styles.empty}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
          Brak sytuacji dnia — nagraj pierwszą.
        </ThemedText>
      </View>
    );
  }

  return (
    <FlatList
      data={situations}
      keyExtractor={(item) => item.tempId ?? String(item.id)}
      renderItem={({ item }) => <SituationRow item={item} onDelete={onDelete} />}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  failedText: {
    color: DELETE_COLOR,
  },
  deleteAction: {
    backgroundColor: DELETE_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    marginLeft: Spacing.two,
    borderRadius: Spacing.three,
  },
  deleteLabel: {
    color: '#ffffff',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
  },
  emptyText: {
    textAlign: 'center',
  },
});

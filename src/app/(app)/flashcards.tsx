/**
 * Ekran przeglądu fiszek (S-02) — domyka pętlę: propozycja → akceptuj/odrzuć.
 *
 * Pokazuje jedną propozycję naraz (`queue[0]`). Akceptacja przenosi fiszkę do bazy
 * nauki (`status='accepted'`), odrzucenie kasuje wiersz — obie akcje optymistyczne,
 * z cofnięciem przy błędzie sieci (karta wraca na początek kolejki).
 *
 * Dopóki serwer generuje fiszki (`generatingCount > 0`) krótki polling odświeża
 * propozycje. Twardy limit (POLL_LIMIT_MS) chroni przed osieroconym generowaniem:
 * po tym czasie bez postępu polling staje i pokazujemy stan informacyjny. „Postęp"
 * (zmiana liczby propozycji lub `generatingCount`) resetuje licznik limitu.
 *
 * Wylogowanie żyje na ekranie Home (S-01) — tu świadomie go nie dublujemy.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScreenHeader } from '@/components/card';
import { FlashcardCard } from '@/components/flashcard-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { flashcardsApi, type Flashcard } from '@/lib/api';

// Co ile odpytujemy serwer, dopóki trwa generowanie.
const POLL_MS = 2500;
// Twardy limit: po tym czasie bez postępu uznajemy generowanie za osierocone
// (ubity/przekroczony `waitUntil`, `flashcards_status='failed'`) i przerywamy polling.
const POLL_LIMIT_MS = 90000;

export default function FlashcardsScreen() {
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [generatingCount, setGeneratingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pollExpired, setPollExpired] = useState(false);

  // Fiszki, o których użytkownik już zdecydował (optymistycznie) — chroni przed
  // ich powrotem do kolejki, zanim serwer przetworzy accept/reject.
  const decidedRef = useRef<Set<number>>(new Set());
  // Id-ki propozycji już widziane: pojawienie się NOWEJ = realny postęp generowania
  // (resetuje twardy limit). Konsumpcja kolejki (accept/reject) postępem NIE jest —
  // inaczej osierocony `pending` nigdy by nie wygasł.
  const seenIdsRef = useRef<Set<number>>(new Set());
  const prevGeneratingRef = useRef<number>(-1);
  const pollStartRef = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const { proposals, generatingCount: generating } = await flashcardsApi.listProposals();
      const next = proposals.filter((p) => !decidedRef.current.has(p.id));
      setQueue(next);
      setGeneratingCount(generating);

      // Postęp = pojawiła się nowa propozycja albo zmienił się licznik generowań.
      let newArrival = false;
      for (const p of next) {
        if (!seenIdsRef.current.has(p.id)) {
          seenIdsRef.current.add(p.id);
          newArrival = true;
        }
      }
      const generatingChanged = generating !== prevGeneratingRef.current;
      prevGeneratingRef.current = generating;
      if (generating > 0 && (newArrival || generatingChanged)) {
        pollStartRef.current = Date.now();
        setPollExpired(false);
      }
    } catch {
      // Cicho — kolejny tick / focus spróbuje ponownie; brak sieci nie wywala ekranu.
    } finally {
      setLoading(false);
    }
  }, []);

  // Pobranie na wejściu i przy każdym powrocie na ekran.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Polling aktywny tylko w trakcie generowania i przed wyczerpaniem limitu.
  useEffect(() => {
    if (generatingCount === 0 || pollExpired) {
      return;
    }
    const interval = setInterval(() => {
      if (Date.now() - pollStartRef.current > POLL_LIMIT_MS) {
        setPollExpired(true);
        return;
      }
      void load();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [generatingCount, pollExpired, load]);

  // Decyzja: optymistycznie zdejmij z kolejki; przy błędzie sieci przywróć kartę.
  const decide = useCallback((card: Flashcard, action: 'accept' | 'reject') => {
    decidedRef.current.add(card.id);
    setQueue((prev) => prev.filter((c) => c.id !== card.id));

    const call = action === 'accept' ? flashcardsApi.accept(card.id) : flashcardsApi.reject(card.id);
    call.catch(() => {
      decidedRef.current.delete(card.id);
      setQueue((prev) => (prev.some((c) => c.id === card.id) ? prev : [card, ...prev]));
    });
  }, []);

  const current = queue[0];
  const colors = useTheme();
  const caption =
    queue.length > 0
      ? `Do przejrzenia: ${queue.length}`
      : generatingCount > 0 && !pollExpired
        ? 'Generuję…'
        : 'Propozycje z dzisiejszych sytuacji';

  return (
    <Screen>
      <ScreenHeader title="Fiszki" caption={caption} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.tint} />
        </View>
      ) : current ? (
        <FlashcardCard
          key={current.id}
          card={current}
          onAccept={() => decide(current, 'accept')}
          onReject={() => decide(current, 'reject')}
        />
      ) : pollExpired ? (
        <View style={styles.centered}>
          <ThemedText type="default" style={styles.centeredText}>
            Coś poszło nie tak
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centeredText}>
            Część fiszek mogła się nie wygenerować. Zajrzyj ponownie później.
          </ThemedText>
        </View>
      ) : generatingCount > 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.tint} style={styles.spinner} />
          <ThemedText type="default" style={styles.centeredText}>
            Generuję fiszki…
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centeredText}>
            To zwykle trwa kilkanaście sekund.
          </ThemedText>
        </View>
      ) : (
        <View style={styles.centered}>
          <ThemedText type="default" style={styles.centeredText}>
            Wszystko przejrzane
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centeredText}>
            Nagraj nową sytuację, a pojawią się tu kolejne propozycje.
          </ThemedText>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    gap: Spacing.one,
  },
  centeredText: {
    textAlign: 'center',
  },
  spinner: {
    marginBottom: Spacing.two,
  },
});

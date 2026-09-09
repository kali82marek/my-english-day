import type { Flashcard } from '@/lib/api';

/**
 * Etykiety typów fiszek po polsku — `type` z API jest po angielsku (PRD Business Logic:
 * trzy zamknięte typy). Jedno źródło dla karty przeglądu (S-02) i karty powtórki (S-05).
 */
export const TYPE_LABELS: Record<Flashcard['type'], string> = {
  word: 'słówko',
  phrase: 'zwrot',
  sentence: 'zdanie',
};

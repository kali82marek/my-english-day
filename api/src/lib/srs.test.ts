import { describe, expect, it } from 'vitest';
import { GRADES, isGrade, scheduleReview, type ReviewState } from './srs';

// ---------------------------------------------------------------------------
// Wyrocznie (PRD FR-012 `context/foundation/prd.md` + plan S-05
// `context/changes/srs-review-session/plan.md`, Faza 1) — z produktu i planu,
// NIGDY z implementacji. Zmiana liczb w `srs.ts` MA zaczerwienić test: to sygnał do
// świadomej zmiany wyroczni, nie do „dopasowania" asercji.
// ---------------------------------------------------------------------------

// PRD FR-012: dokładnie trzy przyciski oceny — Nie umiem / Prawie / Umiem.
const GRADES_ORACLE = ['again', 'hard', 'good'];

// Plan S-05: „Umiem" na nowej fiszce → 1 dzień, drugi „Umiem" → 3 dni, dalej ×ease.
const FIRST_GOOD_DAYS = 1;
const SECOND_GOOD_DAYS = 3;
// Plan S-05: ease nigdy poniżej 1.3 (podłoga SM-2).
const EASE_FLOOR = 1.3;

const DAY_MS = 86_400_000;
const NOW = new Date('2026-09-09T12:00:00Z');

/** Stan „nowa fiszka" = DEFAULT kolumn z migracji 0005. */
function freshState(): ReviewState {
  return { interval_days: 0, ease: 2.5, repetitions: 0 };
}

describe('FR-012: trzy oceny → odstępy powtórek', () => {
  // Deliberate-breaks (każdy osobno → czerwony; kod przywrócony, suite zielone):
  //   (a) `again` ustawia `due_at = now + 1 dzień` → „wraca od razu" czerwone;
  //   (b) `again` nie zeruje `repetitions` → czerwone;
  //   (c) usuń podłogę `Math.max(1.3, …)` → wiersz „nie poniżej 1.3" czerwony.
  it('R1.1 „Nie umiem" z dowolnego stanu → fiszka wraca od razu (due_at = now), seria i odstęp zerowane, ease spada, ale nie poniżej 1.3', () => {
    const states: ReviewState[] = [
      freshState(),
      { interval_days: 3, ease: 2.5, repetitions: 2 },
      { interval_days: 45, ease: 1.35, repetitions: 7 },
      { interval_days: 10, ease: 1.3, repetitions: 4 },
    ];

    for (const state of states) {
      const next = scheduleReview(state, 'again', NOW);

      expect(next.due_at.getTime()).toBe(NOW.getTime());
      expect(next.repetitions).toBe(0);
      expect(next.interval_days).toBe(0);
      expect(next.ease).toBeLessThanOrEqual(state.ease);
      expect(next.ease).toBeGreaterThanOrEqual(EASE_FLOOR);
    }

    // Spadek jest realny (nie „bez zmian") dla fiszki z zapasem ponad podłogę.
    expect(scheduleReview(freshState(), 'again', NOW).ease).toBeLessThan(2.5);
  });

  // Deliberate-breaks: drugi krok `good` = 1 zamiast 3 → czerwony;
  // trzeci krok bez mnożnika (`interval_before`) → „> 3" i „ściśle rosnące" czerwone.
  it('R1.2 seria „Umiem" na nowej fiszce: 1 dzień → 3 dni → więcej niż 3; pięć kroków daje ściśle rosnące odstępy', () => {
    const first = scheduleReview(freshState(), 'good', NOW);
    expect(first.interval_days).toBe(FIRST_GOOD_DAYS);
    expect(first.due_at.getTime()).toBe(NOW.getTime() + FIRST_GOOD_DAYS * DAY_MS);
    expect(first.repetitions).toBe(1);

    const second = scheduleReview(first, 'good', first.due_at);
    expect(second.interval_days).toBe(SECOND_GOOD_DAYS);
    expect(second.due_at.getTime()).toBe(first.due_at.getTime() + SECOND_GOOD_DAYS * DAY_MS);
    expect(second.repetitions).toBe(2);

    const third = scheduleReview(second, 'good', second.due_at);
    expect(third.interval_days).toBeGreaterThan(SECOND_GOOD_DAYS);
    // „Umiem" nie karze: ease bez zmian przez całą serię.
    expect(third.ease).toBe(2.5);

    let state: ReviewState & { due_at: Date } = { ...freshState(), due_at: NOW };
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      state = scheduleReview(state, 'good', state.due_at);
      intervals.push(state.interval_days);
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
    expect(state.repetitions).toBe(5);
  });

  // Deliberate-breaks: `hard` liczony jak `good` → „wcześniej niż good" czerwone;
  // `hard` bez `max(interval + 1, …)` przy 10 dniach → „> 10" czerwone;
  // `hard` bez kary ease → „niższe ease" czerwone.
  it('R1.3 „Prawie" z tego samego stanu odkłada krócej niż „Umiem" i obniża ease; na nowej fiszce 1 dzień; po 10 dniach więcej niż 10 (nigdy nie cofa)', () => {
    const state: ReviewState = { interval_days: 3, ease: 2.5, repetitions: 2 };
    const hard = scheduleReview(state, 'hard', NOW);
    const good = scheduleReview(state, 'good', NOW);

    expect(hard.due_at.getTime()).toBeLessThan(good.due_at.getTime());
    expect(hard.due_at.getTime()).toBeGreaterThan(NOW.getTime());
    expect(hard.ease).toBeLessThan(good.ease);
    expect(hard.ease).toBeGreaterThanOrEqual(EASE_FLOOR);
    // „Prawie" to wciąż poprawna odpowiedź — seria rośnie, nie zeruje się.
    expect(hard.repetitions).toBe(state.repetitions + 1);

    const hardFresh = scheduleReview(freshState(), 'hard', NOW);
    expect(hardFresh.interval_days).toBe(FIRST_GOOD_DAYS);
    expect(hardFresh.due_at.getTime()).toBe(NOW.getTime() + FIRST_GOOD_DAYS * DAY_MS);

    const hardTen = scheduleReview({ interval_days: 10, ease: 2.5, repetitions: 3 }, 'hard', NOW);
    expect(hardTen.interval_days).toBeGreaterThan(10);
    expect(hardTen.due_at.getTime()).toBeGreaterThan(NOW.getTime() + 10 * DAY_MS);
  });

  // Deliberate-breaks: `scheduleReview` przypisuje do `state.ease` → „brak mutacji" czerwone;
  // `isGrade` sprawdza tylko `typeof === 'string'` → wiersze `'easy'`/`''` czerwone.
  it('R1.4 wejście nie jest mutowane; `isGrade` przyjmuje dokładnie trójkę z PRD i odrzuca resztę', () => {
    const state: ReviewState = { interval_days: 3, ease: 2.5, repetitions: 2 };
    const snapshot = { ...state };
    const now = new Date(NOW.getTime());
    for (const grade of GRADES) {
      scheduleReview(state, grade, now);
    }
    expect(state).toEqual(snapshot);
    expect(now.getTime()).toBe(NOW.getTime());

    expect([...GRADES].sort()).toEqual([...GRADES_ORACLE].sort());
    for (const grade of GRADES_ORACLE) {
      expect(isGrade(grade)).toBe(true);
    }
    for (const bad of ['easy', '', 1, undefined, null, 'GOOD', ['good']]) {
      expect(isGrade(bad)).toBe(false);
    }
  });
});

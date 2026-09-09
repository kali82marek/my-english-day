/**
 * Filtr duplikatów fiszek (slice S-04, FR-008) — czysta logika, bez D1 i bez I/O.
 *
 * PRD: „duplikat = to samo słowo/zwrot; synonimy i warianty to różne fiszki i zostają".
 * Tożsamością fiszki jest angielska strona (`front_en` — to, czego użytkownik się uczy),
 * porównywana po normalizacji, która wyrównuje WYŁĄCZNIE szum zapisu: wielkość liter,
 * białe znaki i interpunkcję brzegową (`"Invoice"`, `" invoice "`, `"invoice."` to jedna
 * fiszka). Nic więcej — żadnego dopasowania rozmytego, form gramatycznych
 * (`invoices` ≠ `invoice`), interpunkcji wewnętrznej ani diakrytyków. Zbyt agresywny
 * filtr zjadłby wartościowe warianty, przed czym PRD wprost ostrzega.
 *
 * Miejsce użycia: warstwa zapisu w tle (`routes/situations.ts`, `generateAndStoreFlashcards`,
 * Faza 2 S-04) — między odpowiedzią generatora a atomowym `DB.batch`. Generator
 * (`lib/flashcards.ts`) jest tym filtrem nietknięty: „zero kart po deduplikacji" to
 * legalny wynik warstwy zapisu, a nie awaria generowania.
 */

// Interpunkcja brzegowa: ASCII + cudzysłowy typograficzne. Klasa, nie lista — tylko
// początek i koniec, wnętrze frazy zostaje (`I'm`, `don't`, `Mr. Smith`).
const EDGE_PUNCTUATION = '.,!?;:"\'„“”‘’«»';
const EDGE_RE = new RegExp(
  `^[${EDGE_PUNCTUATION}]+|[${EDGE_PUNCTUATION}]+$`,
  'g',
);

/**
 * Klucz porównania: trim → lowercase → ciągi białych znaków do jednej spacji →
 * zdjęcie interpunkcji brzegowej (i ponowny trim, bo po zdjęciu może zostać spacja).
 */
export function normalizeFront(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(EDGE_RE, '')
    .trim();
}

/**
 * Zwraca karty, których znormalizowany `front_en` nie występuje ani wśród
 * `existingFronts` (baza użytkownika), ani wcześniej w tej samej partii — pierwsze
 * wystąpienie wygrywa (kolejność tablicy = kolejność zapisu). Zachowuje kolejność
 * i tożsamość obiektów; nie mutuje wejścia.
 */
export function filterDuplicates<T extends { front_en: string }>(
  cards: readonly T[],
  existingFronts: Iterable<string>,
): T[] {
  const seen = new Set<string>();
  for (const front of existingFronts) {
    seen.add(normalizeFront(front));
  }

  const unique: T[] = [];
  for (const card of cards) {
    const key = normalizeFront(card.front_en);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(card);
  }
  return unique;
}

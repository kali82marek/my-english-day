import { describe, it, expect } from 'vitest';
import { filterDuplicates, normalizeFront } from './dedup';

// ---------------------------------------------------------------------------
// Wyrocznia z PRD (`context/foundation/prd.md`, FR-008): „System sprawdza bazę fiszek
// użytkownika i nie tworzy duplikatów. Duplikat = to samo słowo/zwrot; synonimy
// i warianty to różne fiszki i zostają." Oczekiwania poniżej pochodzą z tego zdania
// i z Guardrails PRD, NIGDY z implementacji — zmiana definicji duplikatu w kodzie
// MA zaczerwienić ten plik.
// ---------------------------------------------------------------------------

type Card = { type: 'word' | 'phrase' | 'sentence'; front_en: string; is_variant: boolean };

function card(front_en: string, type: Card['type'] = 'word', is_variant = false): Card {
  return { type, front_en, is_variant };
}

describe('FR-008: duplikat = dokładnie to samo słowo/zwrot', () => {
  // Deliberate-breaks (każdy osobno → czerwony, potem kod przywrócony):
  // (a) usuń `.toLowerCase()` z `normalizeFront` → `Invoice` przechodzi;
  // (b) porównuj `front_en` surowo (bez `normalizeFront`) → wszystkie cztery przechodzą;
  // (c) usuń zdejmowanie interpunkcji brzegowej → `invoice.` i `…that?` przechodzą.
  it('D1.1 identyczne słowo/zwrot w bazie → odsiane, także gdy różni się tylko wielkością liter, białymi znakami lub interpunkcją brzegową', () => {
    const existing = ['invoice', 'could you repeat that'];
    const candidates = [
      card('invoice'),
      card('Invoice'),
      card(' invoice '),
      card('invoice.'),
      card('Could you repeat that?', 'sentence'),
      card('could   you repeat\tthat', 'sentence'),
    ];

    expect(filterDuplicates(candidates, existing)).toEqual([]);

    // Klucz porównania jest ten sam dla każdej pisowni tej samej frazy.
    expect(normalizeFront('Invoice')).toBe(normalizeFront('invoice'));
    expect(normalizeFront(' invoice ')).toBe(normalizeFront('invoice'));
    expect(normalizeFront('"invoice."')).toBe(normalizeFront('invoice'));
    expect(normalizeFront('Could you repeat that?')).toBe(normalizeFront('could you repeat that'));
  });

  // PRD: synonimy i warianty ZOSTAJĄ; brak dopasowania rozmytego (formy gramatyczne
  // to osobne fiszki — świadoma decyzja planu S-04, nie luka).
  // Deliberate-break: dopasowanie po prefiksie/`includes` zamiast równości klucza →
  // `invoices` i `ask for an invoice` odsiane → czerwony.
  it('D1.2 synonim, wariant i forma gramatyczna nie są duplikatem — zostają', () => {
    const existing = ['invoice', 'ask for a refund'];
    const receipt = card('receipt');
    const askForInvoice = card('ask for an invoice', 'phrase', true);
    const invoices = card('invoices');
    const dontInvoice = card("don't invoice me", 'sentence');

    const result = filterDuplicates([receipt, askForInvoice, invoices, dontInvoice], existing);

    expect(result).toEqual([receipt, askForInvoice, invoices, dontInvoice]);
    // Jawnie: forma gramatyczna nie jest zwijana do formy podstawowej.
    expect(normalizeFront('invoices')).not.toBe(normalizeFront('invoice'));
    // Interpunkcja WEWNĄTRZ frazy nie jest ruszana (tylko brzegowa).
    expect(normalizeFront("don't invoice me")).toBe("don't invoice me");
  });

  // Model potrafi zwrócić tę samą frazę jako fiszkę bazową i wariant (inny `type`,
  // inna flaga) — pierwsza w tablicy wygrywa, bo kolejność tablicy = kolejność zapisu.
  // Deliberate-break: dedup po parze (`front_en`, `type`) zamiast po samym froncie →
  // obie karty `invoice` przechodzą → czerwony.
  it('D1.3 powtórka wewnątrz partii → zostaje pierwsze wystąpienie (ta sama instancja), kolejność reszty zachowana', () => {
    const first = card('invoice', 'word', false);
    const receipt = card('receipt');
    const second = card('Invoice', 'phrase', true);
    const statement = card('bank statement', 'phrase');

    const result = filterDuplicates([first, receipt, second, statement], []);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(first);
    expect(result).toEqual([first, receipt, statement]);
  });

  // Deliberate-break: `filterDuplicates` sortuje/mutuje wejście (`cards.splice`) → czerwony.
  it('D1.4 pusta baza → wszystkie unikalne karty przechodzą; wejście nie jest mutowane', () => {
    const input = [card('invoice'), card('receipt'), card('bank statement', 'phrase')];
    const snapshot = input.map((c) => ({ ...c }));

    const result = filterDuplicates(input, new Set<string>());

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(input).toEqual(snapshot);
  });
});

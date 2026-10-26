// Kalenderdatums als "JJJJ-MM-DD". Pure functies, geen afhankelijkheden.

/** Hoe ver vooruit online geboekt kan worden, in dagen (gelijk aan DAGEN_VOORUIT in de client). */
export const BOEKINGSHORIZON_DAGEN = 14;

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Of een tekst een echte kalenderdag is. De regex alleen laat "2026-11-31" of
 * "2026-02-30" door; de round-trip via Date.UTC vangt dat af: de componenten
 * moeten na constructie gelijk blijven.
 */
export function geldigeDatum(datum: string): boolean {
  if (!DATUM.test(datum)) return false;
  const [j, m, d] = datum.split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d, 12));
  return dt.getUTCFullYear() === j && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Een datum plus een aantal dagen, zonder zomertijdverrassingen (rekent op 12:00 UTC). */
export function datumPlus(datum: string, dagen: number): string {
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + dagen, 12)).toISOString().slice(0, 10);
}

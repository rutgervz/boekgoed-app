// Kloktijden als minuten sinds middernacht. Pure functies, geen afhankelijkheden.

/** Zet een kloktijd "HH:MM" om naar minuten sinds middernacht. */
export function toMin(t: string): number {
  const [uren, minuten] = t.split(':');
  return Number(uren) * 60 + Number(minuten);
}

/**
 * Zet minuten om naar een kloktijd "HH:MM" (24 uur).
 * Veilig voor negatieve waarden en waarden boven 1440: de uitkomst
 * wordt genormaliseerd naar de dag (toTijd(-5) is "23:55",
 * toTijd(1445) is "00:05").
 */
export function toTijd(m: number): string {
  const genormaliseerd = ((Math.round(m) % 1440) + 1440) % 1440;
  const uren = Math.floor(genormaliseerd / 60);
  const minuten = genormaliseerd % 60;
  return `${String(uren).padStart(2, '0')}:${String(minuten).padStart(2, '0')}`;
}

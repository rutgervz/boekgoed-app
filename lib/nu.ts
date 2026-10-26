// Nederlandse kloktijd (Europe/Amsterdam), onafhankelijk van de tijdzone van de server.

/**
 * De huidige datum (YYYY-MM-DD) en het aantal minuten sinds middernacht,
 * in Nederlandse kloktijd (Europe/Amsterdam, met zomer- en wintertijd).
 */
export function nuAmsterdam(): { datum: string; minuten: number } {
  const delen = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const deel = (soort: Intl.DateTimeFormatPartTypes): string =>
    delen.find((d) => d.type === soort)?.value ?? '';
  // Sommige omgevingen geven "24" om middernacht; modulo 24 normaliseert dat.
  const uur = Number(deel('hour')) % 24;
  return {
    datum: `${deel('year')}-${deel('month')}-${deel('day')}`,
    minuten: uur * 60 + Number(deel('minute')),
  };
}

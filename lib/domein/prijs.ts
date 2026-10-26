// Prijsberekening (domeinregel 5). Alle bedragen in centen. Pure functies.

import type { Prijs, PrijsRegel, RitInvoer, Tarieven } from './typen';

/** Formatteert centen als euro's voor leesbare prijsregels, bijvoorbeeld "€ 6,50". */
function euro(cent: number): string {
  const teken = cent < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cent));
  return `${teken}€ ${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Het aantal betaalde bagagestukken: het totaal boven de vrijstelling van
 * gratis_bagage_per_persoon stuks per persoon. Nooit negatief.
 */
export function extraBagageBoven(bagageTotaal: number, personen: number, tarieven: Tarieven): number {
  const gratis = tarieven.gratis_bagage_per_persoon * Math.max(0, personen);
  return Math.max(0, bagageTotaal - gratis);
}

/**
 * Berekent de prijs van een rit volgens domeinregel 5.
 * invoer.extraBagage is het aantal stuks boven de gratis bagage
 * (reken dat vooraf uit met extraBagageBoven). Retour verdubbelt het geheel;
 * de som van de regels is altijd gelijk aan totaalCent.
 */
export function berekenPrijs(invoer: RitInvoer, tarieven: Tarieven): Prijs {
  const regels: PrijsRegel[] = [];
  let totaalCent = 0;

  if (invoer.modus === 'personen') {
    const personen = Math.max(1, invoer.personen);
    regels.push({ label: 'Eerste persoon', bedragCent: tarieven.eerste_persoon });
    totaalCent += tarieven.eerste_persoon;

    const extraPersonen = personen - 1;
    if (extraPersonen > 0) {
      const bedrag = extraPersonen * tarieven.extra_persoon;
      regels.push({
        label: `${extraPersonen} extra ${extraPersonen === 1 ? 'persoon' : 'personen'} × ${euro(tarieven.extra_persoon)}`,
        bedragCent: bedrag,
      });
      totaalCent += bedrag;
    }

    if (invoer.huisdier) {
      regels.push({ label: 'Huisdier', bedragCent: tarieven.huisdier });
      totaalCent += tarieven.huisdier;
    }

    const extraBagage = Math.max(0, invoer.extraBagage);
    if (extraBagage > 0) {
      const bedrag = extraBagage * tarieven.extra_bagagestuk;
      regels.push({
        label: `${extraBagage} extra ${extraBagage === 1 ? 'bagagestuk' : 'bagagestukken'} × ${euro(tarieven.extra_bagagestuk)}`,
        bedragCent: bedrag,
      });
      totaalCent += bedrag;
    }

    if (invoer.aanhanger) {
      regels.push({ label: 'Aanhanger', bedragCent: tarieven.aanhanger });
      totaalCent += tarieven.aanhanger;
    }
  } else if (invoer.modus === 'bagage') {
    const stuks = Math.max(1, invoer.bagageStuks);
    const bedrag = stuks * tarieven.los_bagagestuk;
    regels.push({
      label: `${stuks} ${stuks === 1 ? 'bagagestuk' : 'bagagestukken'} × ${euro(tarieven.los_bagagestuk)}`,
      bedragCent: bedrag,
    });
    totaalCent += bedrag;
  } else {
    regels.push({ label: 'Aanhanger per rit', bedragCent: tarieven.aanhanger });
    totaalCent += tarieven.aanhanger;
  }

  if (invoer.retour) {
    regels.push({ label: 'Retour (×2)', bedragCent: totaalCent });
    totaalCent *= 2;
  }

  return { totaalCent, regels };
}

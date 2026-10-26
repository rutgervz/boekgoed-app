// Beschikbaarheid: capaciteit per glijdend venster, sluitingen, openingstijden,
// kwartierslots en de boekbaarheid van vaarten. Pure functies, geen I/O.
//
// Domeinregels (bindend, zie de opdracht en DEMO-CONTEXT.md):
// 1. Capaciteit per glijdend venster: vol is vol.
// 2. volgendeVrijeTijd zoekt in stappen van 5 minuten, maximaal 60 pogingen.
// 3. Dag = kwartierslots van opening.van tot en met opening.tot; dicht wint van vol.
// 4. Naar de boot online boekbaar tot X minuten voor vertrek; eerste vaart van de
//    dag niet online; vanaf de boot altijd (binnen opening en capaciteit).

import type {
  Boekregels,
  Capaciteit,
  Instellingen,
  NieuweLading,
  Opening,
  RitLicht,
  Slot,
  SlotStatus,
  Sluiting,
  Vaart,
} from './typen';
import { toMin as naarMinuten, toTijd as naarTijd } from './tijd';

const STAP_MIN = 5;
const MAX_POGINGEN = 60;
const SLOT_MIN = 15;

/** Statussen die niet meetellen voor de bezetting. */
const NIET_MEETELLEND = new Set(['afgerond', 'geannuleerd']);

/**
 * Bezetting binnen het glijdende venster rond een tijd: de som van personen en
 * het aantal aanhangers van alle ritten met |verschil| < vensterMin. Ritten
 * zonder tijd ("wij bellen voor de terugtijd") en afgeronde of geannuleerde
 * ritten tellen niet mee.
 */
export function bezettingIn(
  ritten: RitLicht[],
  tijd: string,
  vensterMin: number
): { personen: number; aanhangers: number } {
  const t = naarMinuten(tijd);
  let personen = 0;
  let aanhangers = 0;
  for (const rit of ritten) {
    if (rit.tijd === null) continue;
    if (NIET_MEETELLEND.has(rit.status)) continue;
    if (Math.abs(naarMinuten(rit.tijd) - t) >= vensterMin) continue;
    personen += rit.personen;
    if (rit.aanhanger) aanhangers += 1;
  }
  return { personen, aanhangers };
}

/**
 * Controleert of een nieuwe lading op een tijd past. Levert null wanneer het
 * past, anders de bezetting met de overschrijdingen. Vol is vol: de som mag
 * niet boven capaciteit.personen respectievelijk capaciteit.aanhangers komen.
 */
export function vindConflict(
  ritten: RitLicht[],
  tijd: string,
  nieuw: NieuweLading,
  capaciteit: Capaciteit
): { personen: number; aanhangers: number; teVeelPersonen: boolean; teVeelAanhangers: boolean } | null {
  const bezetting = bezettingIn(ritten, tijd, capaciteit.venster_min);
  const teVeelPersonen = bezetting.personen + nieuw.personen > capaciteit.personen;
  const teVeelAanhangers =
    bezetting.aanhangers + (nieuw.aanhanger ? 1 : 0) > capaciteit.aanhangers;
  if (!teVeelPersonen && !teVeelAanhangers) return null;
  return {
    personen: bezetting.personen,
    aanhangers: bezetting.aanhangers,
    teVeelPersonen,
    teVeelAanhangers,
  };
}

/** De sluiting waar een tijd in valt (van <= t < tot), anders null. */
export function inSluiting(sluitingen: Sluiting[], tijd: string): Sluiting | null {
  const t = naarMinuten(tijd);
  for (const sluiting of sluitingen) {
    if (t >= naarMinuten(sluiting.van) && t < naarMinuten(sluiting.tot)) return sluiting;
  }
  return null;
}

/** Of een tijd binnen de openingstijden valt (van en tot inclusief). */
export function binnenOpening(opening: Opening, tijd: string): boolean {
  const t = naarMinuten(tijd);
  return t >= naarMinuten(opening.van) && t <= naarMinuten(opening.tot);
}

/**
 * De eerste tijd vanaf vanafTijd zonder capaciteitsconflict, binnen de opening
 * en niet in een sluiting. Zoekt in stappen van 5 minuten, maximaal 60
 * pogingen; anders null.
 */
export function volgendeVrijeTijd(
  ritten: RitLicht[],
  sluitingen: Sluiting[],
  vanafTijd: string,
  nieuw: NieuweLading,
  capaciteit: Capaciteit,
  opening: Opening
): string | null {
  let t = naarMinuten(vanafTijd);
  for (let poging = 0; poging < MAX_POGINGEN; poging++) {
    const kandidaat = naarTijd(t);
    if (
      binnenOpening(opening, kandidaat) &&
      inSluiting(sluitingen, kandidaat) === null &&
      vindConflict(ritten, kandidaat, nieuw, capaciteit) === null
    ) {
      return kandidaat;
    }
    t += STAP_MIN;
  }
  return null;
}

/**
 * Kwartierslots van opening.van tot en met opening.tot. Een slot is dicht
 * binnen een sluiting of, op de dag van vandaag, wanneer het tijdstip al
 * voorbij is (verstrekenTotMin); anders vol bij een capaciteitsconflict;
 * anders open. Dicht wint van vol.
 */
export function dagSlots(opts: {
  ritten: RitLicht[];
  sluitingen: Sluiting[];
  instellingen: Instellingen;
  nieuw: NieuweLading;
  verstrekenTotMin?: number;
}): Slot[] {
  const { ritten, sluitingen, instellingen, nieuw, verstrekenTotMin } = opts;
  const { opening, capaciteit } = instellingen;
  const slots: Slot[] = [];
  for (let m = naarMinuten(opening.van); m <= naarMinuten(opening.tot); m += SLOT_MIN) {
    const tijd = naarTijd(m);
    const sluiting = inSluiting(sluitingen, tijd);
    const verstreken = verstrekenTotMin !== undefined && m < verstrekenTotMin;
    let status: SlotStatus;
    let reden: string | undefined;
    if (sluiting !== null || verstreken) {
      status = 'dicht';
      if (sluiting !== null && sluiting.reden !== null) reden = sluiting.reden;
    } else if (vindConflict(ritten, tijd, nieuw, capaciteit) !== null) {
      status = 'vol';
    } else {
      status = 'open';
    }
    slots.push(reden === undefined ? { tijd, status } : { tijd, status, reden });
  }
  return slots;
}

/**
 * Of een vaart online boekbaar is (domeinregel 4). De eerste vaart van de dag
 * in de betreffende richting is niet online boekbaar zolang
 * regels.eerste_boot_online uit staat, in beide richtingen. Vertrek-vaarten
 * zijn boekbaar tot naar_boot_online_tot_min_voor_vertrek minuten voor vertrek
 * wanneer nuMin (Nederlandse kloktijd van nu, in minuten) bekend is; voor een
 * andere dag is nuMin null en vervalt die controle. Een vaart van vandaag die
 * al geweest is, is niet meer boekbaar (ook een aankomst), en met een
 * meegegeven opening is een vaart buiten de openingstijden niet boekbaar;
 * zo blijven dagbeeld en boekingsroute consistent. Capaciteit wordt elders
 * bewaakt.
 */
export function vaartBoekbaar(
  vaart: Vaart,
  alleVaartenVanDag: Vaart[],
  nuMin: number | null,
  regels: Boekregels,
  opening?: Opening
): { boekbaar: boolean; reden?: string } {
  if (nuMin !== null && naarMinuten(vaart.tijd) < nuMin) {
    return { boekbaar: false, reden: 'Deze vaart is al geweest.' };
  }
  if (opening !== undefined && !binnenOpening(opening, vaart.tijd)) {
    return {
      boekbaar: false,
      reden: 'Deze vaart valt buiten de openingstijden en is alleen telefonisch te boeken.',
    };
  }
  if (!regels.eerste_boot_online) {
    const inRichting = alleVaartenVanDag.filter((v) => v.richting === vaart.richting);
    const eersteMin = inRichting.reduce(
      (min, v) => Math.min(min, naarMinuten(v.tijd)),
      Number.POSITIVE_INFINITY
    );
    if (inRichting.length > 0 && naarMinuten(vaart.tijd) === eersteMin) {
      return {
        boekbaar: false,
        reden: 'De eerste vaart van de dag is alleen telefonisch te boeken.',
      };
    }
  }
  if (vaart.richting === 'vertrek') {
    const grens = regels.naar_boot_online_tot_min_voor_vertrek;
    if (nuMin !== null && nuMin > naarMinuten(vaart.tijd) - grens) {
      return {
        boekbaar: false,
        reden: `Online boeken kan tot ${grens} minuten voor vertrek; deze vaart is alleen telefonisch te boeken.`,
      };
    }
    return { boekbaar: true };
  }
  return { boekbaar: true };
}

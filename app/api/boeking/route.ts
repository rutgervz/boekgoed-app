// POST /api/boeking — maakt een boeking (één rit, of twee ritten bij retour)
// via rpc('boeking_maak'). Alles wordt server-side gecontroleerd en de prijs
// wordt server-side berekend; de browser bepaalt niets bindends. De heenrit
// heeft altijd een kloktijd; alleen de terugrit mag zonder tijd ("wij bellen
// voor de terugtijd"). Bij een bootrit volgt de rit-tijd de vaart, ook voor de
// terugrit van een retour (domeinregel 4 geldt in beide richtingen). De
// bagagevrijstelling wordt hier berekend uit bagageTotaal; een meegestuurde
// extraBagage telt niet.
//
// Body: { slug, datum, tijd, vaartTijd?, richting, van, naar,
//         invoer: RitInvoer, bagageTotaal?,
//         retourDatum?, retourTijd? of retourTijdOnbekend?,
//         naam, telefoon, email?, opmerking? }

import { NextResponse } from 'next/server';
import { rpc } from '@/lib/db';
import { bedrijfLees, dagLees } from '@/lib/bedrijf';
import { nuAmsterdam } from '@/lib/nu';
import { berekenPrijs, extraBagageBoven } from '@/lib/domein/prijs';
import {
  inSluiting,
  vaartBoekbaar,
  vindConflict,
  volgendeVrijeTijd,
} from '@/lib/domein/beschikbaarheid';
import { BOEKINGSHORIZON_DAGEN, datumPlus, geldigeDatum } from '@/lib/domein/datum';
import { toMin } from '@/lib/domein/tijd';
import type { NieuweLading, Richting, RitInvoer, RitLicht } from '@/lib/domein/typen';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const TIJD = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TELEFOON = /^\+?\d{10,13}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Leest en controleert een RitInvoer; null bij ongeldige invoer. Zelfde controle als in api/prijs. */
function leesRitInvoer(x: unknown): RitInvoer | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  const modus =
    o.modus === 'personen' || o.modus === 'bagage' || o.modus === 'aanhanger' ? o.modus : null;
  if (!modus) return null;
  const aantal = (w: unknown): number | null =>
    typeof w === 'number' && Number.isInteger(w) && w >= 0 && w <= 50 ? w : null;
  const personen = aantal(o.personen ?? 0);
  const extraBagage = aantal(o.extraBagage ?? 0);
  const bagageStuks = aantal(o.bagageStuks ?? 0);
  if (personen === null || extraBagage === null || bagageStuks === null) return null;
  if (modus === 'personen' && personen < 1) return null;
  return {
    modus,
    personen,
    huisdier: o.huisdier === true,
    extraBagage,
    bagageStuks,
    aanhanger: o.aanhanger === true,
    retour: o.retour === true,
  };
}

function fout(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ fout: code, ...(extra ?? {}) }, { status });
}

export async function POST(verzoek: Request) {
  let ruw: unknown;
  try {
    ruw = await verzoek.json();
  } catch {
    return fout('ongeldige_aanvraag', 400);
  }
  const body = (typeof ruw === 'object' && ruw !== null ? ruw : {}) as Record<string, unknown>;

  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!SLUG.test(slug)) return fout('ongeldige_aanvraag', 400);

  const invoer = leesRitInvoer(body.invoer);
  if (!invoer) return fout('ongeldige_invoer', 400);

  // Het totale aantal bagagestukken; de vrijstelling van gratis bagage wordt
  // hieronder server-side berekend, de meegestuurde extraBagage telt niet.
  const bagageTotaal =
    typeof body.bagageTotaal === 'number' &&
    Number.isInteger(body.bagageTotaal) &&
    body.bagageTotaal >= 0 &&
    body.bagageTotaal <= 50
      ? body.bagageTotaal
      : 0;

  const richting =
    body.richting === 'naar_boot' || body.richting === 'van_boot' || body.richting === 'locatie'
      ? body.richting
      : null;
  if (!richting) return fout('ongeldige_richting', 400);

  // Bij een bootrit is de veerdam het vaste eindpunt; alleen de adreskant
  // op het eiland hoeft ingevuld te zijn.
  let van = typeof body.van === 'string' ? body.van.trim() : '';
  let naar = typeof body.naar === 'string' ? body.naar.trim() : '';
  if (richting === 'van_boot' && van === '') van = 'Veerdam';
  if (richting === 'naar_boot' && naar === '') naar = 'Veerdam';
  if (!van || !naar || van.length > 200 || naar.length > 200) return fout('ongeldig_adres', 400);

  const naam = typeof body.naam === 'string' ? body.naam.trim() : '';
  if (!naam || naam.length > 100) return fout('ongeldige_naam', 400);

  const telefoon = typeof body.telefoon === 'string' ? body.telefoon.replace(/[\s-]/g, '') : '';
  if (!TELEFOON.test(telefoon)) return fout('ongeldige_telefoon', 400);

  const email =
    typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
  if (email && (email.length > 200 || !EMAIL.test(email))) return fout('ongeldig_email', 400);

  const opmerking =
    typeof body.opmerking === 'string' && body.opmerking.trim()
      ? body.opmerking.trim().slice(0, 500)
      : null;

  // Datum: een echte kalenderdag, niet in het verleden en binnen de horizon.
  const nu = nuAmsterdam();
  const horizon = datumPlus(nu.datum, BOEKINGSHORIZON_DAGEN);
  const datum = typeof body.datum === 'string' ? body.datum : '';
  if (!geldigeDatum(datum)) return fout('ongeldige_datum', 400);
  if (datum < nu.datum) return fout('datum_in_verleden', 400);
  if (datum > horizon) return fout('datum_te_ver', 400);

  const bedrijf = await bedrijfLees(slug);
  if (bedrijf === 'storing') return fout('opslag_niet_bereikbaar', 503);
  if (!bedrijf) return fout('onbekend_bedrijf', 404);
  const { opening, capaciteit, boekregels, tarieven_cent } = bedrijf.instellingen;

  const binnenOpening = (t: string) =>
    toMin(t) >= toMin(opening.van) && toMin(t) <= toMin(opening.tot);

  // Tijd van de heenrit: altijd een kloktijd. Alleen de terugrit van een
  // retour mag zonder tijd; een heenrit zonder tijd zou de capaciteits- en
  // sluitingscontrole ontwijken.
  if (body.tijdOnbekend === true) return fout('ongeldige_tijd', 400);
  const vaartTijd =
    typeof body.vaartTijd === 'string' && TIJD.test(body.vaartTijd) ? body.vaartTijd : null;
  let tijd: string;
  if (richting === 'naar_boot' || richting === 'van_boot') {
    // Bij een bootrit volgt de rit-tijd de vaart; een losse tijd die daarvan
    // afwijkt zou de capaciteits- en klokcontroles op de verkeerde tijd laten lopen.
    if (!vaartTijd) return fout('vaart_vereist', 400);
    if (typeof body.tijd === 'string' && body.tijd !== vaartTijd) return fout('ongeldige_tijd', 400);
    tijd = vaartTijd;
  } else {
    const t = typeof body.tijd === 'string' ? body.tijd : '';
    if (!TIJD.test(t)) return fout('ongeldige_tijd', 400);
    tijd = t;
  }
  if (!binnenOpening(tijd)) return fout('buiten_opening', 400);
  if (datum === nu.datum && toMin(tijd) < nu.minuten) return fout('tijd_verstreken', 400);

  const dag = await dagLees(bedrijf.id, datum);
  if (dag === null) return fout('opslag_niet_bereikbaar', 503);
  const verstrekenTotMin = datum === nu.datum ? nu.minuten : undefined;

  // Domeinregel 4: bootritten alleen via een bestaande vaart die online boekbaar is.
  if (richting === 'naar_boot' || richting === 'van_boot') {
    const gewensteRichting = richting === 'naar_boot' ? 'vertrek' : 'aankomst';
    const vaart = dag.vaarten.find((v) => v.tijd === vaartTijd && v.richting === gewensteRichting);
    if (!vaart) return fout('vaart_onbekend', 400);
    const b = vaartBoekbaar(vaart, dag.vaarten, verstrekenTotMin ?? null, boekregels, opening);
    if (!b.boekbaar) return fout('niet_boekbaar', 409, { reden: b.reden ?? null });
  }

  const terugRichting: Richting =
    richting === 'naar_boot' ? 'van_boot' : richting === 'van_boot' ? 'naar_boot' : 'locatie';

  // Retour: een tweede rit, terug mag zonder tijd ("wij bellen voor de terugtijd").
  let retourDatum: string | null = null;
  let retourTijd: string | null = null;
  let retourVaartTijd: string | null = null;
  if (invoer.retour) {
    retourDatum = typeof body.retourDatum === 'string' ? body.retourDatum : '';
    if (!geldigeDatum(retourDatum) || retourDatum < datum) return fout('ongeldige_retourdatum', 400);
    if (retourDatum > horizon) return fout('datum_te_ver', 400);
    if (body.retourTijdOnbekend !== true) {
      const t = typeof body.retourTijd === 'string' ? body.retourTijd : '';
      if (!TIJD.test(t)) return fout('ongeldige_retourtijd', 400);
      if (!binnenOpening(t)) return fout('buiten_opening', 400);
      if (retourDatum === nu.datum && toMin(t) < nu.minuten) return fout('tijd_verstreken', 400);
      // Een retour op dezelfde dag ligt na de heenrit.
      if (retourDatum === datum && toMin(t) <= toMin(tijd)) return fout('ongeldige_retourtijd', 400);
      retourTijd = t;

      // Domeinregel 4 geldt ook voor de terugrit: een terugrit naar of van de
      // boot hoort bij een bestaande, online boekbare vaart en wordt daaraan
      // gekoppeld (vaart_tijd), net als de heenrit.
      if (terugRichting === 'naar_boot' || terugRichting === 'van_boot') {
        const terugDag = retourDatum === datum ? dag : await dagLees(bedrijf.id, retourDatum);
        if (terugDag === null) return fout('opslag_niet_bereikbaar', 503);
        const gewenst = terugRichting === 'naar_boot' ? 'vertrek' : 'aankomst';
        const vaart = terugDag.vaarten.find((v) => v.tijd === retourTijd && v.richting === gewenst);
        if (!vaart) return fout('vaart_onbekend', 400, { deel: 'terug' });
        const b = vaartBoekbaar(
          vaart,
          terugDag.vaarten,
          retourDatum === nu.datum ? nu.minuten : null,
          boekregels,
          opening,
        );
        if (!b.boekbaar) return fout('niet_boekbaar', 409, { reden: b.reden ?? null, deel: 'terug' });
        retourVaartTijd = vaart.tijd;
      }
    }
  }

  // Prijs server-side: het totaal is bindend; bij retour krijgt elke rit de
  // enkele prijs. extraBagage komt uit bagageTotaal (gratis stuks eraf).
  const invoerMetBagage: RitInvoer = {
    ...invoer,
    extraBagage:
      invoer.modus === 'personen'
        ? extraBagageBoven(bagageTotaal, invoer.personen, tarieven_cent)
        : 0,
  };
  const prijs = berekenPrijs(invoerMetBagage, tarieven_cent);
  const prijsEnkel = invoer.retour
    ? berekenPrijs({ ...invoerMetBagage, retour: false }, tarieven_cent)
    : prijs;

  const lading: NieuweLading = {
    personen: invoer.modus === 'personen' ? invoer.personen : 0,
    aanhanger: invoer.aanhanger || invoer.modus === 'aanhanger',
  };

  const basis = {
    modus: invoer.modus,
    personen: lading.personen,
    huisdier: invoer.huisdier,
    extra_bagage: invoerMetBagage.extraBagage,
    bagage_stuks: invoer.modus === 'bagage' ? invoer.bagageStuks : 0,
    aanhanger: lading.aanhanger,
    naam,
    telefoon,
    email,
    opmerking,
    prijs_cent: prijsEnkel.totaalCent,
    betaalwijze: 'chauffeur', // fase 2: afrekenen bij de chauffeur
    betaald: false,
    bron: 'online',
  };
  const ritten: Record<string, unknown>[] = [
    { ...basis, datum, tijd, vaart_tijd: richting === 'locatie' ? null : vaartTijd, richting, van, naar },
  ];
  if (invoer.retour && retourDatum) {
    ritten.push({
      ...basis,
      datum: retourDatum,
      tijd: retourTijd,
      vaart_tijd: retourVaartTijd,
      richting: terugRichting,
      van: naar,
      naar: van,
    });
  }

  // Eén rpc-aanroep voor de hele boeking; de functie bewaakt de capaciteit
  // onder een advisory lock en maakt bij retour zelf de retour_groep.
  const antwoord = await rpc('boeking_maak', { p: { bedrijf_id: bedrijf.id, ritten } });
  if (antwoord.status === 503) return fout('opslag_niet_gekoppeld', 503);

  const uitkomst = (
    typeof antwoord.body === 'object' && antwoord.body !== null ? antwoord.body : {}
  ) as { ok?: boolean; fout?: string; rit_ids?: string[]; datum?: string; tijd?: string };

  if (antwoord.status >= 300 || uitkomst.ok !== true) {
    if (uitkomst.fout === 'vol') {
      // Domeinregel 1 en 2: vol is vol, met een suggestie die werkelijk
      // boekbaar is: bij een bootrit de eerstvolgende passende vaart, anders
      // de eerstvolgende vrije kloktijd.
      const conflictDatum = uitkomst.datum && DATUM.test(uitkomst.datum) ? uitkomst.datum : datum;
      const conflictTijd = uitkomst.tijd && TIJD.test(uitkomst.tijd) ? uitkomst.tijd : tijd;
      // Welk deel van de boeking vol is: de heenrit, of de terugrit van een retour.
      const deel: 'heen' | 'terug' =
        conflictDatum === datum && conflictTijd === tijd
          ? 'heen'
          : invoer.retour && conflictDatum === retourDatum && conflictTijd === retourTijd
            ? 'terug'
            : 'heen';
      const suggestieRichting = deel === 'terug' ? terugRichting : richting;
      let suggestie: string | null = null;
      const vers = await dagLees(bedrijf.id, conflictDatum);
      // Faalt de herlezing, dan geen suggestie: een "vrije" tijd uit een leeg
      // dagbeeld zou de zojuist afgewezen tijd opnieuw voorstellen.
      if (vers !== null) {
        // De hele boeking is teruggedraaid; bij een terug-conflict op de dag
        // van de heenrit telt de eigen heenrit dus weer mee voor de suggestie.
        const bekendeRitten: RitLicht[] =
          deel === 'terug' && conflictDatum === datum
            ? [
                ...vers.ritten,
                { tijd, personen: lading.personen, aanhanger: lading.aanhanger, status: 'gepland' },
              ]
            : vers.ritten;
        if (suggestieRichting === 'locatie') {
          suggestie = volgendeVrijeTijd(
            bekendeRitten,
            vers.sluitingen,
            conflictTijd,
            lading,
            capaciteit,
            opening,
          );
        } else {
          // Bij een bootrit is alleen een vaarttijd boekbaar; de vaarten staan
          // op tijd gesorteerd, dus de eerste passende is de eerstvolgende.
          const gewenst = suggestieRichting === 'naar_boot' ? 'vertrek' : 'aankomst';
          const nuMinDag = conflictDatum === nu.datum ? nu.minuten : null;
          const kandidaat = vers.vaarten.find(
            (v) =>
              v.richting === gewenst &&
              toMin(v.tijd) > toMin(conflictTijd) &&
              vaartBoekbaar(v, vers.vaarten, nuMinDag, boekregels, opening).boekbaar &&
              inSluiting(vers.sluitingen, v.tijd) === null &&
              vindConflict(bekendeRitten, v.tijd, lading, capaciteit) === null,
          );
          suggestie = kandidaat?.tijd ?? null;
        }
      }
      return fout('vol', 409, { suggestie, deel });
    }
    if (uitkomst.fout === 'dicht') return fout('dicht', 409);
    if (uitkomst.fout === 'te_veel_boekingen') return fout('te_veel_boekingen', 429);
    return fout(uitkomst.fout ?? 'boeking_mislukt', 500);
  }

  return NextResponse.json(
    {
      ok: true,
      ritIds: uitkomst.rit_ids ?? [],
      totaalCent: prijs.totaalCent,
      regels: prijs.regels,
    },
    { status: 201 },
  );
}

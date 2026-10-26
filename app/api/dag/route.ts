// GET /api/dag?slug=...&datum=YYYY-MM-DD&personen=1&aanhanger=false
// Het dagbeeld voor de boekingspagina: kwartierslots (open, vol of dicht),
// de vaarten van de dag met boekbaarheid, en bedrijf, contact en opening.
// De query draagt de lading mee, zodat de slots voor dit gezelschap kloppen.

import { NextResponse } from 'next/server';
import { bedrijfLees, dagLees } from '@/lib/bedrijf';
import { nuAmsterdam } from '@/lib/nu';
import { dagSlots, vaartBoekbaar } from '@/lib/domein/beschikbaarheid';
import { BOEKINGSHORIZON_DAGEN, datumPlus, geldigeDatum } from '@/lib/domein/datum';
import type { NieuweLading } from '@/lib/domein/typen';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function GET(verzoek: Request) {
  const { searchParams } = new URL(verzoek.url);
  const slug = searchParams.get('slug') ?? '';
  const datum = searchParams.get('datum') ?? '';
  if (!SLUG.test(slug)) {
    return NextResponse.json({ fout: 'ongeldige_aanvraag' }, { status: 400 });
  }
  // Een echte kalenderdag binnen de boekingshorizon; "2026-11-31" zou anders
  // stil falende queries en een volledig open dagbeeld opleveren.
  const nu = nuAmsterdam();
  if (!geldigeDatum(datum)) {
    return NextResponse.json({ fout: 'ongeldige_datum' }, { status: 400 });
  }
  if (datum > datumPlus(nu.datum, BOEKINGSHORIZON_DAGEN)) {
    return NextResponse.json({ fout: 'datum_te_ver' }, { status: 400 });
  }

  const bedrijf = await bedrijfLees(slug);
  if (bedrijf === 'storing') {
    return NextResponse.json({ fout: 'opslag_niet_bereikbaar' }, { status: 503 });
  }
  if (!bedrijf) {
    return NextResponse.json({ fout: 'onbekend_bedrijf' }, { status: 404 });
  }

  const { opening, capaciteit, boekregels, contact, tarieven_cent, huisstijl } =
    bedrijf.instellingen;
  const dag = await dagLees(bedrijf.id, datum);
  if (dag === null) {
    return NextResponse.json({ fout: 'opslag_niet_bereikbaar' }, { status: 503 });
  }

  // Verstreken tijdstippen tellen alleen mee op de dag van vandaag (domeinregel 3).
  const verstrekenTotMin = nu.datum === datum ? nu.minuten : undefined;

  // De lading uit de query; zonder of met ongeldige waarden geldt één persoon.
  const personenRuw = Number(searchParams.get('personen') ?? '1');
  const personen =
    Number.isInteger(personenRuw) && personenRuw >= 0 && personenRuw <= 50 ? personenRuw : 1;
  const nieuw: NieuweLading = { personen, aanhanger: searchParams.get('aanhanger') === 'true' };

  const slots = dagSlots({
    ritten: dag.ritten,
    sluitingen: dag.sluitingen,
    instellingen: bedrijf.instellingen,
    nieuw,
    verstrekenTotMin,
  });

  // Voor een andere dag dan vandaag vervalt de klokcontrole (nuMin null). Met
  // de opening erbij zijn dagbeeld en boekingsroute consistent: een verstreken
  // vaart of een vaart buiten de opening is hier al niet boekbaar.
  const nuMin = verstrekenTotMin ?? null;
  const vaarten = dag.vaarten.map((vaart) => {
    const b = vaartBoekbaar(vaart, dag.vaarten, nuMin, boekregels, opening);
    return { ...vaart, boekbaar: b.boekbaar, ...(b.reden ? { reden: b.reden } : {}) };
  });

  return NextResponse.json({
    bedrijf: { naam: bedrijf.naam, ...(huisstijl.slogan ? { slogan: huisstijl.slogan } : {}) },
    contact,
    opening,
    capaciteit: { personen: capaciteit.personen },
    gratis_bagage_per_persoon: tarieven_cent.gratis_bagage_per_persoon,
    slots,
    vaarten,
  });
}

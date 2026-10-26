// POST /api/prijs — de bindende prijs voor een ritinvoer, berekend met de
// tarieven van het bedrijf (domeinregel 5). De vrijstelling van gratis bagage
// wordt hier berekend uit bagageTotaal; een meegestuurde extraBagage telt niet.
// Body: { slug, invoer: RitInvoer, bagageTotaal? }.

import { NextResponse } from 'next/server';
import { bedrijfLees } from '@/lib/bedrijf';
import { berekenPrijs, extraBagageBoven } from '@/lib/domein/prijs';
import type { RitInvoer } from '@/lib/domein/typen';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Leest en controleert een RitInvoer; null bij ongeldige invoer. Zelfde controle als in api/boeking. */
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

export async function POST(verzoek: Request) {
  let ruw: unknown;
  try {
    ruw = await verzoek.json();
  } catch {
    return NextResponse.json({ fout: 'ongeldige_aanvraag' }, { status: 400 });
  }
  const body = (typeof ruw === 'object' && ruw !== null ? ruw : {}) as Record<string, unknown>;

  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!SLUG.test(slug)) {
    return NextResponse.json({ fout: 'ongeldige_aanvraag' }, { status: 400 });
  }
  const invoer = leesRitInvoer(body.invoer);
  if (!invoer) {
    return NextResponse.json({ fout: 'ongeldige_invoer' }, { status: 400 });
  }
  const bagageTotaal =
    typeof body.bagageTotaal === 'number' &&
    Number.isInteger(body.bagageTotaal) &&
    body.bagageTotaal >= 0 &&
    body.bagageTotaal <= 50
      ? body.bagageTotaal
      : 0;

  const bedrijf = await bedrijfLees(slug);
  if (bedrijf === 'storing') {
    return NextResponse.json({ fout: 'opslag_niet_bereikbaar' }, { status: 503 });
  }
  if (!bedrijf) {
    return NextResponse.json({ fout: 'onbekend_bedrijf' }, { status: 404 });
  }

  // extraBagage komt uit bagageTotaal (gratis stuks per persoon eraf); de
  // browser bepaalt niets bindends.
  const tarieven = bedrijf.instellingen.tarieven_cent;
  const invoerMetBagage: RitInvoer = {
    ...invoer,
    extraBagage:
      invoer.modus === 'personen' ? extraBagageBoven(bagageTotaal, invoer.personen, tarieven) : 0,
  };
  const prijs = berekenPrijs(invoerMetBagage, tarieven);
  return NextResponse.json({ totaalCent: prijs.totaalCent, regels: prijs.regels });
}

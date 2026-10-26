// Leest bedrijven en daggegevens uit Supabase. Alleen server-side, met de
// service-sleutel; zelfde opzet als lib/db.ts. De browser ziet de sleutel nooit.

import type { DbAntwoord } from './db';
import type { Instellingen, RitLicht, Sluiting, Vaart } from './domein/typen';

export type Bedrijf = {
  id: string;
  slug: string;
  naam: string;
  domein: string | null;
  instellingen: Instellingen;
};

export type Dag = {
  ritten: RitLicht[];
  sluitingen: Sluiting[];
  vaarten: Vaart[];
};

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

/**
 * GET op de REST-laag van Supabase (pad inclusief zoekparameters). Een
 * netwerkfout wordt een 503-antwoord, geen onafgevangen exceptie.
 */
export async function tabelLees(pad: string): Promise<DbAntwoord> {
  const c = cfg();
  if (!c) return { status: 503, body: { fout: 'opslag_niet_gekoppeld' } };
  let r: Response;
  try {
    r = await fetch(`${c.url}/rest/v1/${pad}`, {
      headers: {
        apikey: c.key,
        Authorization: `Bearer ${c.key}`,
      },
      cache: 'no-store',
    });
  } catch {
    return { status: 503, body: { fout: 'opslag_niet_bereikbaar' } };
  }
  const tekst = await r.text();
  let body: unknown = null;
  try { body = tekst ? JSON.parse(tekst) : null; } catch { body = { ruw: tekst }; }
  return { status: r.status, body };
}

/**
 * Haalt rijen op; null bij een fout of ontbrekende opslag. Een fout wordt
 * nooit een lege lijst: een leeg dagbeeld zou fail-open alles openzetten en
 * een bestaand bedrijf zou onvindbaar lijken.
 */
async function rijen(pad: string): Promise<Record<string, unknown>[] | null> {
  const a = await tabelLees(pad);
  return a.status === 200 && Array.isArray(a.body)
    ? (a.body as Record<string, unknown>[])
    : null;
}

/** Postgres geeft tijden als "HH:MM:SS"; het domein rekent met "HH:MM". */
function kortTijd(t: unknown): string | null {
  return typeof t === 'string' && t.length >= 5 ? t.slice(0, 5) : null;
}

/**
 * De rij uit bedrijven voor deze slug: null als die er niet is, 'storing'
 * wanneer de opslag niet antwoordde (dan is 404 niet op zijn plaats).
 */
export async function bedrijfLees(slug: string): Promise<Bedrijf | null | 'storing'> {
  const lijst = await rijen(
    `bedrijven?select=id,slug,naam,domein,instellingen&slug=eq.${encodeURIComponent(slug)}&limit=1`,
  );
  if (lijst === null) return 'storing';
  if (lijst.length === 0) return null;
  return lijst[0] as unknown as Bedrijf;
}

/**
 * Ritten, sluitingen en vaarten van een bedrijf op een datum (YYYY-MM-DD);
 * null wanneer een van de leesacties faalde.
 */
export async function dagLees(bedrijfId: string, datum: string): Promise<Dag | null> {
  const b = encodeURIComponent(bedrijfId);
  const d = encodeURIComponent(datum);
  const [ritten, sluitingen, vaarten] = await Promise.all([
    rijen(`ritten?select=tijd,personen,aanhanger,status&bedrijf_id=eq.${b}&datum=eq.${d}`),
    rijen(`sluitingen?select=van,tot,reden&bedrijf_id=eq.${b}&datum=eq.${d}`),
    rijen(`vaarten?select=tijd,dienst,richting&bedrijf_id=eq.${b}&datum=eq.${d}&order=tijd.asc`),
  ]);
  if (ritten === null || sluitingen === null || vaarten === null) return null;
  return {
    ritten: ritten.map((r): RitLicht => ({
      tijd: kortTijd(r.tijd),
      personen: Number(r.personen ?? 0),
      aanhanger: r.aanhanger === true,
      status: String(r.status ?? 'gepland'),
    })),
    sluitingen: sluitingen.map((s): Sluiting => ({
      van: kortTijd(s.van) ?? '00:00',
      tot: kortTijd(s.tot) ?? '00:00',
      reden: typeof s.reden === 'string' ? s.reden : null,
    })),
    vaarten: vaarten.map((v): Vaart => ({
      tijd: kortTijd(v.tijd) ?? '00:00',
      dienst: v.dienst === 'sneldienst' ? 'sneldienst' : 'veerboot',
      richting: v.richting === 'vertrek' ? 'vertrek' : 'aankomst',
    })),
  };
}

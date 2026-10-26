// Supabase wordt alleen server-side benaderd met de service-sleutel; de
// browser ziet die nooit. Zelfde opzet als api/_db.js in boekgoed-org.

export type DbAntwoord = { status: number; body: unknown };

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export async function rpc(naam: string, args: Record<string, unknown>): Promise<DbAntwoord> {
  const c = cfg();
  if (!c) return { status: 503, body: { fout: "opslag_niet_gekoppeld" } };
  const r = await fetch(`${c.url}/rest/v1/rpc/${naam}`, {
    method: "POST",
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const tekst = await r.text();
  let body: unknown = null;
  try { body = tekst ? JSON.parse(tekst) : null; } catch { body = { ruw: tekst }; }
  return { status: r.status, body };
}

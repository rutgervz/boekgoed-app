# boekgoed-app

De applicatie van Boekgoed: gasten boeken en betalen zelf op het eigen adres van
het bedrijf, de chauffeur plant op het planbord (iPad, telefoon of laptop), en
het systeem bewaakt capaciteit en bootaansluitingen. Eerste klant: Taxi
Schiermonnikoog, op `boeken.taxi-schiermonnikoog.nl`.

Het klantportaal (inrichting, support) is een apart project: `boekgoed-org`.
Beide delen hetzelfde Supabase-project "Boekgoed".

## Opbouw

| Map of bestand | Doel |
|---|---|
| `app/` | Next.js App Router: boekingspagina, straks planbord en API-routes |
| `lib/db.ts` | Supabase-aanroep met de service-sleutel, alleen server-side |
| `supabase/0001_fundament.sql` | Tabellen: bedrijven, adressen, vaarten, ritten, sluitingen, betalingen, gebeurtenissen |
| `supabase/seed-taxischiermonnikoog.sql` | Instellingen en eerste adresboek voor Taxi Schiermonnikoog |

## Stack

Next.js (TypeScript) op Vercel, Supabase (database), Mollie (iDEAL, op het eigen
account van de klant), Spryng (sms), Resend (e-mail), Claude (triage en later
steminvoer).

Omgevingsvariabelen: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`; later
`MOLLIE_API_KEY`, `SPRYNG_API_KEY`, `RESEND_API_KEY`. Sleutels staan nooit in de
repo of in de browser.

## Fasen

1. Fundament: schema, instellingen uit de portaalantwoorden, vaarschema, adresboek — staat
2. Gastflow zonder betaling: beschikbaarheid, prijsberekening, boeking
3. Mollie (test) en sms-bevestiging via Spryng, daarna de live-sleutel
4. Planbord: daglijst, telefonische invoer (ook op rekening), tijdvakken sluiten, daglijst 07:00
5. Spitsmodus: ritten per boot combineren, achterwaarts gepland vanaf de afvaart
6. Annuleren met terugbetaling; daarna steminvoer en WhatsApp (v2)

De regels (capaciteit per kwartier, zones en rijtijden, spitsplanning,
prijsmodi) staan beschreven in `boekgoed-org/docs/demo/DEMO-CONTEXT.md` met de
demo erbij als referentie.

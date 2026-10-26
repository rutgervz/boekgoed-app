# boekgoed-app — werkafspraken voor Claude Code

De app van Boekgoed (boeken, betalen, plannen). Eerste klant: Taxi
Schiermonnikoog op boeken.taxi-schiermonnikoog.nl. Zie README.md voor opbouw en
fasen. Taal: Nederlands, ook in de code (ritten, vaarten, sluitingen,
spitsmodus, planbord); TypeScript.

## Regels

De service-sleutel van Supabase komt nooit in de browser of in de repo; alle
datatoegang loopt server-side via `lib/db.ts`. Beheer is data, geen code: alles
wat per klant verschilt (tarieven, tijden, regels, teksten, huisstijl) staat in
`bedrijven.instellingen`, zodat een wijziging geen deploy vraagt. Bedragen in
centen. Elke betekenisvolle actie krijgt een regel in `gebeurtenissen`
(audit-log). De boekingspagina draagt de huisstijl van de klant (merkblauw
#123144), niet die van Boekgoed. Teksten voor gasten beschrijvend, zonder
aanspreekvormen; geen streepjes als opsommingstekens.

Via Rutger, nooit zelfstandig: productie-deploys, berichten naar klanten of
gasten, geld (refunds, prijswijzigingen), sleutels en toegang.

## Domeinregels (kort)

Capaciteit: 8 personen en 1 aanhanger per glijdend venster van 15 minuten, over
alle ritten; bij conflict de eerstvolgende vrije tijd voorstellen. Dag =
kwartierslots 09:00–21:30, status open, vol of dicht; sluitingen met reden.
Boten: veerboot en sneldienst uit het vaarschema (tabel `vaarten`); naar de boot
online boekbaar tot 45 minuten voor vertrek, eerste boot niet online, vanaf de
boot altijd, tussen boten alleen als het past. Prijs: drie modi (personen,
bagage, aanhanger), retour ×2; terugrit mag zonder tijd ("wij bellen").
Spitsmodus: clusteren op richting, boot en zone tot 8 personen; naar de boot
achterwaarts gepland vanaf 5 minuten voor de afvaart met de rijtijdmatrix.

## Bronnen

De demo met de regels: `boekgoed-org/docs/demo/` (DEMO-CONTEXT.md leidend).
Klantantwoorden: tabel `portalen`, kolom `stand` (Supabase-project "Boekgoed",
`ixagppfjjietuosnskjs`). Adresboek: Google Sheet "Adresboek Taxi
Schiermonnikoog". Het voorstel en de vergelijking met taxiID staan in de Drive
van rutger@indigo.ventures.

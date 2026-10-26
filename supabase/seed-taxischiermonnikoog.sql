-- Seed voor Taxi Schiermonnikoog, gevuld uit de portaalantwoorden (oktober 2026)
-- en de demoregels (boekgoed-org/docs/demo). Uitgevoerd op 26 oktober 2026.
-- Bedragen in centen. Het adresboek komt uit de demo en is nog niet door de
-- taxi gecontroleerd (gecontroleerd = false); het actuele adresboek staat in
-- het Google Sheet "Adresboek Taxi Schiermonnikoog".

insert into public.bedrijven (slug, naam, domein, plancode, instellingen) values (
  'taxischiermonnikoog',
  'Taxi Schiermonnikoog',
  'boeken.taxi-schiermonnikoog.nl',
  'SCHIER-RIT',
  '{
    "tarieven_cent": {
      "eerste_persoon": 1000, "extra_persoon": 650, "huisdier": 550,
      "gratis_bagage_per_persoon": 2, "extra_bagagestuk": 550,
      "los_bagagestuk": 550, "aanhanger": 2000
    },
    "capaciteit": { "personen": 8, "aanhangers": 1, "venster_min": 15 },
    "opening": { "van": "09:00", "tot": "21:30" },
    "boekregels": {
      "naar_boot_online_tot_min_voor_vertrek": 45,
      "eerste_boot_online": false,
      "vanaf_boot_altijd": true,
      "tussen_boten": "alleen_als_het_past",
      "op_rekening_alleen_telefonisch": true,
      "afwijkende_tijden": "telefonisch"
    },
    "zones": {
      "volgorde": ["haven", "dorp", "strand", "oost"],
      "rijtijd_min": {
        "haven":  { "haven": 0,  "dorp": 6, "strand": 14, "oost": 11 },
        "dorp":   { "haven": 6,  "dorp": 0, "strand": 9,  "oost": 7 },
        "strand": { "haven": 14, "dorp": 9, "strand": 0,  "oost": 13 },
        "oost":   { "haven": 11, "dorp": 7, "strand": 13, "oost": 0 }
      }
    },
    "spits": {
      "dagen": ["vrijdag", "maandag"],
      "vertrek_lauwersoog": ["09:35", "12:35", "15:35"],
      "marge_voor_afvaart_min": 5
    },
    "contact": {
      "telefoon": "0519531007",
      "email": "info@taxi-schiermonnikoog.nl",
      "adres": "Sinteblom 5, 9166 RD Schiermonnikoog",
      "adres_opmerking": "geen bezoekadres"
    },
    "berichten": {
      "bevestiging_klad": "Bedankt voor uw boeking bij Taxi Schiermonnikoog. Als wij u naar de boot brengen sta dan op tijd klaar (5 minuten van te voren) bij uw afgesproken plek. Komt u van de boot dan kunt u zich melden bij de grijze taxi. Als u rit 2 of rit 3 heeft dan moet u even wachten totdat de taxi terug is.",
      "daglijst_tijd": "07:00"
    },
    "huisstijl": { "merkblauw": "#123144", "slogan": "Lokaal. Betrokken. Duidelijk." },
    "voertuig": { "naam": "Renault Trafic", "zitplaatsen": 8, "fietsenrek": false },
    "chauffeurs": [
      { "naam": "Henk Hockelmann", "mobiel": "+31655363331" },
      { "naam": "Sanne Merks", "mobiel": "+31634339946" },
      { "naam": "Rutger van Halm", "mobiel": "+31648795184" }
    ],
    "op_rekening_klanten": ["Noderstraun", "Marlijn", "Wadanderz"]
  }'::jsonb
);

with b as (select id from public.bedrijven where slug = 'taxischiermonnikoog')
insert into public.adressen (bedrijf_id, bijnaam, zone, aliassen, gecontroleerd)
select b.id, v.bijnaam, v.zone, v.aliassen, false from b, (values
  ('Veerhaven',        'haven',  array['haven','boot','veerdam']),
  ('Springfield',      'dorp',   array[]::text[]),
  ('De Wokkel',        'strand', array['wokkel']),
  ('Landal Vitamaris', 'strand', array['landal']),
  ('Schierresort',     'dorp',   array['schier resort']),
  ('Camping Seedune',  'oost',   array['camping','seedune']),
  ('Koloniehuis',      'dorp',   array['kolonie']),
  ('Idika',            'dorp',   array[]::text[]),
  ('Zeerust',          'strand', array[]::text[]),
  ('Kwikstaart',       'dorp',   array['gele kwikstaart']),
  ('Bernstorff',       'dorp',   array['hotel bernstorff']),
  ('Vuurtorenpad',     'strand', array['vuurtoren']),
  ('Rijspolder',       'oost',   array[]::text[]),
  ('Noorderstreek',    'dorp',   array[]::text[]),
  ('Langestreek',      'dorp',   array[]::text[]),
  ('Reddingsweg',      'dorp',   array[]::text[]),
  ('Duinpad',          'strand', array[]::text[]),
  ('Martjeland',       'dorp',   array[]::text[]),
  ('Molendijk',        'dorp',   array[]::text[]),
  ('Badweg',           'strand', array[]::text[])
) as v(bijnaam, zone, aliassen);

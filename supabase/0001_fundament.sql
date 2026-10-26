-- Boekgoed-app: fundament (fase 1)
-- Nieuwe tabellen naast het bestaande portaal (tabel portalen blijft ongemoeid).
-- Alle toegang loopt server-side met de service-sleutel; RLS staat aan zonder
-- policies, zodat anon en authenticated niets kunnen, net als bij portalen.
-- Toegepast op het Supabase-project "Boekgoed" op 26 oktober 2026.

create table public.bedrijven (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  naam text not null,
  domein text,
  plancode text not null,
  instellingen jsonb not null default '{}'::jsonb,
  aangemaakt timestamptz not null default now()
);

create table public.adressen (
  id uuid primary key default gen_random_uuid(),
  bedrijf_id uuid not null references public.bedrijven(id) on delete cascade,
  bijnaam text not null,
  naam text,
  adres text,
  zone text not null check (zone in ('haven','dorp','strand','oost')),
  aliassen text[] not null default '{}',
  gecontroleerd boolean not null default false,
  actief boolean not null default true
);
create index adressen_bedrijf on public.adressen (bedrijf_id);

create table public.vaarten (
  id uuid primary key default gen_random_uuid(),
  bedrijf_id uuid not null references public.bedrijven(id) on delete cascade,
  datum date not null,
  tijd time not null,
  dienst text not null check (dienst in ('veerboot','sneldienst')),
  richting text not null check (richting in ('aankomst','vertrek')),
  unique (bedrijf_id, datum, tijd, dienst, richting)
);
create index vaarten_dag on public.vaarten (bedrijf_id, datum);

create table public.ritten (
  id uuid primary key default gen_random_uuid(),
  bedrijf_id uuid not null references public.bedrijven(id) on delete cascade,
  datum date not null,
  tijd time,
  vaart_id uuid references public.vaarten(id),
  richting text not null check (richting in ('naar_boot','van_boot','locatie')),
  van text not null,
  naar text not null,
  zone_van text check (zone_van in ('haven','dorp','strand','oost')),
  zone_naar text check (zone_naar in ('haven','dorp','strand','oost')),
  modus text not null default 'personen' check (modus in ('personen','bagage','aanhanger')),
  personen int not null default 0 check (personen between 0 and 50),
  huisdier boolean not null default false,
  extra_bagage int not null default 0,
  bagage_stuks int not null default 0,
  aanhanger boolean not null default false,
  retour_groep uuid,
  naam text not null,
  telefoon text not null,
  email text,
  opmerking text,
  prijs_cent int not null default 0,
  betaalwijze text not null default 'ideal' check (betaalwijze in ('ideal','chauffeur','op_rekening')),
  betaald boolean not null default false,
  status text not null default 'gepland' check (status in ('gepland','onderweg','opgehaald','afgerond','geannuleerd')),
  bron text not null default 'online' check (bron in ('online','telefoon','stem')),
  aangemaakt timestamptz not null default now(),
  gewijzigd timestamptz not null default now()
);
create index ritten_dag on public.ritten (bedrijf_id, datum);

create table public.sluitingen (
  id uuid primary key default gen_random_uuid(),
  bedrijf_id uuid not null references public.bedrijven(id) on delete cascade,
  datum date not null,
  van time not null,
  tot time not null,
  reden text
);
create index sluitingen_dag on public.sluitingen (bedrijf_id, datum);

create table public.betalingen (
  id uuid primary key default gen_random_uuid(),
  rit_id uuid not null references public.ritten(id) on delete cascade,
  mollie_id text unique,
  status text not null default 'open',
  bedrag_cent int not null,
  aangemaakt timestamptz not null default now(),
  gewijzigd timestamptz not null default now()
);

create table public.gebeurtenissen (
  id bigint generated always as identity primary key,
  bedrijf_id uuid references public.bedrijven(id) on delete set null,
  soort text not null,
  data jsonb not null default '{}'::jsonb,
  moment timestamptz not null default now()
);
create index gebeurtenissen_bedrijf on public.gebeurtenissen (bedrijf_id, moment desc);

alter table public.bedrijven enable row level security;
alter table public.adressen enable row level security;
alter table public.vaarten enable row level security;
alter table public.ritten enable row level security;
alter table public.sluitingen enable row level security;
alter table public.betalingen enable row level security;
alter table public.gebeurtenissen enable row level security;

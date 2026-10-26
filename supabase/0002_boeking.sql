-- Boekgoed-app: boeking_maak (fase 2). Toegepast op het Supabase-project "Boekgoed" op 26 oktober 2026.
-- Eén RPC voor een boeking van één rit of twee ritten (retour). De functie
-- bewaakt capaciteit en sluitingen onder een advisory lock per bedrijf en dag,
-- zodat twee gelijktijdige boekingen elkaar niet over de capaciteit duwen.
-- Als rem op herhaalde boekingen geldt bovendien een limiet per telefoonnummer
-- per dag (instelling boekregels.max_ritten_per_nummer_per_dag, standaard 3).
-- Aanroepen mag alleen met de service-sleutel (server-side), nooit vanuit de
-- browser: execute is ingetrokken voor anon en authenticated.
--
-- search_path staat leeg en alle objecten zijn schema-gekwalificeerd, zodat
-- object-shadowing in public geen vat op de functie krijgt (security definer).
-- Eigen afwijzingen gebruiken sqlstate 'BG409'; alleen die worden gevangen en
-- als jsonb teruggegeven, elke andere fout valt gewoon door naar de aanroeper.
--
-- Invoer p (jsonb):
-- {
--   "bedrijf_id": "<uuid>",
--   "ritten": [
--     { "datum": "YYYY-MM-DD", "tijd": "HH:MM" | null, "vaart_tijd": "HH:MM" | null,
--       "richting": "naar_boot" | "van_boot" | "locatie", "van": "...", "naar": "...",
--       "modus": "personen" | "bagage" | "aanhanger", "personen": 0..50,
--       "huisdier": bool, "extra_bagage": int, "bagage_stuks": int, "aanhanger": bool,
--       "naam": "...", "telefoon": "...", "email": "..." | null, "opmerking": "..." | null,
--       "prijs_cent": int, "betaalwijze": "chauffeur", "betaald": false, "bron": "online" }
--   ]
-- }
-- Uitvoer: {"ok":true,"rit_ids":[...]} of
--          {"ok":false,"fout":"vol"|"dicht","datum":"YYYY-MM-DD","tijd":"HH:MM"} of
--          {"ok":false,"fout":"te_veel_boekingen","datum":"YYYY-MM-DD"} of
--          {"ok":false,"fout":"ongeldige_aanvraag"|"onbekend_bedrijf"}.

create or replace function public.boeking_maak(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bedrijf uuid;
  v_instellingen jsonb;
  v_venster int;
  v_max_personen int;
  v_max_aanhangers int;
  v_max_per_nummer int;
  v_aantal int;
  v_retour uuid;
  v_datum date;
  r jsonb;
  v_tijd time;
  v_personen int;
  v_aanhanger boolean;
  v_bezet_personen int;
  v_bezet_aanhangers int;
  v_bestaand int;
  v_vaart uuid;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  begin
    v_bedrijf := (p->>'bedrijf_id')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'fout', 'ongeldige_aanvraag');
  end;

  select instellingen into v_instellingen from public.bedrijven where id = v_bedrijf;
  if v_instellingen is null then
    return jsonb_build_object('ok', false, 'fout', 'onbekend_bedrijf');
  end if;

  -- Capaciteit uit de instellingen van het bedrijf (domeinregel 1).
  v_venster        := coalesce((v_instellingen->'capaciteit'->>'venster_min')::int, 15);
  v_max_personen   := coalesce((v_instellingen->'capaciteit'->>'personen')::int, 8);
  v_max_aanhangers := coalesce((v_instellingen->'capaciteit'->>'aanhangers')::int, 1);
  -- Rem op herhaalde boekingen: hooguit zoveel niet-afgeronde ritten per
  -- telefoonnummer per dag (sms-bevestiging in fase 3 maakt nep-nummers daarna waardeloos).
  v_max_per_nummer := coalesce((v_instellingen->'boekregels'->>'max_ritten_per_nummer_per_dag')::int, 3);

  if jsonb_typeof(p->'ritten') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'fout', 'ongeldige_aanvraag');
  end if;
  v_aantal := jsonb_array_length(p->'ritten');
  if v_aantal < 1 or v_aantal > 2 then
    return jsonb_build_object('ok', false, 'fout', 'ongeldige_aanvraag');
  end if;
  if v_aantal = 2 then
    v_retour := gen_random_uuid();
  end if;

  -- Eén boeking per bedrijf en dag tegelijk; de lock vervalt bij commit of rollback.
  -- Gesorteerd pakken (bij retour twee datums) voorkomt deadlocks.
  for v_datum in
    select distinct (e->>'datum')::date from jsonb_array_elements(p->'ritten') e order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(v_bedrijf::text || v_datum::text));
  end loop;

  begin
    for r in select * from jsonb_array_elements(p->'ritten') loop
      v_datum     := (r->>'datum')::date;
      v_tijd      := nullif(r->>'tijd', '')::time;
      v_personen  := coalesce((r->>'personen')::int, 0);
      v_aanhanger := coalesce((r->>'aanhanger')::boolean, false);

      -- Limiet per telefoonnummer per dag; de tweede rit van een retour op
      -- dezelfde dag telt de eerste mee, omdat die hier al is toegevoegd.
      select count(*) into v_bestaand
        from public.ritten rt
        where rt.bedrijf_id = v_bedrijf
          and rt.datum = v_datum
          and rt.telefoon = r->>'telefoon'
          and rt.status not in ('afgerond', 'geannuleerd');
      if v_bestaand >= v_max_per_nummer then
        raise exception using errcode = 'BG409', message = jsonb_build_object(
          'ok', false, 'fout', 'te_veel_boekingen',
          'datum', to_char(v_datum, 'YYYY-MM-DD')
        )::text;
      end if;

      if v_tijd is not null then
        -- Sluitingen: van <= tijd < tot betekent dicht (domeinregel 3).
        if exists (
          select 1 from public.sluitingen s
          where s.bedrijf_id = v_bedrijf and s.datum = v_datum
            and s.van <= v_tijd and v_tijd < s.tot
        ) then
          raise exception using errcode = 'BG409', message = jsonb_build_object(
            'ok', false, 'fout', 'dicht',
            'datum', to_char(v_datum, 'YYYY-MM-DD'), 'tijd', to_char(v_tijd, 'HH24:MI')
          )::text;
        end if;

        -- Glijdend venster: |verschil| < venster_min, status niet afgerond of
        -- geannuleerd. De tweede rit van een retour op dezelfde dag telt de
        -- eerste mee, omdat die hier al is toegevoegd.
        select coalesce(sum(rt.personen), 0), count(*) filter (where rt.aanhanger)
          into v_bezet_personen, v_bezet_aanhangers
          from public.ritten rt
          where rt.bedrijf_id = v_bedrijf
            and rt.datum = v_datum
            and rt.tijd is not null
            and rt.status not in ('afgerond', 'geannuleerd')
            and abs(extract(epoch from (rt.tijd - v_tijd))) / 60 < v_venster;

        if v_bezet_personen + v_personen > v_max_personen
           or v_bezet_aanhangers + (case when v_aanhanger then 1 else 0 end) > v_max_aanhangers then
          raise exception using errcode = 'BG409', message = jsonb_build_object(
            'ok', false, 'fout', 'vol',
            'datum', to_char(v_datum, 'YYYY-MM-DD'), 'tijd', to_char(v_tijd, 'HH24:MI')
          )::text;
        end if;
      end if;

      -- Koppel de rit aan de vaart als er een vaarttijd is meegegeven.
      v_vaart := null;
      if nullif(r->>'vaart_tijd', '') is not null then
        select v.id into v_vaart
          from public.vaarten v
          where v.bedrijf_id = v_bedrijf and v.datum = v_datum
            and v.tijd = (r->>'vaart_tijd')::time
            and v.richting = case r->>'richting'
              when 'naar_boot' then 'vertrek'
              when 'van_boot' then 'aankomst'
              else v.richting end
          order by v.dienst
          limit 1;
      end if;

      insert into public.ritten (
        bedrijf_id, datum, tijd, vaart_id, richting, van, naar, modus, personen,
        huisdier, extra_bagage, bagage_stuks, aanhanger, retour_groep, naam,
        telefoon, email, opmerking, prijs_cent, betaalwijze, betaald, bron
      ) values (
        v_bedrijf, v_datum, v_tijd, v_vaart,
        r->>'richting', r->>'van', r->>'naar',
        coalesce(r->>'modus', 'personen'), v_personen,
        coalesce((r->>'huisdier')::boolean, false),
        coalesce((r->>'extra_bagage')::int, 0),
        coalesce((r->>'bagage_stuks')::int, 0),
        v_aanhanger, v_retour,
        r->>'naam', r->>'telefoon',
        nullif(r->>'email', ''), nullif(r->>'opmerking', ''),
        coalesce((r->>'prijs_cent')::int, 0),
        coalesce(r->>'betaalwijze', 'chauffeur'),
        coalesce((r->>'betaald')::boolean, false),
        coalesce(r->>'bron', 'online')
      ) returning id into v_id;
      v_ids := array_append(v_ids, v_id);
    end loop;
  exception when sqlstate 'BG409' then
    -- Eigen afwijzing (vol, dicht of te_veel_boekingen): alle inserts van dit
    -- blok zijn teruggedraaid. Andere fouten vallen door naar de aanroeper.
    return sqlerrm::jsonb;
  end;

  insert into public.gebeurtenissen (bedrijf_id, soort, data)
  values (v_bedrijf, 'boeking_online', jsonb_build_object(
    'rit_ids', to_jsonb(v_ids),
    'retour_groep', v_retour
  ));

  return jsonb_build_object('ok', true, 'rit_ids', to_jsonb(v_ids));
end;
$$;

revoke all on function public.boeking_maak(jsonb) from public;
revoke execute on function public.boeking_maak(jsonb) from anon, authenticated;
grant execute on function public.boeking_maak(jsonb) to service_role;

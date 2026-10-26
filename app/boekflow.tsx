'use client';

// Boekingsflow voor de gast, in vijf stappen met een vaste prijsbalk onderin.
// Beschikbaarheid, prijs en vastlegging komen server-side via /api/dag,
// /api/prijs en /api/boeking; dit bestand bevat alleen weergave en invoer.
//
// Verwachte antwoorden (afgestemd met de API-routes):
//   GET  /api/dag?slug=&datum=&personen=&aanhanger=
//        { bedrijf: { naam, slogan? }, contact: { telefoon, email, adres },
//          capaciteit: { personen }, gratis_bagage_per_persoon?, slots: Slot[],
//          vaarten: (Vaart & { boekbaar: boolean; reden?: string })[] }
//   POST /api/prijs    { slug, invoer: RitInvoer, bagageTotaal }  ->  Prijs
//   POST /api/boeking  { slug, richting, invoer, bagageTotaal, datum, tijd,
//                        vaartTijd?, retourDatum?, retourTijd? of retourTijdOnbekend?,
//                        van, naar, naam, telefoon, email?, opmerking? };
//                      bij 409 { fout?, suggestie?, deel?, reden? }

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BOEKINGSHORIZON_DAGEN } from '@/lib/domein/datum';
import type { Modus, Prijs, Richting, RitInvoer, Slot, Vaart } from '@/lib/domein/typen';

// Terugvalwaarde zolang het dagantwoord nog laadt; daarna geldt capaciteit.personen
// uit de instellingen van het bedrijf (via /api/dag).
const MAX_PERSONEN = 8;
const DAGEN_VOORUIT = BOEKINGSHORIZON_DAGEN;

type VaartKeuze = Vaart & { boekbaar?: boolean; reden?: string };

type DagAntwoord = {
  bedrijf?: { naam?: string; slogan?: string };
  contact?: { telefoon?: string; email?: string; adres?: string };
  capaciteit?: { personen?: number };
  gratis_bagage_per_persoon?: number;
  slots?: Slot[];
  vaarten?: VaartKeuze[];
};

type RetourKeuze = 'nee' | 'met_tijd' | 'wordt_gebeld';

const STAP_TITELS = ['Wat', 'Wanneer', 'Retour', 'Gegevens', 'Overzicht'];

/* ---------- Hulpfuncties ---------- */

/** Centen als "€ 10,00", met komma. */
function euro(cent: number): string {
  const abs = Math.abs(Math.round(cent));
  return `${cent < 0 ? '-' : ''}€ ${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Kloktijd "HH:MM" naar minuten sinds middernacht. */
function naarMin(tijd: string): number {
  const [u, m] = tijd.split(':');
  return Number(u) * 60 + Number(m);
}

/** De datum van vandaag in Nederland (Europe/Amsterdam) als "JJJJ-MM-DD". */
function amsterdamVandaag(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Een datum "JJJJ-MM-DD" plus een aantal dagen, zonder zomertijdverrassingen. */
function datumPlus(datum: string, dagen: number): string {
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + dagen, 12)).toISOString().slice(0, 10);
}

/** Nederlandse weergave van een datum, bijvoorbeeld "zondag 26 oktober". */
function dagLabel(datum: string): string {
  const [j, m, d] = datum.split('-').map(Number);
  return new Intl.DateTimeFormat('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(j, m - 1, d, 12)));
}

function hoofdletter(tekst: string): string {
  return tekst.charAt(0).toUpperCase() + tekst.slice(1);
}

function dienstNaam(dienst: string): string {
  if (dienst === 'veerboot') return 'Veerboot';
  if (dienst === 'sneldienst') return 'Sneldienst';
  return hoofdletter(dienst);
}

/** Of een gekozen tijd nog beschikbaar is in het dagantwoord. */
function tijdBeschikbaar(dag: DagAntwoord, richting: Richting, tijd: string): boolean {
  if (richting === 'locatie') {
    return (dag.slots ?? []).some((s) => s.tijd === tijd && s.status === 'open');
  }
  const gewenst = richting === 'naar_boot' ? 'vertrek' : 'aankomst';
  return (dag.vaarten ?? []).some(
    (v) => v.tijd === tijd && v.richting === gewenst && v.boekbaar !== false
  );
}

async function veiligJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await res.json();
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* ---------- Dagbeschikbaarheid ophalen ---------- */

function useDag(slug: string, datum: string, personen: number, aanhanger: boolean, actief: boolean) {
  const [data, setData] = useState<DagAntwoord | null>(null);
  const [laadt, setLaadt] = useState(false);
  const [fout, setFout] = useState(false);
  const [poging, setPoging] = useState(0);

  useEffect(() => {
    if (!actief) return;
    const stopper = new AbortController();
    setLaadt(true);
    setFout(false);
    const url =
      `/api/dag?slug=${encodeURIComponent(slug)}&datum=${encodeURIComponent(datum)}` +
      `&personen=${personen}&aanhanger=${aanhanger ? 'true' : 'false'}`;
    fetch(url, { signal: stopper.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`dag ${res.status}`);
        const antwoord = (await res.json()) as DagAntwoord;
        setData(antwoord);
        setLaadt(false);
      })
      .catch(() => {
        if (stopper.signal.aborted) return;
        setFout(true);
        setLaadt(false);
      });
    return () => stopper.abort();
  }, [slug, datum, personen, aanhanger, actief, poging]);

  const opnieuw = useCallback(() => setPoging((p) => p + 1), []);
  return { data, laadt, fout, opnieuw };
}

/* ---------- Kleine bouwstenen ---------- */

function Stepper(props: {
  label: string;
  uitleg?: string;
  waarde: number;
  min: number;
  max: number;
  opWaarde: (waarde: number) => void;
}) {
  const { label, uitleg, waarde, min, max, opWaarde } = props;
  return (
    <div className="stepper">
      <span>
        <span className="stepper-label">{label}</span>
        {uitleg !== undefined && <span className="stepper-uitleg">{uitleg}</span>}
      </span>
      <span className="stepper-knoppen" role="group" aria-label={label}>
        <button
          type="button"
          aria-label={`Minder, ${label.toLowerCase()}`}
          disabled={waarde <= min}
          onClick={() => opWaarde(Math.max(min, waarde - 1))}
        >
          &minus;
        </button>
        <span className="stepper-waarde" aria-live="polite">
          {waarde}
        </span>
        <button
          type="button"
          aria-label={`Meer, ${label.toLowerCase()}`}
          disabled={waarde >= max}
          onClick={() => opWaarde(Math.min(max, waarde + 1))}
        >
          +
        </button>
      </span>
    </div>
  );
}

function Schakelaar(props: { titel: string; sub?: string; aan: boolean; opAan: (aan: boolean) => void }) {
  const { titel, sub, aan, opAan } = props;
  return (
    <button type="button" className="schakelaar" role="switch" aria-checked={aan} onClick={() => opAan(!aan)}>
      <span>
        <span className="schakelaar-titel">{titel}</span>
        {sub !== undefined && <span className="schakelaar-sub">{sub}</span>}
      </span>
      <span className="schakelaar-dop" aria-hidden="true" />
    </button>
  );
}

function Keuzes<T extends string>(props: {
  naam: string;
  legenda: string;
  waarde: T;
  opWaarde: (waarde: T) => void;
  opties: { waarde: T; titel: string; sub?: string }[];
}) {
  const { naam, legenda, waarde, opWaarde, opties } = props;
  return (
    <fieldset className="keuzes">
      <legend>{legenda}</legend>
      {opties.map((optie) => (
        <label key={optie.waarde} className={`keuze${waarde === optie.waarde ? ' gekozen' : ''}`}>
          <input
            type="radio"
            name={naam}
            value={optie.waarde}
            checked={waarde === optie.waarde}
            onChange={() => opWaarde(optie.waarde)}
          />
          <span className="keuze-titel">{optie.titel}</span>
          {optie.sub !== undefined && <span className="keuze-sub">{optie.sub}</span>}
        </label>
      ))}
    </fieldset>
  );
}

function TijdKiezer(props: {
  soort: 'slots' | 'vaarten';
  slots: Slot[];
  vaarten: VaartKeuze[];
  laadt: boolean;
  fout: boolean;
  opnieuw: () => void;
  gekozen: string | null;
  opKies: (tijd: string) => void;
  /** Tijden tot en met deze tijd zijn niet te kiezen (terugrit op de dag van de heenrit). */
  minTijd: string | null;
  groepLabel: string;
}) {
  const { soort, slots, vaarten, laadt, fout, opnieuw, gekozen, opKies, minTijd, groepLabel } = props;

  if (laadt) return <p className="stil">De beschikbaarheid wordt geladen&hellip;</p>;
  if (fout) {
    return (
      <div className="melding" role="alert">
        <p>De beschikbaarheid kan niet worden geladen.</p>
        <button type="button" className="knop-klein" onClick={opnieuw}>
          Opnieuw proberen
        </button>
      </div>
    );
  }

  if (soort === 'vaarten') {
    if (vaarten.length === 0) {
      return <p className="stil">Voor deze dag staan er geen vaarten in het systeem. Telefonisch boeken kan altijd.</p>;
    }
    return (
      <div className="vaartlijst" role="group" aria-label={groepLabel}>
        {vaarten.map((vaart) => {
          const teVroeg = minTijd !== null && naarMin(vaart.tijd) <= naarMin(minTijd);
          const boekbaar = vaart.boekbaar !== false && !teVroeg;
          const isGekozen = gekozen === vaart.tijd;
          return (
            <button
              key={`${vaart.dienst}-${vaart.tijd}`}
              type="button"
              className={`vaart${isGekozen ? ' gekozen' : ''}`}
              disabled={!boekbaar}
              aria-pressed={isGekozen}
              onClick={() => opKies(vaart.tijd)}
            >
              <span className="vaart-tijd">{vaart.tijd}</span>
              <span className="vaart-dienst">
                {dienstNaam(vaart.dienst)} &middot;{' '}
                {vaart.richting === 'vertrek' ? 'vertrek van het eiland' : 'aankomst op het eiland'}
              </span>
              {teVroeg && <span className="vaart-reden">Eerder dan de heenrit</span>}
              {!teVroeg && vaart.boekbaar === false && vaart.reden !== undefined && (
                <span className="vaart-reden">{vaart.reden}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  if (slots.length === 0) {
    return <p className="stil">Voor deze dag zijn er geen tijden beschikbaar. Telefonisch boeken kan altijd.</p>;
  }
  return (
    <div className="slotraster" role="group" aria-label={groepLabel}>
      {slots.map((slot) => {
        const teVroeg = minTijd !== null && naarMin(slot.tijd) <= naarMin(minTijd);
        const open = slot.status === 'open' && !teVroeg;
        const isGekozen = gekozen === slot.tijd;
        return (
          <button
            key={slot.tijd}
            type="button"
            className={`slot ${slot.status}${isGekozen ? ' gekozen' : ''}`}
            disabled={!open}
            aria-pressed={isGekozen}
            title={slot.reden}
            onClick={() => opKies(slot.tijd)}
          >
            <span>{slot.tijd}</span>
            {teVroeg ? (
              <span className="slot-status">voor de heenrit</span>
            ) : slot.status === 'vol' ? (
              <span className="slot-status">vol</span>
            ) : slot.status === 'dicht' ? (
              // De reden van een sluiting zichtbaar tonen; een title-attribuut
              // is op een telefoon en op een uitgeschakelde knop onbereikbaar.
              <span className="slot-status">{slot.reden ?? 'niet beschikbaar'}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- De flow ---------- */

export default function Boekflow({ slug }: { slug: string }) {
  const [stap, setStap] = useState(1);
  const [klaar, setKlaar] = useState(false);

  // Stap 1: wat
  const [richting, setRichting] = useState<Richting>('naar_boot');
  const [modus, setModus] = useState<Modus>('personen');
  const [personen, setPersonen] = useState(1);
  const [huisdier, setHuisdier] = useState(false);
  const [bagageTotaal, setBagageTotaal] = useState(0);
  const [bagageStuks, setBagageStuks] = useState(1);
  const [aanhanger, setAanhanger] = useState(false);

  // Stap 2: datum en tijd
  const [datum, setDatum] = useState(() => amsterdamVandaag());
  const [tijd, setTijd] = useState<string | null>(null);
  const [overgenomenHeen, setOvergenomenHeen] = useState<string | null>(null);

  // Stap 3: retour
  const [retourKeuze, setRetourKeuze] = useState<RetourKeuze>('nee');
  const [retourDatum, setRetourDatum] = useState(() => amsterdamVandaag());
  const [retourTijd, setRetourTijd] = useState<string | null>(null);
  const [overgenomenTerug, setOvergenomenTerug] = useState<string | null>(null);

  // Stap 4: gegevens
  const [naam, setNaam] = useState('');
  const [telefoon, setTelefoon] = useState('');
  const [email, setEmail] = useState('');
  const [adresVan, setAdresVan] = useState('');
  const [adresNaar, setAdresNaar] = useState('');
  const [opmerking, setOpmerking] = useState('');

  // Prijs en vastlegging
  const [prijs, setPrijs] = useState<Prijs | null>(null);
  const [bezig, setBezig] = useState(false);
  const [boekFout, setBoekFout] = useState<string | null>(null);
  const [suggestie, setSuggestie] = useState<{ tijd: string; deel: 'heen' | 'terug' } | null>(null);
  const [bevestiging, setBevestiging] = useState<string | null>(null);

  const dagen = useMemo(() => {
    const vandaag = amsterdamVandaag();
    return Array.from({ length: DAGEN_VOORUIT }, (_, i) => {
      const d = datumPlus(vandaag, i);
      const label = dagLabel(d);
      const tekst = i === 0 ? `Vandaag (${label})` : i === 1 ? `Morgen (${label})` : hoofdletter(label);
      return { datum: d, tekst };
    });
  }, []);

  // Lading voor de capaciteitscontrole van /api/dag.
  const ladingPersonen = modus === 'personen' ? personen : 0;
  const ladingAanhanger = modus === 'aanhanger' ? true : modus === 'personen' && aanhanger;

  const heen = useDag(slug, datum, ladingPersonen, ladingAanhanger, true);
  const terug = useDag(slug, retourDatum, ladingPersonen, ladingAanhanger, retourKeuze === 'met_tijd');

  const terugRichting: Richting =
    richting === 'naar_boot' ? 'van_boot' : richting === 'van_boot' ? 'naar_boot' : 'locatie';

  const heenVaarten = useMemo(() => {
    const gewenst = richting === 'naar_boot' ? 'vertrek' : 'aankomst';
    return (heen.data?.vaarten ?? []).filter((v) => v.richting === gewenst);
  }, [heen.data, richting]);

  const terugVaarten = useMemo(() => {
    const gewenst = terugRichting === 'naar_boot' ? 'vertrek' : 'aankomst';
    return (terug.data?.vaarten ?? []).filter((v) => v.richting === gewenst);
  }, [terug.data, terugRichting]);

  // Een gekozen tijd vervalt wanneer die na een verversing niet meer beschikbaar is.
  useEffect(() => {
    const dag = heen.data;
    if (dag === null) return;
    setTijd((huidige) =>
      huidige === null || huidige === overgenomenHeen || tijdBeschikbaar(dag, richting, huidige)
        ? huidige
        : null
    );
  }, [heen.data, richting, overgenomenHeen]);

  useEffect(() => {
    const dag = terug.data;
    if (dag === null || retourKeuze !== 'met_tijd') return;
    setRetourTijd((huidige) =>
      huidige === null || huidige === overgenomenTerug || tijdBeschikbaar(dag, terugRichting, huidige)
        ? huidige
        : null
    );
  }, [terug.data, terugRichting, retourKeuze, overgenomenTerug]);

  // Prijs live via POST /api/prijs, met een korte debounce. De server rekent
  // de vrijstelling zelf uit bagageTotaal; extraBagage hier is alleen weergave.
  const gratisPerPersoon = heen.data?.gratis_bagage_per_persoon ?? 2;
  const extraBagage = modus === 'personen' ? Math.max(0, bagageTotaal - gratisPerPersoon * personen) : 0;
  const bagageTotaalRit = modus === 'personen' ? bagageTotaal : 0;
  const retour = retourKeuze !== 'nee';

  const invoer: RitInvoer = useMemo(
    () => ({
      modus,
      personen: modus === 'personen' ? personen : 0,
      huisdier: modus === 'personen' && huisdier,
      extraBagage,
      bagageStuks: modus === 'bagage' ? bagageStuks : 0,
      aanhanger: ladingAanhanger,
      retour,
    }),
    [modus, personen, huisdier, extraBagage, bagageStuks, ladingAanhanger, retour]
  );

  useEffect(() => {
    const stopper = new AbortController();
    const timer = setTimeout(() => {
      fetch('/api/prijs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, invoer, bagageTotaal: bagageTotaalRit }),
        signal: stopper.signal,
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as Prijs;
          if (typeof data.totaalCent === 'number' && Array.isArray(data.regels)) setPrijs(data);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      stopper.abort();
    };
  }, [slug, invoer, bagageTotaalRit]);

  /* ----- Afgeleiden en handelingen ----- */

  const bedrijfsnaam = heen.data?.bedrijf?.naam ?? null;
  const slogan = heen.data?.bedrijf?.slogan ?? null;
  const telefoonBedrijf = heen.data?.contact?.telefoon ?? null;
  // De buscapaciteit komt uit de instellingen van het bedrijf, niet uit de code.
  const maxPersonen = heen.data?.capaciteit?.personen ?? MAX_PERSONEN;

  const adresVanNodig = richting !== 'van_boot';
  const adresNaarNodig = richting !== 'naar_boot';
  // Zelfde regel als de server: 10 tot 13 cijfers, eventueel met een plus ervoor.
  const telefoonOk = /^\+?\d{10,13}$/.test(telefoon.replace(/[\s-]/g, ''));
  const gegevensOk =
    naam.trim().length > 1 &&
    telefoonOk &&
    (!adresVanNodig || adresVan.trim() !== '') &&
    (!adresNaarNodig || adresNaar.trim() !== '');

  const magVerder =
    stap === 1
      ? true
      : stap === 2
        ? tijd !== null
        : stap === 3
          ? retourKeuze !== 'met_tijd' || retourTijd !== null
          : stap === 4
            ? gegevensOk
            : true;

  function wijzigRichting(nieuw: Richting) {
    setRichting(nieuw);
    setTijd(null);
    setRetourTijd(null);
    setOvergenomenHeen(null);
    setOvergenomenTerug(null);
  }

  function wijzigDatum(nieuw: string) {
    setDatum(nieuw);
    setTijd(null);
    setOvergenomenHeen(null);
    if (retourDatum < nieuw) {
      setRetourDatum(nieuw);
      setRetourTijd(null);
      setOvergenomenTerug(null);
    }
  }

  function wijzigRetourDatum(nieuw: string) {
    setRetourDatum(nieuw);
    setRetourTijd(null);
    setOvergenomenTerug(null);
  }

  function kiesTijd(nieuw: string) {
    setTijd(nieuw);
    setOvergenomenHeen(null);
  }

  function kiesRetourTijd(nieuw: string) {
    setRetourTijd(nieuw);
    setOvergenomenTerug(null);
  }

  function neemSuggestieOver() {
    if (suggestie === null) return;
    if (suggestie.deel === 'terug') {
      setRetourTijd(suggestie.tijd);
      setOvergenomenTerug(suggestie.tijd);
    } else {
      setTijd(suggestie.tijd);
      setOvergenomenHeen(suggestie.tijd);
    }
    setSuggestie(null);
    setBoekFout(null);
  }

  function watMeeTekst(): string {
    if (modus === 'bagage') return `Alleen bagage, ${bagageStuks} ${bagageStuks === 1 ? 'stuk' : 'stuks'}`;
    if (modus === 'aanhanger') return 'Alleen een aanhanger';
    const delen = [`${personen} ${personen === 1 ? 'persoon' : 'personen'}`];
    if (huisdier) delen.push('huisdier');
    if (bagageTotaal > 0) delen.push(`${bagageTotaal} ${bagageTotaal === 1 ? 'stuk' : 'stuks'} bagage`);
    if (aanhanger) delen.push('aanhanger');
    return delen.join(', ');
  }

  function richtingLabel(r: Richting): string {
    if (r === 'naar_boot') return 'Naar de boot';
    if (r === 'van_boot') return 'Van de boot';
    return 'Op het eiland, tussen twee adressen';
  }

  function boekingBody() {
    const gekozenVaart = richting === 'locatie' ? null : (heenVaarten.find((v) => v.tijd === tijd) ?? null);
    return {
      slug,
      richting,
      invoer,
      bagageTotaal: bagageTotaalRit,
      datum,
      tijd,
      ...(gekozenVaart === null ? {} : { vaartTijd: gekozenVaart.tijd }),
      ...(retourKeuze === 'nee'
        ? {}
        : retourKeuze === 'met_tijd'
          ? { retourDatum, retourTijd }
          : { retourDatum, retourTijdOnbekend: true }),
      // Bij een bootrit vult de server de veerdamkant van het adres in.
      van: adresVan.trim(),
      naar: adresNaar.trim(),
      naam: naam.trim(),
      telefoon: telefoon.trim(),
      email: email.trim() === '' ? null : email.trim(),
      opmerking: opmerking.trim() === '' ? null : opmerking.trim(),
    };
  }

  async function legVast() {
    if (bezig || tijd === null) return;
    setBezig(true);
    setBoekFout(null);
    setSuggestie(null);
    try {
      const res = await fetch('/api/boeking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(boekingBody()),
      });
      if (res.status === 409) {
        const data = await veiligJson(res);
        const voorstel = typeof data?.suggestie === 'string' ? data.suggestie : null;
        if (voorstel !== null) {
          setSuggestie({ tijd: voorstel, deel: data?.deel === 'terug' ? 'terug' : 'heen' });
        } else if (typeof data?.reden === 'string') {
          setBoekFout(data.reden);
        } else if (data?.fout === 'dicht') {
          setBoekFout('Dat moment is gesloten voor online boeken. Een andere tijd kiezen of telefonisch boeken.');
        } else {
          setBoekFout('Dat moment is vol. Een andere tijd kiezen of telefonisch boeken.');
        }
        return;
      }
      if (!res.ok) {
        const data = await veiligJson(res);
        const code = typeof data?.fout === 'string' ? data.fout : null;
        setBoekFout(
          code === 'tijd_verstreken'
            ? 'De gekozen tijd is inmiddels verstreken. Een latere tijd kiezen.'
            : code === 'buiten_opening'
              ? 'De gekozen tijd valt buiten de openingstijden. Een andere tijd kiezen of telefonisch boeken.'
              : code === 'vaart_onbekend'
                ? 'De gekozen vaart is niet meer beschikbaar. Een andere tijd kiezen.'
                : code === 'te_veel_boekingen'
                  ? 'Voor dit telefoonnummer staan er al meerdere ritten op die dag. Meer ritten boeken kan telefonisch.'
                  : 'Het vastleggen is niet gelukt. Later opnieuw proberen of telefonisch boeken.'
        );
        return;
      }
      const data = await veiligJson(res);
      setBevestiging(typeof data?.bevestiging === 'string' ? data.bevestiging : null);
      setKlaar(true);
    } catch {
      setBoekFout('Het vastleggen is niet gelukt door een netwerkfout. Later opnieuw proberen of telefonisch boeken.');
    } finally {
      setBezig(false);
    }
  }

  function nogEenRit() {
    setKlaar(false);
    setStap(1);
    setTijd(null);
    setOvergenomenHeen(null);
    setRetourKeuze('nee');
    setRetourTijd(null);
    setOvergenomenTerug(null);
    setBoekFout(null);
    setSuggestie(null);
    setBevestiging(null);
  }

  const heenTekst =
    tijd === null
      ? hoofdletter(dagLabel(datum))
      : (() => {
          const vaart = richting === 'locatie' ? null : (heenVaarten.find((v) => v.tijd === tijd) ?? null);
          const basis = `${hoofdletter(dagLabel(datum))} om ${tijd}`;
          return vaart === null ? basis : `${basis}, ${dienstNaam(vaart.dienst)}`;
        })();

  const terugTekst =
    retourKeuze === 'nee'
      ? null
      : retourKeuze === 'wordt_gebeld'
        ? `${hoofdletter(dagLabel(retourDatum))}, er wordt gebeld voor de terugtijd`
        : retourTijd === null
          ? hoofdletter(dagLabel(retourDatum))
          : `${hoofdletter(dagLabel(retourDatum))} om ${retourTijd}`;

  /* ----- Weergave ----- */

  return (
    <div className="pagina">
      <header>
        <p className="kop-merk">{bedrijfsnaam ?? ''}</p>
        <h1>Rit boeken</h1>
      </header>

      {klaar ? (
        <main>
          <section className="kaart bevestiging">
            <h2>De rit is vastgelegd</h2>
            {bevestiging !== null && <p>{bevestiging}</p>}
            {/* Zodra de sms via Spryng echt wordt verstuurd (fase 3), hier de sms-tekst terugzetten. */}
            <p>De rit staat genoteerd. Bij wijzigingen wordt gebeld op {telefoon.trim()}.</p>
            <p>Betalen kan bij de chauffeur. Betalen met iDEAL volgt binnenkort.</p>
            {retourKeuze === 'wordt_gebeld' && <p>Er wordt gebeld om de terugtijd af te stemmen.</p>}
            <dl className="overzicht">
              <div>
                <dt>Rit</dt>
                <dd>{richtingLabel(richting)}</dd>
              </div>
              <div>
                <dt>Heen</dt>
                <dd>{heenTekst}</dd>
              </div>
              {terugTekst !== null && (
                <div>
                  <dt>Terug</dt>
                  <dd>{terugTekst}</dd>
                </div>
              )}
              {prijs !== null && (
                <div>
                  <dt>Totaal</dt>
                  <dd>{euro(prijs.totaalCent)}</dd>
                </div>
              )}
            </dl>
            <button type="button" className="knop knop-secundair" onClick={nogEenRit}>
              Nog een rit boeken
            </button>
          </section>
        </main>
      ) : (
        <main>
          <nav className="stappen" aria-label="Voortgang">
            <p className="stappen-tekst">
              Stap {stap} van 5 &middot; {STAP_TITELS[stap - 1]}
            </p>
            <div className="stappen-balkjes" aria-hidden="true">
              {STAP_TITELS.map((titel, i) => (
                <span key={titel} className={`stapbalkje${i + 1 <= stap ? ' gedaan' : ''}`} />
              ))}
            </div>
          </nav>

          {stap === 1 && (
            <>
              <section className="kaart">
                <h2>De rit</h2>
                <Keuzes<Richting>
                  naam="richting"
                  legenda="Waar de rit heen gaat"
                  waarde={richting}
                  opWaarde={wijzigRichting}
                  opties={[
                    { waarde: 'naar_boot', titel: 'Naar de boot', sub: 'Van een adres op het eiland naar de veerdam' },
                    { waarde: 'van_boot', titel: 'Van de boot', sub: 'Van de veerdam naar een adres op het eiland' },
                    { waarde: 'locatie', titel: 'Op het eiland', sub: 'Tussen twee adressen op het eiland' },
                  ]}
                />
              </section>
              <section className="kaart">
                <h2>Wat er mee gaat</h2>
                <Keuzes<Modus>
                  naam="modus"
                  legenda="Soort vervoer"
                  waarde={modus}
                  opWaarde={setModus}
                  opties={[
                    { waarde: 'personen', titel: 'Personen', sub: 'Met eventueel bagage, huisdier of aanhanger' },
                    { waarde: 'bagage', titel: 'Alleen bagage', sub: 'Bagagevervoer zonder passagiers' },
                    { waarde: 'aanhanger', titel: 'Alleen een aanhanger', sub: 'Bijvoorbeeld voor fietsen' },
                  ]}
                />
                {modus === 'personen' && (
                  <>
                    <Stepper label="Personen" waarde={personen} min={1} max={maxPersonen} opWaarde={setPersonen} />
                    <Schakelaar titel="Huisdier mee" aan={huisdier} opAan={setHuisdier} />
                    <Stepper
                      label="Bagage, totaal aantal stuks"
                      uitleg={`Per persoon ${gratisPerPersoon === 1 ? 'gaat 1 stuk' : `gaan ${gratisPerPersoon} stuks`} gratis mee`}
                      waarde={bagageTotaal}
                      min={0}
                      max={24}
                      opWaarde={setBagageTotaal}
                    />
                    {extraBagage > 0 && (
                      <p className="stil">
                        {extraBagage === 1 ? '1 stuk telt' : `${extraBagage} stuks tellen`} als extra bagage.
                      </p>
                    )}
                    <Schakelaar
                      titel="Aanhanger mee"
                      sub="Voor fietsen of grote bagage"
                      aan={aanhanger}
                      opAan={setAanhanger}
                    />
                  </>
                )}
                {modus === 'bagage' && (
                  <Stepper
                    label="Aantal bagagestukken"
                    waarde={bagageStuks}
                    min={1}
                    max={30}
                    opWaarde={setBagageStuks}
                  />
                )}
                {modus === 'aanhanger' && <p className="stil">Eén aanhanger per rit, bijvoorbeeld voor fietsen.</p>}
              </section>
            </>
          )}

          {stap === 2 && (
            <section className="kaart">
              <h2>Datum en tijd</h2>
              <label className="veld">
                <span className="veld-label">Datum</span>
                <select value={datum} onChange={(e) => wijzigDatum(e.target.value)}>
                  {dagen.map((dag) => (
                    <option key={dag.datum} value={dag.datum}>
                      {dag.tekst}
                    </option>
                  ))}
                </select>
              </label>
              {richting === 'locatie' ? (
                <TijdKiezer
                  soort="slots"
                  slots={heen.data?.slots ?? []}
                  vaarten={[]}
                  laadt={heen.laadt}
                  fout={heen.fout}
                  opnieuw={heen.opnieuw}
                  gekozen={tijd}
                  opKies={kiesTijd}
                  minTijd={null}
                  groepLabel="Tijd van de rit"
                />
              ) : (
                <>
                  <p className="uitleg">
                    {richting === 'naar_boot'
                      ? 'De keuze is de afvaart. De taxi haalt ruim voor vertrek op; de ophaaltijd staat in de bevestiging.'
                      : 'De keuze is de aankomst van de boot. De taxi staat bij de veerdam klaar.'}
                  </p>
                  <TijdKiezer
                    soort="vaarten"
                    slots={[]}
                    vaarten={heenVaarten}
                    laadt={heen.laadt}
                    fout={heen.fout}
                    opnieuw={heen.opnieuw}
                    gekozen={tijd}
                    opKies={kiesTijd}
                    minTijd={null}
                    groepLabel="Vaarten"
                  />
                </>
              )}
              {tijd === null && !heen.laadt && !heen.fout && (
                <p className="stil">Een tijd kiezen om verder te kunnen.</p>
              )}
            </section>
          )}

          {stap === 3 && (
            <section className="kaart">
              <h2>Retour</h2>
              <Keuzes<RetourKeuze>
                naam="retour"
                legenda="Ook een terugrit"
                waarde={retourKeuze}
                opWaarde={setRetourKeuze}
                opties={[
                  { waarde: 'nee', titel: 'Geen retour', sub: 'Alleen de enkele rit' },
                  { waarde: 'met_tijd', titel: 'Retour met datum en tijd', sub: 'Heen en terug; de prijs telt dubbel' },
                  {
                    waarde: 'wordt_gebeld',
                    titel: 'Retour, terugtijd nog onbekend',
                    sub: 'Er wordt gebeld om de terugtijd af te stemmen; de prijs telt dubbel',
                  },
                ]}
              />
              {retourKeuze !== 'nee' && (
                <label className="veld">
                  <span className="veld-label">Terugrit, datum</span>
                  <select value={retourDatum} onChange={(e) => wijzigRetourDatum(e.target.value)}>
                    {dagen
                      .filter((dag) => dag.datum >= datum)
                      .map((dag) => (
                        <option key={dag.datum} value={dag.datum}>
                          {dag.tekst}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {retourKeuze === 'met_tijd' && (
                <>
                  {terugRichting === 'locatie' ? (
                    <TijdKiezer
                      soort="slots"
                      slots={terug.data?.slots ?? []}
                      vaarten={[]}
                      laadt={terug.laadt}
                      fout={terug.fout}
                      opnieuw={terug.opnieuw}
                      gekozen={retourTijd}
                      opKies={kiesRetourTijd}
                      minTijd={retourDatum === datum ? tijd : null}
                      groepLabel="Tijd van de terugrit"
                    />
                  ) : (
                    <>
                      <p className="uitleg">
                        {terugRichting === 'naar_boot'
                          ? 'De terugrit gaat naar de boot; de keuze is de afvaart.'
                          : 'De terugrit gaat van de boot; de keuze is de aankomst.'}
                      </p>
                      <TijdKiezer
                        soort="vaarten"
                        slots={[]}
                        vaarten={terugVaarten}
                        laadt={terug.laadt}
                        fout={terug.fout}
                        opnieuw={terug.opnieuw}
                        gekozen={retourTijd}
                        opKies={kiesRetourTijd}
                        minTijd={retourDatum === datum ? tijd : null}
                        groepLabel="Vaarten voor de terugrit"
                      />
                    </>
                  )}
                  {retourTijd === null && !terug.laadt && !terug.fout && (
                    <p className="stil">Een terugtijd kiezen om verder te kunnen.</p>
                  )}
                </>
              )}
            </section>
          )}

          {stap === 4 && (
            <section className="kaart">
              <h2>Gegevens</h2>
              <label className="veld">
                <span className="veld-label">Naam</span>
                <input value={naam} onChange={(e) => setNaam(e.target.value)} autoComplete="name" required />
              </label>
              <label className="veld">
                <span className="veld-label">Mobiel nummer</span>
                <span className="veld-uitleg">Voor contact over de rit</span>
                <input
                  type="tel"
                  inputMode="tel"
                  value={telefoon}
                  onChange={(e) => setTelefoon(e.target.value)}
                  autoComplete="tel"
                  required
                />
              </label>
              <label className="veld">
                <span className="veld-label">E-mailadres (niet verplicht)</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </label>
              {adresVanNodig && (
                <label className="veld">
                  <span className="veld-label">Ophaaladres op het eiland</span>
                  <input
                    value={adresVan}
                    onChange={(e) => setAdresVan(e.target.value)}
                    autoComplete="street-address"
                    required
                  />
                </label>
              )}
              {adresNaarNodig && (
                <label className="veld">
                  <span className="veld-label">Bestemming op het eiland</span>
                  <input value={adresNaar} onChange={(e) => setAdresNaar(e.target.value)} required />
                </label>
              )}
              <label className="veld">
                <span className="veld-label">Opmerking (niet verplicht)</span>
                <textarea rows={3} value={opmerking} onChange={(e) => setOpmerking(e.target.value)} />
              </label>
              {!gegevensOk && (
                <p className="stil">
                  Naam, mobiel nummer{adresVanNodig ? ', ophaaladres' : ''}
                  {adresNaarNodig ? ' en bestemming' : ''} zijn nodig voor de boeking.
                </p>
              )}
            </section>
          )}

          {stap === 5 && (
            <section className="kaart">
              <h2>Overzicht</h2>
              <dl className="overzicht">
                <div>
                  <dt>Rit</dt>
                  <dd>{richtingLabel(richting)}</dd>
                </div>
                <div>
                  <dt>Mee</dt>
                  <dd>{watMeeTekst()}</dd>
                </div>
                <div>
                  <dt>Heen</dt>
                  <dd>{heenTekst}</dd>
                </div>
                {terugTekst !== null && (
                  <div>
                    <dt>Terug</dt>
                    <dd>{terugTekst}</dd>
                  </div>
                )}
                {adresVan.trim() !== '' && (
                  <div>
                    <dt>Ophalen</dt>
                    <dd>{adresVan.trim()}</dd>
                  </div>
                )}
                {adresNaar.trim() !== '' && (
                  <div>
                    <dt>Naar</dt>
                    <dd>{adresNaar.trim()}</dd>
                  </div>
                )}
                <div>
                  <dt>Naam</dt>
                  <dd>{naam.trim()}</dd>
                </div>
                <div>
                  <dt>Mobiel</dt>
                  <dd>{telefoon.trim()}</dd>
                </div>
                {email.trim() !== '' && (
                  <div>
                    <dt>E-mail</dt>
                    <dd>{email.trim()}</dd>
                  </div>
                )}
                {opmerking.trim() !== '' && (
                  <div>
                    <dt>Opmerking</dt>
                    <dd>{opmerking.trim()}</dd>
                  </div>
                )}
              </dl>
              {prijs !== null ? (
                <ul className="prijsregels" aria-label="Prijsregels">
                  {prijs.regels.map((regel, i) => (
                    <li key={`${regel.label}-${i}`}>
                      <span>{regel.label}</span>
                      <span>{euro(regel.bedragCent)}</span>
                    </li>
                  ))}
                  <li className="prijsregels-totaal">
                    <span>Totaal</span>
                    <span>{euro(prijs.totaalCent)}</span>
                  </li>
                </ul>
              ) : (
                <p className="stil">De prijs wordt berekend&hellip;</p>
              )}
              {suggestie !== null && (
                <div className="melding" role="alert">
                  <p>
                    {suggestie.deel === 'terug' ? 'De terugtijd is vol.' : 'Dat moment is vol.'} Eerstvolgende tijd met
                    ruimte: {suggestie.tijd}.
                  </p>
                  <button type="button" className="knop-klein" onClick={neemSuggestieOver}>
                    Die tijd overnemen
                  </button>
                </div>
              )}
              {boekFout !== null && suggestie === null && (
                <div className="melding" role="alert">
                  <p>{boekFout}</p>
                </div>
              )}
              <p className="stil">Betalen kan bij de chauffeur. Betalen met iDEAL volgt binnenkort.</p>
            </section>
          )}
        </main>
      )}

      <footer className="voettekst">
        {bedrijfsnaam !== null && <p className="voettekst-naam">{bedrijfsnaam}</p>}
        {slogan !== null && <p>{slogan}</p>}
        {telefoonBedrijf !== null && telefoonBedrijf !== '' && (
          <p>
            Telefonisch boeken kan altijd: <a href={`tel:${telefoonBedrijf}`}>{telefoonBedrijf}</a>
          </p>
        )}
      </footer>

      {!klaar && (
        <div className="prijsbalk">
          <div className="prijsbalk-binnen">
            <div aria-live="polite">
              <span className="prijsbalk-label">Totaal{retour ? ', retour' : ''}</span>
              <span className="prijsbalk-bedrag">{prijs !== null ? euro(prijs.totaalCent) : '…'}</span>
            </div>
            <div className="prijsbalk-knoppen">
              {stap > 1 && (
                <button type="button" className="knop knop-secundair" onClick={() => setStap(stap - 1)}>
                  Terug
                </button>
              )}
              {stap < 5 ? (
                <button
                  type="button"
                  className="knop knop-primair"
                  disabled={!magVerder}
                  onClick={() => setStap(stap + 1)}
                >
                  Verder
                </button>
              ) : (
                <button
                  type="button"
                  className="knop knop-primair"
                  disabled={bezig || tijd === null}
                  onClick={legVast}
                >
                  {bezig ? 'Bezig met vastleggen…' : 'Rit vastleggen'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

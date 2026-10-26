// Tests voor de domeinregels (zie CLAUDE.md): prijs, capaciteit per glijdend
// venster, eerstvolgende vrije tijd, kwartierslots en boekbaarheid van vaarten.
// De regels zijn leidend, niet de toevallige implementatie.

import { describe, expect, it } from 'vitest';
import { toMin } from '../lib/domein/tijd';
import { datumPlus, geldigeDatum } from '../lib/domein/datum';
import { berekenPrijs, extraBagageBoven } from '../lib/domein/prijs';
import {
  bezettingIn,
  dagSlots,
  vaartBoekbaar,
  vindConflict,
  volgendeVrijeTijd,
} from '../lib/domein/beschikbaarheid';
import type {
  Boekregels,
  Capaciteit,
  Instellingen,
  Opening,
  RitInvoer,
  RitLicht,
  Sluiting,
  Tarieven,
  Vaart,
} from '../lib/domein/typen';

// Dezelfde waarden als de seed van Taxi Schiermonnikoog.
const TARIEVEN: Tarieven = {
  eerste_persoon: 1000,
  extra_persoon: 650,
  huisdier: 550,
  gratis_bagage_per_persoon: 2,
  extra_bagagestuk: 550,
  los_bagagestuk: 550,
  aanhanger: 2000,
};
const CAPACITEIT: Capaciteit = { personen: 8, aanhangers: 1, venster_min: 15 };
const OPENING: Opening = { van: '09:00', tot: '21:30' };
const BOEKREGELS: Boekregels = {
  naar_boot_online_tot_min_voor_vertrek: 45,
  eerste_boot_online: false,
  vanaf_boot_altijd: true,
  tussen_boten: 'alleen_als_het_past',
  op_rekening_alleen_telefonisch: true,
};
const INSTELLINGEN: Instellingen = {
  tarieven_cent: TARIEVEN,
  capaciteit: CAPACITEIT,
  opening: OPENING,
  boekregels: BOEKREGELS,
  zones: {
    volgorde: ['haven', 'dorp', 'strand', 'oost'],
    rijtijd_min: {
      haven: { haven: 0, dorp: 5, strand: 10, oost: 15 },
      dorp: { haven: 5, dorp: 0, strand: 5, oost: 10 },
      strand: { haven: 10, dorp: 5, strand: 0, oost: 10 },
      oost: { haven: 15, dorp: 10, strand: 10, oost: 0 },
    },
  },
  spits: {
    dagen: ['vrijdag', 'maandag'],
    vertrek_lauwersoog: ['09:35', '12:35', '15:35'],
    marge_voor_afvaart_min: 5,
  },
  contact: { telefoon: '0519531444', email: 'info@voorbeeld.nl', adres: 'Veerdam 1' },
  berichten: { bevestiging_klad: '', daglijst_tijd: '07:00' },
  huisstijl: { merkblauw: '#123144' },
};

function invoer(deel: Partial<RitInvoer>): RitInvoer {
  return {
    modus: 'personen',
    personen: 1,
    huisdier: false,
    extraBagage: 0,
    bagageStuks: 0,
    aanhanger: false,
    retour: false,
    ...deel,
  };
}

function rit(tijd: string | null, personen: number, aanhanger = false, status = 'gepland'): RitLicht {
  return { tijd, personen, aanhanger, status };
}

function somRegels(prijs: { regels: { bedragCent: number }[] }): number {
  return prijs.regels.reduce((som, regel) => som + regel.bedragCent, 0);
}

describe('berekenPrijs (domeinregel 5)', () => {
  it('rekent modus personen: eerste persoon plus extra personen', () => {
    expect(berekenPrijs(invoer({ personen: 1 }), TARIEVEN).totaalCent).toBe(1000);
    const drie = berekenPrijs(invoer({ personen: 3 }), TARIEVEN);
    expect(drie.totaalCent).toBe(1000 + 2 * 650);
    expect(somRegels(drie)).toBe(drie.totaalCent);
  });

  it('houdt de bagagegrens aan: 3 personen met 6 stuks gratis, het 7e stuk betaalt', () => {
    expect(extraBagageBoven(6, 3, TARIEVEN)).toBe(0);
    expect(extraBagageBoven(7, 3, TARIEVEN)).toBe(1);
    const zonder = berekenPrijs(invoer({ personen: 3, extraBagage: extraBagageBoven(6, 3, TARIEVEN) }), TARIEVEN);
    expect(zonder.totaalCent).toBe(2300);
    const met = berekenPrijs(invoer({ personen: 3, extraBagage: extraBagageBoven(7, 3, TARIEVEN) }), TARIEVEN);
    expect(met.totaalCent).toBe(2300 + 550);
  });

  it('telt huisdier en aanhanger mee', () => {
    const prijs = berekenPrijs(invoer({ personen: 2, huisdier: true, aanhanger: true }), TARIEVEN);
    expect(prijs.totaalCent).toBe(1000 + 650 + 550 + 2000);
    expect(somRegels(prijs)).toBe(prijs.totaalCent);
  });

  it('rekent modus bagage per los stuk, met minimaal 1 stuk', () => {
    const vier = berekenPrijs(invoer({ modus: 'bagage', personen: 0, bagageStuks: 4 }), TARIEVEN);
    expect(vier.totaalCent).toBe(4 * 550);
    expect(somRegels(vier)).toBe(vier.totaalCent);
    expect(berekenPrijs(invoer({ modus: 'bagage', personen: 0, bagageStuks: 0 }), TARIEVEN).totaalCent).toBe(550);
  });

  it('rekent modus aanhanger alleen het aanhangertarief', () => {
    const prijs = berekenPrijs(invoer({ modus: 'aanhanger', personen: 0 }), TARIEVEN);
    expect(prijs.totaalCent).toBe(2000);
    expect(somRegels(prijs)).toBe(prijs.totaalCent);
  });

  it('verdubbelt het geheel bij retour, met kloppende regels', () => {
    const prijs = berekenPrijs(invoer({ personen: 2, retour: true }), TARIEVEN);
    expect(prijs.totaalCent).toBe(2 * (1000 + 650));
    expect(prijs.regels[prijs.regels.length - 1].bedragCent).toBe(1000 + 650);
    expect(somRegels(prijs)).toBe(prijs.totaalCent);
  });
});

describe('bezettingIn en vindConflict (domeinregel 1)', () => {
  it('telt ritten binnen het venster: 14 minuten verschil telt mee, 15 niet', () => {
    const ritten = [rit('10:00', 4)];
    expect(bezettingIn(ritten, '10:14', 15).personen).toBe(4);
    expect(bezettingIn(ritten, '10:15', 15).personen).toBe(0);
    expect(bezettingIn(ritten, '09:46', 15).personen).toBe(4);
    expect(bezettingIn(ritten, '09:45', 15).personen).toBe(0);
  });

  it('telt afgeronde en geannuleerde ritten en ritten zonder tijd niet mee', () => {
    const ritten = [
      rit('10:00', 3, false, 'afgerond'),
      rit('10:00', 3, false, 'geannuleerd'),
      rit(null, 3),
      rit('10:00', 2, false, 'onderweg'),
    ];
    expect(bezettingIn(ritten, '10:00', 15).personen).toBe(2);
  });

  it('vol is vol: 8 personen passen precies, de 9e niet', () => {
    const zeven = [rit('10:00', 4), rit('10:05', 3)];
    expect(vindConflict(zeven, '10:10', { personen: 1, aanhanger: false }, CAPACITEIT)).toBeNull();
    const acht = [rit('10:00', 4), rit('10:05', 4)];
    const conflict = vindConflict(acht, '10:10', { personen: 1, aanhanger: false }, CAPACITEIT);
    expect(conflict).not.toBeNull();
    expect(conflict?.teVeelPersonen).toBe(true);
    // Buiten het venster is er geen conflict.
    expect(vindConflict(acht, '10:20', { personen: 1, aanhanger: false }, CAPACITEIT)).toBeNull();
  });

  it('weigert een tweede aanhanger in hetzelfde venster', () => {
    const ritten = [rit('10:00', 2, true)];
    const conflict = vindConflict(ritten, '10:05', { personen: 1, aanhanger: true }, CAPACITEIT);
    expect(conflict).not.toBeNull();
    expect(conflict?.teVeelAanhangers).toBe(true);
    expect(vindConflict(ritten, '10:05', { personen: 1, aanhanger: false }, CAPACITEIT)).toBeNull();
  });
});

describe('volgendeVrijeTijd (domeinregel 2)', () => {
  const vol = [rit('10:00', 8)];
  const nieuw = { personen: 1, aanhanger: false };

  it('vindt het eerste gat in stappen van 5 minuten', () => {
    expect(volgendeVrijeTijd(vol, [], '10:00', nieuw, CAPACITEIT, OPENING)).toBe('10:15');
  });

  it('slaat een sluiting over', () => {
    const sluitingen: Sluiting[] = [{ van: '10:15', tot: '11:00', reden: 'privérit' }];
    expect(volgendeVrijeTijd(vol, sluitingen, '10:00', nieuw, CAPACITEIT, OPENING)).toBe('11:00');
  });

  it('geeft null buiten de opening', () => {
    expect(volgendeVrijeTijd([], [], '21:35', nieuw, CAPACITEIT, OPENING)).toBeNull();
  });
});

describe('dagSlots (domeinregel 3)', () => {
  const nieuw = { personen: 1, aanhanger: false };

  function slots(opts: { ritten?: RitLicht[]; sluitingen?: Sluiting[]; verstrekenTotMin?: number }) {
    return dagSlots({
      ritten: opts.ritten ?? [],
      sluitingen: opts.sluitingen ?? [],
      instellingen: INSTELLINGEN,
      nieuw,
      verstrekenTotMin: opts.verstrekenTotMin,
    });
  }

  it('maakt kwartierslots van opening.van tot en met opening.tot', () => {
    const dag = slots({});
    expect(dag.length).toBe(51);
    expect(dag[0].tijd).toBe('09:00');
    expect(dag[dag.length - 1].tijd).toBe('21:30');
    expect(dag.every((s) => s.status === 'open')).toBe(true);
  });

  it('markeert een vol venster als vol', () => {
    const dag = slots({ ritten: [rit('10:30', 8)] });
    expect(dag.find((s) => s.tijd === '10:30')?.status).toBe('vol');
    expect(dag.find((s) => s.tijd === '10:45')?.status).toBe('open');
  });

  it('laat dicht winnen van vol, met de reden van de sluiting', () => {
    const dag = slots({
      ritten: [rit('10:00', 8)],
      sluitingen: [{ van: '10:00', tot: '10:15', reden: 'privérit' }],
    });
    const slot = dag.find((s) => s.tijd === '10:00');
    expect(slot?.status).toBe('dicht');
    expect(slot?.reden).toBe('privérit');
    // De sluiting is halfopen: om 10:15 geldt die niet meer.
    expect(dag.find((s) => s.tijd === '10:15')?.status).toBe('open');
  });

  it('maakt verstreken tijdstippen van vandaag dicht', () => {
    const dag = slots({ verstrekenTotMin: toMin('12:00') });
    expect(dag.find((s) => s.tijd === '11:45')?.status).toBe('dicht');
    expect(dag.find((s) => s.tijd === '12:00')?.status).toBe('open');
  });
});

describe('vaartBoekbaar (domeinregel 4)', () => {
  const vaarten: Vaart[] = [
    { tijd: '09:30', dienst: 'veerboot', richting: 'aankomst' },
    { tijd: '10:00', dienst: 'veerboot', richting: 'vertrek' },
    { tijd: '12:30', dienst: 'veerboot', richting: 'aankomst' },
    { tijd: '13:00', dienst: 'veerboot', richting: 'vertrek' },
  ];

  it('houdt de eerste vaart van de dag offline, in beide richtingen', () => {
    expect(vaartBoekbaar(vaarten[0], vaarten, null, BOEKREGELS).boekbaar).toBe(false);
    expect(vaartBoekbaar(vaarten[1], vaarten, null, BOEKREGELS).boekbaar).toBe(false);
  });

  it('sluit een vertrek binnen 45 minuten voor de afvaart', () => {
    expect(vaartBoekbaar(vaarten[3], vaarten, toMin('12:20'), BOEKREGELS).boekbaar).toBe(false);
    expect(vaartBoekbaar(vaarten[3], vaarten, toMin('12:15'), BOEKREGELS).boekbaar).toBe(true);
  });

  it('laat een aankomst wel boekbaar, ook vlak van tevoren', () => {
    expect(vaartBoekbaar(vaarten[2], vaarten, toMin('12:20'), BOEKREGELS).boekbaar).toBe(true);
  });

  it('laat een vertrek op een andere dag boekbaar (geen klokcontrole)', () => {
    expect(vaartBoekbaar(vaarten[3], vaarten, null, BOEKREGELS).boekbaar).toBe(true);
  });

  it('markeert een vaart van vandaag die al geweest is als niet boekbaar, ook een aankomst', () => {
    // Vandaag 15:00: de aankomst van 12:30 is al geweest; de boekingsroute zou
    // anders met tijd_verstreken weigeren terwijl het dagbeeld boekbaar zei.
    expect(vaartBoekbaar(vaarten[2], vaarten, toMin('15:00'), BOEKREGELS).boekbaar).toBe(false);
    // Een aankomst die nog komt, blijft gewoon boekbaar.
    expect(vaartBoekbaar(vaarten[2], vaarten, toMin('12:00'), BOEKREGELS).boekbaar).toBe(true);
  });

  it('markeert een vaart buiten de openingstijden als niet boekbaar wanneer de opening meegaat', () => {
    const vroeg: Vaart = { tijd: '08:30', dienst: 'veerboot', richting: 'aankomst' };
    const laat: Vaart = { tijd: '22:00', dienst: 'sneldienst', richting: 'aankomst' };
    expect(vaartBoekbaar(vroeg, [vroeg, ...vaarten], null, BOEKREGELS, OPENING).boekbaar).toBe(false);
    expect(vaartBoekbaar(laat, [...vaarten, laat], null, BOEKREGELS, OPENING).boekbaar).toBe(false);
    // Binnen de opening verandert er niets aan de bestaande regels.
    expect(vaartBoekbaar(vaarten[3], vaarten, toMin('12:00'), BOEKREGELS, OPENING).boekbaar).toBe(true);
  });
});

describe('geldigeDatum en datumPlus (datumvalidatie en boekingshorizon)', () => {
  it('weigert niet-bestaande kalenderdagen die de regex wel doorlaat', () => {
    expect(geldigeDatum('2026-11-31')).toBe(false);
    expect(geldigeDatum('2026-02-30')).toBe(false);
    expect(geldigeDatum('2026-13-40')).toBe(false);
    expect(geldigeDatum('2026-00-10')).toBe(false);
  });

  it('weigert tekst die geen datum is', () => {
    expect(geldigeDatum('')).toBe(false);
    expect(geldigeDatum('morgen')).toBe(false);
    expect(geldigeDatum('2026-1-1')).toBe(false);
  });

  it('accepteert echte kalenderdagen, inclusief schrikkeldagen', () => {
    expect(geldigeDatum('2026-11-30')).toBe(true);
    expect(geldigeDatum('2024-02-29')).toBe(true);
    expect(geldigeDatum('2026-02-29')).toBe(false);
  });

  it('telt dagen over maand-, jaar- en zomertijdgrenzen heen', () => {
    expect(datumPlus('2026-10-31', 1)).toBe('2026-11-01');
    expect(datumPlus('2026-12-31', 1)).toBe('2027-01-01');
    expect(datumPlus('2026-03-28', 2)).toBe('2026-03-30'); // zomertijdweekend
    expect(datumPlus('2026-10-24', 3)).toBe('2026-10-27'); // wintertijdweekend
  });
});

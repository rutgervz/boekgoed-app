// Gedeeld typecontract van het domein. Alle domeincode programmeert tegen deze typen.
export type Zone = 'haven' | 'dorp' | 'strand' | 'oost';
export type Richting = 'naar_boot' | 'van_boot' | 'locatie';
export type Modus = 'personen' | 'bagage' | 'aanhanger';
export type Tarieven = { eerste_persoon: number; extra_persoon: number; huisdier: number; gratis_bagage_per_persoon: number; extra_bagagestuk: number; los_bagagestuk: number; aanhanger: number };
export type Capaciteit = { personen: number; aanhangers: number; venster_min: number };
export type Opening = { van: string; tot: string };
export type Boekregels = { naar_boot_online_tot_min_voor_vertrek: number; eerste_boot_online: boolean; vanaf_boot_altijd: boolean; tussen_boten: string; op_rekening_alleen_telefonisch: boolean };
export type Instellingen = { tarieven_cent: Tarieven; capaciteit: Capaciteit; opening: Opening; boekregels: Boekregels; zones: { volgorde: Zone[]; rijtijd_min: Record<Zone, Record<Zone, number>> }; spits: { dagen: string[]; vertrek_lauwersoog: string[]; marge_voor_afvaart_min: number }; contact: { telefoon: string; email: string; adres: string; adres_opmerking?: string }; berichten: { bevestiging_klad: string; daglijst_tijd: string }; huisstijl: { merkblauw: string; slogan?: string } };
export type RitInvoer = { modus: Modus; personen: number; huisdier: boolean; extraBagage: number; bagageStuks: number; aanhanger: boolean; retour: boolean };
export type PrijsRegel = { label: string; bedragCent: number };
export type Prijs = { totaalCent: number; regels: PrijsRegel[] };
export type RitLicht = { tijd: string | null; personen: number; aanhanger: boolean; status: string };
export type Sluiting = { van: string; tot: string; reden: string | null };
export type Vaart = { tijd: string; dienst: 'veerboot' | 'sneldienst'; richting: 'aankomst' | 'vertrek' };
export type SlotStatus = 'open' | 'vol' | 'dicht';
export type Slot = { tijd: string; status: SlotStatus; reden?: string };
export type NieuweLading = { personen: number; aanhanger: boolean };

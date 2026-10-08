/**
 * The Croatian receipt field schema every arm is given, word for word. Field names are the
 * canonical names of `shared/src/receipt.ts`. The model copies what is printed; `normalize.ts`
 * turns that into canonical values.
 *
 * Frozen once a paid call has been made: a description reworded after seeing one arm's output
 * would be tuned to that arm.
 */
export interface FieldDef {
  type: "string" | "array";
  description: string;
  items?: Record<string, FieldDef>;
}

const text = (description: string): FieldDef => ({ type: "string", description });

export const RECEIPT_FIELDS: Record<string, FieldDef> = {
  sellerName: text(
    "Naziv izdavatelja računa — tvrtka ili obrt koji je izdao račun, obično na vrhu uz OIB i adresu sjedišta (npr. '... d.o.o.', '... d.d.', '..., obrt za ...'). Ako su ispisani i naziv lokala ili poslovnice i naziv tvrtke, vrati naziv tvrtke ili obrta.",
  ),
  sellerAddress: text("Adresa sjedišta izdavatelja računa (ulica, broj, poštanski broj, mjesto)."),
  sellerOib: text(
    "OIB izdavatelja računa — 11 znamenki uz oznaku 'OIB'. Može biti ispisan i kao PDV ID s prefiksom 'HR'. Prepiši kako je ispisano.",
  ),
  buyerName: text(
    "Naziv kupca, samo ako račun ima zaseban blok kupca ('Kupac:', R1 račun). Naziv poslovnice izdavatelja nije kupac.",
  ),
  buyerAddress: text("Adresa kupca iz bloka kupca."),
  buyerOib: text("OIB kupca iz bloka kupca — 11 znamenki."),
  documentNumber: text(
    "Broj računa, npr. '381/1/3' ili '1234/POSL1/1' (redni broj / poslovni prostor / naplatni uređaj). Labeli: 'Račun br.', 'Broj računa', 'Račun:', 'Rn:'. JIR, ZKI, broj stola i oznaka blagajnika su druga polja.",
  ),
  issueDate: text(
    "Datum izdavanja računa, prepisan TOČNO kako je ispisan (npr. '17.08.2026.', '31.03.25'). Labeli: 'Datum', 'Datum izdavanja', 'Datum i vrijeme'.",
  ),
  issueTime: text(
    "Vrijeme izdavanja računa, kako je ispisano (npr. '14:30', '14:19:14'), obično odmah uz datum izdavanja. Trajanje vožnje ili usluge je drugo polje.",
  ),
  subtotal: text(
    "Iznos bez PDV-a ispisan kao zaseban zbroj ('Osnovica ukupno', 'Iznos bez PDV-a', 'Ukupno bez poreza'). Samo broj kako je ispisan.",
  ),
  total: text(
    "Ukupan iznos računa za platiti, kako je ispisan. Labeli: 'UKUPNO', 'Sveukupno', 'Za platiti', 'Ukupno EUR'. Ako su ispisani iznosi u eurima i u kunama, vrati iznos u valuti u kojoj je račun izdan: eure od 1.1.2023., kune prije toga. Samo broj, bez oznake valute.",
  ),
  currency: text("Oznaka valute ispisana uz ukupan iznos: 'EUR', '€', 'kn' ili 'HRK'."),
  paymentMethod: text(
    "Način plaćanja kako je ispisan, npr. 'Gotovina', 'Novčanice', 'Kartica', 'Kartice', 'Transakcijski račun'. Label: 'Način plaćanja'.",
  ),
  jir: text(
    "JIR (jedinstveni identifikator računa): 36 znakova u obliku 8-4-4-4-12 heksadecimalnih znakova s crticama, iza oznake 'JIR'. Ako je prelomljen u dva retka, spoji ga bez razmaka.",
  ),
  zki: text(
    "ZKI (zaštitni kod izdavatelja): 32 heksadecimalna znaka bez crtica, iza oznake 'ZKI' ili 'Zaštitni kod'. Ako je prelomljen u dva retka, spoji ga bez razmaka.",
  ),
  vatBreakdown: {
    type: "array",
    description:
      "Rekapitulacija PDV-a: jedan redak po poreznoj stopi, s ispisanom stopom, osnovicom i iznosom poreza. Redak 'Ukupno' nije porezna stopa. Račun izdavatelja koji nije u sustavu PDV-a nema ovu tablicu.",
    items: {
      rate: text("Stopa PDV-a kako je ispisana, npr. '25%', '13,00'."),
      taxableBase: text("Osnovica za tu stopu, kako je ispisana."),
      vatAmount: text("Iznos PDV-a za tu stopu, kako je ispisan."),
    },
  },
  items: {
    type: "array",
    description:
      "Stavke računa: jedan redak po kupljenom artiklu ili usluzi, redom kako su ispisane. Međuzbrojevi, ukupno, rekapitulacija PDV-a i način plaćanja nisu stavke.",
    items: {
      description: text("Naziv artikla ili usluge, kako je ispisan."),
      quantity: text("Količina kako je ispisana, npr. '1', '3,000', '0,5'."),
      unitPrice: text("Jedinična cijena kako je ispisana."),
      total: text("Iznos stavke kako je ispisan."),
    },
  },
};

export const SCALAR_FIELDS = Object.entries(RECEIPT_FIELDS)
  .filter(([, def]) => def.type !== "array")
  .map(([name]) => name);

export const SHARED_RULES =
  "Pravila: prepiši svaku vrijednost TOČNO kako je ispisana; ne računaj i ne izvodi vrijednosti koje nisu ispisane; ako polja nema na računu, vrati null; iznose ostavi u ispisanom zapisu (npr. 1.234,56).";

// One wording has to serve text, images and files, so it says "dokument" and names no form.
export const SYSTEM = `Ti si stručnjak za hrvatske fiskalne račune (maloprodaja, ugostiteljstvo, R1 račun). Iz dokumenta izvuci tražena polja.

${SHARED_RULES}`;

/** FieldDef tree -> strict JSON schema: every property required, null allowed. */
export function toJsonSchema(def: FieldDef): Record<string, unknown> {
  if (def.type === "array" && def.items) {
    const properties = Object.fromEntries(
      Object.entries(def.items).map(([name, cell]) => [
        name,
        { type: ["string", "null"], description: cell.description },
      ]),
    );
    return {
      type: "array",
      description: def.description,
      items: {
        type: "object",
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
      },
    };
  }
  return { type: ["string", "null"], description: def.description };
}

const properties = Object.fromEntries(
  Object.entries(RECEIPT_FIELDS).map(([name, def]) => [name, toJsonSchema(def)]),
);

export const SCHEMA = {
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

import DocumentIntelligence, {
  type AnalyzeResultOutput,
} from "@azure-rest/ai-document-intelligence";
import { parseAmount, parseIssueDate, parseIssueTime } from "@receipt/shared";
import { z } from "zod";
import { config } from "../../config.js";
import { AZURE_API_VERSION, analyzeWithAzure } from "./azure.js";
import { normalizeOib } from "./croatian.js";
import { SCALAR_FIELDS } from "./scalar-merge.js";
import type { ExtractionInput } from "./types.js";

/**
 * The scalar reader: a third reading of the document's header, buyer, payment and fiscal fields.
 * Plain OCR text goes to a language model, which copies the 14 scalar fields as printed. It is
 * never asked for line items or VAT rows, and it is never shown the two prebuilt models' reading.
 *
 * The prompt, the field descriptions and the request below are word for word what was measured on
 * 2026-10-12 (`scripts/bakeoff/`, 198 scalars right of 209 against 183). Rewording any of it
 * makes that number someone else's: `scripts/bakeoff/product-parity.check.ts` fails if they drift.
 */
const OCR_MODEL_ID = "prebuilt-read";

const SCALAR_DESCRIPTIONS: Record<string, string> = {
  sellerName:
    "Naziv izdavatelja računa — tvrtka ili obrt koji je izdao račun, obično na vrhu uz OIB i adresu sjedišta (npr. '... d.o.o.', '... d.d.', '..., obrt za ...'). Ako su ispisani i naziv lokala ili poslovnice i naziv tvrtke, vrati naziv tvrtke ili obrta.",
  sellerAddress: "Adresa sjedišta izdavatelja računa (ulica, broj, poštanski broj, mjesto).",
  sellerOib:
    "OIB izdavatelja računa — 11 znamenki uz oznaku 'OIB'. Može biti ispisan i kao PDV ID s prefiksom 'HR'. Prepiši kako je ispisano.",
  buyerName:
    "Naziv kupca, samo ako račun ima zaseban blok kupca ('Kupac:', R1 račun). Naziv poslovnice izdavatelja nije kupac.",
  buyerAddress: "Adresa kupca iz bloka kupca.",
  buyerOib: "OIB kupca iz bloka kupca — 11 znamenki.",
  documentNumber:
    "Broj računa, npr. '381/1/3' ili '1234/POSL1/1' (redni broj / poslovni prostor / naplatni uređaj). Labeli: 'Račun br.', 'Broj računa', 'Račun:', 'Rn:'. JIR, ZKI, broj stola i oznaka blagajnika su druga polja.",
  issueDate:
    "Datum izdavanja računa, prepisan TOČNO kako je ispisan (npr. '17.08.2026.', '31.03.25'). Labeli: 'Datum', 'Datum izdavanja', 'Datum i vrijeme'.",
  issueTime:
    "Vrijeme izdavanja računa, kako je ispisano (npr. '14:30', '14:19:14'), obično odmah uz datum izdavanja. Trajanje vožnje ili usluge je drugo polje.",
  total:
    "Ukupan iznos računa za platiti, kako je ispisan. Labeli: 'UKUPNO', 'Sveukupno', 'Za platiti', 'Ukupno EUR'. Ako su ispisani iznosi u eurima i u kunama, vrati iznos u valuti u kojoj je račun izdan: eure od 1.1.2023., kune prije toga. Samo broj, bez oznake valute.",
  currency: "Oznaka valute ispisana uz ukupan iznos: 'EUR', '€', 'kn' ili 'HRK'.",
  paymentMethod:
    "Način plaćanja kako je ispisan, npr. 'Gotovina', 'Novčanice', 'Kartica', 'Kartice', 'Transakcijski račun'. Label: 'Način plaćanja'.",
  jir: "JIR (jedinstveni identifikator računa): 36 znakova u obliku 8-4-4-4-12 heksadecimalnih znakova s crticama, iza oznake 'JIR'. Ako je prelomljen u dva retka, spoji ga bez razmaka.",
  zki: "ZKI (zaštitni kod izdavatelja): 32 heksadecimalna znaka bez crtica, iza oznake 'ZKI' ili 'Zaštitni kod'. Ako je prelomljen u dva retka, spoji ga bez razmaka.",
};

const RULES =
  "Pravila: prepiši svaku vrijednost TOČNO kako je ispisana; ne računaj i ne izvodi vrijednosti koje nisu ispisane; ako polja nema na računu, vrati null; iznose ostavi u ispisanom zapisu (npr. 1.234,56).";

export const READER_SYSTEM = `Ti si stručnjak za hrvatske fiskalne račune (maloprodaja, ugostiteljstvo, R1 račun). Iz dokumenta izvuci tražena polja.

${RULES}`;

export const READER_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    SCALAR_FIELDS.map((name) => [
      name,
      { type: ["string", "null"], description: SCALAR_DESCRIPTIONS[name] },
    ]),
  ),
  required: [...SCALAR_FIELDS],
  additionalProperties: false,
};

export const documentMessage = (content: string): string => `<dokument>\n${content}\n</dokument>`;

const answerSchema = z.object(
  Object.fromEntries(SCALAR_FIELDS.map((name) => [name, z.string().nullable()])),
);

/** The model's answer, or a throw: all 14 keys, each a string or null, anything else dropped. */
export function parseAnswer(value: unknown): Record<string, string | null> {
  const parsed = answerSchema.safeParse(value);
  // The answer holds receipt text, so the error names the failure and nothing of what was sent.
  if (!parsed.success) throw new Error("scalar reader: malformed answer");
  return parsed.data;
}

type Parser = (raw: string) => string | null;

/** Wrapped lines become one line, as extraction stores them. */
const oneLine: Parser = (raw) =>
  raw
    .split(/\s*\n\s*/)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() || null;
const compact: Parser = (raw) => raw.replace(/\s/g, "") || null;

/** A JIR copied without its hyphens is the same identifier; it is written 8-4-4-4-12, as printed. */
const jir: Parser = (raw) => {
  const joined = compact(raw);
  const parts = /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i.exec(
    joined ?? "",
  );
  return parts ? parts.slice(1).join("-") : joined;
};

function currencyCode(raw: string): string | null {
  const token = raw.trim().toUpperCase();
  if (token === "€" || token === "EUR" || token === "EURO") return "EUR";
  if (token === "KN" || token === "HRK") return "HRK";
  if (token === "$" || token === "USD") return "USD";
  return null;
}

/**
 * The model is told to copy what is printed and sometimes copies the label too
 * (`OIB: 62357811032`). One that passes its check digit wins; one that fails it is kept as
 * printed, which is what the two-model path stores, with a warning.
 */
const oib: Parser = (raw) => {
  const printed = [...raw.matchAll(/(?<!\d)\d{11}(?!\d)/g)].map((match) => match[0]);
  return normalizeOib(raw) ?? printed.find((digits) => normalizeOib(digits)) ?? printed[0] ?? null;
};

/**
 * Dates are read day first, as Croatian receipts print them. A date whose middle number cannot
 * be a month (`02/24/17`) can only be month first. It goes back through the day-first parser so
 * a date that does not exist (`02/30/17`) is unread rather than stored: the canonical schema
 * rejects it, and the reader must never be what fails an extraction.
 */
const date: Parser = (raw) => {
  const dayFirst = parseIssueDate(raw);
  if (dayFirst !== null) return dayFirst;
  const parts = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(raw.trim());
  if (!parts) return null;
  const [, month, day, year] = parts;
  if (Number(month) > 12 || Number(day) <= 12 || Number(day) > 31) return null;
  return parseIssueDate(`${day}.${month}.${year}`);
};

const PARSERS: Record<string, Parser> = {
  sellerName: oneLine,
  sellerAddress: oneLine,
  sellerOib: oib,
  buyerName: oneLine,
  buyerAddress: oneLine,
  buyerOib: oib,
  documentNumber: oneLine,
  issueDate: date,
  issueTime: parseIssueTime,
  total: parseAmount,
  currency: currencyCode,
  paymentMethod: oneLine,
  jir,
  zki: compact,
};

/**
 * The printed values in canonical form, through the parsers the two-model path uses. A value no
 * parser can read is null. Nothing is inferred: a currency the receipt does not print stays
 * empty here, and the two-model path's own inference from the date remains the only one.
 */
export function normalizeScalars(
  printed: Record<string, string | null>,
): Record<string, string | null> {
  return Object.fromEntries(
    SCALAR_FIELDS.map((name) => {
      const value = printed[name];
      return [
        name,
        typeof value === "string" && value.trim() !== "" ? PARSERS[name]!(value) : null,
      ];
    }),
  );
}

export interface ScalarReading {
  /** Each value as the model copied it. */
  readonly printed: Record<string, string | null>;
  /** The same values in canonical form; null where a parser could not read one. */
  readonly fields: Record<string, string | null>;
  readonly ocrModelId: string;
  readonly deployment: string;
  readonly latencyMs: number;
  /** The OCR response, kept for outlines and debugging. */
  readonly analyzeResult: AnalyzeResultOutput;
}

export type ScalarReader = (input: ExtractionInput, signal: AbortSignal) => Promise<ScalarReading>;

interface ReaderSettings {
  readonly endpoint: string;
  readonly key: string;
  readonly deployment: string;
  readonly apiVersion: string;
}

export interface ScalarReaderOptions {
  readonly settings?: Partial<ReaderSettings>;
  readonly ocr?: (input: ExtractionInput, signal: AbortSignal) => Promise<AnalyzeResultOutput>;
  readonly complete?: (content: string, signal: AbortSignal) => Promise<unknown>;
}

/** Whether the deployment carries everything the reader needs. Any one blank turns it off. */
export function scalarReaderConfigured(): boolean {
  return [
    config.AZURE_OPENAI_ENDPOINT,
    config.AZURE_OPENAI_KEY,
    config.AZURE_OPENAI_DEPLOYMENT,
    config.AZURE_OPENAI_API_VERSION,
  ].every((value) => value !== "");
}

/**
 * Null when the reader is not configured, which is a supported state and not a fault: the
 * provider then extracts with its two models exactly as it did before the reader existed.
 */
export function createScalarReader(options: ScalarReaderOptions = {}): ScalarReader | null {
  const settings: ReaderSettings = {
    endpoint: options.settings?.endpoint ?? config.AZURE_OPENAI_ENDPOINT,
    key: options.settings?.key ?? config.AZURE_OPENAI_KEY,
    deployment: options.settings?.deployment ?? config.AZURE_OPENAI_DEPLOYMENT,
    apiVersion: options.settings?.apiVersion ?? config.AZURE_OPENAI_API_VERSION,
  };
  if (options.complete === undefined && Object.values(settings).some((value) => value === "")) {
    return null;
  }
  const ocr = options.ocr ?? createOcr();
  const complete =
    options.complete ?? ((content, signal) => requestAnswer(settings, content, signal));

  return async (input, signal) => {
    const startedAt = Date.now();
    const analyzeResult = await ocr(input, signal);
    // A document with no text is one the two-model result should stand on; asking the model
    // would return fourteen nulls, and an empty buyer reading clears a buyer.
    if ((analyzeResult.content ?? "").trim() === "") throw new Error("scalar reader: no text");
    const printed = parseAnswer(await complete(documentMessage(analyzeResult.content), signal));
    return {
      printed,
      fields: normalizeScalars(printed),
      ocrModelId: OCR_MODEL_ID,
      deployment: settings.deployment,
      latencyMs: Date.now() - startedAt,
      analyzeResult,
    };
  };
}

/** Plain OCR through the provider's own submit-and-poll loop: no barcodes, no markdown. */
function createOcr(): NonNullable<ScalarReaderOptions["ocr"]> {
  const client = DocumentIntelligence(
    config.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    { key: config.AZURE_DOCUMENT_INTELLIGENCE_KEY },
    { apiVersion: AZURE_API_VERSION },
  );
  const settings = { locale: config.AZURE_DI_LOCALE };
  return async (input, signal) =>
    (await analyzeWithAzure(client, settings, OCR_MODEL_ID, input, signal, [])).analyzeResult;
}

/**
 * One request, never retried: a throttled or slow answer is a failed reading, and the provider
 * carries on without it. Errors carry the HTTP status and nothing else — the request holds the
 * receipt's text and the response its values, and neither may reach a log.
 */
async function requestAnswer(
  settings: ReaderSettings,
  content: string,
  signal: AbortSignal,
): Promise<unknown> {
  const endpoint = settings.endpoint.replace(/\/$/, "");
  const response = await fetch(
    `${endpoint}/openai/deployments/${settings.deployment}/chat/completions?api-version=${settings.apiVersion}`,
    {
      method: "POST",
      headers: { "api-key": settings.key, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        messages: [
          { role: "system", content: READER_SYSTEM },
          { role: "user", content },
        ],
        temperature: 0,
        max_tokens: 8000,
        response_format: {
          type: "json_schema",
          json_schema: { name: "HrReceipt", schema: READER_SCHEMA, strict: true },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`scalar reader: HTTP ${response.status}`);
  try {
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return JSON.parse(body.choices?.[0]?.message?.content ?? "") as unknown;
  } catch {
    // A JSON syntax error quotes the text it failed on.
    throw new Error("scalar reader: malformed answer");
  }
}

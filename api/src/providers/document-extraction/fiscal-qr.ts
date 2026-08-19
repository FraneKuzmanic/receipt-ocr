import { parseAmount, parseIssueDate, parseIssueTime } from "@receipt/shared";

const MAX_PAYLOAD_LENGTH = 512;
const JIR = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{32})$/i;
const ZKI = /^[0-9a-f]{32}$/i;
const FISCAL_DATETIME = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/;

export interface FiscalQrData {
  /** The decoded payload, verbatim and untouched. Preserved even when nothing parses out of it. */
  readonly raw: string;
  readonly jir: string | null;
  readonly zki: string | null;
  /** yyyy-mm-dd, normalized through the shared parser. */
  readonly issueDate: string | null;
  /** HH:mm — the fiscal payload never carries seconds. */
  readonly issueTime: string | null;
  /** Canonical decimal string, null when izn carried no decimal separator. */
  readonly total: string | null;
}

export function parseFiscalQr(payload: string): FiscalQrData {
  const raw = payload.trim();
  if (raw === "" || raw.length > MAX_PAYLOAD_LENGTH) return emptyFiscalQr(raw);

  const url = parseHttpUrl(raw);
  if (url === null) {
    return { ...emptyFiscalQr(raw), jir: JIR.test(raw) ? raw : null };
  }

  const jir = parameter(url, "jir");
  const zki = parameter(url, "zki");
  const datetime = parseFiscalDatetime(parameter(url, "datv"));
  const rawTotal = parameter(url, "izn");

  return {
    raw,
    jir: jir !== null && JIR.test(jir) ? jir : null,
    zki: zki !== null && ZKI.test(zki) ? zki : null,
    issueDate: datetime.issueDate,
    issueTime: datetime.issueTime,
    total:
      rawTotal !== null && (rawTotal.includes(",") || rawTotal.includes("."))
        ? parseAmount(rawTotal)
        : null,
  };
}

function emptyFiscalQr(raw: string): FiscalQrData {
  return { raw, jir: null, zki: null, issueDate: null, issueTime: null, total: null };
}

function parseHttpUrl(payload: string): URL | null {
  try {
    const url = new URL(payload);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function parameter(url: URL, name: string): string | null {
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === name) return value;
  }
  return null;
}

function parseFiscalDatetime(value: string | null): {
  issueDate: string | null;
  issueTime: string | null;
} {
  const match = value === null ? null : FISCAL_DATETIME.exec(value);
  if (match === null) return { issueDate: null, issueTime: null };

  const [, year, month, day, hour, minute] = match;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return { issueDate: null, issueTime: null };
  }

  return {
    issueDate: parseIssueDate(`${year}-${month}-${day}`),
    issueTime: parseIssueTime(`${hour}:${minute}`),
  };
}

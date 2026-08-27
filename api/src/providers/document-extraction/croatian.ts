import { parseIssueDate, parseIssueTime } from "@receipt/shared";

const OIB = /\bOIB[:\s]*([0-9]{11})\b/dgi;
const OIB_DIGITS = /^[0-9]{11}$/;
const OIB_SHAPE = /\bOIB[:\s]*[0-9]{11}\b/i;
const COUNTRY_PREFIX = /^HR/i;
const ISSUE_DATE =
  /\b(?:datum|dat\.|nadnevak)\s*[:#-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}\.?|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2})/di;
// "broj" must be tried before "br.?": the optional dot lets "br.?" match just the "br" of
// "broj" and stop there, so trying it first leaves "oj" to be captured as the document number.
const DOCUMENT_NUMBER =
  /\b(?:ra[čc]un|r-?1|br\.)\s*(?:broj|br\.?)?\s*[:#-]?\s*([a-z0-9][a-z0-9./-]*)/di;

// A clock time on a receipt is always colon-separated. Admitting "." or "," here is what let
// "17.08.2026." be read as 17:08:20 on a receipt whose real time was 10:30 — a date fragment is
// a plausible-looking time, and a wrong time is worse than a missing one (PRD §7.7).
const TIME = "([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)";
const DATE = "(?:[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}\\.?|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2})";
// The issue time is written next to the issue date far more often than under its own label:
// "21.02.2020,14:26:38", "05.05.2023 20:40", "16.07.2023. u 14:19:14", "31/03/2025, 23:59:47".
const DATE_ADJACENT_TIME = new RegExp(`${DATE}[.,]?[ \\t]*(?:u[ \\t]+)?${TIME}`, "di");
const LABELLED_TIME = new RegExp(`\\bvrijeme\\s*[:#-]?\\s*${TIME}`, "di");
// "Vrijeme: 00:16:19 (HH:MM:SS)" on a taxi receipt is the ride duration, not the issue time.
const TIME_UNIT_HINT = /^[ \t]*\(\s*(?:hh|ss|min)/i;

const JIR_VALUE = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{32})$/i;
const ZKI_VALUE = /^[0-9a-f]{32}$/i;
const JIR_LABEL = /\bJIR\b/gi;
const ZKI_LABEL = /\bZKI\b/gi;
const IDENTIFIER_CHARACTER = /[0-9a-f-]/i;

export interface CroatianMatch {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

function capture(content: string, expression: RegExp): CroatianMatch | null {
  const match = expression.exec(content);
  const indices = match?.indices?.[1];
  const value = match?.[1];
  return indices === undefined || value === undefined
    ? null
    : { value, start: indices[0], end: indices[1] };
}

export function findOib(content: string): CroatianMatch | null {
  for (const match of content.matchAll(OIB)) {
    const indices = match.indices?.[1];
    const value = match[1];
    if (indices !== undefined && value !== undefined && isValidOib(value)) {
      return { value, start: indices[0], end: indices[1] };
    }
  }
  return null;
}

/**
 * Whether the document carries Croatian fiscal markings at all. This asks only about shape: an
 * OIB whose check digit was mis-scanned still identifies the receipt as Croatian, so requiring a
 * valid checksum here would withdraw the currency inference from exactly the receipts that need
 * it most.
 */
export function hasFiscalMarkings(content: string): boolean {
  return OIB_SHAPE.test(content) || findJir(content) !== null || findZki(content) !== null;
}

/**
 * Every Croatian OIB carries an ISO 7064 MOD 11,10 check digit. Validating it is what lets an
 * OCR-corrupted eleven-digit run be rejected instead of stored as a plausible-looking company
 * identifier, and what distinguishes a real OIB from a neighbouring number of the same length.
 */
export function isValidOib(value: string): boolean {
  if (!OIB_DIGITS.test(value)) return false;

  let remainder = 10;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder + Number(value[index])) % 10;
    if (remainder === 0) remainder = 10;
    remainder = (remainder * 2) % 11;
  }
  return (11 - remainder) % 10 === Number(value[10]);
}

/**
 * Reads a tax identifier as an OIB, accepting the VAT-registration form printed as "PDVbr:
 * HR27759560625". Returns null unless the result is a checksum-valid OIB, so a VAT number that
 * merely looks similar cannot take the field.
 */
export function normalizeOib(raw: string | null | undefined): string | null {
  const compact = (raw ?? "").replaceAll(/\s/gu, "").replace(COUNTRY_PREFIX, "");
  return isValidOib(compact) ? compact : null;
}

export function findJir(content: string): CroatianMatch | null {
  return captureIdentifier(content, JIR_LABEL, JIR_VALUE, 36);
}

export function findZki(content: string): CroatianMatch | null {
  return captureIdentifier(content, ZKI_LABEL, ZKI_VALUE, 32);
}

export function findIssueDate(content: string): CroatianMatch | null {
  const match = capture(content, ISSUE_DATE);
  const value = parseIssueDate(match?.value);
  return match === null || value === null ? null : { ...match, value };
}

export function findIssueTime(content: string): CroatianMatch | null {
  return dateAdjacentTime(content) ?? labelledTime(content);
}

export function findDocumentNumber(content: string): CroatianMatch | null {
  return capture(content, DOCUMENT_NUMBER);
}

function dateAdjacentTime(content: string): CroatianMatch | null {
  const match = capture(content, DATE_ADJACENT_TIME);
  const value = parseIssueTime(match?.value);
  return match === null || value === null ? null : { ...match, value };
}

function labelledTime(content: string): CroatianMatch | null {
  const match = capture(content, LABELLED_TIME);
  if (match === null || TIME_UNIT_HINT.test(content.slice(match.end))) return null;
  const value = parseIssueTime(match.value);
  return value === null ? null : { ...match, value };
}

/**
 * Reads the fiscal identifier that follows its label, tolerating the two ways a thermal receipt
 * defeats a contiguous match: OCR noise between the label and the value ("ZKI: ."), and a value
 * wrapped onto the next line ("…c46af0ec9\n0c5c5"). The collected value is still validated
 * strictly, so noise can never widen what counts as an identifier.
 */
function captureIdentifier(
  content: string,
  label: RegExp,
  valid: RegExp,
  length: number,
): CroatianMatch | null {
  for (const match of content.matchAll(label)) {
    const found = collect(content, match.index + match[0].length, length);
    if (found !== null && valid.test(found.value)) return found;
  }
  return null;
}

function collect(content: string, from: number, length: number): CroatianMatch | null {
  let value = "";
  let start = -1;
  let end = -1;
  let leadingBreaks = 0;
  let innerBreaks = 0;

  for (let index = from; index < content.length && value.length < length; index += 1) {
    const character = content[index]!;
    if (IDENTIFIER_CHARACTER.test(character)) {
      if (start === -1) start = index;
      value += character;
      end = index + 1;
      continue;
    }
    if (/\s/.test(character)) {
      // The value may begin on the line below its label, and may itself wrap once. Counting
      // those two separately matters: a receipt does both at once.
      if (character === "\n" && (start === -1 ? (leadingBreaks += 1) : (innerBreaks += 1)) > 1) {
        break;
      }
      continue;
    }
    // Separator noise is only tolerated before the value begins.
    if (start !== -1) break;
  }

  return start === -1 ? null : { value, start, end };
}

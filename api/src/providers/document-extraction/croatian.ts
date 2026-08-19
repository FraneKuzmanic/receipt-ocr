import { parseIssueDate, parseIssueTime } from "@receipt/shared";

const OIB = /\bOIB[:\s]*([0-9]{11})\b/i;
const JIR = /\bJIR\s*[:#-]?\s*([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{32})\b/i;
const ZKI = /\bZKI\s*[:#-]?\s*([0-9a-f]{32})\b/i;
const ISSUE_DATE =
  /\b(?:datum|dat\.)\s*[:#-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}\.?|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2})/i;
const ISSUE_TIME = /\bvrijeme\s*[:#-]?\s*([0-9]{1,2}[:.,][0-9]{2}(?:[:.,][0-9]{2})?)/i;
const DOCUMENT_NUMBER =
  /\b(?:ra[čc]un|r-?1|br\.)\s*(?:br\.?|broj)?\s*[:#-]?\s*([a-z0-9][a-z0-9./-]*)/i;

function capture(content: string, expression: RegExp): string | null {
  return expression.exec(content)?.[1] ?? null;
}

export function findOib(content: string): string | null {
  return capture(content, OIB);
}

export function findJir(content: string): string | null {
  return capture(content, JIR);
}

export function findZki(content: string): string | null {
  return capture(content, ZKI);
}

export function findIssueDate(content: string): string | null {
  return parseIssueDate(capture(content, ISSUE_DATE));
}

export function findIssueTime(content: string): string | null {
  return parseIssueTime(capture(content, ISSUE_TIME));
}

export function findDocumentNumber(content: string): string | null {
  return capture(content, DOCUMENT_NUMBER);
}

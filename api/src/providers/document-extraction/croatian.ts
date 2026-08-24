import { parseIssueDate, parseIssueTime } from "@receipt/shared";

const OIB = /\bOIB[:\s]*([0-9]{11})\b/di;
const JIR = /\bJIR\s*[:#-]?\s*([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{32})\b/di;
const ZKI = /\bZKI\s*[:#-]?\s*([0-9a-f]{32})\b/di;
const ISSUE_DATE =
  /\b(?:datum|dat\.)\s*[:#-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}\.?|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2})/di;
const ISSUE_TIME = /\bvrijeme\s*[:#-]?\s*([0-9]{1,2}[:.,][0-9]{2}(?:[:.,][0-9]{2})?)/di;
// "broj" must be tried before "br.?": the optional dot lets "br.?" match just the "br" of
// "broj" and stop there, so trying it first leaves "oj" to be captured as the document number.
const DOCUMENT_NUMBER =
  /\b(?:ra[čc]un|r-?1|br\.)\s*(?:broj|br\.?)?\s*[:#-]?\s*([a-z0-9][a-z0-9./-]*)/di;

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
  return capture(content, OIB);
}

export function findJir(content: string): CroatianMatch | null {
  return capture(content, JIR);
}

export function findZki(content: string): CroatianMatch | null {
  return capture(content, ZKI);
}

export function findIssueDate(content: string): CroatianMatch | null {
  const match = capture(content, ISSUE_DATE);
  const value = parseIssueDate(match?.value);
  return match === null || value === null ? null : { ...match, value };
}

export function findIssueTime(content: string): CroatianMatch | null {
  const match = capture(content, ISSUE_TIME);
  const value = parseIssueTime(match?.value);
  return match === null || value === null ? null : { ...match, value };
}

export function findDocumentNumber(content: string): CroatianMatch | null {
  return capture(content, DOCUMENT_NUMBER);
}

import {
  parseAmount,
  parseIssueDate,
  parseIssueTime,
  type CanonicalReceiptFields,
} from "@receipt/shared";

export interface ReviewFormValues {
  sellerName: string;
  sellerAddress: string;
  sellerOib: string;
  buyerName: string;
  buyerAddress: string;
  buyerOib: string;
  documentNumber: string;
  issueDate: string;
  issueTime: string;
  subtotal: string;
  vatBreakdown: Array<{ rate: string; taxableBase: string; vatAmount: string }>;
  total: string;
  currency: string;
  paymentMethod: string;
  jir: string;
  zki: string;
  items: Array<{ description: string; quantity: string; unitPrice: string; total: string }>;
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

export function toFormValues(receipt: CanonicalReceiptFields): ReviewFormValues {
  return {
    sellerName: text(receipt.sellerName),
    sellerAddress: text(receipt.sellerAddress),
    sellerOib: text(receipt.sellerOib),
    buyerName: text(receipt.buyerName),
    buyerAddress: text(receipt.buyerAddress),
    buyerOib: text(receipt.buyerOib),
    documentNumber: text(receipt.documentNumber),
    issueDate: text(receipt.issueDate),
    issueTime: text(receipt.issueTime),
    subtotal: text(receipt.subtotal),
    vatBreakdown: (receipt.vatBreakdown?.length
      ? receipt.vatBreakdown
      : [{ rate: null, taxableBase: null, vatAmount: null }]
    ).map((entry) => ({
      rate: text(entry.rate),
      taxableBase: text(entry.taxableBase),
      vatAmount: text(entry.vatAmount),
    })),
    total: text(receipt.total),
    currency: text(receipt.currency),
    paymentMethod: text(receipt.paymentMethod),
    jir: text(receipt.jir),
    zki: text(receipt.zki),
    items: (receipt.items ?? []).map((item) => ({
      description: text(item.description),
      quantity: text(item.quantity),
      unitPrice: text(item.unitPrice),
      total: text(item.total),
    })),
  };
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function nullableAmount(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : parseAmount(trimmed);
}

function nullableDate(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : parseIssueDate(trimmed);
}

function nullableTime(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : parseIssueTime(trimmed);
}

export function toPatch(values: ReviewFormValues): CanonicalReceiptFields {
  const vatBreakdown = values.vatBreakdown
    .filter((entry) => Object.values(entry).some((value) => value.trim() !== ""))
    .map((entry) => ({
      rate: nullableAmount(entry.rate),
      taxableBase: nullableAmount(entry.taxableBase),
      vatAmount: nullableAmount(entry.vatAmount),
    }));
  const items = values.items
    .filter((item) => Object.values(item).some((value) => value.trim() !== ""))
    .map((item) => ({
      description: nullableText(item.description),
      quantity: nullableAmount(item.quantity),
      unitPrice: nullableAmount(item.unitPrice),
      total: nullableAmount(item.total),
    }));

  return {
    sellerName: nullableText(values.sellerName),
    sellerAddress: nullableText(values.sellerAddress),
    sellerOib: nullableText(values.sellerOib),
    buyerName: nullableText(values.buyerName),
    buyerAddress: nullableText(values.buyerAddress),
    buyerOib: nullableText(values.buyerOib),
    documentNumber: nullableText(values.documentNumber),
    issueDate: nullableDate(values.issueDate),
    issueTime: nullableTime(values.issueTime),
    subtotal: nullableAmount(values.subtotal),
    vatBreakdown: vatBreakdown.length === 0 ? null : vatBreakdown,
    total: nullableAmount(values.total),
    currency: nullableText(values.currency)?.toUpperCase() ?? null,
    paymentMethod: nullableText(values.paymentMethod),
    jir: nullableText(values.jir),
    zki: nullableText(values.zki),
    items: items.length === 0 ? null : items,
  };
}

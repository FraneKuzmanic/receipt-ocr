import type { CanonicalReceipt, ExportFormat } from "@receipt/shared";

export function exportFilename(format: ExportFormat, now: Date): string {
  return `receipts-${now.toISOString().slice(0, 10)}.${format}`;
}

/**
 * A single receipt's download name. The document number is what a person recognizes the receipt
 * by, so it leads when present — but it is untrusted OCR text that routinely contains `/`, so
 * everything outside a conservative safe set becomes `-` before it reaches a filesystem.
 */
export function receiptExportFilename(
  receipt: Pick<CanonicalReceipt, "id" | "documentNumber" | "issueDate">,
  format: ExportFormat,
): string {
  const name = safeFilenamePart(receipt.documentNumber) ?? receipt.id.slice(0, 8);
  const date =
    receipt.issueDate === null || receipt.issueDate === undefined ? "" : `-${receipt.issueDate}`;
  return `receipt-${name}${date}.${format}`;
}

function safeFilenamePart(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const safe = value
    .replaceAll(/[^\p{Letter}\p{Number}._-]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40);
  return safe === "" ? null : safe;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

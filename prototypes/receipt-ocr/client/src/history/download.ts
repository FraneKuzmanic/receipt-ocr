import type { ExportFormat } from "@receipt/shared";

export function exportFilename(format: ExportFormat, now: Date): string {
  return `receipts-${now.toISOString().slice(0, 10)}.${format}`;
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

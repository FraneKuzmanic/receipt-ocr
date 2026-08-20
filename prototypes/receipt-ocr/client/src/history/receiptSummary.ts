import { formatAmount, type CanonicalReceipt } from "@receipt/shared";

/**
 * The canonical schema allows any three-character currency, while Intl requires three ASCII
 * letters. A malformed saved value must not prevent every receipt in history from rendering.
 */
export function formatReceiptTotal(
  total: string | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string | null {
  if (total === null || total === undefined) return null;

  try {
    return currency
      ? formatAmount(total, { locale, currency })
      : formatNumberAtScale(total, locale);
  } catch {
    const plain = formatNumberAtScale(total, locale);
    return currency ? `${plain} ${currency}` : plain;
  }
}

/** Processing and failed receipts belong on the polling/retry route, never an empty review form. */
export function receiptRoute(receipt: Pick<CanonicalReceipt, "id" | "status">): string {
  return receipt.status === "processing" || receipt.status === "failed"
    ? `/receipts/${receipt.id}/processing`
    : `/receipts/${receipt.id}/review`;
}

function formatNumberAtScale(amount: string, locale: string): string {
  const scale = amount.split(".")[1]?.length ?? 0;
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }) as unknown as { format(value: string): string };
  return formatter.format(amount);
}

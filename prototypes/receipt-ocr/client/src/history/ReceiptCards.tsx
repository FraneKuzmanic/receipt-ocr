import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CanonicalReceipt, ExportFormat } from "@receipt/shared";
import { ReceiptActions } from "./ReceiptActions";
import { formatReceiptTotal, receiptRoute } from "./receiptSummary";

interface ReceiptCardsProps {
  items: CanonicalReceipt[];
  downloadingId: string | null;
  onDownload: (receipt: CanonicalReceipt, format: ExportFormat) => void;
  onDelete: (receipt: CanonicalReceipt) => void;
}

/**
 * The phone layout. It keeps the card shape that was already working, with one change: the
 * permanently exposed Delete button has moved into the same overflow menu the table uses, so a
 * destructive action is no longer a stray thumb away and every card carries the same single
 * control regardless of status.
 */
export function ReceiptCards({ items, downloadingId, onDownload, onDelete }: ReceiptCardsProps) {
  const { t, i18n } = useTranslation();

  return (
    <ul className="flex flex-col gap-3">
      {items.map((receipt) => (
        <li
          key={receipt.id}
          className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <Link
            to={receiptRoute(receipt)}
            className="block min-w-0 flex-1 rounded-lg outline-offset-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {receipt.sellerName ?? t("history.noSeller")}
                </p>
                <p className="mt-1 truncate text-sm text-slate-600">
                  {receipt.documentNumber ?? t("history.noNumber")}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {t(`history.status.${receipt.status}`)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600">
              <span>{receipt.issueDate ?? t("history.noDate")}</span>
              <span className="text-right font-medium text-slate-900">
                {formatReceiptTotal(
                  receipt.total,
                  receipt.currency,
                  i18n.resolvedLanguage ?? "hr",
                ) ?? t("history.noTotal")}
              </span>
            </div>
          </Link>

          <ReceiptActions
            receipt={receipt}
            busy={downloadingId === receipt.id}
            onDownload={onDownload}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ul>
  );
}

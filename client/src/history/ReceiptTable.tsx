import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CanonicalReceipt, ExportFormat } from "@receipt/shared";
import { ReceiptActions } from "./ReceiptActions";
import { formatReceiptTotal, receiptRoute } from "./receiptSummary";

interface ReceiptTableProps {
  items: CanonicalReceipt[];
  downloadingId: string | null;
  onDownload: (receipt: CanonicalReceipt, format: ExportFormat) => void;
  onDelete: (receipt: CanonicalReceipt) => void;
}

/**
 * The desktop layout, from `lg` up. A card list at 1440px wastes most of the row on empty space
 * and forces the eye to re-find each value in a new place; a table puts every receipt's date,
 * seller, number and total in one scannable column each.
 *
 * `table-fixed` with explicit column widths is what lets an over-long seller name or OCR document
 * number truncate instead of widening the table and giving the whole page a horizontal scrollbar.
 * The container deliberately sets **no** `overflow`, because an `overflow-x: auto` ancestor also
 * clips vertically and would cut off the row action menu.
 */
export function ReceiptTable({ items, downloadingId, onDownload, onDelete }: ReceiptTableProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{t("history.title")}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <th scope="col" className="w-32 px-4 py-3">
              {t("history.columns.date")}
            </th>
            <th scope="col" className="px-4 py-3">
              {t("history.columns.seller")}
            </th>
            <th scope="col" className="w-40 px-4 py-3">
              {t("history.columns.number")}
            </th>
            <th scope="col" className="w-32 px-4 py-3 text-right">
              {t("history.columns.total")}
            </th>
            <th scope="col" className="w-36 px-4 py-3">
              {t("history.columns.status")}
            </th>
            <th scope="col" className="w-16 px-2 py-3">
              <span className="sr-only">{t("history.columns.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((receipt) => (
            <tr
              key={receipt.id}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
            >
              <td className="truncate px-4 py-3 text-slate-600">
                {receipt.issueDate ?? t("history.noDate")}
              </td>
              {/* The seller cell is the row header and the only link: a fully clickable row would
                  swallow the action menu's clicks and gives a keyboard user nothing to target. */}
              <th scope="row" className="truncate px-4 py-3 text-left font-medium">
                <Link
                  to={receiptRoute(receipt)}
                  className="rounded outline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-slate-900"
                >
                  {receipt.sellerName ?? t("history.noSeller")}
                </Link>
              </th>
              <td className="truncate px-4 py-3 text-slate-600">
                {receipt.documentNumber ?? t("history.noNumber")}
              </td>
              <td className="truncate px-4 py-3 text-right font-medium text-slate-900 tabular-nums">
                {formatReceiptTotal(
                  receipt.total,
                  receipt.currency,
                  i18n.resolvedLanguage ?? "hr",
                ) ?? t("history.noTotal")}
              </td>
              <td className="px-4 py-3">
                <span className="inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  {t(`history.status.${receipt.status}`)}
                </span>
              </td>
              <td className="px-2 py-3">
                <div className="flex justify-end">
                  <ReceiptActions
                    receipt={receipt}
                    busy={downloadingId === receipt.id}
                    onDownload={onDownload}
                    onDelete={onDelete}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

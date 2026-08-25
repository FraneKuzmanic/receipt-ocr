import { FileJson, FileSpreadsheet, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CanonicalReceipt, ExportFormat } from "@receipt/shared";
import { ActionMenu, type ActionMenuItem } from "../components/ActionMenu";

interface ReceiptActionsProps {
  receipt: CanonicalReceipt;
  busy: boolean;
  onDownload: (receipt: CanonicalReceipt, format: ExportFormat) => void;
  onDelete: (receipt: CanonicalReceipt) => void;
}

/**
 * The per-receipt overflow menu, identical on a table row and on a card.
 *
 * Download appears only for a confirmed receipt, matching the bulk export's scope (PRD §7.12):
 * unconfirmed OCR output is a draft, and a draft must not leave the application looking like
 * final data. The API enforces the same rule, so this is presentation, not the guard.
 */
export function ReceiptActions({ receipt, busy, onDownload, onDelete }: ReceiptActionsProps) {
  const { t } = useTranslation();

  const items: ActionMenuItem[] = [
    ...(receipt.status === "confirmed"
      ? [
          {
            key: "csv",
            label: t("common.downloadCsv"),
            icon: FileSpreadsheet,
            onSelect: () => onDownload(receipt, "csv"),
          },
          {
            key: "json",
            label: t("common.downloadJson"),
            icon: FileJson,
            onSelect: () => onDownload(receipt, "json"),
          },
        ]
      : []),
    {
      key: "delete",
      label: t("history.delete"),
      icon: Trash2,
      destructive: true,
      onSelect: () => onDelete(receipt),
    },
  ];

  return (
    <ActionMenu
      id={`receipt-actions-${receipt.id}`}
      label={t("history.actionsFor", { name: receipt.sellerName ?? t("history.noSeller") })}
      items={items}
      busy={busy}
    />
  );
}

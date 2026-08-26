import { Download, FileJson, FileSpreadsheet, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  RECEIPT_STATUSES,
  type CanonicalReceipt,
  type ExportFormat,
  type ListReceiptsResponse,
  type ReceiptStatus,
} from "@receipt/shared";
import { deleteReceipt, exportReceipt, exportReceipts, getReceipts } from "../api/client";
import { ActionMenu } from "../components/ActionMenu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorMessage } from "../components/ErrorMessage";
import { Skeleton } from "../components/Skeleton";
import { ReceiptCards } from "../history/ReceiptCards";
import { ReceiptTable } from "../history/ReceiptTable";
import { exportFilename, receiptExportFilename, saveBlob } from "../history/download";
import { useWideLayout } from "../history/useWideLayout";

export function HistoryPage() {
  const { t } = useTranslation();
  const wide = useWideLayout();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ReceiptStatus | "">("");
  const [data, setData] = useState<ListReceiptsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CanonicalReceipt | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [exporting, setExporting] = useState<ReadonlySet<ExportFormat>>(() => new Set());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);

    void getReceipts({ page, ...(status === "" ? {} : { status }) })
      .then((next) => {
        if (!active) return;
        if (next.items.length === 0 && next.total > 0 && page > 1) {
          setPage(page - 1);
          return;
        }
        setData(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("[history] could not load the receipt list", error);
        setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [page, reloadToken, status]);

  async function remove(id: string) {
    if (deleting) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await deleteReceipt(id);
      setPendingDelete(null);
      setReloadToken((value) => value + 1);
    } catch (error) {
      console.error("[history] deleting the receipt failed", error);
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }

  async function download(format: ExportFormat) {
    if (exporting.has(format)) return;
    setExporting((current) => new Set(current).add(format));
    setExportFailed(false);
    try {
      const blob = await exportReceipts(format);
      saveBlob(blob, exportFilename(format, new Date()));
    } catch (error) {
      console.error(`[history] exporting all confirmed receipts as ${format} failed`, error);
      setExportFailed(true);
    } finally {
      setExporting((current) => {
        const next = new Set(current);
        next.delete(format);
        return next;
      });
    }
  }

  async function downloadOne(receipt: CanonicalReceipt, format: ExportFormat) {
    if (downloadingId !== null) return;
    setDownloadingId(receipt.id);
    setExportFailed(false);
    try {
      const blob = await exportReceipt(receipt.id, format);
      saveBlob(blob, receiptExportFilename(receipt, format));
    } catch (error) {
      console.error(`[history] exporting one receipt as ${format} failed`, error);
      setExportFailed(true);
    } finally {
      setDownloadingId(null);
    }
  }

  const totalPages = data === null ? 1 : Math.max(1, Math.ceil(data.total / data.limit));
  const busyMessage = deleting
    ? t("history.deletingStatus")
    : exporting.size > 0 || downloadingId !== null
      ? t("history.exportingStatus")
      : null;

  return (
    <section className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-6 lg:max-w-6xl">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("history.title")}</h1>
        {data === null ? null : (
          <p className="text-sm text-slate-600">{t(`history.count`, { count: data.total })}</p>
        )}
      </div>

      {/* One toolbar owns everything that acts on the list: the filter that narrows it on the
          left, the bulk export that consumes it on the right. The export used to be a card of
          its own above the receipts, which gave a secondary action more visual weight than the
          list it operates on. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="receipt-status" className="text-sm font-medium text-slate-700">
            {t("history.filterLabel")}
          </label>
          <select
            id="receipt-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ReceiptStatus | "");
              setPage(1);
            }}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900"
          >
            <option value="">{t("history.filterAll")}</option>
            {RECEIPT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`history.status.${value}`)}
              </option>
            ))}
          </select>
        </div>

        <ActionMenu
          id="bulk-export-menu"
          variant="labelled"
          icon={Download}
          label={t("history.export")}
          busy={exporting.size > 0}
          items={[
            {
              key: "csv",
              label: t("history.exportAllCsv"),
              icon: FileSpreadsheet,
              onSelect: () => void download("csv"),
            },
            {
              key: "json",
              label: t("history.exportAllJson"),
              icon: FileJson,
              onSelect: () => void download("json"),
            },
          ]}
        />
      </div>
      <p role="status" className="sr-only">
        {busyMessage}
      </p>

      {data === null && !failed ? (
        <div role="status" aria-label={t("common.loading")} className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : null}
      {failed ? (
        <ErrorMessage
          message={t("history.errors.load")}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : null}
      {deleteFailed ? <ErrorMessage message={t("history.errors.delete")} /> : null}
      {exportFailed ? <ErrorMessage message={t("history.errors.export")} /> : null}

      {data !== null && data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-10 text-center">
          <span
            aria-hidden="true"
            className="grid size-12 place-items-center rounded-full bg-slate-100"
          >
            <ReceiptText className="size-6 text-slate-400" />
          </span>
          <h2 className="text-lg font-semibold text-slate-900">{t("history.emptyTitle")}</h2>
          <p className="max-w-prose text-sm text-slate-600">{t("history.empty")}</p>
          <Link
            to="/"
            className="mt-1 flex min-h-11 items-center rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover"
          >
            {t("history.emptyAction")}
          </Link>
        </div>
      ) : null}

      {data !== null && data.items.length > 0 ? (
        <>
          {wide ? (
            <ReceiptTable
              items={data.items}
              downloadingId={downloadingId}
              onDownload={(receipt, format) => void downloadOne(receipt, format)}
              onDelete={setPendingDelete}
            />
          ) : (
            <ReceiptCards
              items={data.items}
              downloadingId={downloadingId}
              onDownload={(receipt, format) => void downloadOne(receipt, format)}
              onDelete={setPendingDelete}
            />
          )}

          <div className="flex items-center justify-between gap-3" aria-live="polite">
            <button
              type="button"
              onClick={() => setPage((value) => value - 1)}
              disabled={page === 1}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {t("history.previous")}
            </button>
            <span className="text-sm text-slate-600">
              {t("history.pageOf", { page, pages: totalPages })}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => value + 1)}
              disabled={page >= totalPages}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {t("history.next")}
            </button>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("history.deleteTitle")}
        description={t("history.deleteBody", {
          name: pendingDelete?.sellerName ?? t("history.noSeller"),
        })}
        confirmLabel={t("history.confirmDelete")}
        cancelLabel={t("history.cancelDelete")}
        busy={deleting}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete.id);
        }}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </section>
  );
}

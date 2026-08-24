import { Download, ReceiptText, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  RECEIPT_STATUSES,
  type ExportFormat,
  type ListReceiptsResponse,
  type ReceiptStatus,
} from "@receipt/shared";
import { deleteReceipt, exportReceipts, getReceipts } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Skeleton } from "../components/Skeleton";
import { Spinner } from "../components/Spinner";
import { exportFilename, saveBlob } from "../history/download";
import { formatReceiptTotal, receiptRoute } from "../history/receiptSummary";

export function HistoryPage() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ReceiptStatus | "">("");
  const [data, setData] = useState<ListReceiptsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [exporting, setExporting] = useState<ReadonlySet<ExportFormat>>(() => new Set());
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
      .catch(() => active && setFailed(true));

    return () => {
      active = false;
    };
  }, [page, reloadToken, status]);

  async function remove(id: string) {
    if (deletingId !== null) return;
    setDeletingId(id);
    setDeleteFailed(false);
    try {
      await deleteReceipt(id);
      setPendingDelete(null);
      setReloadToken((value) => value + 1);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeletingId(null);
    }
  }

  async function download(format: ExportFormat) {
    if (exporting.has(format)) return;
    setExporting((current) => new Set(current).add(format));
    setExportFailed(false);
    try {
      const blob = await exportReceipts(format);
      saveBlob(blob, exportFilename(format, new Date()));
    } catch {
      setExportFailed(true);
    } finally {
      setExporting((current) => {
        const next = new Set(current);
        next.delete(format);
        return next;
      });
    }
  }

  const totalPages = data === null ? 1 : Math.max(1, Math.ceil(data.total / data.limit));
  const busyMessage =
    deletingId !== null
      ? t("history.deletingStatus")
      : exporting.size > 0
        ? t("history.exportingStatus")
        : null;

  return (
    <section className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("history.title")}</h1>
        {data === null ? null : (
          <p className="text-sm text-slate-600">{t(`history.count`, { count: data.total })}</p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <h2 className="font-semibold text-slate-900">{t("history.exportTitle")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("history.exportHint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void download("csv")}
            aria-disabled={exporting.has("csv")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-hover aria-disabled:bg-slate-400"
          >
            {/* The idle icon and the spinner occupy the same box, so the busy state neither
                reflows the button nor leaves a hole in it while idle. The label never changes. */}
            {exporting.has("csv") ? (
              <Spinner label={false} />
            ) : (
              <Download aria-hidden="true" className="size-4" />
            )}
            {t("history.exportCsv")}
          </button>
          <button
            type="button"
            onClick={() => void download("json")}
            aria-disabled={exporting.has("json")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 aria-disabled:text-slate-400"
          >
            {exporting.has("json") ? (
              <Spinner label={false} />
            ) : (
              <Download aria-hidden="true" className="size-4" />
            )}
            {t("history.exportJson")}
          </button>
        </div>
      </div>
      <p role="status" className="sr-only">
        {busyMessage}
      </p>

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
          <ul className="flex flex-col gap-3">
            {data.items.map((receipt) => (
              <li
                key={receipt.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <Link
                  to={receiptRoute(receipt)}
                  className="block rounded-lg outline-offset-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{receipt.sellerName ?? t("history.noSeller")}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {receipt.documentNumber ?? t("history.noNumber")}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
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

                <div className="mt-3 flex flex-wrap gap-2">
                  {pendingDelete === receipt.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void remove(receipt.id)}
                        aria-disabled={deletingId === receipt.id}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800 aria-disabled:bg-red-400"
                      >
                        {deletingId === receipt.id ? (
                          <Spinner label={false} />
                        ) : (
                          <Trash2 aria-hidden="true" className="size-4" />
                        )}
                        {t("history.confirmDelete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (deletingId === null) setPendingDelete(null);
                        }}
                        aria-disabled={deletingId === receipt.id}
                        className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 aria-disabled:text-slate-400"
                      >
                        {t("history.cancelDelete")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(receipt.id)}
                      className="min-h-11 rounded-lg border border-red-300 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                    >
                      {t("history.delete")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

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
    </section>
  );
}

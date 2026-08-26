import { ChevronLeft, Download, FileJson, FileSpreadsheet, TriangleAlert } from "lucide-react";
import {
  cloneElement,
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ReactElement,
} from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import type { ExportFormat, ReceiptDetailResponse, SourceRegionsResponse } from "@receipt/shared";
import {
  confirmReceipt,
  exportReceipt,
  getReceipt,
  getReceiptRegions,
  updateReceipt,
} from "../api/client";
import { ActionMenu } from "../components/ActionMenu";
import { ErrorMessage } from "../components/ErrorMessage";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { receiptExportFilename, saveBlob } from "../history/download";
import { ItemRows } from "../review/ItemRows";
import { SourceDocumentPanel } from "../review/SourceDocumentPanel";
import { SECTION_COLOURS, type Section } from "../review/regionSections";
import { toFormValues, toPatch, type ReviewFormValues } from "../review/reviewForm";

const sellerFields = ["sellerName", "sellerAddress", "sellerOib"] as const;
const buyerFields = ["buyerName", "buyerAddress", "buyerOib"] as const;
const receiptTextFields = ["paymentMethod", "jir", "zki"] as const;

function amountValidation(value: string) {
  return (
    value.trim() === "" ||
    toPatch({ ...toFormValues({}), total: value }).total !== null ||
    "review.errors.amount"
  );
}

function dateValidation(value: string) {
  return (
    value.trim() === "" ||
    toPatch({ ...toFormValues({}), issueDate: value }).issueDate !== null ||
    "review.errors.date"
  );
}

function timeValidation(value: string) {
  return (
    value.trim() === "" ||
    toPatch({ ...toFormValues({}), issueTime: value }).issueTime !== null ||
    "review.errors.time"
  );
}

function currencyValidation(value: string) {
  return value.trim() === "" || value.trim().length === 3 || "review.errors.currency";
}

interface ReviewFieldProps {
  field: string;
  label: string;
  lowConfidenceFields: readonly string[];
  warnings: ReceiptDetailResponse["warnings"];
  input: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
}

function ReviewField({ field, label, lowConfidenceFields, warnings, input }: ReviewFieldProps) {
  const { t } = useTranslation();
  const fieldWarnings = warnings.filter((warning) => warning.field === field);
  const lowConfidence = lowConfidenceFields.includes(field);
  const hasHint = lowConfidence || fieldWarnings.length > 0;
  const hintId = `review-hint-${field.replaceAll(".", "-")}`;

  return (
    <label className="flex flex-col gap-1">
      <span>{label}</span>
      {/* Amber means "this needs your attention", whichever signal raised it — a low-confidence
          reading or a warning such as an empty critical field. Marking only low-confidence values
          left warned fields with an amber explanation under a plain input, which reads as two
          unrelated conventions. */}
      {cloneElement(input, {
        id: `review-field-${field.replaceAll(".", "-")}`,
        className: `min-h-11 w-full rounded-lg border px-3 ${
          hasHint ? "border-amber-500 bg-amber-50" : "border-slate-300 bg-white"
        }`,
        ...(hasHint ? { "aria-describedby": hintId } : {}),
      })}
      {hasHint ? (
        <span id={hintId} className="flex items-start gap-1 text-sm text-amber-900">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {fieldWarnings.length > 0
              ? fieldWarnings.map((warning) => t(`warnings.${warning.code}`)).join(" ")
              : t("review.lowConfidence")}
          </span>
        </span>
      ) : null}
    </label>
  );
}

export function ReviewPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<ReceiptDetailResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void getReceipt(id)
      .then((next) => {
        if (!active) return;
        if (next.status === "processing" || next.status === "failed") {
          navigate(`/receipts/${id}/processing`, { replace: true });
        } else setReceipt(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("[review] could not load the receipt", error);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [id, navigate]);

  if (!id) return <ErrorMessage message={t("review.errors.load")} />;
  if (failed)
    return (
      <ErrorMessage message={t("review.errors.load")} onRetry={() => window.location.reload()} />
    );
  if (receipt === null)
    return (
      <div
        role="status"
        aria-label={t("common.loading")}
        className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-6"
      >
        <Skeleton className="h-7 w-48" />
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex flex-col gap-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
      </div>
    );

  return <ReviewForm receipt={receipt} receiptId={id} onReceipt={setReceipt} />;
}

interface ReviewFormProps {
  receipt: ReceiptDetailResponse;
  receiptId: string;
  onReceipt: (receipt: ReceiptDetailResponse) => void;
}

function ReviewForm({ receipt, receiptId, onReceipt }: ReviewFormProps) {
  const { t } = useTranslation();
  const { show } = useToast();
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<SourceRegionsResponse | null>(null);
  const [activeField, setActiveField] = useState<string | null>(null);
  const { register, control, handleSubmit, reset, formState } = useForm<ReviewFormValues>({
    values: toFormValues(receipt),
  });
  const vat = useFieldArray({ control, name: "vatBreakdown" });
  const items = useFieldArray({ control, name: "items" });

  useEffect(() => {
    let active = true;
    void getReceiptRegions(receiptId)
      .then((next) => active && setRegions(next))
      .catch((caught: unknown) => {
        // Non-fatal by design: the form still works, it just loses the source outlines.
        if (!active) return;
        console.error("[review] could not load source regions; overlays are unavailable", caught);
        setRegions(null);
      });
    return () => {
      active = false;
    };
  }, [receiptId]);

  function selectRegion(field: string) {
    setActiveField(field);
    document.getElementById(`review-field-${field.replaceAll(".", "-")}`)?.focus();
  }

  const sourceValues = fieldValues(receipt);

  const messages = (field: string) =>
    receipt.warnings
      .filter((warning) => warning.field === field)
      .map((warning) => (
        <p key={`${warning.code}-${field}`} className="text-sm text-amber-900">
          {t(`warnings.${warning.code}`)}
        </p>
      ));
  const formError = (message: unknown): string | null => {
    if (typeof message !== "string") return null;
    return String(
      t(
        message as
          | "review.errors.amount"
          | "review.errors.date"
          | "review.errors.time"
          | "review.errors.currency",
      ),
    );
  };

  async function save(values: ReviewFormValues) {
    setSaving(true);
    setError(null);
    try {
      const next = await updateReceipt(receiptId, toPatch(values));
      onReceipt(next);
      reset(toFormValues(next));
      show(t("review.saved"));
    } catch (caught) {
      console.error("[review] saving the receipt failed", caught);
      setError(t("review.errors.save"));
    } finally {
      setSaving(false);
    }
  }

  /** Confirming and then having to go back to the list to download the result is a detour. */
  async function download(format: ExportFormat) {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const blob = await exportReceipt(receiptId, format);
      saveBlob(blob, receiptExportFilename({ ...receipt, id: receiptId }, format));
    } catch (caught) {
      console.error("[review] downloading the export failed", caught);
      setError(t("review.errors.download"));
    } finally {
      setDownloading(false);
    }
  }

  async function confirm() {
    setConfirming(true);
    setError(null);
    try {
      const next = await confirmReceipt(receiptId);
      onReceipt({ ...receipt, ...next });
      show(t("review.confirmed"));
    } catch (caught) {
      console.error("[review] confirming the receipt failed", caught);
      setError(t("review.errors.confirm"));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
      <form
        onSubmit={handleSubmit(save)}
        onFocusCapture={(event) => {
          const field = (event.target as HTMLElement).id.replace("review-field-", "");
          if (field !== "") setActiveField(field.replaceAll("-", "."));
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setActiveField(null);
        }}
        className="flex max-w-lg flex-col gap-5"
      >
        <div>
          <Link
            to="/receipts"
            className="mb-2 inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {t("review.backToReceipts")}
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">{t("review.title")}</h1>
            {receipt.status === "confirmed" ? (
              <ActionMenu
                id="receipt-download-menu"
                variant="labelled"
                icon={Download}
                label={t("common.download")}
                busy={downloading}
                items={[
                  {
                    key: "csv",
                    label: t("common.downloadCsv"),
                    icon: FileSpreadsheet,
                    onSelect: () => void download("csv"),
                  },
                  {
                    key: "json",
                    label: t("common.downloadJson"),
                    icon: FileJson,
                    onSelect: () => void download("json"),
                  },
                ]}
              />
            ) : null}
          </div>
          {receipt.status === "confirmed" ? (
            <p className="text-green-700">{t("review.confirmed")}</p>
          ) : null}
          {formState.isDirty ? (
            <p className="text-sm text-amber-900">{t("review.unsaved")}</p>
          ) : null}
        </div>

        <details className="lg:hidden">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">
            {t("review.showSource")}
          </summary>
          <SourceDocumentPanel
            receiptId={receiptId}
            regions={regions}
            activeField={activeField}
            interaction="popover"
            fieldValues={sourceValues}
            lowConfidenceFields={receipt.lowConfidenceFields}
            editedFields={receipt.editedFields}
            onSelect={selectRegion}
          />
        </details>

        <fieldset className="flex flex-col gap-3">
          <SectionLegend section="seller" label={t("review.seller")} />
          {sellerFields.map((field) => (
            <ReviewField
              key={field}
              field={field}
              label={t(`review.fields.${field}`)}
              lowConfidenceFields={receipt.lowConfidenceFields}
              warnings={receipt.warnings}
              input={<input {...register(field)} />}
            />
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <SectionLegend section="buyer" label={t("review.buyer")} />
          {buyerFields.map((field) => (
            <ReviewField
              key={field}
              field={field}
              label={t(`review.fields.${field}`)}
              lowConfidenceFields={receipt.lowConfidenceFields}
              warnings={receipt.warnings}
              input={<input {...register(field)} />}
            />
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <SectionLegend section="receipt" label={t("review.receipt")} />
          <ReviewField
            field="documentNumber"
            label={t("review.fields.documentNumber")}
            lowConfidenceFields={receipt.lowConfidenceFields}
            warnings={receipt.warnings}
            input={<input {...register("documentNumber")} />}
          />
          <ReviewField
            field="issueDate"
            label={t("review.fields.issueDate")}
            lowConfidenceFields={receipt.lowConfidenceFields}
            warnings={receipt.warnings}
            input={<input {...register("issueDate", { validate: dateValidation })} />}
          />
          {formError(formState.errors.issueDate?.message)}
          <ReviewField
            field="issueTime"
            label={t("review.fields.issueTime")}
            lowConfidenceFields={receipt.lowConfidenceFields}
            warnings={receipt.warnings}
            input={<input {...register("issueTime", { validate: timeValidation })} />}
          />
          {formError(formState.errors.issueTime?.message)}
          <ReviewField
            field="subtotal"
            label={t("review.fields.subtotal")}
            lowConfidenceFields={receipt.lowConfidenceFields}
            warnings={receipt.warnings}
            input={<input {...register("subtotal", { validate: amountValidation })} />}
          />
          {formError(formState.errors.subtotal?.message)}
          <ReviewField
            field="total"
            label={t("review.fields.total")}
            lowConfidenceFields={receipt.lowConfidenceFields}
            warnings={receipt.warnings}
            input={<input {...register("total", { validate: amountValidation })} />}
          />
          {formError(formState.errors.total?.message)}
          <ReviewField
            field="currency"
            label={t("review.fields.currency")}
            lowConfidenceFields={receipt.lowConfidenceFields}
            warnings={receipt.warnings}
            input={<input {...register("currency", { validate: currencyValidation })} />}
          />
          {formError(formState.errors.currency?.message)}
          {receiptTextFields.map((field) => (
            <ReviewField
              key={field}
              field={field}
              label={t(`review.fields.${field}`)}
              lowConfidenceFields={receipt.lowConfidenceFields}
              warnings={receipt.warnings}
              input={<input {...register(field)} />}
            />
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <SectionLegend section="vat" label={t("review.vat")} />
          {/* `vat_arithmetic_mismatch` concerns the breakdown as a whole, so the engine emits it
              against the bare `vatBreakdown` path rather than an indexed cell. It has to be read
              here; the per-cell lookups below can never match it. */}
          {messages("vatBreakdown")}
          {vat.fields.map((field, index) => (
            <div key={field.id} className="grid gap-2 rounded border border-slate-200 p-3">
              {(["rate", "taxableBase", "vatAmount"] as const).map((name) => (
                <ReviewField
                  key={name}
                  field={`vatBreakdown.${index}.${name}`}
                  label={t(`review.fields.${name}`)}
                  lowConfidenceFields={receipt.lowConfidenceFields}
                  warnings={receipt.warnings}
                  input={
                    <input
                      {...register(`vatBreakdown.${index}.${name}`, { validate: amountValidation })}
                    />
                  }
                />
              ))}
              <button
                type="button"
                onClick={() => vat.remove(index)}
                className="min-h-11 text-left underline"
              >
                {t("review.removeRow")}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => vat.append({ rate: "", taxableBase: "", vatAmount: "" })}
            className="min-h-11 text-left underline"
          >
            {t("review.addVat")}
          </button>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <SectionLegend section="items" label={t("review.items")} />
          <ItemRows
            fields={items.fields}
            register={register}
            amountValidation={amountValidation}
            lowConfidenceFields={receipt.lowConfidenceFields}
            warnings={receipt.warnings}
            onRemove={(index) => items.remove(index)}
            onAppend={() =>
              items.append({ description: "", quantity: "", unitPrice: "", total: "" })
            }
          />
        </fieldset>

        {error ? (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100 disabled:bg-slate-100"
        >
          {saving ? t("review.saving") : t("review.save")}
        </button>
        <button
          type="button"
          disabled={confirming || formState.isDirty}
          onClick={() => void confirm()}
          className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover disabled:bg-slate-400"
        >
          {confirming ? t("review.confirming") : t("review.confirm")}
        </button>
      </form>
      <aside className="sticky top-4 hidden h-fit lg:block">
        <SourceDocumentPanel
          receiptId={receiptId}
          regions={regions}
          activeField={activeField}
          interaction="focus"
          fieldValues={sourceValues}
          lowConfidenceFields={receipt.lowConfidenceFields}
          editedFields={receipt.editedFields}
          onSelect={selectRegion}
        />
      </aside>
    </section>
  );
}

/**
 * Flattens the receipt to canonical dotted paths (`total`, `vatBreakdown.0.rate`, `items.2.total`)
 * so the mobile popover can show what a region's field currently holds. Reads the saved receipt
 * rather than the live form, which keeps it out of react-hook-form's render path.
 */
function fieldValues(receipt: ReceiptDetailResponse): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (value: unknown, prefix: string) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${prefix}${index}.`));
    } else if (typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) walk(entry, `${prefix}${key}.`);
    } else {
      out[prefix.slice(0, -1)] = String(value);
    }
  };
  walk(receipt, "");
  return out;
}

function SectionLegend({ section, label }: { section: Section; label: string }) {
  return (
    <legend className="flex items-center gap-2 font-semibold">
      <span className="size-2 rounded-full" style={{ backgroundColor: SECTION_COLOURS[section] }} />
      {label}
    </legend>
  );
}

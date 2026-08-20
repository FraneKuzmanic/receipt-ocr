import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import type { ReceiptDetailResponse } from "@receipt/shared";
import { confirmReceipt, getReceipt, updateReceipt } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Spinner } from "../components/Spinner";
import { SourceDocumentPanel } from "../review/SourceDocumentPanel";
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
        if (next.status === "processing") navigate(`/receipts/${id}/processing`, { replace: true });
        else setReceipt(next);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [id, navigate]);

  if (!id) return <ErrorMessage message={t("review.errors.load")} />;
  if (failed)
    return (
      <ErrorMessage message={t("review.errors.load")} onRetry={() => window.location.reload()} />
    );
  if (receipt === null) return <Spinner />;

  return <ReviewForm receipt={receipt} receiptId={id} onReceipt={setReceipt} />;
}

interface ReviewFormProps {
  receipt: ReceiptDetailResponse;
  receiptId: string;
  onReceipt: (receipt: ReceiptDetailResponse) => void;
}

function ReviewForm({ receipt, receiptId, onReceipt }: ReviewFormProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit, reset, formState } = useForm<ReviewFormValues>({
    values: toFormValues(receipt),
  });
  const vat = useFieldArray({ control, name: "vatBreakdown" });
  const items = useFieldArray({ control, name: "items" });

  const fieldClass = (field: string) =>
    `min-h-11 w-full rounded-lg border px-3 ${
      receipt.lowConfidenceFields.includes(field)
        ? "border-amber-500 bg-amber-50"
        : "border-slate-300 bg-white"
    }`;
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
    } catch {
      setError(t("review.errors.save"));
    } finally {
      setSaving(false);
    }
  }

  async function confirm() {
    setConfirming(true);
    setError(null);
    try {
      const next = await confirmReceipt(receiptId);
      onReceipt({ ...receipt, ...next });
    } catch {
      setError(t("review.errors.confirm"));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
      <form onSubmit={handleSubmit(save)} className="flex max-w-lg flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold">{t("review.title")}</h1>
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
          <SourceDocumentPanel receiptId={receiptId} />
        </details>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">{t("review.seller")}</legend>
          {sellerFields.map((field) => (
            <label key={field} className="flex flex-col gap-1">
              <span>{t(`review.fields.${field}`)}</span>
              <input className={fieldClass(field)} {...register(field)} />
              {receipt.lowConfidenceFields.includes(field) ? (
                <span className="text-sm text-amber-900">{t("review.lowConfidence")}</span>
              ) : null}
              {messages(field)}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">{t("review.buyer")}</legend>
          {buyerFields.map((field) => (
            <label key={field} className="flex flex-col gap-1">
              <span>{t(`review.fields.${field}`)}</span>
              <input className={fieldClass(field)} {...register(field)} />
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">{t("review.receipt")}</legend>
          <label className="flex flex-col gap-1">
            <span>{t("review.fields.documentNumber")}</span>
            <input className={fieldClass("documentNumber")} {...register("documentNumber")} />
            {receipt.lowConfidenceFields.includes("documentNumber") ? (
              <span className="text-sm text-amber-900">{t("review.lowConfidence")}</span>
            ) : null}
            {messages("documentNumber")}
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("review.fields.issueDate")}</span>
            <input
              className={fieldClass("issueDate")}
              {...register("issueDate", { validate: dateValidation })}
            />
            {formError(formState.errors.issueDate?.message)}
            {messages("issueDate")}
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("review.fields.issueTime")}</span>
            <input
              className={fieldClass("issueTime")}
              {...register("issueTime", { validate: timeValidation })}
            />
            {formError(formState.errors.issueTime?.message)}
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("review.fields.subtotal")}</span>
            <input
              className={fieldClass("subtotal")}
              {...register("subtotal", { validate: amountValidation })}
            />
            {formError(formState.errors.subtotal?.message)}
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("review.fields.total")}</span>
            <input
              className={fieldClass("total")}
              {...register("total", { validate: amountValidation })}
            />
            {formError(formState.errors.total?.message)}
            {messages("total")}
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("review.fields.currency")}</span>
            <input
              className={fieldClass("currency")}
              {...register("currency", { validate: currencyValidation })}
            />
            {formError(formState.errors.currency?.message)}
            {messages("currency")}
          </label>
          {receiptTextFields.map((field) => (
            <label key={field} className="flex flex-col gap-1">
              <span>{t(`review.fields.${field}`)}</span>
              <input className={fieldClass(field)} {...register(field)} />
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">{t("review.vat")}</legend>
          {vat.fields.map((field, index) => (
            <div key={field.id} className="grid gap-2 rounded border border-slate-200 p-3">
              {(["rate", "taxableBase", "vatAmount"] as const).map((name) => (
                <label key={name} className="flex flex-col gap-1">
                  <span>{t(`review.fields.${name}`)}</span>
                  <input
                    className={fieldClass(`vatBreakdown.${index}.${name}`)}
                    {...register(`vatBreakdown.${index}.${name}`, { validate: amountValidation })}
                  />
                  {messages(`vatBreakdown.${index}.${name}`)}
                </label>
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
          <legend className="font-semibold">{t("review.items")}</legend>
          {items.fields.map((field, index) => (
            <div key={field.id} className="grid gap-2 rounded border border-slate-200 p-3">
              <label className="flex flex-col gap-1">
                <span>{t("review.fields.description")}</span>
                <input
                  className={fieldClass(`items.${index}.description`)}
                  {...register(`items.${index}.description`)}
                />
              </label>
              {(["quantity", "unitPrice", "total"] as const).map((name) => (
                <label key={name} className="flex flex-col gap-1">
                  <span>{t(`review.fields.${name}`)}</span>
                  <input
                    className={fieldClass(`items.${index}.${name}`)}
                    {...register(`items.${index}.${name}`, { validate: amountValidation })}
                  />
                </label>
              ))}
              <button
                type="button"
                onClick={() => items.remove(index)}
                className="min-h-11 text-left underline"
              >
                {t("review.removeRow")}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              items.append({ description: "", quantity: "", unitPrice: "", total: "" })
            }
            className="min-h-11 text-left underline"
          >
            {t("review.addItem")}
          </button>
        </fieldset>

        {error ? (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-lg bg-slate-900 px-4 font-semibold text-white disabled:bg-slate-400"
        >
          {saving ? t("review.saving") : t("review.save")}
        </button>
        <button
          type="button"
          disabled={confirming || formState.isDirty}
          onClick={() => void confirm()}
          className="min-h-11 rounded-lg border border-slate-300 px-4 font-semibold disabled:bg-slate-100"
        >
          {confirming ? t("review.confirming") : t("review.confirm")}
        </button>
      </form>
      <aside className="sticky top-4 hidden h-fit lg:block">
        <SourceDocumentPanel receiptId={receiptId} />
      </aside>
    </section>
  );
}

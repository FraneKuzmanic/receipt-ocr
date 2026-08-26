import { TriangleAlert, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { FieldArrayWithId, UseFormRegister } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { ReceiptDetailResponse } from "@receipt/shared";
import { useWideLayout } from "../history/useWideLayout";
import type { ReviewFormValues } from "./reviewForm";

const NUMERIC_FIELDS = ["quantity", "unitPrice", "total"] as const;
const ITEM_FIELDS = ["description", "quantity", "unitPrice", "total"] as const;

interface ItemRowsProps {
  fields: Array<FieldArrayWithId<ReviewFormValues, "items", "id">>;
  register: UseFormRegister<ReviewFormValues>;
  amountValidation: (value: string) => string | boolean;
  lowConfidenceFields: readonly string[];
  warnings: ReceiptDetailResponse["warnings"];
  onRemove: (index: number) => void;
  onAppend: () => void;
}

/**
 * The items list, dense by design. Every other section repeats a full label above every input,
 * which is right for fifteen one-off header fields and wrong for a receipt with twenty items —
 * four stacked label/input pairs per item turned the section into most of the page. The field
 * name is therefore carried once by a column header (wide) or a small inline caption (narrow),
 * and each item occupies one row.
 *
 * Layout is chosen once at `lg` through the same `useWideLayout` the receipts list uses, so the
 * table and the cards never both exist in the accessibility tree.
 */
export function ItemRows({
  fields,
  register,
  amountValidation,
  lowConfidenceFields,
  warnings,
  onRemove,
  onAppend,
}: ItemRowsProps) {
  const { t } = useTranslation();
  const wide = useWideLayout();

  /**
   * A dense row has no space for an explanation under each cell, so the amber marking stays on the
   * exact cell and the words collapse to one note per item. Warnings win over the generic
   * low-confidence hint on the same field, matching `ReviewField`.
   */
  function noteFor(index: number): { flagged: (name: string) => boolean; note: ReactNode } {
    const entries = ITEM_FIELDS.map((name) => {
      const path = `items.${index}.${name}`;
      const fieldWarnings = warnings.filter((warning) => warning.field === path);
      const messages =
        fieldWarnings.length > 0
          ? fieldWarnings.map((warning) => t(`warnings.${warning.code}`))
          : lowConfidenceFields.includes(path)
            ? [t("review.lowConfidence")]
            : [];
      return { name, messages };
    });
    const flagged = new Set<string>(
      entries.filter((entry) => entry.messages.length > 0).map((entry) => entry.name),
    );

    return {
      flagged: (name) => flagged.has(name),
      note:
        flagged.size === 0 ? null : (
          <span
            id={`review-item-note-${index}`}
            className="flex items-start gap-1 text-sm text-amber-900"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              {entries
                .filter((entry) => entry.messages.length > 0)
                .map((entry) => (
                  <span key={entry.name} className="mr-2 inline-block">
                    <span className="font-medium">{t(`review.fields.${entry.name}`)}</span>{" "}
                    {entry.messages.join(" ")}
                  </span>
                ))}
            </span>
          </span>
        ),
    };
  }

  function inputProps(index: number, name: string, isFlagged: boolean) {
    const path = `items.${index}.${name}` as `items.${number}.description`;
    return {
      id: `review-field-items-${index}-${name}`,
      className: `min-h-11 w-full min-w-0 rounded-lg border px-3 ${
        isFlagged ? "border-amber-500 bg-amber-50" : "border-slate-300 bg-white"
      }`,
      ...(isFlagged ? { "aria-describedby": `review-item-note-${index}` } : {}),
      ...register(path, name === "description" ? {} : { validate: amountValidation }),
    };
  }

  function removeButton(index: number) {
    return (
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={t("review.removeItem", { number: index + 1 })}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-600"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    );
  }

  const addButton = (
    <button type="button" onClick={onAppend} className="min-h-11 text-left underline">
      {t("review.addItem")}
    </button>
  );

  if (!wide) {
    return (
      <>
        {fields.map((field, index) => {
          const { flagged, note } = noteFor(index);
          return (
            <div key={field.id} className="grid gap-2 rounded border border-slate-200 p-3">
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm text-slate-600">{t("review.fields.description")}</span>
                  <input {...inputProps(index, "description", flagged("description"))} />
                </label>
                {removeButton(index)}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {NUMERIC_FIELDS.map((name) => (
                  <label key={name} className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm text-slate-600">{t(`review.fields.${name}`)}</span>
                    <input {...inputProps(index, name, flagged(name))} />
                  </label>
                ))}
              </div>
              {note}
            </div>
          );
        })}
        {addButton}
      </>
    );
  }

  return (
    <>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="text-left text-sm text-slate-600">
            <th scope="col" className="w-[40%] pb-1 pr-2 font-medium">
              {t("review.fields.description")}
            </th>
            <th scope="col" className="w-[16%] pb-1 pr-2 font-medium">
              {t("review.fields.quantity")}
            </th>
            <th scope="col" className="w-[20%] pb-1 pr-2 font-medium">
              {t("review.fields.unitPrice")}
            </th>
            <th scope="col" className="w-[20%] pb-1 pr-2 font-medium">
              {t("review.fields.total")}
            </th>
            <th scope="col" className="w-11">
              <span className="sr-only">{t("review.removeRow")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field, index) => {
            const { flagged, note } = noteFor(index);
            return (
              <Fragment key={field.id}>
                <tr>
                  {ITEM_FIELDS.map((name) => (
                    <td key={name} className="pb-2 pr-2 align-top">
                      <input
                        {...inputProps(index, name, flagged(name))}
                        aria-label={t("review.itemFieldLabel", {
                          field: t(`review.fields.${name}`),
                          number: index + 1,
                        })}
                      />
                    </td>
                  ))}
                  <td className="pb-2 align-top">{removeButton(index)}</td>
                </tr>
                {note ? (
                  <tr>
                    <td colSpan={5} className="pb-2">
                      {note}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {addButton}
    </>
  );
}

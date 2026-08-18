import { Camera, FileText, FileUp, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ApiError, createReceipt } from "../api/client";
import {
  CAMERA_ACCEPT,
  FILE_ACCEPT,
  type QualityWarning,
  type ReceiptFileKind,
  analyzeReceiptImage,
  classifyReceiptFile,
} from "../capture/receiptFile";
import { Spinner } from "../components/Spinner";
import { uploadErrorCodeSchema } from "@receipt/shared";

interface SelectedReceipt {
  file: File;
  kind: ReceiptFileKind;
  previewUrl?: string;
  warnings: QualityWarning[];
}

function sizeInMegabytes(size: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(size / 1024 / 1024);
}

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | undefined>(undefined);
  const selectionVersion = useRef(0);
  const [selected, setSelected] = useState<SelectedReceipt | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  function clearSelection() {
    selectionVersion.current += 1;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = undefined;
    if (cameraInput.current) cameraInput.current.value = "";
    if (fileInput.current) fileInput.current.value = "";
    setSelected(null);
    setChecking(false);
    setError(null);
  }

  async function selectFile(file: File | undefined) {
    if (!file) return;

    const result = classifyReceiptFile(file);
    if (!result.ok) {
      clearSelection();
      setError(t(`capture.errors.${result.error}`));
      return;
    }

    clearSelection();
    const version = selectionVersion.current;
    if (result.kind === "pdf") {
      setSelected({ file, kind: "pdf", warnings: [] });
      return;
    }

    setChecking(true);
    try {
      const analysis = await analyzeReceiptImage(file);
      if (selectionVersion.current !== version) return;

      const nextPreviewUrl = URL.createObjectURL(file);
      previewUrl.current = nextPreviewUrl;
      setSelected({ file, kind: "image", previewUrl: nextPreviewUrl, warnings: analysis.warnings });
    } catch {
      if (selectionVersion.current === version) setError(t("capture.errors.preview_unavailable"));
    } finally {
      if (selectionVersion.current === version) setChecking(false);
    }
  }

  async function upload() {
    if (!selected || uploading) return;

    setUploading(true);
    setError(null);
    try {
      const receipt = await createReceipt(selected.file);
      navigate(`/receipts/${receipt.id}/processing`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code) {
        const code = uploadErrorCodeSchema.safeParse(caught.code);
        if (code.success) {
          setError(t(`upload.${code.data}`));
          return;
        }
      }
      setError(t("capture.errors.generic"));
    } finally {
      setUploading(false);
    }
  }

  const chooseLabel = selected?.kind === "image" ? t("capture.usePhoto") : t("capture.useFile");

  return (
    <section className="mx-auto flex max-w-lg flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("capture.title")}</h1>
        <p className="text-slate-600">{t("capture.guidance")}</p>
      </div>

      {selected ? (
        <div className="flex flex-col gap-4" aria-live="polite">
          {selected.kind === "image" && selected.previewUrl ? (
            <img
              src={selected.previewUrl}
              alt={t("capture.imagePreview")}
              className="max-h-[60dvh] w-full rounded-xl border border-slate-200 bg-white object-contain"
            />
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-center">
              <FileText aria-hidden="true" className="size-10 text-slate-600" />
              <p className="break-all font-medium">{selected.file.name}</p>
              <p className="text-sm text-slate-600">{t("capture.documentPreview")}</p>
            </div>
          )}

          <p className="text-sm text-slate-600">
            {selected.file.name} ·{" "}
            {t("capture.fileSize", { size: sizeInMegabytes(selected.file.size) })}
          </p>
          {selected.warnings.map((warning) => (
            <p
              key={warning}
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950"
            >
              {warning === "low_resolution"
                ? t("capture.lowResolution")
                : t("capture.possibleBlur")}
            </p>
          ))}

          <button
            type="button"
            onClick={() => void upload()}
            disabled={uploading}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {uploading ? <Spinner /> : <FileUp aria-hidden="true" className="size-5" />}
            {uploading ? t("capture.uploading") : chooseLabel}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={uploading}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed"
          >
            <RotateCcw aria-hidden="true" className="size-5" />
            {selected.kind === "image" ? t("capture.retake") : t("capture.chooseAnother")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 font-semibold text-white hover:bg-slate-700">
            <Camera aria-hidden="true" className="size-5" />
            {t("capture.scanReceipt")}
            <input
              ref={cameraInput}
              type="file"
              accept={CAMERA_ACCEPT}
              capture="environment"
              className="sr-only"
              disabled={checking}
              onChange={(event) => void selectFile(event.currentTarget.files?.[0])}
            />
          </label>
          <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100">
            <FileUp aria-hidden="true" className="size-5" />
            {t("capture.chooseFile")}
            <input
              ref={fileInput}
              type="file"
              accept={FILE_ACCEPT}
              className="sr-only"
              disabled={checking}
              onChange={(event) => void selectFile(event.currentTarget.files?.[0])}
            />
          </label>
          {checking ? <Spinner /> : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          {error}
        </p>
      ) : null}
    </section>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SourceRegionsResponse } from "@receipt/shared";
import { getReceiptSource } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Spinner } from "../components/Spinner";
import { SourceOverlay } from "./SourceOverlay";

interface SourceDocumentPanelProps {
  receiptId: string;
  regions: SourceRegionsResponse | null;
  activeField: string | null;
  onSelect: (field: string) => void;
  onSourceLoad: (source: Awaited<ReturnType<typeof getReceiptSource>>) => void;
  onOverlaySafetyChange: (safe: boolean) => void;
}

export function SourceDocumentPanel({
  receiptId,
  regions,
  activeField,
  onSelect,
  onSourceLoad,
  onOverlaySafetyChange,
}: SourceDocumentPanelProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Awaited<ReturnType<typeof getReceiptSource>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retriedImage, setRetriedImage] = useState(false);

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const next = await getReceiptSource(receiptId);
      setSource(next);
      onSourceLoad(next);
      onOverlaySafetyChange(false);
      setRetriedImage(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [receiptId]);

  if (loading) return <Spinner />;
  if (failed || source === null)
    return <ErrorMessage message={t("review.errors.load")} onRetry={() => void load()} />;

  const isPdf = source.contentType === "application/pdf";
  const page = regions?.pages[0];

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <h2 className="font-semibold">{t("review.sourceTitle")}</h2>
      {isPdf ? (
        <>
          <object
            data={source.url}
            type="application/pdf"
            className="min-h-96 w-full rounded border border-slate-200"
          >
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center underline"
            >
              {t("review.openSource")}
            </a>
          </object>
          <p className="text-sm text-slate-600">{t("review.highlightsUnavailablePdf")}</p>
        </>
      ) : (
        <ImageSource
          source={source}
          aspectRatio={page?.aspectRatio}
          regions={regions}
          activeField={activeField}
          onSelect={onSelect}
          onOverlaySafetyChange={onOverlaySafetyChange}
          onRetry={() => {
            if (!retriedImage) {
              setRetriedImage(true);
              void load();
            }
          }}
          alt={t("review.sourceAlt")}
        />
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center underline"
        >
          {t("review.openSource")}
        </a>
      </div>
    </section>
  );
}

interface ImageSourceProps {
  source: Awaited<ReturnType<typeof getReceiptSource>>;
  aspectRatio: number | undefined;
  regions: SourceRegionsResponse | null;
  activeField: string | null;
  onSelect: (field: string) => void;
  onOverlaySafetyChange: (safe: boolean) => void;
  onRetry: () => void;
  alt: string;
}

function ImageSource({
  source,
  aspectRatio,
  regions,
  activeField,
  onSelect,
  onOverlaySafetyChange,
  onRetry,
  alt,
}: ImageSourceProps) {
  const [overlaySafe, setOverlaySafe] = useState(false);
  const ratio = aspectRatio ?? 1;

  // The box's width is computed from the 65dvh height budget rather than left to shrink-to-fit,
  // because a flex item's `width: auto` + `aspect-ratio` sizing when cross-axis stretch has
  // nothing definite to stretch to is real but easy to get subtly wrong across browsers. An
  // explicit `width: min(100%, 65dvh * ratio)` makes `height = width / ratio` land exactly on the
  // height budget (or under it, when the container is narrower) with no ambiguity — a tall photo
  // is never stretched to fill a height it does not have room for, which `object-contain` used to
  // guarantee and a raw `aspect-ratio` box on its own does not.
  return (
    <div className="flex max-h-[65dvh] w-full justify-center overflow-hidden">
      <div
        className="relative max-h-[65dvh] max-w-full"
        style={{ aspectRatio: String(ratio), width: `min(100%, 65dvh * ${ratio})` }}
      >
        <img
          src={source.url}
          alt={alt}
          className="block size-full"
          onLoad={(event) => {
            const renderedRatio =
              event.currentTarget.naturalWidth / event.currentTarget.naturalHeight;
            const safe = aspectRatio !== undefined && Math.abs(renderedRatio - aspectRatio) < 0.01;
            setOverlaySafe(safe);
            onOverlaySafetyChange(safe);
          }}
          onError={onRetry}
        />
        {overlaySafe && regions !== null && regions.pages[0] !== undefined ? (
          <SourceOverlay
            regions={regions.regions}
            page={regions.pages[0].page}
            activeField={activeField}
            onSelect={onSelect}
          />
        ) : null}
      </div>
    </div>
  );
}

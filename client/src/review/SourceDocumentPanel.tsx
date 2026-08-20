import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getReceiptSource } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Spinner } from "../components/Spinner";

interface SourceDocumentPanelProps {
  receiptId: string;
}

export function SourceDocumentPanel({ receiptId }: SourceDocumentPanelProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Awaited<ReturnType<typeof getReceiptSource>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retriedImage, setRetriedImage] = useState(false);

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      setSource(await getReceiptSource(receiptId));
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

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <h2 className="font-semibold">{t("review.sourceTitle")}</h2>
      {isPdf ? (
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
      ) : (
        <img
          src={source.url}
          alt={t("review.sourceAlt")}
          className="max-h-[65dvh] w-full object-contain"
          onError={() => {
            if (!retriedImage) {
              setRetriedImage(true);
              void load();
            }
          }}
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
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex min-h-11 items-center underline"
        >
          {t("review.reloadSource")}
        </button>
      </div>
    </section>
  );
}

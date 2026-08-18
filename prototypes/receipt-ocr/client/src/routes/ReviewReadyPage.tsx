import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function ReviewReadyPage() {
  const { t } = useTranslation();

  return (
    <section className="mx-auto flex max-w-lg flex-col gap-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">{t("reviewReady.title")}</h1>
      <p className="text-slate-600">{t("reviewReady.description")}</p>
      <Link
        to="/"
        className="flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-4 font-semibold text-white hover:bg-slate-700"
      >
        {t("reviewReady.uploadAnother")}
      </Link>
    </section>
  );
}

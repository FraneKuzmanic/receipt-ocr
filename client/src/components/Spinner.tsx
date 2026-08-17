import { useTranslation } from "react-i18next";

export function Spinner() {
  const { t } = useTranslation();

  return (
    <span role="status" className="inline-flex items-center gap-2 text-slate-600">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
      />
      {t("common.loading")}
    </span>
  );
}

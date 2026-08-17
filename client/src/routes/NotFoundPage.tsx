import { useTranslation } from "react-i18next";

export function NotFoundPage() {
  const { t } = useTranslation();

  return <p className="text-slate-600">{t("errors.notFound")}</p>;
}

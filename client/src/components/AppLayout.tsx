import { useTranslation } from "react-i18next";
import { Outlet } from "react-router";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function AppLayout() {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-base font-semibold">{t("common.appName")}</span>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

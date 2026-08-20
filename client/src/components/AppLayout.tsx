import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { useAuth } from "../auth/useAuth";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { session, signOut } = useAuth();

  // Carried over from Task 02: index.html hardcoded lang="hr" and a Croatian title, so a fresh
  // load in English still advertised Croatian to the browser and to assistive technology.
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "hr";
    document.title = t("common.appName");
  }, [i18n.resolvedLanguage, t]);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-base font-semibold">{t("common.appName")}</span>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            {session === null ? null : (
              <button
                type="button"
                onClick={() => void signOut()}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {t("auth.signOut")}
              </button>
            )}
          </div>
        </div>
        {session === null ? null : (
          <div className="mx-auto flex max-w-3xl gap-2 px-4 pb-3">
            <Link
              to="/"
              className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t("common.navCapture")}
            </Link>
            <Link
              to="/receipts"
              className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t("common.navHistory")}
            </Link>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

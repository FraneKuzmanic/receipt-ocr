import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  function select(language: SupportedLanguage) {
    void i18n.changeLanguage(language).then(() => {
      document.documentElement.lang = language;
    });
  }

  return (
    <div role="group" aria-label={t("common.language")} className="flex gap-1">
      {SUPPORTED_LANGUAGES.map((language) => {
        const active = i18n.resolvedLanguage === language;
        return (
          <button
            key={language}
            type="button"
            lang={language}
            aria-pressed={active}
            onClick={() => {
              select(language);
            }}
            className={`min-h-11 min-w-11 rounded-lg px-3 text-sm font-semibold uppercase transition-colors ${
              active
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-300"
            }`}
          >
            {language}
          </button>
        );
      })}
    </div>
  );
}

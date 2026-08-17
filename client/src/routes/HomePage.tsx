import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getHealth } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Spinner } from "../components/Spinner";

type HealthState = "loading" | "online" | "offline";

export function HomePage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthState>("loading");
  const [attempt, setAttempt] = useState(0);

  // Retrying bumps `attempt`, so the check has exactly one code path and any
  // in-flight request from a previous attempt is always cancelled.
  useEffect(() => {
    let cancelled = false;
    setHealth("loading");

    getHealth()
      .then(() => {
        if (!cancelled) setHealth("online");
      })
      .catch(() => {
        if (!cancelled) setHealth("offline");
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("home.title")}</h1>
      <p className="text-slate-600">{t("home.subtitle")}</p>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-500">{t("home.apiStatus")}</h2>
        <div className="mt-2">
          {health === "loading" ? <Spinner /> : null}
          {health === "online" ? (
            <p className="font-medium text-green-700">{t("home.apiOnline")}</p>
          ) : null}
          {health === "offline" ? (
            <>
              <p className="mb-2 font-medium text-red-700">{t("home.apiOffline")}</p>
              <ErrorMessage
                message={t("errors.network")}
                onRetry={() => {
                  setAttempt((n) => n + 1);
                }}
              />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

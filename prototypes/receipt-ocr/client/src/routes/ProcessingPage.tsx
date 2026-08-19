import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, getReceipt, retryReceipt } from "../api/client";
import { Spinner } from "../components/Spinner";

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 60_000;

type ProcessingState = "polling" | "failed" | "request_error" | "timeout";

export function ProcessingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ProcessingState>("polling");

  async function retry() {
    if (!id) return;
    try {
      await retryReceipt(id);
      setAttempt((value) => value + 1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) return;
      setState("failed");
    }
  }

  useEffect(() => {
    if (!id) return;

    const receiptId = id;

    let cancelled = false;
    let finished = false;
    let pollTimer: number | undefined;
    let timeoutTimer: number | undefined;
    let controller: AbortController | undefined;

    setState("polling");

    function finish(nextState: Exclude<ProcessingState, "polling">) {
      finished = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (timeoutTimer) window.clearTimeout(timeoutTimer);
      if (!cancelled) setState(nextState);
    }

    async function poll() {
      controller = new AbortController();
      try {
        const receipt = await getReceipt(receiptId, controller.signal);
        if (cancelled || finished) return;

        if (receipt.status === "review" || receipt.status === "confirmed") {
          finished = true;
          if (timeoutTimer) window.clearTimeout(timeoutTimer);
          navigate(`/receipts/${receiptId}/review`, { replace: true });
          return;
        }
        if (receipt.status === "failed") {
          finish("failed");
          return;
        }

        pollTimer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } catch {
        if (!cancelled && !finished) finish("request_error");
      }
    }

    timeoutTimer = window.setTimeout(() => {
      if (cancelled || finished) return;
      controller?.abort();
      finish("timeout");
    }, POLL_TIMEOUT_MS);
    void poll();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (timeoutTimer) window.clearTimeout(timeoutTimer);
      controller?.abort();
    };
  }, [attempt, id, navigate]);

  if (state === "polling") {
    return (
      <section
        aria-live="polite"
        className="mx-auto flex max-w-lg flex-col items-center gap-3 py-12 text-center"
      >
        <Spinner />
        <h1 className="text-2xl font-semibold">{t("processing.title")}</h1>
        <p className="text-slate-600">{t("processing.description")}</p>
      </section>
    );
  }

  const message =
    state === "failed"
      ? t("processing.failed")
      : state === "timeout"
        ? t("processing.timeout")
        : t("processing.requestError");

  return (
    <section aria-live="polite" className="mx-auto flex max-w-lg flex-col gap-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">{message}</h1>
      {state === "failed" ? (
        <button
          type="button"
          onClick={() => void retry()}
          className="min-h-11 rounded-lg bg-slate-900 px-4 font-semibold text-white hover:bg-slate-700"
        >
          {t("processing.retry")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="min-h-11 rounded-lg bg-slate-900 px-4 font-semibold text-white hover:bg-slate-700"
        >
          {t("processing.checkAgain")}
        </button>
      )}
      <Link
        to="/"
        className="flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100"
      >
        {t("processing.uploadAnother")}
      </Link>
    </section>
  );
}

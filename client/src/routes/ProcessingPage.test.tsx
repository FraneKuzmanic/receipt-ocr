import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getReceipt } from "../api/client";
import "../i18n";
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS, ProcessingPage } from "./ProcessingPage";

vi.mock("../api/client", () => ({ getReceipt: vi.fn() }));

const mockedGetReceipt = vi.mocked(getReceipt);
const processingReceipt = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  status: "processing" as const,
  warnings: [],
  lowConfidenceFields: [],
  editedFields: [],
  createdAt: "2026-08-18T10:00:00.000Z",
  updatedAt: "2026-08-18T10:00:00.000Z",
};

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/receipts/00000000-0000-4000-8000-000000000001/processing"]}>
      <Routes>
        <Route path="/receipts/:id/processing" element={<ProcessingPage />} />
        <Route path="/receipts/:id/review" element={<Location />} />
        <Route path="/" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ProcessingPage", () => {
  it("polls immediately and then sequentially every two seconds", async () => {
    vi.useFakeTimers();
    mockedGetReceipt.mockResolvedValue(processingReceipt);
    renderPage();

    await act(async () => {});
    expect(mockedGetReceipt).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    expect(mockedGetReceipt).toHaveBeenCalledTimes(2);
  });

  it("does not overlap a pending request", async () => {
    vi.useFakeTimers();
    let resolve!: (value: typeof processingReceipt) => void;
    mockedGetReceipt.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderPage();

    await act(async () => {});
    expect(mockedGetReceipt).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2));
    expect(mockedGetReceipt).toHaveBeenCalledTimes(1);

    await act(async () => resolve(processingReceipt));
  });

  it.each(["review", "confirmed"] as const)(
    "replaces the route for a %s receipt",
    async (status) => {
      mockedGetReceipt.mockResolvedValue({ ...processingReceipt, status });
      renderPage();

      expect(await screen.findByTestId("location")).toHaveTextContent(
        "/receipts/00000000-0000-4000-8000-000000000001/review",
      );
    },
  );

  it("stops on failure and provides a re-upload action", async () => {
    mockedGetReceipt.mockResolvedValue({ ...processingReceipt, status: "failed" });
    renderPage();

    expect(await screen.findByText("This receipt could not be prepared.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload another receipt" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows timeout actions after a finite polling window and starts a new window on retry", async () => {
    vi.useFakeTimers();
    mockedGetReceipt.mockResolvedValue(processingReceipt);
    renderPage();

    await act(async () => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS));
    expect(screen.getByText("This is taking longer than expected.")).toBeInTheDocument();
    await act(async () =>
      screen.getByRole<HTMLButtonElement>("button", { name: "Check again" }).click(),
    );
    expect(mockedGetReceipt.mock.calls.length).toBeGreaterThan(1);
  });

  it("makes a rejected request actionable", async () => {
    mockedGetReceipt.mockRejectedValue(new Error("offline"));
    renderPage();

    expect(
      await screen.findByText("We could not check this receipt right now."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("aborts the active request on unmount", async () => {
    let signal: AbortSignal | undefined;
    mockedGetReceipt.mockImplementation((_id, nextSignal) => {
      signal = nextSignal;
      return new Promise(() => {});
    });
    const page = renderPage();

    await waitFor(() => expect(signal).toBeDefined());
    page.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

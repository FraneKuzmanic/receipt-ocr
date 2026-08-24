import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { CanonicalReceipt } from "@receipt/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteReceipt, exportReceipts, getReceipts } from "../api/client";
import { exportFilename, saveBlob } from "../history/download";
import i18n from "../i18n";
import { HistoryPage } from "./HistoryPage";

vi.mock("../api/client", () => ({
  getReceipts: vi.fn(),
  deleteReceipt: vi.fn(),
  exportReceipts: vi.fn(),
}));
vi.mock("../history/download", () => ({
  exportFilename: vi.fn((format: string) => `receipts-2026-08-20.${format}`),
  saveBlob: vi.fn(),
}));

const receipt: CanonicalReceipt = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  status: "confirmed",
  sellerName: "Market Example",
  documentNumber: "381/1/2",
  issueDate: "2026-08-19",
  total: "8.08",
  currency: "EUR",
  warnings: [],
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

const mockedGetReceipts = vi.mocked(getReceipts);
const mockedDeleteReceipt = vi.mocked(deleteReceipt);
const mockedExportReceipts = vi.mocked(exportReceipts);
const mockedExportFilename = vi.mocked(exportFilename);
const mockedSaveBlob = vi.mocked(saveBlob);

function page(items = [receipt], total = items.length, pageNumber = 1, limit = 20) {
  return { items, page: pageNumber, limit, total };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/receipts"]}>
      <Routes>
        <Route path="/receipts" element={<HistoryPage />} />
        <Route path="/receipts/:id/review" element={<p>Review destination</p>} />
        <Route path="/receipts/:id/processing" element={<p>Processing destination</p>} />
        <Route path="/" element={<p>Capture destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  mockedGetReceipts.mockResolvedValue(page());
  mockedDeleteReceipt.mockResolvedValue();
  mockedExportReceipts.mockResolvedValue(new Blob(["export"]));
});

describe("HistoryPage", () => {
  it("renders receipt summaries with translated status", async () => {
    renderPage();

    expect(await screen.findByText("Market Example")).toBeInTheDocument();
    expect(screen.getByText("381/1/2")).toBeInTheDocument();
    expect(screen.getByText("2026-08-19")).toBeInTheDocument();
    expect(screen.getByText(/8\.08/)).toBeInTheDocument();
    expect(screen.getByText("Confirmed", { selector: "span" })).toBeInTheDocument();
  });

  it("renders an empty state with a capture link", async () => {
    mockedGetReceipts.mockResolvedValue(page([], 0));
    renderPage();

    expect(await screen.findByText("You have not saved any receipts yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scan your first receipt" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("retries a failed load", async () => {
    const user = userEvent.setup();
    mockedGetReceipts.mockRejectedValueOnce(new Error("offline"));
    mockedGetReceipts.mockResolvedValueOnce(page());
    renderPage();

    expect(
      await screen.findByText("Your receipts could not be loaded. Try again."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mockedGetReceipts).toHaveBeenCalledTimes(2));
  });

  it("resets to the first page when filtering by status", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Market Example");
    await user.selectOptions(screen.getByLabelText("Status"), "confirmed");
    await waitFor(() =>
      expect(mockedGetReceipts).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, status: "confirmed" }),
      ),
    );
  });

  it("pages forward and disables the previous button on the first page", async () => {
    const user = userEvent.setup();
    mockedGetReceipts.mockResolvedValue(page([receipt], 45));
    renderPage();

    const previous = await screen.findByRole<HTMLButtonElement>("button", { name: "Previous" });
    expect(previous).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedGetReceipts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  it("requires a second delete click before deleting and then reloads", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Market Example");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(mockedDeleteReceipt).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete this receipt" }));
    await waitFor(() => expect(mockedDeleteReceipt).toHaveBeenCalledWith(receipt.id));
    await waitFor(() => expect(mockedGetReceipts).toHaveBeenCalledTimes(2));
  });

  it("downloads CSV exports from history", async () => {
    const user = userEvent.setup();
    const blob = new Blob(["csv"]);
    mockedExportReceipts.mockResolvedValue(blob);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Download CSV" }));

    await waitFor(() => expect(mockedExportReceipts).toHaveBeenCalledWith("csv"));
    expect(mockedExportFilename).toHaveBeenCalledWith("csv", expect.any(Date));
    expect(mockedSaveBlob).toHaveBeenCalledWith(blob, "receipts-2026-08-20.csv");
  });

  it("downloads JSON exports from history", async () => {
    const user = userEvent.setup();
    const blob = new Blob(["json"]);
    mockedExportReceipts.mockResolvedValue(blob);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Download JSON" }));

    await waitFor(() => expect(mockedExportReceipts).toHaveBeenCalledWith("json"));
    expect(mockedExportFilename).toHaveBeenCalledWith("json", expect.any(Date));
    expect(mockedSaveBlob).toHaveBeenCalledWith(blob, "receipts-2026-08-20.json");
  });

  it("keeps export labels stable and the other export available while busy", async () => {
    let resolveExport: ((value: Blob) => void) | undefined;
    mockedExportReceipts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Download CSV" }));

    const csv = screen.getByRole("button", { name: "Download CSV" });
    expect(csv).toHaveAttribute("aria-disabled", "true");
    expect(csv).not.toBeDisabled();
    expect(csv).toHaveTextContent("Download CSV");
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing export");

    resolveExport?.(new Blob(["csv"]));
  });

  it("uses Croatian singular receipt count", async () => {
    await i18n.changeLanguage("hr");
    renderPage();

    expect(await screen.findByText("1 račun")).toBeInTheDocument();
  });

  it("renders an export failure without disabling the other format", async () => {
    const user = userEvent.setup();
    mockedExportReceipts.mockRejectedValueOnce(new Error("export failed"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Download CSV" }));

    expect(
      await screen.findByText("The export could not be created. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeEnabled();
  });

  it("keeps rendering when a receipt has a malformed currency", async () => {
    mockedGetReceipts.mockResolvedValue(page([{ ...receipt, currency: "1EU" }]));
    renderPage();

    expect(await screen.findByText("Market Example")).toBeInTheDocument();
  });

  it("routes failed receipts to processing and confirmed receipts to review", async () => {
    mockedGetReceipts.mockResolvedValue(
      page([
        { ...receipt, sellerName: "Failed receipt", status: "failed" as const },
        { ...receipt, id: "00000000-0000-4000-8000-000000000003", sellerName: "Confirmed receipt" },
      ]),
    );
    renderPage();

    expect(await screen.findByRole("link", { name: /Failed receipt/ })).toHaveAttribute(
      "href",
      "/receipts/00000000-0000-4000-8000-000000000001/processing",
    );
    expect(screen.getByRole("link", { name: /Confirmed receipt/ })).toHaveAttribute(
      "href",
      "/receipts/00000000-0000-4000-8000-000000000003/review",
    );
  });
});

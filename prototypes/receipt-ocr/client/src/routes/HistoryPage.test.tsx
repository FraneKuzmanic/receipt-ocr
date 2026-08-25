import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { CanonicalReceipt } from "@receipt/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteReceipt, exportReceipt, exportReceipts, getReceipts } from "../api/client";
import { exportFilename, receiptExportFilename, saveBlob } from "../history/download";
import i18n from "../i18n";
import { HistoryPage } from "./HistoryPage";

vi.mock("../api/client", () => ({
  getReceipts: vi.fn(),
  deleteReceipt: vi.fn(),
  exportReceipts: vi.fn(),
  exportReceipt: vi.fn(),
}));
vi.mock("../history/download", () => ({
  exportFilename: vi.fn((format: string) => `receipts-2026-08-20.${format}`),
  receiptExportFilename: vi.fn((_receipt: unknown, format: string) => `receipt-381-1-2.${format}`),
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
const mockedExportReceipt = vi.mocked(exportReceipt);
const mockedExportFilename = vi.mocked(exportFilename);
const mockedReceiptExportFilename = vi.mocked(receiptExportFilename);
const mockedSaveBlob = vi.mocked(saveBlob);

function page(items = [receipt], total = items.length, pageNumber = 1, limit = 20) {
  return { items, page: pageNumber, limit, total };
}

/**
 * jsdom has no matchMedia at all, so the page falls back to the card list. A viewport-width test
 * has to say which layout it means.
 */
function stubViewport(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: wide, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
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

/** Every per-receipt action lives behind that receipt's overflow menu, at both widths. */
async function openReceiptMenu(
  user: ReturnType<typeof userEvent.setup>,
  seller = "Market Example",
) {
  await user.click(await screen.findByRole("button", { name: `Actions for ${seller}` }));
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  mockedGetReceipts.mockResolvedValue(page());
  mockedDeleteReceipt.mockResolvedValue();
  mockedExportReceipts.mockResolvedValue(new Blob(["export"]));
  mockedExportReceipt.mockResolvedValue(new Blob(["export"]));
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("renders a table at desktop width and a card list below it", async () => {
    stubViewport(true);
    renderPage();

    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Issue date", "Seller", "Number", "Total", "Status", "Actions"]);
    const row = within(table).getAllByRole("row")[1];
    expect(within(row!).getByRole("link", { name: "Market Example" })).toHaveAttribute(
      "href",
      "/receipts/00000000-0000-4000-8000-000000000001/review",
    );

    // The two layouts are mutually exclusive: rendering both would duplicate every row and every
    // action menu in the accessibility tree.
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
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

  it("confirms a delete in a dialog before deleting, then reloads", async () => {
    const user = userEvent.setup();
    renderPage();

    await openReceiptMenu(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(mockedDeleteReceipt).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/will disappear from your list/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete this receipt" }));

    await waitFor(() => expect(mockedDeleteReceipt).toHaveBeenCalledWith(receipt.id));
    await waitFor(() => expect(mockedGetReceipts).toHaveBeenCalledTimes(2));
  });

  it("keeps the receipt when the delete dialog is dismissed", async () => {
    const user = userEvent.setup();
    renderPage();

    await openReceiptMenu(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep it" }));

    expect(mockedDeleteReceipt).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("downloads one confirmed receipt as CSV", async () => {
    const user = userEvent.setup();
    const blob = new Blob(["csv"]);
    mockedExportReceipt.mockResolvedValue(blob);
    renderPage();

    await openReceiptMenu(user);
    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    await waitFor(() => expect(mockedExportReceipt).toHaveBeenCalledWith(receipt.id, "csv"));
    expect(mockedReceiptExportFilename).toHaveBeenCalledWith(receipt, "csv");
    expect(mockedSaveBlob).toHaveBeenCalledWith(blob, "receipt-381-1-2.csv");
  });

  it("downloads one confirmed receipt as JSON", async () => {
    const user = userEvent.setup();
    renderPage();

    await openReceiptMenu(user);
    await user.click(screen.getByRole("button", { name: "Download JSON" }));

    await waitFor(() => expect(mockedExportReceipt).toHaveBeenCalledWith(receipt.id, "json"));
  });

  it("offers no download for a receipt that is not confirmed", async () => {
    const user = userEvent.setup();
    mockedGetReceipts.mockResolvedValue(page([{ ...receipt, status: "review" as const }]));
    renderPage();

    await openReceiptMenu(user);
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download CSV" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download JSON" })).not.toBeInTheDocument();
  });

  it("downloads every confirmed receipt from the toolbar export menu", async () => {
    const user = userEvent.setup();
    const blob = new Blob(["csv"]);
    mockedExportReceipts.mockResolvedValue(blob);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("button", { name: "All confirmed as CSV" }));

    await waitFor(() => expect(mockedExportReceipts).toHaveBeenCalledWith("csv"));
    expect(mockedExportFilename).toHaveBeenCalledWith("csv", expect.any(Date));
    expect(mockedSaveBlob).toHaveBeenCalledWith(blob, "receipts-2026-08-20.csv");
  });

  it("announces a running export and keeps the export trigger operable", async () => {
    let resolveExport: ((value: Blob) => void) | undefined;
    mockedExportReceipts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("button", { name: "All confirmed as JSON" }));

    const trigger = screen.getByRole("button", { name: "Export" });
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveTextContent("Export");
    expect(screen.getByRole("status")).toHaveTextContent("Preparing export");

    resolveExport?.(new Blob(["json"]));
  });

  it("uses Croatian singular receipt count", async () => {
    await i18n.changeLanguage("hr");
    renderPage();

    expect(await screen.findByText("1 račun")).toBeInTheDocument();
  });

  it("reports an export failure without blocking the next attempt", async () => {
    const user = userEvent.setup();
    mockedExportReceipts.mockRejectedValueOnce(new Error("export failed"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("button", { name: "All confirmed as CSV" }));

    expect(
      await screen.findByText("The export could not be created. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("reports a single-receipt download failure", async () => {
    const user = userEvent.setup();
    mockedExportReceipt.mockRejectedValueOnce(new Error("download failed"));
    renderPage();

    await openReceiptMenu(user);
    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(
      await screen.findByText("The export could not be created. Try again."),
    ).toBeInTheDocument();
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

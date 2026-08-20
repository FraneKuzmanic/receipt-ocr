import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmReceipt, getReceipt, getReceiptSource, updateReceipt } from "../api/client";
import "../i18n";
import { ReviewPage } from "./ReviewPage";

vi.mock("../api/client", () => ({
  getReceipt: vi.fn(),
  getReceiptSource: vi.fn(),
  updateReceipt: vi.fn(),
  confirmReceipt: vi.fn(),
}));

const receipt = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  status: "review" as const,
  sellerName: "Integration seller",
  documentNumber: "381/1/2",
  total: "8.08",
  currency: "EUR",
  warnings: [{ code: "missing_critical_field" as const, field: "sellerName" }],
  lowConfidenceFields: ["documentNumber"],
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

const mockedGetReceipt = vi.mocked(getReceipt);
const mockedGetReceiptSource = vi.mocked(getReceiptSource);
const mockedUpdateReceipt = vi.mocked(updateReceipt);
const mockedConfirmReceipt = vi.mocked(confirmReceipt);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/receipts/${receipt.id}/review`]}>
      <Routes>
        <Route path="/receipts/:id/review" element={<ReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetReceipt.mockResolvedValue(receipt);
  mockedGetReceiptSource.mockResolvedValue({
    url: "https://example.test/source.jpg",
    contentType: "image/jpeg",
    originalFilename: "receipt.jpg",
    expiresAt: "2026-08-19T10:05:00.000Z",
  });
  mockedUpdateReceipt.mockResolvedValue({ ...receipt, documentNumber: "381/1/3", warnings: [] });
  mockedConfirmReceipt.mockResolvedValue({
    id: receipt.id,
    status: "confirmed",
    confirmedAt: "2026-08-19T10:02:00.000Z",
  });
});

describe("ReviewPage", () => {
  it("pre-populates fields and renders field warnings with low-confidence guidance", async () => {
    renderPage();

    expect(await screen.findByDisplayValue("381/1/2")).toBeInTheDocument();
    expect(
      screen.getByText("This field is empty. Check the receipt and fill it in."),
    ).toBeInTheDocument();
    expect(screen.getByText("This value may need extra checking.")).toBeInTheDocument();
  });

  it("saves a corrected document number and removes stale warnings", async () => {
    const user = userEvent.setup();
    renderPage();

    const number = await screen.findByDisplayValue("381/1/2");
    await user.clear(number);
    await user.type(number, "381/1/3");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedUpdateReceipt).toHaveBeenCalledWith(
        receipt.id,
        expect.objectContaining({ documentNumber: "381/1/3" }),
      );
    });
    expect(
      screen.queryByText("This field is empty. Check the receipt and fill it in."),
    ).not.toBeInTheDocument();
  });

  // Three codes were computed, persisted and returned by the API but rendered nowhere, because the
  // form only looked up the field paths it happened to remember: `vat_arithmetic_mismatch` is
  // emitted against the bare `vatBreakdown` path while the VAT fieldset only read indexed cells,
  // and `subtotal`/`issueTime` had no lookup at all. Driving every code through the real engine's
  // field paths is what keeps a future warning from going silently invisible.
  it("renders a message for every warning the engine can emit", async () => {
    mockedGetReceipt.mockResolvedValue({
      ...receipt,
      vatBreakdown: [{ rate: "25", taxableBase: "1.00", vatAmount: "0.25" }],
      warnings: [
        { code: "missing_critical_field", field: "sellerName" },
        { code: "unparseable_date", field: "issueDate" },
        { code: "unparseable_date", field: "issueTime" },
        { code: "unparseable_amount", field: "total" },
        { code: "unparseable_amount", field: "subtotal" },
        { code: "vat_arithmetic_mismatch", field: "vatBreakdown" },
        { code: "qr_total_mismatch", field: "total" },
        { code: "qr_datetime_mismatch", field: "issueDate" },
      ],
    });
    renderPage();

    expect(
      await screen.findByText("The VAT amounts do not add up to the total."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("This date could not be read. Check it against the receipt."),
    ).toHaveLength(2);
    expect(
      screen.getAllByText("This amount could not be read. Check it against the receipt."),
    ).toHaveLength(2);
    expect(
      screen.getByText("The total differs from the amount in the receipt's QR code."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The date or time differs from the receipt's QR code."),
    ).toBeInTheDocument();
  });

  it("allows confirmation while warnings remain", async () => {
    const user = userEvent.setup();
    renderPage();

    const confirm = await screen.findByRole("button", { name: "Confirm receipt" });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(mockedConfirmReceipt).toHaveBeenCalledWith(receipt.id));
    expect(screen.getByText("Receipt confirmed")).toBeInTheDocument();
  });
});

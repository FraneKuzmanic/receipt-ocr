import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmReceipt,
  getReceipt,
  getReceiptRegions,
  getReceiptSource,
  updateReceipt,
} from "../api/client";
import "../i18n";
import { ReviewPage } from "./ReviewPage";
import { ToastProvider } from "../components/Toast";

vi.mock("../api/client", () => ({
  getReceipt: vi.fn(),
  getReceiptRegions: vi.fn(),
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
  editedFields: [] as string[],
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

const mockedGetReceipt = vi.mocked(getReceipt);
const mockedGetReceiptRegions = vi.mocked(getReceiptRegions);
const mockedGetReceiptSource = vi.mocked(getReceiptSource);
const mockedUpdateReceipt = vi.mocked(updateReceipt);
const mockedConfirmReceipt = vi.mocked(confirmReceipt);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/receipts/${receipt.id}/review`]}>
      <Routes>
        <Route
          path="/receipts/:id/review"
          element={
            <ToastProvider>
              <ReviewPage />
            </ToastProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetReceipt.mockResolvedValue(receipt);
  mockedGetReceiptRegions.mockResolvedValue({ pages: [], regions: [] });
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
    expect(screen.getByRole("status")).toHaveTextContent("Changes saved");
  });

  // Codes were once computed, persisted and returned by the API but rendered nowhere, because the
  // form only looked up the field paths it happened to remember: a warning on the bare
  // `vatBreakdown` path was invisible while the VAT fieldset only read indexed cells, and
  // `issueTime` had no lookup at all. Driving every code through the real engine's field paths is
  // what keeps a future warning from going silently invisible.
  it("renders a message for every warning the engine can emit", async () => {
    mockedGetReceipt.mockResolvedValue({
      ...receipt,
      vatBreakdown: [{ rate: "25", taxableBase: "1.00", vatAmount: "0.25" }],
      warnings: [
        { code: "missing_critical_field", field: "sellerName" },
        { code: "unparseable_date", field: "issueDate" },
        { code: "unparseable_date", field: "issueTime" },
        { code: "unparseable_amount", field: "total" },
        { code: "vat_arithmetic_mismatch", field: "vatBreakdown.0.vatAmount" },
        { code: "vat_present_but_unread", field: "vatBreakdown" },
        { code: "oib_checksum_invalid", field: "sellerOib" },
        { code: "qr_jir_mismatch", field: "jir" },
        { code: "qr_total_mismatch", field: "total" },
        { code: "qr_datetime_mismatch", field: "issueDate" },
      ],
    });
    renderPage();

    expect(
      await screen.findByText("This VAT amount does not match its base and rate."),
    ).toBeInTheDocument();
    // The per-row warning sits on its own cell, which is what makes that cell amber.
    expect(screen.getByDisplayValue("0.25")).toHaveAttribute(
      "aria-describedby",
      "review-hint-vatBreakdown-0-vatAmount",
    );
    expect(
      screen.getByText(
        "This receipt shows VAT information we could not read. Check the VAT section against the receipt.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This OIB fails its check digit. Compare it with the receipt."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This date could not be read. Check it against the receipt. The date or time differs from the receipt's QR code.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This amount could not be read. Check it against the receipt. The total differs from the amount in the receipt's QR code.",
      ),
    ).toBeInTheDocument();
  });

  it("hides the buyer block when no buyer was extracted, behind an Add buyer control", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("381/1/2");
    expect(screen.queryByLabelText("Buyer name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Buyer OIB")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add buyer" }));

    expect(screen.getByLabelText("Buyer name")).toBeInTheDocument();
    expect(screen.getByLabelText("Buyer address")).toBeInTheDocument();
    expect(screen.getByLabelText("Buyer OIB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add buyer" })).not.toBeInTheDocument();
  });

  it("shows the buyer block at once when any buyer value was extracted", async () => {
    mockedGetReceipt.mockResolvedValue({ ...receipt, buyerName: "John Smith" });
    renderPage();

    expect(await screen.findByDisplayValue("John Smith")).toBeInTheDocument();
    expect(screen.getByLabelText("Buyer OIB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add buyer" })).not.toBeInTheDocument();
  });

  it("has no subtotal field", async () => {
    renderPage();

    await screen.findByDisplayValue("381/1/2");
    expect(screen.queryByLabelText("Subtotal")).not.toBeInTheDocument();
  });

  it("shows the payment method as editable text and saves a changed one", async () => {
    mockedGetReceipt.mockResolvedValue({ ...receipt, paymentMethod: "Gotovina" });
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("Payment method");
    expect(input).toHaveValue("Gotovina");

    await user.clear(input);
    await user.type(input, "kartica-MasterCard");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedUpdateReceipt).toHaveBeenCalledWith(
        receipt.id,
        expect.objectContaining({ paymentMethod: "kartica-MasterCard" }),
      );
    });
  });

  it("allows confirmation while warnings remain", async () => {
    const user = userEvent.setup();
    renderPage();

    const confirm = await screen.findByRole("button", { name: "Confirm receipt" });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(mockedConfirmReceipt).toHaveBeenCalledWith(receipt.id));
    expect(screen.getByText("Receipt confirmed", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Receipt confirmed");
  });

  // Amber is one signal with one meaning. It is painted for a low-confidence reading *and* for a
  // warning such as an empty critical field, because marking only the former left warned fields
  // wearing an amber explanation under a plain slate input.
  it("marks every field needing attention identically, without marking any invalid", async () => {
    mockedGetReceipt.mockResolvedValue({
      ...receipt,
      buyerName: "Buyer",
      lowConfidenceFields: ["documentNumber", "buyerName", "total"],
    });
    const { container } = renderPage();

    await screen.findByDisplayValue("381/1/2");
    // Three low-confidence readings plus the warned, empty `sellerName`.
    const amberFields = container.querySelectorAll("input.border-amber-500");
    expect(amberFields).toHaveLength(4);
    for (const field of amberFields) {
      expect(field).toHaveAttribute("aria-describedby");
      expect(field).not.toHaveAttribute("aria-invalid");
    }
    // The warned field explains itself with its own warning, never the generic hint as well.
    expect(screen.getAllByText("This value may need extra checking.")).toHaveLength(3);
    expect(
      screen.getByText("This field is empty. Check the receipt and fill it in."),
    ).toBeInTheDocument();
  });

  it("redirects a failed receipt to the processing route", async () => {
    mockedGetReceipt.mockResolvedValue({ ...receipt, status: "failed" });
    render(
      <MemoryRouter initialEntries={[`/receipts/${receipt.id}/review`]}>
        <Routes>
          <Route path="/receipts/:id/review" element={<ReviewPage />} />
          <Route path="/receipts/:id/processing" element={<Location />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("location")).toHaveTextContent(
      `/receipts/${receipt.id}/processing`,
    );
  });
});

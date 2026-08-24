import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createReceipt } from "../api/client";
import { analyzeReceiptImage } from "../capture/receiptFile";
import "../i18n";
import { HomePage } from "./HomePage";

vi.mock("../api/client", () => ({
  ApiError: class MockApiError extends Error {
    status: number;
    code?: string;

    constructor(status: number, code?: string) {
      super();
      this.status = status;
      this.code = code;
    }
  },
  createReceipt: vi.fn(),
}));

vi.mock("../capture/receiptFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../capture/receiptFile")>()),
  analyzeReceiptImage: vi.fn(),
}));

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/receipts/:id/processing" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
}

function imageFile(name = "receipt.jpg") {
  return new File(["receipt"], name, { type: "image/jpeg" });
}

/** jsdom implements no matchMedia, so the pointer type has to be supplied explicitly. */
function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: coarse, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

const mockedAnalyze = vi.mocked(analyzeReceiptImage);
const mockedCreate = vi.mocked(createReceipt);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
  mockedAnalyze.mockResolvedValue({ width: 1200, height: 800, blurVariance: 100, warnings: [] });
  mockedCreate.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    status: "processing",
    createdAt: "2026-08-18T10:00:00.000Z",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HomePage", () => {
  it("keeps a camera-first input and an independent file fallback", () => {
    renderPage();

    const inputs = screen.getAllByLabelText(/scan receipt|choose file/i);
    expect(inputs[0]).toHaveAttribute("capture", "environment");
    expect(inputs[0]).toHaveAttribute("accept", expect.stringContaining("image/jpeg"));
    expect(inputs[1]).toHaveAttribute("accept", expect.stringContaining("application/pdf"));
  });

  it("previews an image without uploading and keeps warnings advisory", async () => {
    mockedAnalyze.mockResolvedValueOnce({
      width: 700,
      height: 400,
      blurVariance: 10,
      warnings: ["low_resolution", "possible_blur"],
    });
    renderPage();
    const source = imageFile();

    fireEvent.change(screen.getByLabelText(/scan receipt/i), { target: { files: [source] } });

    expect(await screen.findByAltText("Selected receipt preview")).toBeInTheDocument();
    expect(screen.getByText(/small and may be hard to read/i)).toBeInTheDocument();
    expect(screen.getByText(/may be blurry/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use photo" })).toBeEnabled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("shows a document preview for PDFs", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/choose file/i), {
      target: { files: [new File(["pdf"], "receipt.pdf", { type: "application/pdf" })] },
    });

    expect(await screen.findByText("Selected document")).toBeInTheDocument();
    expect(mockedAnalyze).not.toHaveBeenCalled();
  });

  it("retakes without uploading the old selection and revokes its preview", async () => {
    const user = userEvent.setup();
    renderPage();
    fireEvent.change(screen.getByLabelText(/scan receipt/i), { target: { files: [imageFile()] } });
    await screen.findByRole("button", { name: "Use photo" });

    await user.click(screen.getByRole("button", { name: "Retake" }));

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(screen.getByLabelText("Scan receipt")).toBeInTheDocument();
  });

  it("uploads the selected file once and navigates after success", async () => {
    const user = userEvent.setup();
    renderPage();
    const source = imageFile();
    fireEvent.change(screen.getByLabelText(/scan receipt/i), { target: { files: [source] } });
    await screen.findByRole("button", { name: "Use photo" });

    await user.click(screen.getByRole("button", { name: "Use photo" }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith(source));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/receipts/00000000-0000-4000-8000-000000000001/processing",
    );
  });

  it("keeps the upload busy state on the button and blocks retake while it runs", async () => {
    let resolveUpload:
      ((value: { id: string; status: "processing"; createdAt: string }) => void) | undefined;
    mockedCreate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage();
    fireEvent.change(screen.getByLabelText(/scan receipt/i), { target: { files: [imageFile()] } });
    await user.click(await screen.findByRole("button", { name: "Use photo" }));

    const uploading = screen.getByRole("button", { name: "Loading…" });
    expect(uploading).toHaveAttribute("aria-disabled", "true");
    expect(uploading).not.toBeDisabled();
    // The panel is not replaced: the preview the user just approved stays on screen.
    expect(screen.getByAltText("Selected receipt preview")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retake" }));
    expect(screen.getByAltText("Selected receipt preview")).toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    resolveUpload?.({
      id: "00000000-0000-4000-8000-000000000001",
      status: "processing",
      createdAt: "2026-08-18T10:00:00.000Z",
    });
  });

  it("drops the camera action when the pointer is not touch-first", () => {
    stubPointer(false);
    renderPage();

    expect(screen.queryByLabelText("Scan receipt")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Choose file")).toHaveAttribute(
      "accept",
      expect.stringContaining("application/pdf"),
    );
  });

  it("keeps both actions on a touch-first pointer", () => {
    stubPointer(true);
    renderPage();

    expect(screen.getByLabelText("Scan receipt")).toHaveAttribute("capture", "environment");
    expect(screen.getByLabelText("Choose file")).toBeInTheDocument();
  });

  it("keeps the preview and translates server or generic upload errors", async () => {
    mockedCreate.mockRejectedValueOnce(new ApiError(415, "unsupported_media_type"));
    const user = userEvent.setup();
    renderPage();
    fireEvent.change(screen.getByLabelText(/scan receipt/i), { target: { files: [imageFile()] } });
    await screen.findByRole("button", { name: "Use photo" });

    await user.click(screen.getByRole("button", { name: "Use photo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This file type is not supported");
    expect(screen.getByAltText("Selected receipt preview")).toBeInTheDocument();
  });
});

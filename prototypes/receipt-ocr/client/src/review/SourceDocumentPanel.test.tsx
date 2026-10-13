import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRegionsResponse } from "@receipt/shared";
import { getReceiptSource } from "../api/client";
import "../i18n";
import { SourceDocumentPanel } from "./SourceDocumentPanel";

vi.mock("../api/client", () => ({ getReceiptSource: vi.fn() }));

const regions: SourceRegionsResponse = {
  pages: [{ page: 1, aspectRatio: 0.5 }],
  regions: [
    {
      fields: ["total", "currency"],
      page: 1,
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.1 },
        { x: 0.3, y: 0.2 },
        { x: 0.1, y: 0.2 },
      ],
      origin: "model",
    },
  ],
};

function panel(next: SourceRegionsResponse | null) {
  return (
    <SourceDocumentPanel
      receiptId="receipt-1"
      regions={next}
      activeField={null}
      interaction="focus"
      fieldValues={{}}
      lowConfidenceFields={[]}
      editedFields={[]}
      onSelect={vi.fn()}
    />
  );
}

async function loadedImage(naturalWidth: number, naturalHeight: number) {
  const image = await screen.findByRole("img");
  Object.defineProperty(image, "naturalWidth", { value: naturalWidth });
  Object.defineProperty(image, "naturalHeight", { value: naturalHeight });
  fireEvent.load(image);
}

describe("SourceDocumentPanel", () => {
  beforeEach(() => {
    vi.mocked(getReceiptSource).mockResolvedValue({
      url: "https://example.test/source",
      contentType: "image/jpeg",
      originalFilename: "receipt.jpg",
      expiresAt: "2026-10-13T12:00:00.000Z",
    });
  });

  it("draws the outlines when the image loads before the regions arrive", async () => {
    // The two requests race. A small image can finish loading while the regions are still on the
    // way, and the outlines must appear once they land rather than stay hidden until a reload.
    const { container, rerender } = render(panel(null));
    await loadedImage(500, 1000);
    expect(container.querySelector("polygon")).toBeNull();

    rerender(panel(regions));
    expect(container.querySelector("polygon")).not.toBeNull();
  });

  it("draws the outlines when the regions arrive before the image loads", async () => {
    const { container } = render(panel(regions));
    await loadedImage(500, 1000);
    expect(container.querySelector("polygon")).not.toBeNull();
  });

  it("suppresses the outlines when the image's ratio disagrees with the extracted page", async () => {
    const { container } = render(panel(regions));
    await loadedImage(1000, 500);
    expect(container.querySelector("polygon")).toBeNull();
  });
});

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../i18n";
import { ActiveRegionStrip, cropTransform } from "./ActiveRegionStrip";

const regions = {
  pages: [{ page: 1, aspectRatio: 0.7 }],
  regions: [
    {
      fields: ["total"],
      page: 1,
      corners: [
        { x: 0.4, y: 0.4 },
        { x: 0.6, y: 0.4 },
        { x: 0.6, y: 0.5 },
        { x: 0.4, y: 0.5 },
      ],
      origin: "model" as const,
    },
  ],
};

describe("ActiveRegionStrip", () => {
  it("renders only when a source and matching active field are available", () => {
    const { container, rerender } = render(
      <ActiveRegionStrip
        sourceUrl={null}
        contentType="image/jpeg"
        regions={regions}
        activeField="total"
        overlaySafe={true}
        onSelect={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <ActiveRegionStrip
        sourceUrl="https://example.test/source.jpg"
        contentType="image/jpeg"
        regions={regions}
        activeField="total"
        overlaySafe={true}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector("aside")).toHaveAttribute("aria-hidden", "true");
  });

  it("centres the active region's centroid in the strip viewport, not the full image", () => {
    const viewport = { width: 359, height: 236 };
    const transform = cropTransform(regions.regions[0]!, 0.376, viewport);
    expect(transform.scale).toBeGreaterThan(1);

    // Reproduce the browser's own `transform: scale(s) translate(tx, ty)` composition
    // (renders a point p at s * (p + t)) and confirm the region's centroid lands exactly at
    // the viewport's centre — the failure this guards is a translate that centres the whole
    // wrapper image instead, which for a tall receipt renders far outside the visible strip.
    const wrapperWidth = viewport.width;
    const wrapperHeight = wrapperWidth / 0.376;
    const renderedX = transform.scale * (0.5 * wrapperWidth + transform.translateXPx);
    const renderedY = transform.scale * (0.45 * wrapperHeight + transform.translateYPx);
    expect(renderedX).toBeCloseTo(viewport.width / 2, 5);
    expect(renderedY).toBeCloseTo(viewport.height / 2, 5);
  });
});

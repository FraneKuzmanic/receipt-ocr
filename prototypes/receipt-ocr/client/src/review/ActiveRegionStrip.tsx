import { useCallback, useState } from "react";
import type { SourceRegion, SourceRegionsResponse } from "@receipt/shared";
import { useTranslation } from "react-i18next";
import { SourceOverlay } from "./SourceOverlay";
import { SECTION_COLOURS, sectionOf } from "./regionSections";

interface ActiveRegionStripProps {
  sourceUrl: string | null;
  contentType: string | null;
  regions: SourceRegionsResponse | null;
  activeField: string | null;
  overlaySafe: boolean;
  onSelect: (field: string) => void;
}

const FIELD_LABELS = {
  sellerName: "review.fields.sellerName",
  sellerAddress: "review.fields.sellerAddress",
  sellerOib: "review.fields.sellerOib",
  buyerName: "review.fields.buyerName",
  buyerAddress: "review.fields.buyerAddress",
  buyerOib: "review.fields.buyerOib",
  documentNumber: "review.fields.documentNumber",
  issueDate: "review.fields.issueDate",
  issueTime: "review.fields.issueTime",
  subtotal: "review.fields.subtotal",
  total: "review.fields.total",
  currency: "review.fields.currency",
  paymentMethod: "review.fields.paymentMethod",
  jir: "review.fields.jir",
  zki: "review.fields.zki",
  rate: "review.fields.rate",
  taxableBase: "review.fields.taxableBase",
  vatAmount: "review.fields.vatAmount",
  description: "review.fields.description",
  quantity: "review.fields.quantity",
  unitPrice: "review.fields.unitPrice",
} as const;

export function ActiveRegionStrip({
  sourceUrl,
  contentType,
  regions,
  activeField,
  overlaySafe,
  onSelect,
}: ActiveRegionStripProps) {
  const { t } = useTranslation();
  const region = activeRegion(regions?.regions ?? [], activeField);
  const page = regions?.pages.find((candidate) => candidate.page === region?.page);

  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  // Measured, not assumed: the strip's viewport height (28dvh) is unrelated to the receipt
  // image's own rendered height (width / page aspect ratio, often several times taller for a
  // portrait phone photo), so centering the active region needs the strip's real pixel size.
  // Percentage-based translate() cannot express this — its percentages always resolve against
  // the transformed element's OWN box, which is the full image, not the clipping viewport.
  //
  // A callback ref, not `useRef` + `useLayoutEffect` keyed on the active region: the strip's DOM
  // node mounts on a *different* render than the one that first computes a region (it appears
  // once `sourceUrl` finishes loading), so an effect keyed on the region alone would miss that
  // mount and leave the strip permanently blank. A callback ref fires exactly when the node
  // attaches or detaches, with no dependency array to get wrong.
  const viewportRef = useCallback((element: HTMLDivElement | null) => {
    setViewport(
      element === null ? null : { width: element.clientWidth, height: element.clientHeight },
    );
  }, []);

  if (
    sourceUrl === null ||
    contentType === "application/pdf" ||
    !overlaySafe ||
    region === null ||
    page === undefined
  )
    return null;

  // Gating the strip's own render on `viewport !== null` would be circular: the ref that measures
  // it only attaches once the element renders. Render unconditionally and fall back to a zero-size
  // viewport for the one commit before the callback ref fires and supplies the real measurement.
  const { scale, translateXPx, translateYPx } = cropTransform(
    region,
    page.aspectRatio,
    viewport ?? { width: 0, height: 0 },
  );
  const section = sectionOf(activeField ?? "");
  const label = activeField?.split(".").at(-1) as keyof typeof FIELD_LABELS | undefined;

  return (
    <aside
      aria-hidden="true"
      className="fixed inset-x-0 top-14 z-20 border-b border-slate-200 bg-white p-2 shadow-sm lg:hidden"
    >
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: section === null ? "#64748b" : SECTION_COLOURS[section] }}
        />
        {label === undefined ? t("review.sourceTitle") : t(FIELD_LABELS[label])}
      </p>
      <div
        ref={viewportRef}
        className="relative h-[28dvh] overflow-hidden rounded border border-slate-200 bg-slate-100"
      >
        <div
          className="absolute left-0 top-0 w-full transition-transform motion-reduce:transition-none"
          style={{
            aspectRatio: String(page.aspectRatio),
            transformOrigin: "0 0",
            transform: `scale(${scale}) translate(${translateXPx}px, ${translateYPx}px)`,
          }}
        >
          <img src={sourceUrl} alt="" className="block size-full" />
          <SourceOverlay
            regions={regions!.regions}
            page={region.page}
            activeField={activeField}
            onSelect={onSelect}
          />
        </div>
      </div>
    </aside>
  );
}

function activeRegion(regions: readonly SourceRegion[], activeField: string | null) {
  return activeField === null
    ? null
    : (regions.find((region) => region.fields.includes(activeField)) ?? null);
}

export function cropTransform(
  region: SourceRegion,
  aspectRatio: number,
  viewport: { width: number; height: number },
) {
  const centerX = region.corners.reduce((sum, corner) => sum + corner.x, 0) / region.corners.length;
  const centerY = region.corners.reduce((sum, corner) => sum + corner.y, 0) / region.corners.length;
  const width =
    Math.max(...region.corners.map((corner) => corner.x)) -
    Math.min(...region.corners.map((corner) => corner.x));
  const scale = Math.min(5, Math.max(1.5, 0.55 / Math.max(width, 0.01)));

  // The wrapper's own unscaled size in px: its width equals the viewport's (both are `w-full`
  // of the same untransformed ancestor), and its height follows from the page's aspect ratio —
  // matching what the CSS `aspect-ratio` property computes for the element's layout box.
  const wrapperWidthPx = viewport.width;
  const wrapperHeightPx = wrapperWidthPx / aspectRatio;

  // CSS `transform: scale(s) translate(tx, ty)` composes as scale ∘ translate, so a point p in
  // the wrapper's own px space renders at `s * (p + t)`. Solving for t so the region's centroid
  // lands at the centre of the viewport (not the centre of the full image) gives these two lines.
  return {
    scale,
    translateXPx: viewport.width / (2 * scale) - centerX * wrapperWidthPx,
    translateYPx: viewport.height / (2 * scale) - centerY * wrapperHeightPx,
  };
}

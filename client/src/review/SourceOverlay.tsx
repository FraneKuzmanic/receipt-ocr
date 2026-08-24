import type { SourceRegion } from "@receipt/shared";
import { SECTION_COLOURS, sectionOf } from "./regionSections";

interface SourceOverlayProps {
  regions: readonly SourceRegion[];
  page: number;
  activeField: string | null;
  onSelect: (field: string) => void;
}

const NEUTRAL_COLOUR = "#64748b";

export function SourceOverlay({ regions, page, activeField, onSelect }: SourceOverlayProps) {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 size-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
    >
      {regions
        .filter((region) => region.page === page)
        .map((region, index) => {
          const active = activeField !== null && region.fields.includes(activeField);
          const section = sectionOf(region.fields[0] ?? "");
          const colour = section === null ? NEUTRAL_COLOUR : SECTION_COLOURS[section];
          return (
            <polygon
              key={`${region.page}-${region.fields.join("-")}-${index}`}
              points={region.corners.map(({ x, y }) => `${x},${y}`).join(" ")}
              fill={colour}
              fillOpacity={active ? 0.15 : 0}
              stroke={colour}
              strokeWidth={active ? 2.5 : 1.25}
              strokeOpacity={active ? 1 : 0.55}
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer"
              style={{ pointerEvents: "all" }}
              onClick={() => onSelect(region.fields[0]!)}
            />
          );
        })}
    </svg>
  );
}

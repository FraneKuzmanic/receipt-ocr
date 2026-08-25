import { stripContentMarkers } from "./content-markers.js";

const VAT_EXEMPTION =
  /nije\s+u\s+sustavu\s+pdv|pdv\s+nije\s+obračunat|oslobođen\w*\s+pdv|(?:čl|clan|član|clanka|članka)\.?\s*90/iu;
const STRUCTURAL_MARKERS = ["osnovica", "stopa", "iznos", "porez"] as const;

export function hasUnreadVatSignal(content: string): boolean {
  const text = stripContentMarkers(content).text;
  if (VAT_EXEMPTION.test(text)) return false;
  return (
    STRUCTURAL_MARKERS.filter((marker) => text.toLocaleLowerCase().includes(marker)).length >= 2
  );
}

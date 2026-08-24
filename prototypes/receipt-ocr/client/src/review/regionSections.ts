export type Section = "seller" | "buyer" | "receipt" | "vat" | "items";

export const SECTION_COLOURS: Record<Section, string> = {
  seller: "#7c3aed",
  buyer: "#0f766e",
  receipt: "#1d4ed8",
  vat: "#a21caf",
  items: "#15803d",
};

export function sectionOf(fieldPath: string): Section | null {
  if (fieldPath.startsWith("vatBreakdown.")) return "vat";
  if (fieldPath.startsWith("items.")) return "items";
  if (["sellerName", "sellerAddress", "sellerOib"].includes(fieldPath)) return "seller";
  if (["buyerName", "buyerAddress", "buyerOib"].includes(fieldPath)) return "buyer";
  if (
    [
      "documentNumber",
      "issueDate",
      "issueTime",
      "subtotal",
      "total",
      "currency",
      "paymentMethod",
      "jir",
      "zki",
    ].includes(fieldPath)
  )
    return "receipt";
  return null;
}

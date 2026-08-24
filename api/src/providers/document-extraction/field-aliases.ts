export const FIELD_ALIASES = {
  sellerName: ["VendorAddressRecipient", "VendorName", "MerchantName"],
  sellerAddress: ["VendorAddress", "MerchantAddress"],
  sellerOib: ["VendorTaxId"],
  buyerName: ["CustomerName"],
  buyerAddress: ["CustomerAddress"],
  buyerOib: ["CustomerTaxId"],
  documentNumber: ["InvoiceId"],
  paymentMethod: ["PaymentTerm"],
  subtotal: ["SubTotal", "Subtotal"],
  total: ["InvoiceTotal", "Total"],
  currency: ["InvoiceTotal", "Total"],
  issueDate: ["InvoiceDate", "TransactionDate"],
  issueTime: ["TransactionTime"],
  vatBreakdown: ["TaxDetails", "TotalTax"],
  items: ["Items"],
} as const;

export const VAT_CELL_ALIASES = {
  rate: ["TaxRate", "Rate"],
  taxableBase: ["NetAmount", "TaxableAmount", "TaxableBase"],
  vatAmount: ["Amount", "TaxAmount"],
} as const;

export const ITEM_CELL_ALIASES = {
  description: ["Description"],
  quantity: ["Quantity"],
  unitPrice: ["UnitPrice", "Price"],
  total: ["Amount", "TotalPrice"],
} as const;

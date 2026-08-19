import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
} from "@azure-rest/ai-document-intelligence";

const [directory] = process.argv.slice(2);
if (!directory) throw new Error("Usage: compare-azure-models.mjs <source-directory>");

const endpoint = requiredEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
const key = requiredEnv("AZURE_DOCUMENT_INTELLIGENCE_KEY");
const locale = process.env.AZURE_DI_LOCALE || "hr-HR";
const client = DocumentIntelligence(endpoint, { key }, { apiVersion: "2024-11-30" });
const sources = (await readdir(directory)).filter((name) =>
  new Set([".jpg", ".jpeg", ".png", ".pdf"]).has(extname(name).toLowerCase()),
);

for (const modelId of ["prebuilt-invoice", "prebuilt-receipt"]) {
  const coverage = { seller: 0, documentNumber: 0, issueDate: 0, total: 0, currency: 0 };
  const latencies = [];
  for (const name of sources) {
    const started = Date.now();
    const initial = await client.path("/documentModels/{modelId}:analyze", modelId).post({
      contentType: "application/json",
      body: { base64Source: (await readFile(join(directory, name))).toString("base64") },
      queryParameters: { locale },
    });
    if (isUnexpected(initial))
      throw new Error(`Azure rejected ${name} with status ${initial.status}`);
    const response = await getLongRunningPoller(client, initial, {
      intervalInMs: 500,
    }).pollUntilDone();
    latencies.push(Date.now() - started);
    const fields = response.body.analyzeResult?.documents?.[0]?.fields || {};
    if (fields.VendorAddressRecipient || fields.VendorName || fields.MerchantName)
      coverage.seller += 1;
    if (fields.InvoiceId) coverage.documentNumber += 1;
    if (fields.InvoiceDate || fields.TransactionDate) coverage.issueDate += 1;
    const total = fields.InvoiceTotal || fields.Total;
    if (total) coverage.total += 1;
    if (total?.valueCurrency?.currencySymbol && total.valueCurrency.currencyCode)
      coverage.currency += 1;
  }
  latencies.sort((a, b) => a - b);
  console.log({
    modelId,
    samples: sources.length,
    coverage,
    medianLatencyMs: latencies[Math.floor(latencies.length / 2)],
  });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

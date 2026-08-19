import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
} from "@azure-rest/ai-document-intelligence";

const [directory, outputDirectory] = process.argv.slice(2);
if (!directory)
  throw new Error("Usage: record-azure-fixture.mjs <source-directory> [output-directory]");

const endpoint = requiredEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
const key = requiredEnv("AZURE_DOCUMENT_INTELLIGENCE_KEY");
const modelId = process.env.AZURE_DI_MODEL_ID || "prebuilt-invoice";
const locale = process.env.AZURE_DI_LOCALE || "hr-HR";
const destination = outputDirectory || "api/src/providers/document-extraction/fixtures";
const client = DocumentIntelligence(endpoint, { key }, { apiVersion: "2024-11-30" });

for (const name of await readdir(directory)) {
  const extension = extname(name).toLowerCase();
  if (!new Set([".jpg", ".jpeg", ".png", ".pdf"]).has(extension)) continue;

  const bytes = await readFile(join(directory, name));
  const initial = await client.path("/documentModels/{modelId}:analyze", modelId).post({
    contentType: "application/json",
    body: { base64Source: bytes.toString("base64") },
    queryParameters: { locale, features: ["barcodes"] },
  });
  if (isUnexpected(initial))
    throw new Error(`Azure rejected ${name} with status ${initial.status}`);

  const completed = await getLongRunningPoller(client, initial, {
    intervalInMs: 500,
  }).pollUntilDone();
  const fixtureName = `${basename(name, extension)
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()}.json`;
  await writeFile(join(destination, fixtureName), `${JSON.stringify(completed.body, null, 2)}\n`);
  console.log(`recorded ${fixtureName}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * What the input-mode experiments share: the request to the completion model, and the ways a
 * document is turned into message parts. Used by run-input-modes.ts and run-boxes.ts.
 * Ported from payslip-ocr's harness so the two experiments send the same request.
 */
import { join } from "node:path";
// Not a declared dependency: pdfjs-dist installs it for rendering in Node.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ROOT, SAMPLES, requireEnv, sourceBytes, type Sample } from "./samples.ts";

export type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" } }
  | { type: "file"; file: { filename: string; file_data: string } };

export const imagePart = (bytes: Buffer, contentType: string): Part => ({
  type: "image_url",
  image_url: { url: `data:${contentType};base64,${bytes.toString("base64")}`, detail: "high" },
});

/** Each page of a PDF as a PNG. The service scales an image down as it needs. */
export async function renderPdfPages(bytes: Buffer, dpi: number): Promise<Buffer[]> {
  const pdfjs = join(ROOT, "node_modules", "pdfjs-dist");
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: join(pdfjs, "standard_fonts") + "/",
    cMapUrl: join(pdfjs, "cmaps") + "/",
    cMapPacked: true,
  }).promise;
  const pages: Buffer[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: dpi / 72 });
    // pdf.js types its canvas factory as a bare Object; in Node it is the @napi-rs/canvas one.
    const factory = doc.canvasFactory as {
      create(width: number, height: number): { canvas: { toBuffer(type: "image/png"): Buffer } };
    };
    const { canvas } = factory.create(viewport.width, viewport.height);
    await page.render({ canvas: canvas as never, viewport }).promise;
    pages.push(canvas.toBuffer("image/png"));
  }
  await doc.loadingTask.destroy();
  return pages;
}

/** The service fits an image inside this square before anything else, so wider is wasted. */
const MAX_BAND_WIDTH = 2048;

/**
 * One page as horizontal bands, each twice as wide as tall and overlapping its neighbour by a
 * tenth, top to bottom. A band keeps every row whole from edge to edge, and the service then
 * sees it larger than it sees the whole page. A band is never scaled up, so a page already
 * smaller than the service's working size gains nothing.
 */
export async function pageBands(page: Buffer): Promise<Buffer[]> {
  const image = await loadImage(page);
  const bandHeight = Math.round(image.width / 2);
  if (image.height <= bandHeight * 1.25) return [page];
  const count = Math.ceil((image.height - bandHeight) / (bandHeight * 0.9)) + 1;
  const scale = Math.min(1, MAX_BAND_WIDTH / image.width);
  const bands: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const top = Math.round((i * (image.height - bandHeight)) / (count - 1));
    const canvas = createCanvas(Math.round(image.width * scale), Math.round(bandHeight * scale));
    canvas
      .getContext("2d")
      .drawImage(image, 0, top, image.width, bandHeight, 0, 0, canvas.width, canvas.height);
    bands.push(canvas.toBuffer("image/png"));
  }
  return bands;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

/** One strict-JSON completion. */
export async function complete(
  system: string,
  content: string | Part[],
  schema: Record<string, unknown>,
): Promise<{ json: Record<string, unknown>; usage: Usage; latencyMs: number }> {
  const endpoint = requireEnv("AZURE_OPENAI_ENDPOINT").replace(/\/$/, "");
  const deployment = requireEnv("AZURE_OPENAI_DEPLOYMENT");
  const apiVersion = requireEnv("AZURE_OPENAI_API_VERSION");
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "api-key": requireEnv("AZURE_OPENAI_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        temperature: 0,
        max_tokens: 8000,
        response_format: {
          type: "json_schema",
          json_schema: { name: "HrReceipt", schema, strict: true },
        },
      }),
    });
    // A throttled request is not a result: wait as told and ask again, outside the timing.
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get("retry-after") ?? 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage: Usage;
    };
    return {
      json: JSON.parse(body.choices[0]!.message.content) as Record<string, unknown>,
      usage: body.usage,
      latencyMs: Date.now() - started,
    };
  }
}

export const ARMS = ["ocr", "images", "files", "crops"] as const;
export type Arm = (typeof ARMS)[number];

/** `files` is a different request from `images` only when the source is a PDF. */
export const armsFor = (s: Sample): Arm[] =>
  ARMS.filter((arm) => arm !== "files" || s.sourceKind === "pdf");

export interface InputModeRecord {
  sample: string;
  arm: Arm;
  rep: number;
  input: string;
  sourceKind: Sample["sourceKind"];
  latencyMs: number;
  /** Time spent before the model call: the layout call for `ocr`, rendering for the others. */
  extraMs: number;
  /** What the arm cost beyond the model call: the layout pages for `ocr`. */
  extraUsd: number;
  usage: Usage;
  fields: Record<string, unknown>;
}

/** The service scales an image's short side down to this, so only a larger image loses detail. */
const SERVICE_SHORT_SIDE = 768;

/** Which image sources the service shrinks before the model sees them. */
export async function shrunkByService(): Promise<Set<string>> {
  const shrunk = new Set<string>();
  for (const s of SAMPLES) {
    if (s.sourceKind !== "image") continue;
    const image = await loadImage(sourceBytes(s));
    if (Math.min(image.width, image.height) > SERVICE_SHORT_SIDE) shrunk.add(s.name);
  }
  return shrunk;
}

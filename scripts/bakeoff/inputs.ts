/**
 * The file the app would upload for a sample, which is what every Plan B arm is given.
 *
 * The browser re-encodes a large photo before upload (`client/src/capture/downscale.ts`); the
 * recorded fixtures were made from full-resolution files, and the two give different results.
 * This reproduces that rule in Node. The resampling is @napi-rs/canvas's, not a browser's, and
 * the engines read the two differently, so a file `browser-downscale.mjs` made in a real browser
 * is used when it is there. The Node rule is the fallback, and what decides which photos change.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// Not a declared dependency: pdfjs-dist installs it for rendering in Node.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { CACHE_DIR, sourceBytes, type Sample } from "./samples.ts";

// The four numbers of client/src/capture/downscale.ts.
const DOWNSCALE_MAX_PIXELS = 2_000_000;
const DOWNSCALE_MAX_BYTES = 1.5 * 1024 * 1024;
const DOWNSCALE_LONG_EDGE = 1_600;
const JPEG_QUALITY = 82;

export interface UploadInput {
  bytes: Buffer;
  contentType: Sample["contentType"];
  downscaled: boolean;
  /** Pixels of the image as sent; 0 for a PDF. */
  width: number;
  height: number;
}

/** The upload rule for one image: unchanged when small enough, otherwise a 1,600 px JPEG. */
export async function downscaleImage(
  bytes: Buffer,
  contentType: Sample["contentType"],
): Promise<UploadInput> {
  const image = await loadImage(bytes);
  if (image.width * image.height <= DOWNSCALE_MAX_PIXELS && bytes.length <= DOWNSCALE_MAX_BYTES) {
    return { bytes, contentType, downscaled: false, width: image.width, height: image.height };
  }
  const scale = Math.min(1, DOWNSCALE_LONG_EDGE / Math.max(image.width, image.height));
  const canvas = createCanvas(
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    bytes: canvas.toBuffer("image/jpeg", JPEG_QUALITY),
    contentType: "image/jpeg",
    downscaled: true,
    width: canvas.width,
    height: canvas.height,
  };
}

/** Written once and read back, so every arm and every run sends the same bytes. */
export async function uploadInput(sample: Sample): Promise<UploadInput> {
  const source = sourceBytes(sample);
  if (sample.sourceKind === "pdf") {
    return {
      bytes: source,
      contentType: sample.contentType,
      downscaled: false,
      width: 0,
      height: 0,
    };
  }
  const dir = join(CACHE_DIR, "plan-b", "inputs");
  const cached = join(dir, `${sample.name}.jpg`);
  if (existsSync(cached)) {
    const bytes = readFileSync(cached);
    const image = await loadImage(bytes);
    return {
      bytes,
      contentType: "image/jpeg",
      downscaled: true,
      width: image.width,
      height: image.height,
    };
  }
  const input = await downscaleImage(source, sample.contentType);
  if (input.downscaled) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(cached, input.bytes);
  }
  return input;
}

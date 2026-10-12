/**
 * Makes the files the app would upload, in a real browser: the page below applies the rule of
 * `client/src/capture/downscale.ts` to every receipt image and posts back each one it re-encodes.
 * They are written to .bakeoff/plan-b/inputs/, where `inputs.ts` looks before downscaling in Node.
 *
 * A browser resamples a large photo differently from @napi-rs/canvas (Chrome's `lira_trogir` is
 * 370 KB, Node's 414 KB), and the engines read the two differently, so the scored runs use these.
 *
 *   node scripts/bakeoff/browser-downscale.mjs
 *   chrome --headless=new --virtual-time-budget=60000 --dump-dom http://localhost:5180/
 *
 * The page's title becomes "done" and its body lists what it did. Stop the server afterwards.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sources = join(root, ".agents", "fixtures", "receipts");
const inputs = join(root, ".bakeoff", "plan-b", "inputs");
const PORT = 5180;

mkdirSync(inputs, { recursive: true });
// A name given on the command line limits the run to that file, leaving the others' inputs as they are.
const only = process.argv[2];
const files = readdirSync(sources).filter(
  (name) => /\.(png|jpe?g)$/i.test(name) && (!only || name === only),
);

// The body of downscaleReceiptImage, with its four constants.
const page = `<!doctype html><title>working</title><script>
const files = ${JSON.stringify(files)};
(async () => {
  const log = [];
  for (const name of files) {
    const blob = await (await fetch("/src/" + encodeURIComponent(name))).blob();
    const url = URL.createObjectURL(blob);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image decode failed: " + name));
      image.src = url;
    });
    URL.revokeObjectURL(url);
    if (image.naturalWidth * image.naturalHeight <= 2000000 && blob.size <= 1.5 * 1024 * 1024) {
      log.push(name + " unchanged");
      continue;
    }
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    await fetch("/out/" + encodeURIComponent(name), { method: "POST", body: jpeg });
    log.push(name + " " + canvas.width + "x" + canvas.height + " " + jpeg.size + " bytes");
  }
  document.body.textContent = log.join(" | ");
  document.title = "done";
})().catch((error) => {
  document.body.textContent = String(error);
  document.title = "failed";
});
</script>`;

createServer((request, response) => {
  const url = decodeURIComponent(request.url ?? "/");
  const name = url.slice(5);
  if (url === "/") {
    response.end(page);
  } else if (url.startsWith("/src/") && files.includes(name)) {
    response.end(readFileSync(join(sources, name)));
  } else if (url.startsWith("/out/") && files.includes(name)) {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      // Named for the sample, which is the source's name except for the one screenshot.
      const sample = name.replace(/\.[^.]+$/, "").replace(/^Screenshot_/, "screenshot-");
      writeFileSync(join(inputs, `${sample}.jpg`), Buffer.concat(chunks));
      response.end("ok");
    });
  } else {
    response.statusCode = 404;
    response.end();
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));

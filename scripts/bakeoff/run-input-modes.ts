/**
 * Input-mode experiment: does the model read a receipt better as OCR text or as the document?
 *
 * One model, one field schema, one set of rules, one request shape. Only the form the document
 * takes in the user message changes:
 *
 *   ocr     DI layout markdown as text, from a layout call made fresh for every run
 *   images  every page as an image; a PDF's pages are rendered first, so nothing but pixels
 *   files   a PDF as a file part, which the service reads as its text layer plus page pictures
 *   crops   every page as overlapping horizontal bands, so the service sees it larger
 *
 * For an image source `files` would be the same request as `images`, so it runs for PDFs only.
 *
 * The arms run interleaved, sample by sample, so one day's generation rate applies to them all,
 * and the arm that goes first rotates so none always follows the same neighbour.
 * Records go to .bakeoff/input-modes/<arm>-r<rep>/ and are scored with score.ts.
 * `--summary` prints tokens, latency and cost from what is recorded, without a call.
 */
import { SCHEMA, SYSTEM } from "./field-schema.ts";
import { analyzeLayout, type LayoutRecord } from "./layout.ts";
import {
  ARMS,
  armsFor,
  complete,
  imagePart,
  pageBands,
  renderPdfPages,
  shrunkByService,
  type Arm,
  type InputModeRecord,
  type Part,
} from "./model-input.ts";
import { SAMPLES, fmtMs, readCache, sourceBytes, writeCache, type Sample } from "./samples.ts";
import {
  PRICE,
  PRICE_NOTE,
  guardSpend,
  modelUsd,
  recordedSpend,
  requireConfirmation,
} from "./spend.ts";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const reps = Number(arg("reps") ?? 3);
const only = arg("only")?.split(",");
const cap = Number(arg("cap") ?? 4);
const force = process.argv.includes("--force");
const prefix = arg("tag") ? `${arg("tag")}-` : "";
const kind = (arm: Arm, rep: number): string => `input-modes/${prefix}${arm}-r${rep}`;
const layoutKind = (rep: number): string => `input-modes/${prefix}layout-r${rep}`;

/** PDF pages are rendered at this resolution; the service scales an image down as it needs. */
const RENDER_DPI = 150;
/** For `crops`: an A4 page 1,654 px across, so a band is not scaled up by the service. */
const CROPS_DPI = 200;
const CROPS_NOTE =
  "Dokument je poslan kao niz vodoravnih isječaka, odozgo prema dolje, stranicu po stranicu. " +
  "Susjedni isječci se malo preklapaju: redak koji se vidi u dva isječka je isti redak i navodi se jednom.";

interface Built {
  content: string | Part[];
  input: string;
  extraMs: number;
  extraUsd: number;
}

/** The user message for one arm, and what it was built from. */
async function userContent(arm: Arm, s: Sample, rep: number): Promise<Built> {
  const bytes = sourceBytes(s);
  if (arm === "ocr") {
    const layout = await analyzeLayout(bytes);
    writeCache(layoutKind(rep), s.name, layout);
    const result = layout.operation.analyzeResult;
    return {
      content: `<dokument>\n${result?.content ?? ""}\n</dokument>`,
      input: "layout-markdown",
      extraMs: layout.latencyMs,
      extraUsd: (result?.pages?.length ?? 1) * PRICE.layoutPage,
    };
  }
  const pdf = s.sourceKind === "pdf";
  if (arm === "crops") {
    const started = Date.now();
    const pages = pdf ? await renderPdfPages(bytes, CROPS_DPI) : [bytes];
    const bands = (await Promise.all(pages.map(pageBands))).flat();
    return {
      content: [{ type: "text", text: CROPS_NOTE }, ...bands.map((b) => imagePart(b, "image/png"))],
      input: `${bands.length}-bands`,
      extraMs: Date.now() - started,
      extraUsd: 0,
    };
  }
  if (!pdf) {
    return { content: [imagePart(bytes, s.contentType)], input: "image", extraMs: 0, extraUsd: 0 };
  }
  if (arm === "files") {
    const file_data = `data:application/pdf;base64,${bytes.toString("base64")}`;
    return {
      content: [{ type: "file", file: { filename: s.sourceFile, file_data } }],
      input: "pdf-file",
      extraMs: 0,
      extraUsd: 0,
    };
  }
  const started = Date.now();
  const pages = await renderPdfPages(bytes, RENDER_DPI);
  return {
    content: pages.map((p) => imagePart(p, "image/png")),
    input: "pdf-page-images",
    extraMs: Date.now() - started,
    extraUsd: 0,
  };
}

const samples = SAMPLES.filter((s) => !only || only.includes(s.name));

/** The `ocr` arm is recorded only when both its layout and its model call are. */
const isRecorded = (arm: Arm, rep: number, s: Sample): boolean =>
  readCache(kind(arm, rep), s.name) !== null &&
  (arm !== "ocr" || readCache<LayoutRecord>(layoutKind(rep), s.name) !== null);

const quantile = (xs: number[], q: number): number =>
  xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

async function summary(): Promise<void> {
  const shrunk = await shrunkByService();
  const groups: [string, (s: Sample) => boolean][] = [
    ["all", () => true],
    ["pdf", (s) => s.sourceKind === "pdf"],
    ["image", (s) => s.sourceKind === "image"],
    ["image >768", (s) => shrunk.has(s.name)],
    ["image <=768", (s) => s.sourceKind === "image" && !shrunk.has(s.name)],
  ];
  console.log(
    "\n  arm     sources        n   input tok (cached)   output tok   latency p50 / p90   $ billed   $ uncached",
  );
  console.log("  " + "-".repeat(101));
  for (const arm of ARMS) {
    for (const [name, inGroup] of groups) {
      const rs: InputModeRecord[] = [];
      for (let rep = 1; rep <= reps; rep++)
        for (const s of samples.filter(inGroup)) {
          const r = readCache<InputModeRecord>(kind(arm, rep), s.name);
          if (r) rs.push(r);
        }
      if (!rs.length) continue;
      const ms = rs.map((r) => r.latencyMs + r.extraMs);
      const cached = rs.map((r) => r.usage.prompt_tokens_details?.cached_tokens ?? 0);
      const median = (pick: (r: InputModeRecord) => number): string =>
        String(Math.round(quantile(rs.map(pick), 0.5)));
      console.log(
        `  ${arm.padEnd(7)} ${name.padEnd(12)} ${String(rs.length).padStart(3)}   ` +
          `${median((r) => r.usage.prompt_tokens).padStart(6)} (${String(Math.round(mean(cached))).padStart(5)})      ` +
          `${median((r) => r.usage.completion_tokens).padStart(5)}        ` +
          `${fmtMs(quantile(ms, 0.5)).padStart(6)} / ${fmtMs(quantile(ms, 0.9)).padStart(6)}     ` +
          `${mean(rs.map((r) => modelUsd(r.usage) + r.extraUsd)).toFixed(4)}     ` +
          `${mean(rs.map((r) => modelUsd(r.usage, false) + r.extraUsd)).toFixed(4)}`,
      );
    }
  }
  console.log(
    `\n  Tokens are medians per receipt; cached is the mean. Latency and cost for 'ocr' include its\n` +
      `  layout call. 'files' ran for PDFs only: for a photo it is the same request as 'images'.\n` +
      `  ${PRICE_NOTE}\n` +
      `  Recorded spend, every run and probe under .bakeoff/: $${recordedSpend().total.toFixed(2)}\n`,
  );
}

if (process.argv.includes("--summary")) {
  await summary();
} else {
  requireConfirmation();
  console.log(`\nInput modes: ${ARMS.join(", ")} x ${reps} run(s) x ${samples.length} samples\n`);
  for (let rep = 1; rep <= reps; rep++) {
    const todo = samples.flatMap((s) =>
      armsFor(s).filter((arm) => force || !isRecorded(arm, rep, s)),
    );
    // One page each: both PDFs in the corpus are single-page.
    guardSpend(`run ${rep}`, todo, todo.filter((arm) => arm === "ocr").length, cap);

    for (const [index, s] of samples.entries()) {
      const arms = armsFor(s);
      const first = (index + rep) % arms.length;
      for (const arm of [...arms.slice(first), ...arms.slice(0, first)]) {
        const tag = `  r${rep} ${s.name.padEnd(28)} ${arm.padEnd(7)}`;
        if (!force && isRecorded(arm, rep, s)) {
          console.log(`${tag} recorded`);
          continue;
        }
        try {
          const built = await userContent(arm, s, rep);
          const { json: fields, usage, latencyMs } = await complete(SYSTEM, built.content, SCHEMA);
          const record: InputModeRecord = {
            sample: s.name,
            arm,
            rep,
            input: built.input,
            sourceKind: s.sourceKind,
            latencyMs,
            extraMs: built.extraMs,
            extraUsd: built.extraUsd,
            usage,
            fields,
          };
          writeCache(kind(arm, rep), s.name, record);
          console.log(
            `${tag} ${fmtMs(latencyMs + built.extraMs).padStart(6)}  ` +
              `${String(usage.prompt_tokens).padStart(6)} in  ` +
              `${String(usage.completion_tokens).padStart(5)} out  ` +
              `$${(modelUsd(usage) + built.extraUsd).toFixed(4)}  ${built.input}`,
          );
        } catch (err) {
          console.log(`${tag} FAILED  ${(err as Error).message.slice(0, 180)}`);
        }
      }
    }
  }
  await summary();
}

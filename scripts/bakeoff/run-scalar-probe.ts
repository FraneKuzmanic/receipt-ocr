/**
 * The scalar probe (iteration 28): can an LLM be a third reader of the 14 scalar fields, in
 * parallel with production? Two text sources (`prebuilt-layout` markdown, `prebuilt-read` plain
 * text) by two deployments (`gpt-4.1`, `gpt-4.1-mini`), each given the document text only.
 *
 * Run 1, per receipt: production and both text calls start together, and each model call starts
 * when its text arrives, so the run measures real parallel latency. Runs 2 and up repeat the
 * model calls on run 1's text, for run-to-run stability; Document Intelligence returned the same
 * values in all three Plan B runs, so its calls are not paid for again.
 *
 * Records go to .bakeoff/scalar-probe/ and are scored with score-scalar-probe.ts.
 * `--summary` prints the recorded spend without a call.
 */
import { SYSTEM } from "./field-schema.ts";
import { uploadInput } from "./inputs.ts";
import { analyzeLayout } from "./layout.ts";
import { complete } from "./model-input.ts";
import { PLAN_B_DIR } from "./plan-b-records.ts";
import { runProduction } from "./production.ts";
import { REPAIR_SCHEMA } from "./repair.ts";
import { fmtMs, writeCache, type Sample } from "./samples.ts";
import {
  CONFIGS,
  DEPLOYMENTS,
  PROBE_DIR,
  PROBE_SAMPLES,
  SOURCES,
  TEXT_MODEL,
  configName,
  llmKind,
  productionKind,
  readLlm,
  readProduction,
  readText,
  textKind,
  type Config,
  type ProbeLlm,
  type ProbeProduction,
  type ProbeText,
  type Source,
} from "./scalar-probe-records.ts";
import { PRICE, recordedSpend, requireConfirmation } from "./spend.ts";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const reps = Number(arg("reps") ?? 3);
const only = arg("only")?.split(",");
const cap = Number(arg("cap") ?? 5);
const prefix = arg("tag") ? `${arg("tag")}-` : "";
const samples = PROBE_SAMPLES.filter((s) => !only || only.includes(s.name));

/** Plan B's two probe records deleted after reading; on no disk, so counted by hand (history 27). */
const PLAN_B_UNRECORDED_USD = 0.12;
// What a call costs before any is recorded: about 1,700 tokens in and 145 out (Plan B's repair call).
const ESTIMATE_USD: Record<string, number> = { "gpt-4.1": 0.0046, "gpt-4.1-mini": 0.0009 };
const PARALLEL_USD =
  2 * PRICE.diPage +
  PRICE.layoutPage +
  PRICE.readPage +
  DEPLOYMENTS.reduce((sum, d) => sum + 2 * ESTIMATE_USD[d]!, 0);

const spent = (): number =>
  recordedSpend(PLAN_B_DIR).total + recordedSpend(PROBE_DIR).total + PLAN_B_UNRECORDED_USD;

const document = (text: ProbeText): string =>
  `<dokument>\n${text.operation.analyzeResult?.content ?? ""}\n</dokument>`;

async function modelCall(
  c: Config,
  rep: number,
  s: Sample,
  text: ProbeText,
  startedAt?: number,
): Promise<ProbeLlm> {
  const { json, usage, latencyMs } = await complete(
    SYSTEM,
    document(text),
    REPAIR_SCHEMA,
    c.deployment,
  );
  const record: ProbeLlm = {
    arm: "scalar",
    sample: s.name,
    rep,
    ...c,
    latencyMs,
    ...(startedAt === undefined ? {} : { doneMs: Date.now() - startedAt }),
    usage,
    fields: json,
  };
  writeCache(llmKind(prefix, c, rep), s.name, record);
  return record;
}

/** Everything for one receipt at once. If any part fails, the whole receipt is run again. */
async function parallelRun(s: Sample): Promise<string> {
  const input = await uploadInput(s);
  const startedAt = Date.now();
  const production = runProduction(input).then((record): ProbeProduction => ({
    ...record,
    sample: s.name,
    doneMs: Date.now() - startedAt,
  }));
  const chain = async (source: Source): Promise<[ProbeText, ProbeLlm[]]> => {
    const text: ProbeText = {
      ...(await analyzeLayout(input.bytes, TEXT_MODEL[source])),
      sample: s.name,
      doneMs: Date.now() - startedAt,
    };
    const calls = await Promise.all(
      DEPLOYMENTS.map((deployment) => modelCall({ source, deployment }, 1, s, text, startedAt)),
    );
    return [text, calls];
  };
  const [done, ...chains] = await Promise.all([production, ...SOURCES.map(chain)]);
  writeCache(productionKind(prefix), s.name, done);
  for (const [index, source] of SOURCES.entries()) {
    writeCache(textKind(prefix, source), s.name, chains[index]![0]);
  }
  const paths = chains
    .flatMap(([, calls]) => calls)
    .map((call) => `${configName(call)} ${fmtMs(call.doneMs!)}`);
  return `production ${fmtMs(done.doneMs)}  ${paths.join("  ")}`;
}

const parallelRecorded = (s: Sample): boolean =>
  readProduction(prefix, s) !== null &&
  SOURCES.every((source) => readText(prefix, source, s) !== null) &&
  CONFIGS.every((c) => readLlm(prefix, c, 1, s)?.doneMs !== undefined);

function summary(): void {
  const probe = recordedSpend(PROBE_DIR).total;
  console.log(
    `\n  Recorded under .bakeoff/scalar-probe/: $${probe.toFixed(2)}. ` +
      `With Plan B's $${(spent() - probe).toFixed(2)}: $${spent().toFixed(2)} of a $${cap.toFixed(2)} cap.\n` +
      `  List prices, not checked against the invoice: gpt-4.1 $2.00 / $0.50 cached / $8.00 and ` +
      `gpt-4.1-mini $0.40 / $0.10 / $1.60 per 1M tokens; prebuilt-layout, -invoice and -receipt ` +
      `$0.01 a page, prebuilt-read $0.0015.\n`,
  );
}

if (process.argv.includes("--summary")) {
  summary();
} else {
  requireConfirmation();
  const parallelTodo = samples.filter((s) => !parallelRecorded(s));
  const repeatTodo = samples.flatMap((s) =>
    Array.from({ length: Math.max(0, reps - 1) }, (_, i) => i + 2).flatMap((rep) =>
      CONFIGS.filter((c) => readLlm(prefix, c, rep, s) === null).map((c) => ({ s, rep, c })),
    ),
  );
  const estimate =
    parallelTodo.length * PARALLEL_USD +
    repeatTodo.reduce((sum, { c }) => sum + ESTIMATE_USD[c.deployment]!, 0);
  console.log(
    `\n  Scalar probe: ${parallelTodo.length} parallel receipt run(s), ${repeatTodo.length} repeat model call(s); ` +
      `estimated $${estimate.toFixed(2)}; spent so far $${spent().toFixed(2)}; cap $${cap.toFixed(2)}\n`,
  );
  if (spent() + estimate > cap) {
    console.error(`  This would pass the $${cap.toFixed(2)} cap. Stopping before any call.\n`);
    process.exit(1);
  }

  for (const s of parallelTodo) {
    const tag = `  r1 ${s.name.padEnd(34)}`;
    try {
      console.log(`${tag} ${await parallelRun(s)}`);
    } catch (err) {
      console.log(`${tag} FAILED  ${(err as Error).message.slice(0, 180)}`);
    }
  }
  for (const { s, rep, c } of repeatTodo) {
    const tag = `  r${rep} ${s.name.padEnd(34)} ${configName(c).padEnd(20)}`;
    const text = readText(prefix, c.source, s);
    try {
      if (!text) throw new Error("skipped: run 1 has no text record for this receipt");
      console.log(`${tag} ${fmtMs((await modelCall(c, rep, s, text)).latencyMs)}`);
    } catch (err) {
      console.log(`${tag} FAILED  ${(err as Error).message.slice(0, 180)}`);
    }
  }
  summary();
}

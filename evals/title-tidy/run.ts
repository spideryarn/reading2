/**
 * **The title tidy, measured: the rule against a small model.** Plan
 * docs/plans/261005j-a-small-model-tidies-an-imported-title.md; the write-up
 * is docs/investigations/261005b-title-tidying-rule-against-a-small-model.md.
 *
 *   npx tsx evals/title-tidy/run.ts --titles=<file.json>[,<file.json>] --out=<dir> [--runs=2] [--arms=deepseek,luna]
 *
 * A titles file is either a list of `{ title, site_name?, lang? }` or an object
 * with that list under `titles` (evals/title-tidy/wild-titles.json). The
 * production titles the write-up used are not in the repo: they are readers'.
 *
 * Arms, each on every title:
 *
 * - **rule**: `tidyTitle` (src/title-tidy.ts) with no body, which is what the
 *   model is given too.
 * - **deepseek**: production exactly — `tidyTitleByModel`, job `title-tidy`,
 *   its zero-retention route and `effort: none`.
 * - **luna**: the same request re-sent as job `eval`, since the production
 *   route cannot serve an OpenAI model. The gateway's `eval` row sends the
 *   provider's default effort, so Luna's latency here is not what it would be
 *   in production; its answers are what is compared.
 *
 * Each model arm runs `--runs` times. Run 2 against run 1 is the control: how
 * often one model disagrees with itself.
 *
 * Writes `<out>/results.json`, `<out>/report.md`, and for each model arm a
 * blind `pairs-rule-vs-<arm>.md` with its `.key.tsv` beside it, holding only
 * the titles on which the rule and the model's first run differ.
 */
import fs from "node:fs";
import path from "node:path";
import { ProviderRefused, openRouterJson } from "../../src/ai-call.js";
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { loadEnvLocal } from "../../src/env.js";
import { TITLE_TIDY_MODEL } from "../../src/models.js";
import { environmentOwnerId } from "../../src/owner.js";
import { costStore } from "../../src/store/ai-calls.js";
import { TITLE_TIDY_SYSTEM, tidyTitleByModel, type ModelTidyOptions } from "../../src/title-tidy-model.js";
import { tidyTitle } from "../../src/title-tidy.js";
import { blindCoin } from "../plain-words/run.js";
import { createHash } from "node:crypto";
import { rowFor, summarizeArm, type Input, type Row } from "./stats.js";

loadEnvLocal();
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const FILES = (arg("titles") ?? "evals/title-tidy/wild-titles.json").split(",");
const OUT = arg("out") ?? "output/title-tidy-eval";
const RUNS = Number(arg("runs") ?? 2);
const ARM_NAMES = [...new Set((arg("arms") ?? "deepseek,luna").split(","))];
const CONCURRENCY = Number(arg("concurrency") ?? 3);
const MAX_RETRIES = 5;
if (!Number.isInteger(RUNS) || RUNS < 1 || !Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) {
  throw new Error("runs and concurrency must be positive integers");
}

const LUNA = "openai/gpt-6-luna";
const ARMS: Record<string, { model: string; opts: ModelTidyOptions }> = {
  deepseek: { model: TITLE_TIDY_MODEL, opts: {} },
  luna: { model: LUNA, opts: { model: LUNA, gateway: (_job, body, o) => openRouterJson("eval", body, o) } },
};

for (const arm of ARM_NAMES) if (!Object.hasOwn(ARMS, arm)) throw new Error(`Unknown title-tidy arm: ${arm}`);

const inputs: Input[] = FILES.flatMap((file) => {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Input[] | { titles: Input[] };
  const list = Array.isArray(parsed) ? parsed : parsed.titles;
  return list.map((t) => ({ ...t, set: path.basename(file, ".json") }));
}).map((input, id) => ({ ...input, id }));
if (inputs.length === 0) throw new Error("No titles supplied for the title-tidy eval");

async function one(arm: string, input: Input, run: number): Promise<Row> {
  let out: string | null = null;
  let error: string | null = null;
  let retries = 0;
  const t0 = Date.now();
  const { report } = await collectSpend(
    async () => {
      /* Retries a 429, as evals/pdf/minimal-metadata/score.mts does and
         production does not: the eval is about the answers. */
      for (let attempt = 0; ; attempt++) {
        try {
          out = await tidyTitleByModel(input.title, { siteName: input.site_name, lang: input.lang }, ARMS[arm]!.opts);
          error = null;
          return;
        } catch (err) {
          error = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 160) : String(err);
          if (!(err instanceof ProviderRefused) || err.status !== 429 || attempt >= MAX_RETRIES) return;
          retries++;
          await new Promise((r) => setTimeout(r, err.retryAfterMs ?? 2_000 * 2 ** attempt));
        }
      }
    },
    { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) },
  );
  const call = report.calls.at(-1);
  return {
    inputId: input.id,
    arm,
    run,
    set: input.set,
    title: input.title,
    out,
    error,
    nanos: totalSpend(report.calls).nanos,
    ms: call?.ms ?? Date.now() - t0,
    upstream: call?.upstream ?? null,
    inTok: call?.inputTokens ?? 0,
    outTok: call?.outputTokens ?? 0,
    reasonTok: call?.reasoningTokens ?? 0,
    retries,
  };
}

const jobs: (() => Promise<Row>)[] = [];
for (const arm of ARM_NAMES) for (let run = 1; run <= RUNS; run++) for (const input of inputs) jobs.push(() => one(arm, input, run));
const rows: Row[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const r = await jobs[next++]!();
      rows.push(r);
      process.stderr.write(`${r.arm} #${r.run} ${r.ms}ms ${r.error ?? (r.out === r.title ? "same" : "changed")}\n`);
    }
  }),
);

fs.mkdirSync(OUT, { recursive: true });
const promptHash = createHash("sha256").update(TITLE_TIDY_SYSTEM).digest("hex").slice(0, 12);
const rule = new Map(inputs.map((i) => [i.id, tidyTitle(i.title, { lang: i.lang })]));
fs.writeFileSync(
  path.join(OUT, "results.json"),
  JSON.stringify({ at: new Date().toISOString(), promptHash, files: FILES, inputs, rule: Object.fromEntries(rule), rows }, null, 1),
);

const got = (arm: string, run: number, input: Input) => rowFor(rows, arm, run, input.id);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const tableCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const lines: string[] = [`# Title tidy eval — ${new Date().toISOString().slice(0, 16)}Z`, "", `${inputs.length} titles from ${FILES.join(", ")}. Prompt ${promptHash}. ${RUNS} runs per model arm.`, ""];
lines.push(`rule: changed ${inputs.filter((i) => rule.get(i.id) !== i.title).length} of ${inputs.length}`, "");
for (const arm of ARM_NAMES) {
  const stats = summarizeArm(inputs, rows, rule, arm, RUNS);
  const { mine, first, errors } = stats;
  lines.push(
    `## ${arm} — \`${ARMS[arm]!.model}\``,
    "",
    `- usable answers changed ${stats.modelChanged} of ${first.length} on run 1; stored titles (including fallback) changed ${stats.storedChanged}`,
    `- differs from the rule on ${stats.differsFromRule}`,
    `- refused or failed: ${errors.length} of ${mine.length} calls (${[...new Set(errors.map((r) => r.error))].join("; ") || "none"})`,
    `- run 1 against run 2: ${stats.storedDisagree} of ${inputs.length} stored titles differ; ${stats.rawDisagree} raw answers/refusals differ`,
    `- median ${median(mine.map((r) => r.ms))} ms, worst ${Math.max(...mine.map((r) => r.ms))} ms; retries ${mine.reduce((s, r) => s + r.retries, 0)}`,
    `- $${(mine.reduce((s, r) => s + r.nanos, 0) / 1e9).toFixed(5)} for ${mine.length} calls; mean ${Math.round(mine.reduce((s, r) => s + r.inTok, 0) / mine.length)} tokens in, ${Math.round(mine.reduce((s, r) => s + r.outTok, 0) / mine.length)} out, ${Math.round(mine.reduce((s, r) => s + r.reasonTok, 0) / mine.length)} thinking`,
    `- upstreams: ${[...new Set(mine.map((r) => r.upstream))].join(", ")}`,
    "",
    "| title | rule | run 1 | run 2 |",
    "|---|---|---|---|",
  );
  for (const i of inputs) {
    const a = got(arm, 1, i);
    const b = got(arm, 2, i);
    const cell = (r: Row | undefined) => (r?.error ? `_${r.error}_` : r?.out === i.title ? "=" : (r?.out ?? ""));
    if (a?.out === i.title && (b?.out ?? i.title) === i.title && rule.get(i.id) === i.title && !a?.error && !b?.error) continue;
    lines.push(`| ${tableCell(i.title)} | ${tableCell(rule.get(i.id) === i.title ? "=" : rule.get(i.id)!)} | ${tableCell(cell(a))} | ${tableCell(cell(b))} |`);
  }
  lines.push("");

  /* The blind pairs: only where the rule and the model's first run differ. A
     failed call is shown as what production would store, the rule's answer,
     so it makes no pair. */
  const coin = blindCoin(261005);
  const pairs: string[] = [
    `# Blind pairs`,
    "",
    "Each item is the title of an article, paper or book as it arrived, and two tidied versions, X and Y.",
    "The tidy is meant to be very light: fix a title printed wholly in capitals, take off a website's or program's name stuck on the end, fix stray spacing and marks — and otherwise follow the author and change nothing.",
    "For each item answer on one line: `n: X|Y|same; harm: none|X …|Y …`.",
    "`X|Y|same` is which you would rather see on a shelf of titles. `harm` names a version that lost or changed part of the work's real title, or got a name or acronym wrong.",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  for (const i of inputs) {
    const model = got(arm, 1, i)?.out ?? rule.get(i.id)!;
    const byRule = rule.get(i.id)!;
    if (model === byRule) continue;
    n++;
    const flip = coin();
    pairs.push(`${n}. As it arrived: ${i.title}`, `   - X: ${flip ? model : byRule}`, `   - Y: ${flip ? byRule : model}`, "");
    key.push(`${n}\tX=${flip ? arm : "rule"}\tY=${flip ? "rule" : arm}\t${i.set}`);
  }
  fs.writeFileSync(path.join(OUT, `pairs-rule-vs-${arm}.md`), pairs.join("\n"));
  fs.writeFileSync(path.join(OUT, `pairs-rule-vs-${arm}.key.tsv`), `${key.join("\n")}\n`);
  lines.push(`Pairs for the blind read: ${n}; the model is X in ${key.filter((k) => k.includes(`X=${arm}`)).length} of them.`, "");
}
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
console.log(lines.join("\n"));

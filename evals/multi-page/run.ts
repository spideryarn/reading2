/**
 * **Does the multi-page judge follow the pages it should, and only those?**
 * Report spya-qkyukr; the write-up is
 * docs/investigations/261024c-multi-page-articles-readability-and-a-cheap-judge.md.
 *
 *   npx tsx evals/multi-page/run.ts [--corpus=<dir>] [--gold=<file>] [--out=<dir>] [--runs=2] [--models=haiku] [--only=a,b]
 *   npx tsx evals/multi-page/run.ts --rescore=<results dir> [--gold=<file>] --out=<dir>
 *
 * `<dir>/<case>/p1.html.gz` is each case's first page as fetched on 2026-10-24 (default
 * evals/multi-page/corpus, with each case's `meta.json` from the collecting run); the cases and
 * their gold are `--gold` (default evals/multi-page/gold.json). The held-out set is
 * `--corpus=evals/multi-page/holdout --gold=evals/multi-page/holdout-gold.json`, collected and
 * labelled after the prompt was fixed (GPT Sol, plan review F11). `--rescore` makes no call: it
 * reads `<results dir>/results.json` and scores its picks against the gold again, for when the
 * gold or the scoring changes. Each case is read the way the
 * fetch step reads it: Readability (`readArticle`), the page's own links
 * (`pageLinks`), and one call (`judgeMultiPage`): Haiku as production sends it,
 * any other model re-sent as job `eval`. `ms` is the call alone, Readability not counted.
 *
 * Scored three ways: the decision (follow or not) on the `multi` and `single`
 * cases; the pages picked on a `multi` case (GPT Sol, plan review F8: a right
 * decision with a missing chapter is still an incomplete import); and the cost
 * and latency of each call. `either` cases are reported and not scored.
 *
 * Pages, over every run of a `multi` case, followed or not: **recall** is gold
 * pages picked over gold pages; **precision** is gold pages picked over pages
 * picked, counted only on cases whose gold is `complete` (on an incomplete one
 * an extra may be a real part nobody listed); **all gold** is the share of runs
 * that picked every gold page; **exact** is the share of runs on a complete case
 * that picked exactly the gold pages in the gold order; **order** is the share of
 * runs with two or more gold pages picked whose picks come in gold order.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { openRouterJson } from "../../src/ai-call.js";
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { loadEnvLocal } from "../../src/env.js";
import { readArticle } from "../../src/extract.js";
import { MULTI_PAGE_MODEL } from "../../src/models.js";
import { judgeInput, judgeMultiPage, multiPageRequest, pageKey, type MultiPageVerdict } from "../../src/multi-page.js";
import { environmentOwnerId } from "../../src/owner.js";
import { costStore } from "../../src/store/ai-calls.js";

loadEnvLocal();
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CORPUS = arg("corpus") ?? "evals/multi-page/corpus";
const GOLD = arg("gold") ?? "evals/multi-page/gold.json";
const RESCORE = arg("rescore");
const OUT = arg("out") ?? "output/multi-page-eval";
const RUNS = Number(arg("runs") ?? 2);
const ONLY = arg("only")?.split(",");
const MODELS: Record<string, string> = {
  haiku: MULTI_PAGE_MODEL,
  luna: "openai/gpt-6-luna",
  deepseek: "deepseek/deepseek-v4.1-flash",
};
const ARMS = (arg("models") ?? "haiku").split(",");
for (const a of ARMS) if (!Object.hasOwn(MODELS, a)) throw new Error(`unknown model arm ${a}`);

type Gold = "multi" | "single" | "either";
interface Case { name: string; url: string; gold: Gold; complete?: boolean; pages?: string[]; why: string }
const gold = JSON.parse(fs.readFileSync(GOLD, "utf8")) as { cases: Case[] };
const cases = gold.cases.filter((c) => !ONLY || ONLY.includes(c.name));

/** How one run's picks compare with the gold pages. */
interface PageScore {
  goldHit: number;
  goldTotal: number;
  /** Picked, not gold. */
  extra: string[];
  /** Gold, not picked. */
  missing: string[];
  /** The gold pages picked come in gold order; null with fewer than two of them. */
  inOrder: boolean | null;
  /** Exactly the gold pages, in gold order. */
  exact: boolean;
}

interface Row extends PageScore {
  name: string;
  arm: string;
  run: number;
  gold: Gold;
  continues: boolean | null;
  /** Origin-relative where on page 1's origin, absolute otherwise. */
  picked: string[];
  reason: string;
  error: string | null;
  links: number;
  textChars: number;
  promptChars: number;
  costUsd: number | null;
  inTok: number;
  outTok: number;
  ms: number;
}

/** `picked` is what a Row holds: origin-relative, or absolute when off page 1's origin. */
function scorePages(c: Case, picked: readonly string[]): PageScore {
  const origin = new URL(c.url).origin;
  const goldKeys = (c.pages ?? []).map((p) => pageKey(new URL(p, origin)));
  const goldSet = new Set(goldKeys);
  const pickedKeys = picked.map((p) => pageKey(new URL(p, origin)));
  const hits = pickedKeys.filter((k) => goldSet.has(k));
  const ranks = hits.map((k) => goldKeys.indexOf(k));
  return {
    goldHit: new Set(hits).size,
    goldTotal: goldSet.size,
    extra: picked.filter((_, i) => !goldSet.has(pickedKeys[i]!)),
    missing: (c.pages ?? []).filter((_, i) => !pickedKeys.includes(goldKeys[i]!)),
    inOrder: ranks.length < 2 ? null : ranks.every((r, i) => i === 0 || r > ranks[i - 1]!),
    exact: goldKeys.length > 0 && pickedKeys.length === goldKeys.length && pickedKeys.every((k, i) => k === goldKeys[i]),
  };
}

async function one(c: Case, arm: string, run: number): Promise<Row> {
  const html = gunzipSync(fs.readFileSync(path.join(CORPUS, c.name, "p1.html.gz"))).toString("utf8");
  /* `judgeInput` is the fetch step's own (src/follow-pages.ts), so what is measured is what ships. */
  const { page, links } = judgeInput(html, c.url, readArticle(html, c.url).article);
  const text = page.text;
  const promptChars = JSON.stringify(multiPageRequest(page, links, MODELS[arm]!).messages).length;
  let verdict: MultiPageVerdict | null = null;
  let error: string | null = null;
  const t0 = Date.now();
  const { report } = await collectSpend(
    async () => {
      try {
        /* Haiku is production exactly: job `multi-page`, its route and its
           effort. Another model is re-sent as job `eval`, since that route
           serves Anthropic only. */
        verdict = await judgeMultiPage(
          page,
          links,
          arm === "haiku" ? {} : { model: MODELS[arm]!, gateway: (_job, body, o) => openRouterJson("eval", body, o) },
        );
      } catch (err) {
        error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
    },
    { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) },
  );
  const call = report.calls.at(-1);
  const ms = Date.now() - t0;
  const v = verdict as MultiPageVerdict | null;
  const origin = new URL(c.url).origin;
  const picked = (v?.continues ? v.pages.map((p) => p.url) : []).map((p) => (p.startsWith(`${origin}/`) ? p.slice(origin.length) : p));
  return {
    name: c.name,
    arm,
    run,
    gold: c.gold,
    continues: v ? v.continues : null,
    picked,
    ...scorePages(c, picked),
    reason: v?.reason ?? "",
    error,
    links: links.length,
    textChars: text.replace(/\s+/g, " ").length,
    promptChars,
    costUsd: totalSpend(report.calls).nanos / 1e9,
    inTok: call?.inputTokens ?? 0,
    outTok: call?.outputTokens ?? 0,
    ms,
  };
}

const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "–");
const isComplete = (name: string) => cases.find((c) => c.name === name)?.complete === true;
const sum = (rs: readonly Row[], f: (r: Row) => number) => rs.reduce((a, r) => a + f(r), 0);

/** The page-level line for one arm's `multi` rows. */
function pageLine(multi: readonly Row[]): string {
  const complete = multi.filter((r) => isComplete(r.name));
  const ordered = multi.filter((r) => r.inOrder !== null);
  return `- pages, over ${multi.length} runs of ${new Set(multi.map((r) => r.name)).size} \`multi\` cases: ` +
    `recall ${pct(sum(multi, (r) => r.goldHit), sum(multi, (r) => r.goldTotal))}; ` +
    `precision (complete gold only) ${pct(sum(complete, (r) => r.goldHit), sum(complete, (r) => r.picked.length))}; ` +
    `all gold pages picked ${pct(multi.filter((r) => r.goldTotal > 0 && r.goldHit === r.goldTotal).length, multi.length)}; ` +
    `exactly the gold pages in gold order (complete gold only) ${pct(complete.filter((r) => r.exact).length, complete.length)}; ` +
    `picks in gold order ${pct(ordered.filter((r) => r.inOrder).length, ordered.length)}`;
}

function report(rows: readonly Row[], arms: readonly string[], title: string): string[] {
  const lines: string[] = [`# ${title}`, "", `Gold: \`${GOLD}\`.`, ""];
  for (const arm of arms) {
    const mine = rows.filter((r) => r.arm === arm);
    const scored = mine.filter((r) => r.gold !== "either");
    const right = scored.filter((r) => r.continues === (r.gold === "multi")).length;
    const fp = scored.filter((r) => r.gold === "single" && r.continues).length;
    const fn = scored.filter((r) => r.gold === "multi" && !r.continues).length;
    const errs = mine.filter((r) => r.error).length;
    const costs = mine.map((r) => r.costUsd).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const ms = mine.map((r) => r.ms).sort((a, b) => a - b);
    const med = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? NaN;
    const multi = mine.filter((r) => r.gold === "multi");
    lines.push(`## ${arm} (${MODELS[arm] ?? "?"})`, "",
      `- decision right: ${right}/${scored.length}; false follows (single → followed): ${fp}; missed (multi → not followed): ${fn}; errors: ${errs}`,
      pageLine(multi),
      `- cost per call: median $${med(costs).toFixed(4)}, max $${(costs.at(-1) ?? NaN).toFixed(4)}; total $${costs.reduce((a, b) => a + b, 0).toFixed(3)}`,
      `- latency: median ${med(ms)} ms, max ${ms.at(-1)} ms`, "");
    if (multi.length) {
      lines.push("Pages per `multi` case:", "",
        "| case | gold complete | runs | recall | precision | all gold | exact | in order | gold pages missed (runs) |",
        "|---|---|---|---|---|---|---|---|---|");
      for (const name of new Set(multi.map((r) => r.name))) {
        const rs = multi.filter((r) => r.name === name);
        const comp = isComplete(name);
        const ord = rs.filter((r) => r.inOrder !== null);
        const missed = new Map<string, number>();
        for (const r of rs) for (const m of r.missing) missed.set(m, (missed.get(m) ?? 0) + 1);
        lines.push(`| ${name} | ${comp} | ${rs.length} | ${pct(sum(rs, (r) => r.goldHit), sum(rs, (r) => r.goldTotal))} | ` +
          `${comp ? pct(sum(rs, (r) => r.goldHit), sum(rs, (r) => r.picked.length)) : "–"} | ` +
          `${rs.filter((r) => r.goldHit === r.goldTotal).length}/${rs.length} | ${comp ? `${rs.filter((r) => r.exact).length}/${rs.length}` : "–"} | ` +
          `${ord.length ? `${ord.filter((r) => r.inOrder).length}/${ord.length}` : "–"} | ${[...missed].map(([m, n]) => `${m} (${n})`).join(" ") || "–"} |`);
      }
      lines.push("");
    }
    lines.push("| case | gold | run | follows | gold pages picked | extra | links | reason |", "|---|---|---|---|---|---|---|---|");
    for (const r of mine) {
      lines.push(`| ${r.name} | ${r.gold} | ${r.run} | ${r.error ? `ERR ${r.error}` : r.continues} | ${r.goldTotal ? `${r.goldHit}/${r.goldTotal}` : "–"} | ${r.extra.slice(0, 4).join(" ")}${r.extra.length > 4 ? ` +${r.extra.length - 4}` : ""} | ${r.links} | ${r.reason.replace(/\|/g, "/")} |`);
    }
    lines.push("");
  }
  return lines;
}

/** An earlier run's picks, scored against the gold as it now stands. No model call. */
function rescore(dir: string): Row[] {
  const old = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8")) as Row[];
  const out: Row[] = [];
  for (const r of old) {
    const c = cases.find((x) => x.name === r.name);
    if (c) out.push({ ...r, gold: c.gold, ...scorePages(c, r.picked) });
  }
  return out;
}

async function main() {
  let rows: Row[] = [];
  let arms = ARMS;
  if (RESCORE) {
    rows = rescore(RESCORE);
    arms = [...new Set(rows.map((r) => r.arm))];
  } else {
    const jobs: (() => Promise<void>)[] = [];
    for (const c of cases) for (const arm of ARMS) for (let r = 1; r <= RUNS; r++) jobs.push(async () => void rows.push(await one(c, arm, r)));
    const width = 4;
    await Promise.all(Array.from({ length: width }, async () => { for (let j = jobs.shift(); j; j = jobs.shift()) await j(); }));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.arm.localeCompare(b.arm) || a.run - b.run);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(rows, null, 2));
  const lines = report(rows, arms, RESCORE ? `Multi-page judge eval, ${RESCORE} rescored` : "Multi-page judge eval");
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  console.log(lines.filter((l) => l.startsWith("## ") || l.startsWith("- ")).join("\n"));
  console.log(`\nwrote ${OUT}/report.md`);
}

await main();

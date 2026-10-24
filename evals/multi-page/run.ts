/**
 * **Does the multi-page judge follow the pages it should, and only those?**
 * Report spya-qkyukr; the write-up is
 * docs/investigations/261024c-multi-page-articles-readability-and-a-cheap-judge.md.
 *
 *   npx tsx evals/multi-page/run.ts [--corpus=<dir>] [--out=<dir>] [--runs=2] [--models=haiku] [--only=a,b]
 *
 * `<dir>/<case>/p1.html.gz` is each case's first page as fetched on 2026-10-24 (default
 * evals/multi-page/corpus, with each case's `meta.json` from the collecting run); the cases and
 * their gold are evals/multi-page/gold.json. Each case is read the way the
 * fetch step reads it: Readability (`readArticle`), the page's own links
 * (`pageLinks`), and one call (`judgeMultiPage`): Haiku as production sends it,
 * any other model re-sent as job `eval`. `ms` is the call alone, Readability not counted.
 *
 * Scored three ways: the decision (follow or not) on the `multi` and `single`
 * cases; for a followed `multi` case, how many of the gold pages were picked
 * and what else was; and the cost and latency of each call. `either` cases are
 * reported and not scored.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { openRouterJson } from "../../src/ai-call.js";
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { loadEnvLocal } from "../../src/env.js";
import { readArticle } from "../../src/extract.js";
import { MULTI_PAGE_MODEL } from "../../src/models.js";
import { judgeMultiPage, multiPageRequest, pageKey, pageLinks, type MultiPageVerdict } from "../../src/multi-page.js";
import { environmentOwnerId } from "../../src/owner.js";
import { costStore } from "../../src/store/ai-calls.js";

loadEnvLocal();
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CORPUS = arg("corpus") ?? "evals/multi-page/corpus";
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
const gold = JSON.parse(fs.readFileSync("evals/multi-page/gold.json", "utf8")) as { cases: Case[] };
const cases = gold.cases.filter((c) => !ONLY || ONLY.includes(c.name));

interface Row {
  name: string;
  arm: string;
  run: number;
  gold: Gold;
  continues: boolean | null;
  picked: string[];
  goldHit: number;
  goldTotal: number;
  extra: string[];
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

async function one(c: Case, arm: string, run: number): Promise<Row> {
  const html = gunzipSync(fs.readFileSync(path.join(CORPUS, c.name, "p1.html.gz"))).toString("utf8");
  const read = readArticle(html, c.url);
  const text = read.article?.textContent ?? "";
  const links = pageLinks(html, c.url, read.article?.content ?? null);
  const page = { url: c.url, title: read.article?.title ?? null, text };
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
  const picked = v?.continues ? v.pages.map((p) => p.url) : [];
  const goldKeys = new Set((c.pages ?? []).map((p) => pageKey(new URL(p, origin))));
  const pickedKeys = picked.map((p) => pageKey(new URL(p)));
  return {
    name: c.name,
    arm,
    run,
    gold: c.gold,
    continues: v ? v.continues : null,
    picked: picked.map((p) => p.replace(origin, "")),
    goldHit: pickedKeys.filter((k) => goldKeys.has(k)).length,
    goldTotal: goldKeys.size,
    extra: picked.filter((_, i) => !goldKeys.has(pickedKeys[i]!)).map((p) => p.replace(origin, "")),
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

async function main() {
  const rows: Row[] = [];
  const jobs: (() => Promise<void>)[] = [];
  for (const c of cases) for (const arm of ARMS) for (let r = 1; r <= RUNS; r++) jobs.push(async () => void rows.push(await one(c, arm, r)));
  const width = 4;
  await Promise.all(Array.from({ length: width }, async () => { for (let j = jobs.shift(); j; j = jobs.shift()) await j(); }));
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.arm.localeCompare(b.arm) || a.run - b.run);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(rows, null, 2));
  const lines: string[] = ["# Multi-page judge eval", ""];
  for (const arm of ARMS) {
    const mine = rows.filter((r) => r.arm === arm);
    const scored = mine.filter((r) => r.gold !== "either");
    const right = scored.filter((r) => r.continues === (r.gold === "multi")).length;
    const fp = scored.filter((r) => r.gold === "single" && r.continues).length;
    const fn = scored.filter((r) => r.gold === "multi" && !r.continues).length;
    const errs = mine.filter((r) => r.error).length;
    const costs = mine.map((r) => r.costUsd).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const ms = mine.map((r) => r.ms).sort((a, b) => a - b);
    const med = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? NaN;
    lines.push(`## ${arm} (${MODELS[arm]})`, "",
      `- decision right: ${right}/${scored.length}; false follows (single → followed): ${fp}; missed (multi → not followed): ${fn}; errors: ${errs}`,
      `- cost per call: median $${med(costs).toFixed(4)}, max $${(costs.at(-1) ?? NaN).toFixed(4)}; total $${costs.reduce((a, b) => a + b, 0).toFixed(3)}`,
      `- latency: median ${med(ms)} ms, max ${ms.at(-1)} ms`, "",
      "| case | gold | run | follows | gold pages picked | extra | links | reason |", "|---|---|---|---|---|---|---|---|");
    for (const r of mine) {
      lines.push(`| ${r.name} | ${r.gold} | ${r.run} | ${r.error ? `ERR ${r.error}` : r.continues} | ${r.goldTotal ? `${r.goldHit}/${r.goldTotal}` : "–"} | ${r.extra.slice(0, 4).join(" ")}${r.extra.length > 4 ? ` +${r.extra.length - 4}` : ""} | ${r.links} | ${r.reason.replace(/\|/g, "/")} |`);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  console.log(lines.slice(0, 2 + ARMS.length * 5).join("\n"));
  console.log(`\nwrote ${OUT}/report.md`);
}

await main();

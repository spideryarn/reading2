/**
 * **The bulk import's metadata reader, scored** — src/paper-metadata.ts against
 * expected.json, on the 13 PDFs cheap-model-spike.mts read. Plan
 * docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md § The
 * metadata step: DeepSeek ships only if it is no worse than Luna on title,
 * authors and abstract.
 *
 *   npx tsx evals/pdf/minimal-metadata/score.mts [--runs=3] [--arms=deepseek,luna] [--only=<slug>]
 *
 * Both arms call production's `extractPaperMetadata`, so the page text, the
 * prompt, the schema and the answer checks are production's. They differ in
 * the model and the route:
 *
 * - **deepseek** is production exactly: job `paper-metadata`, its three-provider
 *   zero-retention route (Fireworks first, then fallback), `PAPER_METADATA_MODEL`.
 * - **luna** cannot use that route (Fireworks does not serve OpenAI), so it
 *   goes through the `gateway` seam the function already has for tests, which
 *   re-sends the same body as job `eval` — the spike's route. Production
 *   passes no gateway, so nothing a reader reaches can take this path.
 *
 * Scores, per call: title exact after folding case, accents, punctuation and
 * whitespace, or close (one contains the other, or 80% of words shared);
 * authors' recall and precision by surname; abstract present or absent as
 * expected, and, when present, verbatim (90% of its 40-character pieces found
 * in the page text, whitespace and hyphens ignored); DOI exact. Cost is the
 * ledger row's (`totalSpend`, so a BYOK upstream figure counts), latency the
 * last provider attempt's. Retries are counted separately; their backoff is not
 * folded into this timing.
 *
 * Needs `.env.local`'s OpenRouter key; the rows go to the local ledger as
 * `eval` scope on the eval owner, and a failed write is only counted.
 */
import fs from "node:fs";
import path from "node:path";
import { ProviderRefused, openRouterJson } from "../../../src/ai-call.js";
import { collectSpend, totalSpend } from "../../../src/ai-spend.js";
import { loadEnvLocal } from "../../../src/env.js";
import { PAPER_METADATA_MODEL } from "../../../src/models.js";
import { environmentOwnerId } from "../../../src/owner.js";
import {
  PAGES_READ,
  TEXT_CAP,
  extractPaperMetadata,
  type ExtractOptions,
  type PaperMetadata,
} from "../../../src/paper-metadata.js";
import { firstPagesText } from "../../../src/pdf.js";
import { costStore } from "../../../src/store/ai-calls.js";

loadEnvLocal();
const ROOT = process.cwd();
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const RUNS = Number(arg("runs") ?? 3);
const ARM_NAMES = (arg("arms") ?? "deepseek,luna").split(",");
const ONLY = arg("only");
const CONCURRENCY = Number(arg("concurrency") ?? 2);
const MAX_RETRIES = 6;

type Expected = { slug: string; path: string; title: string; authors: string[]; hasAbstract: boolean; doi: string | null };
const fixtures = (
  JSON.parse(fs.readFileSync(path.join(ROOT, "evals/pdf/minimal-metadata/expected.json"), "utf8")) as { fixtures: Expected[] }
).fixtures.filter((f) => !ONLY || f.slug === ONLY);

const LUNA = "openai/gpt-5.6-luna";
const ARMS: Record<string, { model: string; opts: Omit<ExtractOptions, "signal"> }> = {
  deepseek: { model: PAPER_METADATA_MODEL, opts: {} },
  luna: {
    model: LUNA,
    opts: { model: LUNA, gateway: (_job, body, o) => openRouterJson("eval", body, o) },
  },
};

/* ------------------------------------------------------------- scoring -- */

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const squash = (s: string) => fold(s).replace(/\s+/g, "");

function titleScore(got: string | null, want: string): "exact" | "close" | "wrong" {
  if (!got) return "wrong";
  const g = fold(got);
  const w = fold(want);
  if (g === w) return "exact";
  if (g.includes(w) || w.includes(g)) return "close";
  const gw = new Set(g.split(" "));
  const ww = new Set(w.split(" "));
  const shared = [...ww].filter((x) => gw.has(x)).length;
  return shared / Math.max(gw.size, ww.size) >= 0.8 ? "close" : "wrong";
}

const surname = (name: string) => fold(name).split(" ").at(-1) ?? "";

function authorScore(got: string[], want: string[]): { recall: number; precision: number } {
  const pool = want.map(surname);
  let hit = 0;
  for (const g of got) {
    const i = pool.indexOf(surname(g));
    if (i >= 0) {
      hit++;
      pool.splice(i, 1);
    }
  }
  return { recall: want.length ? hit / want.length : got.length ? 0 : 1, precision: got.length ? hit / got.length : want.length ? 0 : 1 };
}

/** The share of the abstract's 40-character pieces found in the page text. */
function verbatimShare(abstract: string, page: string): number {
  const a = squash(abstract);
  const p = squash(page);
  const pieces: string[] = [];
  for (let i = 0; i + 40 <= a.length; i += 40) pieces.push(a.slice(i, i + 40));
  if (pieces.length === 0) return p.includes(a) ? 1 : 0;
  return pieces.filter((x) => p.includes(x)).length / pieces.length;
}

type Row = {
  arm: string;
  slug: string;
  run: number;
  error: string | null;
  out: PaperMetadata | null;
  title: "exact" | "close" | "wrong";
  recall: number;
  precision: number;
  abstractRight: boolean;
  verbatim: number | null;
  doiRight: boolean;
  nanos: number;
  ms: number;
  upstream: string | null;
  inTok: number;
  outTok: number;
  reasonTok: number;
  retries: number;
};

async function one(arm: string, f: Expected, run: number, bytes: Uint8Array, page: string): Promise<Row> {
  const t0 = Date.now();
  let out: PaperMetadata | null = null;
  let error: string | null = null;
  let retries = 0;
  const { report } = await collectSpend(
    async () => {
      /* **Retries a 429, and production does not.** Fireworks' shared pool
         rate-limits this model hard (measured 2026-10-01: most calls a few
         seconds apart were refused, `limit_source: upstream_provider_shared_pool`).
         The eval is about quality, so it waits and retries; how often it had to
         is counted, because that is a finding about the route, not the model. */
      for (let attempt = 0; ; attempt++) {
        try {
          out = await extractPaperMetadata(bytes, ARMS[arm]!.opts);
          error = null;
          return;
        } catch (err) {
          error = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 160) : String(err);
          if (!(err instanceof ProviderRefused) || err.status !== 429 || attempt >= MAX_RETRIES) return;
          retries++;
          await new Promise((r) => setTimeout(r, err.retryAfterMs ?? 3_000 * 2 ** attempt));
        }
      }
    },
    { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) },
  );
  const ms = Date.now() - t0;
  const call = report.calls.at(-1);
  const o = out as PaperMetadata | null;
  const a = o ? authorScore(o.authors, f.authors) : { recall: 0, precision: 0 };
  return {
    arm,
    slug: f.slug,
    run,
    error,
    out: o,
    title: o ? titleScore(o.title, f.title) : "wrong",
    recall: a.recall,
    precision: a.precision,
    abstractRight: o ? (o.abstract !== null) === f.hasAbstract : false,
    verbatim: o?.abstract && f.hasAbstract ? verbatimShare(o.abstract, page) : null,
    doiRight: o ? (o.doi?.toLowerCase() ?? null) === (f.doi?.toLowerCase() ?? null) : false,
    nanos: totalSpend(report.calls).nanos,
    ms: call?.ms ?? ms,
    upstream: call?.upstream ?? null,
    inTok: call?.inputTokens ?? 0,
    outTok: call?.outputTokens ?? 0,
    reasonTok: call?.reasoningTokens ?? 0,
    retries,
  };
}

/* ---------------------------------------------------------------- run -- */

const inputs = await Promise.all(
  fixtures.map(async (f) => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, f.path)));
    return { f, bytes, page: await firstPagesText(bytes, { pages: PAGES_READ, maxChars: TEXT_CAP }) };
  }),
);

const jobs: (() => Promise<Row>)[] = [];
for (const arm of ARM_NAMES) for (let run = 1; run <= RUNS; run++) for (const i of inputs) jobs.push(() => one(arm, i.f, run, i.bytes, i.page));
const rows: Row[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const r = await jobs[next++]!();
      rows.push(r);
      process.stderr.write(`${r.arm} ${r.slug} #${r.run} [${r.upstream} retries=${r.retries}]: ${r.error ?? `${r.title} ${r.ms}ms${r.title === "exact" ? "" : ` (“${r.out?.title}”)`}`}\n`);
    }
  }),
);

/* -------------------------------------------------------------- report -- */

const pct = (n: number) => `${Math.round(n * 100)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const lines: string[] = [];
const say = (s = "") => lines.push(s);

say(`# Paper metadata eval — ${new Date().toISOString().slice(0, 16)}Z`);
say();
say(`${fixtures.length} PDFs × ${RUNS} runs per arm. Arms: ${ARM_NAMES.map((a) => `${a} (\`${ARMS[a]!.model}\`)`).join(", ")}.`);
for (const arm of ARM_NAMES) {
  const mine = rows.filter((r) => r.arm === arm);
  say();
  say(`## ${arm} — \`${ARMS[arm]!.model}\``);
  say();
  say("| fixture | title exact/close | author recall | author precision | abstract right | verbatim | DOI right | last attempt ms (mean) | errors |");
  say("|---|---|---|---|---|---|---|---|---|");
  for (const { f } of inputs) {
    const rs = mine.filter((r) => r.slug === f.slug);
    const verb = rs.map((r) => r.verbatim).filter((v): v is number => v !== null);
    say(
      `| ${f.slug} | ${rs.filter((r) => r.title === "exact").length}/${rs.filter((r) => r.title === "close").length} of ${rs.length} | ${pct(mean(rs.map((r) => r.recall)))} | ${pct(mean(rs.map((r) => r.precision)))} | ${rs.filter((r) => r.abstractRight).length}/${rs.length} | ${verb.length ? pct(mean(verb)) : "—"} | ${rs.filter((r) => r.doiRight).length}/${rs.length} | ${Math.round(mean(rs.map((r) => r.ms)))} | ${rs.filter((r) => r.error).length} |`,
    );
  }
  const verb = mine.map((r) => r.verbatim).filter((v): v is number => v !== null);
  const called = mine.filter((r) => r.out?.from === "model");
  const sorted = called.map((r) => r.ms).sort((a, b) => a - b);
  say();
  say(`- **Title**: ${mine.filter((r) => r.title === "exact").length} exact, ${mine.filter((r) => r.title === "close").length} close, ${mine.filter((r) => r.title === "wrong").length} wrong, of ${mine.length}.`);
  say(`- **Authors**: recall ${pct(mean(mine.map((r) => r.recall)))}, precision ${pct(mean(mine.map((r) => r.precision)))}.`);
  say(`- **Abstract**: present/absent right ${mine.filter((r) => r.abstractRight).length}/${mine.length}; verbatim share ${pct(mean(verb))} mean over ${verb.length} (${verb.filter((v) => v >= 0.9).length} at ≥90%).`);
  say(`- **DOI**: ${mine.filter((r) => r.doiRight).length}/${mine.length} right.`);
  say(`- **Errors**: ${mine.filter((r) => r.error).length}${mine.filter((r) => r.error).map((r) => ` — ${r.slug} #${r.run}: ${r.error}`).join("")}.`);
  say(
    `- **Cost**: $${(mine.reduce((s, r) => s + r.nanos, 0) / 1e9).toFixed(5)} in all, $${(mean(called.map((r) => r.nanos)) / 1e9).toFixed(6)} a paper (mean over ${called.length} calls); tokens in ${Math.round(mean(called.map((r) => r.inTok)))}, out ${Math.round(mean(called.map((r) => r.outTok)))}, reasoning ${Math.round(mean(called.map((r) => r.reasonTok)))} (means).`,
  );
  say(`- **Latency of the last attempt** (retry backoff excluded): mean ${Math.round(mean(sorted))} ms, median ${sorted[Math.floor(sorted.length / 2)] ?? 0} ms, max ${sorted.at(-1) ?? 0} ms.`);
  say(`- **429s retried**: ${mine.reduce((s, r) => s + r.retries, 0)} over ${mine.length} papers (${mine.filter((r) => r.retries > 0).length} needed at least one).`);
  const counts = new Map<string, number>();
  for (const r of called) counts.set(r.upstream ?? "unknown", (counts.get(r.upstream ?? "unknown") ?? 0) + 1);
  say(`- **Upstreams** (the response's \`provider\`): ${[...counts].map(([u, n]) => `${u} ${n}`).join(", ")}.`);
}

say();
say("## What each arm answered (run 1)");
for (const arm of ARM_NAMES) {
  say();
  say(`### ${arm}`);
  say();
  for (const r of rows.filter((x) => x.arm === arm && x.run === 1).sort((a, b) => a.slug.localeCompare(b.slug))) {
    const o = r.out;
    say(
      `- **${r.slug}**: ${r.error ? `ERROR ${r.error}` : `title “${o?.title}” · authors ${JSON.stringify(o?.authors)} · doi ${o?.doi} · abstract ${o?.abstract ? `“${o.abstract.slice(0, 90)}…” (${o.abstract.length} chars)` : "null"}`}`,
    );
  }
}

console.log(lines.join("\n"));

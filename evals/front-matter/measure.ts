/**
 * **The general affiliations pass against what each kind of page got before,
 * and what it costs.**
 *
 * For each web page: fetch it and run stage 2 exactly as import does
 * (`runExtract`), with a reader that records what production hands it — the
 * page's opening and its declared names — and then gives that to
 * `readFrontMatterAuthors` (src/front-matter-authors.ts) on each model arm,
 * `--draws` times. A page that declares no authors, or already declares an
 * affiliation, is never handed over, as in production.
 *
 * "Before" is a baseline results file (`--baseline=`): the arXiv rows of run 3
 * hold what the arXiv affiliations path of plan 261009m stored, measured on
 * the same pages before it was removed. For a PDF already imported locally,
 * the opening is its stored blocks, the declared names its stored names, and
 * "before" its stored authors (the PDF path's own Sonnet pass).
 *
 * Every call is recorded (`collectSpend` with the cost store's sink), as
 * docs/project/cost-tracking.md requires.
 *
 *   npx tsx evals/front-matter/measure.ts [--arms=haiku,deepseek] [--draws=N] [--only=a,b]
 *     [--baseline=<results.json>] [--out=<file.json>]
 *
 * docs/plans/261010d-a-general-authors-pass-for-every-web-page.md § Measured.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { openRouterJson } from "../../src/ai-call.js";
import { collectSpend, formatNanos, totalSpend } from "../../src/ai-spend.js";
import { closeDb, getDb } from "../../src/db/client.js";
import { loadEnvLocal } from "../../src/env.js";
import { runExtract } from "../../src/extract.js";
import { USER_AGENT } from "../../src/fetch.js";
import {
  type FrontMatterGateway,
  type FrontMatterVerdict,
  openingRecords,
  type OpeningRecord,
  readFrontMatterAuthors,
} from "../../src/front-matter-authors.js";
import { environmentOwnerId } from "../../src/owner.js";
import { costStore } from "../../src/store/ai-calls.js";
import type { Author } from "../../src/types.js";

loadEnvLocal();

type Input = { name: string; kind: "arxiv-html" | "journal" | "blog" | "pdf"; url?: string; slug?: string };

const ARXIV = [
  "1706.03762v7", "2605.20355v1", "2608.13566", "2610.01658v1", "2610.01988v1", "2610.03261v1",
  "2610.08392", "2610.08750", "2610.08781", "2610.08785", "2610.08790", "2610.10761", "2610.10548",
];
const INPUTS: Input[] = [
  ...ARXIV.map((id) => ({ name: `arxiv ${id}`, kind: "arxiv-html" as const, url: `https://arxiv.org/html/${id}` })),
  { name: "jstatsoft", kind: "journal", url: "https://www.jstatsoft.org/article/view/v059i10" },
  { name: "plos ioannidis", kind: "journal", url: "https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.0020124" },
  { name: "acl anthology", kind: "journal", url: "https://aclanthology.org/2020.acl-main.463/" },
  { name: "frontiers", kind: "journal", url: "https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00058/full" },
  { name: "noema seth", kind: "blog", url: "https://www.noemamag.com/the-mythology-of-conscious-ai/" },
  { name: "paulgraham greatwork", kind: "blog", url: "https://paulgraham.com/greatwork.html" },
  { name: "gwern scaling", kind: "blog", url: "https://gwern.net/scaling-hypothesis" },
  { name: "wikipedia spider silk", kind: "blog", url: "https://en.wikipedia.org/wiki/Spider_silk" },
  { name: "simonwillison 2024", kind: "blog", url: "https://simonwillison.net/2024/Dec/31/llms-in-2024/" },
  { name: "substack", kind: "blog", url: "https://www.astralcodexten.com/p/heuristics-that-almost-always-work" },
  { name: "distill attention", kind: "blog", url: "https://distill.pub/2016/augmented-rnns/" },
  { name: "pdf arxiv 1502", kind: "pdf", slug: "arxiv-1502-spya-tqwbn2" },
  { name: "pdf arxiv 2010", kind: "pdf", slug: "arxiv-2010-spya-tkm7nm" },
  { name: "pdf nihms", kind: "pdf", slug: "fd-src-nihms-536461-spya-nr87dn-spya-en7r25" },
  { name: "pdf jco", kind: "pdf", slug: "fd-src-jco-2005-01-libre-spya-hk9cc7-spya-q6dbj3" },
  { name: "pdf entropy", kind: "pdf", slug: "entropy-24-00930-spya-pywwkq" },
  { name: "pdf gdl", kind: "pdf", slug: "s3-gdl-45mb-spya-cc9kr8" },
];

/** Each arm: a model, and the route it is metered under. */
const ARMS = {
  haiku: { model: "anthropic/claude-haiku-5.5", route: "front-matter-authors" },
  deepseek: { model: "deepseek/deepseek-v4.1-flash", route: "paper-metadata" },
} as const;
type Arm = keyof typeof ARMS;

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const arms = (arg("arms")?.split(",") ?? ["haiku", "deepseek"]) as Arm[];
const draws = Number(arg("draws") ?? 1);
const only = arg("only");
const outFile = arg("out");
const baselineFile = arg("baseline");
const baseline = new Map<string, Author[] | null>(
  baselineFile
    ? (JSON.parse(readFileSync(baselineFile, "utf8")) as { input: { name: string }; today?: Author[] | null }[]).map((r) => [r.input.name, r.today ?? null])
    : [],
);
const attribution = { scopeKind: "eval" as const, ownerId: environmentOwnerId() };
const sink = (row: Parameters<typeof costStore.record>[0]) => costStore.record(row);

const show = (authors: readonly Author[] | null | undefined) =>
  authors?.length ? authors.map((a) => `${a.name}${a.affiliations.length ? ` — ${a.affiliations.join(" | ")}` : ""}`) : ["(none)"];

type Opening = { records: OpeningRecord[]; declared: string[] | null; before: Author[] | null; stored: Author[] | null };

async function opening(input: Input): Promise<Opening> {
  if (input.kind === "pdf") {
    const db = getDb();
    const rows = await db.execute(sql`
      select b.block_id as id, b.text from spideryarn.revision_blocks b
      join spideryarn.articles a on a.current_revision_id = b.revision_id
      where a.slug = ${input.slug} order by b.ordinal limit 60`);
    const auth = await db.execute(sql`
      select r.authors from spideryarn.article_revisions r join spideryarn.articles a on a.current_revision_id = r.id
      where a.slug = ${input.slug}`);
    const stored = ((auth.rows[0] as { authors?: Author[] } | undefined)?.authors ?? null) as Author[] | null;
    return { records: openingRecords(rows.rows as unknown as OpeningRecord[]), declared: stored?.map((a) => a.name) ?? null, before: stored, stored };
  }
  const res = await fetch(input.url!, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  /* The production path, with a reader that only records what it was handed. */
  let handed: { records: OpeningRecord[]; declared: string[] } | null = null;
  const out = await runExtract({
    html: await res.text(),
    url: res.url,
    slug: "eval-front-matter",
    frontMatterAuthors: async (records, declared) => {
      handed = { records: [...records], declared: [...declared] };
      return null;
    },
  });
  const got = handed as { records: OpeningRecord[]; declared: string[] } | null;
  const stored = out.meta.authors ?? null;
  return {
    records: got?.records ?? [],
    declared: got?.declared ?? null,
    before: baseline.has(input.name) ? baseline.get(input.name)! : stored,
    stored,
  };
}

const results: unknown[] = [];
const totals: Record<string, { nanos: number; calls: number }> = {};
for (const input of INPUTS) {
  if (only && !only.split(",").some((o) => input.name.includes(o))) continue;
  let o: Opening;
  try {
    o = await opening(input);
  } catch (err) {
    console.log(`\n## ${input.name}: could not read (${(err as Error).message})`);
    results.push({ input, error: (err as Error).message });
    continue;
  }
  console.log(`\n## ${input.name} (${input.kind}) — ${o.records.length} records, ${o.records.reduce((n, r) => n + r.text.length, 0)} chars`);
  console.log("  before:");
  for (const l of show(o.before)) console.log(`    ${l}`);
  if (process.env.FM_DEBUG) for (const r of o.records.slice(0, 20)) console.log(`    [${r.id}] ${r.text.slice(0, 160)}`);
  const row: Record<string, unknown> = { input, today: o.before, declaredNames: o.declared, records: o.records.length };
  if (!o.declared) {
    console.log(`  not handed over: ${o.stored?.some((a) => a.affiliations.length) ? "the page declares affiliations" : "the page declares no authors"}`);
    row.skipped = true;
    results.push(row);
    continue;
  }
  for (const arm of arms) {
    const { model, route } = ARMS[arm];
    for (let d = 0; d < draws; d++) {
      let raw = "";
      const gateway: FrontMatterGateway = async (_job, body, options) => {
        const call = await openRouterJson(route, body, options);
        raw = String((call.json as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]?.message?.content ?? "");
        return call;
      };
      let verdict: FrontMatterVerdict | Error = new Error("not run");
      const t0 = Date.now();
      const { report } = await collectSpend(
        async () => {
          try {
            verdict = await readFrontMatterAuthors(o.records, o.declared!, { model, gateway });
          } catch (err) {
            verdict = err as Error;
          }
        },
        { attribution, sink },
      );
      const ms = Date.now() - t0;
      const spend = totalSpend(report.calls);
      totals[arm] = { nanos: (totals[arm]?.nanos ?? 0) + spend.nanos, calls: (totals[arm]?.calls ?? 0) + report.calls.length };
      const v = verdict as FrontMatterVerdict | Error;
      const tokens = report.calls.map((c) => `${c.inputTokens ?? "?"} in / ${c.outputTokens ?? "?"} out`).join(", ");
      const key = draws > 1 ? `${arm}#${d + 1}` : arm;
      console.log(`  ${key} (${formatNanos(spend.nanos)}, ${ms} ms, ${tokens}):`);
      if (v instanceof Error) console.log(`    ERROR ${v.message}`);
      else if (!v.authors) {
        console.log(`    refused: ${v.note}`);
        if (process.env.FM_DEBUG) console.log(`    answer: ${raw}`);
      } else for (const l of show(v.authors)) console.log(`    ${l}`);
      row[key] = v instanceof Error ? { error: v.message } : v;
      row[`${key}CostNanos`] = spend.nanos;
      row[`${key}Ms`] = ms;
    }
  }
  results.push(row);
}
console.log("\n## totals");
for (const [arm, t] of Object.entries(totals)) console.log(`  ${arm}: ${t.calls} calls, ${formatNanos(t.nanos)}, mean ${formatNanos(Math.round(t.nanos / Math.max(1, t.calls)))}`);
if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 2));
await closeDb();

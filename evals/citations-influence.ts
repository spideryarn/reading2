/**
 * **How often does the Citations list give a work an influence number, and is
 * the number the same twice?** Plan 261003m: influence becomes a number only
 * when the model is confident it knows the work, otherwise unknown.
 *
 *   npx tsx evals/citations-influence.ts stored [slug …]                          # free
 *   npx tsx evals/citations-influence.ts run --arm=before --run=1 <slug …>        # paid: one call an article
 *   npx tsx evals/citations-influence.ts compare --a=before-1 --b=before-2 <slug …>   # free
 *
 * **The arms are separated in time, not in code.** `run` calls production's own
 * `generateCitations` (src/citations.ts), the function the pipeline's
 * `citations` step calls, so it sends whatever prompt the checkout has: run
 * `before` on the commit before the prompt change and `after` on the commit
 * with it. Each result carries `PROMPT_VERSION` and a hash of `systemPrompt()`
 * so an arm run on the wrong commit shows.
 *
 * **What it writes.** Only files under `evals/results/citations-influence/`,
 * and never over one that is there. `generateCitations` returns the list and
 * stores nothing (the step's caller does the storing). Its one database write is
 * the `ai_calls` row each call records: `run` opens the ledger with `withLedger`
 * (docs/project/cost-tracking.md). The tokens are in the result file as well.
 *
 * **What `run` leaves out**: `previous` is null (it only decides which ids the
 * rows inherit, and ids are not measured), the registry lookup that follows the
 * list in the step (it does not touch a score), and the article's High-powered
 * AI setting: every run is `standard`.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import type { CitedWork } from "../src/types.js";
import type { NumberedReferenceList } from "../src/citation-reference-list.js";
import { firstAuthor, keyWords } from "../src/citations.js";

const OUT = path.join(import.meta.dirname, "results", "citations-influence");

/** Where `citations/5` told the model to put a work it does not know: "0.1". */
export const LOW = 0.15;

export interface ResultWork {
  title: string;
  authors: string | null;
  year: string | null;
  relevance: number | null;
  /** null: the row has no influence number (unknown, left out, or out of range). */
  influence: number | null;
  why: string;
}

export interface Result {
  slug: string;
  arm: string;
  run: number;
  promptVersion: string;
  systemPromptSha256: string;
  model: string;
  at: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  works: ResultWork[];
}

export function toResultWork(w: CitedWork): ResultWork {
  return {
    title: w.title,
    authors: w.authors ?? null,
    year: w.year ?? null,
    relevance: w.relevance ?? null,
    influence: w.influence ?? null,
    why: w.why,
  };
}

/** Ten 0.1-wide buckets; 1.0 goes in the last. A float just under a boundary (0.3 = 0.29999…) is nudged up. */
export function histogram(values: readonly number[]): number[] {
  const buckets = new Array<number>(10).fill(0);
  for (const v of values) {
    const i = Math.min(9, Math.max(0, Math.floor(v * 10 + 1e-9)));
    buckets[i] = (buckets[i] ?? 0) + 1;
  }
  return buckets;
}

export interface Tally {
  rows: number;
  known: number;
  unknown: number;
  low: number;
  buckets: number[];
}

export function tally(influences: readonly (number | null | undefined)[]): Tally {
  const known = influences.filter((v): v is number => typeof v === "number");
  return {
    rows: influences.length,
    known: known.length,
    unknown: influences.length - known.length,
    low: known.filter((v) => v <= LOW + 1e-9).length,
    buckets: histogram(known),
  };
}

const BUCKET_LABELS = ["0.0", "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9+"];

function tallyLine(name: string, t: Tally): string {
  return [name, t.rows, t.known, t.unknown, t.low, ...t.buckets].join("\t");
}

export interface Pairing {
  pairs: { a: ResultWork; b: ResultWork; by: "title" | "author-year" }[];
  onlyA: ResultWork[];
  onlyB: ResultWork[];
}

/** One-to-one matches on `key`; a key either side has twice, or a row with no key, pairs with nothing. */
function pairBy(
  a: readonly ResultWork[],
  b: readonly ResultWork[],
  key: (w: ResultWork) => string,
): { pairs: { a: ResultWork; b: ResultWork }[]; onlyA: ResultWork[]; onlyB: ResultWork[] } {
  const index = (rows: readonly ResultWork[]) => {
    const m = new Map<string, ResultWork[]>();
    for (const r of rows) if (key(r)) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const [ia, ib] = [index(a), index(b)];
  const pairs: { a: ResultWork; b: ResultWork }[] = [];
  for (const [k, ra] of ia) {
    const rb = ib.get(k) ?? [];
    if (ra.length === 1 && rb.length === 1) pairs.push({ a: ra[0]!, b: rb[0]! });
  }
  const [usedA, usedB] = [new Set(pairs.map((p) => p.a)), new Set(pairs.map((p) => p.b))];
  return { pairs, onlyA: a.filter((w) => !usedA.has(w)), onlyB: b.filter((w) => !usedB.has(w)) };
}

/**
 * Rows of two sets paired, first by `keyWords(title)`, then, among what is
 * left, by first author and year. The second pass is there because an article
 * that gives no title gets one written by the model ("Wang et al 2018" in one
 * run, "Wang et al. 2018 (meta-reinforcement learning)" in the next). It can
 * pair two different works by one author in one year, when each run lists only
 * one of them, so the table says which rule paired each row.
 */
export function pairRows(a: readonly ResultWork[], b: readonly ResultWork[]): Pairing {
  const byTitle = pairBy(a, b, (w) => keyWords(w.title));
  const byAuthor = pairBy(byTitle.onlyA, byTitle.onlyB, (w) =>
    w.authors && w.year ? `${keyWords(firstAuthor(w.authors))}|${keyWords(w.year)}` : "",
  );
  return {
    pairs: [
      ...byTitle.pairs.map((p) => ({ ...p, by: "title" as const })),
      ...byAuthor.pairs.map((p) => ({ ...p, by: "author-year" as const })),
    ],
    onlyA: byAuthor.onlyA,
    onlyB: byAuthor.onlyB,
  };
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? Number.NaN : xs.reduce((x, y) => x + y, 0) / xs.length;
}

function fmt(v: number | null): string {
  return v === null ? "unknown" : v.toFixed(2);
}

function flag(args: readonly string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function resultPath(set: string, slug: string): string {
  return path.join(OUT, `${set}-${slug}.json`);
}

/* -------------------------------------------------------------- stored -- */

async function stored(slugs: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const store = await import("../src/store/index.js");
  const { closeDb } = await import("../src/db/client.js");
  const { CitationsListNotFound } = await import("../src/store/citations-list-not-found.js");

  await runAsOwner(environmentOwnerId(), async () => {
    if (slugs.length === 0) slugs = (await store.listArticles()).map((a) => a.slug);
    console.log(["slug", "rows", "with number", "without", `<=${LOW}`, ...BUCKET_LABELS, "version"].join("\t"));
    const all: (number | undefined)[] = [];
    let lists = 0;
    for (const slug of slugs) {
      /* Only "no list was made" is skipped; a failed read must not print as an empty corpus. */
      let citations: Awaited<ReturnType<typeof store.loadCitations>>;
      try {
        citations = await store.loadCitations(slug);
      } catch (err) {
        if (err instanceof CitationsListNotFound) continue;
        throw err;
      }
      const works = citations.citations.citations;
      if (works.length === 0) continue;
      lists++;
      const influences = works.map((w) => w.influence);
      all.push(...influences);
      console.log(`${tallyLine(slug, tally(influences))}\t${citations.citations.version}`);
    }
    if (lists === 0) console.log("(no stored citations list among these articles)");
    else console.log(tallyLine(`ALL (${lists} lists)`, tally(all)));
  });
  await closeDb();
}

/* ----------------------------------------------------------------- run -- */

async function run(arm: string, n: number, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const store = await import("../src/store/index.js");
  const { closeDb } = await import("../src/db/client.js");
  const { generateCitations, systemPrompt, PROMPT_VERSION } = await import("../src/citations.js");
  const { withLedger } = await import("../src/cli-ledger.js");

  /* Refuse before spending anything, not after the first article. */
  const existing = slugs.map((s) => resultPath(`${arm}-${n}`, s)).filter((f) => fs.existsSync(f));
  if (existing.length > 0) {
    throw new Error(`refusing to overwrite:\n${existing.map((f) => `  ${path.relative(process.cwd(), f)}`).join("\n")}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const systemPromptSha256 = createHash("sha256").update(systemPrompt()).digest("hex");

  /* The ledger closes, and its writes land, before `closeDb` below. */
  await withLedger("eval", () => runAsOwner(environmentOwnerId(), async () => {
    for (const slug of slugs) {
      const out = resultPath(`${arm}-${n}`, slug);
      const article = await store.loadArticle(slug);
      /* A PDF's reference list, read the way src/pipeline.ts § pdfReferenceList reads it. */
      let referenceList: NumberedReferenceList | null = null;
      if (article.meta?.source === "pdf") {
        const source = await store.loadSource(slug);
        if (source !== null && source.kind === "pdf") {
          const { pass0, pageLines } = await import("../src/pdf.js");
          const { MAX_PAGES } = await import("../src/uploads.js");
          const { referenceListFrom } = await import("../src/citation-reference-list.js");
          const pass = await pass0(source.bytes, { maxPages: MAX_PAGES });
          if (!pass.isScan) referenceList = referenceListFrom(pass.pages.flatMap((p) => pageLines(pass, p.page)));
        }
      }
      console.log(`${arm}-${n}: ${slug} (${PROMPT_VERSION}, prompt ${systemPromptSha256.slice(0, 12)}, ${article.blocks.length} blocks)`);
      const result = await generateCitations({ article: { ...article, slug }, previous: null, power: "standard", referenceList });
      const record: Result = {
        slug,
        arm,
        run: n,
        promptVersion: PROMPT_VERSION,
        systemPromptSha256,
        model: result.model,
        at: new Date().toISOString(),
        tokens: {
          input: result.inputTokens,
          output: result.outputTokens,
          cacheRead: result.cacheReadTokens,
          cacheWrite: result.cacheWriteTokens,
        },
        works: result.citations.citations.map(toResultWork),
      };
      /* `wx`: a file that arrived since the check above is still not overwritten. */
      fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
      const t = tally(record.works.map((w) => w.influence));
      console.log(
        `  wrote ${path.relative(process.cwd(), out)}: ${t.rows} rows, ${t.known} with a number, ${t.unknown} without; ` +
          `${result.model}, ${result.inputTokens} in, ${result.outputTokens} out, ${Math.round(result.elapsedMs / 1000)}s`,
      );
    }
  }));
  await closeDb();
}

/* ------------------------------------------------------------- compare -- */

function readResult(set: string, slug: string): Result {
  return JSON.parse(fs.readFileSync(resultPath(set, slug), "utf8")) as Result;
}

function compare(setA: string, setB: string, slugs: string[]): void {
  const diffs: number[] = [];
  const total = { paired: 0, byTitle: 0, onlyA: 0, onlyB: 0, both: 0, flipToUnknown: 0, flipToKnown: 0, bothUnknown: 0 };
  const allA: (number | null)[] = [];
  const allB: (number | null)[] = [];
  for (const slug of slugs) {
    const [a, b] = [readResult(setA, slug), readResult(setB, slug)];
    console.log(`\n== ${slug} ==`);
    console.log(`a ${setA}: ${a.promptVersion} prompt ${a.systemPromptSha256.slice(0, 12)} ${a.model} ${a.at}`);
    console.log(`b ${setB}: ${b.promptVersion} prompt ${b.systemPromptSha256.slice(0, 12)} ${b.model} ${b.at}`);
    console.log(["set", "rows", "with number", "without", `<=${LOW}`, ...BUCKET_LABELS].join("\t"));
    console.log(tallyLine("a", tally(a.works.map((w) => w.influence))));
    console.log(tallyLine("b", tally(b.works.map((w) => w.influence))));
    allA.push(...a.works.map((w) => w.influence));
    allB.push(...b.works.map((w) => w.influence));

    const { pairs, onlyA, onlyB } = pairRows(a.works, b.works);
    const byTitle = pairs.filter((p) => p.by === "title").length;
    const both = pairs.filter((p) => p.a.influence !== null && p.b.influence !== null);
    const here = both.map((p) => Math.abs(p.a.influence! - p.b.influence!));
    const toUnknown = pairs.filter((p) => p.a.influence !== null && p.b.influence === null).length;
    const toKnown = pairs.filter((p) => p.a.influence === null && p.b.influence !== null).length;
    diffs.push(...here);
    total.paired += pairs.length;
    total.onlyA += onlyA.length;
    total.onlyB += onlyB.length;
    total.byTitle += byTitle;
    total.both += both.length;
    total.flipToUnknown += toUnknown;
    total.flipToKnown += toKnown;
    total.bothUnknown += pairs.length - both.length - toUnknown - toKnown;
    console.log(
      `paired ${pairs.length} (${byTitle} by title, ${pairs.length - byTitle} by first author and year); only in a ${onlyA.length}; only in b ${onlyB.length}; ` +
        `both numbers ${both.length}, mean |a-b| ${mean(here).toFixed(3)}, max ${here.length ? Math.max(...here).toFixed(2) : "-"}; ` +
        `number in a, unknown in b ${toUnknown}; unknown in a, number in b ${toKnown}`,
    );
    /* Every row, to be read by hand: highest influence first, unknown last. */
    const rows = [
      ...pairs.map((p) => ({ w: p.a, a: p.a.influence, b: p.b.influence, in: p.by === "title" ? "both" : `both (author-year; b: ${p.b.title})` })),
      ...onlyA.map((w) => ({ w, a: w.influence, b: null as number | null, in: "a only" })),
      ...onlyB.map((w) => ({ w, a: null as number | null, b: w.influence, in: "b only" })),
    ].sort((x, y) => (y.a ?? y.b ?? -1) - (x.a ?? x.b ?? -1) || (y.b ?? -1) - (x.b ?? -1));
    console.log(["infl a", "infl b", "in", "year", "authors", "title"].join("\t"));
    for (const r of rows) {
      const ia = r.in === "b only" ? "-" : fmt(r.a);
      const ib = r.in === "a only" ? "-" : fmt(r.b);
      console.log([ia, ib, r.in, r.w.year ?? "", r.w.authors ?? "", r.w.title].join("\t"));
    }
  }
  console.log(`\n== ALL (${slugs.length} articles) ==`);
  console.log(["set", "rows", "with number", "without", `<=${LOW}`, ...BUCKET_LABELS].join("\t"));
  console.log(tallyLine(`a ${setA}`, tally(allA)));
  console.log(tallyLine(`b ${setB}`, tally(allB)));
  console.log(
    `paired ${total.paired} (${total.byTitle} by title, ${total.paired - total.byTitle} by first author and year); only in a ${total.onlyA}; only in b ${total.onlyB}; ` +
      `both numbers ${total.both}, mean |a-b| ${mean(diffs).toFixed(3)}, ` +
      `differ by >=0.2: ${diffs.filter((d) => d >= 0.2 - 1e-9).length}; ` +
      `number in a, unknown in b ${total.flipToUnknown}; unknown in a, number in b ${total.flipToKnown}; unknown in both ${total.bothUnknown}`,
  );
}

/* ---------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const slugs = rest.filter((a) => !a.startsWith("--"));
  if (cmd === "stored") {
    await stored(slugs);
  } else if (cmd === "run") {
    const arm = flag(rest, "arm");
    const n = Number(flag(rest, "run"));
    if (!arm || !/^[a-z]+$/.test(arm)) throw new Error("run needs --arm=<letters>, for example --arm=before");
    if (!Number.isInteger(n) || n < 1) throw new Error("run needs --run=<n>, a whole number from 1");
    if (slugs.length === 0) throw new Error("run needs at least one slug");
    await run(arm, n, slugs);
  } else if (cmd === "compare") {
    const [a, b] = [flag(rest, "a"), flag(rest, "b")];
    if (!a || !b) throw new Error("compare needs --a=<arm>-<run> --b=<arm>-<run>");
    if (slugs.length === 0) throw new Error("compare needs at least one slug");
    compare(a, b, slugs);
  } else {
    throw new Error("usage: citations-influence.ts stored [slug …] | run --arm=<name> --run=<n> <slug …> | compare --a=<arm>-<run> --b=<arm>-<run> <slug …>");
  }
}

if (isMain(import.meta.url)) await main();

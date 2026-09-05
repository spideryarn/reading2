/**
 * **How many blocks is the corpus, and which pipeline said so?** — no model, no
 * money, no network.
 *
 *   npx tsx evals/extraction/block-census.mts
 *   npx tsx evals/extraction/block-census.mts --cut pre-0904
 *   npx tsx evals/extraction/block-census.mts --dump out.json
 *
 * This exists because a denominator got published that nobody could reproduce.
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § A
 * quoted "11,614 blocks" over the 21-fixture cut; the script that produced it
 * was thrown away, and GPT Sol, re-counting, got 11,518 or 11,558 depending on
 * where it cut into the pipeline. All three numbers are honest and all three are
 * different, and the two axes below are the whole of the difference:
 *
 * | | `article.content` | `runExtract` |
 * |---|---|---|
 * | `CORPUS`, 20 | 11,518 | 11,558 |
 * | `pre-0904`, 21 | 11,614 | **11,656** |
 *
 * Sol counted `CORPUS` and the claim was over `ALL_FIXTURES` as it then stood,
 * one fixture more; the original 11,614 had the right 21 and the wrong route.
 * **A block count is not a property of the corpus, it is a property of the
 * corpus and a route through stage 2**, so a number quoted without its route is
 * not a measurement.
 *
 * ## The route this takes, and why it is the only one worth quoting
 *
 * `runExtract` → `runBlocks` ([src/extract.ts](../../src/extract.ts),
 * [src/blocks.ts](../../src/blocks.ts)), the two shipping stages themselves,
 * imported rather than re-derived. That matters more than it looks:
 *
 * - `readArticle` runs `prepareDocument` first — un-hiding, notes, callouts —
 *   and an instrument that skips it measures a document the pipeline never sees
 *   (`prepareDocument`'s own header is about the two evals that did exactly
 *   that).
 * - `runExtract` then wraps Readability's output in `debugPage`, which adds an
 *   `<h1>` and a `.meta` line. Stage 3 splits *that*, not `article.content`, so
 *   the shipping count is about two blocks per fixture above a count taken off
 *   `article.content` — which is where 11,518 and 11,558 part company.
 *   [probe.mts](probe.mts) splits `article.content` deliberately, because it is
 *   sizing up a candidate page rather than counting the article as stored.
 *
 * So: **quote the `runExtract → runBlocks` number**, and say so beside it.
 *
 * ## Why there is a `--cut`
 *
 * The corpus grew from 21 fixtures to 35 during 260904e, and figures published
 * against the 21 have to stay checkable after the growth. The cuts below are
 * named by the day they closed and listed by name, not by "the first 21", so
 * inserting a fixture in the middle of `CORPUS` breaks the run loudly instead of
 * quietly renaming what an old number was over.
 *
 * ## `--dump`, which is how a before-and-after gets made
 *
 * A count answers "how many"; the claim that goes with it in 260904e is "545
 * code blocks changed and 0 non-code blocks changed", which needs two runs of
 * different code over the same fixtures. `--dump` writes every block's tag,
 * kind, `gistable` and text, so the comparison is a diff of two files rather
 * than a script that has to be believed:
 *
 *   git archive HEAD | tar -x -C /tmp/before && ln -s "$PWD/node_modules" /tmp/before/
 *   (cd /tmp/before && npx tsx evals/extraction/block-census.mts --cut pre-0904 --dump /tmp/b.json)
 *   npx tsx evals/extraction/block-census.mts --cut pre-0904 --dump /tmp/a.json
 *
 * Which compares the working tree against the last commit — the whole change,
 * not one function of it, and that is the honest unit for "what landed".
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_FIXTURES } from "./corpus.mjs";
import { ReadabilityRefused, runExtract } from "../../src/extract.js";
import { runBlocks } from "../../src/blocks.js";
import { isMain } from "../../src/is-main.js";

/**
 * **The 21 fixtures that existed before stage B's fourteen landed**, taken from
 * `ALL_FIXTURES` at commit f1fff252 — the last one before `32fa7e9f` ("Nine
 * pages the corpus had no instance of") and `57cf410c` ("Five more, attributed,
 * on Greg's call"). Reconstruct it with
 * `git show f1fff252:evals/extraction/corpus.mts`.
 *
 * Written out rather than computed, because the whole point of a cut is that it
 * does not move when the corpus does.
 */
const CUTS: Record<string, readonly string[] | null> = {
  /** Everything committed today, whatever that is. */
  all: null,
  "pre-0904": [
    "pg-greatwork", "man-open", "rfc9110", "whatwg-parsing", "wikipedia-transformer",
    "ar5iv-attention", "arxiv-abs", "aaronson", "acx", "gwern-scaling", "tufte-css",
    "mdn-cache-control", "gutenberg-pride", "cornell-17-107", "constitution",
    "mkdocs-tabs", "whitman-leaves", "hacker-howto", "mactutor-turing",
    "shakespeare-hamlet", "acx-footnotes",
  ],
};

export interface CensusRow {
  name: string;
  /** Blocks stage 3 produces from stage 2's `extractedHtml`. */
  blocks: number;
  /** Of those, the `<pre>` blocks — the population `codeText` changed. */
  code: number;
  /** Readability declined the page, so there is nothing to count. */
  refused: boolean;
}

/** One fixture, all the way through both shipping stages. */
export async function censusOf(
  name: string,
  rawHtml: string,
  url: string,
): Promise<{ row: CensusRow; blocks: { tag: string; kind: string; gistable: boolean; text: string }[] }> {
  let extractedHtml: string;
  try {
    ({ extractedHtml } = await runExtract({ html: rawHtml, url, slug: name }));
  } catch (err) {
    if (err instanceof ReadabilityRefused) {
      return { row: { name, blocks: 0, code: 0, refused: true }, blocks: [] };
    }
    throw err;
  }
  /* `previous: undefined` is the genuine-first-ingest case, which is what a
     census is: nothing is being carried, so no id churn is being measured here
     and `assertIdsCarried` has nothing to say. */
  const { blocks } = runBlocks({ slug: name, extractedHtml, previous: undefined });
  return {
    row: {
      name,
      blocks: blocks.length,
      code: blocks.filter((b) => b.tag === "pre").length,
      refused: false,
    },
    blocks: blocks.map((b) => ({ tag: b.tag, kind: b.kind, gistable: b.gistable, text: b.text })),
  };
}

async function main(): Promise<void> {
  const cutAt = process.argv.indexOf("--cut");
  const cutName = cutAt === -1 ? "all" : process.argv[cutAt + 1] ?? "all";
  const names = CUTS[cutName];
  if (names === undefined) {
    console.error(`Unknown cut "${cutName}". Known: ${Object.keys(CUTS).join(", ")}`);
    process.exit(1);
  }
  const chosen = names === null
    ? ALL_FIXTURES
    : names.map((n) => {
        const entry = ALL_FIXTURES.find((f) => f.name === n);
        /* A cut naming a fixture that is no longer committed is a silent
           shrinkage of somebody's published denominator, so it stops the run. */
        if (!entry) throw new Error(`cut "${cutName}" names ${n}, which is not in ALL_FIXTURES`);
        return entry;
      });

  const dumpAt = process.argv.indexOf("--dump");
  const dir = path.join("evals", "extraction", "fixtures");
  const rows: CensusRow[] = [];
  const dump: Record<string, { tag: string; kind: string; gistable: boolean; text: string }[]> = {};

  console.log(`cut: ${cutName} (${chosen.length} fixtures), route: runExtract → runBlocks\n`);
  console.log("fixture".padEnd(24) + "  blocks    pre");
  for (const entry of chosen) {
    const raw = await readFile(path.join(dir, entry.file), "utf-8");
    const { row, blocks } = await censusOf(entry.name, raw, entry.url);
    rows.push(row);
    dump[entry.name] = blocks;
    console.log(
      entry.name.padEnd(24) +
        `  ${String(row.blocks).padStart(6)}` +
        `  ${String(row.code).padStart(5)}` +
        (row.refused ? "  (refused)" : ""),
    );
  }

  const total = rows.reduce((n, r) => n + r.blocks, 0);
  const code = rows.reduce((n, r) => n + r.code, 0);
  const refused = rows.filter((r) => r.refused);
  console.log(
    `\n${chosen.length} fixtures, ${total} blocks, ${code} of them <pre>` +
      (refused.length === 0 ? "." : `; ${refused.length} refused: ${refused.map((r) => r.name).join(", ")}.`),
  );

  if (dumpAt !== -1) {
    const out = process.argv[dumpAt + 1]!;
    await writeFile(out, `${JSON.stringify(dump, null, 2)}\n`, "utf-8");
    console.log(`\nPer-block dump written to: ${path.resolve(out)}`);
  }
}

if (isMain(import.meta.url)) await main();

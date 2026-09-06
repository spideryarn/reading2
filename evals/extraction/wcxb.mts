/**
 * **The blind holdout: WCXB, verified rather than believed.**
 *
 *   WCXB_DIR=/path/to/extracted/archive npx tsx evals/extraction/wcxb.mts
 *
 * To **reproduce** the committed `evals/results/wcxb-holdout-selection.json`
 * rather than make a new one, pass the date it already records — everything else
 * about the output is a pure function of the archive, the seed and the fixture
 * list:
 *
 *   WCXB_DIR=… WCXB_SELECTED_ON=2026-09-05 npx tsx evals/extraction/wcxb.mts
 *
 * ## Why a holdout at all, and why not from the trawl
 *
 * The 52 pages the trawl fetched have been read, and the recognisers, fixtures
 * and manifests in this directory were designed against their failures. Hashing
 * a split of them proves integrity, not blindness. So the holdout has to come
 * from somewhere nobody here has looked — which was GPT Sol's finding on
 * [260904e](../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md),
 * and is the difference between a holdout and a second dev set.
 *
 * ## What it actually is — checked, 2026-09-05
 *
 * Every claim below was verified against the record and the downloaded archive,
 * not taken from the subagent that proposed the dataset.
 *
 * | claim | verdict |
 * |---|---|
 * | real, on Zenodo | **true** — DOI `10.5281/zenodo.19316874`, published 2026-03-29, repo `Murrough-Foley/web-content-extraction-benchmark` at tag `v1.0` |
 * | CC-BY-4.0 | **true** — Zenodo metadata says `cc-by-4.0`, and the repo's own `LICENSE` agrees |
 * | 2,008 pages | **true** — counted: 1,497 in `dev/ground-truth/`, 511 in `test/ground-truth/` |
 * | ships gzipped HTML | **true** — one `<id>.html.gz` per record; `dev/html/0001.html.gz` decompresses to a 220,740-byte page |
 * | ~84 MB | **true** — 84,289,810 bytes |
 * | the six-field schema | **partly** — the six fields exist, **nested under `ground_truth`**, alongside `schema_version`, `url`, `file_id`, `_internal.page_type` and an undocumented `main_content_markdown`. See `WcxbRecord` |
 * | Readability dev F1 = 0.674 | **false** — the README's table says **0.675** (precision 0.685, recall 0.713), and 0.726 on the held-out test split |
 * | it is also called *WCEB* | **unsupported** — fetched 2026-09-05, the repo README (`WCXB: Web Content eXtraction Benchmark`), its BibTeX key (`foley2026wcxb`) and the Zenodo record title all say **WCXB** and the string `WCEB` appears in none of them. An earlier note here claimed the README, the citation and `metadata.json` said WCEB; two thirds of that is now checked and false, and `metadata.json` lives inside the uncommitted archive so nobody here can check the rest. The claim is dropped rather than narrowed to the one artefact nobody can open. Cite the DOI. |
 *
 * **And 0.675 does not reconcile with the 0.825 in
 * [260827ab](../../docs/plans/260827ab-readability-repair-pass.md), which is fine
 * and is not a contradiction:** they are different quantities over different
 * pages. 260827ab measured retention of a page's own text on three hand-picked
 * fixtures; this is a boilerplate-removal F1 over 1,497 mixed pages, about half
 * of which are not articles at all. Neither number transfers to the other, and
 * quoting one as a check on the other would be the error this plan is named
 * after. Both are recorded so the next person does not try.
 *
 * ## Five things that make it weaker than it looks, all of them stated
 *
 * 1. **Its gold is plain text.** `main_content` is a string, so it can score
 *    **text selection only** — nothing about tables, headings, code or order.
 *    `Gold.covers` carries `"text-selection-only"` for exactly this, and any
 *    number quoted from it has to carry the same sentence.
 * 2. **It is not article-only.** About 53% of dev and 50% of test are labelled
 *    `article`; the rest are forum, product, listing, documentation and service
 *    pages. `selectHoldout` keeps articles.
 * 3. **The ground truth was drafted by Claude and then reviewed by a person**,
 *    per the README's own methodology section. Spideryarn's pipeline is also
 *    Claude-shaped, so a correlated blind spot is possible and a good score here
 *    is weaker evidence than a good score from an independent annotator.
 * 4. **One author, published 2026-03-29, not peer reviewed**, and the archive
 *    ships raw per-page results for one baseline only (`rs-trafilatura`). The
 *    baseline table is a self-report.
 * 5. **It overlaps this corpus — but only in `dev`.** One WCXB URL is
 *    byte-for-byte a fixture we already have
 *    (`docs.python.org/3/library/itertools.html`), and nine fixture hosts appear
 *    among its 1,613 domains. **Counted per split on 2026-09-05, all of that is
 *    in `dev` and none of it is in `test`**: `wiki.archlinux.org` 3/0,
 *    `docs.python.org` 5/0, `en.wikipedia.org` 3/0, `developer.mozilla.org` 9/0,
 *    `arxiv.org` 2/0, `news.ycombinator.com` 2/0, `man7.org` 1/0, and
 *    `quantamagazine.org` and `npr.org` in neither. The filters below run
 *    regardless — a dataset can gain a page — but the reason the recorded
 *    selection excludes nothing is that there was nothing in `test` to exclude,
 *    not that the check was skipped.
 *
 * ## The rule that makes it a holdout rather than a second dev set
 *
 * **Select before looking; no per-page feedback until the thresholds are
 * frozen.** The selection is made by this file, from a seed, and written to
 * `evals/results/wcxb-holdout-selection.json`. What a person may do afterwards is
 * run the whole selection once and read the aggregate. Opening a page that scored
 * badly, deciding it was mislabelled and dropping it is how a holdout becomes a
 * dev set, and it does so invisibly.
 *
 * **The custodian ceremony was dropped on 2026-09-05, in favour of a separate
 * agent as the isolation** (Greg). A name in a JSON file is a promise, and the
 * thing it exists to prevent is invisible when it happens. So the holdout is run
 * **by its own subagent**, which reports aggregate pass/fail plus catastrophic
 * per-article regressions and nothing else; the agent tuning stage C never
 * receives per-page output. The honest limit, said rather than glossed: **the
 * orchestrator sits between them**, so this is structural for the agents and a
 * discipline for the human. Better than a name in a file, and not a guarantee.
 * `custodian` below is now the record of *who is answerable*, not a mechanism.
 *
 * **And the split is checked rather than asserted.** `opts.split` used to be a
 * label copied into the output; `readSplit` now stamps `_split` on every record
 * it reads and `selectHoldout` refuses a batch that disagrees, so a selection
 * that says `test` cannot be built out of `dev` pages. That claim, and every
 * other one in this file a test can reach, is in
 * [tests/extraction-wcxb.test.ts](../../tests/extraction-wcxb.test.ts). The one
 * it cannot reach is that the recorded 200 really are the top 200 of the real
 * `test` split — that needs the archive, and the archive is not committed. What
 * the test does instead is check the committed file against its own seed: 200
 * unique ids in this code's rank order, so a hand-edit shows up.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { isMain } from "../../src/is-main.js";
import { ALL_FIXTURES } from "./corpus.mjs";

export const WCXB = {
  doi: "10.5281/zenodo.19316874",
  zenodoRecord: 19316874,
  repo: "https://github.com/Murrough-Foley/web-content-extraction-benchmark",
  tag: "v1.0",
  licence: "CC-BY-4.0",
  archiveBytes: 84_289_810,
  pages: { dev: 1497, test: 511, total: 2008 },
  /** The author's own README table, quoted. Not independently recomputed. */
  selfReportedReadability: { devF1: 0.675, devPrecision: 0.685, devRecall: 0.713, testF1: 0.726 },
  verifiedOn: "2026-09-05",
} as const;

/** One record, as it really is — nested, not the flat shape that was claimed. */
export interface WcxbRecord {
  schema_version: string;
  url?: string;
  file_id: string;
  _internal?: { page_type?: { primary?: string; confidence?: string } };
  ground_truth: {
    title?: string;
    author?: string;
    publish_date?: string;
    /** **Plain text.** The reason this dataset scores text selection and nothing else. */
    main_content?: string;
    with?: string[];
    without?: string[];
    main_content_markdown?: string;
  };
}

/**
 * **A record that knows which split it came out of.**
 *
 * The file on disk does not say — the split is the directory it was read from —
 * so `readSplit` stamps it on the way past and `selectHoldout` refuses anything
 * that disagrees with the split it was asked for. Before this existed,
 * `opts.split` was a **label**: it was copied into the output and nothing
 * checked the records had come from there, so handing `dev` records to a call
 * that said `test` produced a file that claimed, in writing, to be a holdout.
 * GPT Sol's review of 260904e, 2026-09-05.
 *
 * The field is required here and optional nowhere, so forgetting to stamp is a
 * type error rather than a runtime one; the runtime check stays because JSON off
 * a disk can be any shape and a cast is one keystroke.
 */
export interface WcxbRecordInSplit extends WcxbRecord {
  _split: "dev" | "test";
}

export interface HoldoutSelection {
  dataset: typeof WCXB;
  /** The seed, so the selection can be reproduced without trusting this file's output. */
  seed: string;
  split: "dev" | "test";
  /** Only pages the dataset itself labels `article`. */
  pageType: string;
  size: number;
  /**
   * **Who is answerable for it** — a record, not a mechanism. The mechanism is
   * that the holdout runs in its own agent; see the header. Before 2026-09-05
   * this field was the whole of the arrangement, which was a promise wearing a
   * mechanism's clothes.
   */
  custodian: string;
  selectedOn: string;
  /** What this selection can and cannot measure, carried with the selection. */
  scores: "text-selection-only";
  excluded: {
    /** Fixture URLs found verbatim in the dataset. */
    exactUrlOverlap: string[];
    /** Fixture hosts found in the dataset. A template is what gets designed against. */
    hostOverlap: string[];
    nonArticle: number;
    noUrl: number;
  };
  chosen: { file_id: string; url: string; host: string }[];
}

const hostOf = (url: string): string => {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; }
};

/**
 * **The whole ordering, in one line, exported so it can be checked from outside.**
 *
 * The committed selection is only reproducible if a reader can recompute the
 * order it is in, and a test that reimplements this by hand would go on agreeing
 * with a file after the code had stopped producing it. So there is one
 * definition and both the selector and
 * [tests/extraction-wcxb.test.ts](../../tests/extraction-wcxb.test.ts) use it.
 */
export const holdoutRank = (seed: string, file_id: string): string =>
  createHash("sha256").update(`${seed}:${file_id}`).digest("hex");

/**
 * Deterministic, seeded, and **order-independent**: each record is ranked by a
 * hash of the seed and its own id, so the selection does not depend on the order
 * the directory happened to be read in. Re-running with the same seed on the
 * same archive gives the same pages, which is what makes the recorded selection
 * checkable by somebody who does not trust it.
 *
 * **Nothing here reads the clock or the filesystem.** `selectedOn` is passed in
 * — it used to be `new Date()`, which meant the recorded file could not be
 * reproduced on any day but the one it was made — so the whole output is a pure
 * function of `records`, `opts` and `ALL_FIXTURES`. Every claim in
 * [tests/extraction-wcxb.test.ts](../../tests/extraction-wcxb.test.ts) rests on
 * that.
 */
export function selectHoldout(
  records: WcxbRecordInSplit[],
  opts: {
    seed: string;
    size: number;
    split: "dev" | "test";
    custodian: string;
    /** `YYYY-MM-DD`. Supplied by the caller so re-running reproduces the file. */
    selectedOn: string;
  },
): HoldoutSelection {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.selectedOn)) {
    throw new Error(`selectedOn must be YYYY-MM-DD, got ${JSON.stringify(opts.selectedOn)}`);
  }
  for (const r of records) {
    if (r._split !== opts.split) {
      throw new Error(
        `record ${r.file_id} is from the ${JSON.stringify(r._split)} split, ` +
          `but this selection says ${JSON.stringify(opts.split)}. ` +
          "A holdout mixed with dev pages is not a holdout.",
      );
    }
  }

  const fixtureUrls = new Set(ALL_FIXTURES.map((f) => f.url));
  const fixtureHosts = new Set(ALL_FIXTURES.map((f) => hostOf(f.url)).filter(Boolean));

  const exactUrlOverlap: string[] = [];
  const hostOverlap = new Set<string>();
  let nonArticle = 0;
  let noUrl = 0;

  const eligible: { file_id: string; url: string; host: string }[] = [];
  for (const r of records) {
    if (!r.url) { noUrl += 1; continue; }
    if ((r._internal?.page_type?.primary ?? "") !== "article") { nonArticle += 1; continue; }
    if (fixtureUrls.has(r.url)) { exactUrlOverlap.push(r.url); continue; }
    const host = hostOf(r.url);
    if (fixtureHosts.has(host)) { hostOverlap.add(host); continue; }
    eligible.push({ file_id: r.file_id, url: r.url, host });
  }

  eligible.sort((a, b) =>
    holdoutRank(opts.seed, a.file_id).localeCompare(holdoutRank(opts.seed, b.file_id)),
  );

  return {
    dataset: WCXB,
    seed: opts.seed,
    split: opts.split,
    pageType: "article",
    size: Math.min(opts.size, eligible.length),
    custodian: opts.custodian,
    selectedOn: opts.selectedOn,
    scores: "text-selection-only",
    excluded: {
      /* Sorted, not in the order they were met: this list is provenance, and
         provenance that changes when the directory listing changes is one more
         thing a reader has to discount. `hostOverlap` was already sorted. */
      exactUrlOverlap: exactUrlOverlap.sort(),
      hostOverlap: [...hostOverlap].sort(),
      nonArticle,
      noUrl,
    },
    chosen: eligible.slice(0, opts.size),
  };
}

/**
 * Read the ground-truth JSONs out of an extracted archive.
 *
 * **The archive is not committed** — 84 MB of somebody else's pages, and the
 * thing that has to survive is the *selection*, not the bytes. Point `WCXB_DIR`
 * at the extracted repo directory (the one holding `dev/` and `test/`).
 */
export async function readSplit(dir: string, split: "dev" | "test"): Promise<WcxbRecordInSplit[]> {
  const gt = path.join(dir, split, "ground-truth");
  if (!existsSync(gt)) throw new Error(`no ${split}/ground-truth under ${dir}`);
  const files = (await readdir(gt)).filter((f) => f.endsWith(".json")).sort();
  const out: WcxbRecordInSplit[] = [];
  for (const f of files) {
    const raw = JSON.parse(await readFile(path.join(gt, f), "utf-8")) as WcxbRecord;
    /* At least one of the 2,008 records is missing `url` outright and carries a
       `page_type` the documented taxonomy does not have, so nothing here may
       assume the shape holds. It is skipped by `selectHoldout` and counted. */
    out.push({ ...raw, file_id: raw.file_id ?? f.replace(/\.json$/, ""), _split: split });
  }
  return out;
}

/** The seed and the size, written down so the selection is not a private act. */
export const HOLDOUT = {
  seed: "spideryarn-260904e-stageB",
  size: 200,
  split: "test" as const,
  /**
   * The **test** split, not `dev`. The author's own baseline table reports dev
   * numbers, so dev is the split their own tuning saw; `test` is the one they
   * held out, and it stays held out here too.
   */
  custodian:
    "Greg Detre — answerable for the frozen thresholds. The isolation is a separate agent, " +
    "not this line: see the header, and 260904e § B.",
};

const OUT = path.join("evals", "results", "wcxb-holdout-selection.json");

async function main(): Promise<void> {
  const dir = process.env["WCXB_DIR"];
  if (!dir) {
    console.error(
      "WCXB_DIR is not set. Point it at the extracted archive (the directory holding dev/ and test/).\n" +
        `Get it from https://zenodo.org/records/${WCXB.zenodoRecord} — ${WCXB.archiveBytes} bytes, ${WCXB.licence}.\n` +
        "The archive is deliberately not committed; the selection is.",
    );
    process.exitCode = 1;
    return;
  }
  const records = await readSplit(dir, HOLDOUT.split);
  /* The one clock reading in the file, and it is here rather than inside
     `selectHoldout` so that re-running the selection against the same archive
     with the same seed reproduces the committed JSON byte for byte — pass the
     recorded `selectedOn` back in and it does. */
  const selectedOn = process.env["WCXB_SELECTED_ON"] ?? new Date().toISOString().slice(0, 10);
  const selection = selectHoldout(records, { ...HOLDOUT, selectedOn });
  console.log(
    `${records.length} records in ${HOLDOUT.split}; ` +
      `${selection.excluded.nonArticle} not articles, ` +
      `${selection.excluded.noUrl} with no url, ` +
      `${selection.excluded.exactUrlOverlap.length} exact URL overlap(s) with our fixtures, ` +
      `${selection.excluded.hostOverlap.length} host(s) excluded.`,
  );
  console.log(`Chose ${selection.chosen.length} with seed "${selection.seed}".`);
  console.log(
    "This selection scores TEXT SELECTION ONLY — its gold is plain text and cannot say " +
      "anything about tables, headings, code or order.",
  );
  await writeFile(OUT, `${JSON.stringify(selection, null, 2)}\n`, "utf-8");
  console.log(`Written to ${OUT}`);
}

if (isMain(import.meta.url)) await main();

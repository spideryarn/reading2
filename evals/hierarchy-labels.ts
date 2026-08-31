/**
 * Eval — are batched nav labels as good as whole-pass ones?
 *
 *   npm run eval:hierarchy -- data/constitution data/noema-mythology-of-conscious-ai
 *
 * Reads artefacts that already exist and calls no model, so it is cheap to
 * re-run and can be pointed at an old tree as easily as a new one. See
 * evals/README.md for what each measure is a proxy for, and
 * docs/plans/260826h-toc-scaling.md for the design it exists to judge.
 *
 * Everything here is mechanical. None of it decides whether a label is *good*;
 * each one is a proxy for a specific way the split could go wrong. The direct
 * test needs a person — `--shuffle` prints the sets for it.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Block, Tree } from "../src/types.js";
import { contentWords, type LabelsFile } from "../src/labels.js";
import { isMain } from "../src/is-main.js";

/* `contentWords` comes from the stage itself rather than being defined again
   here. src/labels.ts uses it to *refuse* a batch whose labels match the
   neighbouring paragraphs better than their own; this file uses it to *measure*
   how much of the author's vocabulary survived. A measure that disagreed with
   its own gate would be worse than no measure. */

/** True for a block whose label is required to be its heading, copied exactly. */
function isHeading(block: Block): boolean {
  return /^h[1-6]$/.test(block.tag);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The first two words, lower-cased — how a formula announces itself. */
function openingBigram(text: string): string {
  return text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

interface Labelled {
  blockId: string;
  label: string;
  block: Block;
  /** Which model call wrote it, or null when the tree came from one whole pass. */
  batch: number | null;
  /** True when this block starts a new sibling set — a section boundary. */
  startsSet: boolean;
}

export interface EvalReport {
  slug: string;
  blocks: number;
  gistable: number;
  labelled: number;
  /**
   * labelled / gistable. Below 1 is a bug **unless `dropped` accounts for it**.
   *
   * It used to be a bug full stop, and that stopped being true on 2026-08-30
   * when src/labels.ts gained a bounded partial accept. A repair inside the code
   * under measurement silently redefines the measurement, so the measurement was
   * told: the stage records which blocks it gave up on, and this eval reads
   * them rather than inferring a fault from a number it can no longer interpret
   * on its own. See `LabelRun.dropped` and
   * docs/plans/260830am-faster-ingest-and-concurrency.md § Stage 1b.
   */
  coverage: number;
  /**
   * Blocks the label pass gave up on, as `labels.json` records them.
   *
   * `null` for a file written before the field existed — which is not the same
   * as zero, and the print below says so rather than reporting an old article as
   * having dropped nothing.
   */
  dropped: number | null;
  /**
   * Gistable blocks with no label that `labels.json` does **not** account for —
   * the ids, not a count, and that is the whole of this field.
   *
   * It was `gistable - labelled - dropped.length`, which asks whether the two
   * numbers add up and never whether they are about the same blocks. A `dropped`
   * list of the right length naming the wrong ids — a stale file, a run whose
   * drops were recorded from the wrong batch, an id that got sorted into the
   * list twice — reported everything accounted for while the reader was missing
   * a row somewhere else entirely. The producer's count was being trusted to
   * measure the producer. GPT Sol's review of stage 1, 2026-08-31, finding 8.
   */
  unexplained: string[];
  /**
   * Blocks `labels.json` says were dropped which **do** have a label.
   *
   * The other half of the same set comparison, and it costs nothing to compute.
   * A drop that is not a drop means the list and the labels were written from
   * different states — the subtraction above could not see it either, because
   * one phantom drop and one genuinely missing block cancel exactly.
   */
  phantomDrops: string[];
  batched: boolean;
  batches: number;
  length: { mean: number; min: number; max: number; outsideRange: number };
  /** Labels whose block is a heading — excluded from `length` and `vocabularyRetention`. */
  headings: number;
  /** Share of labels whose opening two words are shared with another label. */
  templateRepetition: number;
  /** Mean share of a label's content words that appear in its own block. */
  vocabularyRetention: number;
  seam: SeamReport | null;
  cost: { inputTokens: number; outputTokens: number; slowestBatchMs: number } | null;
  /** Do tree.json and labels.json say the same thing? null when there is no labels.json. */
  treeAgreesWithLabels: boolean | null;
}

export interface SeamReport {
  /** Adjacent labels whose blocks were in different calls. */
  seamPairs: number;
  /** Adjacent labels across a sibling-set boundary inside one call — the control. */
  interiorPairs: number;
  /** Content-word overlap. Two labels that read alike score high. */
  seamSimilarity: number;
  interiorSimilarity: number;
  /** Share of pairs opening with the same two words. */
  seamSameOpening: number;
  interiorSameOpening: number;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf-8")) as T;
}

async function readJsonIfPresent<T>(file: string): Promise<T | null> {
  try {
    return await readJson<T>(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Line the labels up with their blocks, in document order, tagged with which
 * call wrote each one and whether it opens a sibling set.
 *
 * A tree written before the split has no `labels.json`, so every label gets
 * `batch: null` and the seam test is skipped rather than faked. That is what
 * makes today's whole-pass trees usable as the incumbent.
 */
function collect(tree: Tree, blocks: Block[], labelsFile: LabelsFile | null): Labelled[] {
  const labelFor = new Map<string, string>();
  for (const node of Object.values(tree.nodes)) {
    if (node.children.length === 0 && node.navLabel) labelFor.set(node.range[0], node.navLabel);
  }

  const batchOf = new Map<string, number>();
  const setStarters = new Set<string>();
  /* `batches: null` means no call produced these labels — a backfilled fixture,
     not a run with zero batches. Treating it as batched reported "0 batched
     calls", which reads as a finding rather than as an absence. */
  if (labelsFile?.batches) {
    labelsFile.batches.forEach((batch, i) => {
      for (const id of batch.blocks) batchOf.set(id, i);
      for (const start of batch.setStarts) {
        const id = batch.blocks[start];
        if (id) setStarters.add(id);
      }
    });
  }

  const out: Labelled[] = [];
  for (const block of blocks) {
    const label = labelFor.get(block.id);
    if (!block.gistable || !label) continue;
    out.push({
      blockId: block.id,
      label,
      block,
      batch: batchOf.get(block.id) ?? null,
      startsSet: setStarters.has(block.id),
    });
  }
  return out;
}

/**
 * The seam test, with the control that makes it fair.
 *
 * Comparing labels either side of a call boundary against labels sitting next
 * to each other inside a call would be rigged: a call boundary is also a
 * section boundary, so the two labels are about different things and would look
 * less alike however they were written. Both groups here therefore cross a
 * sibling-set boundary, and the only difference between them is whether that
 * boundary is also a call boundary.
 */
function seamTest(items: Labelled[]): SeamReport | null {
  if (items.some((i) => i.batch === null)) return null;

  const seam: { sim: number; same: boolean }[] = [];
  const interior: { sim: number; same: boolean }[] = [];

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]!;
    const here = items[i]!;
    // Only boundaries. A pair inside one sibling set is not a comparable case.
    if (!here.startsSet && prev.batch === here.batch) continue;
    const pair = {
      sim: jaccard(contentWords(prev.label), contentWords(here.label)),
      same: openingBigram(prev.label) === openingBigram(here.label),
    };
    if (prev.batch !== here.batch) seam.push(pair);
    else interior.push(pair);
  }

  return {
    seamPairs: seam.length,
    interiorPairs: interior.length,
    seamSimilarity: mean(seam.map((p) => p.sim)),
    interiorSimilarity: mean(interior.map((p) => p.sim)),
    seamSameOpening: seam.length === 0 ? 0 : seam.filter((p) => p.same).length / seam.length,
    interiorSameOpening:
      interior.length === 0 ? 0 : interior.filter((p) => p.same).length / interior.length,
  };
}

export function evaluate(
  slug: string,
  tree: Tree,
  blocks: Block[],
  labelsFile: LabelsFile | null,
): EvalReport {
  const items = collect(tree, blocks, labelsFile);
  const gistable = blocks.filter((b) => b.gistable).length;

  /* Which blocks are missing a label, by id, and which ones the stage says it
     dropped — compared as sets rather than as two counts. See `unexplained`. */
  const labelledIds = new Set(items.map((i) => i.blockId));
  const missingIds = blocks.filter((b) => b.gistable && !labelledIds.has(b.id)).map((b) => b.id);
  const reportedDrops = new Set(labelsFile?.dropped ?? []);

  /* Headings are excluded from length and vocabulary, and this is not tidying —
     it is the difference between a measure and noise. The prompt *requires* a
     heading's label to be its heading copied exactly, which is typically two to
     six words and so outside the documented 6-20 by construction, and which
     scores ~1.0 on vocabulary because it is the block's own text. On the
     constitution, 30 of the 39 "outside range" labels were compliant headings;
     on the 141-block article all 9 were. The measure was reporting the article's
     heading count. Raised by an adversarial review, 2026-08-26. */
  const prose = items.filter((i) => !isHeading(i.block));
  const lengths = prose.map((i) => wordCount(i.label));
  /* Headings excluded here too. A copied heading is no more evidence of a model
     template than it was evidence about length or vocabulary, and two articles
     that share a heading word would look like a formula. */
  const openings = prose.map((i) => openingBigram(i.label));
  const openingCounts = new Map<string, number>();
  for (const o of openings) openingCounts.set(o, (openingCounts.get(o) ?? 0) + 1);

  const retention = prose.map((i) => {
    const words = contentWords(i.label);
    if (words.size === 0) return 0;
    const inBlock = contentWords(i.block.text);
    let shared = 0;
    for (const w of words) if (inBlock.has(w)) shared++;
    return shared / words.size;
  });

  return {
    slug,
    blocks: blocks.length,
    gistable,
    labelled: items.length,
    coverage: gistable === 0 ? 1 : items.length / gistable,
    dropped: labelsFile?.dropped?.length ?? null,
    /* The set, both ways round — see `unexplained` and `phantomDrops`. */
    unexplained: missingIds.filter((id) => !reportedDrops.has(id)),
    phantomDrops: [...reportedDrops].filter((id) => labelledIds.has(id)),
    batched: labelsFile?.batches != null,
    batches: labelsFile?.batches?.length ?? 0,
    /* The tree is what the reader sees; labels.json is what the stage says it
       wrote. Nothing made them agree, so they could drift apart with nothing
       red — a re-run that wrote one and died before the other would leave a
       reading view and a provenance record describing different articles. */
    treeAgreesWithLabels: labelsFile
      ? items.every((i) => labelsFile.labels[i.blockId] === i.label) &&
        Object.keys(labelsFile.labels).length === items.length
      : null,
    length: {
      mean: mean(lengths),
      min: lengths.length ? Math.min(...lengths) : 0,
      max: lengths.length ? Math.max(...lengths) : 0,
      outsideRange: lengths.filter((n) => n < 6 || n > 20).length,
    },
    headings: items.length - prose.length,
    templateRepetition:
      prose.length === 0
        ? 0
        : openings.filter((o) => (openingCounts.get(o) ?? 0) > 1).length / prose.length,
    vocabularyRetention: mean(retention),
    seam: seamTest(items),
    /* Labels only, and the slowest single call rather than the run — the
       structure call, the queue's waves and any failed first attempt are all
       outside what labels.json records. Named for what it is so nobody quotes
       it as the stage's wall-clock. */
    cost: labelsFile?.batches
      ? {
          inputTokens: labelsFile.batches.reduce((n, b) => n + b.inputTokens, 0),
          outputTokens: labelsFile.batches.reduce((n, b) => n + b.outputTokens, 0),
          slowestBatchMs: labelsFile.batches.reduce((n, b) => Math.max(n, b.ms), 0),
        }
      : null,
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

function print(report: EvalReport): void {
  console.log(`\n${report.slug}`);
  console.log("─".repeat(Math.max(8, report.slug.length)));
  /* Three readings of one number, and they need different responses. Complete;
     short by exactly what the stage says it dropped, which is the bounded
     partial accept working as designed; or short by more than that, which is
     the fault the INCOMPLETE flag was put there for. Collapsing the middle case
     into the last one would have this eval cry wolf on every article with a
     stripped code cell in it.
     **By id rather than by subtraction** — a `dropped` list of the right length
     naming the wrong blocks made the arithmetic balance while a row was missing
     somewhere else. See `EvalReport.unexplained`. */
  console.log(
    `  labels        ${report.labelled} / ${report.gistable} gistable  (${pct(report.coverage)})` +
      (report.dropped ? `   ${report.dropped} dropped by the stage` : "") +
      (report.unexplained.length > 0
        ? `   ← INCOMPLETE, ${report.unexplained.length} unaccounted for ` +
          `(${report.unexplained.slice(0, 3).join(", ")})`
        : ""),
  );
  /* Its own line, because it means something different: the stage named a block
     that does have a label, so its record and its output were written from
     different states. Silent when there are none, like the repair lines. */
  if (report.phantomDrops.length > 0) {
    console.log(
      `                ← ${report.phantomDrops.length} block(s) labels.json calls dropped are ` +
        `labelled after all (${report.phantomDrops.slice(0, 3).join(", ")})`,
    );
  }
  console.log(
    `  generation    ${report.batched ? `${report.batches} batched calls` : "one whole pass (incumbent)"}`,
  );
  console.log(
    `  length        mean ${report.length.mean.toFixed(1)} words, ` +
      `range ${report.length.min}–${report.length.max}, ` +
      `${report.length.outsideRange} outside 6–20` +
      `   (${report.headings} heading labels excluded)`,
  );
  console.log(`  template      ${pct(report.templateRepetition)} share an opening bigram`);
  console.log(`  vocabulary    ${pct(report.vocabularyRetention)} of label words are in their block`);

  if (report.seam) {
    const s = report.seam;
    console.log(`\n  seam test     ${s.seamPairs} call boundaries vs ${s.interiorPairs} matched interior`);
    console.log(
      `    similarity  seam ${s.seamSimilarity.toFixed(3)}  interior ${s.interiorSimilarity.toFixed(3)}` +
        `   (not a verdict — see evals/hierarchy-labels.ts)`,
    );
    console.log(
      `    same open   seam ${pct(s.seamSameOpening)}  interior ${pct(s.interiorSameOpening)}`,
    );
  } else {
    console.log(
      `\n  seam test     skipped — ${report.batched ? "labels.json does not account for every label, so the boundaries are unknown" : "no labels.json, so no call boundaries to compare"}`,
    );
  }

  if (report.cost) {
    console.log(
      `\n  labels cost   ${report.cost.inputTokens.toLocaleString()} in, ` +
        `${report.cost.outputTokens.toLocaleString()} out, ` +
        `slowest batch ${(report.cost.slowestBatchMs / 1000).toFixed(1)}s`,
    );
  }
}

/**
 * There is no verdict line, and removing it was the point.
 *
 * The first version printed "seams look worse" when a neighbour's mean beat the
 * interior's by 15%. The second kept that and added a floor of twenty pairs
 * below which it said "too few to tell". Both were wrong, and the second was
 * wrong in a more comfortable way — it looked like rigour.
 *
 * GPT-5.6-sol did the arithmetic, 2026-08-26: at similarities around 0.02, one
 * extreme observation among twenty moves the mean by ~0.05, which is far outside
 * the ±15% band the verdict was reading. And the pairs are not independent
 * anyway — they come from one article, one run, one model. A floor cannot rescue
 * a statistic that has no error bar, and printing a threshold implies one.
 *
 * So the numbers are printed and nothing is concluded from them. A directional
 * claim about seams needs a blinded comparison across several texts and several
 * runs with its uncertainty stated, which is not a thing this harness does, and
 * saying so is more useful than a verdict nobody should act on.
 */

/** Sibling paragraphs and their labels, shuffled, for the test a person has to run. */
function printShuffled(tree: Tree, blocks: Block[]): void {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const node of Object.values(tree.nodes)) {
    if (node.children.length === 0) continue;
    const leaves = node.children
      .map((id) => tree.nodes[id])
      .filter((n) => n && n.children.length === 0 && n.navLabel);
    if (leaves.length < 3) continue;

    console.log(`\n### ${node.title}`);
    /* Fisher-Yates. `sort(() => Math.random() - 0.5)` is not a uniform shuffle —
       it leaves a positional bias correlated with the original order, which in
       the one output whose entire point is that a person cannot recover the
       order would be handing them the answer. */
    const shuffled = [...leaves];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    console.log("\nParagraphs:");
    shuffled.forEach((n, i) => {
      const text = byId.get(n!.range[0])?.text ?? "";
      console.log(`  ${String.fromCharCode(65 + i)}. ${text.slice(0, 220)}…`);
    });
    console.log("\nLabels (in document order — which paragraph is each one?):");
    leaves.forEach((n, i) => console.log(`  ${i + 1}. ${n!.navLabel}`));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shuffle = args.includes("--shuffle");
  const dirs = args.filter((a) => !a.startsWith("--"));

  if (dirs.length === 0) {
    console.error("Usage: npm run eval:hierarchy -- <dir with tree.json> [more dirs…] [--shuffle]");
    process.exit(1);
  }

  const reports: EvalReport[] = [];
  for (const dir of dirs) {
    const tree = await readJson<Tree>(path.join(dir, "tree.json"));
    const { blocks } = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
    const labelsFile = await readJsonIfPresent<LabelsFile>(path.join(dir, "labels.json"));
    const report = evaluate(path.basename(dir), tree, blocks, labelsFile);
    reports.push(report);
    print(report);
    if (shuffle) printShuffled(tree, blocks);
  }

  /* Seconds, not just the date. The point of writing these out is to compare a
     run against the one before it, and a colliding name overwrites the "before"
     you re-ran in order to have. The first version used the date and lost a run
     within the hour; the second used minutes and lost one of three variance runs
     to a forty-second labelling call. Seconds is where this stops. */
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const outDir = path.join(import.meta.dirname, "results");
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `${reports.map((r) => r.slug).join("+")}-${stamp}.json`);
  await writeFile(out, `${JSON.stringify(reports, null, 2)}\n`, "utf-8");
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
}

if (isMain(import.meta.url)) {
  await main();
}

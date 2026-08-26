/**
 * Eval — did putting the article *first* change what the model writes?
 *
 *   npm run eval:reorder -- data/constitution data/noema-mythology-of-conscious-ai
 *
 * Prompt caching needed the article to move to the front of the arc, thread and
 * glossary prompts, ahead of each stage's own instructions
 * ([docs/plans/prompt-caching.md](../docs/plans/prompt-caching.md) step 3). That
 * is not a free edit and this file exists because saying so is not enough:
 * models weight recency, and moving the instructions from before a 35,000-token
 * article to after it could plausibly make them count for less.
 *
 * The direction of the move matches Anthropic's own long-context guidance —
 * document first, task last — so it is more likely to help than hurt. **"Likely"
 * is not a measurement.** An optimisation that quietly degraded the writing
 * would be a bad trade at any price, and nothing else in the repo would notice:
 * the artefacts would still be valid, still be the right shape, still render.
 *
 * Like evals/toc-labels.ts, this **calls no model**. It measures artefacts that
 * already exist, so it is cheap and can be pointed at an old copy as easily as a
 * new one. The workflow is therefore:
 *
 *   1. `cp -r data/<slug> /tmp/before-<slug>` — keep the incumbent
 *   2. regenerate the arc, thread and glossary with the reordered prompts
 *   3. `npm run eval:reorder -- data/<slug> --against /tmp/before-<slug>`
 *
 * Everything below is mechanical, and none of it decides whether the writing is
 * *good* — each measure is a proxy for a specific way the reorder could have
 * gone wrong. The direct judgement needs a person reading both.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { contentWords } from "../src/labels.js";
import type { Arc, Block, Glossary } from "../src/types.js";

/** How much of a passage's own vocabulary survived into the text written about it. */
function retention(written: string, source: string): number {
  const a = contentWords(written);
  const b = contentWords(source);
  if (a.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / a.size;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The first two words, lower-cased — how a formula announces itself. */
function openingBigram(text: string): string {
  return text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
}

function repetition(texts: string[]): number {
  if (texts.length < 2) return 0;
  const seen = new Map<string, number>();
  for (const t of texts) {
    const k = openingBigram(t);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let repeated = 0;
  for (const n of seen.values()) if (n > 1) repeated += n;
  return repeated / texts.length;
}

interface Measures {
  count: number;
  meanWords: number;
  templateRepetition: number;
  vocabRetention: number;
}

function measure(texts: string[], source: string): Measures {
  return {
    count: texts.length,
    meanWords: texts.length === 0 ? 0 : texts.reduce((n, t) => n + words(t), 0) / texts.length,
    templateRepetition: repetition(texts),
    vocabRetention:
      texts.length === 0 ? 0 : texts.reduce((n, t) => n + retention(t, source), 0) / texts.length,
  };
}

async function readIf<T>(file: string): Promise<T | null> {
  return readFile(file, "utf-8")
    .then((raw) => JSON.parse(raw) as T)
    .catch(() => null);
}

/** The three artefacts the reorder touched, each reduced to the prose it produced. */
async function textsOf(dir: string): Promise<{ source: string; parts: Record<string, string[]> }> {
  const blocksFile = await readIf<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const source = (blocksFile?.blocks ?? [])
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n\n");

  const arc = await readIf<Arc>(path.join(dir, "arc.json"));
  const thread = await readIf<{ tweets?: { text: string }[] }>(path.join(dir, "tweets.json"));
  const glossary = await readIf<Glossary>(path.join(dir, "glossary.json"));

  return {
    source,
    parts: {
      arc: (arc?.entries ?? []).map((e) => e.text).filter(Boolean),
      thread: (thread?.tweets ?? []).map((t) => t.text).filter(Boolean),
      /* The gloss, not the name — the name is a term lifted from the article and
         would score a perfect retention that means nothing. */
      /* `senseHere` and `background`, not `gloss` — the field was renamed when an
         entry started saying two things (docs/project/glossary.md), and this line
         went on reading the old name. It did not throw: it mapped every entry to
         "", `filter(Boolean)` emptied the array, and the eval printed "no artefact
         on disk — skipped" for a glossary that was sitting right there. An eval
         that quietly measures nothing is worse than one that crashes.
         docs/reusable/silent-success.md. */
      glossary: (glossary?.entries ?? [])
        .map((e) => [e.senseHere, e.background].filter(Boolean).join(" "))
        .filter(Boolean),
    },
  };
}

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

function delta(now: number, before: number): string {
  const d = now - before;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${fmt(d)}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let against: string | null = null;
  const dirs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--against") {
      against = argv[++i] ?? null;
      continue;
    }
    if (!a.startsWith("--")) dirs.push(a);
  }

  if (dirs.length === 0) {
    console.error("Usage: npm run eval:reorder -- <dir> [--against <dir-before-the-change>]");
    console.error("Measures artefacts already on disk. Calls no model. See evals/README.md.");
    process.exit(1);
  }

  for (const dir of dirs) {
    const now = await textsOf(dir);
    const before = against ? await textsOf(against) : null;

    console.log(`\n=== ${path.basename(dir)} ===`);
    if (!before) {
      console.log("No --against given: printing the current numbers only.");
      console.log("Keep a copy of the artefacts BEFORE regenerating, or this says nothing.\n");
    }

    for (const [stage, texts] of Object.entries(now.parts)) {
      if (texts.length === 0) {
        console.log(`${stage}: no artefact on disk — skipped.`);
        continue;
      }
      const m = measure(texts, now.source);
      if (!before) {
        console.log(
          `${stage.padEnd(9)} n=${m.count}  words=${fmt(m.meanWords, 1)}  ` +
            `template=${fmt(m.templateRepetition)}  vocab=${fmt(m.vocabRetention)}`,
        );
        continue;
      }
      const b = measure(before.parts[stage] ?? [], before.source);
      console.log(
        `${stage.padEnd(9)} n=${m.count} (${b.count})  ` +
          `words=${fmt(m.meanWords, 1)} (${delta(m.meanWords, b.meanWords)})  ` +
          `template=${fmt(m.templateRepetition)} (${delta(m.templateRepetition, b.templateRepetition)})  ` +
          `vocab=${fmt(m.vocabRetention)} (${delta(m.vocabRetention, b.vocabRetention)})`,
      );
    }
  }

  /* Said out loud rather than left for the reader to infer, because a table of
     small deltas invites "looks fine" and that is the failure this whole file
     exists to prevent. */
  console.log(
    "\nHow to read it. **vocabRetention is the one that matters** — it is the proxy for\n" +
      "the model still working from the author's own words rather than drifting into\n" +
      "its own. A fall of more than a couple of points is the reorder costing something,\n" +
      "and the honest response is to put that stage's prompt back and leave it uncached.\n" +
      "templateRepetition rising means the writing has got more formulaic. Neither is a\n" +
      "substitute for reading both versions.",
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { measure, retention, repetition };

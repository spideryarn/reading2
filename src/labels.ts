/**
 * Pipeline stage 4b — the nav labels, one per gistable block, generated in
 * parallel batches once the tree's shape is fixed.
 *
 *   npm run labels -- data/constitution
 *
 * **Why this is not part of src/toc.ts's call any more.** A nav label is written
 * for every gistable block, so this is the one output in the whole pipeline that
 * grows with the article without a bound — measured at 73% of stage 4's answer
 * on a 360-block article, against 27% for the entire tree. One model response
 * holds 128,000 tokens including the model's own reasoning, and no header or
 * model raises that, so an article long enough eventually cannot be labelled in
 * one pass however the budget is arithmetic'd. Splitting the labels out is what
 * takes the ceiling from about 55,000 words to about 125,000, and it is what
 * lets the structure call think as hard as it should.
 *
 * See docs/plans/toc-scaling.md for the full design and the alternatives that
 * were weighed against it.
 *
 * **The one rule that decides whether this works:**
 *
 * > Generate siblings together; generate disjoint sibling groups in parallel.
 *
 * A label's documented job is to tell its paragraph apart from its neighbours
 * (docs/project/table-of-contents.md), so every pair a reader compares must have
 * been written in the same call. `planBatches` therefore packs whole sibling
 * sets and never splits one. Batching on a token window instead would break
 * exactly that and nothing else, which is why it would be hard to notice.
 */

import Anthropic from "@anthropic-ai/sdk";
import PQueue from "p-queue";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { MODEL } from "./models.js";
import { parseJsonFrom } from "./parse-json.js";
import { budgetFor, truncatedMessage } from "./token-budget.js";
import type { Block, NodeId, Tree, TreeNode } from "./types.js";

const PROMPT_VERSION = "labels/1";

/**
 * A batch that did not come back whole — worth one more try.
 *
 * Two failures wear this: a response the API cut off mid-token, and a response
 * that is perfectly well-formed but answers about fewer paragraphs than it was
 * asked about. They look nothing alike and they mean the same thing here, which
 * is why they share a class: neither is a bug in this code, both are a model
 * slip, and both are cheap to retry because a batch is small.
 *
 * Observed live, 2026-08-26: at `effort: "medium"` a batch asked about 42
 * paragraphs returned 41, twice, with no truncation and no complaint. That is
 * the whole reason `parseLabels` demands an exact set — and the reason the
 * retry cannot be limited to truncation, which is the failure that announces
 * itself.
 *
 * Everything else — a malformed shape, a duplicate, an empty string — is a
 * plain `Error` and is not retried. Those do not get better on a second ask.
 */
export class BatchIncomplete extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchIncomplete";
  }
}

/**
 * How hard the model thinks per batch.
 *
 * **`"low"`, and it was compared against `"medium"` rather than assumed.**
 * Writing a dozen labels for a section already handed to you, against a style
 * contract and a fixed outline, is close to mechanical work — the thinking that
 * mattered (where do the boundaries go, what is this section actually about)
 * happened in the structure call, at `"high"`, which is where the budget this
 * split frees up went.
 *
 * The comparison, on the 141-block test article, 2026-08-26:
 *
 * | effort | result |
 * |---|---|
 * | `"low"` | 117 of 117 labels, twice, in 18 seconds |
 * | `"medium"` | a batch returned 41 labels for the 42 paragraphs it was asked about, twice |
 *
 * The `"medium"` runs were not truncated and did not throw on their own. They
 * silently omitted a paragraph in the middle of a well-formed answer, which is
 * exactly the failure `parseLabels` was built to catch, and it caught it. Two
 * runs is not enough to call `"medium"` *worse* — it may be luck — but it is
 * enough to say it bought nothing measurable: the eval's numbers were identical
 * on the batches that did come back whole. So the cheaper setting stays, and
 * `generateLabels` retries an incomplete batch rather than trusting either
 * setting to be perfect.
 *
 * The postmortem's lesson cuts the other way here too: adaptive thinking expands
 * into whatever room it is given, so a small batch with a small reservation is
 * the shape that keeps it honest. See docs/postmortems/toc-max-tokens.md.
 */
const EFFORT = "low" as const;

/**
 * Reservation for the model's reasoning on one batch.
 *
 * Deliberately not `THINKING_HEADROOM`. That 40,000 was measured on a call that
 * read a whole article and thought about its structure; a batch reads one
 * section and writes labels for it. Inheriting the big number onto every small
 * call would cost nothing in money — `max_tokens` is a ceiling, not a purchase —
 * but it would hide a batch that had started thinking far more than it should,
 * which is the failure that took two six-minute runs to spot last time.
 *
 * 16,000 against an answer of roughly 4,400 for a full batch. A batch that
 * overruns it is cheap to notice and cheap to retry, which is the other half of
 * why the number can be tight here and could not be there.
 */
export const LABEL_HEADROOM = 16_000;

/**
 * How many gistable blocks a batch aims for, and the most it will take.
 *
 * Sibling sets are packed until adding the next one would pass this, so batches
 * come out just under it. On the constitution's tree — 44 sections over 360
 * blocks, median 7 blocks each — that is seven calls of 50–60, and a short tail.
 *
 * 60 is the upper end GPT-5.6-sol recommended ("roughly 40–60 gistable blocks or
 * perhaps 8–12k input tokens per batch"), and it is where the risk sits too: the
 * one silent drop we have watched happen was in a batch of 42. Too small and a
 * call sees too little of the argument around it; too large and we are back to
 * one unbounded answer with extra steps.
 *
 * **There is no matching minimum, and there was.** The first version closed a
 * batch as soon as it reached 40, which meant the count was always under 40 when
 * the maximum was tested — so the maximum could only ever fire for a single
 * sibling set larger than 40, and every batch came out at about 40. The file
 * documented a 40–80 range the code could not produce. Removing the minimum is
 * what fixes that; a short final batch is left short, because merging it into
 * the one before would either breach this cap or need an exception with no
 * principle behind it, and one small call is cheap.
 */
const MAX_BATCH = 60;

/**
 * What `detectShift` needs before it is allowed to fail a batch.
 *
 * **The first version had none of these and it was too eager to be a gate.** It
 * threw whenever either neighbour's mean beat the correct mean by any amount at
 * all, over as few as six labels — the comment claimed "cannot happen by chance
 * across dozens", which is not what the code enforced. GPT-5.6-sol, 2026-08-26,
 * listed where that misfires and the list is convincing: a list or a table whose
 * rows share vocabulary, verse, a batch of very short paragraphs, a label for
 * "This is why…" that correctly borrows its subject from the paragraph before.
 *
 * So the evidence is counted per label rather than averaged, and three things
 * have to hold together:
 *
 * - **`MIN_SHIFT_EVIDENCE`** — labels that matched *something*. A batch with no
 *   lexical signal is not judged at all, which is the honest answer for verse
 *   and for a language this crude a measure cannot read.
 * - **`SHIFT_MAJORITY`** — most of them point the same way. One odd label cannot
 *   do this, and neither can an article whose paragraphs merely resemble one
 *   another, because that spreads the votes.
 * - **`SHIFT_OWN_CEILING`** — and the correct alignment has collapsed. A batch
 *   where most labels still match their own paragraph is not shifted, whatever
 *   the rest are doing.
 *
 * A real ±1 displacement moves every vote at once and clears all three by a
 * distance. Nothing else observed does.
 */
const MIN_SHIFT_EVIDENCE = 12;
const SHIFT_MAJORITY = 0.6;
const SHIFT_OWN_CEILING = 0.3;

/** How many batches are in flight at once. Politeness to the rate limiter. */
const CONCURRENCY = 4;

/** One block of the article either side of a batch, for flow. Not labelled. */
const CONTEXT_BLOCKS = 1;

/** A lowest-level section and the blocks it holds — the unit that cannot be split. */
export interface SiblingSet {
  nodeId: NodeId;
  /** Root-to-here titles, so a batch knows where in the article it is. */
  crumb: string[];
  gist?: string;
  /** Gistable blocks under this node, in document order. */
  blocks: Block[];
}

/** One model call. */
export interface Batch {
  sets: SiblingSet[];
  /** Every gistable block the call must label, in document order. */
  blocks: Block[];
  /** Indices into `blocks` where a new sibling set begins — the eval's control. */
  setStarts: number[];
  /** Document-order index of the first and last block, for the context window. */
  span: [number, number];
}

export interface LabelBatchRecord {
  blocks: string[];
  setStarts: number[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  ms: number;
}

export interface LabelsFile {
  version: string;
  generator: string;
  slug: string;
  labels: Record<string, string>;
  /**
   * The calls that produced these labels — **null when no call did.**
   *
   * `example/labels.json` was rebuilt from the labels already sitting in a tree
   * written before this stage existed, and an empty array there was a lie to the
   * type: `batches: []` says "generated by zero calls", which is a fact about a
   * run that happened, not a statement that no run happened. The eval read it as
   * a batched file and reported "0 batched calls". `null` is the difference
   * between no evidence and evidence of none. GPT-5.6-sol, 2026-08-26.
   *
   * A synthetic batch would have been the worse fix, because it would invent
   * seam boundaries and cost figures that nothing ever measured.
   */
  batches: LabelBatchRecord[] | null;
}

/**
 * Cut the tree into calls.
 *
 * Pure, and separately testable, because everything that can go quietly wrong
 * with this design goes wrong here: a sibling set split across two calls, a
 * block that lands in no call at all, or one that lands in two. None of those
 * would throw. See tests/labels-batching.test.ts.
 */
export function planBatches(
  tree: Tree,
  blocks: Block[],
  opts: { max?: number } = {},
): Batch[] {
  const max = opts.max ?? MAX_BATCH;
  const order = new Map(blocks.map((b, i) => [b.id, i]));

  /* The sections are the internal nodes whose children are all leaves. Reading
     them off the tree rather than off a depth constant is what lets the tree's
     depth vary later without this file noticing. */
  const sets: SiblingSet[] = [];
  const walk = (id: NodeId, crumb: string[]): void => {
    const node = tree.nodes[id];
    if (!node || node.children.length === 0) return;
    const here = node.title ? [...crumb, node.title] : crumb;
    const children = node.children.map((c) => tree.nodes[c]).filter((c): c is TreeNode => !!c);
    const allLeaves = children.every((c) => c.children.length === 0);

    if (allLeaves) {
      const own = children
        .map((c) => blocks[order.get(c.range[0]) ?? -1])
        .filter((b): b is Block => !!b && b.gistable);
      if (own.length > 0) {
        sets.push({ nodeId: id, crumb: here, ...(node.gist ? { gist: node.gist } : {}), blocks: own });
      }
      return;
    }
    for (const child of children) walk(child.id, here);
  };
  walk(tree.rootId, []);

  sets.sort((a, b) => (order.get(a.blocks[0]!.id) ?? 0) - (order.get(b.blocks[0]!.id) ?? 0));

  const batches: Batch[] = [];
  let current: SiblingSet[] = [];
  let count = 0;

  const close = (): void => {
    if (current.length === 0) return;
    const flat = current.flatMap((s) => s.blocks);
    const setStarts: number[] = [];
    let at = 0;
    for (const s of current) {
      setStarts.push(at);
      at += s.blocks.length;
    }
    batches.push({
      sets: current,
      blocks: flat,
      setStarts,
      span: [order.get(flat[0]!.id) ?? 0, order.get(flat.at(-1)!.id) ?? 0],
    });
    current = [];
    count = 0;
  };

  for (const set of sets) {
    /* Close on `max`, not on `min`. The first version closed as soon as a batch
       reached `min`, which meant `count` was always under 40 when the line above
       was evaluated — so `max` could only ever fire for a single set larger than
       40, and every batch came out at about `min`. The 40–80 range this file
       documents was a range the code could not produce.
       A set larger than `max` still gets a call of its own rather than being
       cut: the cap is a preference, the sibling rule is not. */
    if (count > 0 && count + set.blocks.length > max) close();
    current.push(set);
    count += set.blocks.length;
  }
  close();

  assertCoversEveryBlock(batches, blocks);
  return batches;
}

/**
 * A sibling set larger than `MAX_BATCH` is the unbounded call coming back.
 *
 * `planBatches` will not cut one — the sibling rule outranks the cap — so a tree
 * with one enormous section produces one enormous call, and the ceiling of this
 * stage becomes the largest section the structure model happened to emit rather
 * than the ~1,976 blocks the budget refuses at. Nothing else notices: the budget
 * for a 400-label batch is well under the cap, so it runs, and 400 labels in one
 * answer is the shape that dropped one at 42.
 *
 * We do not refuse it, because refusing would fail an article that will probably
 * label fine. We say it out loud, because the fix is upstream — the structure
 * prompt asking for boundaries every ~9 blocks, and the variable tree depth in
 * docs/plans/toc-scaling.md § J.
 */
export function oversizedSets(batches: Batch[], max = MAX_BATCH): SiblingSet[] {
  return batches.flatMap((b) => b.sets).filter((s) => s.blocks.length > max);
}

/**
 * Every gistable block is in exactly one batch — checked here, where it is
 * cheap and where the answer is still just data.
 *
 * This is a belt-and-braces check over an invariant `buildTree` already
 * guarantees: it gives a node either model-proposed children (all internal) or
 * grown leaves (all leaves), never a mix, and `walk` above relies on that. But
 * `planBatches` is handed a `tree.json` off disk, which may have been written by
 * an older version of this pipeline or edited by hand, and a mixed node would
 * make `walk` recurse straight past its leaf children without complaining.
 *
 * `checkCoverage` in src/toc.ts would catch the result — but only on the path
 * that goes through `generateToc`. `npm run labels -- <dir>` on its own merges
 * and writes `tree.json` without it, so on that path a lost block would reach
 * disk as a paragraph with no sidebar row and nothing anywhere saying why. That
 * is docs/reusable/silent-success.md, and the fix is to put the check where both
 * callers pass rather than to remember to call it twice.
 */
function assertCoversEveryBlock(batches: Batch[], blocks: Block[]): void {
  const wanted = blocks.filter((b) => b.gistable).map((b) => b.id);
  const got = batches.flatMap((b) => b.blocks.map((x) => x.id));
  const seen = new Set(got);

  if (got.length !== seen.size) {
    const twice = got.filter((id, i) => got.indexOf(id) !== i);
    throw new Error(
      `planBatches put ${twice.length} block(s) in more than one batch ` +
        `(${twice.slice(0, 3).join(", ")}). Two calls would label the same paragraph and one ` +
        `would win at random.`,
    );
  }
  const missed = wanted.filter((id) => !seen.has(id));
  if (missed.length > 0) {
    throw new Error(
      `planBatches left ${missed.length} of ${wanted.length} gistable block(s) out of every batch ` +
        `(${missed.slice(0, 3).join(", ")}). The usual cause is a tree node whose children are a ` +
        `mix of leaves and internal nodes, which buildTree never produces — so this tree.json was ` +
        `written by something else.`,
    );
  }
}

const SYSTEM = `You are writing navigation labels for the paragraphs of an article. Each label
appears in a sidebar beside its paragraph, and in an outline of the whole piece.

You are given the article's outline for context, then the section you are working
on, then its paragraphs, each with a number.

WRITE ONE LABEL PER NUMBERED PARAGRAPH.

- 6-20 words. Longer than a heading on purpose: a paragraph has no name of its
  own, and its neighbours are numerous and similar, so it needs enough words to
  tell itself apart from them.
- A label must be a CLAIM or a MOVE, not a topic label.
    good: "Seth rejects substrate independence because feeling is metabolic"
    bad:  "Discusses substrate independence"
- Reuse the author's distinctive vocabulary VERBATIM. Those words are the
  reader's handholds when they arrive at the passage, and a synonym is not as
  good — it is worse, because the reader is scanning for the word they read.
  If the paragraph says "technorati", your label says "technorati", not
  "technologists". If it says "confabulate", do not write "make things up".
- A paragraph marked HEADING gets its heading text copied EXACTLY, and nothing
  else. No prefix, no "Heading:", no "Title:", no rewording, no punctuation you
  did not find there.
- Never introduce a fact that is not in that paragraph.
- No meta-narration. Never write "this section explores", "the author then
  turns to", "we are told that".
- Do not start consecutive labels the same way.

Blocks marked CONTEXT, OTHER-SECTION or NOT-GISTABLE are there so you can see
what surrounds the section. They have no number. Do NOT write labels for them.

OUTPUT

JSON only, no prose, no code fence. An array of [number, label] pairs, in order,
with exactly one pair for every numbered paragraph and no others:

{"labels": [[1, "..."], [2, "..."], [3, "..."]]}`;

/** The whole tree's titles, indented — so a batch knows what the rest of the article is. */
export function renderOutline(tree: Tree): string {
  const lines: string[] = [];
  const walk = (id: NodeId, depth: number): void => {
    const node = tree.nodes[id];
    if (!node || node.children.length === 0) return;
    if (node.title) lines.push(`${"  ".repeat(depth)}${node.title}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(tree.rootId, 0);
  return lines.join("\n");
}

/**
 * The user message for one batch: where we are, then the blocks.
 *
 * Ordinals are call-local and the mapping back to block ids happens in code.
 * That is deliberate — see `parseLabels` for the two failures it prevents.
 *
 * **The outline comes first, and that is now load-bearing rather than tidy.**
 * All four batches in a run share these bytes, so they are the cached prefix —
 * see `batchParts`, which splits this same text at that boundary.
 */
export function renderBatch(batch: Batch, blocks: Block[], outline: string): string {
  const wanted = new Map(batch.blocks.map((b, i) => [b.id, i + 1]));
  const [lo, hi] = batch.span;
  const from = Math.max(0, lo - CONTEXT_BLOCKS);
  const to = Math.min(blocks.length - 1, hi + CONTEXT_BLOCKS);

  const body: string[] = [];
  for (let i = from; i <= to; i++) {
    const block = blocks[i]!;
    /* Headings are called out by name rather than left to be inferred from the
       tag. The first run of this stage came back with "Title: The Mythology Of
       Conscious AI" — the model had no signal that `<h1>` meant "copy this
       exactly", so it helpfully labelled the heading instead of quoting it. */
    const kind = /^h[1-6]$/.test(block.tag) ? " HEADING" : "";
    const n = wanted.get(block.id);
    if (n === undefined) {
      /* Three cases, and the first version collapsed them to two in each
         direction. Originally the marker was chosen from position alone, so a
         gistable paragraph inside the span but not in this batch — which is what
         two non-adjacent sets in one call produce — was announced as
         NOT-GISTABLE, a lie. The fix for that then read the marker off the block
         alone, which lost CONTEXT entirely: every block before and after the
         batch became OTHER-SECTION. Position says whether it is outside the
         batch's span; `gistable` says whether it could have been labelled at
         all. Both are needed, and the test that caught the second mistake is the
         one that had been passing vacuously. */
      const outside = i < lo || i > hi;
      const why = outside ? "CONTEXT" : block.gistable ? "OTHER-SECTION" : "NOT-GISTABLE";
      body.push(`[${why}] <${block.tag}>${kind}: ${block.text}`);
      continue;
    }
    body.push(`[${n}] <${block.tag}>${kind}: ${block.text}`);
  }

  const where = batch.sets
    .map((s) => `  ${s.crumb.join(" › ")}${s.gist ? `\n    ${s.gist}` : ""}`)
    .join("\n");

  return `THE ARTICLE'S OUTLINE\n\n${outline}\n\nTHE SECTIONS YOU ARE LABELLING\n\n${where}\n\nPARAGRAPHS\n\n${body.join("\n\n")}`;
}

/**
 * The same message, split where the cache breakpoint goes.
 *
 * The first part is the article's outline and nothing else. It is identical for
 * every batch in a run, and there are four of them in flight at once, so it is
 * written to the cache once and read back by the rest. The second part is this
 * batch's own sections and paragraphs, which are different every time.
 *
 * **Built by splitting `renderBatch`'s own output rather than by assembling the
 * text twice.** Two functions that each build "the same" prompt is exactly how
 * a cached prefix stops matching: someone edits one heading and the other keeps
 * the old bytes, and nothing anywhere is red. Here there is one source of the
 * text and one place it is cut.
 */
export function batchParts(
  batch: Batch,
  blocks: Block[],
  outline: string,
): { shared: string; own: string } {
  const whole = renderBatch(batch, blocks, outline);
  const marker = "\n\nTHE SECTIONS YOU ARE LABELLING\n\n";
  const at = whole.indexOf(marker);
  /* If the marker is ever not there, send one unsplit part rather than guess.
     A wrong split would put batch-specific text inside the cached prefix, which
     costs the write premium on every call and never reads — worse than not
     caching at all, and invisible. */
  if (at === -1) return { shared: "", own: whole };
  return { shared: whole.slice(0, at), own: whole.slice(at + 2) };
}

/**
 * What something is, never what it says.
 *
 * Every value that reaches this file from a model is either the article's prose
 * or a sentence about it, so an error message may carry its *shape* and never
 * its content — docs/project/logging.md, and src/parse-json.ts for the longer
 * version of the same argument.
 */
function describeShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === "string") return `a ${value.length}-character string`;
  if (typeof value === "object") return `an object with ${Object.keys(value).length} key(s)`;
  return `a ${typeof value}`;
}

/**
 * Turn the model's pairs back into block ids, refusing anything that does not
 * match the batch exactly.
 *
 * **Why pairs and not a map keyed by block id, and not a bare array.** A map
 * keyed by id goes through `JSON.parse`, which silently keeps the last of any
 * duplicate keys — a repeated id would vanish leaving a block unlabelled and
 * nothing to see. A bare array of labels would let one dropped entry shift every
 * later label onto the wrong paragraph: entirely plausible output, entirely
 * wrong, and no check anywhere would catch it. Requiring the exact ordinal set
 * makes both a hard error. docs/reusable/silent-success.md.
 *
 * **A heading's label is taken from the block, not from the model.** The prompt
 * asks for the heading copied EXACTLY and the model does not comply: on the two
 * committed articles, 9 of 36 heading labels and 3 of 9 differed from their
 * block — curly apostrophes flattened to straight ones, and authored numbering
 * ("2: Other Games In Town") quietly dropped. Nothing was red; the labels were
 * the right length, in the right place, and not the heading.
 *
 * The apostrophe half of that is the *same failure* as the one in
 * docs/postmortems/toc-max-tokens.md, where a model quoting eleven headings back
 * with the wrong apostrophe broke `sourceHeading` validation. That was patched
 * by comparing more loosely. This one is patched by not asking: the label for a
 * heading is knowable without a model, so it is taken rather than requested, and
 * a prompt that drifts cannot reintroduce it. GPT-5.6-sol's review, 2026-08-26:
 * "Do not prompt harder."
 *
 * The model is still asked for one, because a batch that skipped its headings
 * would fail the ordinal-set check and lose the retry's diagnostic value — and
 * because what it writes is a useful signal that it is reading the right blocks.
 * It is simply not what gets stored.
 */
export function parseLabels(raw: string, batch: Batch): Record<string, string> {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  /* `parseJsonFrom`, never bare `JSON.parse` — V8's parse error quotes the
     first characters of what it was handed, src/jobs.ts logs a thrown error's
     message *and* its stack, and `redact` is path-based so it reaches neither.
     What lands here is a model's writing about the article, which is exactly
     what docs/project/logging.md says never goes in a line. src/toc.ts learned
     this; this file was written without it and a review caught it. */
  const parsed = parseJsonFrom<{ labels?: unknown }>(text, "the nav labels");
  if (!Array.isArray(parsed.labels)) {
    /* No sample of the text. The shape is the whole diagnosis, and a sample
       here would be the same leak by hand that `parseJsonFrom` just prevented. */
    throw new Error(
      `Nav labels: expected {"labels": [[n, "…"], …]} and got ${describeShape(parsed.labels)}.`,
    );
  }

  const seen = new Map<number, string>();
  for (const entry of parsed.labels) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      // Shape, not value — the second element is a label the model wrote.
      throw new Error(`Nav labels: expected [number, string] pairs, got ${describeShape(entry)}.`);
    }
    const [n, label] = entry as [unknown, unknown];
    if (typeof n !== "number" || !Number.isInteger(n)) {
      throw new Error(`Nav labels: paragraph number is not an integer: ${JSON.stringify(n)}`);
    }
    if (typeof label !== "string" || label.trim() === "") {
      throw new Error(`Nav labels: paragraph ${n} has an empty label`);
    }
    if (seen.has(n)) throw new Error(`Nav labels: paragraph ${n} was labelled twice`);
    seen.set(n, label.trim());
  }

  const expected = batch.blocks.length;
  const missing = [];
  for (let n = 1; n <= expected; n++) if (!seen.has(n)) missing.push(n);
  const extra = [...seen.keys()].filter((n) => n < 1 || n > expected);

  if (missing.length > 0 || extra.length > 0) {
    throw new BatchIncomplete(
      `Nav labels: this call asked for ${expected} labels and got ${seen.size}` +
        (missing.length ? `, missing ${missing.slice(0, 5).join(", ")}` : "") +
        (extra.length ? `, and ${extra.slice(0, 5).join(", ")} were not asked for` : "") +
        `. Nothing has been written.`,
    );
  }

  return Object.fromEntries(
    batch.blocks.map((b, i) => [b.id, isHeading(b) ? b.text : seen.get(i + 1)!]),
  );
}

/** A block whose label is not the model's to write. */
export function isHeading(block: Block): boolean {
  return /^h[1-6]$/.test(block.tag);
}

/* Small on purpose. A long stopword list would start deleting the author's own
   vocabulary, which is the thing these words are used to detect. Exported so
   evals/toc-labels.ts measures with exactly the same rule the gate below uses —
   a measure that disagreed with its gate would be worse than no measure. */
const STOPWORDS = new Set(
  ("the a an and or but of to in on at by for with from as is are was were be been being that this " +
    "these those it its their his her they he she we you i not no nor so than then there here what " +
    "which who whom whose when where why how all any both each few more most other some such only " +
    "own same too very can will just should now").split(" "),
);

/**
 * Lower-cased content words: what a label and its block can be compared on.
 *
 * **Split on Unicode letters, not on `a-z`.** The first version used
 * `[^a-z0-9']+`, which is the same mistake docs/project/glossary.md records
 * about `\b`: a Greek or CJK article produces an empty set for every label and
 * every block, so everything downstream scores zero, and a check that asks "is
 * the own-block score at least as good as the neighbour's" answers yes to
 * `0 >= 0` and passes silently. Accented Latin is worse than that, because it
 * does not fail cleanly — it fragments "métabolisme" into "tabolisme" and
 * compares the pieces. Caught by GPT-5.6-sol, 2026-08-26.
 *
 * The stopword list stays English-only and that is fine here: a stopword that
 * isn't removed costs a little precision, where a letter that isn't recognised
 * costs the whole word.
 */
export function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .split(/[^\p{L}\p{N}']+/u)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / a.size;
}

/**
 * Did the model lose count and describe the paragraph next door?
 *
 * **This is the one wrong answer `parseLabels` cannot see.** It checks the set
 * of paragraph numbers exactly, which stops a dropped entry — but a model that
 * miscounts internally can return a complete, exactly-sized set in which pair
 * *n* describes paragraph *n+1*. Every check passes. Every label from the slip
 * onwards sits on the wrong paragraph, and the only thing that would notice is a
 * reader who knew the article.
 *
 * It is the same physical mistake as the 41-for-42 we watched a batch make at
 * `effort: "medium"`, with the loud half removed. Raised by an adversarial
 * review of this stage, 2026-08-26, which also pointed out that the measure
 * capable of catching it already existed in the eval and was wired to nothing.
 *
 * The test is comparative, not absolute, and that matters: adjacent paragraphs
 * of one article share plenty of vocabulary, so "this label has little overlap
 * with its block" proves nothing on its own. What a shift *does* produce is a
 * batch that aligns better one place over. So line the labels up against their
 * own blocks and against their neighbours, and complain only when a neighbour
 * wins — which cannot happen by chance across dozens of labels, and cannot be
 * caused by a single unusual one.
 *
 * **The margin was measured before this was allowed to throw**, because a
 * heuristic that fails a real ingest is worse than the failure it prevents.
 * Across all eleven batches of the three committed articles a label's overlap
 * with its own paragraph ran between 3.4x and 10.5x its overlap with the best
 * neighbour. tests/labels-batching.test.ts holds the committed `example/`
 * fixture to that, so a prompt change that erodes it — labels that stop using
 * the paragraph's own words — goes red there rather than being discovered when
 * this starts refusing real articles.
 *
 * The thresholds it has to clear are `MIN_SHIFT_EVIDENCE`, `SHIFT_MAJORITY` and
 * `SHIFT_OWN_CEILING` above, and that comment is where the reasoning lives.
 * Short version: an article this measure cannot read — verse, a table of
 * near-identical rows, a language whose words it fragments — produces too little
 * evidence to vote, and the honest answer there is silence rather than a guess
 * in either direction.
 */
export function detectShift(labels: Record<string, string>, batch: Batch): void {
  /* One vote per label that has any lexical signal at all, for whichever of
     its own paragraph and its two neighbours it matches best. A shift moves
     every vote the same way at once; nothing else does. */
  const votes = new Map<number, number>([
    [-1, 0],
    [0, 0],
    [1, 0],
  ]);
  let evidence = 0;

  batch.blocks.forEach((block, i) => {
    const label = labels[block.id];
    if (!label) return;
    const words = contentWords(label);
    if (words.size === 0) return;

    const scores = [-1, 0, 1].map((off) => {
      const against = batch.blocks[i + off];
      return { off, score: against ? overlap(words, contentWords(against.text)) : -1 };
    });
    const best = Math.max(...scores.map((x) => x.score));
    if (best <= 0) return; // No signal here — a vote would be a coin toss.

    evidence++;
    /* Ties go to the paragraph it was written for, because that is the reading
       that does not accuse anybody. */
    const own = scores.find((x) => x.off === 0)!.score;
    const winner = own >= best ? 0 : scores.find((x) => x.score === best)!.off;
    votes.set(winner, votes.get(winner)! + 1);
  });

  if (evidence < MIN_SHIFT_EVIDENCE) return;

  const ahead = votes.get(1)!;
  const behind = votes.get(-1)!;
  const displaced = Math.max(ahead, behind);
  const own = votes.get(0)!;

  /* Both conditions, and both are needed. A clear majority pointing the *same*
     way is what distinguishes a shift from an article whose paragraphs simply
     resemble each other; requiring the correct alignment to have collapsed is
     what stops a batch where most labels are right and a few are odd. */
  if (displaced / evidence < SHIFT_MAJORITY) return;
  if (own / evidence > SHIFT_OWN_CEILING) return;

  const which = ahead > behind ? "the paragraph after it" : "the paragraph before it";
  throw new BatchIncomplete(
    `${displaced} of ${evidence} nav labels in this batch match ${which} better than the one ` +
      `they were written for, and only ${own} match their own. The model returned the right count ` +
      `and lost its place inside it, which the paragraph-number check cannot see. ` +
      `Nothing has been written.`,
  );
}

/**
 * Copy the labels onto the tree's leaves. Non-gistable leaves stay bare.
 *
 * **It replaces rather than overlays**, and the difference is the whole reason
 * this comment is here. The first version kept a leaf's existing `navLabel` when
 * the new map had none for it, which reads like politeness and is a trap: a
 * re-run of `npm run labels` that covered less than the whole article would
 * write a tree mixing this run's labels with last week's, with nothing on disk
 * recording which was which. Replacing means an incomplete run produces a
 * visibly incomplete tree, and `assertEveryBlockLabelled` refuses to write one
 * at all. Found by an adversarial review, 2026-08-26.
 */
export function mergeLabels(tree: Tree, labels: Record<string, string>): Tree {
  const nodes: Record<NodeId, TreeNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    if (node.children.length > 0) {
      nodes[id] = node;
      continue;
    }
    /* `navLabel` is deleted rather than set to undefined — the artefact is JSON
       on disk, and a key whose value is undefined is a key that disappears on
       write but exists in memory, which is how two objects that stringify
       identically stop comparing equal. */
    const { navLabel: _dropped, ...bare } = node;
    const label = labels[node.range[0]];
    nodes[id] = label ? { ...bare, navLabel: label } : bare;
  }
  return { ...tree, nodes };
}

/**
 * Every gistable block came back with a label — checked before anything is
 * written, on **both** paths into this stage.
 *
 * `generateToc` has `checkCoverage` after its merge, but `npm run labels --
 * <dir>` does not go through `generateToc`: it merges and rewrites `tree.json`
 * on its own. Leaving the only gate in the caller meant the advertised
 * standalone command was the one path with nothing between a short answer and
 * the disk. So the check lives here, at the end of the stage, where both callers
 * pass through — the same argument as `assertCoversEveryBlock`, one step later.
 */
export function assertEveryBlockLabelled(
  labels: Record<string, string>,
  blocks: Block[],
): void {
  const missing = blocks.filter((b) => b.gistable && !labels[b.id]);
  if (missing.length === 0) return;
  throw new Error(
    `The nav labels cover ${blocks.filter((b) => b.gistable).length - missing.length} of ` +
      `${blocks.filter((b) => b.gistable).length} paragraphs — ${missing.length} came back ` +
      `without one (${missing.slice(0, 3).map((b) => b.id).join(", ")}). Every batch is checked ` +
      `against the exact set it was asked about, so this is a gap between the batches rather ` +
      `than inside one. Nothing has been written.`,
  );
}

export interface LabelRun {
  labels: Record<string, string>;
  file: LabelsFile;
  batches: number;
  /** Sibling sets bigger than one call should be. Worth saying out loud; see `oversizedSets`. */
  oversized: number;
  inputTokens: number;
  outputTokens: number;
  /* Summed across the run's batches. Reported for the reason every other count
     here is: a cache that has stopped hitting looks exactly like one that is
     working. With four batches sharing one outline, `cacheReadTokens` at 0 means
     the fan-out is paying full price four times over.
     docs/reusable/silent-success.md. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

async function runBatch(
  client: Anthropic,
  batch: Batch,
  blocks: Block[],
  outline: string,
  signal: AbortSignal | undefined,
  headroom: number,
): Promise<{ labels: Record<string, string>; record: LabelBatchRecord }> {
  const started = Date.now();
  const answerTokens = 200 + batch.blocks.length * 55;
  const maxTokens = budgetFor("nav labels", answerTokens, headroom);
  const { shared, own } = batchParts(batch, blocks, outline);

  const message = await client.messages.stream(
    {
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      system: SYSTEM,
      /* Two parts, breakpoint on the first. Everything from the top of the
         request through that part — tools, system, and the outline — is the
         cached prefix, and it is the same bytes for all four batches running at
         once. See `batchParts`. */
      messages: [
        {
          role: "user",
          content: [
            { type: "text" as const, text: shared, cache_control: { type: "ephemeral" as const } },
            { type: "text" as const, text: own },
          ],
        },
      ],
    },
    { signal },
  ).finalMessage();

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (message.stop_reason === "refusal") {
    throw new Error(`Model refused: ${JSON.stringify(message.stop_details)}`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new BatchIncomplete(
      truncatedMessage("nav labels", maxTokens, answerTokens, {
        outputTokens: message.usage.output_tokens,
        answerChars: raw.length,
      }, headroom),
    );
  }

  const labels = parseLabels(raw, batch);
  detectShift(labels, batch);

  return {
    labels,
    record: {
      blocks: batch.blocks.map((b) => b.id),
      setStarts: batch.setStarts,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      ms: Date.now() - started,
    },
  };
}

/**
 * Label every gistable block, in parallel batches.
 *
 * A batch that comes back truncated is retried **once**, with double the
 * reasoning reservation. That is not a general-purpose retry and is not meant to
 * paper over a bad estimate: it is there because one flaky call should not throw
 * away nine good ones and ten minutes of a book. A second failure throws, and
 * the message says which half of the budget overran.
 */
export async function generateLabels(opts: {
  tree: Tree;
  blocks: Block[];
  slug: string;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
}): Promise<LabelRun> {
  const started = Date.now();
  const batches = planBatches(opts.tree, opts.blocks);
  const outline = renderOutline(opts.tree);
  const client = new Anthropic();
  /* **Starts at one, not at `CONCURRENCY`.** All these batches share the outline
     as their cached prefix, and a cache entry cannot be *read* until the request
     that writes it has begun streaming. Fire four at once into a cold cache and
     all four pay the write premium and none gets the discount — the fan-out
     races itself. So the first batch goes alone, and the moment it has run the
     queue opens up to the full width for the rest.

     The cost is one batch's latency per run, on a pipeline stage nobody is
     watching. See docs/research/prompt-caching-anthropic.md § Concurrency. */
  const queue = new PQueue({ concurrency: 1 });

  let done = 0;
  const report = (): void =>
    opts.onProgress?.(`${done} of ${batches.length} sections labelled`);
  report();

  const results = await Promise.all(
    batches.map((batch) =>
      queue.add(async () => {
        let out: Awaited<ReturnType<typeof runBatch>>;
        try {
          out = await runBatch(client, batch, opts.blocks, outline, opts.signal, LABEL_HEADROOM);
        } catch (err) {
          /* Matched on the class, not on words in the message. A message test
             would go quietly dead the first time somebody improved the wording,
             and what it would then do is stop retrying — a change that shows up
             as a rarer, stranger failure rather than as anything red. */
          if (!(err instanceof BatchIncomplete)) throw err;
          try {
            out = await runBatch(client, batch, opts.blocks, outline, opts.signal, LABEL_HEADROOM * 2);
          } catch (again) {
            /* Both attempts, whatever the second one was. They are often
               different failures — a truncation carries the two budget figures
               that say which half overran, and losing it because the retry came
               back one label short instead would throw away the only evidence
               worth having.
               The first version guarded this with `if (!(again instanceof
               BatchIncomplete)) throw again`, which meant a retry that hit a
               refusal, a 429 or a malformed shape still discarded the first
               error — the one case where the two messages differ most. Caught by
               GPT-5.6-sol, 2026-08-26. There is no reason to special-case the
               second failure's type: what the reader needs is both. */
            throw new Error(
              `The nav labels for one section failed twice.\n` +
                `  First attempt: ${err.message}\n` +
                `  After a retry with double the reasoning allowance: ` +
                `${again instanceof Error ? again.message : String(again)}`,
            );
            /* No `cause`. src/log.ts follows cause chains, and src/parse-json.ts
               spells out why that matters here: an attached original error puts
               whatever it quoted straight back into the log line under a
               different key. Both messages are already in the text above, which
               is the part worth keeping. */
          }
        }
        done++;
        /* The first batch has now written the outline into the cache, so the
           rest can read it. Widening here rather than before the first call is
           the whole point; `concurrency` is settable on a live queue. */
        queue.concurrency = CONCURRENCY;
        report();
        return out;
      }),
    ),
  );

  const labels: Record<string, string> = {};
  const records: LabelBatchRecord[] = [];
  for (const result of results) {
    if (!result) continue;
    Object.assign(labels, result.labels);
    records.push(result.record);
  }

  assertEveryBlockLabelled(labels, opts.blocks);

  return {
    labels,
    file: {
      version: PROMPT_VERSION,
      generator: MODEL,
      slug: opts.slug,
      labels,
      batches: records,
    },
    batches: batches.length,
    oversized: oversizedSets(batches).length,
    inputTokens: records.reduce((n, r) => n + r.inputTokens, 0),
    outputTokens: records.reduce((n, r) => n + r.outputTokens, 0),
    /* Summed the same way as the other two. In a healthy run one batch writes
       the outline and the rest read it, so writes should be roughly one batch's
       worth and reads the remainder — a run where writes scale with the batch
       count is one where the fan-out raced and nobody read anything. */
    cacheReadTokens: records.reduce((n, r) => n + r.cacheReadTokens, 0),
    cacheWriteTokens: records.reduce((n, r) => n + r.cacheWriteTokens, 0),
    elapsedMs: Date.now() - started,
  };
}

/**
 * Write JSON so that it is either wholly there or not there at all.
 *
 * The twin of `writeAtomic` in src/toc.ts, deliberately duplicated rather than
 * shared: src/toc.ts already imports this file, so a shared helper would have to
 * move to a third module for four lines, and the two copies cannot drift in a
 * way that matters — either writes atomically or it does not, and there is no
 * middle behaviour to disagree about.
 */
async function writeAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tmp, file);
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: tsx src/labels.ts <dir with tree.json and blocks.json>");
    process.exit(1);
  }
  const tree = JSON.parse(await readFile(path.join(dir, "tree.json"), "utf-8")) as Tree;
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as {
    blocks: Block[];
  };

  console.log(`Labelling ${blocks.filter((b) => b.gistable).length} blocks with ${MODEL}…`);
  const run = await generateLabels({
    tree,
    blocks,
    slug: path.basename(dir),
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  const merged = mergeLabels(tree, run.labels);
  /* Beside-then-rename, and the tree second, for the same reason src/toc.ts
     does it: `writeFile` truncates its target before it has anything to put
     there, so a process killed mid-write leaves a `tree.json` that exists and is
     not JSON — and existence is what src/pipeline.ts reads as "this step is
     done". This command rewrites the tree of an article somebody may already be
     reading, which makes it the worse of the two places to get this wrong. */
  await writeAtomic(path.join(dir, "labels.json"), run.file);
  await writeAtomic(path.join(dir, "tree.json"), merged);

  console.log(`\n\nBatches:   ${run.batches}`);
  if (run.oversized > 0) {
    console.log(
      `Warning:   ${run.oversized} section(s) are bigger than one call should be. The batches ` +
        `were not cut — siblings stay together — so those went out as single large calls. The ` +
        `fix is upstream, in how the structure call cuts sections.`,
    );
  }
  console.log(`Labelled:  ${Object.keys(run.labels).length} blocks`);
  console.log(`Tokens:    ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`\nEval:      npm run eval:toc -- ${dir}`);
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {
  await main();
}

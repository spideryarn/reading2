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

import type Anthropic from "@anthropic-ai/sdk";
import PQueue from "p-queue";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_FLOOR_TOKENS, estimateTokens } from "./article-prompt.js";
import { stageCli } from "./cli-ledger.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL } from "./models.js";
import { loadEnvLocal } from "./env.js";
import { MODEL_REFUSED } from "./messages.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { parseJsonFrom, stripFence } from "./parse-json.js";
import { isBodyEvidence, isStructural } from "./block-policy.js";
import { hashBlocks, structureHash } from "./source-hash.js";
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
 *
 * **`shortfall` is what makes the two retries different.** A truncated response
 * has nothing to keep and no way to say what is absent, so the answer to it is
 * room to think and the whole batch again. A well-formed answer that skipped a
 * paragraph knows exactly which one, and carries the labels it *did* write — so
 * the answer to it is to ask for the gap alone. Absent on every other failure,
 * which is precisely how `generateLabels` tells them apart.
 */
export interface Shortfall {
  /** Block id → label, for the paragraphs the model did answer about. */
  partial: Record<string, string>;
  /** Call-local ordinals with no label, in order. */
  missing: number[];
}

export class BatchIncomplete extends Error {
  readonly shortfall: Shortfall | undefined;
  /**
   * What the call cost — **attached by `runBatch`, not by the parser.**
   *
   * On the error rather than on `Shortfall`, and it moved there on 2026-08-30.
   * A parser has no idea what was spent, so it cannot fill this in; but neither
   * does a truncation have a shortfall to hang it on, and a truncated call is
   * the most expensive failure this stage buys — it spent a whole batch's
   * output before the ceiling stopped it. While the field lived on `Shortfall`
   * those tokens vanished from `labels.json` on every truncate-then-succeed
   * batch, so the artefact and the ledger (src/ai-spend.ts records at the wire)
   * disagreed on exactly the runs somebody was looking at. What it cost is a
   * fact about the call, so it belongs on the thing thrown by the call.
   *
   * Undefined means a parser threw on its own, which happens in tests and
   * nowhere else.
   */
  readonly record: LabelBatchRecord | undefined;

  constructor(message: string, shortfall?: Shortfall, record?: LabelBatchRecord) {
    super(message);
    this.name = "BatchIncomplete";
    this.shortfall = shortfall;
    this.record = record;
  }
}

/**
 * The batch came back whole and **displaced** — a different failure wearing the
 * same class, and the distinction is load-bearing rather than tidy.
 *
 * `detectShift` throws this. Everything a `BatchIncomplete` normally means —
 * *some of the answer is absent, ask again, and a bounded gap may be forgiven* —
 * is false of it: the answer is complete, and it is wrong. In particular
 * `acceptGap` must never be offered one, because the set it would fall back to
 * is a *subset* of the set that just failed the check, and a subset can be one
 * label short of the evidence the check needs to speak at all.
 *
 * **A subtype like this existed for an hour on 2026-08-26 and was deleted on a
 * wrong argument** — that no fixture could tell it from the plain case, because
 * "the sets differ by at most the budget, which cannot move a majority vote".
 * The vote was never the threshold in question. `MIN_SHIFT_EVIDENCE` is, and one
 * label is exactly enough to cross it: a merged set of twelve votes detects, and
 * the partial set of eleven behind it abstains. GPT Sol built that case on one
 * reading of the code, 2026-08-30; tests/labels-shortfall.test.ts § "does not
 * turn a shift the repair found back into an accepted gap" is it, at thirteen
 * blocks, and it was red before this class came back.
 */
export class LabelsShifted extends BatchIncomplete {
  constructor(message: string, record?: LabelBatchRecord) {
    super(message, undefined, record);
    this.name = "LabelsShifted";
  }
}

/**
 * A `BatchIncomplete` that carries a partial answer and a named gap.
 *
 * The type, and the guard for it, because three places have to ask the same
 * question — the retry chooses a repair over a re-draw on it, and `acceptGap`
 * requires it of *both* attempts. A `LabelsShifted` never passes: it has no
 * shortfall, which is the whole of what tells the two apart at a call site.
 */
export type BatchCameBackShort = BatchIncomplete & { readonly shortfall: Shortfall };

export function cameBackShort(err: unknown): err is BatchCameBackShort {
  return err instanceof BatchIncomplete && err.shortfall !== undefined;
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
 * **There is a matching minimum again, and it is not the one that was removed.**
 * The first version closed a batch *as soon as* it reached 40, which meant the
 * count was always under 40 when the maximum was tested — so the maximum could
 * only ever fire for a single sibling set larger than 40, and every batch came
 * out at about 40. The file documented a 40–80 range the code could not produce.
 *
 * `MIN_BATCH` is the other shape: it never causes a close, it only *prevents*
 * one. A batch closes when it is full, exactly as it does now, and a batch that
 * is not yet big enough to be checkable keeps taking sets rather than being
 * emitted short. Read the condition in `planBatches` rather than the name — the
 * two look alike and do opposite things, and the old bug is the one this file
 * has already had once.
 *
 * **And that removal's parting argument is now false.** It said a short final
 * batch is left short because merging it into the one before "would either
 * breach this cap or need an exception with no principle behind it, and one
 * small call is cheap". There is a principle behind it now: a batch under
 * `MIN_BATCH` cannot be shift-checked, so it is not a batch we are able to
 * stand behind — see `MIN_BATCH`, and `acceptGap`. And the small call is not
 * cheap: on the corpus here it is where three of fourteen articles put their
 * tail. So the merge happens and it does breach this cap, by at most
 * `MIN_BATCH - 1` blocks — 71 on the widest real case measured. That is the same
 * trade the paragraph above already makes for an oversized sibling set: the cap
 * is a preference, and the things it gives way to are the sibling rule and now
 * this.
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

/**
 * **The smallest batch worth sending — derived from the line above, because it
 * is the same constraint and not a second one.**
 *
 * A batch is only allowed to keep a gap if `detectShift` could vote on what it
 * would keep, and that needs `MIN_SHIFT_EVIDENCE` labels. A batch that spends
 * its whole `droppedBudget` has that many labels minus the budget left — so a
 * batch smaller than this cannot both use its allowance and be checked, and
 * `acceptGap` refuses it. `planBatches` had no minimum at all, which is what
 * made that reachable: *"planBatches has no minimum batch size, making this
 * reachable"* — GPT Sol, 2026-08-31, finding 3.
 *
 * The two ways to answer that are to refuse the batch at run time or to stop
 * emitting it. Refusing alone turns a short tail batch with one unlabellable
 * fragment into a lost article, which is the fatal-failure shape Greg ruled
 * against on 2026-08-30 (*"better than things failing fatally"*), and it is an
 * ordinary shape rather than an exotic one: on the fourteen articles on this
 * machine, 4 of 31 batches came out under this floor. So the batch stops being
 * emitted, and the refusal stays as the backstop for what merging cannot reach.
 *
 * **Computed rather than typed**, so that moving `MIN_SHIFT_EVIDENCE` or
 * `droppedBudget` moves this with them. Two numbers that have to agree and are
 * written down separately are two numbers that will disagree. It comes out at
 * 13 today: a batch of 13 may drop 1 and still offer 12 labels to the check.
 *
 * It is a *necessary* condition and not a sufficient one — evidence counts only
 * labels with some lexical signal, so a batch above this floor can still fail
 * to reach the threshold on verse or on a table of near-identical rows. That
 * residue is `acceptGap`'s to refuse, and it is why the refusal is not deleted
 * now that this exists.
 */
const MIN_BATCH = ((): number => {
  for (let n = 1; n <= MAX_BATCH; n++) {
    if (n - droppedBudget(n) >= MIN_SHIFT_EVIDENCE) return n;
  }
  return MAX_BATCH;
})();

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
  /**
   * How many **requests** this one batch took — usually one, two when a short
   * answer was repaired or a truncated one re-drawn.
   *
   * **A batch is not a call, and `LabelRun.calls` said it was.** `calls` was the
   * length of the record list, so a repaired batch reported one request after
   * making two — and `calls` is what the cache diagnostic is read against: a run
   * of one call has nothing to read a cache back from, so zero reads is expected
   * and nothing is wrong. A two-request batch reporting one made a real cache
   * failure (the re-ask should read the prefix the first attempt wrote) look
   * exactly like the case where there was nothing to read. That is
   * docs/reusable/silent-success.md with the diagnostic itself as the casualty.
   * GPT Sol's review of stage 1b, 2026-08-30.
   *
   * **Optional, because every `labels.json` written before 2026-08-30 has no
   * such field**, and a reader that demanded one would make every older
   * artefact invalid — every record on disk describes at least one request, so
   * absent reads as `1`. Always written by this file.
   */
  requests?: number;
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
  /**
   * The manifest: enough to tell a *stale* complete set from a current one.
   *
   * Atomic writes give us "whole or not there". They do not give us "still
   * true". A `labels.json` with every block labelled is indistinguishable from
   * a current one even when the article has been re-extracted underneath it,
   * the structure call has been re-run with different boundaries, or the model
   * has changed — and src/pipeline.ts decides a step is done by whether its
   * files exist, so nothing would ever look again. Raised by GPT-5.6-sol,
   * 2026-08-26; the same shape as `sourceHash` on the glossary and the tweet
   * thread (src/source-hash.ts), which is why it uses that hash rather than a
   * second definition of what an article is.
   *
   * - `sourceHash` — the blocks these labels describe.
   * - `structureHash` — the *tree* they were written against: every node's id,
   *   parent, range, title and gist. Boundaries can move without a single block
   *   changing, and when they do, a label written to tell a paragraph apart
   *   from the wrong set of neighbours is wrong in the one way this stage
   *   exists to prevent. The first version hashed the outline the prompt shows
   *   the model, which is titles and nothing else — two trees that cut the
   *   article in completely different places print the same outline, so it was
   *   claiming more than it checked.
   * - `structureVersion` — the toc prompt version off the tree, so the pair of
   *   prompt versions is recorded rather than just this file's own.
   *
   * **`sourceHash` is read; the other two are still evidence.** `STAMP_SOURCE`
   * (src/store/artifacts.ts) points stage 4's stamp at *this* file rather than
   * at the tree, precisely because the tree carries no such field — so
   * `stampFor` returns this hash and `assertStampAgrees` refuses a write whose
   * declared `inputHash` contradicts it. That refusal is what checks the
   * pipeline's own bookkeeping: the `toc` step records `hashBlocks` of the
   * blocks it handed to stage 4, `reasonsNotToPublish` compares that recorded
   * hash against the stored blocks, and a step that recorded a hash of some
   * *other* array would make the article unpublishable with nothing to say why
   * (src/store/pg-revisions.ts). Because the labels and the blocks go into the
   * store in one write, the two are compared before either lands.
   *
   * `structureHash` and `structureVersion` are the ones nothing reads yet, and
   * that is the honest state of it: the `toc` step has no freshness check of its
   * own, so the pipeline still decides it is done by whether its artefacts are
   * there. Recording them is what makes writing that check a small job rather
   * than a re-run of every article; until it is written, they are evidence
   * sitting in the file rather than a guard.
   */
  sourceHash: string;
  structureHash: string;
  structureVersion: string;
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
  /**
   * Blocks the run gave up on — **optional, because most files predate it.**
   *
   * Absent and empty mean different things and both are fine here: absent is a
   * file written before there was such a thing as a dropped label, empty is a
   * run that dropped none. Nothing branches on the difference; what reads it is
   * evals/toc-labels.ts, which without this field can only see coverage below 1
   * and call it INCOMPLETE — a repair inside the code under measurement
   * silently redefining the measurement, which is the mistake the R2/R3 build
   * made and wrote down. See `LabelRun.dropped`.
   */
  dropped?: string[];
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
  /* **The floor gives way to the caller's own cap**, rather than overriding it.
     A caller that asks for batches of ten — which is the evals and the tests,
     never the pipeline — is asking for something smaller than `detectShift` can
     read, and silently handing back batches of thirteen would be answering a
     different question from the one asked. Those batches are then exactly the
     ones `acceptGap` refuses to keep a gap in, which is the right answer to
     "you asked for a batch nothing can check". */
  const min = max >= MIN_BATCH ? MIN_BATCH : 0;
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
        .filter((b): b is Block => !!b && isStructural(b));
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
    /* **Close when it is full, and never while it is too small to be checked.**
       Two conditions doing two different jobs, and the order they are written in
       is the whole of the difference from the version this file had first.

       `count + set.blocks.length > max` is the close, exactly as before: a batch
       is emitted when the next set would take it past the cap. The first version
       closed as soon as the count reached a *minimum*, which meant `count` was
       always under 40 when this line was evaluated — so `max` could only ever
       fire for a single set larger than 40, and every batch came out at about
       the minimum. The 40–80 range this file documented was a range the code
       could not produce.

       `count >= min` never causes a close; it withholds one. A batch under
       `MIN_BATCH` is one `acceptGap` cannot stand behind — `detectShift` has too
       few labels to vote — so rather than emit it and refuse it later, it keeps
       taking sets. That can carry a batch past `max`, by less than `MIN_BATCH`,
       and that is the intended trade rather than an oversight.

       A set larger than `max` still gets a call of its own rather than being
       cut: the cap is a preference, the sibling rule is not. */
    if (count >= min && count + set.blocks.length > max) close();
    current.push(set);
    count += set.blocks.length;
  }
  close();

  /* **The tail, which is the only batch the loop can leave short.** Every other
     batch was closed by the condition above, which requires `count >= min`; the
     last one is whatever was left when the sets ran out, and there was nothing
     after it to take. So it is merged backwards into the batch before it — the
     move the removed minimum's comment rejected for want of a principle, and
     `MIN_BATCH` is the principle. Whole sets move, so the sibling rule is
     untouched, and `close` recomputes `setStarts` and `span` from the merged
     list rather than splicing them.

     One pass is enough and a loop would be misleading: after this there is at
     most one batch under `min`, and it is the single-batch case — a whole
     article shorter than a checkable batch, which has no neighbour to merge
     into and is `acceptGap`'s to refuse. Such an article is under twenty
     structural blocks, so `assertInsideCoverageFloor` already refuses a drop in
     it: one label of a nineteen-block piece is 5.3% and the floor is 5%. The two
     refusals therefore do not stack up into a case that could have shipped. */
  const last = batches.at(-1);
  if (last && batches.length > 1 && last.blocks.length < min) {
    batches.pop();
    const before = batches.pop()!;
    current = [...before.sets, ...last.sets];
    count = current.reduce((n, s) => n + s.blocks.length, 0);
    close();
  }

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
  const wanted = blocks.filter((b) => isStructural(b)).map((b) => b.id);
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
      /* `isStructural`, not `gistable`, and this is the same distinction the
         paragraph above makes rather than a second one: what the marker has to
         say is whether the block *could have been labelled at all*, and since
         footnotes that is `isStructural`. A note announced as OTHER-SECTION
         tells the model another batch will label it, which is false. */
      const why = outside ? "CONTEXT" : isStructural(block) ? "OTHER-SECTION" : "NOT-GISTABLE";
      /* Which was **not enough, and marking is not hiding**. The line below
         prints the block's own text, so a footnote inside the context window —
         and the last batch of a noted article always has one, since the notes
         sit immediately after the body — arrived at the model in full, wearing
         a NOT-GISTABLE label. That is the claim "automatic model calls do not
         read footnotes" being false in the second-largest call the pipeline
         makes. GPT Sol's review of stage 3, 2026-08-28. `isBodyEvidence` is the
         predicate because this is exactly its question: may an automatic call
         read this block as evidence about the piece? src/block-policy.ts. */
      if (!isBodyEvidence(block)) continue;
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
 * A fingerprint of everything that decides what one batch's labels should say.
 *
 * **The rendered prompt, and then the things the prompt does not show.**
 * Resuming a batch because its block ids match is the wrong rule and it is the
 * tempting one: the boundaries, the crumbs, the gists and the whole article's
 * outline can all have moved while the same paragraphs sit in the same call,
 * and a label whose job is to tell a paragraph apart from its neighbours is
 * then answering a question nobody asked any more. Hashing the bytes we were
 * about to send catches most of that, because the bytes *are* the question.
 * GPT-5.6-sol, 2026-08-26.
 *
 * **But not all of it, and the gap was a real hole.** The bytes carry titles,
 * crumbs, gists and numbered paragraphs; they do not carry where one sibling
 * set ends and the next begins. Move a paragraph from one lowest-level section
 * into the one beside it, leave both titles and gists alone, and let the
 * packing put both sections in the same call: the outline is identical, the
 * section preamble is identical, the numbered paragraphs are identical and in
 * the same order — and the sibling grouping, the single thing this whole stage
 * rests on, has changed. The old labels would have been reused with nothing
 * going red anywhere. So `setStarts` and the sets' own ids and blocks go in as
 * well, none of which the model ever sees. Found by GPT-5.6-sol reviewing this
 * checkpoint, 2026-08-26.
 *
 * The block ids go in too, even though the prompt already contains every one of
 * those paragraphs' text. Two sections of an article can be byte-identical —
 * a repeated boilerplate block, a table's header row — and a fingerprint that
 * could collide across two batches would resume one from the other's labels,
 * which is a wrong answer rather than a missing one.
 *
 * `max_tokens` is deliberately **not** in here. A retry runs with double the
 * reasoning reservation, and an answer that passed every gate under a different
 * ceiling is the same answer; treating the ceiling as part of the prompt's
 * identity would refuse a good batch for a reason unconnected to what it says.
 * Sol's call, and it is right.
 *
 * Sixteen hex characters, compared only for equality. src/source-hash.ts makes
 * the same argument at more length.
 */
export function batchFingerprint(batch: Batch, blocks: Block[], outline: string): string {
  const { shared, own } = batchParts(batch, blocks, outline);
  const canonical = [
    PROMPT_VERSION,
    CAPABLE_MODEL,
    EFFORT,
    SYSTEM,
    batch.blocks.map((b) => b.id).join(","),
    /* The grouping, which no part of the rendered text states. */
    batch.setStarts.join(","),
    batch.sets.map((s) => `${s.nodeId}:${s.blocks.map((b) => b.id).join("|")}`).join(";"),
    shared,
    own,
  ].join("\u0000");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

/**
 * A fingerprint of the tree, for the manifest — **not** `renderOutline`'s text.
 *
 * **Moved to src/source-hash.ts on 2026-08-26** and re-exported here, so
 * nothing that already imported it from this module had to change. That is the
 * same move `hashBlocks` made out of src/tweets.ts, for the same reason:
 * `ideas` (stage 5f) needs this exact answer, and two modules computing "the
 * same" structure hash two ways can only ever disagree — the day they do, one
 * artefact reports itself current against a different definition of current.
 *
 * The NUL separator went across byte for byte, which is load-bearing rather
 * than stylistic: change it and every `labels.json` already on a shelf reports
 * a structure that has not moved as having moved.
 */
export { structureHash } from "./source-hash.js";

/** One batch that came back whole, kept so a later run does not pay for it again. */
export interface LabelCheckpointEntry {
  fingerprint: string;
  labels: Record<string, string>;
  record: LabelBatchRecord;
}

/**
 * Batches that have landed, for a run that has not finished.
 *
 * A separate file from `labels.json` on purpose. `labels.json` is an artefact —
 * src/pipeline.ts reads its existence as "stage 4 is done", and the store
 * publishes it — so a partial one would be a finished-looking article with
 * holes in its navigation. This is working state: it is written as batches
 * land, read only by the run that resumes it, and deleted the moment the real
 * artefacts are published.
 */
export interface LabelCheckpoint {
  version: string;
  generator: string;
  slug: string;
  sourceHash: string;
  /**
   * Which run last wrote this. Not part of what makes a checkpoint *usable* —
   * resuming another run's work is the whole point — but it is what lets
   * `clearCheckpoint` refuse to delete a file some other process is still
   * writing to.
   */
  runId?: string;
  batches: LabelCheckpointEntry[];
}

/** Where the working state lives, beside the artefacts it is working towards. */
export const CHECKPOINT_FILE = "labels-progress.json";

/**
 * The batches in a checkpoint that this run is allowed to reuse.
 *
 * **Everything about this function is a refusal.** It is handed a file written
 * by some earlier process, about an article that may since have changed, and
 * the only interesting failure is the one where it says yes when it should have
 * said no — a resumed run then publishes labels that were written for a
 * different article and looks exactly like a run that worked. So the shape is
 * checked field by field rather than cast, an unreadable or unrecognisable file
 * is worth nothing rather than worth a guess, and the per-batch fingerprints
 * are still matched afterwards even when everything here agrees.
 *
 * Returned as a map so the caller does not have to trust the order, which is
 * whatever order four parallel batches happened to finish in.
 */
export function usableCheckpoint(
  file: unknown,
  expect: { version: string; generator: string; slug: string; sourceHash: string },
): Map<string, LabelCheckpointEntry> {
  const empty = new Map<string, LabelCheckpointEntry>();
  if (typeof file !== "object" || file === null) return empty;
  const cp = file as Partial<LabelCheckpoint>;
  if (cp.version !== expect.version) return empty;
  if (cp.generator !== expect.generator) return empty;
  if (cp.slug !== expect.slug) return empty;
  if (cp.sourceHash !== expect.sourceHash) return empty;
  if (!Array.isArray(cp.batches)) return empty;

  const out = new Map<string, LabelCheckpointEntry>();
  for (const entry of cp.batches) {
    if (typeof entry !== "object" || entry === null) continue;
    const { fingerprint, labels, record } = entry as Partial<LabelCheckpointEntry>;
    if (typeof fingerprint !== "string" || fingerprint.length === 0) continue;
    if (typeof labels !== "object" || labels === null) continue;
    if (Object.values(labels).some((v) => typeof v !== "string" || v.trim().length === 0)) continue;
    if (typeof record !== "object" || record === null) continue;
    if (!Array.isArray(record.blocks)) continue;
    /* Last one wins, and it does not matter which: two entries with the same
       fingerprint were produced by the same prompt asking the same question. */
    out.set(fingerprint, { fingerprint, labels, record });
  }
  return out;
}

/**
 * Does this stored entry answer for exactly the blocks this batch is asking
 * about — no more, no fewer?
 *
 * The fingerprint already says the prompt was identical, so in practice this
 * cannot fail. It is here because of what happens when it does: `usableCheckpoint`
 * only knows whether an entry is *well-formed*, and `assertEveryBlockLabelled`
 * at the end only asks whether every block ended up with a label, not whether
 * the call that wrote it was asked about that block. Between those two, an
 * entry carrying one extra id would overwrite a neighbouring batch's label and
 * the run would report success. This is the check that sits where the answer is
 * actually known. GPT-5.6-sol, 2026-08-26.
 */
export function coversExactly(entry: LabelCheckpointEntry, batch: Batch): boolean {
  const want = batch.blocks.map((b) => b.id);
  const got = Object.keys(entry.labels);
  if (want.length !== got.length) return false;
  const wanted = new Set(want);
  return got.every((id) => wanted.has(id));
}

/**
 * Is the shared prefix long enough for the model to take it?
 *
 * Its own function because the decision it feeds — serialise the first batch,
 * or fan out immediately — costs a batch of latency when it is wrong in one
 * direction and several cache writes when it is wrong in the other, and neither
 * one is visible in the labels. `estimateTokens` is four characters a token, so
 * a prefix within a few percent of the floor could fall either side; that is
 * accepted, because the alternative is a `count_tokens` round trip before every
 * run to decide something whose worst case is a few cents. What is *not*
 * accepted is calling the result a fact, which is why the field it feeds is
 * named `estimatedCacheable`.
 */
export function prefixIsCacheable(prefix: string): boolean {
  return estimateTokens(SYSTEM + prefix) >= CACHE_FLOOR_TOKENS;
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
 * Paragraph numbers, named as paragraph numbers.
 *
 * **This wording cost a day of investigation.** A production ingest of a
 * 244-block article failed on 2026-08-30 with *"this call asked for 58 labels
 * and got 57, missing 4"*, and every reader of that sentence — including the
 * plan written from it — read the last number as a count. 58 minus 57 is one,
 * so the message looked self-contradictory and an investigation went after
 * arithmetic that had been right all along. It was the ordinal of the one
 * paragraph with no label.
 *
 * So the numbers are announced as what they are, the singular is said out loud
 * where there is one of them, and the truncation to five carries the total —
 * "five names and nothing else" has exactly the same ambiguity in its other
 * direction, because nothing in it says whether five is all of them.
 * docs/plans/faster-ingest-and-concurrency.md § Stage 1b.
 *
 * Ordinals are safe to interpolate. They are integers this file generated from
 * the batch's own length, never a value read out of the model's response as
 * text — see `nameValue` in src/toc.ts for the rule and why it matters here.
 */
function paragraphList(ns: number[]): string {
  const shown = ns.slice(0, 5).join(", ");
  const rest = ns.length - Math.min(ns.length, 5);
  return (
    `paragraph${ns.length === 1 ? "" : "s"} ${shown}` +
    (rest > 0 ? ` and ${rest} others (${ns.length} in all)` : "")
  );
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
  const seen = readPairs(raw);
  const expected = batch.blocks.length;
  const wanted = Array.from({ length: expected }, (_, i) => i + 1);
  const missing = wanted.filter((n) => !seen.has(n));
  const extra = [...seen.keys()].filter((n) => n < 1 || n > expected);

  if (missing.length > 0 || extra.length > 0) {
    throw new BatchIncomplete(
      `Nav labels: this call asked for ${expected} labels and got ${seen.size}` +
        (missing.length ? `, missing ${paragraphList(missing)}` : "") +
        (extra.length
          ? `, and ${paragraphList(extra)} ${extra.length === 1 ? "was" : "were"} not asked for`
          : "") +
        `. Nothing has been written.`,
      /* What the call did produce, carried on the error rather than lost with
         it. Everything above this line is unchanged; this is the whole of what
         makes a shortfall answerable — see `Shortfall`, and `runShortfall` for
         what is then asked. `extra` deliberately does not get one: an answer
         with numbers nobody asked for is a model working from something other
         than this batch, and picking the in-range half out of it would be
         guessing which half. */
      extra.length === 0
        ? { partial: onto(seen, batch, wanted.filter((n) => seen.has(n))), missing }
        : undefined,
    );
  }

  return onto(seen, batch, wanted);
}

/**
 * The same wire format, for the re-ask that names its own paragraphs.
 *
 * `wanted` is the gap rather than 1…N, and everything else holds: an exact set,
 * checked, or a `BatchIncomplete` naming what is still absent.
 *
 * **In-range numbers outside `wanted` are ignored rather than refused**, and
 * that is the one place this is looser than `parseLabels`. A model asked to
 * write the label for paragraph 4 quite often writes the whole section out
 * again; refusing that answer would throw away the very label we came back for
 * and drop it instead. The looseness is safe *here* and nowhere else, because
 * ordinals map to blocks positionally — an extra pair for paragraph 9 can only
 * overwrite paragraph 9's label, never shift another. Out-of-range numbers are
 * still a refusal, for the reason `parseLabels` gives.
 */
export function parseShortfall(
  raw: string,
  batch: Batch,
  wanted: number[],
): Record<string, string> {
  const seen = readPairs(raw);
  const expected = batch.blocks.length;
  const missing = wanted.filter((n) => !seen.has(n));
  const extra = [...seen.keys()].filter((n) => n < 1 || n > expected);

  if (missing.length > 0 || extra.length > 0) {
    throw new BatchIncomplete(
      `Nav labels: this call asked again for ${wanted.length} of the batch's ${expected} labels ` +
        `and got ${seen.size}` +
        (missing.length ? `, still missing ${paragraphList(missing)}` : "") +
        (extra.length
          ? `, and ${paragraphList(extra)} ${extra.length === 1 ? "was" : "were"} not asked for`
          : "") +
        `.`,
      /* Whatever the re-ask *did* answer is still worth having: two paragraphs
         missing and one repaired is one dropped, not two. Only the ordinals
         that were asked for, so a model that rewrote the whole section cannot
         quietly replace labels the first call already got right. */
      extra.length === 0
        ? { partial: onto(seen, batch, wanted.filter((n) => seen.has(n))), missing }
        : undefined,
    );
  }

  return onto(seen, batch, wanted);
}

/**
 * The pairs, validated as pairs. Says nothing about *which* numbers are owed.
 *
 * Split out of `parseLabels` when the shortfall re-ask arrived, so that the two
 * callers cannot disagree about the wire format — which is the failure a second
 * hand-written parser produces, and it produces it silently.
 */
function readPairs(raw: string): Map<number, string> {
  /* `stripFence` then `parseJsonFrom`, never bare `JSON.parse`. The reasoning
     that used to sit here — including that `redact` is path-based and so reaches
     neither the message nor the stack, and that src/toc.ts learned this before
     this file was written without it — is now in src/parse-json.ts §
     `stripFence`, next to the code it is about. */
  const parsed = parseJsonFrom<{ labels?: unknown }>(stripFence(raw), "the nav labels");
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
      // Shape, not value — `n` is `entry[0]` from model output and can be a
      // string of arbitrary prose rather than the integer it was asked for.
      throw new Error(`Nav labels: paragraph number is not an integer, got ${describeShape(n)}.`);
    }
    if (typeof label !== "string" || label.trim() === "") {
      throw new Error(`Nav labels: paragraph ${n} has an empty label`);
    }
    if (seen.has(n)) throw new Error(`Nav labels: paragraph ${n} was labelled twice`);
    seen.set(n, label.trim());
  }
  return seen;
}

/**
 * Ordinals onto block ids — and a heading's label read off the block, never the
 * model.
 *
 * **Only for ordinals that came back**, which is what this signature says and
 * what makes `acceptGap` the second place a heading is labelled: an ordinal the
 * model never returned never reaches here, so a heading the model skipped twice
 * would have been dropped even though its label was sitting in `block.text` the
 * whole time. That is filled in there rather than here, so that a skipped
 * heading still fails the ordinal-set check and still earns a re-ask — the
 * signal that the model is reading the right blocks is worth keeping. GPT Sol's
 * review of stage 1, 2026-08-31, finding 9.
 */
function onto(
  seen: Map<number, string>,
  batch: Batch,
  ordinals: number[],
): Record<string, string> {
  return Object.fromEntries(
    ordinals.map((n) => {
      const b = batch.blocks[n - 1]!;
      return [b.id, isHeading(b) ? b.text : seen.get(n)!];
    }),
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
 *
 * **It returns how many labels it was able to vote with**, so that a caller can
 * tell "checked, and clean" from "could not check". Silence is the right answer
 * for the article and the wrong answer for a caller deciding whether the guard
 * it promised actually ran — `acceptGap` is that caller, and before 2026-08-30
 * it could not ask. A `void` return made the two indistinguishable, which is the
 * shape of docs/reusable/silent-success.md applied to a guard rather than to a
 * result.
 */
export function detectShift(labels: Record<string, string>, batch: Batch): number {
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

  if (evidence < MIN_SHIFT_EVIDENCE) return evidence;

  const ahead = votes.get(1)!;
  const behind = votes.get(-1)!;
  const displaced = Math.max(ahead, behind);
  const own = votes.get(0)!;

  /* Both conditions, and both are needed. A clear majority pointing the *same*
     way is what distinguishes a shift from an article whose paragraphs simply
     resemble each other; requiring the correct alignment to have collapsed is
     what stops a batch where most labels are right and a few are odd. */
  if (displaced / evidence < SHIFT_MAJORITY) return evidence;
  if (own / evidence > SHIFT_OWN_CEILING) return evidence;

  const which = ahead > behind ? "the paragraph after it" : "the paragraph before it";
  throw new LabelsShifted(
    `${displaced} of ${evidence} nav labels in this batch match ${which} better than the one ` +
      `they were written for, and only ${own} match their own. The model wrote a label for every ` +
      `paragraph it was asked about and lost its place inside them, which the paragraph-number ` +
      `check cannot see. Nothing has been written.`,
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
  /**
   * Blocks a batch consciously gave up on — see `acceptGap`, which is the only
   * thing allowed to put an id in here, and only after two calls have failed to
   * label it and the gap has been measured against the batch's budget.
   *
   * **The gate is unchanged for everything else, and that is the point of
   * passing the list rather than a count.** A block with no label and no reason
   * on record is still the failure this function was written for — a gap
   * *between* batches, which no per-batch check can see. Taking a number here
   * would have made "one block lost in the seams" and "one block the model
   * refused" the same thing, and they need opposite responses.
   */
  dropped: string[] = [],
): void {
  const allowed = new Set(dropped);
  const missing = blocks.filter((b) => isStructural(b) && !labels[b.id] && !allowed.has(b.id));
  if (missing.length > 0) {
    const wanted = blocks.filter((b) => isStructural(b)).length;
    throw new Error(
      `The nav labels cover ${wanted - missing.length - allowed.size} of ` +
        `${wanted} paragraphs — ${missing.length} came back ` +
        `without one (${missing.slice(0, 3).map((b) => b.id).join(", ")}), and no batch reported ` +
        `dropping ${missing.length === 1 ? "it" : "them"}. Every batch is checked against the ` +
        `exact set it was asked about, so this is a gap between the batches rather than inside ` +
        `one. Nothing has been written.`,
    );
  }

}

/**
 * **The drops, taken together, against the article's own floor.**
 *
 * `assertEveryBlockLabelled` above is about a gap nobody claimed. This is the
 * other failure, and it is the one made entirely of legitimate parts:
 * `droppedBudget` is per batch and cannot see the article, so twenty small
 * sibling sets each spending their one-label floor stay inside budget twenty
 * times over and cost a fifth of the piece its rows. `COVERAGE_FLOOR` is the
 * backstop for exactly that.
 *
 * **Here rather than in the caller, because there are two callers.**
 * `generateToc` applied the floor after its merge and `npm run labels -- <dir>`
 * did not — it merged and rewrote `tree.json` with nothing between a
 * heavily-dropped run and the disk. So the advertised backstop depended on which
 * supported command you typed, which is the same fault `assertCoversEveryBlock`
 * and `assertEveryBlockLabelled` were both moved in here to fix. `checkCoverage`
 * in src/toc.ts still runs on the pipeline path and is not redundant with this:
 * it counts labelled *leaves of the tree*, so it is the one that would notice a
 * merge losing labels this function never hears about. GPT Sol, finding 4.
 *
 * Its own function rather than a second half of the one above, because they
 * refuse different things and the tests for them should be able to fail
 * separately.
 */
export function assertInsideCoverageFloor(dropped: string[], blocks: Block[]): void {
  if (dropped.length === 0) return;
  const wanted = blocks.filter((b) => isStructural(b)).length;
  if (wanted === 0) return;
  const covered = (wanted - dropped.length) / wanted;
  if (covered >= COVERAGE_FLOOR) return;
  throw new Error(
    `The nav labels cover ${wanted - dropped.length} of ${wanted} paragraphs — ` +
      `${dropped.length} were dropped by the batches that asked for them ` +
      `(${dropped.slice(0, 3).join(", ")}). A batch may leave a paragraph or two of itself bare ` +
      `when the model will not label them (see droppedBudget), and that is what the ` +
      `${Math.round((1 - COVERAGE_FLOOR) * 100)}% here is for; this is past it. Look at how the ` +
      `article was cut into batches — a piece in many small sibling sets can spend a floor of ` +
      `one over and over and stay inside every per-batch budget. Nothing has been written.`,
  );
}

export interface LabelRun {
  labels: Record<string, string>;
  file: LabelsFile;
  batches: number;
  /** Sibling sets bigger than one call should be. Worth saying out loud; see `oversizedSets`. */
  oversized: number;
  /**
   * Blocks this run gave up on, in document order — **usually empty, and it has
   * to be looked at anyway.**
   *
   * A dropped block is a leaf with no `navLabel`, and that renders as *nothing*:
   * the outline skips the row (src/web/outline.ts), the spine draws an empty
   * string. There is no error, no gap, no mark. So the only place a reader of
   * this system can find out that an article quietly lost ten labels is this
   * number, which is why `acceptGap` exists on the condition that every caller
   * reports it — the CLI prints it, the pipeline logs it, `labels.json` records
   * it, and the eval reads it from there. docs/reusable/silent-success.md.
   */
  dropped: string[];
  /**
   * Batches taken from a checkpoint instead of being asked for again.
   *
   * Reported rather than folded into `batches`, because a run that resumed nine
   * of ten batches and a run that made ten calls produce the same labels and
   * cost twenty times different amounts. A resume that silently stopped
   * resuming would show up here and nowhere else — the labels would still be
   * right.
   */
  resumed: number;
  /**
   * **Requests this run actually made**, which is at least `batches` minus
   * `resumed` and more whenever a batch was repaired or re-drawn.
   *
   * Needed to read the cache figures at all. A run of one fresh call has
   * nothing to read a cache back from, and a fully resumed run made no request
   * to read one with; both report zeros that mean nothing is wrong.
   *
   * **It was the batch count until 2026-08-30, under this comment.** A repaired
   * batch makes two requests and produces one record, so `paid.length` reported
   * one — and the one thing this number exists for is to say whether a zero in
   * `cacheReadTokens` is expected. A two-request batch reporting one call made a
   * cache that had stopped hitting indistinguishable from a run with nothing to
   * read, which is the failure this field was added to prevent, arriving inside
   * the field itself. GPT Sol's review of stage 1b, finding 5.
   */
  calls: number;
  /**
   * Whether the shared prefix looked long enough for the cache to take it.
   *
   * **An estimate, and named like one.** `cacheReadTokens: 0` has several
   * causes needing opposite responses: a prefix under the model's floor
   * (nothing to do), a run that made one call or none (nothing to read), and a
   * cache that has stopped hitting (a bug worth chasing). This field plus
   * `calls` separate the first two from the third; on its own it does not, and
   * the first version of this comment claimed it did. GPT-5.6-sol, 2026-08-26.
   * docs/reusable/silent-success.md.
   */
  estimatedCacheable: boolean;
  /**
   * **This run's calls only** — a resumed batch contributes nothing here, since
   * nobody paid for it this time. The per-batch figures in `file.batches` are
   * the other convention: they describe the call that produced each label set
   * whenever it happened, which is what an artefact should say. The two
   * therefore do not add up on a resumed run, on purpose.
   */
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
  /**
   * Throw the working state away — **call it once the artefacts are stored**,
   * not when this function returns.
   *
   * The gap is the whole point. If `generateLabels` deleted the checkpoint
   * itself, a caller that crashed between here and storing `labels.json` would
   * have lost every batch it had just paid for, which is the case the
   * checkpoint exists for. A no-op when no `dir` was given, and harmless to
   * forget: a checkpoint left behind is read by the next run, matched
   * fingerprint by fingerprint, and either reused correctly or ignored.
   *
   * **So what it protects is money, not consistency** — worth saying because
   * the gap looks like a crash-safety property and has twice been written down
   * as one. Nothing is inconsistent if this is never called; the next run pays
   * again if it is called too early.
   *
   * `generateToc` does not call it at all: it passes this function out on
   * `TocRun` so that the caller that stores the three artefacts is the one that
   * closes the gap, which on the pipeline path is after the store has them
   * rather than after this function returns.
   */
  clearCheckpoint: () => Promise<void>;
}

/**
 * One call: the batch, or — when `only` is given — the gap left by the last one.
 *
 * **The shortfall re-ask sends the same two parts plus a third**, rather than
 * building a smaller batch out of the missing blocks. Two reasons, and the first
 * is the rule the whole stage rests on: a label's job is to tell its paragraph
 * apart from its neighbours, so the model has to see the neighbours, and a
 * batch of one paragraph is exactly the shape that cannot. The second is the
 * cache — the shared prefix is byte-identical to the first attempt's, so the
 * re-ask reads it rather than writing a new one.
 *
 * What it saves is therefore the *answer*, not the question: the reasoning and
 * the output for fifty-seven labels already bought. That is the honest
 * accounting, and it is worth having — output is where a label batch's cost and
 * its whole latency sit.
 */
async function runBatch(
  batch: Batch,
  blocks: Block[],
  outline: string,
  signal: AbortSignal | undefined,
  headroom: number,
  only?: number[],
): Promise<{ labels: Record<string, string>; record: LabelBatchRecord }> {
  const started = Date.now();
  const answerTokens = 200 + (only ?? batch.blocks).length * 55;
  const maxTokens = budgetFor("nav labels", answerTokens, headroom);
  const { shared, own } = batchParts(batch, blocks, outline);

  /* The request itself, wrapped: a 429/401/etc from the SDK is not caught
     anywhere upstream of here, and the installed SDK builds `Error.message`
     from the upstream error body — the one place it can echo back part of
     what we sent, which is the whole article. See src/anthropic-call.ts.

     `streamMessage` builds the client, and sets `logLevel: "off"` on it — a
     privacy setting rather than a preference. The SDK has a logger of its own
     that defaults to `console` and reads `ANTHROPIC_LOG` from the environment;
     at `debug` it prints the outgoing request — **which is the whole article**
     — and, for a non-JSON error response, the raw upstream body. Neither goes
     through Pino, so neither can be redacted, and `anthropicCallFailed` never
     sees them. One environment variable, set by somebody debugging something
     else, and every article this app has read is on stdout. See
     docs/project/logging.md.

     It also builds the client *per call*, which is what keeps the property the
     old lazy `clientFor` existed for: a run that resumes every batch from a
     checkpoint reaches this function never, so it needs no API key to say so.
     That is what makes the resume path testable without a network or a
     credential — the only way a test can prove a resumed batch did not quietly
     go and ask again.

     **`call.finalMessage()`, never `call.stream.finalMessage()`** — the
     wrapper is what records what this call cost; the stream's own method works
     and records nothing. See src/messages-stream.ts. */
  let message: Anthropic.Message;
  try {
    message = await streamMessage(
      "labels",
      {
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
              /* The re-ask, last, so the two parts above stay byte-identical to
                 the attempt that just failed — the first of them is the cached
                 prefix, and a third part appended after it cannot disturb that. */
              ...(only ? [{ type: "text" as const, text: renderShortfall(only) }] : []),
            ],
          },
        ],
      },
      { ...(signal ? { signal } : {}) },
    ).finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  /* Built here, above every throw below it, because a call that failed still
     cost what it cost. Without this the tokens of a truncated attempt, or of a
     shortfall's first draw, would vanish from `labels.json` and from the run's
     figures — the ledger would still have them (src/ai-spend.ts records at the
     wire), so the artefact and the bill would disagree, quietly, on exactly the
     runs where somebody is looking. It used to sit below the refusal and
     truncation checks and above the parse, which got the shortfall half of that
     right and lost the truncation half. */
  const record: LabelBatchRecord = {
    blocks: batch.blocks.map((b) => b.id),
    setStarts: batch.setStarts,
    /* One request, by definition: this function makes exactly one. `sumRecords`
       is where two of these become a two-request batch. */
    requests: 1,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    ms: Date.now() - started,
  };

  if (wasRefused(message)) {
    /* `stop_details` is deliberately neither thrown nor logged — it is the
       provider's own words about a request that carried the whole article,
       and this error is copied onto the job and shown on the progress card.
       See MODEL_REFUSED in src/messages.ts. */
    throw new Error(MODEL_REFUSED.message);
  }
  if (message.stop_reason === "max_tokens") {
    /**
     * The one truncation in the pipeline that is **not** tagged `bug`, and the
     * only place that still takes the bare sentence.
     *
     * The other five stages throw `truncationFailure`, which carries a
     * `failureKind` so the job card withholds Retry (src/job-failure.ts). This
     * one must not, for two reasons, and either alone would be enough:
     *
     * 1. **The stage already answers a truncation itself.** `BatchIncomplete`
     *    is caught below and the batch is re-run with double the headroom, so
     *    "another attempt is unlikely to differ" is not true here — we have not
     *    made the same attempt twice.
     * 2. **This error never reaches a job anyway.** If the retry also fails,
     *    what escapes is a fresh `Error` combining both messages — and the
     *    second failure is often a 429 or a refusal rather than a truncation,
     *    which is exactly the case where hiding the button would be wrong.
     *
     * So the kind is dropped on purpose, at the one site where dropping it is
     * the right answer, rather than by omission at six.
     */
    throw new BatchIncomplete(
      truncatedMessage("nav labels", maxTokens, answerTokens, {
        outputTokens: message.usage.output_tokens,
        answerChars: raw.length,
      }, headroom),
      undefined,
      record,
    );
  }

  let labels: Record<string, string>;
  try {
    labels = only ? parseShortfall(raw, batch, only) : parseLabels(raw, batch);
  } catch (err) {
    if (err instanceof BatchIncomplete) {
      throw new BatchIncomplete(err.message, err.shortfall, record);
    }
    throw err;
  }
  /* Not on the re-ask. `detectShift` needs `MIN_SHIFT_EVIDENCE` labels before
     it will vote at all, so a call that answered about one paragraph could only
     ever abstain — and the set worth checking is the merged one, which is where
     `repairShortfall` checks it. */
  if (!only) {
    try {
      detectShift(labels, batch);
    } catch (err) {
      /* Re-thrown carrying the record, for the same reason the two throws above
         do: this call is paid for whether or not we keep its answer, and a
         first draw whose cost disappeared would understate a truncation retry's
         batch by half. `LabelsShifted` is the only thing `detectShift` throws. */
      if (err instanceof LabelsShifted) throw new LabelsShifted(err.message, record);
      throw err;
    }
  }

  return { labels, record };
}

/**
 * The re-ask, as the model reads it.
 *
 * Deliberately short and deliberately not an argument. The paragraphs it names
 * are the ones a compliant model *chose* to skip — on the article this was
 * built for, a lead-in fragment whose entire text is the word "or", where
 * "6–20 words, a CLAIM or a MOVE" and "never introduce a fact that is not in
 * that paragraph" cannot both be obeyed. Prompting harder at that is asking for
 * an invented fact, so what this says instead is: shorter is fine, the
 * paragraph's own words are fine, just do not leave it out.
 */
export function renderShortfall(missing: number[]): string {
  return (
    `Your last answer left out ${paragraphList(missing)}.\n\n` +
    `Write labels for ONLY ${missing.length === 1 ? "that paragraph" : "those paragraphs"}, ` +
    `in the same format: {"labels": [[n, "…"]]}, with one pair for each of ` +
    `${missing.join(", ")} and no others.\n\n` +
    `If a paragraph is a fragment with little in it, a short label made of its own words is ` +
    `fine — better than none. Do not invent anything it does not say.`
  );
}

/**
 * Ask again for the paragraphs the last call skipped, and merge the two answers.
 *
 * The labels already paid for are kept. That is the whole saving and it is the
 * whole risk too: a label written in the first call was written beside the
 * neighbours it has to be told apart from, and one written here was written
 * beside the same ones, so the two are comparable — which is exactly what would
 * *not* be true if the re-ask had been given a fresh batch of one paragraph.
 * `renderShortfall` is appended to the original prompt for that reason.
 *
 * `detectShift` runs on the merged set rather than on either half, because the
 * merged set is the one about to be written — and because it is the larger of
 * the two, so it is the one with the best chance of clearing
 * `MIN_SHIFT_EVIDENCE` at all.
 *
 * **What this comment used to claim, and it was wrong.** It said neither half
 * alone could reach `MIN_SHIFT_EVIDENCE`, offered as the reason the halves are
 * not worth checking separately. A half is the whole batch minus a handful of
 * labels; on any batch of a dozen or more it reaches the threshold easily. What
 * is true, and what the sentence was reaching for, is that the two sets can
 * fall on *opposite sides* of the threshold — twelve votes and eleven — which is
 * precisely why a shift found here must never be handed to `acceptGap` to
 * re-decide on the smaller set. See `LabelsShifted`.
 */
async function repairShortfall(
  first: BatchCameBackShort,
  batch: Batch,
  blocks: Block[],
  outline: string,
  signal: AbortSignal | undefined,
): Promise<{ labels: Record<string, string>; record: LabelBatchRecord }> {
  /* `LABEL_HEADROOM`, not double it. The reservation is for the model's
     reasoning about *this answer*, and this answer is a handful of labels —
     doubling it here would be inheriting a number from a failure this one is
     not (see the constant's own comment, and docs/postmortems/toc-max-tokens.md
     on what a roomy reservation does to adaptive thinking). */
  const again = await runBatch(
    batch,
    blocks,
    outline,
    signal,
    LABEL_HEADROOM,
    first.shortfall.missing,
  );
  const labels = { ...first.shortfall.partial, ...again.labels };
  const record = sumRecords(batch, [first.record, again.record]);
  try {
    detectShift(labels, batch);
  } catch (err) {
    /* Carrying the cost of *both* requests, so the caller reporting this batch
       as a failure still reports what it spent. */
    if (err instanceof LabelsShifted) throw new LabelsShifted(err.message, record);
    throw err;
  }
  return { labels, record };
}

/**
 * How much of the article the labels have to reach. **Almost all of it.**
 *
 * This has been 0.95, then 1, and is 0.95 again. The number matters less than
 * which argument it is standing on, so here are all three.
 *
 * It was **0.95** when one model call wrote the whole tree, because the model
 * was allowed to skip a trivial transition sentence — an unlabelled gistable
 * leaf is still only a *warning* in [validate-tree.ts](./validate-tree.ts) for
 * that reason (docs/project/table-of-contents.md). The floor told a used escape
 * hatch apart from an answer that had quietly stopped early.
 *
 * It was tightened to **1** when the label pass split out, on the argument that
 * *"there is no longer a path by which a block is legitimately unlabelled"*:
 * every batch is asked for an exact set of numbered paragraphs and refuses any
 * other set, and `planBatches` puts every gistable block in exactly one batch.
 *
 * **That argument is now false, and the failure that falsified it is why this
 * is 0.95 again.** A production ingest died twice on one absent label out of
 * fifty-eight, on a paragraph whose entire text was the word "or" — stage 3 had
 * stripped the code cell the fragment pointed at, leaving the label prompt's
 * "6–20 words, a CLAIM or a MOVE" and its "never introduce a fact that is not in
 * that paragraph" jointly unsatisfiable, so skipping was the compliant move and
 * no retry could change it. This file now re-asks for the gap alone and, if
 * that fails too, may accept the batch and leave those leaves bare. So the path
 * exists again, deliberately, and it is bounded rather than open.
 *
 * **This is the backstop, not the bound.** The real bound is `droppedBudget` below — 2% of a batch, floor of one — and it is per batch, which is
 * the only place a model's behaviour on one call can be judged. What that bound
 * cannot see is the composition of the whole article: twenty small sibling sets
 * each spending their floor of one would stay inside budget every time and still
 * cost a fifth of the article its rows. This floor is what refuses that, and it
 * is the number to move if the drops ever become normal rather than rare.
 *
 * Every real tree came back at 100% under the original rule: 29 of 29, 117 of
 * 117, 18 of 18. That is still what a healthy article looks like, and
 * `LabelRun.dropped` — printed by the CLI, logged by the step, recorded in
 * `labels.json` — is how anybody finds out it has stopped being.
 *
 * **Moved here from src/toc.ts on 2026-08-31, and it is applied here now too.**
 * `generateToc` checked it after its merge and `npm run labels -- <dir>` did
 * not, so the advertised backstop depended on which supported entry point ran:
 * twenty small batches each spending their floor could publish a tree missing a
 * fifth of its rows through the standalone command and be refused through the
 * pipeline. `assertEveryBlockLabelled` is where both callers pass, so that is
 * where the floor is enforced — the same argument `assertCoversEveryBlock` makes
 * one step earlier. GPT Sol's review of stage 1b, finding 4.
 */
export const COVERAGE_FLOOR = 0.95;

/**
 * How many labels one batch may lose before the batch is a failure.
 *
 * **Per batch, not per article**, which is the same shape the R2 repair budget
 * took after review (docs/plans/toc-repairs-and-heading-tree.md): a bound spread
 * over a whole article lets one pathological section spend everybody else's
 * allowance, and the thing being bounded is a model's behaviour on one call.
 *
 * Two percent, with `Math.max(1, …)` in front of it. Above fifty blocks the
 * percentage is what decides — 2 on a batch of 58, which is the size the article
 * that prompted this produced.
 *
 * **The `max` is belt-and-braces and its old comment argued for something that
 * cannot happen.** It said two percent of a 12-block batch "rounds to nothing",
 * which `Math.ceil` never does: `ceil(0.02 × 1)` is already 1, so every batch
 * with a block in it has a budget of at least one without the `max`. Left in
 * place rather than deleted — it costs nothing and it states the intent, which
 * is that no batch is ever held to a rule of zero — but nobody should read it as
 * load-bearing. Noticed while acting on GPT Sol's stage 1 review, 2026-08-31.
 *
 * **What actually bounds a small batch now is `acceptGap`, not this.** Partial
 * acceptance requires the shift check to have run, and that needs
 * `MIN_SHIFT_EVIDENCE` labels with lexical signal — so a batch of a dozen or
 * fewer cannot spend this budget at all: it fails instead. That is deliberate
 * (a set nothing could check is not a set to publish) and it means the floor of
 * one is reachable only from about thirteen blocks upwards.
 *
 * The article-level backstop is `COVERAGE_FLOOR` above, enforced by
 * `assertInsideCoverageFloor`, and it is not redundant with this: the
 * composition of an article's batches is invisible from here, and a piece cut
 * into small sibling sets could spend a floor of one over and over and lose more
 * of its labels than the article may lose while every batch stayed inside
 * budget.
 */
export function droppedBudget(batchSize: number): number {
  return Math.max(1, Math.ceil(0.02 * batchSize));
}

/** What `acceptGap` decided, and — when it said no — the sentence saying why. */
type GapDecision =
  | {
      kind: "accept";
      out: { labels: Record<string, string>; record: LabelBatchRecord };
      dropped: string[];
    }
  | { kind: "refuse"; why: string };

/**
 * Take a batch with a hole in it — or refuse to, which is the important half.
 *
 * Accepts only when **both** attempts came back short (so there is a partial
 * answer to keep and a gap the model named twice), the surviving gap is inside
 * `droppedBudget`, and `detectShift` had enough labels to actually run. Any
 * other failure — a truncation, a refusal, a 429, a malformed shape — refuses,
 * and the refusal says which of those it was, because "it failed twice" on its
 * own leaves whoever is reading to guess between four different faults.
 *
 * **What this re-opens.** `COVERAGE_FLOOR` was tightened to 1 in 2026-08 on the
 * argument that a block could no longer be legitimately unlabelled; this is the
 * path that makes that false again, and an unlabelled leaf renders as *nothing*
 * rather than as an error (src/web/outline.ts skips the row). So the price of it
 * is that every drop is named, counted, returned on `LabelRun`, written into
 * `labels.json` and logged by the step — docs/reusable/silent-success.md, and
 * the "the eval had to be told" lesson applied before rather than after.
 */
function acceptGap(first: BatchIncomplete, again: unknown, batch: Batch): GapDecision {
  if (!cameBackShort(first)) {
    return { kind: "refuse", why: "" };
  }
  /**
   * **Both, and until 2026-08-31 only the first was required.**
   *
   * The warrant for leaving a paragraph bare is *the model would not write this
   * one* — and the only evidence for that is a second well-formed answer that
   * skipped it again. A truncation, a refusal, a 429 or a malformed shape says
   * nothing about the paragraph at all: it is one omission followed by no
   * usable answer, which is a transient to retry rather than a fragment to
   * forgive. Accepting on the first error alone also let a *detected shift*
   * through, because the merged-set check throws without a shortfall — see
   * `LabelsShifted`. GPT Sol's review of stage 1, 2026-08-31, findings 1 and 2.
   */
  if (!cameBackShort(again)) {
    return {
      kind: "refuse",
      why:
        `The second attempt did not come back short — it failed outright, so nothing says the ` +
        `model will not write these labels rather than that this attempt fell over.`,
    };
  }
  /* The re-ask's own partial answer counts. Two paragraphs missing and one of
     them repaired is one label dropped, not two — and refusing to look would
     throw away the call we just paid for. */
  const labels = { ...first.shortfall.partial, ...again.shortfall.partial };
  const record = sumRecords(batch, [first.record, again.record]);

  /* A heading's label is the heading, and `onto` already takes it off the block
     rather than from the model — so a heading the model never numbered is not
     an unlabellable paragraph, it is a label we are holding. Filling it in here
     costs the budget nothing and stops the outline showing a bare row for a
     block whose text is right there. GPT Sol, 2026-08-31, finding 9. */
  const still: number[] = [];
  for (const n of first.shortfall.missing) {
    const block = batch.blocks[n - 1]!;
    if (block.id in labels) continue;
    if (isHeading(block)) labels[block.id] = block.text;
    else still.push(n);
  }

  const budget = droppedBudget(batch.blocks.length);
  if (still.length > budget) {
    return {
      kind: "refuse",
      why:
        `${still.length} of the batch's ${batch.blocks.length} paragraphs are still unlabelled, ` +
        `past the ${budget} a batch this size may lose.`,
    };
  }
  /**
   * **And these labels have never been shift-checked.**
   *
   * `runBatch` checks after the parse, and on a short answer the parse throws
   * first — so without this line the one wrong answer `parseLabels` cannot see
   * arrives by the one path that skips the check that can. Nineteen confident
   * labels on the wrong nineteen paragraphs, no gap, nothing red: worse than the
   * failure the accept exists to avoid. It throws rather than refusing, because
   * "the model lost its place" is a better thing to put in front of whoever is
   * reading than "it failed twice".
   *
   * **The evidence count is why this returns a number**, and it is the second
   * half of the same guarantee. `detectShift` abstains below
   * `MIN_SHIFT_EVIDENCE`, which is 12 — so a batch of twelve with a surviving
   * gap offers eleven labels and the check cannot fire even on a total shift.
   * `planBatches` has no minimum batch size, so that is a reachable shape and
   * not a hypothetical one. Accepting there would be publishing an unchecked set
   * under a comment claiming it was checked, so it refuses instead: a failed
   * ingest is loud and a displaced set of labels is not. GPT Sol, finding 3.
   */
  const evidence = detectShift(labels, batch);
  if (evidence < MIN_SHIFT_EVIDENCE) {
    return {
      kind: "refuse",
      why:
        `The ${Object.keys(labels).length} labels this batch did produce could not be checked for ` +
        `a displacement: only ${evidence} of them carry enough lexical signal to vote, against ` +
        `the ${MIN_SHIFT_EVIDENCE} that check needs. A batch is only kept with a gap in it when we ` +
        `can still say the rest of it landed on the right paragraphs.`,
    };
  }
  return {
    kind: "accept",
    out: { labels, record },
    /* Possibly empty, and that is now reachable rather than impossible: every
       still-missing ordinal may have been a heading, in which case the batch is
       whole and cost nothing from the budget. */
    dropped: still.map((n) => batch.blocks[n - 1]!.id),
  };
}

/**
 * Two calls for one batch, added up.
 *
 * The batch is still one batch — `blocks` and `setStarts` describe what was
 * asked about, not how many requests it took — but the money is the sum, and
 * `ms` is too. Reporting only the second call's usage would make a batch that
 * cost twice look cheap in `labels.json` while the ledger recorded the truth,
 * and the two disagreeing is worse than either number alone.
 */
function sumRecords(batch: Batch, parts: (LabelBatchRecord | undefined)[]): LabelBatchRecord {
  const real = parts.filter((r): r is LabelBatchRecord => r !== undefined);
  const total = (pick: (r: LabelBatchRecord) => number): number =>
    real.reduce((n, r) => n + pick(r), 0);
  return {
    blocks: batch.blocks.map((b) => b.id),
    setStarts: batch.setStarts,
    /* The one field that is a count of *calls* rather than a sum of what they
       bought, and it is the whole reason this record can be told apart from a
       one-request batch afterwards. `?? 1` for a record read back out of a
       `labels.json` written before the field existed. */
    requests: total((r) => r.requests ?? 1),
    inputTokens: total((r) => r.inputTokens),
    outputTokens: total((r) => r.outputTokens),
    cacheReadTokens: total((r) => r.cacheReadTokens),
    cacheWriteTokens: total((r) => r.cacheWriteTokens),
    ms: total((r) => r.ms),
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
 *
 * A batch that comes back *short* — well-formed, and quietly about fewer
 * paragraphs than it was asked about — takes the other route: `repairShortfall`
 * asks again for the gap alone, and if that fails too `acceptGap` may keep the
 * batch and leave a bounded number of leaves bare. Whatever it leaves bare comes
 * back in `dropped`, and every caller of this function is expected to say so out
 * loud.
 */
export async function generateLabels(opts: {
  tree: Tree;
  blocks: Block[];
  slug: string;
  /**
   * Where to keep the checkpoint. **No directory, no checkpoint** — and that is
   * a real choice rather than a default, which is why it is not silently the
   * article's directory: a caller that has one passes it, and a caller that
   * does not (a test, a one-off) gets the old behaviour with nothing on disk.
   * The run reports how many batches it resumed, so a caller that meant to
   * checkpoint and did not can see it in the numbers.
   */
  dir?: string;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
}): Promise<LabelRun> {
  const started = Date.now();
  const batches = planBatches(opts.tree, opts.blocks);
  const outline = renderOutline(opts.tree);
  /* No client is built here, and that is deliberate rather than an omission:
     `streamMessage` builds one per call inside `runBatch`, so a run that
     resumes every batch from a checkpoint makes no call and needs no API key to
     say so. The privacy setting that used to be spelled out at this line
     (`logLevel: "off"`, and why it is not a preference) now lives with the call
     in `runBatch`. */
  const sourceHash = hashBlocks(opts.blocks);
  const manifest = {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    sourceHash,
  };

  /* **Fail fast, and stop paying.** Without this, a 429 that outlives the SDK's
     own retries rejects the `Promise.all` while every other batch carries on to
     completion — a doomed run that keeps buying answers nobody will read. On
     the constitution that is seven wasted calls; at the book scale this stage
     exists for it is the whole run, every time, for one transient.

     One controller, linked to the caller's signal rather than replacing it, so
     a cancelled ingest (src/jobs.ts) still cancels this. `queue.clear()` on its
     own would not have done: p-queue never settles a cleared task's promise, so
     `Promise.all` would wait forever on batches that will now never run.
     GPT-5.6-sol, 2026-08-26. */
  const fatal = new AbortController();
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, fatal.signal])
    : fatal.signal;

  const checkpointPath = opts.dir ? path.join(opts.dir, CHECKPOINT_FILE) : null;
  /* Whose checkpoint this is. Two processes labelling the same directory is not
     a supported thing to do, but `clearCheckpoint` deleting the *other* one's
     live working state would be a silent, expensive way to find that out — so
     the delete checks the file still says this run wrote it. Random rather than
     derived, because two runs of the same article against the same tree would
     derive the same id, which is exactly the pair that must not match. */
  const runId = randomUUID();
  const resumable = checkpointPath
    ? usableCheckpoint(await readJsonIfPresent(checkpointPath), manifest)
    : new Map<string, LabelCheckpointEntry>();
  /* Only the entries this run's own plan asks for. A checkpoint left by a run
     against a different tree can share this article's source hash — the blocks
     did not change, the boundaries did — and every one of its batches will
     simply fail to match a fingerprint below. Keeping the whole map and writing
     it back out would carry those stale entries forward for ever. */
  const kept: LabelCheckpointEntry[] = [];
  const writeCheckpoint = checkpointPath
    ? serialise(async () => {
        /* A batch that was already inside this write when the run was abandoned
           would otherwise put the file back after a later run had cleared it.
           p-queue can reject a running task's promise but cannot stop the
           callback, so the callback has to look. GPT-5.6-sol, 2026-08-26. */
        if (signal.aborted) return;
        await writeAtomic(checkpointPath, {
          ...manifest,
          runId,
          batches: kept,
        } satisfies LabelCheckpoint);
      })
    : async (): Promise<void> => {};
  /* **The warm-up, and the condition it now carries.** All these batches share
     the outline as their cached prefix, and a cache entry cannot be *read*
     until the request that writes it has begun streaming — so firing four at
     once into a cold cache has all four pay the write premium and none get the
     discount. Running the first batch alone fixes that, at the cost of one
     batch's latency.

     But only when there is a cache to warm. Sonnet 5 will not cache a prefix
     under 1,024 tokens, and on both committed articles this prefix — the system
     prompt plus the outline — is well under it: roughly 660 tokens on the
     141-block article and 950 on the 360-block one. So the serialisation was
     buying a discount that could not exist, and paying a whole batch of latency
     for it, on every run of the stage, with nothing anywhere reporting the
     trade. It is the exact shape of docs/reusable/silent-success.md: the labels
     were right, the cache figures were zero, and zero was the number a working
     cache would have shown too.

     `estimatedCacheable` is returned so the zero can be read — and it is named
     for what it is, an estimate at four characters a token, after a review
     pointed out that the first name promised a distinction it could not make on
     its own. A zero is *also* expected when every batch resumed or only one
     fresh call ran, so `calls` comes back beside it. GPT-5.6-sol, 2026-08-26.
     See docs/research/prompt-caching-anthropic.md § Concurrency and
     docs/project/prompt-caching.md § The floor. */
  const prefix = batches[0] ? batchParts(batches[0], opts.blocks, outline).shared : "";
  const estimatedCacheable = prefixIsCacheable(prefix);
  const queue = new PQueue({ concurrency: estimatedCacheable ? 1 : CONCURRENCY });

  let done = 0;
  let resumed = 0;
  /* Blocks a batch gave up on, from any batch, in whatever order the parallel
     calls finish. Sorted into document order before it leaves this function —
     a list whose order depends on the race is a list nobody can diff. */
  const dropped: string[] = [];
  const report = (): void =>
    opts.onProgress?.(`${done} of ${batches.length} sections labelled`);
  report();

  const results = await allOrStop(
    batches.map((batch) =>
      /* The signal goes to `add` as well as into the request. Without it a
         batch still sitting in the queue when a fatal one aborts would simply
         never run and never settle, and `Promise.all` would hang on a promise
         with nothing left to resolve it. */
      queue.add(async () => {
        const fingerprint = batchFingerprint(batch, opts.blocks, outline);
        const already = resumable.get(fingerprint);
        /* Checked against *this* batch, not merely against the file's manifest.
           `usableCheckpoint` can only ask whether an entry is well-formed; only
           here is it known which blocks the entry is supposed to be answering
           for. Without this, an entry carrying an extra id would quietly
           overwrite another batch's label, and the coverage gate at the end —
           which asks whether every block has one, not whether the right call
           wrote it — would pass. GPT-5.6-sol, 2026-08-26. */
        if (already && coversExactly(already, batch)) {
          kept.push(already);
          done++;
          resumed++;
          report();
          /* Written even though nothing new was bought. Two reasons, and the
             second one is a bug this had: it stamps the file with *this* run's
             id, without which a fully-resumed run would never have written the
             file at all and `clearCheckpoint` would then refuse to delete it as
             somebody else's — leaving working state behind for ever. And it
             compacts: entries the new plan does not ask for are dropped rather
             than carried forward run after run. */
          await writeCheckpoint();
          return { labels: already.labels, record: already.record, fromCheckpoint: true };
        }

        let out: Awaited<ReturnType<typeof runBatch>>;
        try {
          out = await runBatch(batch, opts.blocks, outline, signal, LABEL_HEADROOM);
        } catch (err) {
          /* Matched on the class, not on words in the message. A message test
             would go quietly dead the first time somebody improved the wording,
             and what it would then do is stop retrying — a change that shows up
             as a rarer, stranger failure rather than as anything red. */
          if (!(err instanceof BatchIncomplete)) throw err;
          try {
            /* **Two failures, two different retries**, and until 2026-08-30 they
               shared one. A truncation has nothing to keep and no idea what is
               absent, so the answer is room to think and the whole batch again.
               A well-formed answer that skipped a paragraph knows exactly which
               one — and re-buying the other fifty-seven to get it has now failed
               to help three times on record, byte-identically, because
               completions are never cached and `batchFingerprint` excludes
               `max_tokens` so the retry sends the same bytes. A short answer is
               the only failure that carries a `shortfall`, and that is what this
               branch reads — not the message, and not the error's name. */
            if (cameBackShort(err)) {
              out = await repairShortfall(err, batch, opts.blocks, outline, signal);
            } else {
              const redrawn = await runBatch(
                batch,
                opts.blocks,
                outline,
                signal,
                LABEL_HEADROOM * 2,
              );
              /* Both requests' usage, not just the one that worked. The first
                 attempt was truncated or displaced, and it was paid for; a
                 record holding only the re-draw would report a batch that cost
                 twice as half of what it cost, and `calls` would say one where
                 two requests went out. src/ai-spend.ts has the real number, and
                 the artefact quietly disagreeing with the ledger is worse than
                 either number alone. */
              out = {
                labels: redrawn.labels,
                record: sumRecords(batch, [err.record, redrawn.record]),
              };
            }
          } catch (again) {
            /* An abort is not a second model failure and must not be dressed as
               one. If another batch has already ended the run, or the caller
               cancelled the ingest, wrapping that in "failed twice" hands
               whoever reads the log a truncation story about a call that never
               happened. Rethrown as itself. GPT-5.6-sol, 2026-08-26. */
            if (signal.aborted) throw again;
            /**
             * **A displacement the repair found is not a gap, and must not be
             * offered to `acceptGap` as one.**
             *
             * `repairShortfall` merges the two answers and checks the merged
             * set, which is the right set to check. `acceptGap` would then throw
             * that verdict away and re-decide on the *first* call's partial set
             * — one label smaller, and `MIN_SHIFT_EVIDENCE` is exactly the sort
             * of threshold one label can sit either side of. Twelve votes
             * detects; eleven abstains; the run publishes twelve displaced
             * labels and calls the thirteenth a drop.
             *
             * `acceptGap` refuses a second error with no shortfall anyway, so
             * this line is the second of two locks on the same door — but it is
             * the one that puts the real finding in front of the reader instead
             * of "the second attempt failed outright". GPT Sol, finding 1;
             * tests/labels-shortfall.test.ts § "does not turn a shift the repair
             * found back into an accepted gap".
             */
            if (again instanceof LabelsShifted && cameBackShort(err)) {
              throw new Error(
                `The nav labels for one section came back short, and the repaired set is ` +
                  `displaced.\n` +
                  `  First attempt: ${err.message}\n` +
                  `  After the re-ask: ${again.message}`,
              );
            }
            /* **The bounded partial accept**, and it happens here rather than
               anywhere earlier on purpose: only at this line have both a full
               draw and a re-ask for the gap alone failed to produce a label, so
               only here is "the model will not write this one" a conclusion
               rather than a guess. `acceptGap` refuses — and says why — when the
               second attempt was not itself a shortfall, when the gap is bigger
               than a batch is allowed to lose, or when the batch was too small
               to shift-check what it would have kept; the throw below is then
               the same one it always was, with its reason appended. */
            const decision = acceptGap(err, again, batch);
            if (decision.kind === "refuse") {
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
                  `  Second attempt: ` +
                  `${again instanceof Error ? again.message : String(again)}` +
                  /* Why the gap was not forgiven, when there was a reason worth
                     a sentence. Without it the four different refusals — no
                     partial answer at all, a second failure that was not a
                     shortfall, a gap past the budget, a set too small to
                     shift-check — arrive as the same two lines above, and the
                     reader has to go and read `acceptGap` to tell which. */
                  (decision.why ? `\n  ${decision.why}` : ""),
              );
              /* No `cause`. src/log.ts follows cause chains, and src/parse-json.ts
                 spells out why that matters here: an attached original error puts
                 whatever it quoted straight back into the log line under a
                 different key. Both messages are already in the text above, which
                 is the part worth keeping. */
            }
            dropped.push(...decision.dropped);
            out = decision.out;
          }
        }
        done++;
        /* The first batch has now written the outline into the cache, so the
           rest can read it. Widening here rather than before the first call is
           the whole point; `concurrency` is settable on a live queue. */
        queue.concurrency = CONCURRENCY;
        report();

        /* Written before this batch's result is handed back, so a failure in
           the very next batch cannot lose it. The write is serialised: four
           batches landing at once would otherwise each read `kept`, each build
           a file, and the last rename would win, silently dropping the other
           three — a checkpoint that quietly holds less than it should is worse
           than no checkpoint, because the run that resumes from it pays again
           and reports success. */
        /* A partially-accepted batch is written here like any other, and a later
           run will not resume it: `coversExactly` demands an entry covering the
           batch's blocks exactly, and this one is short by whatever was dropped.
           That is the behaviour we want and it is worth saying out loud, because
           it looks like a bug — the next run buys the batch again and may come
           back whole, which is strictly better than resuming a known gap, and
           the alternative is loosening a guard whose job is to pin an entry to
           its own batch. */
        kept.push({ fingerprint, labels: out.labels, record: out.record });
        await writeCheckpoint();
        return { ...out, fromCheckpoint: false };
      }, { signal }),
    ),
    () => {
      /* One failed batch is the end of the run, so stop the rest before they
         cost anything more. `abort` cancels the in-flight requests through the
         signal each one was given; `clear` drops the ones that have not
         started. Both, because neither reaches the other's batches. */
      fatal.abort();
      queue.clear();
    },
  );

  const labels: Record<string, string> = {};
  /* Document order, because `results` follows `batches` — not the order four
     parallel calls happened to finish in, which is what `kept` holds. */
  const records: LabelBatchRecord[] = [];
  /* This run's own calls, for the token counts. See `LabelRun.inputTokens`. */
  const paid: LabelBatchRecord[] = [];
  for (const result of results) {
    if (!result) continue;
    Object.assign(labels, result.labels);
    records.push(result.record);
    if (!result.fromCheckpoint) paid.push(result.record);
  }

  /* Document order, so two runs of the same article produce the same list and a
     diff of two `labels.json` files means something. `results` is in batch
     order; `dropped` is in finish order, which is a race. */
  const order = new Map(opts.blocks.map((b, i) => [b.id, i]));
  dropped.sort((a, b) => order.get(a)! - order.get(b)!);

  assertEveryBlockLabelled(labels, opts.blocks, dropped);
  assertInsideCoverageFloor(dropped, opts.blocks);

  return {
    labels,
    file: {
      version: PROMPT_VERSION,
      generator: CAPABLE_MODEL,
      slug: opts.slug,
      sourceHash,
      structureHash: structureHash(opts.tree),
      structureVersion: opts.tree.version,
      labels,
      batches: records,
      dropped,
    },
    dropped,
    batches: batches.length,
    oversized: oversizedSets(batches).length,
    resumed,
    calls: paid.reduce((n, r) => n + (r.requests ?? 1), 0),
    estimatedCacheable,
    inputTokens: paid.reduce((n, r) => n + r.inputTokens, 0),
    outputTokens: paid.reduce((n, r) => n + r.outputTokens, 0),
    /* Summed the same way as the other two. In a healthy run one batch writes
       the outline and the rest read it, so writes should be roughly one batch's
       worth and reads the remainder — a run where writes scale with the batch
       count is one where the fan-out raced and nobody read anything. */
    cacheReadTokens: paid.reduce((n, r) => n + r.cacheReadTokens, 0),
    cacheWriteTokens: paid.reduce((n, r) => n + r.cacheWriteTokens, 0),
    elapsedMs: Date.now() - started,
    clearCheckpoint: async (): Promise<void> => {
      if (!checkpointPath) return;
      /* Only if it is still ours. A second process labelling the same directory
         would have overwritten this file with its own working state, and
         deleting that is an expensive, silent way to discover the collision. */
      const onDisk = await readJsonIfPresent(checkpointPath);
      const owner = (onDisk as Partial<LabelCheckpoint> | undefined)?.runId;
      if (owner !== undefined && owner !== runId) return;
      await rm(checkpointPath, { force: true });
    },
  };
}

/**
 * Wait for all of them, and on the first failure stop the rest.
 *
 * Its own function so it can be tested, because the thing it prevents costs
 * money rather than correctness and therefore has no natural alarm: without
 * `stop`, a batch that fails leaves every other batch running to completion,
 * buying answers for a run that has already been abandoned. Nine good labels
 * arriving after the tenth failed look exactly like nine good labels.
 *
 * **`Promise.all`, deliberately, and not a loop or `allSettled`.** It attaches
 * a handler to every promise before any of them can reject, so the failures
 * that arrive *after* the first one are handled rather than becoming unhandled
 * rejections — which on Node is a crashed process, arriving from what is
 * supposed to be the graceful path.
 */
export async function allOrStop<T>(work: Promise<T>[], stop: () => void): Promise<T[]> {
  try {
    return await Promise.all(work);
  } catch (err) {
    stop();
    throw err;
  }
}

/**
 * Read a JSON file, or nothing at all.
 *
 * A checkpoint that is missing, unreadable or not JSON is worth exactly the
 * same as one that is stale: nothing. So this returns `undefined` for all of
 * them rather than distinguishing failures the caller has no different
 * response to — and it deliberately does not throw, because the alternative to
 * resuming is a run that works and costs money, not a run that cannot happen.
 */
async function readJsonIfPresent(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return undefined;
  }
}

/**
 * Run an async function one at a time, however many callers ask at once.
 *
 * There are four batches in flight and each writes the whole checkpoint when it
 * lands. Without this they interleave — read `kept`, serialise, write, rename —
 * and the last rename wins, so a file that should hold four batches holds one
 * and nothing is red. The next run then re-buys three answers it had already
 * paid for and reports itself a success.
 *
 * A promise chain rather than a lock, because the only thing needed is "after
 * the one before". A rejection is swallowed into the chain so one failed write
 * cannot wedge every later one; the caller still sees it.
 */
export function serialise(fn: () => Promise<void>): () => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return () => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
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
  /* At the program's edge, not inside the gateway — see `messagesClient` in
     src/messages-stream.ts for the test that proved the difference. Without it
     this command answers `[ai-not-set-up]` on a machine where the key is right
     there in `.env.local`.

     **Before the first `await`**, which it was not until 2026-08-28: it sat
     below the two artefact reads. Nothing was wrong with that — neither read
     spends — but "the file is read before the work starts" is the property, and
     a rule that has to make an exception for which awaits are harmless is not a
     rule. tests/paid-cli-ledger.test.ts, and GPT Sol for the case that showed
     the old rule could not tell this shape from a genuinely late call. */
  loadEnvLocal();
  const tree = JSON.parse(await readFile(path.join(dir, "tree.json"), "utf-8")) as Tree;
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as {
    blocks: Block[];
  };
  console.log(`Labelling ${blocks.filter((b) => isStructural(b)).length} blocks with ${CAPABLE_MODEL}…`);
  const run = await generateLabels({
    tree,
    blocks,
    slug: path.basename(dir),
    dir,
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  const merged = mergeLabels(tree, run.labels);
  /* Beside-then-rename, and the tree second, for the same reason `main()` in
     src/toc.ts does it: `writeFile` truncates its target before it has anything
     to put there, so a process killed mid-write leaves a `tree.json` that exists
     and is not JSON — and existence is what src/pipeline.ts reads as "this step
     is done". This command rewrites the tree of an article somebody may already
     be reading, which makes it the worse of the two places to get this wrong.
     Both of those are command lines writing separate files. The `toc` *stage* no
     longer writes anything: it returns its three artefacts and its caller stores
     them in one go, where a half-written set is not a state that exists. */
  await writeAtomic(path.join(dir, "labels.json"), run.file);
  await writeAtomic(path.join(dir, "tree.json"), merged);
  /* Only now. Until both artefacts are on disk the checkpoint is the only copy
     of what this run bought. */
  await run.clearCheckpoint();

  console.log(`\n\nBatches:   ${run.batches}${run.resumed > 0 ? ` (${run.resumed} resumed)` : ""}`);
  if (run.oversized > 0) {
    console.log(
      `Warning:   ${run.oversized} section(s) are bigger than one call should be. The batches ` +
        `were not cut — siblings stay together — so those went out as single large calls. The ` +
        `fix is upstream, in how the structure call cuts sections.`,
    );
  }
  console.log(`Labelled:  ${Object.keys(run.labels).length} blocks`);
  /* The one number in this stage that is invisible everywhere else: a dropped
     label is a leaf with no row, which looks exactly like a leaf that was never
     supposed to have one. docs/reusable/silent-success.md. */
  if (run.dropped.length > 0) {
    console.log(
      `Dropped:   ${run.dropped.length} paragraph(s) left bare after a second ask ` +
        `(${run.dropped.slice(0, 3).join(", ")})`,
    );
  }
  console.log(`Tokens:    ${run.inputTokens} in, ${run.outputTokens} out (this run's calls only)`);
  /* Said out loud because the alternative is a pair of zeros in the cache
     figures that a broken cache would produce too. */
  console.log(
    run.estimatedCacheable
      ? `Cache:     ${run.cacheReadTokens} read, ${run.cacheWriteTokens} written over ${run.calls} call(s)`
      : `Cache:     off — the shared prefix is under the model's ${CACHE_FLOOR_TOKENS}-token floor`,
  );
  console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`\nEval:      npm run eval:toc -- ${dir}`);
}

/* **`stageCli`, not a bare `main()`.** Every batch here is a paid call, and
   without the collector open they land nowhere: not in `npm run cost`, and
   counted as unscoped by `unscopedCalls()` in src/ai-spend.ts. This was the only
   thing separating `npm run labels` from the six stages that already had it —
   tests/paid-cli-ledger.test.ts is what stops it happening again. Awaited rather
   than `void`ed, so flushing the ledger and any failure in it stay part of the
   command finishing. */
await stageCli(import.meta.url, main);

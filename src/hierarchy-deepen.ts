/**
 * **The scoped expansion call's checkpoint, and the loop around it.**
 *
 * [`hierarchy-cascade.ts`](hierarchy-cascade.ts) is the arithmetic — when a node
 * still needs splitting, how many parents one call may carry, how one answer's
 * starts become ranges. [`hierarchy-expand.ts`](hierarchy-expand.ts) is the
 * protocol — the prompt, the request, the strict reading of what comes back.
 * This is the third piece: **what a wave of those calls does about failing half
 * way through**, and it is the piece that decides whether an article that dies
 * in wave 2 costs one call again or all of them.
 *
 * It talks to a model only through `ExpansionExecutor`, a seam the caller
 * supplies, so the whole protocol still runs end to end with no network — which
 * is how every test in `tests/hierarchy-deepen.test.ts` runs.
 * docs/plans/260904d-deepen-fat-sections.md § stages 4 and 5.
 *
 * **`generateHierarchy` calls `deepenTree` since 2026-09-05, and the flag is
 * off.** `DEEPEN_ENV` is what turns it on; stage 8 is the decision to move it,
 * and until then this file is inert for every reader. What stage 5 added, past
 * the wiring: the width (`EXPANSION_CONCURRENCY`, derived rather than borrowed),
 * counted 429s that honour `Retry-After`, a wave that stops cleanly on the step's
 * deadline with its checkpoints written, and the live executor.
 *
 * **And what a cross-family review of that wiring changed, on 2026-09-05**, each
 * of which is a way a wave could look like it worked while quietly being wrong:
 * publication is all or nothing (`deepenTree` § "All of the wave, or none of
 * it"), an answer stopped by `max_tokens` is refused rather than parsed
 * (`ExpansionTruncated`), the redraw count and the fan-out are recorded on the
 * node that was expanded rather than on its children, and the per-candidate
 * records now reach a file somebody can divide one number by another in
 * (`DEEPEN_RECORDS_ENV`).
 *
 * **And two things a survey of what a live run would produce found missing**,
 * the same day: two of the five questions the paid wave exists to answer were
 * not answerable from what it wrote down. `REASK_ENV` is the first — a repeat
 * over one article was free, so verdict stability came out perfect by
 * construction — and `ExpansionAnswer` is the second: the executor handed back a
 * bare string, so the wave's tokens reached the ledger and nothing on the run.
 * Neither was a bug in what was built; both would have made the run worth less
 * than it cost.
 *
 * ## The one trap this file exists to avoid
 *
 * A checkpoint's key is a content address, so **everything the answer depends on
 * has to be in it and nothing else may be**. The tempting extra here is the
 * tree as it stands, and it would be fatal in a way that never shows up as an
 * error: wave 2 expands several parents at once, so if parent P's key depended
 * on the current tree, Q's expansion landing would move P's key, and a resumed
 * attempt would miss every row the previous attempt had written. A checkpoint
 * layer that provably never hits under exactly the load it exists for — no
 * throw, no warning, only the bill. docs/reusable/silent-success.md.
 *
 * So the **seed is frozen** (`FrozenSeed`), and the wave-to-wave dependency is
 * carried by each parent's own range and ancestor chain, both of which are
 * inside the request already.
 *
 * ## What a hit has to survive before it is used
 *
 * The same gate the structure checkpoint learned the hard way
 * (src/hierarchy.ts § the checkpoint read): schema, exact-target coverage,
 * scoped-id checks and normalisation **against the current parent** — which is
 * to say `readExpansion`, the identical function the fresh answer goes through.
 * A stored answer that fails any of it is a **miss**, the call is made again,
 * and the write replaces the row. The alternative was tried in the other
 * checkpoint and it was an article that could never be built again without a
 * deploy.
 *
 * ## Where each piece lives, and why not somewhere nearer
 *
 * `MAX_EXPANSION_REDRAWS` is in `hierarchy-cascade.ts` because it belongs beside
 * `ExpansionRefused`, whose whole point is that every refusal is worth another
 * draw — and because this file imports that one, so the constant could not live
 * here without the arithmetic importing the protocol. `checkpointKey` is in
 * [`source-hash.ts`](source-hash.ts), and `renderBlocks`, `PROMPT_VERSION` and
 * `PRODUCTION_EFFORT` are in [`hierarchy-prompt.ts`](hierarchy-prompt.ts), all
 * hoisted out of `hierarchy.ts` for one reason: `hierarchy.ts` imports *this*
 * file, so anything reachable from here as a **value** and defined there closes
 * a cycle `npm run cycles` refuses. Types are erased and are exempt, which is why
 * `ModelNode` and `BuildReport` may still come from there.
 */
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { retryAfterMs } from "./ai-call.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { WidthGate, allOrStop, sleepUnlessAborted, type GateWindow } from "./concurrency.js";
import { log } from "./log.js";
import {
  CASCADE_RECIPE,
  ExpansionRefused,
  MAX_EXPANSION_REDRAWS,
  indexBlocks,
  normaliseExpansion,
  planExpansionBatches,
  proposalFromTree,
  type BlockIndex,
  type CascadeNode,
  type CascadeRecipe,
  type DerivedChild,
  type ExpansionBatch,
  type ExpansionTarget,
} from "./hierarchy-cascade.js";
import {
  EXPANSION_PROMPT_STAMP,
  expansionOverhead,
  expansionRequest,
  parseExpansionAnswer,
  readRefusedShape,
  recordCandidate,
  renderFrozenOutline,
  tallyVerdicts,
  type CandidateRecord,
  type ExpansionAnswerChild,
  type ExpansionRequest,
  type OutlineEntry,
  type RefusedAnswerShape,
  type VerdictTally,
} from "./hierarchy-expand.js";
/* Types only. `src/hierarchy.ts` is the module this one is imported *by*, so a
   value import here would be the wrong way round and would close a cycle. */
import type { BuildReport, ModelNode } from "./hierarchy.js";
import {
  messagesWireBody,
  streamMessage,
  wasRefused,
  type MessagesBody,
} from "./messages-stream.js";
import { checkpointKey, hashBlocks, structureHash } from "./source-hash.js";
import type { CheckpointNamespace, CheckpointStore } from "./store/checkpoints.js";
import type { Block, Tree } from "./types.js";

/**
 * The namespace these rows live in — its own, not `hierarchy-structure`'s.
 *
 * The structure call is one row per article: the whole tree, one question. This
 * is several rows per article per wave, each keyed on one call's own targets,
 * and a run that dies in wave 3 must keep wave 2's. Sharing a namespace would
 * have cost nothing today and made the retention sweep, the hit-rate log and any
 * future "how much of this article is cached" question unable to tell the two
 * apart. Adding it was a migration: `drizzle/20260905020601_checkpoints_hierarchy_deepen.sql`.
 */
export const DEEPEN_NAMESPACE: CheckpointNamespace = "hierarchy-deepen";

/* ----------------------------------------------------------- the frozen seed */

/**
 * **Wave 1's answer, in the two forms every later wave needs** — and one object
 * rather than two arguments, because the failure they guard against is somebody
 * freezing one of them and re-deriving the other.
 *
 * `outline` is the shared, cacheable prefix of every scoped call in the run.
 * `hash` is what makes *"resumed against a different wave-1 answer"* read as a
 * miss. They must come from the same tree, and `frozenSeed` is the only thing
 * that builds one, so they do.
 */
export interface FrozenSeed {
  /** `renderFrozenOutline` of the wave-1 root: depth 1, titles and gists. */
  outline: string;
  /**
   * `structureHash` of the wave-1 tree — **not** a digest of `outline`.
   *
   * The outline is depth 1 and prints two different cuts of an article
   * identically; the hash reads every node's id, parent, range, title and gist.
   * Keying on the text would let an answer written against one wave-1 tree be
   * replayed against another that happens to have the same top level, which is
   * precisely the case that produces a plausible tree over the wrong prose.
   */
  hash: string;
}

/**
 * **Freeze wave 1's answer, once, before the first scoped call.**
 *
 * Call this on the tree the whole-document call produced and hold the result for
 * the life of the run. Calling it again on the cascade's *current* tree is the
 * trap in this file's header: it would move every key at every barrier and turn
 * the checkpoint layer into a write-only table.
 */
export function frozenSeed(tree: Tree): FrozenSeed {
  return {
    outline: renderFrozenOutline(proposalFromTree(tree)),
    hash: structureHash(tree),
  };
}

/* ------------------------------------------------------ the canonical request */

/**
 * **The body as *this stage* depends on it** — the article's fingerprint, plus
 * the four per-block fields it is not made of.
 *
 * `hashBlocks` canonicalises `[id, text, role, treatment]`: the article's own
 * identity, shared by every stage, pinned by a literal hex in
 * `tests/supplement.test.ts` and with a history of collisions behind its
 * canonical form (src/source-hash.ts). It stays exactly as it is. What is
 * derived here is a **stage-specific** digest, so a field this stage reads and
 * the article's identity does not can move a scoped call's key without moving
 * anything else's.
 *
 * The four, each because something here reads it:
 *
 * - **`words`** — `bodyWordsIn`, which is the `forcedOpenWords` ceiling. The
 *   same twenty blocks at 6 words and at 1,000 render to the identical request,
 *   because `renderBlocks` never prints a count, while `decideExpansion` moves
 *   from `stop` to `expand/forced-open`.
 * - **`kind`** — `isAuthoredBoundary`, and through it the heading rule that can
 *   force an expansion on its own, `hasUnresolvedHeading`'s stopping clause, and
 *   `bodyHeadingsIn`, which sizes `max_tokens`.
 * - **`tag`** — `renderBlocks` prints it, so it is a thing the model is shown. A
 *   block reclassified `p` → `h2` with its text untouched is a different
 *   question asked.
 * - **`gistable`** — `isStructural`, which is the unit `terminalBlocks` and
 *   `predictedChildren` count in, *and* the `NOT-GISTABLE` marker `renderBlocks`
 *   prints. It is not on the reviewer's list of three and it belongs on it: the
 *   floor is the other half of the governor.
 *
 * `Block.html`, `Block.level` and the rest are deliberately out: nothing on this
 * path reads them, and a hash over everything would re-buy every scoped call of
 * an article whose markup was re-rendered. `role` and `treatment` are already
 * inside `hashBlocks`, so they are not repeated here.
 *
 * Its input is a fixed-position array under a version prefix, for
 * `hashBlocks`'s own reason: a delimiter-joined form is a collision waiting for
 * a page that contains the delimiter. `checkpointKey` is the digest, since it
 * "hashes whatever it is given and knows nothing about checkpoints".
 */
export function expansionBodyHash(blocks: readonly Block[]): string {
  return checkpointKey([
    "spya-expand-body/1",
    hashBlocks(blocks),
    blocks.map((b) => [b.words, b.kind, b.tag, b.gistable]),
  ]);
}

/**
 * Everything one scoped call's answer depends on, gathered so the digest cannot
 * be taken over less than all of it.
 */
export interface ExpansionIdentity {
  /** The exact object `streamMessage` would be handed — `ExpansionRequest.params`. */
  params: MessagesBody;
  /**
   * `expansionBodyHash` of the body this wave is being run over, after
   * `splitBlocks` — **not** `hashBlocks`, and that is the point of it.
   *
   * **The field whose omission would let a stale answer be reused against
   * changed input.** The whole-document call needs no such field: every block id
   * and every word of the article is inside its prose, so a lost draft re-minting
   * the ids moves its key by itself. A scoped call is shown one parent's slice,
   * so a change anywhere else in the article — including a re-mint that moved
   * every id outside this parent — is invisible to its bytes.
   */
  bodyHash: string;
  /** Wave 1's answer, frozen. See `FrozenSeed`. */
  seed: FrozenSeed;
  /**
   * The whole recipe, not the fields that look relevant.
   *
   * `terminalBlocks`, `forcedOpenWords` and `maxDepth` change what the cascade
   * *does with* a verdict without changing a byte of the prompt, and the packing
   * caps decide which parents share a call. Picking three of seven costs a silent
   * hole the day an eighth arrives; over-invalidating costs one call.
   */
  recipe: CascadeRecipe;
  /** This call's parents, in the order the request numbered them. */
  targets: readonly ExpansionTarget[];
}

/**
 * The recipe as an order-independent object.
 *
 * **The one place in the canonical request where key order is deliberately not
 * the caller's**, and the exception is worth stating because the rule below is
 * the opposite. A `CascadeRecipe` is a plain object built at several sites —
 * `CASCADE_RECIPE`, an eval arm's `{ ...CASCADE_RECIPE, maxDepth: 6 }`, a test's
 * literal — and `JSON.stringify` writes fields in insertion order, so two
 * recipes with identical values could hash differently depending on which
 * literal built them. That is a permanent miss with nothing to see.
 *
 * Sorting also keeps the field list total rather than hand-kept: an eighth
 * recipe field is in the key the day it is added.
 */
function canonicalRecipe(recipe: CascadeRecipe): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(recipe).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * **What the checkpoint key is a digest of.**
 *
 * The spine is `messagesWireBody` — the bytes that actually go on the wire — for
 * the reason `canonicalStructureRequest` gives at length (src/hierarchy.ts): the
 * model address, the routing the gateway injects, `max_tokens`, `thinking`, the
 * effort, both prompts, the frozen outline, every ancestor chain and every block
 * of every slice are covered by *being in the request* rather than by a
 * hand-copied list of fields that goes stale in silence.
 *
 * Then four things a **scoped** call no longer carries implicitly, each of which
 * is a hole if it is left out:
 *
 * - `bodyHash` — the article outside this parent, **and the per-block fields the
 *   wire bytes never carry**. See `expansionBodyHash`.
 * - `seedHash` — the wave-1 tree this cascade descends from, frozen.
 * - `recipe` — what we do with the answer, which the prompt never states.
 * - `targets` — the difference between *"this answer is for this parent"* and
 *   *"this answer is for a parent that happened to render the same"*. Each is
 *   its position in the cascade's own proposal (`where`, which is the only id a
 *   cascade node has), the ordinal the request numbered it under, and the range
 *   the answer was derived against.
 *
 * **And deliberately not in it: any hash of the tree as it stands.** That is the
 * trap in this file's header, and it is the only omission here that is a
 * decision rather than an accident.
 *
 * `promptVersion` is in it though it never reaches the wire, because it is the
 * handle for a change in what this stage *does with* an answer. It carries both
 * stamps — `hierarchy.ts`'s and the scoped prompt's — so a change to how wave 1
 * is read invalidates the waves built on top of it too. Over-invalidating costs
 * one call; the other direction costs a subtree derived under rules that have
 * moved.
 *
 * ## The order of these literals *is* the key
 *
 * `checkpointKey` is `sha256(JSON.stringify(…))`, and `JSON.stringify` writes an
 * object's fields in insertion order. Re-ordering the literals below changes
 * every key ever minted — which costs one call per article and nothing else,
 * since a key that does not match is simply a miss, but **do not sort them
 * thinking it is free**. `canonicalRecipe` is the one deliberate exception and
 * says why.
 */
export function canonicalExpansionRequest(id: ExpansionIdentity): Record<string, unknown> {
  return {
    promptVersion: EXPANSION_PROMPT_STAMP,
    /* Built at call time, the way the call builds it, so an environment override
       of the model moves the key rather than silently answering its question. */
    request: messagesWireBody("hierarchy", id.params),
    bodyHash: id.bodyHash,
    seedHash: id.seed.hash,
    recipe: canonicalRecipe(id.recipe),
    targets: id.targets.map((target, i) => ({
      /* `where` — "root > child 2" — is the only id a cascade node has, and it
         is derived from the shape of the tree, so it is safe to hash and safe to
         log. */
      node: target.where,
      ordinal: i + 1,
      range: [target.node.range[0], target.node.range[1]],
    })),
  };
}

/* ------------------------------------------------------------------ the entry */

/**
 * One scoped answer, kept so a later attempt does not buy it again.
 *
 * **The raw text, not the children.** Everything between the answer and the
 * children — `parseExpansionAnswer`, `normaliseExpansion`, the snap, the
 * repairs — is this repo's own code, and storing its output would freeze a
 * version of it into the row. The answer is the thing that was paid for; the
 * rest is free and re-runs, which is also what lets the *current* parent be the
 * one a stored answer is checked against.
 */
export interface ExpansionCheckpointEntry {
  fingerprint: string;
  answer: string;
}

/**
 * **The cheap half of the gate**: is this row an entry, and is it for this
 * question?
 *
 * The store validates nothing about a value (src/store/checkpoints.ts), so a row
 * written by an older format, or by something else entirely, has to read as a
 * miss rather than as a cast. The interesting failure is the one where this says
 * yes when it should say no — the wave then builds a subtree from an answer to a
 * different question and looks exactly like a wave that worked.
 *
 * It deliberately does **not** try to parse the answer. `readExpansion` is the
 * expensive half and runs immediately after on everything this accepts, so a
 * parse here would be a second, weaker opinion about the same string.
 */
export function usableExpansion(value: unknown, fingerprint: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Partial<ExpansionCheckpointEntry>;
  if (entry.fingerprint !== fingerprint) return null;
  if (typeof entry.answer !== "string" || entry.answer.length === 0) return null;
  return entry.answer;
}

/* -------------------------------------------------------------- the reading */

/** One child of one parent: the node, and what the call said about it. */
export type ExpandedChild = DerivedChild<ExpansionAnswerChild>;

/** One parent's answer, read and derived. */
export interface ExpandedTarget {
  target: ExpansionTarget;
  /**
   * What survived, with derived ranges — **each beside the proposal it came
   * from, verdict included.** At least two, or the answer was refused.
   *
   * This was two arrays until 2026-09-05: `proposed`, every child the answer
   * named, and `children`, the ones that survived the drops — different lengths,
   * with nothing to say which verdict belonged to which node. Stage 6 is
   * governed by exactly that pairing and could not have been built on it. The
   * fix is in `normaliseExpansion`, which now makes the pair where the drop is
   * decided; see `DerivedChild` for why not a `childIndex` and a lookup.
   *
   * **A dropped child's verdict is gone, on purpose.** It was never about a node
   * — the start marked no split point, so nothing was built — and
   * `report.droppedChildren` counts it. Nothing has ever read one.
   */
  children: ExpandedChild[];
}

/** One call's answer, read whole. */
export interface ExpansionReading {
  /** One per target, in the request's own order. */
  targets: ExpandedTarget[];
  /** What deriving it repaired and dropped, across every target in the call. */
  report: BuildReport;
}

/**
 * **Read one answer — stored or fresh, by exactly the same road.**
 *
 * That the two share this function is the whole design: an answer off a
 * checkpoint has to clear every bar a fresh one clears, against the parent as it
 * is *now*, or a row written before a range moved would build a subtree over
 * prose it was never about.
 *
 * Four bars, in order, and each is somebody else's function so there is no
 * second opinion here:
 *
 * 1. **Schema** — `parseExpansionAnswer`, which also refuses a missing or
 *    misspelt verdict.
 * 2. **Exact-target coverage** — the same call: a section left out, answered
 *    twice, or one nobody asked about is a `target-mismatch`.
 * 3. **Scoped ids** — `normaliseExpansion` refuses an `invented-start` and a
 *    start `outside-parent`, which is stronger than any check on the string.
 * 4. **Normalisation against the current parent** — the ranges are derived here,
 *    now, from the parent's range as the cascade holds it.
 *
 * Every one of those refusals is an `ExpansionRefused`, which is what lets the
 * caller write `try`/`catch` rather than a checklist, and what lets a stored
 * answer be demoted to a miss by the same `catch`.
 *
 * `report` is built locally and returned only on success. A refusal therefore
 * cannot leave half a call's drops on the run's books — the arithmetic
 * `normaliseExpansion` § "The caller's `report`" exists to get right, extended
 * across the targets of one call.
 */
export function readExpansion(opts: {
  raw: string;
  /** The call's parents, in the order the request numbered them. */
  targets: readonly ExpansionTarget[];
  blocks: readonly Block[];
  index?: BlockIndex;
}): ExpansionReading {
  const { raw, targets, blocks } = opts;
  const index = opts.index ?? indexBlocks(blocks);
  const sections = parseExpansionAnswer(raw, targets.length);
  const report: BuildReport = {
    repairs: [],
    droppedChildren: [],
    droppedHeadings: [],
    collapsedRungs: [],
    droppedQuestions: [],
  };
  const read = targets.map((target, i) => {
    /* `parseExpansionAnswer` returns exactly `targets.length` entries, in
       ordinal order, so this index is total by its contract rather than by
       hope. */
    const section = sections[i]!;
    const children = normaliseExpansion({
      children: section.children,
      parent: target.node.range,
      blocks,
      where: target.where,
      report,
      index,
    });
    return { target, children };
  });
  return { targets: read, report };
}

/* ---------------------------------------------------------------- the width */

/**
 * **How many scoped calls of one wave may be in flight, and it is derived here
 * rather than borrowed from the stage next door.**
 *
 * The plan's own arithmetic for this was wrong twice, both times by copying
 * `src/pdf-read.ts` § `CHUNK_CONCURRENCY` — a number that answers a different
 * question (how wide may **one** step of **one** kind of document go) and that
 * moved from 16 to 100 while the plan was being written. So: derived, from what
 * actually bounds a wave, with every measurement it rests on named and dated.
 * `tests/hierarchy-deepen-wave.test.ts` § "how wide a wave may be" is the
 * arithmetic below as an assertion, so that a number moving in `jobs.ts` takes
 * this one with it instead of leaving a stale paragraph.
 *
 * ## What has to fit inside what
 *
 * A claim's deadline is `LEASE_MS - DEADLINE_MARGIN_MS` = **740 s**, and the walk
 * only starts this step with `STEP_BUDGET_MS.hierarchy` = **700 s** left
 * (src/jobs.ts). Wave 1, the label pass and the wave share that one window:
 *
 * | | measured | where |
 * |---|---|---|
 * | wave 1, on a book | 102 s (Moby-Dick), 126 s (Origin) | plan § stage 1, 2026-09-04 |
 * | the label pass, on the largest article we have | 150–270 s | `STEP_BUDGET_MS.hierarchy`'s own note: a 658–778 s step of which the structure call was 508 s |
 * | one scoped call | 22 s (382 blocks, 76,558 in), 16 s (30 blocks) | plan § stage 2, three real calls |
 *
 * So the wave's share of a book's step is about `700 - 126 - 270 ≈ 300 s`.
 *
 * ## How many calls a wave is
 *
 * Moby-Dick's wave-1 tree has **54 sections**, and `CASCADE_RECIPE` packs at most
 * four parents into a call (`maxParentsPerBatch`, and `maxPredictedChildrenPerBatch`
 * of 36 is the same four at the nine-child clamp), so the frontier is **≥ 14
 * calls** and more wherever an evidence cap closes a batch early. Take **20** as
 * the working worst case, and **45 s** for a packed call — twice the worst single
 * call ever measured, because a batch carries four parents and answers up to
 * thirty-six children.
 *
 * `ceil(20 / W) × 45 s ≤ 300 s` wants `W ≥ 4`. Four is five rounds at 225 s and
 * leaves 79 s of the share, which one redrawn call eats; **eight** is three
 * rounds at 135 s and leaves 169 s, which is a whole further round for the
 * redraws `MAX_EXPANSION_REDRAWS` allows. Past eight there is little left to buy
 * — twenty calls is three rounds either way until sixteen, where it becomes two
 * — and every slot added is another call the rate limiter sees.
 *
 * ## And what stops it going higher
 *
 * `DEFAULT_JOB_CONCURRENCY` is **3** (src/jobs.ts), and nothing stops three jobs
 * being in this step at once, so what the account sees is `3 × 8 = 24` scoped
 * calls in flight. That is a quarter of the 100 `CHUNK_CONCURRENCY` already
 * points at the same account, which is the only evidence anyone has about what
 * this account will take — so 24 is inside demonstrated headroom rather than
 * inside a guess. It is also the reason the number is not simply *"as wide as the
 * wave"*: the width that matters to a rate limiter is the one summed across jobs,
 * and this file cannot see the other two.
 *
 * **This is an ambition, and `WidthGate` is what happens when it is wrong** — it
 * halves on a 429 and earns a slot back per width successes, exactly as it does
 * for the PDF stage. The number to revisit it with is stage 5's live run under
 * three concurrent jobs.
 */
export const EXPANSION_CONCURRENCY = 8;

/**
 * **One gate for the process**, for the reason src/pdf-read.ts § `sharedGate`
 * gives: what is being rationed is calls in flight to one upstream, which is a
 * property of the account rather than of a job. Two ingests in one dev server
 * would otherwise each believe they had the whole width.
 *
 * **It is a second gate, not a second copy of the mechanism**, and the
 * distinction is the one `WidthGate`'s own docblock draws — *"if a second wide
 * caller arrives, move this rather than copying it"*. The class is imported; only
 * the instance is new, because the two stages have different widths and there is
 * no place today that owns "how busy is the account" across stages. What that
 * costs is real and worth writing down: **neither gate learns from the other's
 * 429s**, so a PDF extract at width 100 and a deepening wave at width 8 can walk
 * into the same wall separately. Fixing it properly is the token bucket in
 * src/ai-call.ts that `WidthGate` names and nobody has needed enough to build.
 */
const sharedGate = new WidthGate(EXPANSION_CONCURRENCY);

/**
 * **A 429, and only a 429** — the one status whose whole meaning is *ask again
 * later*.
 *
 * Its own class rather than the SDK's error, for two reasons. The SDK builds
 * `Error.message` out of the upstream body, which is the one place a failure can
 * echo back part of what we sent — and what we sent is the article
 * (src/anthropic-call.ts, docs/project/logging.md). And a class is what lets the
 * fake executor in the tests produce a rate limit with no network at all, which
 * is how the retry path below is exercised.
 *
 * `retryAfterMs` is what the provider asked for, in milliseconds, or `null` where
 * it said nothing.
 */
export class ExpansionRateLimited extends Error {
  constructor(readonly retryAfterMs: number | null) {
    super("the expansion call was refused with 429; the provider asked us to wait");
    this.name = "ExpansionRateLimited";
  }
}

/**
 * **The model ran out of room mid-answer, and the answer is worthless however
 * well-formed it looks.**
 *
 * The executor used to ignore `stop_reason` entirely, on the argument that a
 * truncated answer necessarily fails to parse and is caught downstream as a
 * `malformed-answer`. That holds for almost every truncation and fails for the
 * one that matters: **an answer cut immediately after a closing brace is valid
 * JSON describing half of what was asked for.** It parses, it normalises, its
 * starts are inside the parent, it covers the targets it does mention, it gets
 * written to the checkpoint, and a section that should have had eight children
 * gets three — published as a finished tree with nothing anywhere to say a level
 * went missing. ⟨GPT Sol's review of stage 5a, finding 6.⟩ Exactly the shape of
 * failure docs/reusable/silent-success.md is about.
 *
 * ## Why this fails the wave rather than being drawn again
 *
 * **Not an `ExpansionRefused`**, deliberately, because in this file the class is
 * the retry policy and a redraw here would be three calls failing the same way.
 * `max_tokens` is a property of the *request*: the budget is computed from the
 * target's own size (src/hierarchy-expand.ts § `expectedChildren`) and the redraw
 * is sized identically, so a call that truncates deterministically truncates
 * every time. That is the waste this stage's own docblock already named, and
 * accepting the truncated answer was the only reason it had not been paid yet.
 *
 * The alternative — redraw with a larger budget — was weighed and refused for
 * stage 5. It cannot be a redraw of the same call: `max_tokens` is inside
 * `request.params`, which is inside the checkpoint key
 * (`canonicalExpansionRequest`), so a bigger draw is a **different question**
 * stored under a **different key**, and a wave that silently escalates its own
 * budget is one whose cost per article nobody can predict — on the first stage
 * whose whole purpose is to find out what a wave costs. Since publication is
 * all-or-nothing anyway (`deepenTree` § "All of the wave, or none of it"),
 * "skip this one and publish the rest" is not on the table either.
 *
 * **⟨That last sentence stopped being true on 2026-09-05, and this is a separate
 * question rather than a change made in passing.⟩** "Skip this one and publish
 * the rest" is now exactly what a *refused* call gets — `RefusedCall`, on the
 * reasoning `MAX_EXPANSION_REDRAWS` already stated: a request the model declines
 * three times is a request this recipe cannot ask. A truncation is not that. It
 * is deterministic sizing we should be told about; it is thrown by the
 * *executor* rather than by `readExpansion`, so the redraw loop rethrows it on
 * purpose because re-asking would bury a bug. The behaviour here is therefore
 * deliberately unchanged, and only its justification has moved: it now stands on
 * "a sizing bug we should be told about" alone. **Whether a truncated target
 * should join the refused ones is a real question and nobody has answered it.**
 *
 * So the wave dies, the article keeps the tree wave 1 gave it, `deepenFailed`
 * goes on the run, and the number that has to move is `expectedChildren`. A
 * truncation is a sizing bug we should be told about, not a cost to absorb three
 * times per call.
 */
export class ExpansionTruncated extends Error {
  constructor() {
    super("the model hit max_tokens on a scoped expansion, so its answer is only part of one");
    this.name = "ExpansionTruncated";
  }
}

/**
 * How many times one call is *sent*, counting the first — a rate limit is not a
 * verdict about the answer, so it is not a redraw and does not spend
 * `MAX_EXPANSION_REDRAWS`.
 *
 * Three, matching src/pdf-read.ts § `TRANSPORT_ATTEMPTS`, which is the only other
 * loop in this repo that asks the same upstream the same question again.
 */
const EXPANSION_ATTEMPTS = 3;

/**
 * **The longest `Retry-After` this wave can obey**, past which the call gives up
 * now rather than pretending to wait.
 *
 * Sixty seconds, matching src/pdf-read.ts § `MAX_RETRY_AFTER_MS` and
 * `MAX_COOLOFF_MS` in src/concurrency.ts — the three have to agree or the gate
 * reopens inside a window the provider named, which is the accident that walked
 * a gate to its floor on one piece of news. A provider asking for longer than a
 * minute is describing a queue that the reader's next Retry will clear better
 * than this claim can, and the deepening is the one thing in this step that can
 * be dropped without costing the reader their article.
 */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * The floor under a retry, so that a lapsed pause cannot become a hot loop.
 *
 * **The waiting itself is the gate's**, and that is why this is one second
 * rather than a backoff curve: a refusal parks *every* new admission until the
 * window the provider named, jittered on the way out
 * (src/concurrency.ts § `MAX_COOLOFF_MS`), so a call that comes back round here
 * has already waited. What it cannot rely on is that the pause is still in force
 * — a refusal from a superseded epoch is counted and ignored — and a re-entry
 * into an open gate would otherwise be immediate. Drawn rather than fixed, for
 * the reason every other wait in this repo is drawn: two calls that give up
 * together should not come back together.
 */
const RETRY_FLOOR_MS = 1_000;

/** What `WidthGate.run` needs to know, without this module telling it about our classes. */
function rateLimitedForExpansion(error: unknown): number | null | false {
  return error instanceof ExpansionRateLimited ? error.retryAfterMs : false;
}

/* ----------------------------------------------------------------- the wave */

/**
 * **The seam where the model is.**
 *
 * Takes an assembled request and returns the answer's raw text. The checkpoint,
 * the coverage checks, the derivation, the redraws, the width and the rate-limit
 * retries are all on *this* side of it, so the whole protocol runs end to end
 * against a function that returns a string — which is what stage 4 was finished
 * against and what stage 5's own tests still use.
 *
 * `liveExpansionExecutor` is the real one. It may throw, and the wave tells two
 * cases apart: an `ExpansionRateLimited` is asked again inside the width gate,
 * and **anything else is fatal to the wave** — a request this code got wrong or
 * an account with no credit does not come out differently for being asked twice.
 * A refusal of the *answer* is neither: that is an `ExpansionRefused` and it is
 * redrawn, up to `MAX_EXPANSION_REDRAWS`.
 */
/**
 * **What one scoped call cost, in the four numbers a bill is made of.**
 *
 * The same four `HierarchyRun` already reports for the structure call and the
 * label batches (src/hierarchy.ts), named the same way, so that summing them is
 * addition rather than translation.
 *
 * **Zero here means "this call was free", and that is only ever true of a
 * resumed one.** A field the provider did not send reads as 0 through
 * `usageOf`, which is an understatement rather than a lie — `CallMeter` in
 * src/messages-stream.ts keeps the nullable version, and the ledger under task
 * `hierarchy` is the authority on money. This is the artefact's copy, and its
 * job is to make one run's records say what that run paid without a join.
 */
export interface ExpansionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * A call that cost nothing: a resumed one, or a wave that made none.
 *
 * **Frozen**, because it is handed out by reference — every resumed call's
 * outcome carries this very object — and a single `+=` anywhere would silently
 * move every past and future zero at once.
 */
export const NO_EXPANSION_USAGE: ExpansionUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

/** Field by field, so a new field cannot be forgotten by a spread. */
export function addUsage(a: ExpansionUsage, b: ExpansionUsage): ExpansionUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** The SDK's usage, in this file's four numbers. Absent fields read as 0. */
export function usageOf(usage: Anthropic.Message["usage"]): ExpansionUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * **One call's answer and what it cost, together** — because the cost is a fact
 * only the executor can know and the seam used to throw it away.
 *
 * It returned a bare `string` until 2026-09-05, and the consequence was that the
 * expansion calls' tokens reached nothing on `HierarchyRun`: they were metered
 * (`streamMessage` calls `beginSpend` for every one) and so recoverable from the
 * AI-spend ledger, but a run's own artefact could not say what the run cost, and
 * question 4 of the live wave — *what does it actually cost, per book and per
 * ordinary article* — is answered by comparing artefacts.
 * docs/plans/260904d-deepen-fat-sections.md § "What the live run must answer".
 *
 * **A fake executor answers `NO_EXPANSION_USAGE`** and every test does; the
 * numbers are only ever real on the live path. That is why the field is required
 * rather than optional: an optional one would let the live executor forget it and
 * report a free book, which is the same silent success this file's header is
 * about.
 */
export interface ExpansionAnswer {
  /** The model's text, exactly as `readExpansion` will be handed it. */
  text: string;
  usage: ExpansionUsage;
}

export type ExpansionExecutor = (request: ExpansionRequest) => Promise<ExpansionAnswer>;

/**
 * **An answer that cost nothing.**
 *
 * The shape a fake executor returns, and a constructor rather than a literal in
 * twenty places because four zeros written out twenty times is four zeros
 * somebody eventually gets wrong. Nothing on the live path calls it:
 * `liveExpansionExecutor` reports what the provider said.
 */
export function freeAnswer(text: string): ExpansionAnswer {
  return { text, usage: NO_EXPANSION_USAGE };
}

/**
 * **The live executor: one scoped call, streamed, with nothing of the provider's
 * words allowed out of it.**
 *
 * Three things happen here and nowhere else:
 *
 * - **A 429 becomes an `ExpansionRateLimited`** carrying the parsed
 *   `Retry-After`, so the wave's retry and the width gate can both act on it
 *   without either of them knowing what an SDK error is.
 * - **Every other failure goes through `anthropicCallFailed`**, because the
 *   installed SDK builds its message from the upstream error body — the one place
 *   a failure can echo back part of the request, and the request carries the
 *   article's prose.
 * - **A truncated answer is refused here**, on `stop_reason` rather than on
 *   whether it happens to parse. See `ExpansionTruncated`.
 *
 * There is no `onProgress`. A scoped call is 16–22 s measured and there are
 * several of them in flight; per-call text deltas would be a progress bar racing
 * itself. The wave reports whole calls instead.
 */
export function liveExpansionExecutor(signal?: AbortSignal): ExpansionExecutor {
  return async (request) => {
    let message: Anthropic.Message;
    try {
      const call = streamMessage("hierarchy", request.params, {
        ...(signal ? { signal } : {}),
      });
      message = await call.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIError && err.status === 429) {
        throw new ExpansionRateLimited(err.headers ? retryAfterMs(err.headers) : null);
      }
      throw anthropicCallFailed(err);
    }
    if (wasRefused(message)) {
      /* `stop_details` is the provider's own words about a request that carried a
         section of the article, and this error reaches a log line. src/messages.ts. */
      throw new Error("the model answered a scoped expansion with stop_reason: refusal");
    }
    if (message.stop_reason === "max_tokens") throw new ExpansionTruncated();
    return {
      text: message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(""),
      /* Off `finalMessage()` rather than off the raw `message_delta`, which is
         what `CallMeter` reads. The four fields here are the ones the SDK's own
         `Usage` type names, so they survive the merge; the TTL split and the
         tier do not, and are not wanted — see src/messages-stream.ts § `CallMeter`
         for the fields that need the raw event, and the ledger for the money. */
      usage: usageOf(message.usage),
    };
  };
}

/** What one call in a wave came to. */
export interface ExpansionCallOutcome {
  batch: ExpansionBatch;
  /** The checkpoint key this call's answer is stored under. */
  key: string;
  request: ExpansionRequest;
  reading: ExpansionReading;
  /** True when the answer came off a checkpoint rather than out of the executor. */
  resumed: boolean;
  /**
   * Refused answers redrawn before one stood up. 0 where the first draw held and
   * 0 on a resumed call — which is the honest reading, since a resumed call drew
   * nothing. `CandidateRecord.retries` is what this feeds.
   */
  redraws: number;
  /**
   * **What this call cost, every draw of it included** — so a call refused twice
   * and answered on the third reports all three drawings, which is what was
   * actually paid for. `NO_EXPANSION_USAGE` on a resumed call, because a resumed
   * call bought nothing.
   */
  usage: ExpansionUsage;
  /**
   * **Is this answer durable — is there a checkpoint row a later attempt will
   * find?**
   *
   * True on a resumed call by construction: it came off a row that is still
   * there. False where the write threw, which is deliberately **not** fatal to
   * the article and was therefore invisible to everything downstream —
   * `DeepenStats.withheld` counted an answer as banked whose row did not exist,
   * and its docblock's promise ("every one of these has a checkpoint row waiting
   * for it") was simply untrue. ⟨GPT Sol's second review of stage 5a,
   * finding 2.⟩ The write stays best-effort; the *count* stops lying.
   */
  checkpointed: boolean;
}

/** What a whole wave came to, including how much of it was already paid for. */
/**
 * **A call the model refused on every draw its budget allowed.**
 *
 * Not a wave failure. `MAX_EXPANSION_REDRAWS` already said why — *"a request the
 * model refuses three times is not unlucky, it is a request this recipe cannot
 * ask"* — and the code then treated it as unlucky anyway, killing the wave and
 * withholding every peer that had already been paid for. The first paid run of
 * stage 5b lost thirteen calls and $2.73 to one such target: Moby-Dick's title
 * page, four blocks and twenty-one words, forced open by the heading rule
 * because `By Herman Melville` is an `h2` no child starts on. The only
 * protocol-compliant answer was to make the byline a spine row of its own; the
 * model declined three times and said, truthfully, that this is one thing.
 *
 * **The pattern is `OversizedTarget`'s**, which `deepenTree` explicitly does not
 * withhold the wave for. A refused target is left exactly as wave 1 made it,
 * recorded, and the wave publishes without it.
 *
 * **The unit is the call's targets, not one section**, and that is a deliberate
 * price rather than an oversight: `readExpansion` throws on the first bad
 * section, the checkpoint row holds the whole raw answer, and a redraw has to be
 * the same request or it is a different question under a different key. So up
 * to `maxParentsPerBatch` good targets are lost beside the bad one, and there is
 * one code path instead of two.
 */
export interface RefusedCall {
  /** The checkpoint key this call would have been stored under, had it stood up. */
  key: string;
  /** Every target the call carried — all of them refused together. */
  targets: readonly ExpansionTarget[];
  reason: ExpansionRefused["reason"];
  /** The refusal's own sentence. Shape and ordinals only; never the article. */
  message: string;
  /** Draws made, counting the first — so `MAX_EXPANSION_REDRAWS + 1` at exhaustion. */
  draws: number;
  /**
   * **What every draw cost.** A refused call is a paid call; leaving it out
   * understates the wave by exactly the calls the redraw budget exists to pay
   * for, which is the argument the redraw loop already makes about tokens.
   */
  usage: ExpansionUsage;
  /**
   * **The shape of the last refused answer** — child counts, verdicts and the
   * model's own `why`. The datum that says whether the model declined on the
   * merits or fumbled the schema, and the one the old path destroyed. Carries
   * article-adjacent text, so it goes in the records file and never in a log.
   */
  shape: RefusedAnswerShape;
}

/** Targets lost to a call the model refused on every draw. `RefusedCall`. */
function refusedTargetsIn(wave: { refused: readonly RefusedCall[] }): number {
  return wave.refused.reduce((n, call) => n + call.targets.length, 0);
}

export interface ExpansionWaveResult {
  /**
   * One per call that produced an answer, **in the order the batches were
   * planned in** — never the order they finished in. See § "Concurrent, and the
   * order is still the planner's".
   */
  calls: ExpansionCallOutcome[];
  /**
   * Calls refused on every draw. Their targets keep the shape wave 1 gave them
   * and the wave is published without them — `RefusedCall`.
   */
  refused: RefusedCall[];
  /** Keys the wave looked up: one per call. */
  asked: number;
  /** Rows the store had. */
  found: number;
  /** Rows that were for this question **and still normalise** — the real hit count. */
  usable: number;
  /**
   * **Calls the wave chose not to start because the step was running out of
   * time** — 0 on an ordinary wave, and the number that says a book needs a
   * second attempt.
   *
   * Not an error and not a failure: the calls that *did* land are checkpointed,
   * so the next attempt buys only these. Reported rather than inferred, because
   * a wave that stopped early and a wave that had nothing to do produce the same
   * tree in every other respect. docs/reusable/silent-success.md.
   */
  outOfTime: number;
  /**
   * 429s met across the wave, whether or not the call that met one went on to
   * succeed. 0 is the ordinary reading; a number that climbs is
   * `EXPANSION_CONCURRENCY` being wrong, and it is the figure stage 5's live run
   * under three concurrent jobs is meant to produce.
   */
  rateLimited: number;
  /**
   * **What the gate did while *this wave* ran**, rather than the singleton's
   * cumulative life — see `GateWindow`. A slow wave that cannot say its own
   * initial, final and narrowest width cannot explain itself, and one that
   * quotes another job's numbers explains itself wrongly.
   */
  gate: GateWindow;
  /**
   * **The four token counts of every call in `calls`, added up** — and nothing
   * else, which is what stops it double-counting. A resumed call contributes
   * zeros, a redrawn one contributes all of its draws, and a call the wave never
   * started contributes nothing because it has no outcome.
   *
   * A call that failed fatally is *not* in here, and cannot be: the wave throws
   * rather than returning. Its draws are on the ledger under task `hierarchy`,
   * which is the authority; this figure is what a successful wave's artefact can
   * say about itself.
   */
  usage: ExpansionUsage;
}

/**
 * **The step is nearly out of time, so this call is not started.**
 *
 * Thrown *inside* the width gate, at the instant the call would have gone out,
 * and caught by the wave — which is the only place the question can be asked
 * honestly. Asking it before the gate would ask it of every call at once, at the
 * beginning, when there was still time for all of them.
 *
 * Its own class so that "we ran out of time" cannot be mistaken for a provider
 * failure by the `catch` that decides whether the wave dies.
 */
class WaveOutOfTime extends Error {
  constructor() {
    super("the hierarchy step had too little of its deadline left to start another expansion call");
    this.name = "WaveOutOfTime";
  }
}

/**
 * **What one more call needs of the deadline before the wave will start it.**
 *
 * Sixty seconds: 45 s for a packed call (`EXPANSION_CONCURRENCY`'s arithmetic)
 * with a third of that again for the answer to be read and the row written.
 *
 * **It is a reserve, not a guarantee**, and there are two gaps worth stating
 * rather than discovering.
 *
 * A call admitted with 61 s left and then held by a rate-limit cooloff can still
 * finish after the reserve is gone; what bounds *that* is the claim's own 740 s
 * deadline against this step's 700 s budget, and past it the job's abort signal.
 *
 * And **the question is asked at admission**, so it stops the *next* call rather
 * than the current ones: a wave narrower than the gate is admitted all at once
 * and every one of those calls runs. That is the intended reading — the unit
 * this can stop on is a round, and a round is what a checkpointed wave can afford
 * to lose. What the reserve buys is the ordinary case, which is the one that
 * matters on a book: a wave of twenty calls at width eight stops **between**
 * rounds, with everything it has bought already written, rather than being killed
 * in the middle of a call that has already been paid for.
 */
export const CALL_RESERVE_MS = 60_000;

/**
 * **How long a failed wave waits for its paid peers before it gives up on
 * them**, and the arithmetic is below rather than a round number.
 *
 * `allOrStop` drains before it rethrows, so that a peer already on the wire gets
 * to write the checkpoint row its answer was bought for. The drain was
 * unbounded, on a docblock's claim that every caller either aborts in flight or
 * is bounded by a claimant's deadline signal. **Neither is true here**: the
 * exported `deepenTree` can be called with no signal at all — the tests do, and
 * so does `evals/deepen/run.ts`'s free seam probe — and `ExpansionExecutor` is a
 * seam with no abort contract even when there *is* one. One wedged call hung the
 * wave for ever. ⟨GPT Sol's second review of stage 5a, finding 3. The CLI this
 * used to name went with the six stage CLIs on 2026-09-05
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § stage E); the unsignalled callers it named are still here, so the bound
 * stays.⟩
 *
 * **Bounding the drain rather than aborting the calls**, which is the other fix
 * and the wrong one: aborting them would undo the change that put the drain
 * there, whose whole point is that a call already paid for gets to bank its row.
 *
 * ## What is in the sum, and what is deliberately not
 *
 * `fatal.abort()` reaches every *wait* — `WidthGate.enter`'s pause and its
 * queue, and the `RETRY_FLOOR_MS` sleep, all take `waiting` — so a straggler
 * cannot be **sent again** after the wave has failed. `EXPANSION_ATTEMPTS` and
 * `MAX_RETRY_AFTER_MS` are therefore *not* terms here, which is the part of this
 * worth writing down: the only thing left running is one call already inside the
 * executor, plus what `runOne` still does with its answer.
 *
 * | | | where |
 * |---|---|---|
 * | one packed model call | 45 s | `EXPANSION_CONCURRENCY`, itself twice the worst single call ever measured |
 * | reading the answer and writing its row | 15 s | `CALL_RESERVE_MS`, a third of the call again |
 *
 * Sixty seconds, and it is the same sum as `CALL_RESERVE_MS` rather than a
 * coincidence of value — but a different question, so a different constant: that
 * one decides whether to *start* a call, this one decides how long to wait for
 * one that has already started. A straggler still running a minute after every
 * wait it could have been in was cancelled is not making progress, and the wave
 * has already failed.
 */
export const EXPANSION_DRAIN_MS = 60_000;

/**
 * **A wave that failed, with everything it had already measured attached.**
 *
 * `runExpansionWave` used to rethrow the executor's own error, and everything
 * the wave's *peers* had bought went with it: their checkpoint rows' existence,
 * their children's verdicts, the tokens spent and what the gate had done. Stage
 * 5b is a paid run whose purpose is to answer five questions, so a failure
 * nobody can read is nearly as bad as no run. ⟨GPT Sol's second review of stage
 * 5a, finding 5.⟩
 *
 * The original error is on `cause`, not swallowed — `tests/hierarchy-deepen.test.ts`
 * asserts an `ExpansionRefused` and its `reason` are still reachable through it
 * — and the message quotes it, so a `toThrow(/…/)` and a log line still say what
 * happened.
 */
export class ExpansionWaveFailed extends Error {
  constructor(
    override readonly cause: unknown,
    /** The wave as far as it got: the calls that landed, the tokens, the gate. */
    readonly partial: ExpansionWaveResult,
  ) {
    super(`the expansion wave failed: ${describeFailure(cause)}`);
    this.name = "ExpansionWaveFailed";
  }
}

/**
 * One line about a failure, safe to put in a message and in a records file.
 *
 * The class and its message — and the message is safe because every failure that
 * can carry the provider's words about our request goes through
 * `anthropicCallFailed` first (src/anthropic-call.ts), which exists for exactly
 * that. docs/project/logging.md.
 */
export function describeFailure(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * **Run one wave of scoped expansion calls, resuming whatever an earlier attempt
 * already paid for.**
 *
 * The order is the incumbent's, verbatim, because it is the order that survived
 * two reviews: every key up front → **one** batched read → the gate → the call →
 * and the write only after every check the answer can fail on its own.
 *
 * ## One read, not one per call
 *
 * The batching is fixed before a single call goes out — `planExpansionBatches`
 * is deterministic over the frontier, the blocks and the recipe — so every key
 * of the wave is known in advance and the store's plural `read` takes all of
 * them in one statement. That is what the plural signature is for, and it is
 * what `generateLabels` already does.
 *
 * ## Neither a read nor a write may take the wave down
 *
 * A read that throws is a miss and a `warn`; a write that throws costs one call
 * on the next attempt and a `warn`. The worst a broken checkpoint may cost is
 * the saving — a cache that could fail the run would be a saving that had become
 * an outage.
 *
 * ## `{ asked, found, usable }` on every read, hit or miss
 *
 * At `info`, which is production's level, and unconditionally — including when
 * the read threw. A dead cache and a cache nobody wired up produce identical
 * output otherwise, and the only other symptom is a larger bill.
 * docs/postmortems/260904a-a-retry-minted-a-fresh-name-so-the-checkpoints-could-never-be-found.md,
 * docs/reusable/silent-success.md, and `tests/checkpoint-hit-rate-is-logged.test.ts`
 * is the gate on the shape.
 *
 * **`usable` here is the count that still normalises**, which is stricter than
 * the same field on the structure read (where it means the row was for this
 * question and held an answer). It is the number a bill can be reasoned about
 * from: `found - usable` is rows that existed and were re-bought anyway.
 *
 * ## Concurrent, and the order is still the planner's
 *
 * Every call goes out at once and `WidthGate` decides how many are actually in
 * flight (`EXPANSION_CONCURRENCY` has the arithmetic). **Nothing about the result
 * depends on which of them comes back first**, and that is a property rather than
 * a hope: the batches were cut before any call went out, each key is a digest of
 * its own request and the *frozen* seed, and the outcomes are placed back into
 * the planner's own order by index. Two runs over one article make the same
 * calls, store them under the same keys, and build the same tree, whatever the
 * network does. `tests/hierarchy-deepen-wave.test.ts` runs a wave whose executor
 * answers the first call last, and asserts both halves: the order of `calls`,
 * which only this indexing gets right, and the tree, which comes out right
 * either way because an answer is attached to the target it names rather than to
 * a position.
 *
 * ## Two failures that are not the same failure
 *
 * A **refused answer** (`ExpansionRefused`) is the model's fault and is redrawn,
 * up to `MAX_EXPANSION_REDRAWS`. A **429** is not about the answer at all: it is
 * asked again, up to `EXPANSION_ATTEMPTS`, inside the gate — which has meanwhile
 * halved the width and parked every other admission for as long as the provider
 * asked. Anything else is fatal to the wave, and `allOrStop` stops the calls that
 * have not gone yet rather than going on buying answers for a wave that has
 * already failed.
 *
 * **A fatal call does not lose the paid ones.** Each call writes its own row the
 * moment its answer stands up, before anything else can fail — the same trade
 * `generateLabels` § `keepBatch` takes.
 *
 * ## No warm-up, and that is a decision rather than an omission
 *
 * Every call of a wave shares a prefix — `EXPAND_SYSTEM` plus the frozen outline
 * — and carries a `cache_control` marker on it, so on a cold cache all of them
 * pay the 1.25× write premium and none of them reads. src/labels.ts answers that
 * by running its first batch alone and widening afterwards, and this deliberately
 * does not. The arithmetic is why: that prefix is 1,150–1,400 tokens against
 * per-call evidence measured at 14,889 and 76,558, so serialising the first call
 * of a book's wave buys about 1% of the wave's input tokens and costs a whole
 * call's latency — 45 s out of a share of roughly 300. The trade goes the other
 * way for labels, whose batches are small and whose prefix is most of the
 * request. docs/project/prompt-caching.md § The floor.
 *
 * ## Stopping on time, cleanly
 *
 * `deadlineAt` is the wall clock the *step* must be finished by. A call that
 * cannot start with `CALL_RESERVE_MS` to spare is not started; the wave returns
 * what it has, with every answer it bought written down, and the next attempt
 * finds them. Nothing is aborted mid-call — an aborted call is money spent for
 * nothing, and it is the one thing a checkpointed wave never has to do.
 *
 * **What this hands back is therefore a partial wave, and `outOfTime` above zero
 * is what says so.** Whether a partial wave may be published is not decided
 * here: `deepenTree` § "All of the wave, or none of it" is where that lives, and
 * the answer is no.
 */
export async function runExpansionWave(opts: {
  slug: string;
  checkpoints: CheckpointStore;
  execute: ExpansionExecutor;
  /**
   * The wave's calls. `planExpansionBatches` also returns `OversizedTarget`s;
   * what to do about one is the caller's decision and is not a call, so they do
   * not reach here.
   */
  batches: readonly ExpansionBatch[];
  /**
   * The article's root first, the target's own parent last — the target itself
   * excluded. Asked per target rather than passed as a parallel array, because a
   * parallel array is a thing that can be one element short.
   */
  ancestorsOf: (target: ExpansionTarget) => readonly OutlineEntry[];
  /**
   * The body this wave runs over: the same array wave 1 was called with, after
   * `splitBlocks`. `bodyHash` is taken from it here rather than accepted as an
   * argument, so it cannot be a digest of something else.
   */
  blocks: readonly Block[];
  seed: FrozenSeed;
  recipe: CascadeRecipe;
  index?: BlockIndex;
  /**
   * The wall clock this step has to be finished by — `Date.now()` plus whatever
   * is left of the claim. Omitted, the wave runs to completion, which is what a
   * test and a command line want and what a queued job must not have.
   */
  deadlineAt?: number;
  /** The job's own signal. Cuts short a wait, never a call in flight. */
  signal?: AbortSignal;
  /** Injectable so a test can watch one it owns. Production shares the module's. */
  gate?: WidthGate;
  /**
   * How long to wait for the calls still in the air after one has failed.
   * Defaults to `EXPANSION_DRAIN_MS`, which is where the arithmetic is;
   * injectable for the same reason `gate` is, since the only shape that poses
   * this is a wedged executor and waiting a minute for one is not a test.
   */
  drainMs?: number;
  /**
   * **Ignore whatever the store already has and buy every call again.**
   *
   * A boolean the caller has already decided; the wave resolves
   * `opts.reask ?? reaskExpansions(slug)`, which is off unless `REASK_ENV`
   * names this very article. See that function for what it is for and why it
   * does not delete anything.
   */
  reask?: boolean;
}): Promise<ExpansionWaveResult> {
  const { slug, checkpoints, execute, batches, blocks, seed, recipe } = opts;
  const gate = opts.gate ?? sharedGate;
  const reask = opts.reask ?? reaskExpansions(slug);
  const index = opts.index ?? indexBlocks(blocks);
  const bodyHash = expansionBodyHash(blocks);

  const prepared = batches.map((batch) => {
    const briefings = batch.targets.map((target) => ({
      target,
      ancestors: opts.ancestorsOf(target),
    }));
    const request = expansionRequest({
      briefings,
      blocks,
      outline: seed.outline,
      recipe,
      index,
    });
    const key = checkpointKey(
      canonicalExpansionRequest({
        params: request.params,
        bodyHash,
        seed,
        recipe,
        targets: batch.targets,
      }),
    );
    return { batch, request, key };
  });

  const keys = prepared.map((p) => p.key);
  let stored = new Map<string, unknown>();
  if (reask) {
    /* **Not read at all**, rather than read and discarded. The row the store
       holds is about to be replaced by a fresh answer to the identical question,
       so what it says now is of no interest, and a `found` in the line below
       that counted rows nothing would use is a number somebody would later
       divide by. `REASK_ENV` has the whole argument. */
    log("pipeline").warn(
      { slug, namespace: DEEPEN_NAMESPACE, asked: keys.length, env: REASK_ENV },
      "re-asking every scoped expansion call: the stored answers are being ignored and re-bought",
    );
  } else {
    try {
      stored = await checkpoints.read<unknown>(slug, DEEPEN_NAMESPACE, keys);
    } catch (err) {
      log("pipeline").warn(
        { slug, namespace: DEEPEN_NAMESPACE, asked: keys.length, err },
        "could not read the expansion checkpoints; every scoped call will be asked for again",
      );
    }
  }

  /**
   * **The gate, run over every stored row before a single call goes out.**
   *
   * It is pure and cheap — a parse and some arithmetic against `blocks` — so
   * doing all of it here costs nothing and buys a truthful `usable` in the one
   * log line, rather than a number that could only be known after the calls it
   * is supposed to explain.
   */
  const resumed = new Map<string, ExpansionReading>();
  for (const p of prepared) {
    const raw = usableExpansion(stored.get(p.key), p.key);
    if (raw === null) continue;
    try {
      resumed.set(p.key, readExpansion({ raw, targets: p.batch.targets, blocks, index }));
    } catch (err) {
      /* **A stored answer that no longer derives is a miss, not a failure.** The
         row is left where it is and overwritten by the fresh answer below; that
         is what un-poisons it, and without it the only lever would be a prompt
         version bump, i.e. a deploy, for one reader's article. */
      log("pipeline").warn(
        { slug, key: p.key, err },
        "a stored expansion no longer derives against its parent; asking for it again and replacing it",
      );
    }
  }
  log("pipeline").info(
    {
      slug,
      namespace: DEEPEN_NAMESPACE,
      asked: keys.length,
      found: stored.size,
      usable: resumed.size,
      /* **On the same line as the zeros it explains.** A re-asking wave and a
         checkpoint layer that has quietly stopped hitting produce the identical
         `found: 0, usable: 0`, and the difference between them is a switch
         somebody set on purpose and a bug nobody has noticed —
         docs/reusable/silent-success.md. */
      reask,
    },
    "read the expansion checkpoints",
  );

  /* **One slot per call, filled by index rather than by arrival**, which is what
     makes the returned order the planner's whatever the network does. A slot
     stays `null` where the wave ran out of time before starting that call. */
  const outcomes: (ExpansionCallOutcome | null)[] = prepared.map(() => null);
  let outOfTime = 0;
  let rateLimited = 0;
  /**
   * **What the calls that have not gone yet are waiting on.**
   *
   * Composed with the caller's, the way src/labels.ts § `fatal` composes its own:
   * either the reader cancelled the ingest or one call of this wave failed, and
   * both mean the same thing to a call still queued in the gate. It reaches
   * `WidthGate.enter` and the retry floor, both of which are *waits* — a call
   * already in flight is deliberately out of its reach.
   */
  const fatal = new AbortController();
  const waiting = opts.signal
    ? AbortSignal.any([opts.signal, fatal.signal])
    : fatal.signal;

  /** Is there enough of the step left to start another call? See `CALL_RESERVE_MS`. */
  const timeLeft = (): boolean =>
    opts.deadlineAt === undefined || Date.now() + CALL_RESERVE_MS <= opts.deadlineAt;

  /**
   * **One send, through the width gate, with a 429 asked again.**
   *
   * Its own function so that the two loops here are two functions: this one asks
   * the *same* question again because the provider said "later", and the loop in
   * `runOne` asks a *new* question because the answer was refused. They count
   * different budgets and mean different things, and reading them nested was
   * where the complexity check pointed.
   *
   * The deadline is checked **inside** the gate, at the moment the call would go
   * out — the only place the answer is worth anything. Outside it, every call of
   * the wave would ask at once, at the start, when there was still time for all
   * of them.
   */
  const send = async (p: (typeof prepared)[number]): Promise<ExpansionAnswer> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await gate.run(
          async () => {
            if (!timeLeft()) throw new WaveOutOfTime();
            return execute(p.request);
          },
          rateLimitedForExpansion,
          waiting,
        );
      } catch (err) {
        if (!(err instanceof ExpansionRateLimited)) throw err;
        rateLimited++;
        const asked = err.retryAfterMs;
        /* **A wait we cannot afford is a refusal, not a shorter wait** —
           src/pdf-read.ts § `MAX_RETRY_AFTER_MS` for the argument. */
        if (attempt >= EXPANSION_ATTEMPTS || (asked !== null && asked > MAX_RETRY_AFTER_MS)) {
          log("pipeline").warn(
            { slug, key: p.key, attempts: attempt, retryAfterMs: asked },
            "a scoped expansion call was rate limited and the wave stopped asking",
          );
          throw err;
        }
        log("pipeline").warn(
          { slug, key: p.key, attempt, retryAfterMs: asked },
          "a scoped expansion call was rate limited; it will ask again once the gate reopens",
        );
        /* The waiting itself belongs to the gate, which parked every new
           admission for the window the provider named. This is only the floor
           that stops a lapsed pause becoming a hot loop. `RETRY_FLOOR_MS`. */
        await sleepUnlessAborted(Math.random() * RETRY_FLOOR_MS + RETRY_FLOOR_MS, waiting);
      }
    }
  };

  /* Parallel to `outcomes` and for the same reason: the planner's order, not the
     order they finished in. A slot holds a call outcome or a refusal, never
     both. */
  const refusals: (RefusedCall | null)[] = prepared.map(() => null);

  const runOne = async (p: (typeof prepared)[number], at: number): Promise<void> => {
    const already = resumed.get(p.key);
    if (already !== undefined) {
      outcomes[at] = {
        ...p,
        reading: already,
        resumed: true,
        redraws: 0,
        usage: NO_EXPANSION_USAGE,
        /* It came off a row, so there is one. */
        checkpointed: true,
      };
      return;
    }

    let redraws = 0;
    let answer = "";
    /* **Added to on every draw, before anything decides whether the draw was any
       good.** A refused answer was still generated and still billed, so leaving
       it out would understate the wave by exactly the calls the redraw budget
       exists to pay for. `normaliseExpansion` deliberately keeps a refused
       answer's *report* off the run's books; its tokens are a different fact and
       belong on them. */
    let usage = NO_EXPANSION_USAGE;
    let reading: ExpansionReading;
    for (;;) {
      const drawn = await send(p);
      answer = drawn.text;
      usage = addUsage(usage, drawn.usage);
      try {
        reading = readExpansion({ raw: answer, targets: p.batch.targets, blocks, index });
        break;
      } catch (err) {
        /* Only an answer's own faults are redrawn. Anything else — an executor
           that threw, a range this article cannot resolve — is a bug or a
           transport failure, and re-asking would bury it. */
        if (!(err instanceof ExpansionRefused)) throw err;
        if (redraws >= MAX_EXPANSION_REDRAWS) {
          /* **The reason and the counts, and never the answer.** The shape of
             what was refused carries the model's `why`, which is a dozen words
             about the article — it goes on `RefusedCall.shape` and into the
             records file, not here. docs/project/logging.md. */
          log("pipeline").warn(
            { slug, key: p.key, reason: err.reason, draws: redraws + 1 },
            "an expansion call was refused on every draw its budget allowed; " +
              "its targets keep the shape wave 1 gave them and the wave goes on",
          );
          /* **Recorded rather than rethrown**, which is the whole of the change.
             A refusal is a fault in what the model said about *these* targets,
             so it is those targets that fail — not the peers, which have already
             been paid for and banked. `RefusedCall` has the argument. */
          refusals[at] = {
            key: p.key,
            targets: p.batch.targets,
            reason: err.reason,
            message: err.message,
            draws: redraws + 1,
            usage,
            shape: readRefusedShape(answer),
          };
          return;
        }
        redraws++;
        log("pipeline").warn(
          { slug, key: p.key, reason: err.reason, draw: redraws },
          "an expansion answer was refused; drawing again",
        );
      }
    }

    /**
     * **Kept only now, and the lateness is the design.**
     *
     * An answer stored before it had been parsed, covered and derived would be a
     * malformed-but-complete answer replayed for ever, every later attempt
     * "resuming" onto the same refusal with no call left to make that could come
     * out differently. So the write is after every check the answer can fail on
     * its own — which is exactly `readExpansion`, above, and is why the loop
     * breaks before it rather than after the executor returns.
     *
     * **A refused answer is never written**, on any draw. `normaliseExpansion`
     * deliberately keeps a refused answer's report off the run's books, and a
     * checkpoint on the refusal path would be the same double-count made
     * durable — with the row poisoning every future attempt as a bonus.
     */
    let checkpointed = false;
    try {
      const entry: ExpansionCheckpointEntry = { fingerprint: p.key, answer };
      await checkpoints.write(slug, DEEPEN_NAMESPACE, p.key, entry);
      checkpointed = true;
    } catch (err) {
      log("pipeline").warn(
        { slug, key: p.key, err },
        "could not save the expansion checkpoint; a later attempt will ask for this call again",
      );
    }
    outcomes[at] = { ...p, reading, resumed: false, redraws, usage, checkpointed };
  };

  /* Opened before the first call and closed on both roads out, so the figure on
     the artefact is this wave's rather than the shared gate's whole life.
     `GateWindow` says why that distinction is load-bearing. */
  const window = gate.watch();

  const summarise = (closed: GateWindow): ExpansionWaveResult => {
    const calls = outcomes.filter((o): o is ExpansionCallOutcome => o !== null);
    const refused = refusals.filter((r): r is RefusedCall => r !== null);
    return {
      refused,
      calls,
      asked: keys.length,
      found: stored.size,
      usable: resumed.size,
      outOfTime,
      rateLimited,
      gate: closed,
      /* **Derived from `calls` rather than accumulated beside them**, so there
         is one place a call's tokens are recorded and this cannot drift from
         it. */
      usage: calls.reduce((total, call) => addUsage(total, call.usage), NO_EXPANSION_USAGE),
    };
  };

  try {
    await allOrStop(
      prepared.map(async (p, at) => {
        try {
          await runOne(p, at);
        } catch (err) {
          /* **Running out of time is not a failure**, so it does not travel as one:
             the slot stays empty, the calls that landed keep their rows, and the
             next attempt reads them back. Every other error is the wave's end. */
          if (!(err instanceof WaveOutOfTime)) throw err;
          outOfTime++;
        }
      }),
      () => {
        /* One fatal call ends the wave, so nothing else should go out and pay for
           an answer nobody will read. This releases the calls still queued in the
           gate; the ones in flight are left alone on purpose, because a cancelled
           call is money spent for nothing and its row is what makes the next
           attempt cheap. */
        fatal.abort();
      },
      opts.drainMs ?? EXPANSION_DRAIN_MS,
    );
  } catch (err) {
    /* **The failure carries what the wave already measured.** Everything the
       peers bought — their rows, their children's verdicts, the tokens and the
       gate — used to leave with the throw, and a measurement run's unreadable
       failure is nearly as bad as no run. `ExpansionWaveFailed`. */
    throw new ExpansionWaveFailed(err, summarise(window.close()));
  }
  return summarise(window.close());
}

/* --------------------------------------------------------- the wave, wired */

/**
 * **The switch, and it is off.**
 *
 * Read at call time rather than frozen at import, so a deployment can turn one
 * ingest deep without a rebuild and a test can move it — the rule
 * `jobConcurrency` (src/jobs.ts) already states, and `dataRoot` did too before
 * src/store/data-root.ts was deleted 2026-09-05. Anything but `"1"` or `"true"`
 * is off, a misspelling included: this is the switch on a change that
 * multiplies a book's bill several times over, and a typo must fail closed.
 *
 * Whether it ever moves is **stage 8's decision**, with the evidence stage 5
 * measures — the same book read both ways, side by side, against the cost.
 * docs/plans/260904d-deepen-fat-sections.md § stage 8.
 */
export const DEEPEN_ENV = "SPIDERYARN_DEEPEN_HIERARCHY";

export function deepeningEnabled(): boolean {
  const asked = process.env[DEEPEN_ENV];
  return asked === "1" || asked === "true";
}

/**
 * **Buy every scoped call again for the articles named here, even the ones a
 * previous run already paid for.**
 *
 * **A comma-separated list of slugs, and it was a boolean until 2026-09-05.**
 * That was the second review's P0 and it is worth stating rather than
 * discovering: the value is read from `process.env` on **every wave**, so a
 * worker started with a boolean set re-asked for every eligible article it later
 * picked up — and stage 5b runs through the queue, so the worker doing the
 * repeats is the same worker serving everyone else. The switch was
 * process-wide and persistent when what it describes is *one article being
 * measured*. ⟨GPT Sol's second review of stage 5a, finding 1.⟩
 *
 * So it names articles. `SPIDERYARN_DEEPEN_REASK=moby-dick,origin-of-species`
 * re-asks those two and nothing else, whatever else the worker picks up.
 * Entries are trimmed, empty ones ignored, and the match is **case-sensitive**,
 * because a slug is.
 *
 * **`1`, `true` and `yes` do not mean "all articles"**, and there is
 * deliberately no spelling that does. They are read as slugs, they match
 * nothing, and `reaskExpansions` says so in a warning. The failure mode of the
 * old spelling was spending money on strangers' articles, so there must be no
 * way to ask for that by accident — not even a deliberate one, since nothing
 * this is for wants it.
 *
 * ## What it is for
 *
 * Question 1 of the live wave — *is the verdict stable across repeats?* — is the
 * one stage 6 leans on, and it **cannot be measured without this**. The scoped
 * calls are content-addressed, so a second run over the same article reads its
 * own `hierarchy-deepen` rows back and makes no call at all: the repeat is free
 * and the verdicts come out identical **by construction**, which looks exactly
 * like a perfectly stable signal and is worth nothing.
 * docs/plans/260904d-deepen-fat-sections.md § "What the live run must answer".
 *
 * ## It bypasses the read, and it is not a delete
 *
 * `CheckpointStore` has `read` and `write` and no `delete`, deliberately —
 * src/store/checkpoints.ts § "And there is no `delete`" — and this does not add
 * one. Nothing is removed, and nothing has to be: skipping the read is the whole
 * mechanism.
 *
 * **A re-asking wave still writes.** Last-write-wins (that file, § "Concurrency,
 * and why the last write wins") means the freshest answer replaces the stale one
 * under the same key, which is what you want across repeats — and it means a
 * genuine resumption *after* a re-asking run is still cheap, because the rows
 * are all there and are the newest ones. A wave that read nothing and wrote
 * nothing would leave the next ordinary attempt paying for a wave it had watched
 * being bought.
 *
 * ## The deepening wave only, and wave 1 is left resumed on purpose
 *
 * This does not touch the `hierarchy-structure` checkpoint, and that is the
 * point rather than an omission. **A resumed wave 1 is what holds the seed
 * constant**: every repeat expands the identical tree, from the identical frozen
 * outline, with the identical ranges, so a verdict that moves between repeats is
 * the scoped call changing its mind rather than a different tree being asked a
 * different question. Re-asking the structure call too would measure both at
 * once and could not separate them — and would add roughly two dollars and eight
 * minutes to every repeat for the privilege.
 *
 * A repeat therefore wants the article's structure row to already exist, which
 * is to say: run it once ordinarily, then repeat with this set.
 */
export const REASK_ENV = "SPIDERYARN_DEEPEN_REASK";

/** The spellings that used to mean "every article", and now mean no article. */
const BOOLEAN_SPELLINGS = new Set(["1", "true", "yes", "on", "0", "false", "no", "off"]);

/** The slugs the variable names, trimmed, with the empty entries dropped. */
export function parseReaskSlugs(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * **The configuration the warning below has already been said about**, so that a
 * worker chewing through a queue says it once rather than once an article — and
 * says it again if somebody changes the variable, which is a new mistake.
 */
let warnedAboutReask: string | null = null;

/**
 * **Is *this* article one of the ones being re-asked?**
 *
 * `false` for every article the variable does not name, which is the whole
 * point — see `REASK_ENV`.
 *
 * ## The misconfiguration is loud
 *
 * A variable that is set and names nothing this run ever sees produces exactly
 * the output of a variable nobody set: no call, no warning, a free repeat and a
 * stability measurement that is perfect by construction. That is
 * docs/reusable/silent-success.md with money attached, so a set variable whose
 * list does not contain this slug is a `warn` naming the slugs it *did* parse —
 * once per configuration. A boolean spelling gets its own sentence, because
 * "I set it to 1 and nothing happened" is the mistake most likely to be made.
 */
export function reaskExpansions(slug: string): boolean {
  const raw = process.env[REASK_ENV];
  const slugs = parseReaskSlugs(raw);
  if (slugs.includes(slug)) return true;
  if (slugs.length > 0 && warnedAboutReask !== raw) {
    warnedAboutReask = raw ?? null;
    const boolean = slugs.filter((s) => BOOLEAN_SPELLINGS.has(s.toLowerCase()));
    log("pipeline").warn(
      {
        slug,
        env: REASK_ENV,
        namesSlugs: slugs,
        booleanSpellings: boolean,
      },
      boolean.length > 0
        ? `${REASK_ENV} is a comma-separated list of slugs and a boolean spelling names no article; ` +
            "this wave is resuming its checkpoints as usual"
        : `${REASK_ENV} is set and does not name this article; this wave is resuming its checkpoints as usual`,
    );
  }
  return false;
}

/**
 * **Where the per-candidate records are written, and unset means nowhere.**
 *
 * A directory. Every deepening pass drops one JSON file into it, named for the
 * slug and stamped to the second, so **repeats accumulate rather than overwrite**
 * — which is the whole point, because two of the five questions stage 5b exists
 * to answer can only be answered by comparing one run's records with another's
 * (docs/plans/260904d-deepen-fat-sections.md § "What the live run must answer").
 *
 * **A file rather than the log line, and the shape is the eval harness's**
 * (evals/hierarchy-structure/run.ts writes one directory per run and rewrites
 * `run.json` as it goes): a per-node fact that only exists as a log line is a
 * fact somebody has to scrape out of a journal before they can divide one number
 * by another, and the questions here are rates and stabilities rather than
 * events. `DeepenStats` stays on the run and in the log line, because that is
 * the operator's view; this is the analyst's.
 *
 * **Not on `HierarchyRun`**, which is read on every ingest by code that wants
 * eight numbers, not several hundred rows.
 */
export const DEEPEN_RECORDS_ENV = "SPIDERYARN_DEEPEN_RECORDS";

/** One deepening pass's instrumentation, as it lands on disk. */
export interface DeepenRecordsFile {
  /**
   * Bump it when a field's meaning changes, so an old file cannot be read as a
   * new one.
   *
   * `deepen-records/2`, 2026-09-05: `failed` and `reason` are new, every record
   * carries its derived `range` (src/hierarchy-expand.ts § `CandidateRecord`),
   * and `stats` gained `uncheckpointed` and `gate`. A `/1` file read as a `/2`
   * would pair repeats on `where` alone, which is the pairing finding 6 was
   * about.
   *
   * `deepen-records/3`, later the same day: a record can carry `refused`, and
   * `stats` gained `refusedTargets` — a call the model declines on every draw now
   * fails its own targets rather than the wave. **The bump is not bookkeeping.**
   * A `/2` file has no `refused` on any record, so the eval's `refusedRates`
   * would read it as *nothing was refused* — over runs where a refusal was the
   * whole story, since in `/2` a refusal killed the run before it could be
   * written down. Refusing the older file is the only reading that is not a
   * quiet zero. docs/reusable/silent-success.md.
   */
  version: "deepen-records/3";
  slug: string;
  /** ISO 8601, so files from several runs sort and can be told apart. */
  writtenAt: string;
  /**
   * **The pass threw, and this is what it had measured when it did.** The tree
   * is wave 1's and `stats.expanded` is 0; what is here is the governor's
   * decisions, whatever peers landed, and the bill.
   */
  failed: boolean;
  /** Why, where `failed` — the class and the message. `null` otherwise. */
  reason: string | null;
  /** The same object the run and the log line carry. */
  stats: DeepenStats;
  /**
   * One per node the governor decided about. Safe to write down: `where` is an
   * ordinal path, `range` is a pair of block ids, and every other field is a
   * number, an enum or a model id — src/hierarchy-expand.ts § `CandidateRecord`
   * states that rule.
   */
  records: CandidateRecord[];
}

/**
 * **Keep one pass's records, if anybody asked for them.**
 *
 * `DEEPEN_RECORDS_ENV` unset is the ordinary case and writes nothing at all.
 *
 * **It never throws.** Instrumentation that can fail the article it is measuring
 * is worse than no instrumentation, which is the same trade the checkpoint
 * read and write take a few hundred lines above.
 *
 * ## Why the name carries a counter, and why the write is exclusive
 *
 * The stamp carried the second and the process id, for the collision
 * evals/hierarchy-labels.ts records losing two runs to — and **that is not
 * enough for the thing this is for**. `--repeat` is two passes over one slug
 * inside one process inside one second, so the pid separates nothing and the
 * second pass landed on top of the first: the repeat overwrote the run it was
 * bought to be compared against, and said nothing. ⟨GPT Sol's second review of
 * stage 5a, finding 4.⟩
 *
 * So the name also carries a **process-local monotonic counter**, and the file
 * appears under its final name **exclusively** — a collision is an `EEXIST` this
 * function can see rather than an overwrite it cannot. On one, it takes the
 * next number and tries again, a bounded number of times. Two processes writing
 * into one directory in one second are the case that is actually for; the
 * counter is what makes the retry terminate.
 *
 * ## And why the bytes are written somewhere else first
 *
 * They used to go straight to the visible name, and a reader is not
 * hypothetical: the stage-5b eval runs three deepening jobs at once against one
 * records directory and lists it as each job stops, so it could open a sibling's
 * file **between the create and the last byte**, fail to parse it, and mark the
 * wrong job fatal. ⟨GPT Sol reviewing the stage-5b harness, DPN-14.⟩
 *
 * So the body goes to a unique temporary name and is published with `link`,
 * which is atomic *and* fails with `EEXIST`. `rename` would be atomic and would
 * silently overwrite, which is the other half of what this function is for. A
 * file under the final name is therefore always whole.
 */
export async function saveDeepenRecords(
  slug: string,
  result: DeepenResult,
  /**
   * Present where the pass **threw** — see `DeepenFailed`. The file is written
   * from whatever telemetry the failure carried, with `failed: true` and this
   * reason, because a measurement run's failure I cannot read is nearly as bad
   * as no run.
   */
  failure?: { reason: string },
): Promise<void> {
  const dir = process.env[DEEPEN_RECORDS_ENV];
  if (dir === undefined || dir.trim() === "") return;
  const file: DeepenRecordsFile = {
    version: "deepen-records/3",
    slug,
    writtenAt: new Date().toISOString(),
    failed: failure !== undefined,
    reason: failure?.reason ?? null,
    stats: result.stats,
    records: result.records,
  };
  /* The slug reaches a path, so it is spelled out rather than trusted: a store
     key is not a filename and nothing else here checks it. */
  const safe = slug.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "article";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const body = `${JSON.stringify(file, null, 2)}\n`;
  /* Not named `.json`, so a concurrent reader listing the directory never even
     considers it. */
  const temp = join(dir, `.${safe}-${process.pid}-${randomUUID()}.records-tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(temp, body, { encoding: "utf-8", flag: "wx" });
    try {
      for (let tries = 0; tries < RECORD_NAME_ATTEMPTS; tries++) {
        const at = join(dir, `${safe}-${stamp}-${process.pid}-${++recordsWritten}.json`);
        try {
          /* **`link`, so a name already taken is an error rather than an
             overwrite.** That is the whole point of the counter: the failure
             being guarded against is one file where there should be two. And
             the file appears whole or not at all, which is the other. */
          await link(temp, at);
          return;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
      }
      throw new Error(
        `${RECORD_NAME_ATTEMPTS} record filenames in a row were already taken under ${dir}`,
      );
    } finally {
      /* The link is the file now. A temp left behind after a failed link is
         litter rather than damage, so this failing is not worth reporting. */
      await unlink(temp).catch(() => undefined);
    }
  } catch (err) {
    log("pipeline").warn(
      { slug, dir, err },
      "could not write the deepening records; the wave itself is unaffected",
    );
  }
}

/**
 * **How many passes this process has written records for**, and therefore the
 * number in the next filename. Process-local and monotonic, which is exactly as
 * much uniqueness as `--repeat` needs; `wx` covers the rest.
 */
let recordsWritten = 0;

/** How many taken names to walk past before giving up and warning. */
const RECORD_NAME_ATTEMPTS = 20;

/** What one deepening pass came to. Every field is reported, including at zero. */
export interface DeepenStats {
  /** Frontier nodes the governor chose — sections a mechanical bound calls unfinished. */
  targets: number;
  /** Of those, the ones a call actually came back about. */
  expanded: number;
  /** Nodes the wave added to the tree. */
  added: number;
  /**
   * **Sections whose answer was in hand — bought or resumed — and not
   * published**, because the deadline had split the wave (`deepenTree` § "All of
   * the wave, or none of it") or because the wave then failed. Normally 0.
   *
   * Its own number rather than an inference from `outOfTime`, because it is the
   * one that says what the next attempt gets for free: **every one of these has
   * a checkpoint row that actually landed**, and until 2026-09-05 that sentence
   * was false. The write is deliberately best-effort — instrumentation and
   * caching must not fail the article — and its failure was swallowed while the
   * outcome was counted anyway, so this claimed rows that did not exist and the
   * next attempt bought them again. ⟨GPT Sol's second review of stage 5a,
   * finding 2.⟩ The trade stands for the *article*; the count stops lying.
   * `ExpansionCallOutcome.checkpointed` is what it is now read off.
   */
  withheld: number;
  /**
   * **Answers that were paid for, not published, and whose row never landed** —
   * money that buys the next attempt nothing, and the sibling `withheld` needed
   * in order to stop claiming them.
   *
   * Above zero is a `warn` and a thing to go and look at: the checkpoint store
   * is refusing writes, and every deepening this process does is being bought
   * twice.
   */
  uncheckpointed: number;
  /** Calls paid for. */
  calls: number;
  /** Calls an earlier attempt had already paid for. */
  resumed: number;
  /**
   * Targets whose own request would not fit, and were therefore not asked about.
   * They keep the shape wave 1 gave them. Normally 0.
   */
  oversized: number;
  /**
   * **Targets whose call the model refused on every draw its budget allowed** —
   * left exactly as wave 1 made them, and the wave published without them.
   * `RefusedCall`. 0 is the ordinary reading; a number that climbs on small
   * nodes is the selector asking a question the recipe cannot ask.
   */
  refusedTargets: number;
  /** Calls the wave would not start because the step was running out of time. */
  outOfTime: number;
  /** 429s met. */
  rateLimited: number;
  /**
   * **What the width gate did while this pass ran** — its width at the start and
   * the end, the narrowest it went, and the refusals it saw — or `null` where
   * the pass made no call at all.
   *
   * `rateLimited` alone could not explain a slow wave: a count with no width
   * beside it cannot say whether the gate narrowed to one and stayed there.
   * ⟨GPT Sol's second review of stage 5a, finding 7.⟩
   *
   * **Per pass, not the singleton's cumulative `report()`**, which is shared
   * with every other concurrent job and would put another book's rate limit on
   * this one's artefact. `null` rather than a window of zeros, because a width
   * of zero is a different and much more alarming fact than "nothing happened
   * here".
   */
  gate: GateWindow | null;
  /** The verdicts the wave collected — **recorded, not obeyed.** See `deepenTree`. */
  verdicts: VerdictTally;
  /**
   * **What this pass paid for**, summed over every draw of every call it made —
   * `NO_EXPANSION_USAGE` where every call was resumed, and where none was made.
   *
   * **It is not conditioned on publication.** A wave the deadline split
   * (`withheld` above zero) publishes nothing and still spent the money, and a
   * cost figure that quietly dropped those calls would be the one number a
   * budget must not get wrong. `expanded` says what the reader got; this says
   * what it cost.
   *
   * It reaches `HierarchyRun`'s four totals (src/hierarchy.ts) and the records
   * file, which is the artefact a repeat comparison actually reads.
   */
  usage: ExpansionUsage;
}

/**
 * **A deepening pass that threw, carrying everything it had already measured.**
 *
 * `generateHierarchy` catches this and writes a records file with `failed: true`
 * before it falls back to wave 1, so a paid run's failure is still readable.
 * `partial` is a `DeepenResult` in every respect — `root` is `null`, `expanded`
 * is 0 — so nothing downstream has a second shape to learn.
 *
 * `cause` is the original error, **not** the `ExpansionWaveFailed` wrapper: what
 * a log line and a records file want is what actually went wrong, and the
 * wrapper's only job was to get the telemetry this far.
 */
export class DeepenFailed extends Error {
  constructor(
    override readonly cause: unknown,
    readonly partial: DeepenResult,
  ) {
    super(`the deepening wave failed: ${describeFailure(cause)}`);
    this.name = "DeepenFailed";
  }
}

/** A deepened proposal, and what it cost to get. */
export interface DeepenResult {
  /**
   * The proposal to build, or `null` where nothing may be built — no eligible
   * section, every eligible one refused for size, or a wave the deadline split
   * and whose answers are therefore **withheld** (§ "All of the wave, or none of
   * it"). `null` means *keep the tree you already have*, which is exactly
   * today's article.
   */
  root: ModelNode | null;
  stats: DeepenStats;
  /**
   * What deriving the answers repaired and dropped. Merged into the run's own —
   * but only where `root` is non-null, since a repair to a subtree nobody
   * published is not something the run made.
   */
  report: BuildReport;
  /**
   * One per node the governor decided about — wave 1's frontier and wave 2's
   * children alike. The instrumentation the plan asks for **before** the live
   * pilot rather than after it, because a model that always says "deeper" turns a
   * bounded cascade into a bill.
   */
  records: CandidateRecord[];
}

/**
 * **Money that buys the next attempt nothing**, said out loud whenever there is
 * any — the answers this pass paid for, did not publish, and could not write a
 * row for. Silent at zero, which is every ordinary pass.
 */
function warnUncheckpointed(slug: string, uncheckpointed: number): void {
  if (uncheckpointed <= 0) return;
  log("pipeline").warn(
    { slug, uncheckpointed, namespace: DEEPEN_NAMESPACE },
    "expansion answers were paid for, withheld, and could not be checkpointed; " +
      "the next attempt will buy them again",
  );
}

/** A frontier node, and everything needed to ask about it and to attach the answer. */
interface Candidate {
  target: ExpansionTarget;
  /** The proposal node itself — the object the children are attached to. */
  node: ModelNode;
  /** Root first, own parent last. `TargetBriefing.ancestors`. */
  ancestors: OutlineEntry[];
  /** Its own depth in the proposal; the root is 0. */
  depth: number;
  /**
   * **This node's own row in `records`, by reference**, so that the two facts a
   * call produces — how often it was redrawn, and how many children it came back
   * with — can be written onto the node they are about once the call has landed.
   *
   * The record has to exist *before* the call, because it is what decides
   * whether there is a call at all (`record.effective.decision`). Carrying the
   * reference is what stops those two fields being recorded against the
   * children instead, which is where they went until 2026-09-05.
   */
  record: CandidateRecord;
}

/** A child set that stood up, and the proposal node it belongs under. */
interface Attachment {
  candidate: Candidate;
  children: ModelNode[];
  /**
   * Whether the call this came from has a checkpoint row a later attempt will
   * find — `ExpansionCallOutcome.checkpointed`, carried down to the target so
   * that `withheld` can count only the durable ones.
   */
  checkpointed: boolean;
}

/** What a wave's answers came to, **before** anything decides to publish them. */
interface WaveReading {
  attachments: Attachment[];
  /** One per child the wave produced. Wave-1's records are the caller's. */
  records: CandidateRecord[];
  /** What deriving those answers repaired and dropped. */
  report: BuildReport;
}

function emptyReport(): BuildReport {
  return { repairs: [], droppedChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] };
}

/**
 * **Read a finished wave into the three things it produced** — the child sets,
 * the records, and the derivation's report — **and attach none of them.**
 *
 * Separate from `deepenTree` because the two questions are separate and reading
 * them nested was where the complexity check pointed: *what did the wave come
 * back with* is per call, and *may any of it be published* is a fact about the
 * whole wave (`deepenTree` § "All of the wave, or none of it"). Keeping the
 * mutation of the proposal out of this function is what makes the second
 * question answerable at all.
 *
 * The one thing it does mutate is each expanded candidate's **own** record, with
 * the two numbers that could not be known before its call. See below.
 */
function readWaveAnswers(opts: {
  wave: ExpansionWaveResult;
  byTarget: Map<ExpansionTarget, Candidate>;
  blocks: readonly Block[];
  recipe: CascadeRecipe;
  index: BlockIndex;
}): WaveReading {
  const { wave, byTarget, blocks, recipe, index } = opts;
  const attachments: Attachment[] = [];
  const records: CandidateRecord[] = [];
  const report = emptyReport();
  for (const call of wave.calls) {
    report.repairs.push(...call.reading.report.repairs);
    report.droppedChildren.push(...call.reading.report.droppedChildren);
    report.droppedHeadings.push(...call.reading.report.droppedHeadings);
    report.collapsedRungs.push(...call.reading.report.collapsedRungs);
    report.droppedQuestions.push(...call.reading.report.droppedQuestions);
    for (const answered of call.reading.targets) {
      const candidate = byTarget.get(answered.target);
      if (candidate === undefined) {
        /* The targets came out of `frontier` and travelled through the planner by
           identity, so this cannot happen on the ordinary path. If it ever did,
           the children would be attached to nothing and the run would report a
           deepening that is not in the tree. */
        throw new Error(
          `An expansion came back for ${answered.target.where}, which is not a section this wave ` +
            `asked about, so there is nothing to attach it to.`,
        );
      }
      attachments.push({
        candidate,
        children: answered.children.map((c) => c.node),
        checkpointed: call.checkpointed,
      });
      /**
       * **The call's own two numbers, on the node the call was about.**
       *
       * Recorded here rather than at `recordCandidate` because neither is known
       * until the answer lands, and recorded on the *parent* because that is
       * whose call was redrawn and whose children were counted. Both were on the
       * children until 2026-09-05, so a node nothing was ever drawn for carried
       * its parent's redraws and `fanOut` was `null` across the whole run.
       * ⟨GPT Sol's review of stage 5a, finding 4.⟩
       *
       * A withheld wave still records them: they describe the answer that was
       * bought, not the tree that was published.
       */
      candidate.record.retries = call.redraws;
      candidate.record.fanOut = answered.children.length;
      for (const [i, child] of answered.children.entries()) {
        records.push(
          recordCandidate({
            node: child.node,
            where: `${candidate.target.where} > child ${i + 1}`,
            wave: 2,
            depth: candidate.depth + 1,
            blocks,
            recipe,
            /* **The verdict of the proposal this very node was built from.** */
            verdict: child.proposed.verdict,
            /* No `retries` and no `fanOut`: this node was never itself expanded,
               so nothing about it was drawn twice and nothing fanned out from
               it. They belong to its parent, above. */
            index,
          }),
        );
      }
    }
  }

  /**
   * **A refused target keeps the shape wave 1 gave it, and says so.**
   *
   * Nothing is attached — that is the whole point — so the only trace is on the
   * node's own record. Written here beside `retries` and `fanOut` for the same
   * reason they are: it is not known until the answer fails to land.
   *
   * **Three states that must never share a spelling.** *Finished by the model*
   * is `decision: "stop", because: "verdict"`. *Stopped by a bound* is
   * `decision: "stop"` with the bound's name. *Refused* keeps the governor's own
   * `decision: "expand"` — which is true, the governor did force it open — and
   * carries this instead. Reading a refusal as "the model said it was finished"
   * would be the move `granularity-zoom.md` § The supplement node already forbids
   * one field over: never infer the role from a missing answer.
   */
  for (const call of wave.refused) {
    for (const target of call.targets) {
      const candidate = byTarget.get(target);
      if (candidate === undefined) continue;
      /* The draws this node cost, on the node they were spent on — the same
         convention as an answered call's `redraws` above. */
      candidate.record.retries = call.draws - 1;
      candidate.record.refused = {
        reason: call.reason,
        draws: call.draws,
        shape: call.shape,
      };
    }
  }
  return { attachments, records, report };
}

/**
 * **One additional wave over the sections a mechanical bound says are
 * unfinished** — the whole of stage 5, and deliberately not one call more.
 *
 * ## Seeded from the built tree, never from the raw answer
 *
 * `buildTree` does not accept the model's ranges, it **derives** them: it pins
 * the first child to its parent's start, clamps later starts back inside, snaps a
 * section onto its own heading, and computes every end. So a scoped call handed
 * the raw wave-1 proposal could be shown section `[20…40]` while the finished
 * tree gives that node `[18…47]`, and the titles and gists it wrote would
 * describe **prose the call never saw** — a tree that tiles, covers every block
 * and passes every invariant while being about the wrong paragraphs. Moby-Dick's
 * structure answer needed 55 boundary repairs, so this is not theoretical.
 *
 * Hence `proposalFromTree`, over the tree `buildTree` has already made. Four
 * things follow, and they are why the ordering is not negotiable: every scoped
 * call is shown the range the finished tree will give the node; every check
 * `buildTree` makes still runs **once** over the finished proposal, with no
 * second validation path to keep in step; the leaf layer is grown once, under
 * whatever the deepest node on each branch turns out to be; and a unary rung can
 * never reach a scoped call, because `buildTree` has already spliced it away
 * (src/hierarchy.ts § `collapseRestatedRungs`).
 *
 * **Give it the body tree**, before `appendSupplement`. A supplement is a
 * depth-one node of leaves, `ModelNode` has nowhere to put its `treatment`, and
 * `proposalFromTree` would hand it back as an ordinary childless node — which
 * this function would then take for a section and try to divide.
 *
 * ## What the frontier is
 *
 * The **childless** nodes of the proposal: a node whose tree children are all
 * leaves is a section, and a section is what this plan is about. Each is put to
 * `decideExpansion` with **no verdict**, because nobody has been asked about
 * wave 1's nodes — so what selects a target is a mechanical bound and nothing
 * else: an authored heading no boundary starts on, or more body words than
 * `forcedOpenWords` under a node above the divisibility floor. That is exactly
 * *"one additional scoped wave over mechanically selected targets"*.
 *
 * The frontier arrives in document order because a depth-first walk of a tiling
 * tree does, which is what `planExpansionBatches` requires and asserts.
 *
 * ## All of the wave, or none of it
 *
 * A wave the step's deadline cuts in half is **not published at all**: which
 * calls got out and which were declined at the gate is settled by the dispatch
 * jitter, so half a wave is a tree two identical runs disagree about. The rows
 * of the calls that landed are kept, so the next attempt is cheap — but nothing
 * schedules that attempt. The code and the full argument are at `partial`,
 * below.
 *
 * ## The verdicts are recorded and not obeyed
 *
 * Every child comes back saying whether it is finished or wants a level of its
 * own, and **stage 5 counts those and stops**. Obeying them is the recursion, it
 * is stage 6, and it is conditional on these numbers saying the verdict is stable
 * — the spike ran one section twice and got 6 "needs-deeper" of 10 children one
 * time and 1 of 20 the next. `DeepenStats.verdicts` is that measurement, and it
 * is only sayable per child because `normaliseExpansion` hands back each node
 * beside the proposal it was built from.
 *
 * ## Why `finaliseCascade` is not the road here
 *
 * `assertCascadeComplete` asks *"was every node the cascade created ever actually
 * asked about?"*, and faults a terminal node that `shouldExpand` would split
 * unless a `capReached` record explains it. That is the right question for a
 * cascade run to completion and the wrong one for a single mechanical wave: a
 * wave-1 section of twenty blocks with no heading and 1,500 words is above the
 * floor and was stopped at `no-verdict` **by the governor, on purpose**, so
 * satisfying the assertion would mean writing `capReached` records for nodes
 * nothing capped — bookkeeping that lies. The guards here are the ones that fit:
 * `buildTree` and `assertTreeSound` over the whole result, which the caller runs
 * anyway, plus this function's own rule that a target either gains a complete
 * child set or is left exactly as wave 1 made it. `finaliseCascade` becomes the
 * road at stage 6, where a `CascadeState` is the representation and its question
 * is the right one.
 */
export async function deepenTree(opts: {
  /** The body tree wave 1 produced — **before** `appendSupplement`. */
  tree: Tree;
  /** The body, after `splitBlocks`: the same array wave 1 was called with. */
  blocks: readonly Block[];
  slug: string;
  checkpoints: CheckpointStore;
  execute: ExpansionExecutor;
  recipe?: CascadeRecipe;
  /** Wall clock the step must be finished by. See `runExpansionWave`. */
  deadlineAt?: number;
  signal?: AbortSignal;
  /**
   * Injectable for the same reason `runExpansionWave` takes one: the only shape
   * the deadline reserve can actually stop is a wave with more calls in it than
   * the gate has room for, and posing that in a test needs a gate the test owns.
   * Production shares the module's.
   */
  gate?: WidthGate;
  /** Forwarded to the wave. Defaults there to `reaskExpansions(slug)`, which is off. */
  reask?: boolean;
  onProgress?: (detail: string) => void;
}): Promise<DeepenResult> {
  const { tree, blocks, slug } = opts;
  const recipe = opts.recipe ?? CASCADE_RECIPE;
  const index = indexBlocks(blocks);
  const root = proposalFromTree(tree);
  const records: CandidateRecord[] = [];
  const frontier: Candidate[] = [];

  const rung = (node: ModelNode): OutlineEntry => ({
    title: node.title,
    ...(node.gist !== undefined ? { gist: node.gist } : {}),
  });

  const walk = (node: ModelNode, where: string, depth: number, above: OutlineEntry[]): void => {
    const children = node.children ?? [];
    if (children.length > 0) {
      const ancestors = [...above, rung(node)];
      for (const [i, child] of children.entries()) {
        walk(child, `${where} > child ${i + 1}`, depth + 1, ancestors);
      }
      return;
    }
    /* No `verdict`, because nobody has been asked about a wave-1 node — a third
       state rather than "finished", which `decideExpansion` reports under its own
       names (`no-verdict`, `unassessed-ceiling`) so that the bounds cannot read
       high on the one wave where no verdict exists. */
    const record = recordCandidate({ node, where, wave: 1, depth, blocks, recipe, index });
    records.push(record);
    if (record.effective.decision !== "expand") return;
    /* A `CascadeNode` view of the proposal node, because that is what an
       `ExpansionTarget` carries. Field by field rather than a spread: a
       `PendingNode` is `children?: never`, and saying so here is what makes
       *"only a childless node is ever a target"* a compile-time fact rather than
       a habit. It is a copy, so `candidate.node` — the object actually in the
       proposal — stays the one thing an answer can be attached to. */
    const pending: CascadeNode = {
      status: "pending",
      title: node.title,
      range: node.range,
      ...(node.gist !== undefined ? { gist: node.gist } : {}),
      ...(node.sourceHeading !== undefined ? { sourceHeading: node.sourceHeading } : {}),
    };
    frontier.push({ target: { node: pending, where }, node, ancestors: above, depth, record });
  };
  walk(root, "root", 0, []);

  const nothing = (over: Partial<DeepenStats> = {}): DeepenResult => ({
    root: null,
    report: emptyReport(),
    records,
    stats: {
      targets: frontier.length,
      expanded: 0,
      added: 0,
      withheld: 0,
      uncheckpointed: 0,
      calls: 0,
      resumed: 0,
      oversized: 0,
      refusedTargets: 0,
      outOfTime: 0,
      rateLimited: 0,
      /* No call was made, so the gate was never asked anything. */
      gate: null,
      verdicts: tallyVerdicts(records),
      usage: NO_EXPANSION_USAGE,
      ...over,
    },
  });

  /* **The ordinary article, and it must cost nothing.** Most pieces have no
     section a bound calls unfinished, and for those this is a walk of a small
     tree and no call at all. */
  if (frontier.length === 0) return nothing();

  const seed = frozenSeed(tree);
  const byTarget = new Map(frontier.map((c) => [c.target, c]));
  const briefings = frontier.map((c) => ({ target: c.target, ancestors: c.ancestors }));
  /* Measured off the real strings rather than left at `UNMEASURED_OVERHEAD`,
     whose zeros make the hard request bound degenerate to the evidence total —
     fine for a test about packing, and not fine in a wave, whose feasibility cap
     would then be measuring the wrong thing. */
  const overhead = expansionOverhead({ briefings, blocks, outline: seed.outline, index });
  const planned = planExpansionBatches(
    frontier.map((c) => c.target),
    blocks,
    recipe,
    overhead,
  );

  const batches = planned.filter((call): call is ExpansionBatch => call.kind === "batch");
  const oversized = planned.length - batches.length;
  for (const call of planned) {
    if (call.kind !== "oversized") continue;
    /**
     * **A section too big to ask about is left exactly as wave 1 made it**, and
     * the run says so.
     *
     * Both alternatives are worse. Failing the article would cost a reader their
     * piece over an enhancement; cutting the section across two calls is the one
     * thing `planExpansionBatches` refuses on purpose, because two calls given the
     * same parent each decide where its children start and neither can see the
     * other's boundaries. So it is skipped, and skipped *loudly*: the node keeps
     * the shape every reader has today, which is the honest fallback.
     *
     * With `maxRequestTokensPerBatch` at 120,000 and the largest section ever
     * measured at 76,558 input tokens, this should never fire. A number here means
     * the recipe wants a smaller `terminalBlocks`, or that some document is unlike
     * anything in the corpus.
     */
    log("pipeline").warn(
      {
        slug,
        where: call.target.where,
        estimatedRequestTokens: call.estimatedRequestTokens,
        limit: call.limit,
      },
      "a section is too large for one expansion call; leaving it at the depth wave 1 gave it",
    );
  }

  if (batches.length === 0) return nothing({ oversized });
  opts.onProgress?.(`deepening ${frontier.length} sections in ${batches.length} calls`);

  /**
   * **Every road out of the wave, including the one that throws.**
   *
   * A fatal wave used to return nothing at all, so wave 1's governor decisions,
   * whatever the paid peers bought, the gate's report and the token accounting
   * all left with the throw — and three of the five questions stage 5b exists to
   * answer are exactly those numbers. ⟨GPT Sol's second review of stage 5a,
   * finding 5.⟩
   *
   * The wave hands its partial back on `ExpansionWaveFailed`; this reads it the
   * same way it reads a successful one, and rethrows a `DeepenFailed` carrying a
   * whole `DeepenResult`. **The only thing that differs from the success path is
   * that nothing is attached.**
   */
  const wave = await runExpansionWave({
    slug,
    checkpoints: opts.checkpoints,
    execute: opts.execute,
    batches,
    /* By identity, out of the map built above: `planExpansionBatches` carries the
       very target objects it was given, in order. Asked per target rather than
       passed as a parallel array, for the reason that signature gives.

       **A miss throws rather than answering `[]`.** An empty chain is a legal
       answer — the root has one — so a default here would send a call with no
       ancestors above its section, which is precisely the blind subtree call
       260826h names as where four sections all end up meaning "Background". It
       would cost money and produce a plausible tree. */
    ancestorsOf: (target) => {
      const candidate = byTarget.get(target);
      if (candidate === undefined) {
        throw new Error(
          `The wave asked for the chain above ${target.where}, which is not a section this ` +
            `deepening chose. A call with no ancestors above it is a blind subtree call.`,
        );
      }
      return candidate.ancestors;
    },
    blocks,
    seed,
    recipe,
    index,
    ...(opts.deadlineAt !== undefined ? { deadlineAt: opts.deadlineAt } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.gate ? { gate: opts.gate } : {}),
    ...(opts.reask !== undefined ? { reask: opts.reask } : {}),
  }).catch((err: unknown) => {
    if (!(err instanceof ExpansionWaveFailed)) throw err;
    const partial = readWaveAnswers({ wave: err.partial, byTarget, blocks, recipe, index });
    records.push(...partial.records);
    const banked = partial.attachments.filter((a) => a.checkpointed).length;
    warnUncheckpointed(slug, partial.attachments.length - banked);
    throw new DeepenFailed(err.cause, {
      root: null,
      report: partial.report,
      records,
      stats: {
        targets: frontier.length,
        expanded: 0,
        added: 0,
        withheld: banked,
        uncheckpointed: partial.attachments.length - banked,
        calls: err.partial.calls.filter((c) => !c.resumed).length,
        resumed: err.partial.calls.filter((c) => c.resumed).length,
        oversized,
        refusedTargets: refusedTargetsIn(err.partial),
        outOfTime: err.partial.outOfTime,
        rateLimited: err.partial.rateLimited,
        gate: err.partial.gate,
        verdicts: tallyVerdicts(records),
        usage: err.partial.usage,
      },
    });
  });

  const read = readWaveAnswers({ wave, byTarget, blocks, recipe, index });
  const { attachments, report } = read;
  records.push(...read.records);

  /**
   * **All of the wave, or none of it.**
   *
   * `outOfTime` above zero means the deadline split this wave: some calls went
   * out and some were declined at the gate, and *which* is decided by the
   * dispatch jitter — so attaching whatever came back would publish a tree that
   * two identical runs disagree about. The reader would get one fat section
   * deepened and its neighbour not, for no reason anybody could name.
   *
   * So a partial wave publishes nothing and the article keeps today's tree,
   * which is correct and simply not deeper. **What was paid for is not lost**:
   * every call that landed wrote its own row before this point, and the next
   * attempt reads them back and buys only the rest.
   *
   * **Nothing schedules that next attempt**, and this is the honest limit rather
   * than a plan. `WaveOutOfTime` returns normally, the labels are written, and
   * the job is committed done — so the retry is the reader pressing it, or a
   * later re-ingest, exactly as a PDF that needs two lease windows works
   * (docs/project/content-extraction.md). Automatic requeueing is a design
   * change and is deliberately not made here.
   *
   * **An oversized section is not this case.** It was never asked about, the
   * decision is deterministic, and the rest of the wave is complete over the
   * batches that *were* planned — so it does not withhold anything.
   */
  const partial = wave.outOfTime > 0;
  /* **Only the answers whose row actually landed.** A best-effort write that
     threw leaves an answer that was paid for and buys the next attempt nothing;
     counting it under `withheld` was the claim `DeepenStats.withheld` could not
     support. */
  const banked = attachments.filter((a) => a.checkpointed).length;
  const uncheckpointed = partial ? attachments.length - banked : 0;
  if (partial) {
    log("pipeline").warn(
      { slug, bought: attachments.length, banked, outOfTime: wave.outOfTime },
      "the deadline cut this deepening wave in half; publishing none of it and keeping the rows",
    );
  } else {
    for (const { candidate, children } of attachments) candidate.node.children = children;
  }
  warnUncheckpointed(slug, uncheckpointed);
  const expanded = partial ? 0 : attachments.length;
  const added = partial ? 0 : attachments.reduce((n, a) => n + a.children.length, 0);

  return {
    /* `null` where nothing was attached, so the caller builds nothing a second
       time and the article is byte-identical to today's. */
    root: expanded > 0 ? root : null,
    report,
    records,
    stats: {
      targets: frontier.length,
      expanded,
      added,
      withheld: partial ? banked : 0,
      uncheckpointed,
      calls: wave.calls.filter((c) => !c.resumed).length,
      resumed: wave.calls.filter((c) => c.resumed).length,
      oversized,
      refusedTargets: refusedTargetsIn(wave),
      outOfTime: wave.outOfTime,
      rateLimited: wave.rateLimited,
      gate: wave.gate,
      verdicts: tallyVerdicts(records),
      /* **The wave's own figure, whether or not any of it was published.** See
         `DeepenStats.usage`: `partial` zeroes `expanded` and `added` above, and
         must not zero this. */
      usage: wave.usage,
    },
  };
}

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
 * supplies, so the whole protocol runs end to end with no network.
 * docs/plans/260904d-deepen-fat-sections.md § stage 4.
 *
 * **Nothing calls this yet.** `generateHierarchy` does not know the cascade
 * exists; wiring it in, and deciding the wave's concurrency, is stage 5.
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
 * [`source-hash.ts`](source-hash.ts), hoisted out of `hierarchy.ts` on
 * 2026-09-05 for the same shape of reason: `hierarchy.ts` will import *this*
 * file at stage 5, and a key minter reachable only through it would close a
 * cycle `npm run cycles` refuses.
 */
import { log } from "./log.js";
import {
  ExpansionRefused,
  MAX_EXPANSION_REDRAWS,
  indexBlocks,
  normaliseExpansion,
  proposalFromTree,
  type BlockIndex,
  type CascadeRecipe,
  type ExpansionBatch,
  type ExpansionTarget,
} from "./hierarchy-cascade.js";
import {
  EXPANSION_PROMPT_STAMP,
  expansionRequest,
  parseExpansionAnswer,
  renderFrozenOutline,
  type ExpansionAnswerChild,
  type ExpansionRequest,
  type OutlineEntry,
} from "./hierarchy-expand.js";
/* Types only. `src/hierarchy.ts` is the module this one will be imported *by*
   at stage 5, so a value import here would be the wrong way round. */
import type { BuildReport, ModelNode } from "./hierarchy.js";
import { messagesWireBody, type MessagesBody } from "./messages-stream.js";
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

/** One parent's answer, read and derived. */
export interface ExpandedTarget {
  target: ExpansionTarget;
  /**
   * The children exactly as the model proposed them, **verdicts included**, in
   * its own order and before any drop.
   *
   * Carried beside `children` rather than merged into it because the two are
   * different lengths: `normaliseExpansion` drops a start that marks no split
   * point, and it does not say which. Pairing a kept child with the verdict of
   * the proposal it came from needs `KeptChild.childIndex`, which that function
   * discards — **stage 5's job, and named here so it is a known gap rather than
   * a silent one.** Nothing obeys a child's verdict before wave 3 (stage 6), so
   * nothing is wrong today.
   */
  proposed: readonly ExpansionAnswerChild[];
  /** What survived, with derived ranges. At least two, or the answer was refused. */
  children: ModelNode[];
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
    return { target, proposed: section.children, children };
  });
  return { targets: read, report };
}

/* ----------------------------------------------------------------- the wave */

/**
 * **The seam where the model would be.**
 *
 * Takes an assembled request and returns the answer's raw text. Everything about
 * retries, checkpoints, coverage and derivation is on this side of it, so the
 * whole protocol is exercisable with a function that returns a string — which is
 * stage 4's entire done-condition, and is why there is no `streamMessage` call
 * anywhere in this file.
 *
 * The real one, in stage 5, is `streamMessage("hierarchy", request.params)`
 * joined to text. It may throw: an executor's own failure (a 429, an abort) is
 * **not** an `ExpansionRefused` and is not redrawn here — the queue owns that,
 * and a wave that quietly re-bought a rate-limited call three times would be
 * spending money to make the rate limit worse.
 */
export type ExpansionExecutor = (request: ExpansionRequest) => Promise<string>;

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
}

/** What a whole wave came to, including how much of it was already paid for. */
export interface ExpansionWaveResult {
  calls: ExpansionCallOutcome[];
  /** Keys the wave looked up: one per call. */
  asked: number;
  /** Rows the store had. */
  found: number;
  /** Rows that were for this question **and still normalise** — the real hit count. */
  usable: number;
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
 * ## Sequential, for now
 *
 * The calls are made one after another. Concurrency is stage 5's — it wants a
 * budget derived from the worker's own job concurrency and 429s counted, and
 * neither can be decided against a fake executor. Nothing here assumes the
 * order: the keys are independent by construction, which is the property the
 * frozen seed buys.
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
}): Promise<ExpansionWaveResult> {
  const { slug, checkpoints, execute, batches, blocks, seed, recipe } = opts;
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
  try {
    stored = await checkpoints.read<unknown>(slug, DEEPEN_NAMESPACE, keys);
  } catch (err) {
    log("pipeline").warn(
      { slug, namespace: DEEPEN_NAMESPACE, asked: keys.length, err },
      "could not read the expansion checkpoints; every scoped call will be asked for again",
    );
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
    },
    "read the expansion checkpoints",
  );

  const calls: ExpansionCallOutcome[] = [];
  for (const p of prepared) {
    const already = resumed.get(p.key);
    if (already !== undefined) {
      calls.push({ ...p, reading: already, resumed: true, redraws: 0 });
      continue;
    }

    let redraws = 0;
    let answer = "";
    let reading: ExpansionReading;
    for (;;) {
      answer = await execute(p.request);
      try {
        reading = readExpansion({ raw: answer, targets: p.batch.targets, blocks, index });
        break;
      } catch (err) {
        /* Only an answer's own faults are redrawn. Anything else — an executor
           that threw, a range this article cannot resolve — is a bug or a
           transport failure, and re-asking would bury it. */
        if (!(err instanceof ExpansionRefused)) throw err;
        if (redraws >= MAX_EXPANSION_REDRAWS) {
          log("pipeline").warn(
            { slug, key: p.key, reason: err.reason, draws: redraws + 1 },
            "an expansion call was refused on every draw its budget allowed",
          );
          /* **Rethrown as itself**, so whatever handles a refusal upstream still
             sees the class and the reason rather than a wrapper it has to
             unwrap. The draw count is in the line above, which is where it
             belongs: it is telemetry about this wave, not a property of the
             model's answer. */
          throw err;
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
    try {
      const entry: ExpansionCheckpointEntry = { fingerprint: p.key, answer };
      await checkpoints.write(slug, DEEPEN_NAMESPACE, p.key, entry);
    } catch (err) {
      log("pipeline").warn(
        { slug, key: p.key, err },
        "could not save the expansion checkpoint; a later attempt will ask for this call again",
      );
    }
    calls.push({ ...p, reading, resumed: false, redraws });
  }

  return { calls, asked: keys.length, found: stored.size, usable: resumed.size };
}

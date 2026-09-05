/**
 * **The scoped expansion checkpoint, end to end against a fake executor** —
 * docs/plans/260904d-deepen-fat-sections.md § stage 4.
 *
 * Every fault this file is written against produces a perfectly good-looking
 * tree, and most of them produce it *cheaply*, which is worse: a checkpoint
 * layer that never hits and one that works are the same program from the
 * outside, distinguishable only by the bill. docs/reusable/silent-success.md.
 *
 * ## The three scenarios the plan asks for, and what each actually asserts
 *
 * 1. **A poisoned row** — four of them, because "poisoned" is four different
 *    shapes and only the last is interesting. A row that is not an entry, a row
 *    whose answer is truncated JSON, a row that parses but covers the wrong
 *    targets, and — the one the cheap gate cannot see — a row that parses,
 *    covers exactly, and names a start that no longer sits inside the parent it
 *    is stored against. Each must read as a **miss** and be **overwritten**, so
 *    both halves are asserted: the executor was called, and the row now holds
 *    the good answer. Without the second half the article is wedged for ever
 *    and only a deploy clears it.
 * 2. **A resumption against a different wave-1 answer** — and the fixture is
 *    built so the two wave-1 trees print the **identical** depth-1 outline.
 *    That is the whole reason `seedHash` is `structureHash` of the tree rather
 *    than a digest of `renderFrozenOutline`'s text: two different cuts of an
 *    article can print the same, and an answer replayed across them is a subtree
 *    derived over prose it was never about.
 * 3. **An exhausted attempt budget** — `MAX_EXPANSION_REDRAWS`, which is the
 *    cascade's own per-call cap and not `REQUEUE_BUDGET` from src/jobs.ts. The
 *    assertion that matters is not that it throws: it is that **nothing was
 *    written**, because a checkpoint on the refusal path replays a refusal for
 *    ever.
 *
 * ## And the trap, which has its own test because it would ship
 *
 * *"does not move when a sibling parent is expanded under it"*. Wave 2 expands
 * several parents at once; a key that depended on the tree as it stands would
 * move whenever a neighbour landed, and a resumed attempt would miss every row
 * the previous one wrote — under exactly the load the checkpoint exists for.
 *
 * No network: the executor is a function that returns a string.
 */
import { describe, expect, it } from "vitest";

import {
  CASCADE_RECIPE,
  MAX_EXPANSION_REDRAWS,
  UNMEASURED_OVERHEAD,
  decideExpansion,
  planExpansionBatches,
  type CascadeNode,
  type CascadeRecipe,
  type ExpansionBatch,
  type ExpansionTarget,
} from "../src/hierarchy-cascade.js";
import {
  EXPANSION_PROMPT_STAMP,
  expansionRequest,
  type ExpansionRequest,
  type OutlineEntry,
} from "../src/hierarchy-expand.js";
import {
  DEEPEN_NAMESPACE,
  canonicalExpansionRequest,
  expansionBodyHash,
  freeAnswer,
  frozenSeed,
  readExpansion,
  runExpansionWave,
  usableExpansion,
  type FrozenSeed,
} from "../src/hierarchy-deepen.js";
import { MESSAGES_PROVIDER, messagesWireBody } from "../src/messages-stream.js";
import { modelFor } from "../src/models.js";
import { checkpointKey, hashBlocks, structureHash } from "../src/source-hash.js";
import { CHECKPOINT_KEY_RE, type CheckpointStore } from "../src/store/checkpoints.js";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";

/* ------------------------------------------------------------- fixtures -- */

/** The id alphabet from src/ids.ts, so every fixture id passes `isSpideryarnId`. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";

function blockId(i: number): string {
  return `spya-d${ALPHABET[Math.floor(i / 32) % 32]}${ALPHABET[i % 32]}000`;
}

function para(i: number, text = `Paragraph ${String(i).padStart(4, "0")} argues a thing.`): Block {
  return {
    id: blockId(i),
    tag: "p",
    kind: "text",
    text,
    words: 6,
    html: `<p id="${blockId(i)}">${text}</p>`,
    gistable: true,
  };
}

/** Forty paragraphs: two parents of twenty, each big enough to divide. */
const BLOCKS: Block[] = Array.from({ length: 40 }, (_, i) => para(i));

const SLUG = "deepen-checkpoint";
const ARTICLE = { slug: SLUG, articleId: "article-deepen-checkpoint" };

function pending(from: number, to: number, title: string): CascadeNode {
  return {
    title,
    gist: `A claim about ${title.toLowerCase()}.`,
    range: [blockId(from), blockId(to)],
    status: "pending",
  };
}

/** The two parents wave 2 is asked about. Document order, as the planner demands. */
const FIRST = { from: 0, to: 19, where: "root > child 1" };
const SECOND = { from: 20, to: 39, where: "root > child 2" };

function target(part: typeof FIRST): ExpansionTarget {
  return { node: pending(part.from, part.to, part.where), where: part.where };
}

const TARGETS: ExpansionTarget[] = [target(FIRST), target(SECOND)];

/**
 * One recipe per test that needs the parents in separate calls.
 *
 * `maxParentsPerBatch: 1` is the only lever that reliably makes two calls out of
 * two small parents, and a wave of two calls is what the partial-resume and
 * per-call-key tests are about — a single call carrying both would make "one
 * call resumed and the other bought" unexpressible.
 */
const ONE_PER_CALL: CascadeRecipe = { ...CASCADE_RECIPE, maxParentsPerBatch: 1 };

function plan(targets: readonly ExpansionTarget[], recipe: CascadeRecipe): ExpansionBatch[] {
  const calls = planExpansionBatches(targets, BLOCKS, recipe, UNMEASURED_OVERHEAD);
  const batches = calls.filter((call): call is ExpansionBatch => call.kind === "batch");
  /* A fixture that quietly went oversized would make every count below wrong
     and nothing would say so. */
  expect(batches, "the fixture produced an oversized target").toHaveLength(calls.length);
  return batches;
}

/* --------------------------------------------------------- the wave-1 seed -- */

/**
 * A wave-1 tree whose **depth-1 outline is fixed** and whose depth-2 shape is
 * not — which is the pair `seedHash` exists to tell apart.
 *
 * `cut` moves where the first section's two children divide. `renderFrozenOutline`
 * shows depth 1 only, so both cuts print the identical prefix; `structureHash`
 * reads every node's range, so they hash differently. Two real cuts of one
 * article can differ exactly this way.
 */
function seedTree(cut: number): Tree {
  const nodes: Record<NodeId, TreeNode> = {};
  const leaf = (id: NodeId, parent: NodeId, from: number, to: number): void => {
    nodes[id] = { id, depth: 2, parent, children: [], range: [blockId(from), blockId(to)], title: "" };
  };
  leaf("n0003", "n0002", 0, cut);
  leaf("n0004", "n0002", cut + 1, 19);
  leaf("n0005", "n0006", 20, 29);
  leaf("n0007", "n0006", 30, 39);
  nodes.n0002 = {
    id: "n0002",
    depth: 1,
    parent: "n0001",
    children: ["n0003", "n0004"],
    range: [blockId(0), blockId(19)],
    title: "The First Half",
    gist: "It sets out the case at length.",
  };
  nodes.n0006 = {
    id: "n0006",
    depth: 1,
    parent: "n0001",
    children: ["n0005", "n0007"],
    range: [blockId(20), blockId(39)],
    title: "The Second Half",
    gist: "It answers the objections.",
  };
  nodes.n0001 = {
    id: "n0001",
    depth: 0,
    parent: null,
    children: ["n0002", "n0006"],
    range: [blockId(0), blockId(39)],
    title: "The Whole Work",
    gist: "It argues one thing at length.",
  };
  return { version: "test", generator: "test", slug: SLUG, rootId: "n0001", nodes };
}

const SEED: FrozenSeed = frozenSeed(seedTree(9));
/** The same article cut differently at depth 2. Same outline, different hash. */
const OTHER_SEED: FrozenSeed = frozenSeed(seedTree(12));

const ANCESTORS: readonly OutlineEntry[] = [
  { title: "The Whole Work", gist: "It argues one thing at length." },
];
const ancestorsOf = (): readonly OutlineEntry[] => ANCESTORS;

/* ------------------------------------------------------------- the answers -- */

/** A well-formed answer: every target divided in two, both children finished. */
function goodAnswer(batch: ExpansionBatch, halves = 2): string {
  return JSON.stringify({
    sections: batch.targets.map((t, i) => {
      const from = BLOCKS.findIndex((b) => b.id === t.node.range[0]);
      const to = BLOCKS.findIndex((b) => b.id === t.node.range[1]);
      const step = Math.floor((to - from + 1) / halves);
      return {
        section: i + 1,
        children: Array.from({ length: halves }, (_, k) => ({
          start: blockId(from + k * step),
          title: `Part ${k + 1} of ${t.where}`,
          gist: `Part ${k + 1} makes its own claim about the matter.`,
          verdict: k === 0 ? "finished" : "needs-deeper",
          why: "it is long",
        })),
      };
    }),
  });
}

/**
 * The executor the wave is run with: it is handed the batch it is answering,
 * because a fake that had to reverse-engineer the request would be testing the
 * renderer rather than the protocol.
 */
function executorFor(
  batches: readonly ExpansionBatch[],
  answer: (batch: ExpansionBatch) => string,
): { execute: (r: ExpansionRequest) => Promise<string>; calls: () => number } {
  let calls = 0;
  /* The request carries each target's ordinal and its blocks, and the batches
     are in a fixed order, so matching on the rendered `own` half is exact —
     and cheaper than threading an index through the seam the real executor
     will not have. */
  return {
    calls: () => calls,
    execute: async (request: ExpansionRequest) => {
      calls++;
      const batch = batches.find(
        (b) => request.own.includes(b.targets[0]!.node.range[0]) && request.own.includes(`OF ${b.targets.length}`),
      );
      if (batch === undefined) throw new Error("the fake executor could not tell which batch it was asked about");
      return answer(batch);
    },
  };
}

async function runWave(opts: {
  checkpoints: CheckpointStore;
  batches: readonly ExpansionBatch[];
  execute: (r: ExpansionRequest) => Promise<string>;
  recipe?: CascadeRecipe;
  seed?: FrozenSeed;
  blocks?: readonly Block[];
}) {
  return runExpansionWave({
    slug: SLUG,
    checkpoints: opts.checkpoints,
    /* The fakes here answer with a string, because none of these tests is about
       what a call cost; `freeAnswer` is the adapter and every one of them
       therefore reports `NO_EXPANSION_USAGE`. The tokens have a file of their
       own — tests/hierarchy-deepen-tokens.test.ts. */
    execute: async (request) => freeAnswer(await opts.execute(request)),
    batches: opts.batches,
    ancestorsOf,
    blocks: opts.blocks ?? BLOCKS,
    seed: opts.seed ?? SEED,
    recipe: opts.recipe ?? ONE_PER_CALL,
  });
}

/** The key one batch's answer is stored under, computed the way the wave does. */
function keyFor(batch: ExpansionBatch, over: { seed?: FrozenSeed; blocks?: readonly Block[]; recipe?: CascadeRecipe } = {}): string {
  return checkpointKey(canonicalFor(batch, over));
}

function canonicalFor(
  batch: ExpansionBatch,
  over: { seed?: FrozenSeed; blocks?: readonly Block[]; recipe?: CascadeRecipe } = {},
): Record<string, unknown> {
  const blocks = over.blocks ?? BLOCKS;
  const seed = over.seed ?? SEED;
  const recipe = over.recipe ?? ONE_PER_CALL;
  const request = expansionRequest({
    briefings: batch.targets.map((t) => ({ target: t, ancestors: ANCESTORS })),
    blocks,
    outline: seed.outline,
    recipe,
  });
  return canonicalExpansionRequest({
    params: request.params,
    bodyHash: expansionBodyHash(blocks),
    seed,
    recipe,
    targets: batch.targets,
  });
}

/* ============================================================= the key ==== */

describe("the expansion checkpoint's key", () => {
  const batches = plan(TARGETS, ONE_PER_CALL);
  const first = batches[0]!;

  it("is a digest of the request the call actually makes, and of four things it no longer carries", () => {
    const c = canonicalFor(first);
    const request = c.request as Record<string, unknown>;
    /* The four the structure key's review named, checked here too because a
       scoped call assembles its own params and could have dropped any of them. */
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.max_tokens).toBeGreaterThan(0);
    expect(request.provider).toEqual(MESSAGES_PROVIDER);
    expect(request.model).toBe(modelFor("hierarchy"));
    /* And the four the plan's table adds, which a whole-document call gets for
       free and a scoped one does not. */
    /* `expansionBodyHash`, not `hashBlocks`: the article's own fingerprint plus
       the four per-block fields this stage reads and that one is not made of. */
    expect(c.bodyHash).toBe(expansionBodyHash(BLOCKS));
    expect(c.bodyHash).not.toBe(hashBlocks(BLOCKS));
    expect(c.seedHash).toBe(structureHash(seedTree(9)));
    expect(c.recipe).toEqual({ ...ONE_PER_CALL });
    expect(c.targets).toEqual([
      { node: FIRST.where, ordinal: 1, range: [blockId(FIRST.from), blockId(FIRST.to)] },
    ]);
    expect(c.promptVersion).toBe(EXPANSION_PROMPT_STAMP);
  });

  it("takes the injected half from the sender, not from a copy of what it does", () => {
    /* The same second-round finding as the structure key: restating `provider`
       and `model` here would cover today's two fields and miss tomorrow's third
       in silence, because the enumeration below can only mutate fields the
       object already has. */
    const request = expansionRequest({
      briefings: first.targets.map((t) => ({ target: t, ancestors: ANCESTORS })),
      blocks: BLOCKS,
      outline: SEED.outline,
      recipe: ONE_PER_CALL,
    });
    expect(canonicalFor(first).request).toEqual(messagesWireBody("hierarchy", request.params));
  });

  it("moves when any field of it moves — enumerated, not listed", () => {
    const base = canonicalFor(first);
    const key = checkpointKey(base);
    const paths: [string, () => Record<string, unknown>][] = [];
    for (const field of Object.keys(base)) {
      paths.push([field, () => ({ ...base, [field]: "mutated" })]);
    }
    for (const field of Object.keys(base.request as Record<string, unknown>)) {
      paths.push([
        `request.${field}`,
        () => ({ ...base, request: { ...(base.request as Record<string, unknown>), [field]: "mutated" } }),
      ]);
    }
    /* Every recipe field, off the object rather than off a list, so the seventh
       one somebody adds is covered without anybody remembering this test. */
    for (const field of Object.keys(base.recipe as Record<string, unknown>)) {
      paths.push([
        `recipe.${field}`,
        () => ({ ...base, recipe: { ...(base.recipe as Record<string, unknown>), [field]: "mutated" } }),
      ]);
    }
    const target0 = (base.targets as Record<string, unknown>[])[0]!;
    for (const field of Object.keys(target0)) {
      paths.push([
        `targets[0].${field}`,
        () => ({ ...base, targets: [{ ...target0, [field]: "mutated" }] }),
      ]);
    }
    /* Proof the enumeration is looking at something: if the canonical object
       ever collapsed, the loop would still "pass" vacuously. */
    expect(paths.length).toBeGreaterThan(20);
    for (const [what, mutate] of paths) {
      expect(checkpointKey(mutate()), `${what} did not move the key`).not.toBe(key);
    }
  });

  it("moves when a block OUTSIDE the target's own range changes", () => {
    /* **The hole `bodyHash` closes, and the only one on this list a scoped call
       could not notice by itself.** The whole-document call has every block id
       and every word in its prose, so a re-extraction moves its key for free.
       This call is shown blocks 0–19; block 35 is not in its request at all, and
       without `bodyHash` an answer stored before the article changed would be
       replayed against an article that has. */
    const moved = BLOCKS.map((b, i) => (i === 35 ? para(35, "Rewritten entirely, elsewhere.") : b));
    expect(keyFor(first, { blocks: moved })).not.toBe(keyFor(first));
  });

  /**
   * **And it moves for every field this stage reads, not only the ones a
   * fingerprint of the prose covers.**
   *
   * `hashBlocks` canonicalises `[id, text, role, treatment]` — the four an
   * article's identity is made of. This stage reads four more: `words` (the
   * `forcedOpenWords` ceiling), `kind` (the authored-heading rule, and through
   * it `max_tokens`), `tag` (`renderBlocks` prints it, so the model sees it) and
   * `gistable` (`isStructural`, which is the unit the terminal-blocks floor and
   * `predictedChildren` count in, and the `NOT-GISTABLE` marker the model is
   * shown). A block reclassified `p` → `h2` with its text untouched kept its
   * key while the model was shown a heading and the governor's heading rule
   * fired.
   *
   * Asserted through the wave rather than through `canonicalFor`, so it is the
   * key production actually mints. And mutated on block 35, **outside** this
   * call's own slice, because that is where the hole is total: a change inside
   * the slice moves `tag` and `kind` through the request's own bytes and would
   * make the test pass for the wrong reason. ⟨GPT Sol's review of stage 4, F1.⟩
   */
  it("moves when a field the governor reads or the model is shown changes outside the slice", async () => {
    const batches = plan(TARGETS, ONE_PER_CALL);
    const keyOf = async (blocks: readonly Block[]): Promise<string> => {
      const wave = await runWave({
        checkpoints: memoryCheckpoints(ARTICLE),
        batches,
        execute: executorFor(batches, goodAnswer).execute,
        blocks,
      });
      return wave.calls[0]!.key;
    };
    const base = await keyOf(BLOCKS);
    const mutations: [string, (b: Block) => Block][] = [
      ["words", (b) => ({ ...b, words: b.words + 994 })],
      ["kind", (b) => ({ ...b, kind: "heading", level: 2 })],
      ["tag", (b) => ({ ...b, tag: "h2" })],
      ["gistable", (b) => ({ ...b, gistable: false })],
    ];
    for (const [field, mutate] of mutations) {
      const moved = BLOCKS.map((b, i) => (i === 35 ? mutate(b) : b));
      expect(await keyOf(moved), `${field} did not move the key`).not.toBe(base);
    }
  });

  /**
   * **The reviewer's own reproduction, kept because it says what is at stake.**
   *
   * The same twenty blocks with `words: 6` and with `words: 1000` render to the
   * identical request — `renderBlocks` never prints a word count — so the wire
   * bytes cannot tell them apart and only the body hash can. Meanwhile the
   * governor's answer about that parent moves from `stop` to `expand`, which is
   * to say a stored answer would be replayed for a node the cascade would no
   * longer even ask about the same way.
   */
  it("moves for a word count alone, which the request cannot see and the governor obeys", async () => {
    const node = target(FIRST).node;
    const fatter = BLOCKS.map((b) => ({ ...b, words: 1_000 }));
    expect(decideExpansion({ node, depth: 1, blocks: BLOCKS, recipe: ONE_PER_CALL, verdict: "finished" }))
      .toEqual({ decision: "stop", because: "verdict" });
    expect(decideExpansion({ node, depth: 1, blocks: fatter, recipe: ONE_PER_CALL, verdict: "finished" }))
      .toEqual({ decision: "expand", because: "forced-open" });

    const batches = plan(TARGETS, ONE_PER_CALL);
    const requestOver = (blocks: readonly Block[]): unknown =>
      expansionRequest({
        briefings: batches[0]!.targets.map((t) => ({ target: t, ancestors: ANCESTORS })),
        blocks,
        outline: SEED.outline,
        recipe: ONE_PER_CALL,
      }).params;
    expect(requestOver(fatter), "the fixture's two bodies do not render alike").toEqual(
      requestOver(BLOCKS),
    );

    const keyOf = async (blocks: readonly Block[]): Promise<string> => {
      const wave = await runWave({
        checkpoints: memoryCheckpoints(ARTICLE),
        batches,
        execute: executorFor(batches, goodAnswer).execute,
        blocks,
      });
      return wave.calls[0]!.key;
    };
    expect(await keyOf(fatter)).not.toBe(await keyOf(BLOCKS));
  });

  it("moves when the wave-1 tree moves, even though its outline prints the same", () => {
    /* `seedHash` is `structureHash` of the tree and not a digest of the outline,
       and this is the pair that shows why: the two cuts print identically. */
    expect(OTHER_SEED.outline).toBe(SEED.outline);
    expect(OTHER_SEED.hash).not.toBe(SEED.hash);
    expect(keyFor(first, { seed: OTHER_SEED })).not.toBe(keyFor(first));
  });

  it("is a digest of these six things and no seventh", () => {
    /**
     * **This is the test that would go red on the trap**, and the one above it
     * is the demonstration.
     *
     * The tempting seventh field is a hash of the tree as it stands. Wave 2
     * expands several parents at once, so if this key carried one, the second
     * parent's answer landing would move the first parent's key and a resumed
     * attempt would miss every row the previous attempt wrote — a checkpoint
     * layer that provably never hits under exactly the load it exists for, with
     * nothing to see but the bill. Adding a field here is a decision, and this
     * is where it has to be taken rather than slipped past.
     *
     * The list is also the key's **order**, which `checkpointKey` hashes: a
     * re-ordering changes every key ever minted. That costs one call per article
     * and is worth knowing rather than discovering.
     */
    expect(Object.keys(canonicalFor(first))).toEqual([
      "promptVersion",
      "request",
      "bodyHash",
      "seedHash",
      "recipe",
      "targets",
    ]);
  });

  it("does NOT move when a sibling parent is expanded under it", () => {
    /**
     * The trap, demonstrated. It is the weaker half of the pair — the key is
     * built from this call's own batch and has no way to reach the tree, so this
     * cannot go red while the signature holds. The test above is the one that
     * fires if a seventh field arrives; this one says, in a form a reader can
     * run, what that field would have broken.
     */
    const before = keyFor(first);
    const sibling = TARGETS[1]!;
    /* The neighbour lands: it stops being pending, gains two children, and its
       title is rewritten by the answer. */
    sibling.node = {
      title: "The Second Half, Divided",
      gist: "It answers the objections in two parts.",
      range: sibling.node.range,
      status: "expanded",
      children: [
        { title: "Objections", gist: "The first.", range: [blockId(20), blockId(29)], status: "terminal" },
        { title: "Replies", gist: "The second.", range: [blockId(30), blockId(39)], status: "terminal" },
      ],
    };
    expect(keyFor(first), "a neighbour's expansion moved this parent's key").toBe(before);
    /* Put it back, because the fixture is shared. */
    sibling.node = pending(SECOND.from, SECOND.to, SECOND.where);
  });

  it("does not depend on the order a recipe's fields happen to be written in", () => {
    /* A `CascadeRecipe` is built at several sites and `JSON.stringify` writes
       fields in insertion order, so an eval arm's literal could otherwise hash
       differently from `CASCADE_RECIPE` with every value identical — a permanent
       miss with nothing to see. `canonicalRecipe` sorts, and this is the check. */
    const shuffled = Object.fromEntries(
      Object.entries(ONE_PER_CALL).reverse(),
    ) as unknown as CascadeRecipe;
    expect(Object.keys(shuffled)).not.toEqual(Object.keys(ONE_PER_CALL));
    expect(keyFor(first, { recipe: shuffled })).toBe(keyFor(first));
  });

  it("gives the two calls of one wave two different keys", () => {
    expect(keyFor(batches[0]!)).not.toBe(keyFor(batches[1]!));
  });

  it("is a key the store will accept", () => {
    expect(keyFor(first)).toMatch(CHECKPOINT_KEY_RE);
  });
});

/* ========================================================== the protocol == */

describe("runExpansionWave", () => {
  it("makes each call once and reuses both answers on the next attempt", async () => {
    const checkpoints = memoryCheckpoints(ARTICLE);
    const batches = plan(TARGETS, ONE_PER_CALL);
    const one = executorFor(batches, goodAnswer);

    const first = await runWave({ checkpoints, batches, execute: one.execute });
    expect(one.calls()).toBe(2);
    expect(first.usable).toBe(0);
    expect(first.calls.every((c) => !c.resumed)).toBe(true);
    expect(checkpoints.calls.writes).toBe(2);
    /* One read for the whole wave, not one per call — that is what the store's
       plural signature is for. */
    expect(checkpoints.calls.reads).toBe(1);
    expect(checkpoints.calls.keysAsked).toBe(2);

    const two = executorFor(batches, goodAnswer);
    const second = await runWave({ checkpoints, batches, execute: two.execute });
    expect(two.calls(), "the second attempt bought the calls again").toBe(0);
    expect(second.usable).toBe(2);
    expect(second.calls.every((c) => c.resumed)).toBe(true);
    /* Same children, not merely no call: a resumed wave that quietly produced a
       different division would be worse than one that paid twice. */
    expect(second.calls.map((c) => c.reading.targets.map((t) => t.children))).toEqual(
      first.calls.map((c) => c.reading.targets.map((t) => t.children)),
    );
  });

  it("resumes the call that landed and buys only the one that did not", async () => {
    /* The window the whole feature exists for: a wave that dies half way. */
    const checkpoints = memoryCheckpoints(ARTICLE);
    const batches = plan(TARGETS, ONE_PER_CALL);
    let asked = 0;
    await expect(
      runWave({
        checkpoints,
        batches,
        execute: async () => {
          asked++;
          if (asked === 2) throw new Error("the wave ran out of window");
          return goodAnswer(batches[0]!);
        },
      }),
    ).rejects.toThrow(/ran out of window/);
    expect(checkpoints.entries.size, "the call the failed wave paid for was thrown away").toBe(1);

    const again = executorFor(batches, goodAnswer);
    const result = await runWave({ checkpoints, batches, execute: again.execute });
    expect(again.calls(), "the resumed wave bought the first call again").toBe(1);
    expect(result.calls.map((c) => c.resumed)).toEqual([true, false]);
  });

  /* ------------------------------------------------------------ poison -- */

  /**
   * Four rows that must each read as a miss.
   *
   * The first three the cheap gate or the schema can see. **The fourth is the
   * one this design is for**: it parses, it covers exactly one section, and its
   * only start sits outside the parent the row is stored against — an answer
   * about a stretch of the article this call was never shown. Nothing but
   * running `normaliseExpansion` against the *current* parent can tell.
   */
  const POISON: [string, (batch: ExpansionBatch) => unknown][] = [
    ["is not an entry at all", () => ({ answer: 42 })],
    ["holds a truncated answer", (b) => ({ fingerprint: keyFor(b), answer: '{"sections": [{"sec' })],
    [
      "parses but answers about a section nobody asked for",
      (b) => ({
        fingerprint: keyFor(b),
        answer: JSON.stringify({
          sections: [
            { section: 1, children: [] },
            { section: 2, children: [] },
          ],
        }),
      }),
    ],
    [
      "parses and covers exactly, and no longer normalises against its parent",
      (b) => ({
        fingerprint: keyFor(b),
        answer: JSON.stringify({
          sections: [
            {
              section: 1,
              children: [
                { start: blockId(0), title: "Head", gist: "The first stretch.", verdict: "finished" },
                /* Block 30 is in the *other* parent. A scoped call is shown its
                   own blocks and nothing else, so this is an answer about a
                   different stretch of the article. */
                { start: blockId(30), title: "Elsewhere", gist: "Not in this parent.", verdict: "finished" },
              ],
            },
          ],
        }),
      }),
    ],
  ];

  for (const [what, poison] of POISON) {
    it(`buys the call again when the stored row ${what}, and replaces it`, async () => {
      const checkpoints = memoryCheckpoints(ARTICLE);
      const batches = plan([TARGETS[0]!], ONE_PER_CALL);
      const batch = batches[0]!;
      const key = keyFor(batch);
      await checkpoints.write(SLUG, DEEPEN_NAMESPACE, key, poison(batch));

      const executor = executorFor(batches, goodAnswer);
      const result = await runWave({ checkpoints, batches, execute: executor.execute });

      expect(executor.calls(), "the stored answer was replayed rather than replaced").toBe(1);
      expect(result.found).toBe(1);
      expect(result.usable, "a poisoned row counted as a hit").toBe(0);
      expect(result.calls[0]!.resumed).toBe(false);
      /* **And the row is gone**, replaced by one that works. Without this the
         article is wedged for ever and the only lever is a deploy. */
      expect(JSON.parse(checkpoints.entries.get(`${DEEPEN_NAMESPACE}/${key}`)!)).toEqual({
        fingerprint: key,
        answer: goodAnswer(batch),
      });
    });
  }

  /* ------------------------------------------- a different wave-1 answer -- */

  it("reuses nothing when the wave-1 answer it descends from is not the same one", async () => {
    const checkpoints = memoryCheckpoints(ARTICLE);
    const batches = plan(TARGETS, ONE_PER_CALL);

    const first = executorFor(batches, goodAnswer);
    await runWave({ checkpoints, batches, execute: first.execute });
    expect(checkpoints.entries.size).toBe(2);

    /* The same article, the same parents, the same recipe — a wave-1 tree cut
       differently at depth 2, whose top level prints identically. */
    const second = executorFor(batches, goodAnswer);
    const result = await runWave({
      checkpoints,
      batches,
      execute: second.execute,
      seed: OTHER_SEED,
    });

    expect(second.calls(), "an answer written under one wave-1 tree was reused under another").toBe(2);
    expect(result.found, "the keys did not move, so the wrong rows were even looked at").toBe(0);
    expect(result.usable).toBe(0);
    /* Four rows now: two questions, two answers, neither overwriting the other. */
    expect(checkpoints.entries.size).toBe(4);
  });

  /* -------------------------------------------------- the redraw budget -- */

  it("redraws a refused answer, and keeps the one that stands up", async () => {
    const checkpoints = memoryCheckpoints(ARTICLE);
    const batches = plan([TARGETS[0]!], ONE_PER_CALL);
    let draw = 0;
    const result = await runWave({
      checkpoints,
      batches,
      execute: async () => {
        draw++;
        /* A missing verdict on the first draw — the fault this whole plan is
           named after, and one that is worth another draw. */
        return draw === 1
          ? JSON.stringify({
              sections: [
                {
                  section: 1,
                  children: [
                    { start: blockId(0), title: "One", gist: "The first." },
                    { start: blockId(10), title: "Two", gist: "The second." },
                  ],
                },
              ],
            })
          : goodAnswer(batches[0]!);
      },
    });
    expect(draw).toBe(2);
    expect(result.calls[0]!.redraws).toBe(1);
    expect(checkpoints.calls.writes, "the refused draw was written as well").toBe(1);
  });

  it("gives up after its budget and writes nothing at all", async () => {
    /**
     * **The assertion that matters is the write count, not the throw.**
     * `normaliseExpansion` deliberately keeps a refused answer's report off the
     * run's books; a checkpoint on the refusal path is that same double-count
     * made durable, and it would replay the refusal on every later attempt with
     * no call left to make that could come out differently.
     *
     * `MAX_EXPANSION_REDRAWS` is read rather than typed, so raising it does not
     * quietly leave this test asserting the old number.
     */
    const checkpoints = memoryCheckpoints(ARTICLE);
    const batches = plan([TARGETS[0]!], ONE_PER_CALL);
    let draw = 0;
    await expect(
      runWave({
        checkpoints,
        batches,
        execute: async () => {
          draw++;
          return "{ this was never JSON";
        },
      }),
    ).rejects.toThrow(/expansion/i);
    expect(draw).toBe(MAX_EXPANSION_REDRAWS + 1);
    expect(checkpoints.calls.writes, "a refused answer was checkpointed").toBe(0);
    expect(checkpoints.entries.size).toBe(0);
  });

  /**
   * **The refusal's own class and reason still reach the caller**, now under
   * `cause`.
   *
   * The wave wraps what killed it in an `ExpansionWaveFailed` since 2026-09-05,
   * because everything the wave's *paid peers* had already bought used to leave
   * with the throw — their rows, their verdicts, the tokens and the gate — and
   * stage 5b is a run whose failure has to be readable. ⟨GPT Sol's second review
   * of stage 5a, finding 5.⟩ What must not be lost in that is the reason: a
   * `malformed-answer` and an account with no credit are different facts and one
   * of them is a bug in this repo.
   */
  it("carries the refusal's own class and reason out under the failure", async () => {
    const checkpoints = memoryCheckpoints(ARTICLE);
    const batches = plan([TARGETS[0]!], ONE_PER_CALL);
    await expect(
      runWave({ checkpoints, batches, execute: async () => "{ never JSON" }),
    ).rejects.toMatchObject({
      name: "ExpansionWaveFailed",
      cause: { name: "ExpansionRefused", reason: "malformed-answer" },
    });
  });

  it("does not redraw an executor that threw", async () => {
    /* A 429 or an abort is not an answer's fault, and re-asking three times
       would spend money making a rate limit worse. */
    const checkpoints = memoryCheckpoints(ARTICLE);
    const batches = plan([TARGETS[0]!], ONE_PER_CALL);
    let draw = 0;
    await expect(
      runWave({
        checkpoints,
        batches,
        execute: async () => {
          draw++;
          throw new Error("429 from upstream");
        },
      }),
    ).rejects.toThrow(/429/);
    expect(draw).toBe(1);
  });

  /* ----------------------------------------------- the store's own faults -- */

  it("treats a read that throws as a miss rather than as a failure", async () => {
    const batches = plan([TARGETS[0]!], ONE_PER_CALL);
    const inner = memoryCheckpoints(ARTICLE);
    const broken: CheckpointStore = {
      read: async () => {
        throw new Error("the checkpoints table is unreachable");
      },
      write: inner.write.bind(inner),
    };
    const executor = executorFor(batches, goodAnswer);
    const result = await runWave({ checkpoints: broken, batches, execute: executor.execute });
    expect(executor.calls()).toBe(1);
    expect(result.found).toBe(0);
    expect(inner.calls.writes).toBe(1);
  });

  it("treats a write that throws as one call on the next attempt, not as a failure", async () => {
    const batches = plan([TARGETS[0]!], ONE_PER_CALL);
    const broken: CheckpointStore = {
      read: async () => new Map(),
      write: async () => {
        throw new Error("the checkpoints table is unreachable");
      },
    };
    const executor = executorFor(batches, goodAnswer);
    const result = await runWave({ checkpoints: broken, batches, execute: executor.execute });
    expect(result.calls[0]!.reading.targets[0]!.children.length).toBe(2);
  });
});

/* ================================================== the pieces on their own = */

describe("usableExpansion", () => {
  it("refuses anything that is not this question's entry", () => {
    expect(usableExpansion(undefined, "abc")).toBeNull();
    expect(usableExpansion(null, "abc")).toBeNull();
    expect(usableExpansion("a string", "abc")).toBeNull();
    expect(usableExpansion({ answer: "{}" }, "abc")).toBeNull();
    expect(usableExpansion({ fingerprint: "xyz", answer: "{}" }, "abc")).toBeNull();
    expect(usableExpansion({ fingerprint: "abc", answer: "" }, "abc")).toBeNull();
    expect(usableExpansion({ fingerprint: "abc", answer: "{}" }, "abc")).toBe("{}");
  });
});

describe("readExpansion", () => {
  it("derives every target's children against the parent as it is now", () => {
    const batches = plan(TARGETS, CASCADE_RECIPE);
    /* One call carrying both parents, which is what the default recipe packs —
       so this also exercises exact-target coverage over more than one section. */
    expect(batches).toHaveLength(1);
    const reading = readExpansion({
      raw: goodAnswer(batches[0]!),
      targets: batches[0]!.targets,
      blocks: BLOCKS,
    });
    expect(reading.targets).toHaveLength(2);
    for (const [i, read] of reading.targets.entries()) {
      expect(read.children).toHaveLength(2);
      /* The first child is pinned to its parent's start and the last ends at
         its parent's end: the children tile the parent by construction. */
      expect(read.children[0]!.node.range[0]).toBe(TARGETS[i]!.node.range[0]);
      expect(read.children[1]!.node.range[1]).toBe(TARGETS[i]!.node.range[1]);
      /* **The verdict arrives on the child it was said about**, which it did
         not until 2026-09-05: the answer's children and the kept ones were two
         arrays of different lengths, and stage 6's recursion is governed by
         exactly this pairing. `ExpandedTarget.children`. */
      expect(read.children.map((c) => c.proposed.verdict)).toEqual([
        "finished",
        "needs-deeper",
      ]);
    }
  });

  /**
   * **The case the pairing exists for**: a proposal that loses a child on the
   * way through.
   *
   * Four starts, the third of which marks no split point and is dropped, and the
   * verdicts alternate — so a wave reading verdicts off the *answer* by position
   * would give child 3's verdict to child 4 and be wrong about which section of
   * the article wants another level. Two arrays cannot express the right answer
   * here; one array of pairs cannot express the wrong one.
   */
  it("keeps each surviving child's own verdict when one of them is dropped", () => {
    const batches = plan([target(FIRST)], ONE_PER_CALL);
    const verdicts = ["needs-deeper", "finished", "needs-deeper", "finished"] as const;
    const raw = JSON.stringify({
      sections: [
        {
          section: 1,
          children: [0, 5, 5, 15].map((at, k) => ({
            start: blockId(at),
            title: `Part ${k + 1}`,
            gist: `Part ${k + 1} makes its own claim.`,
            verdict: verdicts[k],
          })),
        },
      ],
    });
    const reading = readExpansion({ raw, targets: batches[0]!.targets, blocks: BLOCKS });
    expect(reading.report.droppedChildren).toEqual(["root > child 1 > child 3"]);
    const read = reading.targets[0]!;
    expect(read.children.map((c) => c.node.title)).toEqual(["Part 1", "Part 2", "Part 4"]);
    expect(read.children.map((c) => c.proposed.verdict)).toEqual([
      "needs-deeper",
      "finished",
      "finished",
    ]);
  });

  it("refuses an answer that covers three targets when two were asked about", () => {
    const batches = plan(TARGETS, CASCADE_RECIPE);
    const raw = JSON.parse(goodAnswer(batches[0]!)) as { sections: unknown[] };
    raw.sections.push({ section: 3, children: [] });
    expect(() =>
      readExpansion({ raw: JSON.stringify(raw), targets: batches[0]!.targets, blocks: BLOCKS }),
    ).toThrow(/section 3/);
  });
});

/**
 * **The deepening wave, end to end against a fake executor** —
 * docs/plans/260904d-deepen-fat-sections.md § stage 5.
 *
 * Stage 4 proved the protocol: the prompt, the strict read, the checkpoint and
 * what a poisoned row does. This file is about the four things stage 5 added,
 * and every one of them fails in a way that leaves a **perfectly good article**
 * behind it — which is why each needs an assertion rather than a symptom:
 *
 * 1. **The frontier is chosen mechanically.** Nobody has been asked about a
 *    wave-1 node, so what selects a section is an authored heading nothing
 *    starts on, or a word count over the ceiling — and a fat section with
 *    neither is deliberately left alone. Getting that wrong costs money on every
 *    article in the corpus and produces a tree nobody would look at twice.
 * 2. **The wave is concurrent and the result is not.** Two runs over one article
 *    must make the same calls, store them under the same keys and build the same
 *    tree, whatever order the network answers in.
 * 3. **It stops on time, cleanly.** A wave that cannot finish must decline to
 *    *start* another call and hand back what it has, with the rows written — not
 *    be killed in the middle of one that has already been paid for.
 * 4. **It is off, and a failure is not the reader's problem.** The flag defaults
 *    off; with it on, a wave that throws leaves the wave-1 tree and says so on
 *    the run.
 *
 * No network anywhere: the executor is a function that returns a string, and the
 * two calls `generateHierarchy` would otherwise make — the structure call and
 * the label pass — are mocked at the module boundary, exactly as
 * `tests/hierarchy-write-guard.test.ts` does and for the same reason.
 */
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CASCADE_RECIPE,
  type CascadeRecipe,
} from "../src/hierarchy-cascade.js";
import { WidthGate } from "../src/concurrency.js";
import type { ExpansionRequest } from "../src/hierarchy-expand.js";
import {
  CALL_RESERVE_MS,
  DEEPEN_RECORDS_ENV,
  ExpansionRateLimited,
  NO_EXPANSION_USAGE,
  REASK_ENV,
  deepenTree,
  freeAnswer,
  reaskExpansions,
  runExpansionWave,
  type ExpansionAnswer,
} from "../src/hierarchy-deepen.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import type { Block, Tree } from "../src/types.js";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";

/* ------------------------------------------------------------- the article -- */

/** The id alphabet from src/ids.ts, so every fixture id passes `isSpideryarnId`. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";

function blockId(i: number): string {
  return `spya-w${ALPHABET[Math.floor(i / 32) % 32]}${ALPHABET[i % 32]}000`;
}

function para(i: number, words = 12): Block {
  const text = `Paragraph ${String(i).padStart(4, "0")} says something about the matter at hand.`;
  return {
    id: blockId(i),
    tag: "p",
    kind: "text",
    text,
    words,
    html: `<p id="${blockId(i)}">${text}</p>`,
    gistable: true,
  };
}

function heading(i: number): Block {
  return { ...para(i), tag: "h2", kind: "heading", level: 2, text: `Heading ${i}` };
}

/**
 * Sixty blocks in three sections, one per reason the governor can give:
 *
 * - **0–19** carries authored headings at 5 and 12 that no boundary starts on,
 *   so `hasUnresolvedHeading` forces it open — bound 2.
 * - **20–39** is twenty ordinary paragraphs: over the divisibility floor, no
 *   heading, and 240 words, which is well under `forcedOpenWords`. The governor
 *   stops at `no-verdict` and **this section must not be asked about.**
 * - **40–59** is twenty paragraphs of 200 words each — 4,000, over the ceiling —
 *   so the unassessed-ceiling bound forces it open.
 *
 * The middle one is the control. Without it, "the wave asked about the sections
 * it should" is satisfied by a wave that asks about everything.
 */
const BLOCKS: Block[] = Array.from({ length: 60 }, (_, i) => {
  if (i === 5 || i === 12) return heading(i);
  return para(i, i >= 40 ? 200 : 12);
});

const SLUG = "deepen-wave";

const WAVE_1 = {
  title: "The Whole Work",
  gist: "It argues one thing at length, in three parts.",
  range: [blockId(0), blockId(59)] as [string, string],
  children: [
    {
      title: "The Headed Part",
      gist: "It sets out the case under headings of its own.",
      range: [blockId(0), blockId(19)] as [string, string],
    },
    {
      title: "The Plain Part",
      gist: "It answers the objection at moderate length.",
      range: [blockId(20), blockId(39)] as [string, string],
    },
    {
      title: "The Long Part",
      gist: "It goes on at very great length indeed.",
      range: [blockId(40), blockId(59)] as [string, string],
    },
  ],
};

/* --------------------------------------------------------------- the fakes -- */

/**
 * An answer that divides every section it is given in two, at its own midpoint.
 *
 * It reads the request's rendered blocks rather than being told what it is
 * answering, because that is the only handle the real executor will have either.
 */
function answerFor(
  request: ExpansionRequest,
  verdicts = ["finished", "needs-deeper"],
): ExpansionAnswer {
  const sections = request.own.split(/^SECTION /m).filter((s) => s.trim().length > 0);
  /* **`freeAnswer`, so every fake in this file reports `NO_EXPANSION_USAGE`.**
     None of these tests is about what a call cost; the tokens have a file of
     their own, tests/hierarchy-deepen-tokens.test.ts. */
  return freeAnswer(JSON.stringify({
    sections: sections.map((section, i) => {
      const ids = [...section.matchAll(/(spya-w[a-z0-9]{5})/g)].map((m) => m[1]!);
      const first = BLOCKS.findIndex((b) => b.id === ids[0]);
      const last = BLOCKS.findIndex((b) => b.id === ids.at(-1));
      const middle = first + Math.floor((last - first + 1) / 2);
      return {
        section: i + 1,
        children: [first, middle].map((at, k) => ({
          start: blockId(at),
          title: `Part ${k + 1} of section ${i + 1}`,
          gist: `Part ${k + 1} makes a claim of its own about the matter.`,
          verdict: verdicts[k % verdicts.length],
        })),
      };
    }),
  }));
}

/** The executor, plus a record of every request it was handed, in arrival order. */
function fakeExecutor(over?: (request: ExpansionRequest, n: number) => Promise<ExpansionAnswer>) {
  const seen: ExpansionRequest[] = [];
  return {
    seen,
    execute: async (request: ExpansionRequest): Promise<ExpansionAnswer> => {
      seen.push(request);
      return over ? over(request, seen.length) : answerFor(request);
    },
  };
}

/* -------------------------------------------------------- the wave-1 tree -- */

let buildTree!: typeof import("../src/hierarchy.js")["buildTree"];

async function waveOne(): Promise<Tree> {
  ({ buildTree } = await import("../src/hierarchy.js"));
  return buildTree(WAVE_1, {}, BLOCKS, SLUG, {
    repairs: [],
    droppedChildren: [],
    droppedHeadings: [],
    collapsedRungs: [],
    droppedQuestions: [],
  });
}

/** How deep the deepest node of a tree is, which is what a deepening moves. */
function depthOf(tree: Tree): number {
  return Math.max(...Object.values(tree.nodes).map((n) => n.depth));
}

async function rebuild(root: import("../src/hierarchy.js").ModelNode): Promise<Tree> {
  return buildTree(root, {}, BLOCKS, SLUG, {
    repairs: [],
    droppedChildren: [],
    droppedHeadings: [],
    collapsedRungs: [],
    droppedQuestions: [],
  });
}

const ONE_PER_CALL: CascadeRecipe = { ...CASCADE_RECIPE, maxParentsPerBatch: 1 };

/* ============================================================ the frontier == */

describe("which sections a wave asks about", () => {
  it("takes the headed one and the long one, and leaves the plain one alone", async () => {
    const tree = await waveOne();
    const fake = fakeExecutor();
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fake.execute,
    });

    expect(out.stats.targets).toBe(2);
    expect(out.stats.expanded).toBe(2);
    expect(out.stats.added).toBe(4);
    /* The control: the twenty ordinary paragraphs are above the divisibility
       floor and were still not bought, because no mechanical bound says they are
       unfinished and nobody has been asked. */
    const asked = fake.seen.flatMap((r) => r.own.split("\n")).join("\n");
    expect(asked).toContain(blockId(0));
    expect(asked).toContain(blockId(40));
    expect(asked).not.toContain(blockId(25));

    /* And the frontier is what the governor said, not a size rule: the headed
       section is opened by its headings and the long one by its word count. */
    const wave1 = out.records.filter((r) => r.wave === 1);
    expect(wave1.map((r) => r.effective.because)).toEqual([
      "authored-heading",
      "no-verdict",
      "unassessed-ceiling",
    ]);
  });

  it("adds a level to the tree, over the same blocks, and nothing else", async () => {
    const tree = await waveOne();
    const fake = fakeExecutor();
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fake.execute,
    });
    expect(out.root).not.toBeNull();
    const deeper = await rebuild(out.root!);

    /* One more rung on the branches that were expanded, and the leaves move down
       with them. Wave 1 is root → section → leaf; this is root → section →
       sub-section → leaf. */
    expect(depthOf(tree)).toBe(2);
    expect(depthOf(deeper)).toBe(3);
    /* Every block still has exactly one leaf, and the root still covers the
       article: `buildTree` and `assertTreeSound` are what say so, and the second
       build is the one that runs them over the finished proposal. */
    const leaves = Object.values(deeper.nodes).filter((n) => n.children.length === 0);
    expect(leaves).toHaveLength(BLOCKS.length);
    expect(deeper.nodes[deeper.rootId]!.range).toEqual([blockId(0), blockId(59)]);
  });

  it("records every child's verdict and obeys none of them", async () => {
    const tree = await waveOne();
    const fake = fakeExecutor((request) => Promise.resolve(answerFor(request, ["needs-deeper", "needs-deeper"])));
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fake.execute,
    });

    /* Four children, every one of them asking for another level, and **stage 5
       makes no third call.** Obeying the verdict is the recursion, it is stage 6,
       and it is conditional on numbers like this one being stable. */
    expect(out.stats.verdicts.rawYes).toBe(4);
    expect(out.stats.verdicts.unassessed).toBe(3);
    expect(fake.seen).toHaveLength(1);
    expect(out.records.filter((r) => r.wave === 2)).toHaveLength(4);
    expect(out.records.filter((r) => r.wave > 2)).toHaveLength(0);
  });

  /**
   * **A redraw and a fan-out are facts about the node that was expanded**, and
   * they were recorded on its children — nodes nothing was ever drawn for.
   *
   * The record for a wave-1 target is made *before* its call, so until
   * 2026-09-05 it kept `retries: 0` and `fanOut: null` for ever while the four
   * children it produced each inherited the parent call's redraw count. Every
   * per-node rate computed off that is wrong in both directions, which is worse
   * than having no instrumentation at all. ⟨GPT Sol's review of stage 5a,
   * finding 4.⟩
   *
   * One call is refused once here and the other is not, so a count that leaked
   * across the wave would show up too.
   */
  it("records a redraw and a fan-out on the section that was expanded, not on its children", async () => {
    const tree = await waveOne();
    let refused = false;
    const fake = fakeExecutor((request) => {
      /* The headed section only, and only on its first draw. */
      if (!refused && request.own.includes(blockId(0))) {
        refused = true;
        return Promise.resolve(freeAnswer("this is not an answer"));
      }
      return Promise.resolve(answerFor(request));
    });
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fake.execute,
      recipe: ONE_PER_CALL,
    });

    expect(fake.seen).toHaveLength(3);
    const wave1 = new Map(out.records.filter((r) => r.wave === 1).map((r) => [r.where, r]));
    expect(wave1.get("root > child 1")).toMatchObject({ retries: 1, fanOut: 2 });
    /* The section that answered first time, so the redraw did not leak sideways. */
    expect(wave1.get("root > child 3")).toMatchObject({ retries: 0, fanOut: 2 });
    /* Never asked about, so nothing to count either way. */
    expect(wave1.get("root > child 2")).toMatchObject({ retries: 0, fanOut: null });
    /* And the children carry neither: a wave-2 node was never expanded. */
    for (const child of out.records.filter((r) => r.wave === 2)) {
      expect(child).toMatchObject({ retries: 0, fanOut: null });
    }
  });

  it("does nothing at all, and buys nothing, when no section is eligible", async () => {
    /* Twenty short paragraphs under one node: over the floor, no heading, well
       under the ceiling. The ordinary article, and it must cost zero calls. */
    const plain = Array.from({ length: 20 }, (_, i) => para(i));
    const tree = await (async () => {
      ({ buildTree } = await import("../src/hierarchy.js"));
      return buildTree(
        {
          title: "A Short Piece",
          gist: "It makes one point.",
          range: [blockId(0), blockId(19)],
          children: [
            { title: "The First Half", gist: "It opens.", range: [blockId(0), blockId(9)] },
            { title: "The Second Half", gist: "It closes.", range: [blockId(10), blockId(19)] },
          ],
        },
        {},
        plain,
        SLUG,
        { repairs: [], droppedChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] },
      );
    })();
    const fake = fakeExecutor();
    const out = await deepenTree({
      tree,
      blocks: plain,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fake.execute,
    });
    expect(fake.seen).toHaveLength(0);
    expect(out.root).toBeNull();
    expect(out.stats.targets).toBe(0);
  });

  /**
   * **A section too large to ask about keeps the shape wave 1 gave it.**
   *
   * Forced by a recipe whose hard request bound no single target can satisfy,
   * which is what an enormous section would do to the real one. The assertion
   * that matters is the pair: nothing was bought, and the article is still the
   * article — because the two wrong answers here are failing the reader's piece
   * over one big section, and cutting a sibling set across two calls that cannot
   * see each other's boundaries.
   */
  it("skips a section whose own request would not fit, and keeps the article", async () => {
    const tree = await waveOne();
    const fake = fakeExecutor();
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fake.execute,
      recipe: { ...CASCADE_RECIPE, maxRequestTokensPerBatch: 1 },
    });
    expect(fake.seen).toHaveLength(0);
    expect(out.stats.oversized).toBe(2);
    expect(out.stats.expanded).toBe(0);
    expect(out.root).toBeNull();
  });
});

/* ========================================================= the concurrency == */

/**
 * **The width's derivation, as arithmetic rather than as prose.**
 *
 * `EXPANSION_CONCURRENCY`'s docblock derives 8 from four numbers that live in
 * other files, and the failure mode of a derivation written only in a comment is
 * that one of those numbers moves and the comment does not. Both bounds are here,
 * so that raising the width past what a step's budget allows, or moving
 * `STEP_BUDGET_MS.hierarchy` or `DEFAULT_JOB_CONCURRENCY` underneath it, is a
 * red test rather than a stale paragraph.
 *
 * The measured inputs, all from the plan's stages 1 and 2 (2026-09-04): wave 1
 * on a book is 102–126 s; the label pass on the largest article we have is
 * 150–270 s (`STEP_BUDGET_MS.hierarchy`'s own note); a scoped call is 16–22 s,
 * doubled to 45 s for a batch of four parents; and Moby-Dick's 54 sections at
 * four parents a call is 14 calls, taken as 20 for the worst case.
 */
describe("how wide a wave may be", () => {
  it("finishes a book's worst-case wave inside what the step has left", async () => {
    const { EXPANSION_CONCURRENCY } = await import("../src/hierarchy-deepen.js");
    const { STEP_BUDGET_MS, DEFAULT_JOB_CONCURRENCY } = await import("../src/jobs.js");

    const CALLS = 20;
    const PER_CALL_MS = 45_000;
    const WAVE_1_MS = 126_000;
    const LABELS_MS = 270_000;
    const share = STEP_BUDGET_MS.hierarchy - WAVE_1_MS - LABELS_MS;
    expect(Math.ceil(CALLS / EXPANSION_CONCURRENCY) * PER_CALL_MS).toBeLessThanOrEqual(share);

    /* And a round of redraws still fits, which is the reason it is 8 and not the
       4 the inequality above would also accept. */
    expect(
      (Math.ceil(CALLS / EXPANSION_CONCURRENCY) + 1) * PER_CALL_MS,
    ).toBeLessThanOrEqual(share);

    /* The other side: what the account sees is every concurrent job's wave at
       once, and this is the number the gate then governs rather than the number
       the gate is for. */
    expect(DEFAULT_JOB_CONCURRENCY * EXPANSION_CONCURRENCY).toBeLessThanOrEqual(24);
  });
});

describe("a concurrent wave", () => {
  /**
   * **The order of the result is the planner's, not the network's.**
   *
   * The executor answers the *second* call first, by a margin no scheduler can
   * close. If anything downstream took arrival order for document order — the
   * outcomes array, the attachment, the batch keys — the two sections would swap
   * their children and the tree would still tile, still cover every block and
   * still pass every invariant, with each section's prose under its neighbour's
   * title. There is no assertion downstream that could catch that; this is it.
   */
  /**
   * **The wave reports its calls in the planner's order**, which is the half of
   * determinism that is not structural.
   *
   * Attaching an answer is safe whatever order it lands in — it goes to the target
   * it names, by identity — so the tree below would come out right even from an
   * outcome list in arrival order. What would *not* come out right is everything
   * that reads `calls` as a sequence: the wave's own numbers, the records, and
   * whatever stage 6 builds on them. So this asserts the sequence, and the case
   * after it asserts the tree.
   */
  it("returns its calls in the order they were planned, not the order they landed", async () => {
    const tree = await waveOne();
    const { deepenSeed, batches } = await plan(tree, ONE_PER_CALL);
    const wave = await runExpansionWave({
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      batches,
      ancestorsOf: () => [],
      blocks: BLOCKS,
      seed: deepenSeed,
      recipe: ONE_PER_CALL,
      execute: async (request) => {
        /* The first request out is answered last, by a margin no scheduler closes. */
        const first = request.own.includes(blockId(0));
        await new Promise((resolve) => setTimeout(resolve, first ? 40 : 0));
        return answerFor(request);
      },
    });
    expect(wave.calls.map((c) => c.batch)).toEqual(batches);
  });

  it("builds the same tree whichever call comes back first", async () => {
    const tree = await waveOne();
    const order: string[] = [];
    const fake = fakeExecutor(async (request, n) => {
      /* The first request to go out is answered last. */
      await new Promise((resolve) => setTimeout(resolve, n === 1 ? 40 : 0));
      order.push(request.own.slice(0, 24));
      return answerFor(request);
    });
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fake.execute,
      recipe: ONE_PER_CALL,
    });
    expect(fake.seen).toHaveLength(2);
    /* It really did finish out of order — without this the test passes on a
       wave that happened to be sequential, which is the wave it is about. */
    expect(order[0]).toBe(fake.seen[1]!.own.slice(0, 24));

    const deeper = await rebuild(out.root!);
    const sequential = await deepenTree({
      tree: await waveOne(),
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fakeExecutor().execute,
      recipe: ONE_PER_CALL,
    });
    expect(JSON.stringify(deeper.nodes)).toBe(
      JSON.stringify((await rebuild(sequential.root!)).nodes),
    );
  });

  /**
   * **A 429 is asked again; anything else is the wave's end.**
   *
   * The gate is this test's own rather than the module's singleton, so that the
   * narrowing it asserts belongs to this wave and cannot leak into another test —
   * and so that `narrowest` is a number about one refusal.
   */
  it("asks again after a 429, and narrows the gate while it does", async () => {
    const tree = await waveOne();
    const { deepenSeed, batches } = await plan(tree, ONE_PER_CALL);
    const gate = new WidthGate(4);
    let refusals = 0;
    const wave = await runExpansionWave({
      slug: SLUG,
      checkpoints: memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-wave" }),
      execute: async (request) => {
        if (refusals === 0) {
          refusals++;
          throw new ExpansionRateLimited(20);
        }
        return answerFor(request);
      },
      batches,
      ancestorsOf: () => [],
      blocks: BLOCKS,
      seed: deepenSeed,
      recipe: ONE_PER_CALL,
      gate,
    });
    expect(wave.rateLimited).toBe(1);
    expect(wave.calls).toHaveLength(2);
    /* Halved on the one refusal, and only on the first of its epoch. */
    expect(wave.gate.narrowestWidth).toBe(2);
    expect(wave.gate.refusals).toBe(1);
  });

  it("gives up on a wave whose executor fails for any other reason", async () => {
    const tree = await waveOne();
    await expect(
      deepenTree({
        tree,
        blocks: BLOCKS,
        slug: SLUG,
        checkpoints: nullCheckpointStore(),
        execute: () => Promise.reject(new Error("the account has no credit")),
        recipe: ONE_PER_CALL,
      }),
    ).rejects.toThrow(/no credit/);
  });

  /**
   * **The wave does not return while a call it paid for is still in the air.**
   *
   * One call fails fatally and its peer is already on the wire. The internal
   * abort clears the queue and deliberately does **not** cancel a live call —
   * a cancelled call is money spent for nothing — so until 2026-09-05 the wave
   * rejected while that peer was still running, and its checkpoint write landed
   * after `runExpansionWave` and `generateHierarchy` had both returned. A warm
   * label pass or a freeze could end the attempt in between, and the answer that
   * was paid for was thrown away. ⟨GPT Sol's review of stage 5a, finding 3.⟩
   *
   * So the assertion is about *when*, not about *whether*: the row exists at the
   * instant the rejection is caught. The bound on a genuinely stuck call is
   * still the caller's job signal, which reaches the call itself.
   */
  it("waits for the calls already in the air before it reports the failure", async () => {
    const tree = await waveOne();
    const { deepenSeed, batches } = await plan(tree, ONE_PER_CALL);
    const memory = memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-wave" });
    let slowStarted = false;
    await expect(
      runExpansionWave({
        slug: SLUG,
        checkpoints: memory,
        batches,
        ancestorsOf: () => [],
        blocks: BLOCKS,
        seed: deepenSeed,
        recipe: ONE_PER_CALL,
        gate: new WidthGate(2),
        execute: async (request) => {
          /* The first call out is the slow one; the second fails at once. */
          if (!slowStarted) {
            slowStarted = true;
            await new Promise((r) => setTimeout(r, 80));
            return answerFor(request);
          }
          throw new Error("the account has no credit");
        },
      }),
    ).rejects.toThrow(/no credit/);
    expect(slowStarted).toBe(true);
    expect(memory.entries.size, "the peer's answer was still in the air").toBe(1);
  });

  /**
   * **And it does not wait for ever.**
   *
   * The drain's docblock claimed it was finite because every caller either
   * aborts in flight or is bounded by a claimant's deadline signal. Neither
   * holds here: the wave is reachable from the CLI and from an exported
   * `deepenTree` with **no signal at all**, and `ExpansionExecutor` is a seam
   * with no abort contract even when there is one. One wedged call parked the
   * wave permanently. ⟨GPT Sol's second review of stage 5a, finding 3.⟩
   *
   * The fix bounds the drain rather than cancelling the live calls — cancelling
   * them would undo the change the test above exists for. Past the bound the
   * failure is rethrown with the straggler still running.
   *
   * `drainMs` is tiny here for the same reason the gate is injected: waiting
   * `EXPANSION_DRAIN_MS` for a wedged call is not a test. The number itself is
   * asserted below, as arithmetic.
   */
  it("gives up on a straggler that never settles, rather than waiting for ever", async () => {
    const tree = await waveOne();
    const { deepenSeed, batches } = await plan(tree, ONE_PER_CALL);
    let wedged = false;
    const started = Date.now();
    await expect(
      runExpansionWave({
        slug: SLUG,
        checkpoints: nullCheckpointStore(),
        batches,
        ancestorsOf: () => [],
        blocks: BLOCKS,
        seed: deepenSeed,
        recipe: ONE_PER_CALL,
        gate: new WidthGate(2),
        drainMs: 30,
        /* No `signal`, which is exactly what the CLI and the exported API
           permit and what the old docblock assumed away. */
        execute: async () => {
          if (!wedged) {
            wedged = true;
            return new Promise<ExpansionAnswer>(() => {});
          }
          throw new Error("the account has no credit");
        },
      }),
    ).rejects.toThrow(/no credit/);
    expect(wedged).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  /**
   * **The drain bound as arithmetic rather than as prose**, the same way
   * `EXPANSION_CONCURRENCY`'s derivation is — so that moving one of the numbers
   * it rests on goes red instead of leaving a stale paragraph.
   *
   * The abort reaches every wait, so `EXPANSION_ATTEMPTS` and
   * `MAX_RETRY_AFTER_MS` are deliberately *not* in the sum: a straggler cannot
   * be sent again once the wave has failed. What is left is one packed model
   * call, plus the third of it again that `CALL_RESERVE_MS` allows for reading
   * the answer and writing its row.
   */
  it("waits one packed call plus the reading of it, and no retry budget", async () => {
    const { EXPANSION_DRAIN_MS } = await import("../src/hierarchy-deepen.js");
    const PACKED_CALL_MS = 45_000;
    expect(EXPANSION_DRAIN_MS).toBe(PACKED_CALL_MS + PACKED_CALL_MS / 3);
    /* Which is `CALL_RESERVE_MS`'s own sum — the same two terms, a different
       question — and it must not quietly become the retry budget instead. */
    expect(EXPANSION_DRAIN_MS).toBe(CALL_RESERVE_MS);
  });
});

/* ============================================================ the deadline == */

describe("running out of the step's deadline", () => {
  /**
   * **A wave that cannot finish stops between calls, not inside one.**
   *
   * The deadline here is already past, so no call may start at all; the
   * assertions are that nothing was bought, that the wave came back rather than
   * throwing, and that the tree is exactly the one wave 1 produced. That last is
   * the point of the whole design: the article is correct, it is simply not
   * deeper, and the next attempt resumes onto whatever *had* been bought.
   */
  it("declines to start a call it cannot finish, and says how many", async () => {
    const tree = await waveOne();
    const fake = fakeExecutor();
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fake.execute,
      recipe: ONE_PER_CALL,
      deadlineAt: Date.now(),
    });
    expect(fake.seen).toHaveLength(0);
    expect(out.stats.outOfTime).toBe(2);
    expect(out.stats.expanded).toBe(0);
    expect(out.root).toBeNull();
  });

  /**
   * **A wave that lost half of itself to the clock publishes none of itself.**
   *
   * The gate is one slot wide and the second call is admitted only after the
   * first has come back, by which time the reserve is gone — so one call lands
   * and one is declined. What the reader must never get is the tree in between:
   * one section deepened and its neighbour not, chosen by whichever call the
   * dispatch jitter happened to let through. `deepenTree`'s attachment is
   * therefore all or nothing.
   *
   * The two halves of the assertion are the trade: **nothing is published**, and
   * **the row that was paid for is still in the store**, so the next attempt buys
   * one call instead of two. The verdicts of the call that landed are recorded
   * either way — an answer we paid for is measured whether or not it is used.
   */
  it("publishes none of a wave the deadline cut in half, and keeps what it bought", async () => {
    const tree = await waveOne();
    const memory = memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-wave" });
    /* A second of slack before the reserve bites, and a call twice that long:
       the first call must comfortably get out on a loaded box, and the second
       must comfortably not. */
    const deadlineAt = Date.now() + CALL_RESERVE_MS + 1_000;
    const fake = fakeExecutor(async (request) => {
      await new Promise((r) => setTimeout(r, 2_000));
      return answerFor(request);
    });
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: memory,
      execute: fake.execute,
      recipe: ONE_PER_CALL,
      gate: new WidthGate(1),
      deadlineAt,
    });

    expect(fake.seen).toHaveLength(1);
    expect(out.stats.outOfTime).toBe(1);
    expect(out.stats.expanded).toBe(0);
    expect(out.stats.added).toBe(0);
    expect(out.root).toBeNull();
    /* Bought, and deliberately not attached. */
    expect(out.stats.withheld).toBe(1);
    /* The row is the whole reason this is safe rather than wasteful. */
    expect(memory.entries.size).toBe(1);
    /* And the answer we paid for was still measured. */
    expect(out.records.filter((r) => r.wave === 2)).toHaveLength(2);
  });

  /**
   * **And the calls that did land are kept**, which is what makes the next
   * attempt cheap rather than a fresh start.
   *
   * The deadline is moved past while the first call is in flight, and the gate is
   * one slot wide so that the second call has to be admitted *after* that
   * happened — which is the shape the reserve is really about, a wave with more
   * calls in it than the gate has room for. The first call is not cancelled; the
   * second is never started; the row for the first is in the store.
   *
   * Against `runExpansionWave` rather than `deepenTree`, because the gate is the
   * thing being posed here and the wave is where it is injectable. A wave
   * narrower than its gate is admitted all at once and the reserve cannot stop
   * any of it — see `CALL_RESERVE_MS`, which says so.
   */
  it("keeps what it bought when the deadline arrives mid-wave", async () => {
    const tree = await waveOne();
    const { deepenSeed, batches } = await plan(tree, ONE_PER_CALL);
    const memory = memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-wave" });
    let deadlineAt = Date.now() + 3_600_000;
    let sent = 0;
    const wave = await runExpansionWave({
      slug: SLUG,
      checkpoints: memory,
      batches,
      ancestorsOf: () => [],
      blocks: BLOCKS,
      seed: deepenSeed,
      recipe: ONE_PER_CALL,
      gate: new WidthGate(1),
      execute: async (request) => {
        sent++;
        /* The step's time runs out while this call is on the wire. It is not
           cancelled — a cancelled call is money spent for nothing — and the call
           behind it, waiting on the gate's one slot, is never started. */
        deadlineAt = Date.now();
        return answerFor(request);
      },
      get deadlineAt() {
        return deadlineAt;
      },
    });
    expect(batches).toHaveLength(2);
    expect(sent).toBe(1);
    expect(wave.calls).toHaveLength(1);
    expect(wave.outOfTime).toBe(1);
    expect(memory.entries.size).toBe(1);
  });

  /**
   * **`withheld` may not claim a checkpoint row that does not exist.**
   *
   * Its docblock's whole promise is *"every one of these has a checkpoint row
   * waiting for it"* — which is what makes it the number saying what the next
   * attempt gets for free. But the write is deliberately best-effort and its
   * failure is swallowed, and the outcome was counted anyway. So an answer that
   * was paid for, withheld, and never persisted was reported as banked, and the
   * next attempt bought it again. ⟨GPT Sol's second review of stage 5a,
   * finding 2.⟩
   *
   * `uncheckpointed` is its sibling: money that buys the next attempt nothing.
   */
  it("does not count an answer as banked when its row never landed", async () => {
    const tree = await waveOne();
    const memory = memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-unwritten" });
    const brokenWrites = {
      ...memory,
      write: async (): Promise<void> => {
        throw new Error("the checkpoints table is not there");
      },
    };
    const deadlineAt = Date.now() + CALL_RESERVE_MS + 1_000;
    const fake = fakeExecutor(async (request) => {
      await new Promise((r) => setTimeout(r, 2_000));
      return answerFor(request);
    });
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: brokenWrites,
      execute: fake.execute,
      recipe: ONE_PER_CALL,
      gate: new WidthGate(1),
      deadlineAt,
    });

    expect(fake.seen).toHaveLength(1);
    expect(out.stats.outOfTime).toBe(1);
    expect(out.root).toBeNull();
    /* Nothing durable, so nothing is banked — and the paid call that bought the
       next attempt nothing is counted where a bill can find it. */
    expect(memory.entries.size).toBe(0);
    expect(out.stats.withheld).toBe(0);
    expect(out.stats.uncheckpointed).toBe(1);
  });
});

/* ================================================ a wave that dies fatally == */

describe("what a fatal wave leaves behind", () => {
  /**
   * **The peer that was paid for is measured even though the wave died.**
   *
   * One call fails and its peer lands and writes its row. Everything that peer
   * bought — its children's verdicts, its parent's fan-out, the wave's token
   * accounting and what the gate did — used to be thrown away with the throw.
   */
  it("carries the paid peer's records, its tokens and the gate out on the failure", async () => {
    const { DeepenFailed } = await import("../src/hierarchy-deepen.js");
    const tree = await waveOne();
    const memory = memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-fatal" });
    const paying = payingExecutor();
    let slowStarted = false;
    const caught = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: memory,
      recipe: ONE_PER_CALL,
      gate: new WidthGate(2),
      execute: async (request) => {
        if (!slowStarted) {
          slowStarted = true;
          await new Promise((r) => setTimeout(r, 80));
          return paying.execute(request);
        }
        throw new Error("the account has no credit");
      },
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(caught).toBeInstanceOf(DeepenFailed);
    const failed = caught as InstanceType<typeof DeepenFailed>;
    expect(String(failed.message)).toContain("no credit");
    /* The peer's row landed, so the next attempt gets it free — and it is
       counted rather than merely present. */
    expect(memory.entries.size).toBe(1);
    expect(failed.partial.stats.withheld).toBe(1);
    expect(failed.partial.stats.uncheckpointed).toBe(0);
    /* Wave 1's three governor decisions and the peer's two children. */
    expect(failed.partial.records.filter((r) => r.wave === 1)).toHaveLength(3);
    expect(failed.partial.records.filter((r) => r.wave === 2)).toHaveLength(2);
    /* Nothing is published: the article keeps the tree wave 1 gave it. */
    expect(failed.partial.root).toBeNull();
    expect(failed.partial.stats.expanded).toBe(0);
    expect(failed.partial.stats.usage.inputTokens).toBe(COST.inputTokens);
    expect(failed.partial.stats.gate?.initialWidth).toBe(2);
  });
});

/* ================================================= what the gate explained == */

/**
 * **A slow wave has to be able to say why it was slow**, and `DeepenStats` kept
 * only `rateLimited` — a count with no width beside it, so an artefact could not
 * say whether the gate had narrowed to one or never moved. ⟨GPT Sol's second
 * review of stage 5a, finding 7.⟩
 *
 * Per wave, not the process singleton's cumulative life story: `WidthGate` is
 * shared across concurrent jobs, so `report()` on the artefact would attribute
 * another book's rate limit to this one.
 */
describe("what the width gate did while the wave ran", () => {
  it("puts this wave's initial, final, narrowest width and refusals on the stats", async () => {
    const tree = await waveOne();
    const gate = new WidthGate(4);
    /* Somebody else's burst first, so a cumulative figure and a per-wave one
       cannot come out the same. */
    await gate
      .run(
        () => Promise.reject(new ExpansionRateLimited(0)),
        (err) => (err instanceof ExpansionRateLimited ? err.retryAfterMs : false),
      )
      .catch(() => {});
    expect(gate.report()).toMatchObject({ narrowest: 2, refusals: 1 });

    let refused = false;
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-gate" }),
      recipe: ONE_PER_CALL,
      gate,
      execute: async (request) => {
        if (!refused) {
          refused = true;
          throw new ExpansionRateLimited(0);
        }
        return answerFor(request);
      },
    });
    expect(out.stats.expanded).toBe(2);
    expect(out.stats.rateLimited).toBe(1);
    expect(out.stats.gate).toEqual({
      initialWidth: 2,
      /* **Back up by the end, and narrowest is the whole point.** The refusal
         halved it to one and the answered call that followed earned the slot
         straight back, so a final width alone would say the wave never met
         anything. */
      finalWidth: 2,
      narrowestWidth: 1,
      /* One, not the two the gate has seen in its life. */
      refusals: 1,
    });
  });

  it("says nothing rather than zero where no call was ever made", async () => {
    const plain = Array.from({ length: 20 }, (_, i) => para(i));
    const { buildTree: build } = await import("../src/hierarchy.js");
    const tree = build(
      {
        title: "A Short Piece",
        gist: "It makes one point.",
        range: [blockId(0), blockId(19)],
        children: [
          { title: "The First Half", gist: "It opens.", range: [blockId(0), blockId(9)] },
          { title: "The Second Half", gist: "It closes.", range: [blockId(10), blockId(19)] },
        ],
      },
      {},
      plain,
      SLUG,
      { repairs: [], droppedChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] },
    );
    const out = await deepenTree({
      tree,
      blocks: plain,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: fakeExecutor().execute,
    });
    /* A window of zeros would read as a gate at width zero, which is a different
       and much more alarming fact than "this pass never touched it". */
    expect(out.stats.gate).toBeNull();
  });
});

/** The batches a wave over this tree would make, and the frozen seed beside them. */
async function plan(tree: Tree, recipe: CascadeRecipe) {
  const { frozenSeed } = await import("../src/hierarchy-deepen.js");
  const cascade = await import("../src/hierarchy-cascade.js");
  const expand = await import("../src/hierarchy-expand.js");
  const deepenSeed = frozenSeed(tree);
  const proposal = cascade.proposalFromTree(tree);
  const targets: import("../src/hierarchy-cascade.js").ExpansionTarget[] = (
    proposal.children ?? []
  )
    .filter((node) => (node.children ?? []).length === 0)
    .map((node, i) => ({
      node: {
        status: "pending" as const,
        title: node.title,
        range: node.range,
        ...(node.gist !== undefined ? { gist: node.gist } : {}),
      },
      where: `root > child ${i + 1}`,
    }))
    .filter(
      (target) =>
        cascade.decideExpansion({ node: target.node, depth: 1, blocks: BLOCKS, recipe })
          .decision === "expand",
    );
  const briefings = targets.map((target) => ({ target, ancestors: [] }));
  const overhead = expand.expansionOverhead({ briefings, blocks: BLOCKS, outline: deepenSeed.outline });
  const batches = cascade
    .planExpansionBatches(targets, BLOCKS, recipe, overhead)
    .filter((call): call is import("../src/hierarchy-cascade.js").ExpansionBatch => call.kind === "batch");
  return { deepenSeed, batches };
}

/* ====================================================== the whole step ===== */

/**
 * The two calls `generateHierarchy` would make are mocked at the module
 * boundary: the structure call answers with `WAVE_1`, and the label pass returns
 * one label per block. Neither is what is under test — where the deepening sits
 * in the step is.
 */
vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => ({
      onText: () => {},
      finalMessage: async () => ({
        content: [{ type: "text", text: JSON.stringify({ root: WAVE_1 }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    }),
  };
});

vi.mock("../src/labels.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/labels.js")>();
  const { hashBlocks } = await import("../src/source-hash.js");
  const { blocksArtefact } = await import("../src/blocks.js");
  return {
    ...real,
    generateLabels: async () => {
      const labels = Object.fromEntries(BLOCKS.map((b) => [b.id, `Label for ${b.id}`]));
      return {
        labels,
        file: {
          version: "test",
          generator: "test",
          slug: SLUG,
          structureHash: "0000000000000000",
          sourceHash: hashBlocks(blocksArtefact(BLOCKS).blocks),
          structureVersion: "test",
          batches: [],
          labels,
          dropped: [],
        },
        batches: 0,
        oversized: 0,
        resumed: 0,
        dropped: [],
        calls: 0,
        estimatedCacheable: false,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    },
  };
});

describe("where the wave sits in the step", () => {
  it("is off unless it is asked for, and then it is inert", async () => {
    const { generateHierarchy } = await import("../src/hierarchy.js");
    const fake = fakeExecutor();
    const run = await generateHierarchy({
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      expansionExecutor: fake.execute,
    });
    /* No flag, no wave — and `deepen: null` rather than a row of zeros, because
       "nobody asked" and "asked and found nothing" are different facts. */
    expect(fake.seen).toHaveLength(0);
    expect(run.deepen).toBeNull();
    expect(run.deepenFailed).toBe(false);
    expect(depthOf(run.parts.tree)).toBe(2);
  });

  it("deepens the tree it hands back when it is turned on", async () => {
    const { generateHierarchy } = await import("../src/hierarchy.js");
    const fake = fakeExecutor();
    const run = await generateHierarchy({
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      deepen: true,
      expansionExecutor: fake.execute,
    });
    expect(fake.seen).toHaveLength(1);
    expect(run.deepen?.expanded).toBe(2);
    expect(run.deepenFailed).toBe(false);
    /* The tree that comes back is the deepened one, and it passed
       `assertTreeSound` and `checkCoverage` on the way — both of which the stage
       runs over the artefacts it is about to return, not over a local. */
    expect(depthOf(run.parts.tree)).toBe(3);
  });

  /**
   * **The per-candidate records survive the step, or the paid run cannot answer
   * its own questions.**
   *
   * Three of the five questions stage 5b is meant to settle — is the verdict
   * stable across repeats, what is the raw yes rate by wave and by size, how
   * often did a bound overrule the verdict — are per-node facts, and every one
   * of them was built inside `deepenTree` and then dropped at the seam:
   * `generateHierarchy` kept `deepened.stats` and nothing else. A run that
   * cannot answer its own question is the waste the spec was written to prevent.
   *
   * The sink is a JSON file per run under the directory `DEEPEN_RECORDS_ENV`
   * names — unset, nothing is written, which is every reader today. See
   * `saveDeepenRecords`.
   */
  it("writes the per-candidate records somewhere a second run can be compared with", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deepen-records-"));
    process.env[DEEPEN_RECORDS_ENV] = dir;
    try {
      const { generateHierarchy } = await import("../src/hierarchy.js");
      const fake = fakeExecutor();
      await generateHierarchy({
        blocks: BLOCKS,
        slug: SLUG,
        checkpoints: nullCheckpointStore(),
        deepen: true,
        expansionExecutor: fake.execute,
      });

      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const raw = await readFile(path.join(dir, files[0]!), "utf-8");
      const file = JSON.parse(raw);
      /* **Nothing in it is prose from the article.** `where` is an ordinal path
         the cascade derives from the tree's shape, and every other field is a
         number, an enum or a model id — src/hierarchy-expand.ts §
         `CandidateRecord` states the rule and this is what holds it to it. */
      expect(raw).not.toContain("Paragraph 0001");
      expect(raw).not.toContain("The Headed Part");
      expect(raw).not.toContain("Part 1 of section");
      expect(file.slug).toBe(SLUG);
      expect(file.stats.expanded).toBe(2);
      /* Three wave-1 sections the governor decided about, and the four children
         the two calls came back with — the whole of what was decided, not a
         tally of it. */
      expect(file.records).toHaveLength(7);
      expect(file.records.filter((r: { wave: number }) => r.wave === 1)).toHaveLength(3);
      expect(
        file.records
          .filter((r: { wave: number }) => r.wave === 2)
          .map((r: { rawVerdict: string }) => r.rawVerdict),
      ).toEqual(["finished", "needs-deeper", "finished", "needs-deeper"]);
    } finally {
      delete process.env[DEEPEN_RECORDS_ENV];
    }
  });

  /**
   * **A failed wave costs the level, never the article.**
   *
   * The reader gets the tree wave 1 produced, which is the tree they get today,
   * and the run carries the one thing that distinguishes that from a healthy
   * article: `deepenFailed`. Without it a broken wave and an article with no fat
   * sections are the same row in the log.
   */
  it("keeps the wave-1 tree, and says so, when the wave throws", async () => {
    const { generateHierarchy } = await import("../src/hierarchy.js");
    const run = await generateHierarchy({
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      deepen: true,
      expansionExecutor: () => Promise.reject(new Error("the account has no credit")),
    });
    expect(run.deepenFailed).toBe(true);
    expect(run.deepen).toBeNull();
    expect(depthOf(run.parts.tree)).toBe(2);
  });

  /**
   * **A wave that dies fatally must still leave its measurement behind.**
   *
   * `saveDeepenRecords` was only on the success path, so a thrown wave took
   * wave 1's governor decisions, its paid peers' records, the gate result and
   * the token accounting with it — and for a run whose whole purpose is to
   * answer five questions, a failure nobody can read is nearly as bad as no run
   * at all. ⟨GPT Sol's second review of stage 5a, finding 5.⟩
   *
   * So the failure carries its partial telemetry and the catch writes it, with
   * `failed: true` and the reason.
   */
  it("writes a failed records file rather than losing what the wave measured", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deepen-failed-"));
    process.env[DEEPEN_RECORDS_ENV] = dir;
    try {
      const { generateHierarchy } = await import("../src/hierarchy.js");
      const run = await generateHierarchy({
        blocks: BLOCKS,
        slug: SLUG,
        checkpoints: nullCheckpointStore(),
        deepen: true,
        expansionExecutor: () => Promise.reject(new Error("the account has no credit")),
      });
      expect(run.deepenFailed).toBe(true);

      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const file = JSON.parse(await readFile(path.join(dir, files[0]!), "utf-8"));
      expect(file.failed).toBe(true);
      expect(file.reason).toContain("no credit");
      /* The three wave-1 decisions — which sections the governor chose and on
         which bound — survive the failure. They are question 3's numerator and
         they cost a two-dollar structure call to produce. */
      expect(file.records.filter((r: { wave: number }) => r.wave === 1)).toHaveLength(3);
      expect(file.stats.targets).toBe(2);
      expect(file.stats.expanded).toBe(0);
    } finally {
      delete process.env[DEEPEN_RECORDS_ENV];
    }
  });
});

/* ===================================================== what a wave cost ==== */

/** One call's bill, in the four numbers `ExpansionUsage` carries. */
const COST = {
  inputTokens: 14_889,
  outputTokens: 2_100,
  cacheReadTokens: 1_200,
  cacheWriteTokens: 400,
} as const;

/** `fakeExecutor`'s answers, with a bill on each one. */
function payingExecutor(over?: (request: ExpansionRequest, n: number) => string | null) {
  const seen: ExpansionRequest[] = [];
  return {
    seen,
    execute: async (request: ExpansionRequest): Promise<ExpansionAnswer> => {
      seen.push(request);
      const forced = over?.(request, seen.length) ?? null;
      return { text: forced ?? answerFor(request).text, usage: { ...COST } };
    },
  };
}

/**
 * **What the expansion calls cost had nowhere to go until 2026-09-05.**
 *
 * `ExpansionExecutor` handed back a bare string, so the wave's tokens reached
 * neither `DeepenStats` nor `HierarchyRun`. They were metered — `streamMessage`
 * calls `beginSpend` for every one — so the money was recoverable from the
 * AI-spend ledger under task `hierarchy`, and that is precisely the wrong shape
 * for question 4 of the live wave, which is answered by comparing one run's
 * artefact with another's. docs/plans/260904d-deepen-fat-sections.md
 * § "What the live run must answer".
 */
describe("what a deepening wave says it cost", () => {
  it("adds up every call it made, and charges nothing for one it resumed", async () => {
    const tree = await waveOne();
    const { deepenSeed, batches } = await plan(tree, ONE_PER_CALL);
    const memory = memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-cost" });
    const once = async (): Promise<Awaited<ReturnType<typeof runExpansionWave>>> =>
      runExpansionWave({
        slug: SLUG,
        checkpoints: memory,
        execute: payingExecutor().execute,
        batches,
        ancestorsOf: () => [],
        blocks: BLOCKS,
        seed: deepenSeed,
        recipe: ONE_PER_CALL,
      });

    expect(batches).toHaveLength(2);
    const first = await once();
    expect(first.usage).toEqual({
      inputTokens: COST.inputTokens * 2,
      outputTokens: COST.outputTokens * 2,
      cacheReadTokens: COST.cacheReadTokens * 2,
      cacheWriteTokens: COST.cacheWriteTokens * 2,
    });

    /* **The second attempt is free, and the figure has to say so.** A wave that
       reported the same bill for a resumed run as for a bought one would make
       the checkpoint invisible in exactly the artefact somebody costs a book
       from. */
    const second = await once();
    expect(second.usable).toBe(2);
    expect(second.usage).toEqual(NO_EXPANSION_USAGE);
  });

  it("counts every draw of a call that was refused before it stood up", async () => {
    /* One call, refused once. The redraw was generated and billed like any other
       call, so leaving it out would understate the wave by exactly the drawings
       the redraw budget exists to pay for. */
    const tree = await waveOne();
    const { deepenSeed, batches } = await plan(tree, ONE_PER_CALL);
    const paying = payingExecutor((_request, n) => (n === 1 ? "this is not an answer" : null));
    const wave = await runExpansionWave({
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      execute: paying.execute,
      batches: [batches[0]!],
      ancestorsOf: () => [],
      blocks: BLOCKS,
      seed: deepenSeed,
      recipe: ONE_PER_CALL,
    });
    expect(wave.calls).toHaveLength(1);
    expect(wave.calls[0]!.redraws).toBe(1);
    expect(paying.seen).toHaveLength(2);
    expect(wave.usage.inputTokens).toBe(COST.inputTokens * 2);
    expect(wave.usage.outputTokens).toBe(COST.outputTokens * 2);
  });

  /**
   * **A wave the deadline split publishes nothing and still spent the money.**
   *
   * `expanded`, `added` and `withheld` are about what the reader got; `usage` is
   * about what the attempt paid, and conditioning the second on the first would
   * be the one number a budget must not get wrong.
   */
  it("reports what a withheld wave paid for, even though none of it was published", async () => {
    const tree = await waveOne();
    const deadlineAt = Date.now() + CALL_RESERVE_MS + 1_000;
    const paying = payingExecutor();
    const slow = async (request: ExpansionRequest): Promise<ExpansionAnswer> => {
      await new Promise((r) => setTimeout(r, 2_000));
      return paying.execute(request);
    };
    const out = await deepenTree({
      tree,
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-cost" }),
      execute: slow,
      recipe: ONE_PER_CALL,
      gate: new WidthGate(1),
      deadlineAt,
    });
    expect(out.stats.withheld).toBe(1);
    expect(out.stats.expanded).toBe(0);
    expect(out.stats.usage).toEqual({ ...COST });
  });
});

/**
 * **The whole step's four totals, with the wave in them and without it.**
 *
 * The first assertion is the one worth having: an undeepened run must report
 * exactly what it reported before any of this existed, because a changed number
 * on an untouched path is the shape of a silent bug. The deepened run's totals
 * are then the undeepened ones plus the wave's, **once** — which is what goes
 * red if anything ever adds the wave in twice.
 */
describe("the run's token totals", () => {
  it("adds the wave once on a deepened run, and nothing at all on an ordinary one", async () => {
    const { generateHierarchy } = await import("../src/hierarchy.js");
    const plainRun = await generateHierarchy({
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      expansionExecutor: payingExecutor().execute,
    });
    /* The flag is off, so the executor is never reached and there is nothing to
       add — `deepen` is `null` rather than a row of zeros. */
    expect(plainRun.deepen).toBeNull();

    const deepRun = await generateHierarchy({
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: nullCheckpointStore(),
      deepen: true,
      expansionExecutor: payingExecutor().execute,
    });
    /* One call, not two: `CASCADE_RECIPE` packs both fat sections into one
       request, which is what the step does and what this is measuring. */
    const paid = deepRun.deepen?.usage;
    expect(paid).toEqual({ ...COST });
    /* Exactly the difference, in all four. Doubling any of them fails here. */
    expect(deepRun.inputTokens - plainRun.inputTokens).toBe(paid!.inputTokens);
    expect(deepRun.outputTokens - plainRun.outputTokens).toBe(paid!.outputTokens);
    expect(deepRun.cacheReadTokens - plainRun.cacheReadTokens).toBe(paid!.cacheReadTokens);
    expect(deepRun.cacheWriteTokens - plainRun.cacheWriteTokens).toBe(paid!.cacheWriteTokens);
  });

  it("reaches the records file, which is the artefact a repeat is compared against", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deepen-cost-"));
    process.env[DEEPEN_RECORDS_ENV] = dir;
    try {
      const { generateHierarchy } = await import("../src/hierarchy.js");
      await generateHierarchy({
        blocks: BLOCKS,
        slug: SLUG,
        checkpoints: nullCheckpointStore(),
        deepen: true,
        expansionExecutor: payingExecutor().execute,
      });
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const file = JSON.parse(await readFile(path.join(dir, files[0]!), "utf-8"));
      expect(file.stats.usage.inputTokens).toBe(COST.inputTokens);
      expect(file.stats.usage.cacheWriteTokens).toBe(COST.cacheWriteTokens);
    } finally {
      delete process.env[DEEPEN_RECORDS_ENV];
    }
  });

  /**
   * **Two passes in one process in one second must leave two files**, which is
   * exactly what `--repeat` is.
   *
   * The name was `<slug>-<stamp>-<pid>.json`, stamped to the second, and the
   * process id cannot separate two passes of one process. So a repeat
   * overwrote the pass it was supposed to be compared against — losing the
   * measurement and saying nothing. ⟨GPT Sol's second review of stage 5a,
   * finding 4.⟩
   *
   * The write is exclusive as well as counted: a collision has to fail loudly
   * and be retried under the next number, rather than being silently the same
   * file twice.
   */
  it("keeps two passes written in the same tick apart", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deepen-repeat-"));
    process.env[DEEPEN_RECORDS_ENV] = dir;
    try {
      const { saveDeepenRecords } = await import("../src/hierarchy-deepen.js");
      const tree = await waveOne();
      const out = await deepenTree({
        tree,
        blocks: BLOCKS,
        slug: SLUG,
        checkpoints: nullCheckpointStore(),
        execute: fakeExecutor().execute,
      });
      await Promise.all([
        saveDeepenRecords(SLUG, out),
        saveDeepenRecords(SLUG, out),
        saveDeepenRecords(SLUG, out),
      ]);
      const files = await readdir(dir);
      expect(files).toHaveLength(3);
      expect(new Set(files).size).toBe(3);
      /* **And nothing half-written left where a reader would look.** The bytes
         go to a temporary name and are published with `link`, so a `.json` in
         this directory is always whole — the stage-5b eval reads it from three
         jobs at once and used to be able to parse a sibling's file mid-write
         (⟨GPT Sol, DPN-14⟩). The temp is not named `.json` and is unlinked
         either way, so a leftover here means one of those two stopped being
         true. */
      expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(3);
      for (const file of files) {
        expect(JSON.parse(await readFile(path.join(dir, file), "utf-8"))).toMatchObject({
          slug: SLUG,
          version: "deepen-records/2",
        });
      }
    } finally {
      delete process.env[DEEPEN_RECORDS_ENV];
    }
  });
});

/* ================================================== a repeat must re-ask === */

/**
 * **The measurement that could not be made.**
 *
 * Question 1 — *is the verdict stable across repeats?* — is the one stage 6
 * leans on, and the scoped calls being content-addressed made it unaskable: a
 * second run over the same article read its own rows back, made no call, and
 * produced identical verdicts **by construction**. That looks exactly like a
 * perfectly stable signal and is worth nothing.
 *
 * `REASK_ENV` is the switch, and what it does is skip the *read*. It adds no
 * `delete` to `CheckpointStore`, which that file's header rules out with the
 * accidents behind it.
 *
 * **It names articles rather than being a boolean**, and that is the second
 * review's P0: a boolean read from `process.env` on every wave meant a worker
 * started with it set re-asked for *every* eligible article it later picked up,
 * spending real money on unrelated readers' jobs — and stage 5b runs through
 * the queue, so the worker doing the repeats is the worker serving everyone
 * else. ⟨GPT Sol's second review of stage 5a, finding 1.⟩
 */
describe("re-asking a wave the store has already answered", () => {
  const setReask = (value: string | undefined): void => {
    if (value === undefined) delete process.env[REASK_ENV];
    else process.env[REASK_ENV] = value;
  };

  afterEach(() => setReask(undefined));

  it("is off unless this very article is named, and a boolean spelling names nothing", () => {
    for (const [value, expected] of [
      [undefined, false],
      ["deepen-wave", true],
      [" deepen-wave , other ", true],
      ["other,deepen-wave", true],
      ["", false],
      ["other", false],
      ["deepen-wave-2", false],
      ["Deepen-Wave", false],
      /* **The old spelling, and it must mean nothing.** Its failure mode was
         paying for strangers' articles, so there must be no way to ask for that
         by accident. */
      ["1", false],
      ["true", false],
      ["yes", false],
      ["0", false],
    ] as const) {
      setReask(value);
      expect(reaskExpansions(SLUG), `${REASK_ENV}=${String(value)}`).toBe(expected);
    }
  });

  /**
   * **Two articles, one process, and only the named one pays.**
   *
   * This is the finding itself. Both stores hold every row a first pass wrote;
   * the repeat then buys the named article's calls again and reads the other's
   * back for nothing.
   */
  it("re-asks only the article it was given, in a process handling both", async () => {
    setReask("deepen-named");
    const tree = await waveOne();
    const { deepenSeed, batches } = await plan(tree, ONE_PER_CALL);
    const pass = async (
      slug: string,
      checkpoints: ReturnType<typeof memoryCheckpoints>,
    ): Promise<number> => {
      const paying = payingExecutor();
      await runExpansionWave({
        slug,
        checkpoints,
        execute: paying.execute,
        batches,
        ancestorsOf: () => [],
        blocks: BLOCKS,
        seed: deepenSeed,
        recipe: ONE_PER_CALL,
      });
      return paying.seen.length;
    };
    const named = memoryCheckpoints({ slug: "deepen-named", articleId: "a-reask-named" });
    const other = memoryCheckpoints({ slug: "deepen-other", articleId: "a-reask-other" });

    expect(await pass("deepen-named", named)).toBe(2);
    expect(await pass("deepen-other", other)).toBe(2);

    /* The repeat. The named article is bought again — which is the measurement —
       and the stranger's is free, which is the money this switch used to spend. */
    expect(await pass("deepen-named", named)).toBe(2);
    expect(await pass("deepen-other", other)).toBe(0);
  });

  it("buys every call again, does not read, and replaces the rows it skipped", async () => {
    const tree = await waveOne();
    const { deepenSeed, batches } = await plan(tree, ONE_PER_CALL);
    const memory = memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-reask" });
    const attempt = async (
      reask: boolean,
    ): Promise<{ wave: Awaited<ReturnType<typeof runExpansionWave>>; sent: number }> => {
      const paying = payingExecutor();
      const wave = await runExpansionWave({
        slug: SLUG,
        checkpoints: memory,
        execute: paying.execute,
        batches,
        ancestorsOf: () => [],
        blocks: BLOCKS,
        seed: deepenSeed,
        recipe: ONE_PER_CALL,
        reask,
      });
      return { wave, sent: paying.seen.length };
    };

    const first = await attempt(false);
    expect(first.sent).toBe(2);
    expect(memory.calls.writes).toBe(2);

    /* The control, and the thing that made the measurement impossible: an
       ordinary repeat is free and makes no call at all. */
    const repeat = await attempt(false);
    expect(repeat.sent).toBe(0);
    expect(repeat.wave.usable).toBe(2);

    const readsBefore = memory.calls.reads;
    const again = await attempt(true);
    expect(again.sent).toBe(2);
    /* Not read, rather than read and discarded. */
    expect(memory.calls.reads).toBe(readsBefore);
    expect(again.wave.found).toBe(0);
    expect(again.wave.usable).toBe(0);
    expect(again.wave.usage.inputTokens).toBe(COST.inputTokens * 2);
    /* **And it still writes.** Last-write-wins, so the freshest answer replaces
       the stale one under the same key — which is what makes a genuine
       resumption after a re-asking run cheap rather than a fresh start. */
    expect(memory.calls.writes).toBe(4);
    expect(memory.entries.size).toBe(2);
    const after = await attempt(false);
    expect(after.sent).toBe(0);
  });

  /**
   * **Wave 1 stays resumed, and that is the point rather than an oversight.**
   *
   * A resumed structure call is what holds the seed constant: every repeat
   * expands the identical tree from the identical frozen outline, so a verdict
   * that moves is the scoped call changing its mind rather than a different tree
   * being asked a different question. Re-asking the structure call too would
   * measure both at once and could not separate them.
   */
  it("leaves the structure checkpoint alone, so repeats hold the seed constant", async () => {
    setReask(SLUG);
    const { generateHierarchy } = await import("../src/hierarchy.js");
    const memory = memoryCheckpoints({ slug: SLUG, articleId: "a-deepen-reask-step" });
    const runOnce = async (): Promise<{
      run: Awaited<ReturnType<typeof generateHierarchy>>;
      sent: number;
    }> => {
      const paying = payingExecutor();
      const run = await generateHierarchy({
        blocks: BLOCKS,
        slug: SLUG,
        checkpoints: memory,
        deepen: true,
        expansionExecutor: paying.execute,
      });
      return { run, sent: paying.seen.length };
    };

    const first = await runOnce();
    expect(first.run.structureResumed).toBe(false);
    expect(first.sent).toBe(1);

    const second = await runOnce();
    /* The tree came off the checkpoint — free, and identical — while the scoped
       call was bought again. That is the comparison stage 5b needs. */
    expect(second.run.structureResumed).toBe(true);
    expect(second.sent).toBe(1);
    expect(second.run.deepen?.usage.inputTokens).toBe(COST.inputTokens);
  });
});

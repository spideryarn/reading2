/**
 * What the label pass does when a batch comes back one label short.
 *
 * **The failure this file is about happened in production twice**, on a
 * 244-block Wolfram article, 2026-08-30: *"this call asked for 58 labels and got
 * 57, missing 4. Nothing has been written."* One label out of fifty-eight, and
 * the whole ingest died — after re-buying all fifty-eight a second time, for
 * byte-identical numbers.
 *
 * It is not a bug in this code and no retry can fix it. Stage 3 strips that
 * article's eighty Wolfram Language code cells to empty paragraphs, leaving bare
 * lead-in fragments pointing at nothing — one of them is the single word "or".
 * The prompt demands 6–20 words that are *"a CLAIM or a MOVE"* and forbids
 * introducing a fact that is not in the paragraph, and for a fragment whose fact
 * was in the stripped image those instructions are **jointly unsatisfiable**, so
 * skipping it is the compliant move. Third recorded instance of the shape; see
 * `BatchIncomplete` in src/labels.ts for the other two.
 *
 * So there are three behaviours here, in rising order of risk, and the tests
 * follow that order:
 *
 * 1. re-ask for **only the paragraphs that are missing**, rather than re-buying
 *    the whole batch;
 * 2. if that also comes back short, **accept the batch with the gap** — but only
 *    within a per-batch budget;
 * 3. and **report what was dropped**, because an unlabelled leaf renders as
 *    nothing at all rather than as an error. That is the whole risk of item 2:
 *    docs/reusable/silent-success.md.
 *
 * Deterministic — the model call is replaced with a scripted answer, so no
 * network and no key. docs/project/testing.md.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";

/**
 * The scripted transport.
 *
 * `vi.hoisted` because `vi.mock`'s factory is lifted above the imports, so it
 * cannot close over an ordinary `const` declared below it — and a factory that
 * reads one gets a TDZ error at import time rather than anything readable.
 */
const wire = vi.hoisted(() => ({
  /** Every request body that reached the wire, in order. */
  calls: [] as { maxTokens: number; parts: string[] }[],
  /** What to answer, indexed by call number. Set by each test. */
  answers: [] as string[],
}));

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...actual,
    /* Only the transport is replaced. `wasRefused` and the rest stay real, so
       this test drives the same parsing, budgeting and retry code the pipeline
       does — a stub that answered `parseLabels` directly would prove nothing
       about the path a live run takes. */
    streamMessage: (_task: string, body: Record<string, unknown>) => {
      const content = (body.messages as { content: { text: string }[] }[])[0]!.content;
      const at = wire.calls.length;
      wire.calls.push({
        maxTokens: body.max_tokens as number,
        parts: content.map((p) => p.text),
      });
      const answer = wire.answers[at];
      if (answer === undefined) throw new Error(`No scripted answer for call ${at + 1}`);
      const stop = answer === "TRUNCATED" ? "max_tokens" : "end_turn";
      return {
        onText: () => {},
        aborted: () => false,
        finalMessage: async () => ({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "test",
          content: [{ type: "text", text: answer === "TRUNCATED" ? "{" : answer }],
          stop_reason: stop,
          stop_sequence: null,
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        }),
      };
    },
  };
});

const { generateLabels } = await import("../src/labels.js");

function block(i: number): Block {
  const id = `spya-${String(i).padStart(6, "0")}`;
  return {
    id,
    tag: "p",
    kind: "text",
    text: `Paragraph ${i} says something about the matter at hand.`,
    words: 9,
    html: `<p id="${id}">Paragraph ${i}</p>`,
    gistable: true,
  };
}

/** One section holding `n` leaves — so `planBatches` produces exactly one batch. */
function oneSection(n: number): { tree: Tree; blocks: Block[] } {
  const blocks = Array.from({ length: n }, (_, i) => block(i));
  const nodes: Record<NodeId, TreeNode> = {};
  const rootId = "n0001";
  const sectionId = "n0002";
  const leafIds: NodeId[] = [];
  blocks.forEach((b, i) => {
    const id = `n${String(i + 3).padStart(4, "0")}`;
    nodes[id] = { id, depth: 2, parent: sectionId, children: [], range: [b.id, b.id], title: "" };
    leafIds.push(id);
  });
  nodes[sectionId] = {
    id: sectionId,
    depth: 1,
    parent: rootId,
    children: leafIds,
    range: [blocks[0]!.id, blocks[n - 1]!.id],
    title: "The only section",
    gist: "It argues something.",
  };
  nodes[rootId] = {
    id: rootId,
    depth: 0,
    parent: null,
    children: [sectionId],
    range: [blocks[0]!.id, blocks[n - 1]!.id],
    title: "Whole piece",
  };
  return { tree: { version: "toc/1", rootId, nodes, slug: "test" } as Tree, blocks };
}

/**
 * Twenty words no two of which share a stem, one per block.
 *
 * `contentWords` in src/labels.ts drops stopwords and anything under three
 * characters, so a shift is only detectable when each block has vocabulary of
 * its own — which is exactly the article property `detectShift` documents itself
 * as unable to read (verse, a table of near-identical rows).
 */
const WORDS = [
  "zebra", "harpsichord", "basalt", "meridian", "quinine", "tundra", "vellum", "cobalt",
  "sorghum", "trebuchet", "plankton", "obsidian", "marzipan", "kestrel", "fulcrum", "juniper",
  "lagoon", "pemmican", "sextant", "walrus",
];

/** The model's answer: a label for each of these ordinals and no others. */
function answering(ordinals: number[], how = "A claim about paragraph"): string {
  return JSON.stringify({
    labels: ordinals.map((n) => [n, `${how} ${n}, said at a workable length`]),
  });
}

/** 1…n with `gaps` left out — what a model that skipped a fragment returns. */
function allBut(n: number, gaps: number[], how?: string): string {
  const ordinals = Array.from({ length: n }, (_, i) => i + 1).filter((x) => !gaps.includes(x));
  return how === undefined ? answering(ordinals) : answering(ordinals, how);
}

beforeEach(() => {
  wire.calls.length = 0;
  wire.answers.length = 0;
});

describe("a batch that comes back short", () => {
  it("re-asks for the missing paragraph only, not for the whole batch again", async () => {
    /* The production shape exactly: 58 asked for, 57 back, paragraph 4 absent.
       Before this, the answer was to re-buy all 58 at double the reasoning
       allowance — which failed identically three times on record, because the
       drop is a property of one line of the prompt rather than of sampling. */
    const { tree, blocks } = oneSection(58);
    wire.answers.push(allBut(58, [4]));
    wire.answers.push(answering([4], "A repaired claim about paragraph"));

    const run = await generateLabels({ tree, blocks, slug: "test" });

    expect(wire.calls.length).toBe(2);
    const second = wire.calls[1]!;
    // Named, so the model is told what to write rather than asked again in hope.
    expect(second.parts.join("\n")).toMatch(/paragraph 4\b/);
    /* And it budgets for one label rather than 58. The ceiling itself barely
       moves — most of it is the reasoning reservation, which is a ceiling and
       not a purchase — so what is asserted is the part that is the saving: the
       answer allowance, at `55` tokens a label in `runBatch`, drops by exactly
       the 57 labels this call is not re-buying. */
    expect(wire.calls[0]!.maxTokens - second.maxTokens).toBe(57 * 55);

    expect(Object.keys(run.labels).length).toBe(58);
    expect(run.dropped).toEqual([]);
  });

  it("keeps the labels the first call got right, rather than replacing them", async () => {
    // The saving is the whole point: 57 answers already paid for are kept, and
    // only the one that is missing is bought again.
    const { tree, blocks } = oneSection(58);
    wire.answers.push(allBut(58, [4], "First-pass claim about paragraph"));
    wire.answers.push(answering([4], "Second-ask claim about paragraph"));

    const run = await generateLabels({ tree, blocks, slug: "test" });

    expect(run.labels[blocks[0]!.id]).toContain("First-pass claim");
    expect(run.labels[blocks[3]!.id]).toContain("Second-ask claim");
  });

  it("asks once and once only when the answer came back whole", async () => {
    // The control. A repair that fires on a healthy batch would double the bill
    // of the most expensive step in the pipeline and nothing would be red.
    const { tree, blocks } = oneSection(12);
    wire.answers.push(allBut(12, []));

    const run = await generateLabels({ tree, blocks, slug: "test" });

    expect(wire.calls.length).toBe(1);
    expect(run.dropped).toEqual([]);
  });

  it("still re-draws the whole batch when the answer was truncated", async () => {
    /* A truncation is a different failure with a different answer: nothing came
       back to keep, and the fix is room to think, so the whole batch goes again
       at double the reasoning allowance. Pinned here because the shortfall path
       above routes around that retry, and routing around it for *every*
       BatchIncomplete would have silently removed it. */
    const { tree, blocks } = oneSection(12);
    wire.answers.push("TRUNCATED");
    wire.answers.push(allBut(12, []));

    const run = await generateLabels({ tree, blocks, slug: "test" });

    expect(wire.calls.length).toBe(2);
    expect(wire.calls[1]!.maxTokens).toBeGreaterThan(wire.calls[0]!.maxTokens);
    expect(Object.keys(run.labels).length).toBe(12);
  });
});

describe("when the re-ask comes back short too", () => {
  it("accepts the batch with the gap, and says which block it dropped", async () => {
    /* The bounded partial accept. The alternative is what production did: throw
       away 57 good labels and fail the ingest over a paragraph whose entire text
       is the word "or". */
    const { tree, blocks } = oneSection(58);
    wire.answers.push(allBut(58, [4]));
    wire.answers.push(JSON.stringify({ labels: [] }));

    const run = await generateLabels({ tree, blocks, slug: "test" });

    expect(wire.calls.length).toBe(2);
    expect(run.dropped).toEqual([blocks[3]!.id]);
    expect(Object.keys(run.labels).length).toBe(57);
    expect(run.labels[blocks[3]!.id]).toBeUndefined();
  });

  it("records the drop in labels.json, so the eval is not left to guess", async () => {
    /* "The eval had to be told" — the sharpest lesson of the R2/R3 build. A
       repair inside the code under measurement silently redefines the
       measurement: without this field, evals/toc-labels.ts reads coverage below
       1 and prints INCOMPLETE for an article that is behaving as designed. */
    const { tree, blocks } = oneSection(58);
    wire.answers.push(allBut(58, [4]));
    wire.answers.push(JSON.stringify({ labels: [] }));

    const run = await generateLabels({ tree, blocks, slug: "test" });

    expect(run.file.dropped).toEqual([blocks[3]!.id]);
  });

  it("refuses when more of the batch is missing than the budget allows", async () => {
    // 3 of 58 is past `max(1, ceil(2% of 58))` = 2, so this is not a fragment
    // the model could not label — it is a batch that went wrong.
    const { tree, blocks } = oneSection(58);
    wire.answers.push(allBut(58, [4, 9, 40]));
    wire.answers.push(JSON.stringify({ labels: [] }));

    await expect(generateLabels({ tree, blocks, slug: "test" })).rejects.toThrow(
      /missing paragraphs 4, 9, 40/,
    );
  });

  it("gives a small batch one label of slack and no more", async () => {
    // `max(1, …)`: 2% of twelve rounds to nothing, and a batch that may drop a
    // fixed *share* of itself would drop nothing at all below fifty.
    const { tree, blocks } = oneSection(12);
    wire.answers.push(allBut(12, [7]));
    wire.answers.push(JSON.stringify({ labels: [] }));
    const run = await generateLabels({ tree, blocks, slug: "test" });
    expect(run.dropped).toEqual([blocks[6]!.id]);

    wire.calls.length = 0;
    wire.answers.length = 0;
    wire.answers.push(allBut(12, [7, 8]));
    wire.answers.push(JSON.stringify({ labels: [] }));
    await expect(generateLabels({ tree, blocks, slug: "test" })).rejects.toThrow(
      /missing paragraphs 7, 8/,
    );
  });

  it("never accepts a batch whose labels sat on the wrong paragraphs", async () => {
    /**
     * **The hole a partial accept opens if nobody looks.**
     *
     * `detectShift` is the check for the one wrong answer `parseLabels` cannot
     * see: a model that loses count and describes paragraph n+1 in label n. It
     * used to run after the parse — so on a batch that came back *short*, the
     * parse threw first and the shift check never ran at all. Accept that
     * batch's partial answer and every label in it is one paragraph out, with
     * nothing red and no gap: the reader gets 19 confident labels for the wrong
     * 19 paragraphs. That is a worse failure than the one the accept exists to
     * avoid, and it is the reason `acceptGap` checks what it is about to keep.
     *
     * Blocks with distinctive vocabulary, and labels that borrow the *next*
     * block's word — which is what a real ±1 displacement looks like.
     */
    const { tree, blocks } = oneSection(20);
    const distinct = blocks.map((b, i) => ({
      ...b,
      text: `This passage concerns ${WORDS[i]} and nothing else whatsoever.`,
    }));
    const shifted = JSON.stringify({
      labels: Array.from({ length: 20 }, (_, i) => i + 1)
        .filter((n) => n !== 7)
        .map((n) => [n, `A claim concerning ${WORDS[n] ?? "afterwards"} at some length`]),
    });
    wire.answers.push(shifted);
    wire.answers.push(answering([7], `A claim concerning ${WORDS[7]} in the`));

    await expect(generateLabels({ tree, blocks: distinct, slug: "test" })).rejects.toThrow(
      /match the paragraph after it/,
    );
  });

  it("checks for a shift even when the re-ask failed for some other reason", async () => {
    /* The same hole by the other door, and the one that needs its own test:
       here the re-ask is truncated, so nothing looks at the merged set at all
       and the only thing standing between the reader and 19 displaced labels is
       `acceptGap` checking what it is about to keep. Delete that line and this
       run succeeds. */
    const { tree, blocks } = oneSection(20);
    const distinct = blocks.map((b, i) => ({
      ...b,
      text: `This passage concerns ${WORDS[i]} and nothing else whatsoever.`,
    }));
    wire.answers.push(
      JSON.stringify({
        labels: Array.from({ length: 20 }, (_, i) => i + 1)
          .filter((n) => n !== 7)
          .map((n) => [n, `A claim concerning ${WORDS[n] ?? "afterwards"} at some length`]),
      }),
    );
    wire.answers.push("TRUNCATED");

    await expect(generateLabels({ tree, blocks: distinct, slug: "test" })).rejects.toThrow(
      /match the paragraph after it/,
    );
  });

  it("keeps whatever the re-ask did answer, and drops only the rest", async () => {
    // Two missing, one repaired: the drop is one, which is inside the budget.
    const { tree, blocks } = oneSection(58);
    wire.answers.push(allBut(58, [4, 9]));
    wire.answers.push(answering([9], "A repaired claim about paragraph"));

    const run = await generateLabels({ tree, blocks, slug: "test" });

    expect(run.dropped).toEqual([blocks[3]!.id]);
    expect(run.labels[blocks[8]!.id]).toContain("repaired");
  });
});

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
    /* **One batch, two requests, and `calls` has to say two.** It said one until
       2026-08-31, because it was the length of the record list. `calls` is what
       the cache figures are read against — zero reads is expected on a run of
       one request and a bug on a run of two — so a repaired batch reporting one
       call made a dead cache indistinguishable from nothing to read. */
    expect(run.batches).toBe(1);
    expect(run.calls).toBe(2);
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
    /* And the truncated attempt is still on the bill. It was paid for, and the
       ledger (src/ai-spend.ts) records it at the wire — a record holding only
       the re-draw would have `labels.json` and the ledger disagreeing about the
       most expensive step in the pipeline, quietly, on exactly the runs where
       somebody is looking. */
    expect(run.calls).toBe(2);
    expect(run.file.batches?.[0]?.requests).toBe(2);
    expect(run.inputTokens).toBe(2000);
    expect(run.outputTokens).toBe(1000);
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

  it("gives a fifty-block batch one label of slack and no more", async () => {
    /* 2% of fifty is exactly one, so this is the budget at its tightest: one
       dropped label accepted, two refused.
       **Fifty rather than twelve, and the twelve was the point of the old
       version of this test.** Partial acceptance now also requires the shift
       check to have had enough labels to vote with — see the test below — and a
       batch of twelve minus a drop is eleven, one under `MIN_SHIFT_EVIDENCE`.
       The budget and the evidence rule are two separate refusals, and this test
       is about the budget, so it uses a batch where the other one is satisfied. */
    const { tree, blocks } = oneSection(50);
    wire.answers.push(allBut(50, [7]));
    wire.answers.push(JSON.stringify({ labels: [] }));
    const run = await generateLabels({ tree, blocks, slug: "test" });
    expect(run.dropped).toEqual([blocks[6]!.id]);

    wire.calls.length = 0;
    wire.answers.length = 0;
    wire.answers.push(allBut(50, [7, 8]));
    wire.answers.push(JSON.stringify({ labels: [] }));
    await expect(generateLabels({ tree, blocks, slug: "test" })).rejects.toThrow(
      /missing paragraphs 7, 8/,
    );
  });

  it("refuses a gap it could not shift-check, however small the gap", async () => {
    /**
     * **The guard we promise on this path is `detectShift`, and on a small batch
     * it cannot run at all.**
     *
     * `MIN_SHIFT_EVIDENCE` is 12, so a batch of twelve with one label missing
     * offers eleven votes and `detectShift` abstains — the honest answer for an
     * article it cannot read, and a silent pass here. `planBatches` has no
     * minimum batch size (a short final batch is left short), so this is not a
     * hypothetical shape.
     *
     * The choice is between publishing a set nothing checked and failing the
     * ingest loudly. Loudly: a displaced set of labels renders as confident
     * prose about the wrong paragraphs, and nothing downstream can see it.
     */
    const { tree, blocks } = oneSection(12);
    wire.answers.push(allBut(12, [7]));
    wire.answers.push(JSON.stringify({ labels: [] }));

    await expect(generateLabels({ tree, blocks, slug: "test" })).rejects.toThrow(
      /could not be checked for a displacement/,
    );
  });

  it("labels a heading from its own text rather than spending the drop budget on it", async () => {
    /**
     * A heading's label is the heading, copied — `onto` already reads it off the
     * block rather than trusting the model with it. So a heading whose ordinal
     * never came back is not an unlabellable paragraph; it is a label we already
     * hold. Dropping it would leave a bare row in the outline for a block whose
     * text is sitting right there, and would spend the batch's one-label budget
     * on it into the bargain.
     */
    const { tree, blocks } = oneSection(20);
    const withHeading = blocks.map((b, i) =>
      i === 6 ? { ...b, tag: "h2", text: "What The Section Is Called" } : b,
    );
    wire.answers.push(allBut(20, [7]));
    wire.answers.push(JSON.stringify({ labels: [] }));

    const run = await generateLabels({ tree, blocks: withHeading, slug: "test" });

    expect(run.dropped).toEqual([]);
    expect(run.labels[blocks[6]!.id]).toBe("What The Section Is Called");
    expect(Object.keys(run.labels).length).toBe(20);
  });

  it("refuses when the drops together fall through the article's own floor", async () => {
    /**
     * **The backstop, on the path that did not have one.**
     *
     * `droppedBudget` is per batch and cannot see the article, so the floor of
     * one is spendable once per batch however small the batches are. Nineteen
     * paragraphs losing one is 94.7% covered, under `COVERAGE_FLOOR` — and
     * `generateToc` would have refused it while `npm run labels -- <dir>` merged
     * and wrote `tree.json` regardless, because the only check was in the
     * caller. Both paths run `assertEveryBlockLabelled`, so that is where it
     * goes. GPT Sol's review of stage 1b, finding 4.
     *
     * Nineteen is the boundary rather than a round number: twenty would come out
     * at exactly 0.95 and be allowed.
     */
    const { tree, blocks } = oneSection(19);
    wire.answers.push(allBut(19, [7]));
    wire.answers.push(JSON.stringify({ labels: [] }));

    await expect(generateLabels({ tree, blocks, slug: "test" })).rejects.toThrow(
      /were dropped by the batches that asked for them/,
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

  it("checks the merged set for a shift before it accepts a gap", async () => {
    /* The same hole by the other door, and the one that needs its own test:
       both calls come back short, so nothing upstream ever looks at the merged
       set and the only thing standing between the reader and 19 displaced
       labels is `acceptGap` checking what it is about to keep. Delete that line
       and this run succeeds.

       Two missing, one repaired, so the surviving gap is one — inside the
       budget for a batch of twenty, which is what gets the run as far as the
       check. */
    const { tree, blocks } = oneSection(20);
    const distinct = blocks.map((b, i) => ({
      ...b,
      text: `This passage concerns ${WORDS[i]} and nothing else whatsoever.`,
    }));
    const displaced = (n: number): string =>
      `A claim concerning ${WORDS[n] ?? "afterwards"} at some length`;
    wire.answers.push(
      JSON.stringify({
        labels: Array.from({ length: 20 }, (_, i) => i + 1)
          .filter((n) => n !== 7 && n !== 12)
          .map((n) => [n, displaced(n)]),
      }),
    );
    // Answers one of the two it was asked for: a shortfall in its own right.
    wire.answers.push(JSON.stringify({ labels: [[7, displaced(7)]] }));

    await expect(generateLabels({ tree, blocks: distinct, slug: "test" })).rejects.toThrow(
      /match the paragraph after it/,
    );
  });

  it("refuses the gap when the second attempt was not itself a shortfall", async () => {
    /**
     * **"The model omitted this twice" is the whole warrant for accepting a
     * gap, and one omission followed by no usable answer is not that.**
     *
     * A truncation, a refusal, a 429 or a malformed shape leaves no partial
     * answer and no statement about which paragraphs the model would not write
     * — so there is nothing saying the missing one is unlabellable rather than
     * lost to a transient. Accepting on the strength of the *first* error alone
     * turns "we asked twice and it declined twice" into "we asked twice and the
     * second ask fell over", which is a different fact with a different answer:
     * fail, and let the queue retry the batch.
     *
     * This test asserted the opposite until 2026-08-30. GPT Sol's review of
     * stage 1b, finding 2.
     */
    const { tree, blocks } = oneSection(20);
    wire.answers.push(allBut(20, [7]));
    wire.answers.push("TRUNCATED");

    const message = await generateLabels({ tree, blocks, slug: "test" }).then(
      () => "it did not throw at all",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    expect(message).toMatch(/failed twice/);
    // And it says which of the several refusals this was.
    expect(message).toMatch(/did not come back short/);
  });

  it("does not turn a shift the repair found back into an accepted gap", async () => {
    /**
     * **The P0 this file was reopened for, and it is the shape of the guard that
     * was deleted for being unredenable.**
     *
     * `repairShortfall` merges the two answers and shift-checks the merged set,
     * which is the right set to check. But the `BatchIncomplete` it throws
     * carries no `shortfall`, so before this test the outer catch handed it to
     * `acceptGap` — which threw the repaired labels away, fell back to the
     * *first* call's partial set, and shift-checked that instead.
     *
     * `MIN_SHIFT_EVIDENCE` is 12, and the two sets are one label apart, so
     * "merged detects, partial abstains" needs the merged set to land on exactly
     * 12 votes. Thirteen blocks does it: labels 1–12 each match the paragraph
     * after them, label 13 names a word no block contains and so casts no vote.
     * Drop one of the twelve and the evidence is 11, one under the threshold,
     * and the check that just fired goes silent. The run then publishes twelve
     * displaced labels and calls the thirteenth a drop.
     */
    const { tree, blocks } = oneSection(13);
    const distinct = blocks.map((b, i) => ({
      ...b,
      text: `This passage concerns ${WORDS[i]} and nothing else whatsoever.`,
    }));
    /* Every label describes the block after its own — a real ±1 displacement.
       `WORDS[13]` is in no block of a 13-block batch, so ordinal 13 is the one
       label with no lexical signal either way. */
    const displaced = (n: number): string =>
      `A claim concerning ${WORDS[n] ?? "afterwards"} at some length`;

    wire.answers.push(
      JSON.stringify({
        labels: Array.from({ length: 13 }, (_, i) => i + 1)
          .filter((n) => n !== 7)
          .map((n) => [n, displaced(n)]),
      }),
    );
    // The re-ask succeeds, so the merged set is complete — and displaced.
    wire.answers.push(JSON.stringify({ labels: [[7, displaced(7)]] }));

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

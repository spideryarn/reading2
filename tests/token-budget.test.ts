/**
 * The `max_tokens` arithmetic — src/token-budget.ts and stage 4's estimator.
 *
 * This file exists because of a bug that shipped: stage 4 passed a typed-in
 * `max_tokens: 32000`, met a 360-block article, and failed after six minutes
 * with a message telling the reader to raise a number they cannot see. Nothing
 * in the suite could have caught it, because nothing tested the one thing that
 * was wrong — that the number did not depend on the article. See
 * docs/postmortems/260826a-toc-max-tokens.md.
 *
 * So the tests below are not really about arithmetic. They are about the two
 * ways this can be wrong again: an estimate that is under what real trees cost,
 * and a budget that quietly exceeds what the model will accept.
 *
 * Deterministic — no network, no model. docs/project/testing.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { estimateHierarchyTokens, STRUCTURE_HEADROOM } from "../src/hierarchy.js";
import {
  budgetFor,
  MODEL_MAX_TOKENS,
  THINKING_HEADROOM,
  TooLongForOnePass,
  truncatedMessage,
} from "../src/token-budget.js";
import type { Block, Tree } from "../src/types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

function read<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as T;
}

/** N plain text blocks, `gistable` unless said otherwise. */
function blocks(count: number, gistable = true): Block[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `spya-${String(i).padStart(6, "0")}`,
    tag: "p",
    kind: "text" as const,
    text: "Some prose.",
    words: 2,
    html: "<p>Some prose.</p>",
    gistable,
  }));
}

/**
 * The same, with a heading every `every` blocks — the shape the estimator is
 * adversarial against, since a heading is a hard boundary in the prompt and so
 * forces a node the long-run rule would not have asked for.
 */
function withHeadings(count: number, every: number): Block[] {
  return blocks(count).map((b, i) =>
    i % every === 0
      ? { ...b, tag: "h2", kind: "heading" as const, level: 2, text: "A heading" }
      : b,
  );
}

describe("budgetFor", () => {
  it("is the answer plus room to think, never the answer alone", () => {
    expect(budgetFor("hierarchy", 1_000)).toBe(1_000 + THINKING_HEADROOM);
  });

  it("keeps the whole headroom even when the answer is tiny", () => {
    // The bug was thinking of max_tokens as an output cap. A 40-token answer
    // still needs the reasoning allowance, because the model reads the whole
    // article to write it either way.
    expect(budgetFor("arc", 40)).toBeGreaterThan(THINKING_HEADROOM);
  });

  it("refuses up front rather than returning a budget the model would truncate", () => {
    // Clamping to the ceiling here is the tempting wrong answer: the call would
    // run for minutes, cost money, and come back cut off — the original bug,
    // reached more slowly.
    expect(() => budgetFor("hierarchy", MODEL_MAX_TOKENS)).toThrow(TooLongForOnePass);
  });

  it("never returns more than one response can hold", () => {
    for (const answer of [0, 1_000, 50_000, MODEL_MAX_TOKENS - THINKING_HEADROOM]) {
      expect(budgetFor("hierarchy", answer)).toBeLessThanOrEqual(MODEL_MAX_TOKENS);
    }
  });

  it("names the stage and the size in what it throws, so the reader learns why", () => {
    try {
      budgetFor("table of contents", 200_000);
      expect.unreachable("should have refused");
    } catch (err) {
      expect(err).toBeInstanceOf(TooLongForOnePass);
      expect((err as Error).message).toContain("table of contents");
      expect((err as Error).message).toContain("200,000");
    }
  });

  it("rejects a nonsense estimate instead of passing NaN to the API", () => {
    // `max_tokens: NaN` is a 400 from the API and a confusing one; a negative
    // estimate would silently shrink the budget below the headroom.
    expect(() => budgetFor("hierarchy", Number.NaN)).toThrow(/non-negative/);
    expect(() => budgetFor("hierarchy", -1)).toThrow(/non-negative/);
    expect(() => budgetFor("hierarchy", 100, Number.NaN)).toThrow(/non-negative/);
    expect(() => budgetFor("hierarchy", 100, -1)).toThrow(/non-negative/);
  });

  it("takes a smaller reservation from a call that reads less than the whole article", () => {
    // 40,000 was measured on a call that read a whole article and thought about
    // its structure. A label batch reads one section. Inheriting the big number
    // onto every small call would cost no money — max_tokens is a ceiling — but
    // it would hide a batch that had started thinking far more than it should,
    // which is the failure that took two six-minute runs to find last time.
    expect(budgetFor("nav labels", 4_400, 16_000)).toBe(20_400);
    expect(budgetFor("nav labels", 4_400, 16_000)).toBeLessThan(budgetFor("nav labels", 4_400));
  });
});

describe("truncatedMessage", () => {
  /** What the second failed run actually spent: 77,100 budget, 40k chars of JSON. */
  const secondRun = { outputTokens: 77_100, answerChars: 40_000 };

  it("says a retry will not help, because the Retry button is right there", () => {
    const message = truncatedMessage("table of contents", 77_100, 37_100, secondRun);
    expect(message).toMatch(/retry/i);
    // The old message said "Raise it and retry", which is an instruction to a
    // programmer printed for a reader, and following it did nothing.
    expect(message).not.toMatch(/raise it and retry/i);
  });

  it("does not claim a certainty it has not got", () => {
    // It used to end "Retrying will fail the same way until it does", which is
    // a proof rather than a reading of the evidence. Unlike `TooLongForOnePass`
    // this is NOT arithmetic — adaptive output varies between calls, and two
    // observations on one article is evidence, not a law. Raised by GPT Sol.
    const message = truncatedMessage("table of contents", 77_100, 37_100, secondRun);
    expect(message).not.toMatch(/will fail the same way/i);
    expect(message).toMatch(/unlikely/i);
  });

  it("splits the spend, because which half overran is the whole question", () => {
    // Working this out by hand from a progress line is what cost the first fix
    // a second six-minute run. 40,000 characters is ~13,300 tokens of answer,
    // so ~63,800 of the 77,100 went on thinking — and no headroom constant was
    // ever going to survive that. The message has to say so.
    const message = truncatedMessage("table of contents", 77_100, 37_100, secondRun);
    expect(message).toContain("13,333");
    expect(message).toContain("63,767");
  });

  it("carries the budget and the estimate, so the constants can be re-tuned", () => {
    const message = truncatedMessage("arc", 44_720, 4_720, { outputTokens: 44_720, answerChars: 0 });
    expect(message).toContain("44,720");
    expect(message).toContain("4,720");
  });

  it("never reports negative thinking when the answer estimate overshoots", () => {
    // answerChars/3 is an approximation and can exceed output_tokens on prose
    // that tokenizes well. "-2,000 tokens of reasoning" would read as a bug in
    // the reporting, which is exactly when nobody trusts the rest of the line.
    const message = truncatedMessage("arc", 44_720, 4_720, {
      outputTokens: 100,
      answerChars: 90_000,
    });
    expect(message).toContain("0 of reasoning");
  });
});

describe("estimateHierarchyTokens", () => {
  it("grows with the article — the whole point", () => {
    // A fixed number was the bug. Anything that stops this growing brings it back.
    //
    // **The span is 800 to 4,000 rather than 40 to 400, and that is the change
    // of 2026-09-04 rather than a weakening.** The estimate now starts at the
    // tree the prompt asks for on any article at all — three levels, nine
    // children a node — so every article short enough to fit that shape gets
    // the same floor, and comparing two of them proves nothing either way. What
    // must still be true is that a longer article costs more, and it is the
    // article's own headings and long runs that make it cost more.
    expect(estimateHierarchyTokens(blocks(4_000))).toBeGreaterThan(
      estimateHierarchyTokens(blocks(800)) * 2,
    );
    expect(estimateHierarchyTokens(withHeadings(2_000, 4))).toBeGreaterThan(
      estimateHierarchyTokens(withHeadings(2_000, 40)),
    );
  });

  it("no longer cares which blocks are gistable, because it no longer pays for labels", () => {
    // This test used to assert the opposite: a non-gistable block cost less,
    // because it got no navLabel. The labels moved to src/labels.ts, and what is
    // left is the tree — which tiles every block regardless. If this ever starts
    // differing again, a label estimate has crept back into the structure call.
    expect(estimateHierarchyTokens(blocks(100, false))).toBe(estimateHierarchyTokens(blocks(100)));
  });

  /**
   * The regression that matters, measured against a real tree rather than
   * against the estimator's own arithmetic.
   *
   * `example/tree.json` is committed, and the JSON the structure call emits to
   * produce it is recoverable: the internal nodes, and now **only** those — the
   * navLabels this used to include are a separate stage's answer, and counting
   * them here would keep the old ceiling alive in the one place that would not
   * announce itself. 2.5 characters per token is the measured cost of JSON full
   * of random block ids, rounded against us — and it is measured: the live Kuhn
   * call of 2026-09-04 emitted 27,460 characters for 10,996 answer tokens,
   * 2.497 apiece. Computed from the fixture, so it moves if the fixture does.
   *
   * **Serialised compact, and that is a correction.** This built the payload
   * with `JSON.stringify(…, null, 1)`, which is not what a model emits: the
   * indentation inflated the "actual" it compares against by 1.16–1.28×, so the
   * margin it was proving was up to a quarter smaller than it read. Measured
   * 2026-09-04, docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md.
   *
   * **And it is a weak test now, said out loud rather than left to be
   * discovered.** The fixture is 34 blocks, so it sits well inside the floor the
   * estimator gives every short article, and the margin it measures is 9.13× —
   * this cannot go red for any plausible change to the growth term. It is kept
   * because it is the only assertion anywhere made against a *real* tree's real
   * bytes, and it would still catch the per-node constant or the envelope being
   * cut. The test that binds is the Kuhn one below.
   */
  it("clears what a real tree's structure actually cost, with margin", () => {
    const tree = read<Tree>("example/tree.json");
    const { blocks: fixtureBlocks } = read<{ blocks: Block[] }>("example/blocks.json");

    const payload = JSON.stringify(
      Object.values(tree.nodes)
        .filter((n) => n.children.length > 0)
        .map((n) => ({
          title: n.title,
          gist: n.gist,
          range: n.range,
          sourceHeading: n.sourceHeading,
        })),
    );
    const actualTokens = payload.length / 2.5;

    expect(estimateHierarchyTokens(fixtureBlocks)).toBeGreaterThan(actualTokens * 1.25);
  });

  it("gives the article that broke it a budget the model will accept", () => {
    // 360 blocks, every one gistable — https://www.anthropic.com/constitution,
    // the article that found this bug. It must fit, and it must fit with the
    // reasoning allowance included.
    expect(budgetFor("hierarchy", estimateHierarchyTokens(blocks(360)), STRUCTURE_HEADROOM)).toBeLessThan(
      MODEL_MAX_TOKENS,
    );
  });

  it("refuses an article too long to describe in one response", () => {
    // Not a number worth pinning — what matters is that some length is refused
    // out loud, before the call, instead of producing half a table of contents.
    expect(() => budgetFor("hierarchy", estimateHierarchyTokens(blocks(5_000)), STRUCTURE_HEADROOM)).toThrow(
      TooLongForOnePass,
    );
  });

  /**
   * **The one measured article, in the shape that is hardest for the estimator.**
   *
   * This used to pin the boundary at exactly 1,976 blocks, on the argument that
   * the boundary *is* the feature. The boundary was a number nobody had
   * measured: on 2026-09-04 a 142-page journal paper — Kuhn's *A Landscape of
   * Consciousness*, 2,025 blocks with 254 authored headings — was refused by
   * that arithmetic at an estimated 90,275 tokens, and then a real structure
   * call with `max_tokens` forced to 128,000 answered it in **10,996**, valid,
   * tiling every block. The estimate was 8.21× the answer. See
   * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md.
   *
   * So what is pinned here is the thing that actually matters: **a document a
   * real call has proved fits must not be refused**, and it must be sized with
   * margin over what that call really cost. A heading every eight blocks is the
   * adversarial half — headings are hard boundaries in the prompt, so they force
   * nodes the long-run rule alone would never ask for, and they are what a
   * scanned journal paper is full of.
   *
   * Deliberately **not** an asymptotic claim. 32 trees over ~20 articles cannot
   * show that the answer is bounded above, the runtime enforces neither the
   * depth nor the fan-out the prompt asks for, and GPT Sol returned DO-NOT-SHIP
   * on a draft of this plan that assumed otherwise.
   */
  it("admits the 142-page paper a real structure call proved fits", () => {
    const kuhn = withHeadings(2_025, 8);
    /* What the live call's own `usage` reported: 58,285 output tokens, of which
       47,289 were thinking. Not derived from anything in this repo. */
    const MEASURED_ANSWER = 10_996;

    const estimate = estimateHierarchyTokens(kuhn);
    expect(estimate).toBeGreaterThan(MEASURED_ANSWER * 1.25);
    expect(() => budgetFor("hierarchy", estimate, STRUCTURE_HEADROOM)).not.toThrow();
    /* And with room to spare rather than at the margin: an article somewhat
       longer than this one has to be admitted too, or the fix is a fix for one
       document. */
    expect(budgetFor("hierarchy", estimate, STRUCTURE_HEADROOM)).toBeLessThan(120_000);
  });

  it("leaves that call more room to think than it measurably used", () => {
    /* The trap stage 1 found and stage 4 would otherwise have walked into.
       Correcting the answer term alone would have granted Kuhn's call about
       51,000 tokens — under the 47,289 of thinking plus 10,996 of answer it
       provably spent — so the free refusal would have become an eight-minute
       paid truncation. The reservation is the other half of the fix. */
    const budget = budgetFor("hierarchy", estimateHierarchyTokens(withHeadings(2_025, 8)), STRUCTURE_HEADROOM);
    expect(budget).toBeGreaterThan(47_289 + 10_996);
    expect(STRUCTURE_HEADROOM).toBeGreaterThan(47_289);
  });

  /**
   * **The shape where the estimate is knowingly below the prompt's own
   * arithmetic**, pinned so that it is a decision on the record rather than a
   * gap somebody finds later.
   *
   * A heading every eleven blocks is the overlap the estimator resolves with a
   * `max` instead of a sum: each heading opens a section AND the ten-block run
   * after it is over the prompt's ~9 threshold, so the faithful reading wants
   * two sections per heading — 440 of them here, about 87,300 tokens. The
   * estimate says 53,700, and the reason is in `sectionsAsked`: summing refuses
   * this document outright (`blocked`, no Retry) for a tree that 32 real trees
   * say the model answers in five figures. 254 authored headings produced 83
   * nodes and 59 dropped headings on the one long document anybody has measured.
   *
   * ⟨GPT Sol constructed this case reviewing the code, 2026-09-04, and it is the
   * strongest argument against the choice made here.⟩ **What would falsify the
   * choice**: a real structure answer larger than this estimate. The lever then
   * is the sum, and the reservation or the per-node constant has to move with it.
   */
  it("admits the heading-dense handbook, and is under the prompt's own count for it", () => {
    const handbook = withHeadings(2_420, 11);
    const estimate = estimateHierarchyTokens(handbook);
    expect(() => budgetFor("hierarchy", estimate, STRUCTURE_HEADROOM)).not.toThrow();

    /* The faithful count, spelled out rather than asserted about vaguely: 220
       headings, each opening a section, each followed by a run of ten that the
       long-run rule splits once more. */
    const faithfulNodes = 440 + 49 + 6 + 1;
    expect(estimate).toBeLessThan(500 + faithfulNodes * 175);
  });

  it("no longer charges a node for every few paragraphs", () => {
    /* The shape of the old term, `ceil(N/4) + 6` nodes, restated so that its
       return is a failure rather than a slightly worse ceiling. It is the term
       that refused the paper above; anything charging per paragraph again lands
       back over it. */
    const perBlock = 500 + (Math.ceil(2_025 / 4) + 6) * 175;
    expect(estimateHierarchyTokens(withHeadings(2_025, 8))).toBeLessThan(perBlock * 0.7);
  });
});

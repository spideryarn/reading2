/**
 * The `max_tokens` arithmetic — src/token-budget.ts and stage 4's estimator.
 *
 * This file exists because of a bug that shipped: stage 4 passed a typed-in
 * `max_tokens: 32000`, met a 360-block article, and failed after six minutes
 * with a message telling the reader to raise a number they cannot see. Nothing
 * in the suite could have caught it, because nothing tested the one thing that
 * was wrong — that the number did not depend on the article. See
 * docs/postmortems/toc-max-tokens.md.
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
import { estimateTocTokens } from "../src/toc.js";
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

describe("budgetFor", () => {
  it("is the answer plus room to think, never the answer alone", () => {
    expect(budgetFor("toc", 1_000)).toBe(1_000 + THINKING_HEADROOM);
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
    expect(() => budgetFor("toc", MODEL_MAX_TOKENS)).toThrow(TooLongForOnePass);
  });

  it("never returns more than one response can hold", () => {
    for (const answer of [0, 1_000, 50_000, MODEL_MAX_TOKENS - THINKING_HEADROOM]) {
      expect(budgetFor("toc", answer)).toBeLessThanOrEqual(MODEL_MAX_TOKENS);
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
    expect(() => budgetFor("toc", Number.NaN)).toThrow(/non-negative/);
    expect(() => budgetFor("toc", -1)).toThrow(/non-negative/);
    expect(() => budgetFor("toc", 100, Number.NaN)).toThrow(/non-negative/);
    expect(() => budgetFor("toc", 100, -1)).toThrow(/non-negative/);
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

describe("estimateTocTokens", () => {
  it("grows with the article — the whole point", () => {
    // A fixed number was the bug. Anything that stops this growing brings it back.
    expect(estimateTocTokens(blocks(400))).toBeGreaterThan(estimateTocTokens(blocks(40)) * 5);
  });

  it("no longer cares which blocks are gistable, because it no longer pays for labels", () => {
    // This test used to assert the opposite: a non-gistable block cost less,
    // because it got no navLabel. The labels moved to src/labels.ts, and what is
    // left is the tree — which tiles every block regardless. If this ever starts
    // differing again, a label estimate has crept back into the structure call.
    expect(estimateTocTokens(blocks(100, false))).toBe(estimateTocTokens(blocks(100)));
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
   * of random block ids, rounded against us. Computed from the fixture, so it
   * moves if the fixture does.
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
      null,
      1,
    );
    const actualTokens = payload.length / 2.5;

    expect(estimateTocTokens(fixtureBlocks)).toBeGreaterThan(actualTokens * 1.25);
  });

  it("gives the article that broke it a budget the model will accept", () => {
    // 360 blocks, every one gistable — https://www.anthropic.com/constitution,
    // the article that found this bug. It must fit, and it must fit with the
    // reasoning allowance included.
    expect(budgetFor("toc", estimateTocTokens(blocks(360)))).toBeLessThan(MODEL_MAX_TOKENS);
  });

  it("refuses an article too long to describe in one response", () => {
    // Not a number worth pinning — what matters is that some length is refused
    // out loud, before the call, instead of producing half a table of contents.
    expect(() => budgetFor("toc", estimateTocTokens(blocks(5_000)))).toThrow(TooLongForOnePass);
  });

  it("fits a book, which is the point of taking the labels out", () => {
    // The whole justification for the split. Before it, the estimate charged for
    // a label per block and refused anything past 876 blocks — about 55,000
    // words. The structure call alone takes 1,976, which at the 62.5 words a
    // block that our three real articles average is roughly 123,500 words: a
    // full-length nonfiction book, in one call.
    //
    // Pinned exactly, because this boundary IS the feature. If it drops, the
    // structure call has grown a term that scales with paragraphs again — which
    // is the bug this whole change exists to remove, and it would come back
    // silently as a slightly worse ceiling rather than as a failure.
    expect(() => budgetFor("toc", estimateTocTokens(blocks(1_976)))).not.toThrow();
    expect(() => budgetFor("toc", estimateTocTokens(blocks(1_977)))).toThrow(TooLongForOnePass);
  });
});

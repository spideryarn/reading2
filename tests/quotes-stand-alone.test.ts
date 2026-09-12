/**
 * Quotes long enough to stand on their own — `quotes/6`, 2026-09-12.
 *
 * Greg, SPIDERYARN-READING2-3C: a quote that "only has real meaning in the
 * context of the wider block that it's part of" is too short, and one "could
 * almost be an entire block if the whole block is really, really good".
 *
 * Until then `MAX_QUOTE_CHARS` was 400 and the prompt told the model a longer
 * one "is the paragraph", so three paragraphs in four of the article he was
 * reading could not be quoted whole under any prompt. What is pinned here is the
 * three things that have to move together for that to stop being true: the
 * ceiling `place` enforces, the ceiling the prompt states, and the token
 * allowance a pass of long quotes needs — undersize that and the reader loses
 * the whole pass to `truncationFailure`.
 *
 * docs/plans/260912e-quotes-long-enough-to-stand-on-their-own.md.
 */
import { describe, expect, it } from "vitest";
import {
  answerTokensFor,
  MAX_QUOTE_CHARS,
  MAX_QUOTES,
  MIN_QUOTE_CHARS,
  noneDropped,
  place,
  SYSTEM,
} from "../src/quotes.js";
import { budgetFor } from "../src/token-budget.js";
import type { Block } from "../src/types.js";

/** The opening paragraph of the article the report came from (Entropy 24,
    00930), verbatim — 657 characters, of which the `quotes/5` baseline kept
    the first 89: the set-up, and none of the rest. */
const PARAGRAPH =
  "A grand challenge of modern neuroscience is to discover how brains “process information”. " +
  "Though there is debate regarding what information processing means precisely, it is clear that " +
  "brains take in sensory signals from the environment and use that information to generate adaptive " +
  "behavior informed by their surroundings. The ways that sensory information is modified and " +
  "transformed are poorly understood. It is known, however, that such processes are distributed over " +
  "integrative interactions in neural circuits throughout the brain and involve large numbers of " +
  "interacting neurons. We refer to this collective activity as neural information processing.";

function block(id: string, text: string): Block {
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html: `<p>${text}</p>`, gistable: true };
}

describe("a quote may be the whole paragraph", () => {
  it("keeps a whole paragraph well past the old 400-character ceiling", () => {
    expect(PARAGRAPH.length).toBe(657);
    const dropped = noneDropped();
    const got = place([{ text: PARAGRAPH, importance: 0.9 }], [block("spya-sa1one", PARAGRAPH)], dropped);
    expect(dropped.wrongLength).toBe(0);
    expect(got).toHaveLength(1);
    expect(got[0]?.text).toBe(PARAGRAPH);
  });

  it("still drops one character over the ceiling rather than truncating it", () => {
    const long = "word ".repeat(Math.ceil(MAX_QUOTE_CHARS / 5) + 1).slice(0, MAX_QUOTE_CHARS + 1);
    expect(long).toHaveLength(MAX_QUOTE_CHARS + 1);
    const dropped = noneDropped();
    expect(place([{ text: long }], [block("spya-sa1two", long)], dropped)).toHaveLength(0);
    expect(dropped.wrongLength).toBe(1);
  });
});

describe("the prompt and `place` state one rule", () => {
  it("quotes the constants, so the two cannot drift apart again", () => {
    expect(SYSTEM).toContain(`under ${MIN_QUOTE_CHARS} characters`);
    expect(SYSTEM).toContain(`over ${MAX_QUOTE_CHARS}`);
    /* The old line, which told the model a longer quote "is the paragraph". */
    expect(SYSTEM).not.toMatch(/above it\s+it is the paragraph/);
  });

  it("makes standing alone the test, and says when a whole paragraph is right", () => {
    expect(SYSTEM).toMatch(/STAND ALONE/);
    expect(SYSTEM).toMatch(/whole paragraph/i);
  });
});

describe("the answer's token allowance", () => {
  it("fits a full pass of maximum-length quotes, at one token a character", () => {
    /* The bound is stated here, not read back from src/quotes.ts, so a later
       edit that makes the allowance optimistic again — the first draft assumed
       three characters a token — goes red instead of agreeing with itself. One
       a character is the pessimistic end for a paper full of maths and symbols
       (GPT Sol, plan review); the 100 is the reason, the scores and the JSON. */
    const perQuote = MAX_QUOTE_CHARS + 100;
    expect(answerTokensFor(MAX_QUOTES)).toBeGreaterThanOrEqual(MAX_QUOTES * perQuote);
    expect(answerTokensFor(1)).toBeGreaterThanOrEqual(perQuote);
  });

  it("stays inside what one call may ask for", () => {
    expect(() => budgetFor("quotes", answerTokensFor(MAX_QUOTES))).not.toThrow();
  });
});

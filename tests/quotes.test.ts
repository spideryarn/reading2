/**
 * The deterministic half of stage 5h — src/quotes.ts.
 *
 * Nothing here calls a model. What is pinned is the **verification**, because
 * this is the one stage whose failure is a false claim about what a real person
 * wrote rather than a poor judgment about their argument.
 *
 * Three of these tests were red against real code before they were green, and
 * all three came out of GPT Sol's review of the plan on 2026-08-31:
 *
 *  - `findQuote`'s second pass deletes whitespace, so it accepted `fall a part`
 *    against an article saying `fall apart` — and the first version of this
 *    stage stored **the model's string**, which is a sentence the author did not
 *    write, in quotation marks, beside the real text.
 *  - a `blockquote` is a body block, so Ginsberg's *Howl* in the middle of
 *    *Meditations on Moloch* verified perfectly and would have been offered as
 *    the article author's line.
 *  - the same for a sentence wholly inside quotation marks in an ordinary
 *    paragraph.
 *
 * See docs/plans/260831j-quotes-mode.md § The one safety property, and its review.
 */
import { describe, expect, it } from "vitest";
import {
  buildQuotes,
  dedupeOverlaps,
  type Dropped,
  idsByText,
  inDocumentOrder,
  inputFingerprint,
  isStale,
  locate,
  MAX_QUOTES,
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  noneDropped,
  noQuoteScoreDrops,
  normaliseQuote,
  place,
  PROMPT_VERSION,
  renderPrompt,
  suggestedQuotes,
} from "../src/quotes.js";
import { CAPABLE_MODEL } from "../src/models.js";
import type { Block, BlockKind, Quotes, Tree, TreeNode } from "../src/types.js";

function block(id: string, text: string, kind: BlockKind = "text"): Block {
  return {
    id,
    tag: kind === "quote" ? "blockquote" : "p",
    kind,
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

/** Long enough to clear `MIN_QUOTE_CHARS`, so a test is about what it says it is. */
const FIRST = "Writing is thinking, and there is no other kind of thinking.";
const SECOND = "The mathematical marriage of convenience starts to fall apart here.";
const THIRD = "Most people never had to write anything at all, and now they must.";

const BLOCKS: Block[] = [
  block("spya-aaaaaa", FIRST),
  block("spya-bbbbbb", SECOND),
  block("spya-cccccc", THIRD),
];

function node(over: Partial<TreeNode> & { id: string }): TreeNode {
  return {
    depth: 1,
    parent: "n0",
    children: [],
    range: ["spya-aaaaaa", "spya-cccccc"],
    title: "",
    ...over,
  } as TreeNode;
}

const TREE: Tree = {
  slug: "writes",
  generatedAt: "2026-08-31T00:00:00.000Z",
  rootId: "n0",
  nodes: {
    n0: node({ id: "n0", depth: 0, parent: null, title: "A piece", children: ["n1"] }),
    n1: node({ id: "n1", title: "Part one", gist: "Writing is thinking." }),
  },
} as unknown as Tree;

function drops(over: Partial<Dropped> = {}): Dropped {
  return { ...noneDropped(), ...over };
}

describe("suggestedQuotes", () => {
  it("clamps at both ends and scales in between", () => {
    expect(suggestedQuotes(0)).toBe(4);
    expect(suggestedQuotes(600)).toBe(4);
    expect(suggestedQuotes(4800)).toBe(8);
    expect(suggestedQuotes(200_000)).toBe(MAX_QUOTES);
  });
});

describe("locate", () => {
  it("finds the block for itself — the model never names one", () => {
    const found = locate(SECOND, BLOCKS);
    expect(found.kind).toBe("found");
    expect(found.kind === "found" && found.at.blockId).toBe("spya-bbbbbb");
  });

  it("tolerates the retyping a model actually does", () => {
    // Curly quotes straightened, a line break become a space, a run of spaces
    // collapsed. All three are the same sentence.
    const article = block("spya-dddddd", "He called it a “marriage of convenience”, and meant it.");
    const typed = 'He called it a "marriage of\n  convenience", and meant it.';
    expect(locate(typed, [article]).kind).toBe("found");
  });

  /**
   * **The blocker.** `findQuote` runs a second, whitespace-deleting pass, so
   * `fall a part` matches `fall apart`. That pass is right for the browser,
   * where `extractText` invents spaces the rendered text does not have, and
   * wrong as a server-side claim of verbatim identity.
   */
  it("refuses a word the model split in two", () => {
    expect(
      locate("The mathematical marriage of convenience starts to fall a part here.", BLOCKS).kind,
    ).toBe("absent");
  });

  it("tells absent from someone else's voice, because they are opposite facts", () => {
    expect(locate("The author argues that thinking is a kind of writing.", BLOCKS).kind).toBe(
      "absent",
    );
    const said = block("spya-mmmmmm", `Lamport wrote: “${FIRST}”`);
    expect(locate(FIRST, [said]).kind).toBe("otherVoice");
  });

  /**
   * **Walk past a rejected occurrence.** A sentence can appear once inside a
   * pull-quote and again in the author's own prose; stopping at the first match
   * lost the reader a legitimate line and blamed the model for it.
   * GPT Sol, 2026-08-31.
   */
  it("keeps looking after an occurrence it will not take", () => {
    const pulled = block("spya-nnnnnn", FIRST, "quote");
    const prose = block("spya-oooooo", `And so: ${FIRST}`);
    const found = locate(FIRST, [pulled, prose]);
    expect(found.kind).toBe("found");
    expect(found.kind === "found" && found.at.blockId).toBe("spya-oooooo");
  });

  it("keeps looking within one block, not only across blocks", () => {
    const both = block("spya-pppppp", `He said “${FIRST}” And then, plainly: ${FIRST}`);
    const found = locate(FIRST, [both]);
    expect(found.kind).toBe("found");
    // The second occurrence, which is the one not inside quotation marks.
    expect(found.kind === "found" && found.at.span.start).toBeGreaterThan(20);
  });
});

describe("place", () => {
  it("stores the ARTICLE's words, never the model's", () => {
    const dropped = drops();
    // A curly apostrophe where the article has a straight one: `findQuote`
    // folds them to match, and what must be stored is the article's spelling.
    const article = block("spya-eeeeee", "It doesn't survive contact with a reader, ever.");
    const got = place(
      [{ text: "It doesn’t survive contact with a reader, ever." }],
      [article],
      dropped,
    );
    expect(got).toHaveLength(1);
    expect(got[0]?.text).toBe("It doesn't survive contact with a reader, ever.");
  });

  it("drops a quote it cannot find, and counts it", () => {
    const dropped = drops();
    expect(place([{ text: "A line this article never contains anywhere at all." }], BLOCKS, dropped))
      .toHaveLength(0);
    expect(dropped.unfound).toBe(1);
  });

  it("drops a phrase and a whole paragraph, at the two ends", () => {
    const dropped = drops();
    const long = "x".repeat(MAX_QUOTE_CHARS + 1);
    place([{ text: "too short" }, { text: long }], BLOCKS, dropped);
    expect(dropped.wrongLength).toBe(2);
    expect(MIN_QUOTE_CHARS).toBeLessThan(MAX_QUOTE_CHARS);
  });

  it("survives a null in the array rather than losing the batch", () => {
    const dropped = drops();
    const got = place([null, "a bare string", { text: FIRST }], BLOCKS, dropped);
    expect(got).toHaveLength(1);
    expect(dropped.malformed).toBe(2);
  });

  it("keeps a score only when it is a number in range", () => {
    const dropped = drops();
    const got = place(
      [{ text: FIRST, importance: 0.8, striking: "high", reason: "  " }],
      BLOCKS,
      dropped,
    );
    expect(got[0]?.importance).toBe(0.8);
    expect(got[0]?.striking).toBeUndefined();
    expect(got[0]?.reason).toBeUndefined();
  });

  /**
   * **The scores, counted apart: never written, and written wrong.**
   *
   * A missing quote score is by design — the prompt permits it and `priorityOf`
   * takes a `max` over whichever arrived. A *rejected* one is not: if the model
   * started answering `"high"` instead of `0.8`, the panel would quietly stop
   * offering prioritised order and nothing anywhere would say so.
   * docs/reusable/silent-success.md.
   */
  it("counts a score the model left out, apart from one it got wrong", () => {
    const scores = noQuoteScoreDrops();
    const got = place(
      [
        { text: FIRST, importance: 0.8, striking: 0.2 },
        { text: SECOND, importance: 0.4 },
        { text: THIRD, importance: 7, striking: "high" },
      ],
      BLOCKS,
      drops(),
      scores,
    );
    expect(scores.importanceAbsent).toBe(0);
    expect(scores.strikingAbsent).toBe(1);
    expect(scores.importanceRejected).toBe(1);
    expect(scores.strikingRejected).toBe(1);
    // Unchanged from today: all three survive, with exactly the fields they had.
    expect(got).toHaveLength(3);
    expect(got[0]?.importance).toBe(0.8);
    expect(got[1]?.striking).toBeUndefined();
    expect(got[2]?.importance).toBeUndefined();
    expect(got[2]?.striking).toBeUndefined();
  });

  it("counts nothing on a clean run, and nothing for a quote it threw away", () => {
    const dropped = drops();
    const scores = noQuoteScoreDrops();
    place(
      [
        { text: FIRST, importance: 0.8, striking: 0.2 },
        /* Dropped before any score is read, so it has no missing score: a
           quote that never became a row cannot be under-scored. */
        { text: "not in the article at all, and long enough to be looked for" },
      ],
      BLOCKS,
      dropped,
      scores,
    );
    expect(dropped.unfound).toBe(1);
    expect(scores).toEqual(noQuoteScoreDrops());
  });

  /**
   * **The two shapes stay apart.** A score counter is a field the model did not
   * give us; every `Dropped` counter is a quote that is not in the list, and
   * `Quotes.discarded` publishes those to a visitor. Merging them would send a
   * fact about our prompt to a reader and invite somebody to add the two up.
   */
  it("keeps the score counters off the shape that rides the artefact", () => {
    expect(Object.keys(noneDropped()).sort()).toEqual([
      "malformed",
      "otherVoice",
      "overCap",
      "overlapping",
      "unfound",
      "wrongLength",
    ]);
    expect(noQuoteScoreDrops()).toEqual({
      importanceAbsent: 0,
      importanceRejected: 0,
      strikingAbsent: 0,
      strikingRejected: 0,
    });
  });

  it("counts through buildQuotes, and stores nothing about it", () => {
    const scores = noQuoteScoreDrops();
    const built = buildQuotes(
      { quotes: [{ text: FIRST, importance: 0.8 }] },
      {
        slug: "a-slug",
        blocks: BLOCKS,
        sourceHash: "deadbeefdeadbeef",
        elapsedMs: 1,
        dropped: drops(),
        scores,
      },
    );
    expect(scores.strikingAbsent).toBe(1);
    // Unchanged from today: the artefact carries `discarded` and nothing else.
    expect(Object.keys(built.discarded).sort()).toEqual([
      "malformed",
      "otherVoice",
      "overCap",
      "overlapping",
      "unfound",
      "wrongLength",
    ]);
    expect(built.quotes[0]?.importance).toBe(0.8);
    expect(built.quotes[0]?.striking).toBeUndefined();
  });

  /**
   * **The second blocker.** A `blockquote` is a body block, so *Howl* inside
   * *Meditations on Moloch* verifies perfectly — and would be offered as the
   * essay author's line.
   */
  it("refuses a line lifted out of a blockquote", () => {
    const dropped = drops();
    const ginsberg = block(
      "spya-ffffff",
      "What sphinx of cement and aluminum bashed open their skulls and ate up their brains?",
      "quote",
    );
    const got = place(
      [{ text: "What sphinx of cement and aluminum bashed open their skulls and ate up their brains?" }],
      [ginsberg],
      dropped,
    );
    expect(got).toHaveLength(0);
    expect(dropped.otherVoice).toBe(1);
    // And NOT counted as the model paraphrasing, which is a different fact.
    expect(dropped.unfound).toBe(0);
  });

  it("refuses a sentence wholly inside quotation marks", () => {
    const dropped = drops();
    const said = block(
      "spya-gggggg",
      'Lamport put it best: "If you are thinking without writing, you only think you are thinking."',
    );
    const got = place(
      [{ text: "If you are thinking without writing, you only think you are thinking." }],
      [said],
      dropped,
    );
    expect(got).toHaveLength(0);
    expect(dropped.otherVoice).toBe(1);
  });

  /**
   * **The three ways GPT Sol walked round the first version**, 2026-08-31. All
   * three are the same mistake: comparing the single characters either side of
   * the span trusts the model to have drawn the span where a person would.
   */
  it("refuses a quotation whose marks the model included in the span", () => {
    const dropped = drops();
    const said = block("spya-qqqqqq", `Lamport wrote: “${FIRST}”`);
    // The model returns the marks too, so the character before the span is the
    // colon and there is no character after it at all.
    expect(place([{ text: `“${FIRST}”` }], [said], dropped)).toHaveLength(0);
    expect(dropped.otherVoice).toBe(1);
  });

  it("refuses a quotation whose closing mark is one character further out", () => {
    const dropped = drops();
    const said = block("spya-rrrrrr", `Lamport wrote: “${FIRST}”`);
    // The model leaves the full stop behind, so the next character is `.`.
    const withoutStop = FIRST.slice(0, -1);
    expect(place([{ text: withoutStop }], [said], dropped)).toHaveLength(0);
    expect(dropped.otherVoice).toBe(1);
  });

  it("refuses British-style single quotation marks", () => {
    const dropped = drops();
    const said = block("spya-ssssss", `Lamport wrote: ‘${FIRST}’`);
    expect(place([{ text: FIRST }], [said], dropped)).toHaveLength(0);
    expect(dropped.otherVoice).toBe(1);
  });

  it("still keeps a line whose own words contain an apostrophe", () => {
    /* The straight apostrophe is deliberately not a quotation mark here: `'…'`
       around a sentence is ambiguous with a possessive, and dropping the
       author's own emphasised line is worse than keeping a quoted one. */
    const dropped = drops();
    const mine = block("spya-tttttt", "The author's whole case rests on that one distinction.");
    expect(place([{ text: "The author's whole case rests on that one distinction." }], [mine], dropped))
      .toHaveLength(1);
    expect(dropped.otherVoice).toBe(0);
  });

  it("keeps a line that merely contains a quoted phrase", () => {
    const dropped = drops();
    const mixed = block(
      "spya-hhhhhh",
      'The word "attention" is doing a great deal of work in that sentence.',
    );
    const got = place(
      [{ text: 'The word "attention" is doing a great deal of work in that sentence.' }],
      [mixed],
      dropped,
    );
    expect(got).toHaveLength(1);
    expect(dropped.otherVoice).toBe(0);
  });
});

describe("dedupeOverlaps", () => {
  it("keeps the longer of two overlapping spans", () => {
    const dropped = drops();
    const article = [block("spya-iiiiii", FIRST)];
    const placed = place(
      [
        { text: "Writing is thinking, and there is no other kind" },
        { text: FIRST },
      ],
      article,
      dropped,
    );
    const kept = dedupeOverlaps(placed, dropped);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.text).toBe(FIRST);
    expect(dropped.overlapping).toBe(1);
  });

  it("keeps two quotes from different blocks", () => {
    const dropped = drops();
    const placed = place([{ text: FIRST }, { text: THIRD }], BLOCKS, dropped);
    expect(dedupeOverlaps(placed, dropped)).toHaveLength(2);
    expect(dropped.overlapping).toBe(0);
  });
});

describe("buildQuotes", () => {
  const opts = {
    slug: "writes",
    blocks: BLOCKS,
    sourceHash: "hash-1",
    elapsedMs: 10,
  };

  it("stamps the artefact and stores document order", () => {
    const dropped = drops();
    const built = buildQuotes({ quotes: [{ text: THIRD }, { text: FIRST }] }, { ...opts, dropped });
    expect(built.version).toBe(PROMPT_VERSION);
    expect(built.generator).toBe(CAPABLE_MODEL);
    expect(built.profileHash).toBeNull();
    expect(built.quotes.map((q) => q.blockId)).toEqual(["spya-aaaaaa", "spya-cccccc"]);
  });

  it("carries the drop counts onto the artefact, so the panel can say so", () => {
    const dropped = drops();
    const built = buildQuotes(
      { quotes: [{ text: FIRST }, { text: "Words this piece has never contained at all." }] },
      { ...opts, dropped },
    );
    expect(built.discarded.unfound).toBe(1);
  });

  it("throws rather than write an empty list", () => {
    expect(() =>
      buildQuotes({ quotes: [{ text: "Nothing in this article says this, at all." }] }, {
        ...opts,
        dropped: drops(),
      }),
    ).toThrow(/no quotes/i);
  });

  it("inherits an id for the same words, so ?quote= survives a rewrite", () => {
    const dropped = drops();
    const first = buildQuotes({ quotes: [{ text: FIRST }] }, { ...opts, dropped });
    const id = first.quotes[0]?.id;
    const again = buildQuotes({ quotes: [{ text: FIRST }] }, {
      ...opts,
      dropped: drops(),
      inherit: idsByText(first),
    });
    expect(again.quotes[0]?.id).toBe(id);
  });

  it("does not hand one old id to two fresh quotes", () => {
    const article = [block("spya-jjjjjj", FIRST), block("spya-kkkkkk", FIRST)];
    const previous: Quotes = {
      version: PROMPT_VERSION,
      generator: CAPABLE_MODEL,
      slug: "writes",
      sourceHash: "hash-1",
      quotes: [{ id: "spya-oldold", blockId: "spya-jjjjjj", text: FIRST }],
      discarded: noneDropped(),
      generatedAt: "2026-08-31T00:00:00.000Z",
      elapsedMs: 1,
    };
    const built = buildQuotes({ quotes: [{ text: FIRST }, { text: FIRST }] }, {
      ...opts,
      blocks: article,
      dropped: drops(),
      inherit: idsByText(previous),
    });
    const ids = built.quotes.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("inDocumentOrder", () => {
  it("orders by block, then by offset inside a block", () => {
    const two = block("spya-llllll", `${FIRST} ${THIRD}`);
    const dropped = drops();
    const placed = place([{ text: THIRD }, { text: FIRST }], [two], dropped);
    const quotes = placed.map((p, i) => ({
      id: `q${i}`,
      blockId: p.blockId,
      text: p.text,
      start: p.span.start,
    }));
    expect(inDocumentOrder(quotes, [two]).map((q) => q.text)).toEqual([FIRST, THIRD]);
  });
});

describe("normaliseQuote", () => {
  it("folds the noise two typings of one line differ by", () => {
    expect(normaliseQuote("  “Writing is thinking” — really.  ")).toBe(
      normaliseQuote('"Writing is thinking" - really'),
    );
  });

  it("does not merge a line with one more clause on it", () => {
    expect(normaliseQuote(FIRST)).not.toBe(normaliseQuote(`${FIRST} And that is that.`));
  });
});

describe("isStale", () => {
  it("is false against the article it was written from", () => {
    const quotes: Quotes = {
      version: PROMPT_VERSION,
      generator: CAPABLE_MODEL,
      slug: "writes",
      sourceHash: inputFingerprint(BLOCKS, TREE, null),
      quotes: [{ id: "q1", blockId: "spya-aaaaaa", text: FIRST }],
      discarded: noneDropped(),
      generatedAt: "2026-08-31T00:00:00.000Z",
      elapsedMs: 1,
    };
    expect(isStale(quotes, BLOCKS, TREE, null)).toBe(false);
    expect(isStale({ ...quotes, sourceHash: "moved" }, BLOCKS, TREE, null)).toBe(true);
  });
});

describe("renderPrompt", () => {
  it("sends the skeleton and no block ids", () => {
    const prompt = renderPrompt({ tree: TREE, count: 6, profile: null });
    expect(prompt).toContain("PART 1");
    expect(prompt).toContain("up to 6");
    // The whole reason this stage can share the glossary's cached article.
    expect(prompt).not.toMatch(/spya-[a-z0-9]{6}/);
  });
});

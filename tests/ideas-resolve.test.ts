// @vitest-environment jsdom
/**
 * The client half of stage 5f — `resolveIdea` in src/web/search-hits.ts, and the
 * stepper arithmetic behind src/web/BlockNav.tsx.
 *
 * jsdom rather than node, for the reason tests/search-hits.test.ts and
 * tests/annotate.test.ts both give: the offset space these spans live in is
 * *the browser's*, defined by the concatenation of a block's text nodes. A
 * hand-rolled equivalent tested in node would pass against itself and disagree
 * with Chrome.
 *
 * **Why this file exists at all.** `resolveIdea` is a third caller of machinery
 * that had two, and the extraction of `resolveOne` moved code that `resolveHits`
 * had been the only user of. Two things follow: search must not have changed,
 * and the properties this file pins are exactly the ones that fail *silently* —
 * a dropped occurrence looks identical to one the model never named, and a
 * miscounted stepper looks like a shorter list.
 */
import { describe, expect, it } from "vitest";
import { orderFound, resolveHits, resolveIdea, type Found } from "../src/web/search-hits.js";
import { stepComment, positionOf } from "../src/web/comment-nav.js";
import type { Block, IdeaOccurrence } from "../src/types.js";

const block = (id: string, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

const BLOCKS: Block[] = [
  block("spya-aaaaaa", "<p>Writing is thinking, and there is no way round that.</p>"),
  block("spya-bbbbbb", "<p>Most people never had to write anything at all.</p>"),
  block("spya-cccccc", "<p>So the pressure went away, and writing is thinking still.</p>"),
];

const occurrence = (blockId: string, quote: string, reasoning = "why"): IdeaOccurrence =>
  ({ blockId, quote, reasoning }) as IdeaOccurrence;

const idea = (occurrences: IdeaOccurrence[], id = "spya-idea01", slot = 2) => ({
  id,
  slot,
  occurrences,
});

describe("resolveIdea", () => {
  it("resolves an occurrence to the span the browser will actually mark", () => {
    const [found] = resolveIdea(BLOCKS, idea([occurrence("spya-aaaaaa", "Writing is thinking")]));
    expect(found).toBeDefined();
    expect(found!.blockId).toBe("spya-aaaaaa");
    expect(found!.start).toBe(0);
    expect(found!.end).toBe("Writing is thinking".length);
    expect(found!.whole).toBe(false);
  });

  it("carries confidence as null, which is what a passage nobody asked about has", () => {
    /* Not zero. `keepAbove` reads null as certain rather than as the bottom of
       the scale, which is the behaviour a passage with no opinion attached
       should have — the same treatment a literal word-match already gets. */
    const [found] = resolveIdea(BLOCKS, idea([occurrence("spya-aaaaaa", "Writing is thinking")]));
    expect(found!.confidence).toBeNull();
  });

  it("gives every occurrence the idea's run id and slot", () => {
    /* The run id is what the rail keys a lane on, so an idea gets its own lane.
       The slot is what the *paragraph bar* keys on, and `blockHues` drops null
       slots — a null-slot idea would paint the rail and leave the bar blank. */
    const found = resolveIdea(
      BLOCKS,
      idea([occurrence("spya-aaaaaa", "Writing is thinking"), occurrence("spya-bbbbbb", "Most people")]),
    );
    expect(found.map((f) => f.runId)).toEqual(["spya-idea01", "spya-idea01"]);
    expect(found.map((f) => f.slot)).toEqual([2, 2]);
  });

  it("keys two occurrences in ONE block distinctly", () => {
    /* `blockId` alone was not unique for search hits and is not unique here
       either: one idea can be needed twice in a paragraph. Duplicate keys make
       React drop a row with a warning nobody reads, and make the stepper count
       one thing while the prose marks two. */
    const found = resolveIdea(
      BLOCKS,
      idea([
        occurrence("spya-cccccc", "So the pressure went away"),
        occurrence("spya-cccccc", "writing is thinking still"),
      ]),
    );
    expect(found).toHaveLength(2);
    expect(new Set(found.map((f) => f.key)).size).toBe(2);
  });

  it("drops an occurrence naming a block the article no longer has", () => {
    // After a re-extraction. An id that is gone has nowhere to point, and a row
    // that does nothing when pressed is worse than one that is not there.
    const found = resolveIdea(
      BLOCKS,
      idea([occurrence("spya-zzzzzz", "anything"), occurrence("spya-aaaaaa", "Writing is thinking")]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.blockId).toBe("spya-aaaaaa");
  });

  it("falls back to the whole paragraph, and says so, when the words have moved", () => {
    /* The server checked this quote against `block.text` at generation time, so
       a failure here means the two strings genuinely differ. Marking nothing
       would throw a good answer away over a whitespace difference; marking the
       wrong words is worse than either. */
    const [found] = resolveIdea(
      BLOCKS,
      idea([occurrence("spya-aaaaaa", "words that are not in this block at all")]),
    );
    expect(found!.whole).toBe(true);
    expect(found!.start).toBe(0);
    expect(found!.end).toBe(BLOCKS[0]!.text.length);
  });

  it("places each occurrence through the article, for the rail", () => {
    const found = resolveIdea(
      BLOCKS,
      idea([occurrence("spya-aaaaaa", "Writing is thinking"), occurrence("spya-cccccc", "pressure went away")]),
    );
    expect(found[0]!.at).toBeLessThan(found[1]!.at);
    expect(found[0]!.at).toBeGreaterThanOrEqual(0);
    expect(found[1]!.at).toBeLessThanOrEqual(1);
  });

  it("orders into document order, which is what the stepper counts", () => {
    /* The model may list its occurrences in any order. "2 of 4" has to mean the
       reader's own way through the article, so the band sorts before it counts. */
    const found = orderFound(
      resolveIdea(
        BLOCKS,
        idea([occurrence("spya-cccccc", "pressure went away"), occurrence("spya-aaaaaa", "Writing is thinking")]),
      ),
      "document",
    );
    expect(found.map((f) => f.blockId)).toEqual(["spya-aaaaaa", "spya-cccccc"]);
  });
});

describe("resolveHits, after resolveOne was extracted out of it", () => {
  /* The extraction moved the body of `resolveHits` so `resolveIdea` could share
     it. These pin that search did not change on the way — in particular the
     `whole` rule, which has been got wrong in this file once before. */
  it("still resolves a hit, keeps its confidence, and keys on the run", () => {
    const [found] = resolveHits(BLOCKS, [
      {
        id: "spya-run2aa",
        slot: 1,
        hits: [{ blockId: "spya-aaaaaa", quote: "Writing is thinking", confidence: 85, reasoning: "r" }],
      },
    ]);
    expect(found!.confidence).toBe(85);
    expect(found!.runId).toBe("spya-run2aa");
    expect(found!.key.startsWith("spya-run2aa:")).toBe(true);
    expect(found!.whole).toBe(false);
  });

  it("still uses `start` only to choose between repeats, never as the anchor", () => {
    /* The stored offset is measured in `block.text`; the span has to be in the
       rendered text. Passing it as a hint is right; trusting it is the bug
       annotate.ts's header is entirely about. The second "writing is thinking"
       in block c is the one being disambiguated to. */
    const near = BLOCKS[2]!.text.indexOf("writing is thinking");
    const [found] = resolveHits(BLOCKS, [
      {
        id: "spya-run2aa",
        slot: 1,
        hits: [
          { blockId: "spya-cccccc", quote: "writing is thinking", confidence: 90, reasoning: "r", start: near },
        ],
      },
    ]);
    expect(found!.start).toBe(near);
  });

  it("still marks the whole paragraph when the quote cannot be found", () => {
    const [found] = resolveHits(BLOCKS, [
      {
        id: "spya-run2aa",
        slot: 1,
        hits: [{ blockId: "spya-aaaaaa", quote: "nowhere in this text", confidence: 40, reasoning: "r" }],
      },
    ]);
    expect(found!.whole).toBe(true);
  });
});

/**
 * The arithmetic behind `BlockNav`. The component is markup over these two
 * functions plus one `findIndex`, so what is worth pinning is the end
 * conditions — every one of which renders perfectly when it is wrong.
 */
describe("the stepper's end conditions", () => {
  const targets = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `k${i}`, blockId: `spya-b${i}` }));

  it("reads 'nothing selected yet' as before the first, so the first press goes to the first", () => {
    /* `positionOf` returns 0, which the component renders as "–" and which makes
       *prev* dead and *next* land on index 0. Treating it as position 1 would
       make the first press of › skip an occurrence — invisible, and wrong. */
    expect(positionOf(targets(4), null)).toBe(0);
    expect(stepComment(targets(4), null, 1)).toBeNull();
  });

  it("does not wrap at either end", () => {
    /* Matching `stepComment`'s own rule rather than choosing afresh: two
       steppers three inches apart behaving differently on the same gesture is
       worse than either rule alone. */
    const four = targets(4);
    expect(stepComment(four, "k3", 1)).toBeNull();
    expect(stepComment(four, "k0", -1)).toBeNull();
  });

  it("steps one at a time through the middle", () => {
    const four = targets(4);
    expect(stepComment(four, "k1", 1)).toBe("k2");
    expect(stepComment(four, "k1", -1)).toBe("k0");
    expect(positionOf(four, "k2")).toBe(3);
  });

  it("returns null for a current id that is not in the list at all", () => {
    /* The stale case: the reader had an occurrence open, the article was
       re-extracted, and the key names a passage that no longer resolves. Both
       arrows go dead and the counter reads "– / 2", which is the honest answer
       — the alternative is stepping from a position that does not exist. */
    const two = targets(2);
    expect(stepComment(two, "k99", 1)).toBeNull();
    expect(stepComment(two, "k99", -1)).toBeNull();
    expect(positionOf(two, "k99")).toBe(0);
  });

  it("is generic over anything with an id, which is why it could be shared", () => {
    // A glossary term's targets are block ids; an idea's are `Found.key`s.
    const found: Pick<Found, "key">[] = [{ key: "a" }, { key: "b" }];
    const asIds = found.map((f) => ({ id: f.key }));
    expect(stepComment(asIds, "a", 1)).toBe("b");
  });
});

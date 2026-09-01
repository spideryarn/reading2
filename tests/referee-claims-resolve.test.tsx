// @vitest-environment jsdom
/**
 * `resolveClaim` in src/web/search-hits.ts — a claim's passages turned into the
 * marks the prose draws.
 *
 * jsdom rather than node, for the reason tests/referee-criteria-resolve.test.ts
 * and tests/annotate.test.ts both give: the offset space these spans live in is
 * **the browser's**, defined by the concatenation of a block's text nodes. A
 * hand-rolled equivalent tested in node would pass against itself and disagree
 * with Chrome.
 *
 * **Two properties this file exists for, and both are negative.**
 *
 * *The claim's own sentence is never marked.* Only its passages are. The
 * abstract is where the paper *states* a claim, and painting it in the same hue
 * as the passages would say the abstract is evidence for the abstract — which is
 * both wrong and exactly the kind of confident-looking structure the review
 * removed from this sub-mode. The panel row jumps to it; the prose does not wear
 * it, and nothing on screen would look broken if it did.
 *
 * *No confidence reaches `Found`.* There is no number on a `ClaimPassage` and
 * there is not going to be one (src/referee-claims.ts § `ClaimPassage`): the row
 * asserts that a passage takes a claim up, never how well. `confidence: null` is
 * what a literal word-match already carries, so `keepAbove` reads it as certain
 * rather than as zero. A `0` slipping in here would hide every claim mark behind
 * the `?conf=` bar and look exactly like a model that found nothing.
 */
import { describe, expect, it } from "vitest";

import type { ClaimPassage } from "../src/referee-claims.js";
import type { Block } from "../src/types.js";
import { blockHues, hitMarks, resolveClaim } from "../src/web/search-hits.js";

const block = (id: string, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

/* Real block ids — six characters from the alphabet in docs/project/block-ids.md
   (no `i`, `l`, `o` or `1`), because an invalid one is rejected nowhere in this
   path and the test would then be about something else. */
const ABSTRACT = "spya-k3m9qt";
const RESULTS = "spya-p7w2dn";

const BLOCKS: Block[] = [
  block(ABSTRACT, "<p>We show that the method halves annotation time.</p>"),
  block(RESULTS, "<p>Median time fell by half, and held across both cohorts.</p>"),
];

const passage = (blockId: string, quote: string, start = 0): ClaimPassage => ({
  blockId,
  quote,
  start,
  reasoning: "how it takes the claim up",
});

describe("resolveClaim", () => {
  it("finds the passage's quote in the rendered prose", () => {
    const [found] = resolveClaim(BLOCKS, {
      id: `${ABSTRACT}:8`,
      slot: 2,
      passages: [passage(RESULTS, "fell by half")],
    });
    expect(found?.blockId).toBe(RESULTS);
    expect(found?.whole).toBe(false);
    const text = BLOCKS[1]?.text ?? "";
    expect(text.slice(found?.start ?? 0, found?.end ?? 0)).toBe("fell by half");
  });

  it("marks the whole block when the exact words have moved, rather than nothing", () => {
    /* The article was re-extracted and the sentence is not there any more. A row
       that did nothing when pressed is worse than a row pointing at the
       paragraph the model meant. `resolveOne` owns this; asserted here because
       it is the state a stale claims run is actually in. */
    const [found] = resolveClaim(BLOCKS, {
      id: `${ABSTRACT}:8`,
      slot: 0,
      passages: [passage(RESULTS, "a sentence this paper never carried")],
    });
    expect(found?.whole).toBe(true);
    expect(found?.start).toBe(0);
  });

  it("does not mark the claim's own sentence, only where the paper takes it up", () => {
    /* The abstract is where the paper *states* the claim. Marking it in the same
       hue as the passages would say the abstract is evidence for itself. */
    const found = resolveClaim(BLOCKS, {
      id: `${ABSTRACT}:8`,
      slot: 0,
      passages: [passage(RESULTS, "fell by half")],
    });
    expect(found.map((f) => f.blockId)).toEqual([RESULTS]);
    expect(found.some((f) => f.blockId === ABSTRACT)).toBe(false);
  });

  it("carries no confidence, because a claim passage has none to carry", () => {
    /* `null`, never `0`. `keepAbove` reads null as certain and zero as beneath
       every threshold, so a zero here would hide every claim mark behind the
       `?conf=` bar and look exactly like a model that found nothing. */
    const [found] = resolveClaim(BLOCKS, {
      id: `${ABSTRACT}:8`,
      slot: 0,
      passages: [passage(RESULTS, "fell by half")],
    });
    expect(found?.confidence).toBeNull();
    expect(JSON.stringify(found)).not.toContain("discarded");
  });

  it("drops a passage naming a block the article no longer has", () => {
    expect(
      resolveClaim(BLOCKS, {
        id: `${ABSTRACT}:8`,
        slot: 0,
        passages: [passage("spya-zwt234", "anything")],
      }),
    ).toEqual([]);
  });

  it("gives every passage a key unique across claims and repeats", () => {
    /* One claim can be taken up twice in the same paragraph, and two claims can
       be on screen at once, so neither `blockId` nor `blockId:n` is an identity.
       The same three-part shape a hit, an occurrence and a criterion result all
       use. */
    const twice = [passage(RESULTS, "fell by half"), passage(RESULTS, "both cohorts")];
    const a = resolveClaim(BLOCKS, { id: `${ABSTRACT}:8`, slot: 0, passages: twice });
    const b = resolveClaim(BLOCKS, { id: `${ABSTRACT}:9`, slot: 1, passages: twice });
    expect(new Set([...a, ...b].map((f) => f.key)).size).toBe(4);
  });

  it("carries the claim's id and slot, so the rail and the paragraph bar both draw", () => {
    /* `blockHues` drops `null` slots, so a claim without one would paint the
       rail and leave the bar blank — which looks like a rendering bug and is
       not one. */
    const found = resolveClaim(BLOCKS, {
      id: `${ABSTRACT}:8`,
      slot: 3,
      passages: [passage(RESULTS, "fell by half")],
    });
    expect(found[0]?.runId).toBe(`${ABSTRACT}:8`);
    expect(found[0]?.slot).toBe(3);
    expect(blockHues(found).get(RESULTS)).toEqual([3]);
    expect(hitMarks(found, null).get(RESULTS)?.length).toBe(1);
  });
});

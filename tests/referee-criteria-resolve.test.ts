// @vitest-environment jsdom
/**
 * `resolveCriterion` in src/web/search-hits.ts — a criterion's results turned
 * into the marks the prose draws.
 *
 * jsdom rather than node, for the reason tests/search-hits.test.ts,
 * tests/annotate.test.ts and tests/ideas-resolve.test.ts all give: the offset
 * space these spans live in is **the browser's**, defined by the concatenation
 * of a block's text nodes. A hand-rolled equivalent tested in node would pass
 * against itself and disagree with Chrome.
 *
 * **The property this file exists for is a negative one.** `resolveCriterion`
 * is the fifth caller of `resolveOne`, so most of what it does is already
 * pinned; what is new and what would fail silently is that a `DivergingResult`
 * carries a −100…+100 valence and **none of it may reach `Found`**. Sol's
 * finding 7: the renderer has two channels, the wash carries strength and the
 * categorical stripe carries which source found the passage, and repainting the
 * stripe by valence would throw provenance away — two negative criteria over
 * one phrase would both go red and the reader could not tell which said what.
 * A valence quietly appearing on a `Found` is the first step back towards that,
 * and nothing on screen would look wrong until two criteria overlapped.
 */
import { describe, expect, it } from "vitest";

import type { RefereeResult } from "../src/referee-criteria.js";
import type { Block } from "../src/types.js";
import { blockHues, hitMarks, resolveCriterion } from "../src/web/search-hits.js";

const block = (id: string, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

/* Real block ids — six characters from the alphabet in docs/project/block-ids.md
   (no `i`, `l`, `o` or `1`), because an invalid one is not rejected anywhere in
   this path and the test would then be about something else. */
const BLOCKS: Block[] = [
  block("spya-k3m9qt", "<p>We ran no negative control, because the effect was large.</p>"),
  block("spya-p7w2dn", "<p>Every condition was pre-registered before recruitment began.</p>"),
];

const single = (blockId: string, quote: string, confidence = 80): RefereeResult => ({
  kind: "single",
  blockId,
  quote,
  confidence,
  reasoning: "why",
});

const diverging = (blockId: string, quote: string, valence: number): RefereeResult => ({
  kind: "diverging",
  blockId,
  quote,
  confidence: 90,
  reasoning: "why",
  valence,
});

const criterion = (results: RefereeResult[], id = "spya-crit01", slot = 2) => ({
  id,
  slot,
  results,
});

describe("resolveCriterion", () => {
  it("finds the model's quote in the rendered prose", () => {
    const [found] = resolveCriterion(BLOCKS, criterion([single("spya-k3m9qt", "no negative control")]));
    expect(found?.blockId).toBe("spya-k3m9qt");
    expect(found?.whole).toBe(false);
    const text = BLOCKS[0]!.text;
    expect(text.slice(found!.start, found!.end)).toBe("no negative control");
  });

  it("marks the whole block when the exact words have moved, rather than nothing", () => {
    /* The honest fallback: the model named a block and said why, and that much
       is still true when the characters have shifted. Marking nothing would
       throw away a good answer over a whitespace difference. */
    const [found] = resolveCriterion(
      BLOCKS,
      criterion([single("spya-k3m9qt", "a sentence that is not in this block at all")]),
    );
    expect(found?.whole).toBe(true);
    expect(found?.start).toBe(0);
  });

  it("drops a result naming a block the article no longer has", () => {
    expect(resolveCriterion(BLOCKS, criterion([single("spya-zzzzzz", "anything")]))).toEqual([]);
  });

  it("gives every result a key unique across criteria and repeats", () => {
    const a = resolveCriterion(
      BLOCKS,
      criterion([
        single("spya-k3m9qt", "no negative control"),
        single("spya-k3m9qt", "the effect was large"),
      ]),
      // Two results in one block is the case `blockId` alone cannot separate.
    );
    const b = resolveCriterion(
      BLOCKS,
      criterion([single("spya-k3m9qt", "no negative control")], "spya-crit02", 3),
    );
    const keys = [...a, ...b].map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries the criterion's id and slot, so the rail and the bar both draw", () => {
    const [found] = resolveCriterion(BLOCKS, criterion([single("spya-k3m9qt", "no negative control")]));
    expect(found?.runId).toBe("spya-crit01");
    expect(found?.slot).toBe(2);
    // `blockHues` drops `null` slots, so a criterion without one would paint the
    // rail and leave the paragraph bar blank — a rendering bug that is not one.
    expect(blockHues([found!]).get("spya-k3m9qt")).toEqual([2]);
  });

  it("keeps the model's confidence, unlike ideas and quotes which have none", () => {
    const [found] = resolveCriterion(
      BLOCKS,
      criterion([single("spya-k3m9qt", "no negative control", 42)]),
    );
    expect(found?.confidence).toBe(42);
  });

  /* ------------------------------------------------------------------ */

  /**
   * **The one that matters.** A valence of −90 is on the result and must be on
   * nothing that reaches the renderer.
   */
  it("does not carry a valence onto the marks, in any spelling", () => {
    const found = resolveCriterion(
      BLOCKS,
      criterion([
        diverging("spya-k3m9qt", "no negative control", -90),
        diverging("spya-p7w2dn", "pre-registered", 70),
      ]),
    );
    for (const f of found) {
      // Not `f.valence === undefined`: a field added under any name would pass
      // that. The whole object is searched for the number instead.
      expect(JSON.stringify(f)).not.toContain("-90");
      expect(JSON.stringify(f)).not.toContain("valence");
    }
  });

  it("draws two overlapping criteria as two identity slots, not one colour", () => {
    /* The failure Sol's finding 7 is about, from the renderer's side: both
       criteria found the same phrase and one of them is negative. What must
       come out is two marks carrying two slots — provenance — rather than
       anything that has collapsed them by direction. */
    const a = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", -90)], "spya-crit01", 2),
    );
    const b = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", -40)], "spya-crit02", 5),
    );
    const marks = hitMarks([...a, ...b], null).get("spya-k3m9qt") ?? [];
    expect(marks.map((m) => m.slot).sort()).toEqual([2, 5]);
  });

  it("keeps the strength on the confidence, so a strong negative is not a strong wash", () => {
    /* Stated as a test because it is the tempting shortcut: a wash scaled by
       |valence| would look informative and would mean something else entirely.
       Two results with opposite valences and the same confidence draw the same
       wash, and the panel is where they differ. */
    const strongAgainst = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", -100)]),
    );
    const strongFor = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", 100)]),
    );
    const one = hitMarks(strongAgainst, null).get("spya-k3m9qt")?.[0];
    const two = hitMarks(strongFor, null).get("spya-k3m9qt")?.[0];
    expect(one?.strength).toBe(two?.strength);
  });
});

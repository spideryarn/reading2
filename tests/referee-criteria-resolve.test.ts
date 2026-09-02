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
 * **Two of the tests below were reversed on purpose on 2026-09-02, and this is
 * the note that says so** — so the next reader sees a decision rather than a
 * regression in the history.
 *
 * This file used to assert the opposite rule. `resolveCriterion` dropped the
 * valence and the prose stripe carried criterion *identity*, on Sol's earlier
 * finding 7: the renderer has two channels, the wash carries strength and the
 * stripe carries which source found the passage. Greg read a paper with it and
 * found the panel and the prose contradicting each other on one phrase —
 * *"So if extrapolation" counts against on the left, and yet it is highlighted
 * with a green line in the text on the right* — because a criterion that drew
 * the green identity slot underlined every one of its passages green, including
 * the ones the panel called "counts against" in red. Two palettes side by side
 * with nothing on screen saying they were two.
 *
 * > I was thinking that it should match the colour of the left-hand panel. If
 * > that's set to red/green, so should the prose be.
 * > — Greg, 2026-09-02
 *
 * So the two tests named *"does not carry a valence onto the marks"* and *"draws
 * two overlapping criteria as two identity slots"* were replaced by their
 * opposites, and what is asserted now is the property that replaced the old one:
 * a stripe is the **direction**, deduplicated on the resolved ramp token, so two
 * opposite valences over one phrase stay two stripes and never collapse into
 * one. The plan is docs/plans/260902e-make-referee-mode-understandable.md, which
 * also says what this knowingly gives up (prose→panel provenance) and what pays
 * for painting a judgement in colour (the sign glyph, and the key in the panel).
 */
import { describe, expect, it } from "vitest";

import type { RefereeResult } from "../src/referee-criteria.js";
import type { Block } from "../src/types.js";
import { annotateHtml } from "../src/web/annotate.js";
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
   * **The reversal, stated as an assertion.** The valence reaches `Found`, as
   * the number and only as the number: a CSS token here would make this
   * resolver depend on which ramp the reader is looking at, which is Sol's
   * finding 5 and the reason `hitMarks` is where the palette lands.
   */
  it("carries the valence onto the passage, as a number and not a token", () => {
    const found = resolveCriterion(
      BLOCKS,
      criterion([
        diverging("spya-k3m9qt", "no negative control", -90),
        diverging("spya-p7w2dn", "pre-registered", 70),
      ]),
    );
    expect(found.map((f) => f.valence)).toEqual([-90, 70]);
    /* Nothing CSS-shaped anywhere on the object. A `--div-rg-1` appearing here
       would work on screen and be the wrong seam, which is precisely the kind of
       thing a rendering test cannot see. */
    for (const f of found) expect(JSON.stringify(f)).not.toContain("--div");
  });

  it("leaves every other source's passages with no valence at all", () => {
    /* The other half, and it is the half that keeps Search, Ideas, Quotes,
       Timeline and Claims byte-identical: a `single` result carries no
       direction, so its mark is the identity mark it always was. */
    const found = resolveCriterion(BLOCKS, criterion([single("spya-k3m9qt", "no negative control")]));
    expect(found[0]?.valence).toBeNull();
    const mark = hitMarks(found, null, "rg").get("spya-k3m9qt")?.[0];
    expect(mark?.hue).toBeUndefined();
    expect(mark?.dir).toBeUndefined();
    expect(mark?.slot).toBe(2);
  });

  it("resolves the valence to the ramp the reader is on, not to the one stored", () => {
    /* One scale for the whole mode — `?refscale=`. The two ramps put red at
       opposite ends of the truth, so the same −100 has to come out as the *low*
       step of whichever ramp is asked for, and never as a step of the other. */
    const found = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", -100)]),
    );
    expect(hitMarks(found, null, "rg").get("spya-k3m9qt")?.[0]?.hue).toBe("var(--div-rg-0-rgb)");
    expect(hitMarks(found, null, "br").get("spya-k3m9qt")?.[0]?.hue).toBe("var(--div-0-rgb)");
  });

  /* ------------------------------------------- the two dedup shapes ------- */

  it("draws one criterion's opposite valences over one phrase as two stripes", () => {
    /* **The failure the old slot-keyed dedup would have had**, and Sol's finding
       3: one criterion, one phrase, two results pointing opposite ways. Keyed on
       the slot they are one mark, one stripe and one direction silently thrown
       away. Keyed on the resolved token they are what they are — two.

       Asserted through `annotateHtml` rather than on the marks, because the
       collapse happens in the renderer and a test that stopped at `hitMarks`
       would pass over it. */
    const found = resolveCriterion(
      BLOCKS,
      criterion([
        diverging("spya-k3m9qt", "no negative control", -90),
        diverging("spya-k3m9qt", "no negative control", 90),
      ]),
    );
    const out = annotateHtml(BLOCKS[0]!.html, hitMarks(found, null, "rg").get("spya-k3m9qt") ?? []);
    expect(out).toContain('data-hues="2"');
    expect(out).toContain("--h0:var(--div-rg-0-rgb)");
    expect(out).toContain("--h1:var(--div-rg-8-rgb)");
    /* And the sign says so without any colour at all: two directions over one
       phrase is `±`, not a verdict this renderer picked. */
    expect(out).toContain('data-dir="mixed"');
  });

  it("draws two criteria that landed on one ramp step as a single stripe", () => {
    /* The other half of finding 3, and the reason the identity key could not
       simply be kept: two *different* criteria, two different slots, the same
       direction. Keyed on the slot this is `data-hues="2"` with two identical
       `--h*` values — a hard-stop gradient between one colour and itself, which
       renders as one uninterrupted band while the attribute claims two. Keyed on
       the token it is honestly one. */
    const a = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", -100)], "spya-crit01", 2),
    );
    const b = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", -95)], "spya-crit02", 5),
    );
    /* −100 and −95 are the same ramp step, which is the point: the two criteria
       disagree about nothing a reader could see. */
    const marks = hitMarks([...a, ...b], null, "rg").get("spya-k3m9qt") ?? [];
    expect(marks.map((m) => m.hue)).toEqual(["var(--div-rg-0-rgb)", "var(--div-rg-0-rgb)"]);
    const out = annotateHtml(BLOCKS[0]!.html, marks);
    expect(out).toContain('data-hues="1"');
    expect(out).toContain('data-dir="against"');
  });

  it("keeps a criterion's identity in the paragraph bar, which is what still answers 'which one'", () => {
    /* What the reversal gives up is *prose→panel* provenance, and this is the
       line where the rest of it survives: `blockHues` and the rail read `slot`,
       untouched, so the bar down the left of the paragraph still says which
       criteria are live around here. Coarser than the stripe used to be — the
       bar is paragraph-wide and collapses two criteria sharing a slot — and it
       is the honest remainder rather than a replacement. */
    const a = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", -90)], "spya-crit01", 2),
    );
    const b = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "the effect was large", 40)], "spya-crit02", 5),
    );
    expect(blockHues([...a, ...b]).get("spya-k3m9qt")).toEqual([2, 5]);
  });

  /* ---------------------------------------- the sign, which is the carrier -- */

  it.each([
    [-64, "against"],
    [0, "neither"],
    [64, "for"],
  ])("says which way %i cuts in a word as well as in a colour", (valence, dir) => {
    /* docs/project/colour-scales.md forbids colour being the only carrier of a
       good/bad judgement, and the prose has no words. `data-dir` is what
       styles.css turns into a superscript `−`, `·` or `+`. Zero is a real answer
       and gets its own glyph rather than being rounded into one of the others. */
    const found = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", valence)]),
    );
    const out = annotateHtml(BLOCKS[0]!.html, hitMarks(found, null, "rg").get("spya-k3m9qt") ?? []);
    expect(out).toContain(`data-dir="${dir}"`);
  });

  it("puts the sign in the markup and never in the article's own text", () => {
    /* The one thing docs/project/block-ids.md would never forgive: a glyph in a
       text node would change the rendered-text offset space every mark, comment
       anchor and block id resolves against — and it would be copied out with the
       author's sentence. So the attribute is there and the character is not. */
    const found = resolveCriterion(
      BLOCKS,
      criterion([diverging("spya-k3m9qt", "no negative control", -64)]),
    );
    const out = annotateHtml(BLOCKS[0]!.html, hitMarks(found, null, "rg").get("spya-k3m9qt") ?? []);
    const el = document.createElement("div");
    el.innerHTML = out;
    expect(el.textContent).toBe(BLOCKS[0]!.text);
    expect(el.textContent).not.toContain("−");
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
    const one = hitMarks(strongAgainst, null, "rg").get("spya-k3m9qt")?.[0];
    const two = hitMarks(strongFor, null, "rg").get("spya-k3m9qt")?.[0];
    expect(one?.strength).toBe(two?.strength);
  });
});

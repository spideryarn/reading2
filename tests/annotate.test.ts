// @vitest-environment jsdom
/**
 * The mark drawn over a commented passage — src/web/annotate.ts.
 *
 * jsdom rather than the default node environment (vitest.config.ts) because the
 * whole point of that module is that the *browser's* parser defines the offset
 * space. A hand-rolled tokenizer tested in node would be testing the wrong
 * thing: it would pass against itself and disagree with Chrome.
 *
 * See docs/project/comments.md § Anchoring.
 */
import { describe, expect, it } from "vitest";
import {
  annotateHtml,
  HUE_STRIPES,
  renderedText,
  resolveMark,
  termMarks,
  type Mark,
} from "../src/web/annotate.js";
import { CATEGORICAL_SLOTS } from "../src/web/hit-colours.js";

describe("renderedText", () => {
  it("is the concatenation of text nodes, with entities decoded", () => {
    expect(renderedText("<p>Tea &amp; toast</p>")).toBe("Tea & toast");
  });

  it("does NOT insert separators at block boundaries", () => {
    // The point of contrast with blocks.ts § extractText, which does insert
    // them. The two strings are different lengths, which is exactly why an
    // offset taken against one must never be applied to the other.
    expect(renderedText("<blockquote><p>one.</p><p>two.</p></blockquote>")).toBe("one.two.");
  });
});

describe("annotateHtml", () => {
  it("wraps a plain run", () => {
    const out = annotateHtml("<p>alpha beta gamma</p>", [{ id: "spya-aaaaaa", start: 6, end: 10 }]);
    expect(out).toContain('<mark class="cmt" data-comment="spya-aaaaaa" data-mark-end="">beta</mark>');
  });

  it("leaves html untouched when there is nothing to mark", () => {
    const html = "<p>alpha beta</p>";
    expect(annotateHtml(html, [])).toBe(html);
  });

  it("splits a mark that crosses an element boundary rather than straddling it", () => {
    // `<em>a<mark>b</em>c</mark>` is malformed and the browser silently repairs
    // it into something else. One <mark> per text node can never be malformed.
    const out = annotateHtml("<p>say <em>this</em> now</p>", [
      { id: "spya-bbbbbb", start: 4, end: 12 },
    ]);
    const host = document.createElement("div");
    host.innerHTML = out;
    const marks = [...host.querySelectorAll("mark.cmt")];
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.textContent).join("")).toBe("this now");
    // Exactly one asterisk, on the last run, however many runs there were.
    expect(host.querySelectorAll("mark.cmt[data-mark-end]")).toHaveLength(1);
    expect(host.querySelector("mark.cmt[data-mark-end]")?.textContent).toBe(" now");
    // And the <em> still contains its own text, rather than having been reparented.
    expect(host.querySelector("em")?.textContent).toBe("this");
  });

  it("counts an entity as one character", () => {
    const out = annotateHtml("<p>Tea &amp; toast</p>", [{ id: "spya-cccccc", start: 6, end: 11 }]);
    const host = document.createElement("div");
    host.innerHTML = out;
    expect(host.querySelector("mark.cmt")?.textContent).toBe("toast");
  });

  it("gives overlapping marks one element listing both, rather than nesting them", () => {
    const out = annotateHtml("<p>alpha beta gamma</p>", [
      { id: "spya-aaaaaa", start: 0, end: 10 },
      { id: "spya-bbbbbb", start: 6, end: 16 },
    ]);
    const host = document.createElement("div");
    host.innerHTML = out;
    const marks = [...host.querySelectorAll("mark.cmt")];
    expect(marks.map((m) => m.getAttribute("data-comment"))).toEqual([
      "spya-aaaaaa",
      "spya-aaaaaa spya-bbbbbb",
      "spya-bbbbbb",
    ]);
    expect(host.querySelector("mark.cmt mark.cmt")).toBeNull();
    // The text is unchanged — an annotation must never alter the author's words.
    expect(host.textContent).toBe("alpha beta gamma");
  });

  it("flags the open comment so the prose and the dialog agree", () => {
    const out = annotateHtml("<p>alpha beta</p>", [
      { id: "spya-aaaaaa", start: 0, end: 5, open: true },
    ]);
    expect(out).toContain("data-open");
  });
});

describe("resolveMark", () => {
  const text = "The hard problem is hard. The hard problem returns.";

  it("takes the offset when the quote is still there", () => {
    expect(resolveMark(text, { quote: "hard problem", start: 30 })).toEqual({
      start: 30,
      end: 42,
    });
  });

  it("re-finds the quote when the text above it has changed length", () => {
    // The anchor is the quote; the offset only chooses between repeats. Here the
    // stored offset is stale, and the nearer of the two occurrences wins.
    expect(resolveMark(text, { quote: "hard problem", start: 27 })).toEqual({
      start: 30,
      end: 42,
    });
    expect(resolveMark(text, { quote: "hard problem", start: 2 })).toEqual({ start: 4, end: 16 });
  });

  it("returns null rather than marking the wrong words when the quote is gone", () => {
    // The paragraph was edited. Highlighting whatever now sits at that offset
    // would be the silent-success failure — see docs/reusable/silent-success.md.
    expect(resolveMark(text, { quote: "easy problem", start: 30 })).toBeNull();
  });
});

describe("resolveMark refuses nonsense offsets", () => {
  // `startsWith` clamps a negative position to 0 and matches happily, and the
  // fast path used to return the negative start unchanged — a mark drawn to the
  // left of its own words, which reads as a CSS bug rather than bad data.
  it("does not return a negative range for a negative start", () => {
    const found = resolveMark("alpha beta", { quote: "alpha", start: -2 });
    expect(found).toEqual({ start: 0, end: 5 });
  });

  it("still finds the quote when the stored start is past the end", () => {
    expect(resolveMark("alpha beta", { quote: "beta", start: 999 })).toEqual({ start: 6, end: 10 });
  });

  it("returns null when the quote is gone, rather than marking the wrong words", () => {
    expect(resolveMark("alpha beta", { quote: "gamma", start: 0 })).toBeNull();
  });
});

/**
 * Inline SVG survives sanitising by choice (docs/project/security.md), so a
 * comment's range can reach text inside a diagram. Wrapping an HTML <mark>
 * inside foreign content builds a tree whose re-parse is governed by different
 * rules than the one we built — so that text is counted and not wrapped.
 */
describe("foreign content", () => {
  const HTML = `<p>Before <svg><text>LABEL</text></svg> after the diagram.</p>`;

  it("counts svg text in the offset space, like renderedText does", () => {
    // If these two disagree, every mark after a diagram lands in the wrong place.
    expect(renderedText(HTML)).toContain("LABEL");
  });

  it("never puts a mark inside the svg", () => {
    // A mark spanning the whole block, diagram included.
    const out = annotateHtml(HTML, [
      { id: "c1", start: 0, end: renderedText(HTML).length },
    ]);
    const svg = out.slice(out.indexOf("<svg"), out.indexOf("</svg>"));
    expect(svg).not.toContain("<mark");
    // …but the ordinary prose on both sides is still marked.
    expect(out).toContain("<mark");
    expect(out.slice(0, out.indexOf("<svg"))).toContain("<mark");
  });

  /**
   * The one that actually pins the arithmetic. The test above passes either way,
   * because a mark spanning everything cannot show whether the skipped node was
   * still *counted* — so it would stay green if `offset += value.length` were
   * moved below the namespace guard, which would shift every mark after a
   * diagram by the length of its labels. Caught by GPT-5's review, 2026-08-25.
   */
  it("still counts the svg's text, so prose after a diagram marks exactly", () => {
    const text = renderedText(HTML);
    const start = text.indexOf("after");
    expect(start).toBeGreaterThan(text.indexOf("LABEL")); // the word is past the svg
    const out = annotateHtml(HTML, [{ id: "c1", start, end: start + "after".length }]);
    expect(out).toContain(">after<");
    expect(out).toMatch(/<mark[^>]*>after<\/mark>/);
  });

  it("treats mathml the same way", () => {
    const math = `<p>Before <math><mi>XY</mi></math> after the formula.</p>`;
    const text = renderedText(math);
    const start = text.indexOf("after");
    const out = annotateHtml(math, [{ id: "c1", start, end: start + "after".length }]);
    expect(out.slice(out.indexOf("<math"), out.indexOf("</math>"))).not.toContain("<mark");
    expect(out).toMatch(/<mark[^>]*>after<\/mark>/);
  });
});

/* ------------------------------------------------------- glossary terms --
   The second kind of mark. Everything above is a comment: an anchor the reader
   made, resolved back onto the prose. A term arrives as a list of spellings and
   the occurrences are found here. See docs/project/glossary.md. */

describe("termMarks", () => {
  const blocks = [
    {
      id: "spya-aaaaaa",
      tag: "p",
      kind: "text" as const,
      text: "A nonreductive explanation is not no explanation.",
      words: 8,
      html: "<p>A <em>nonreductive explanation</em> is not no explanation.</p>",
      gistable: true,
    },
    {
      id: "spya-bbbbbb",
      tag: "p",
      kind: "text" as const,
      text: "Nonreductive accounts have problems.",
      words: 4,
      html: "<p>Nonreductive accounts have problems.</p>",
      gistable: true,
    },
  ];

  const selection = {
    id: "spya-termid",
    forms: ["nonreductive explanation", "nonreductive"],
    blocks: ["spya-aaaaaa", "spya-bbbbbb"],
  };

  it("marks nothing at all when no term is selected", () => {
    // The whole shape of the decision in GlossaryPanel.tsx: the article
    // acquires marks when the reader asks for them and at no other time. Their
    // version underlined every term in every article, always.
    expect(termMarks(blocks, null).size).toBe(0);
  });

  it("finds every occurrence, in the rendered-text offset space", () => {
    const found = termMarks(blocks, selection);
    const first = found.get("spya-aaaaaa");
    expect(first).toHaveLength(1);
    // Offsets are against renderedText(html), NOT block.text — the two are
    // different lengths and mixing them is what the header of annotate.ts is
    // about. Slicing the rendered text back out is the only honest check.
    const text = renderedText(blocks[0]!.html);
    expect(text.slice(first![0]!.start, first![0]!.end)).toBe("nonreductive explanation");
    expect(found.get("spya-bbbbbb")).toHaveLength(1);
  });

  it("only looks in the blocks the server said the term was in", () => {
    // Not merely an optimisation: it is the agreement between the two halves.
    // Restricting the search means a disagreement between glossary.json and
    // this shows up as a MISSING underline rather than as an underline in a
    // block the panel claims has none — one is a visible bug, the other is the
    // panel and the prose quietly telling you different things.
    const narrowed = { ...selection, blocks: ["spya-bbbbbb"] };
    const found = termMarks(blocks, narrowed);
    expect(found.has("spya-aaaaaa")).toBe(false);
    expect(found.has("spya-bbbbbb")).toBe(true);
  });

  it("draws a term underline that is not a comment", () => {
    const marks = termMarks(blocks, selection).get("spya-bbbbbb")!;
    const out = annotateHtml(blocks[1]!.html, marks);
    expect(out).toContain('class="term"');
    // A term is inert. `mark.cmt` is what the click handler in TableView
    // selects on, so carrying that class would make pressing a term try to
    // open a comment that does not exist.
    expect(out).not.toContain("data-comment");
    expect(out).not.toContain("data-mark-end");
    expect(out).toContain('data-term="spya-termid"');
  });

  it("merges a comment and a term over the same words into ONE mark", () => {
    // Two nested <mark>s would stack two underlines on the same words, which
    // reads as a rendering bug. And the comment must keep `cmt` — a question
    // asked about a sentence does not stop being clickable because a glossary
    // term happens to sit in it.
    const marks = termMarks(blocks, selection).get("spya-bbbbbb")!;
    const text = renderedText(blocks[1]!.html);
    const out = annotateHtml(blocks[1]!.html, [
      { id: "c1", start: 0, end: text.length },
      ...marks,
    ]);
    const host = document.createElement("div");
    host.innerHTML = out;
    const both = host.querySelector("mark.cmt.term");
    expect(both).not.toBeNull();
    expect(both?.getAttribute("data-comment")).toBe("c1");
    expect(both?.getAttribute("data-term")).toBe("spya-termid");
    expect(host.querySelectorAll("mark mark")).toHaveLength(0);
  });
});

/**
 * The third kind of mark, and the claim it rests on.
 *
 * docs/project/original-version/highlighting.md warns that a third layer of
 * marks over the same prose is where a wrapper-span library gives up: HTML
 * elements nest, two ranges that merely cross have no valid markup, and its
 * recommendation was to abandon DOM marks for the CSS Custom Highlight API.
 *
 * These tests are the evidence that we did not have to. `annotateHtml` never
 * wraps a *range* — it cuts each text node at every boundary and labels each
 * piece with whichever marks cover it — so overlap is expressible by
 * construction. If one of these ever fails, that recommendation becomes live
 * again. See annotate.ts § MarkKind.
 */
describe("search hits — the third kind of mark", () => {
  const html = "<p>He rejects the idea that mind is <em>software</em> running on wet hardware.</p>";

  const host = (out: string) => {
    const el = document.createElement("div");
    el.innerHTML = out;
    return el;
  };

  it("draws a hit as its own class, with no comment attributes on it", () => {
    const out = annotateHtml(html, [{ id: "h1", start: 3, end: 10, kind: "hit" }]);
    expect(out).toContain('class="hit"');
    expect(out).toContain('data-hit="h1"');
    expect(out).not.toContain("data-comment");
    // No ✳ marker: a hit is not an artefact the reader made and cannot be opened.
    expect(out).not.toContain("data-mark-end");
  });

  it("carries the confidence through as a number the stylesheet can multiply", () => {
    const out = annotateHtml(html, [{ id: "h1", start: 3, end: 10, kind: "hit", strength: 0.4 }]);
    expect(host(out).querySelector("mark.hit")?.getAttribute("style")).toBe("--hit-a:0.400");
  });

  it("gives a mark with no strength a full one, not an invisible one", () => {
    // The failure of a missing property should be a mark you can see.
    const out = annotateHtml(html, [{ id: "h1", start: 3, end: 10, kind: "hit" }]);
    expect(host(out).querySelector("mark.hit")?.getAttribute("style")).toBe("--hit-a:1.000");
  });

  it("lets the strongest of two overlapping hits win, rather than adding them up", () => {
    // Accumulating opacity would make two middling matches look more certain
    // than either of them is — a claim nobody made.
    const out = annotateHtml(html, [
      { id: "h1", start: 0, end: 20, kind: "hit", strength: 0.3 },
      { id: "h2", start: 10, end: 30, kind: "hit", strength: 0.9 },
    ]);
    const overlap = [...host(out).querySelectorAll("mark.hit")].find(
      (m) => (m.getAttribute("data-hit") ?? "").split(" ").length === 2,
    );
    expect(overlap).toBeDefined();
    expect(overlap?.getAttribute("style")).toBe("--hit-a:0.900");
  });

  /** The case the borrowed doc says cannot be expressed. It can. */
  it("merges a comment, a term and a hit over the same words into ONE mark", () => {
    const out = annotateHtml(html, [
      { id: "c1", start: 3, end: 30 },
      { id: "t1", start: 3, end: 30, kind: "term" },
      { id: "h1", start: 3, end: 30, kind: "hit", strength: 0.7 },
    ]);
    const el = host(out).querySelector("mark.cmt.term.hit");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-comment")).toBe("c1");
    expect(el?.getAttribute("data-term")).toBe("t1");
    expect(el?.getAttribute("data-hit")).toBe("h1");
    // Nothing nested, which is the whole property.
    expect(host(out).querySelectorAll("mark mark")).toHaveLength(0);
  });

  it("expresses three marks that only PARTIALLY overlap, which is the hard case", () => {
    // a───────b
    //     c───────d       <- crosses, does not nest
    //         e───────f
    const out = annotateHtml(html, [
      { id: "c1", start: 0, end: 20 },
      { id: "t1", start: 10, end: 30, kind: "term" },
      { id: "h1", start: 25, end: 45, kind: "hit", strength: 0.5 },
    ]);
    const el = host(out);
    expect(el.querySelectorAll("mark mark")).toHaveLength(0);
    // The middle stretch belongs to two of them at once and to neither alone.
    expect(el.querySelector("mark.cmt.term")).not.toBeNull();
    expect(el.querySelector("mark.term.hit")).not.toBeNull();
    // And the rendered text is unchanged, which is the thing a bad merge breaks.
    expect(el.textContent).toBe(renderedText(html));
  });

  it("marks the pressed hit as open, the way an open comment is", () => {
    const out = annotateHtml(html, [{ id: "h1", start: 3, end: 10, kind: "hit", open: true }]);
    expect(host(out).querySelector("mark.hit")?.hasAttribute("data-open")).toBe(true);
  });
});

describe("annotateHtml — the colours of the searches that found the words", () => {
  const HTML = "<p>the mind is software running on wet hardware</p>";

  const hitMark = (over: Partial<Mark> = {}): Mark => ({
    id: "h1",
    start: 4,
    end: 8,
    kind: "hit",
    strength: 1,
    ...over,
  });

  it("names the palette slot rather than a colour", () => {
    /* The seam this whole design rests on: annotate.ts knows which *search*,
       styles/colourscales.css knows which *hue*, and a hex value appearing here
       would put a colour beyond the reach of the theme. */
    const out = annotateHtml(HTML, [hitMark({ slot: 3 })]);
    expect(out).toContain("--h0:var(--cat-3-rgb)");
    expect(out).toContain('data-hues="1"');
    expect(out).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("stacks one stripe per search over the same words, in slot order", () => {
    const out = annotateHtml(HTML, [
      hitMark({ id: "h1", slot: 5 }),
      hitMark({ id: "h2", slot: 2 }),
    ]);
    expect(out).toContain('data-hues="2"');
    /* Sorted, so the same pair of searches draws the same pair of rules
       wherever they meet — rather than in whatever order the results list
       happened to be sorted into. */
    expect(out).toContain("--h0:var(--cat-2-rgb)");
    expect(out).toContain("--h1:var(--cat-5-rgb)");
  });

  it("counts one search that found the same words twice as one stripe", () => {
    const out = annotateHtml(HTML, [
      hitMark({ id: "h1", slot: 4 }),
      hitMark({ id: "h2", slot: 4 }),
    ]);
    expect(out).toContain('data-hues="1"');
  });

  it("draws no more than HUE_STRIPES of them", () => {
    /* Past the cap the band would push into the line below. The reader loses
       the knowledge that a further search matched *here*, not that it matched:
       it keeps its row in the results list and its segment in the paragraph's
       left-edge bar, which is capped separately and much higher.

       Both bounds derived from `HUE_STRIPES` rather than written out, because
       the cap has already moved once — it was four, on the strength of an
       arithmetic claim that turned out to be false — and a hardcoded `--h4`
       here would have to be remembered every time it moves again. */
    const out = annotateHtml(
      HTML,
      Array.from({ length: HUE_STRIPES + 2 }, (_, i) => hitMark({ id: `h${i}`, slot: i % 8 })),
    );
    expect(out).toContain(`data-hues="${HUE_STRIPES}"`);
    expect(out).toContain(`--h${HUE_STRIPES - 1}:`);
    expect(out).not.toContain(`--h${HUE_STRIPES}:`);
  });

  it("ignores a slot past the end of the palette", () => {
    /* An eight-hue palette has no `--cat-8-rgb`, so a slot of 8 emits a
       reference to a property nobody defined — invalid at computed-value time,
       which paints nothing. Exactly as silent as the NaN case above, and the
       reason the guard checks both ends of the range rather than just the
       bottom. Raised by a GPT Sol review, 2026-08-26. */
    const out = annotateHtml(HTML, [hitMark({ slot: CATEGORICAL_SLOTS })]);
    expect(out).not.toContain("data-hues");
    expect(out).not.toContain(`--cat-${CATEGORICAL_SLOTS}-rgb`);
  });

  it("gives a literal match no stripe attribute at all", () => {
    /* `slot: null` is a words-mode hit. `data-hues` must be ABSENT rather than
       "0", because the stylesheet falls back to the one fixed search hue on
       `:not([data-hues])` — and a slot of 0 would paint every literal match in
       the first categorical colour instead. */
    const out = annotateHtml(HTML, [hitMark({ slot: null })]);
    expect(out).toContain("mark");
    expect(out).not.toContain("data-hues");
    expect(out).not.toContain("--h0");
  });

  it("ignores a slot that is not a whole number", () => {
    /* The slot is interpolated into a custom-property *name*, so a NaN would
       emit `var(--cat-NaN-rgb)` — a reference to a property nobody defined,
       which is not an error and simply paints nothing. Silent, so it is pinned.
       @ts-expect-error is not needed: NaN is a number. */
    const out = annotateHtml(HTML, [hitMark({ slot: Number.NaN })]);
    expect(out).not.toContain("data-hues");
    expect(out).not.toContain("NaN");
  });

  it("still carries the confidence alongside the colours", () => {
    /* Two channels on one mark, and the split is the point: the wash says how
       sure, the stripes say which search. Losing either would look like the
       other still working. */
    const out = annotateHtml(HTML, [hitMark({ slot: 1, strength: 0.42 })]);
    expect(out).toContain("--hit-a:0.420");
    expect(out).toContain("--h0:var(--cat-1-rgb)");
  });
});

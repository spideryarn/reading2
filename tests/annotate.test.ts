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
import { readerCss } from "./helpers/stylesheets.js";
import {
  annotateHtml,
  BAR_HUES,
  HUE_STRIPES,
  renderedText,
  resolveMark,
  termMarks,
  type Mark,
} from "../src/web/annotate.js";
import { CATEGORICAL_SLOTS, PALETTE_SLOTS } from "../src/web/hit-colours.js";

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
    expect(out).toContain("data-cmt-open");
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

  it("marks nothing at all for an article with no glossary", () => {
    // The prose is untouched until there is a list — which is still the
    // ordinary case, because a glossary is generated on demand.
    expect(termMarks(blocks, []).size).toBe(0);
  });

  it("finds every occurrence, in the rendered-text offset space", () => {
    const found = termMarks(blocks, [selection]);
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
    const found = termMarks(blocks, [narrowed]);
    expect(found.has("spya-aaaaaa")).toBe(false);
    expect(found.has("spya-bbbbbb")).toBe(true);
  });

  it("draws a term underline that is not a comment", () => {
    const marks = termMarks(blocks, [selection]).get("spya-bbbbbb")!;
    const out = annotateHtml(blocks[1]!.html, marks);
    expect(out).toContain('class="term"');
    // A term is inert. `mark.cmt` is what the click handler in TableView
    // selects on, so carrying that class would make pressing a term try to
    // open a comment that does not exist.
    expect(out).not.toContain("data-comment");
    expect(out).not.toContain("data-mark-end");
    expect(out).toContain('data-term="spya-termid"');
  });

  /* ------------------------------------------------- the whole list at once --
     Since 2026-08-26 the prose carries every entry, in every mode, rather than
     the one the reader pressed — Greg's call, reversing the decision the test
     above used to assert. These are the three things that changed with it. */

  it("underlines every term in the list, not just one", () => {
    const second = {
      id: "spya-secnd1",
      forms: ["explanation"],
      blocks: ["spya-aaaaaa"],
    };
    const found = termMarks(blocks, [selection, second]);
    const first = found.get("spya-aaaaaa")!;
    // "nonreductive explanation" once, and "explanation" twice — the bare noun
    // appears again at the end of the sentence.
    expect(first.filter((m) => m.id === "spya-termid")).toHaveLength(1);
    expect(first.filter((m) => m.id === "spya-secnd1")).toHaveLength(2);
  });

  it("gives two overlapping terms ONE mark that names both", () => {
    // Commoner now that the whole list is drawn: "explanation" sits inside
    // "nonreductive explanation". Two nested <mark>s would stack two underlines
    // on the same words and read as a rendering bug.
    const inner = { id: "spya-inner1", forms: ["explanation"], blocks: ["spya-aaaaaa"] };
    const marks = termMarks(blocks, [selection, inner]).get("spya-aaaaaa")!;
    const out = annotateHtml(blocks[0]!.html, marks);
    const host = document.createElement("div");
    host.innerHTML = out;
    expect(host.querySelectorAll("mark mark")).toHaveLength(0);
    const both = [...host.querySelectorAll("mark")].find(
      (m) => (m.getAttribute("data-term") ?? "").split(" ").length === 2,
    );
    expect(both?.getAttribute("data-term")).toContain("spya-termid");
    expect(both?.getAttribute("data-term")).toContain("spya-inner1");
  });

  it("marks the pressed term differently from the rest", () => {
    // Being selected can no longer mean *having* a mark, so it has to mean a
    // different one — the same thing the open comment and the pressed search
    // hit already do, under an attribute of its own.
    const other = { id: "spya-other1", forms: ["problems"], blocks: ["spya-bbbbbb"] };
    const pressed = { ...selection, open: true };
    const marks = termMarks(blocks, [pressed, other]).get("spya-bbbbbb")!;
    const host = document.createElement("div");
    host.innerHTML = annotateHtml(blocks[1]!.html, marks);
    const open = host.querySelector("mark[data-term-open]");
    expect(open?.getAttribute("data-term")).toBe("spya-termid");
    // And the unpressed one is drawn, but plainly.
    const plain = [...host.querySelectorAll("mark.term")].find(
      (m) => m.getAttribute("data-term") === "spya-other1",
    );
    expect(plain).not.toBeUndefined();
    expect(plain?.hasAttribute("data-term-open")).toBe(false);
  });

  it("merges a comment and a term over the same words into ONE mark", () => {
    // Two nested <mark>s would stack two underlines on the same words, which
    // reads as a rendering bug. And the comment must keep `cmt` — a question
    // asked about a sentence does not stop being clickable because a glossary
    // term happens to sit in it.
    const marks = termMarks(blocks, [selection]).get("spya-bbbbbb")!;
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
    expect(host(out).querySelector("mark.hit")?.hasAttribute("data-hit-open")).toBe(true);
  });

  it("does not let one kind's pressed state leak onto another kind's mark", () => {
    /* The bug the per-kind attributes exist for. A merged mark carries every
       class that applies, so under one shared `data-open` a hit that merely
       OVERLAPPED a pressed term was drawn by `mark.hit[data-open]` as though
       the reader had pressed the hit. Underlining every term is what turned
       that from theoretical into ordinary. Found by a GPT Sol review,
       2026-08-26. */
    const out = annotateHtml(html, [
      { id: "t1", start: 3, end: 10, kind: "term", open: true },
      { id: "h1", start: 3, end: 10, kind: "hit", open: false },
    ]);
    const mark = host(out).querySelector("mark.term.hit");
    expect(mark).not.toBeNull();
    expect(mark?.hasAttribute("data-term-open")).toBe(true);
    expect(mark?.hasAttribute("data-hit-open")).toBe(false);
  });

  it("marks an open chat, which nothing used to read", () => {
    /* `mark.chat[data-open]` has been a real rule in styles.css and TableView
       has always passed `open` for chats, but `annotateHtml` never looked at
       it — so an open conversation was drawn as open only when it happened to
       overlap a comment or a hit. Same review. */
    const out = annotateHtml(html, [{ id: "c1", start: 3, end: 10, kind: "chat", open: true }]);
    expect(host(out).querySelector("mark.chat")?.hasAttribute("data-chat-open")).toBe(true);
  });
});

describe("annotateHtml — the colours of the searches that found the words", () => {
  const HTML = "<p>the mind is software running on wet hardware</p>";

  /* `as Mark` because `Mark` became a union on 2026-09-02 — a mark carrying a
     valence hue must also carry its direction and a real slot, which the type
     now refuses to let a caller get wrong (annotate.ts § `MarkValence`).
     Spreading a `Partial` of a union produces a union of partials that TS
     cannot narrow back, and the invariant is enforced where marks are actually
     built (`hitMarks` in search-hits.ts) rather than here. */
  const hitMark = (over: Partial<Mark> = {}): Mark =>
    ({
      id: "h1",
      start: 4,
      end: 8,
      kind: "hit",
      strength: 1,
      ...over,
    }) as Mark;

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
    /* A sixteen-hue palette has no `--cat-16-rgb`, so a slot of 16 emits a
       reference to a property nobody defined — invalid at computed-value time,
       which paints nothing. Exactly as silent as the NaN case above, and the
       reason the guard checks both ends of the range rather than just the
       bottom. Raised by a GPT Sol review, 2026-08-26.

       **`PALETTE_SLOTS`, not `CATEGORICAL_SLOTS`**, since 2026-08-27. This line
       said `CATEGORICAL_SLOTS` while the two were the same number, and it went
       red the day the palette grew — correctly, because slot 8 is now a real
       hue a reader can pick. The question the guard asks is "does this name a
       hue we have?", never "would the hash have chosen it?". */
    const out = annotateHtml(HTML, [hitMark({ slot: PALETTE_SLOTS })]);
    expect(out).not.toContain("data-hues");
    expect(out).not.toContain(`--cat-${PALETTE_SLOTS}-rgb`);
  });

  it("caps the paragraph bar at as many hues as the stylesheet can draw", () => {
    /* **`BAR_HUES` is not a property of the palette**, which is the whole
       reason it stopped being `CATEGORICAL_SLOTS` on 2026-08-27. It is the
       number of `td.text.has-hit[data-hues="N"]` rules styles.css actually
       defines, because that gradient's stops are written out per count. Set
       `data-hues="9"` with only eight rules and *no* rule matches, so the bar
       paints nothing at all — the whole mark vanishes rather than losing its
       ninth stripe. Nothing in TypeScript can see that, so it is checked
       against the stylesheet here rather than left to a comment. */
    /* The reading-view sheets as a set — `src/web/styles.css` has been the list
       of `@import`s since 2026-09-06, and these rules live in one of the files
       it names. tests/helpers/stylesheets.ts. */
    const css = readerCss();
    const counts = [
      ...css.matchAll(/td\.text\.has-hit\[data-hues="(\d+)"\]/g),
    ].map((m) => Number(m[1]));
    /* The vacuity guard: with no rules matched, `Math.max()` of nothing is
       `-Infinity` and the message would be about the number rather than about
       the scan having stopped seeing anything. */
    expect(
      counts.length,
      'no `td.text.has-hit[data-hues="N"]` rule in the reader stylesheets',
    ).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBe(BAR_HUES);
  });

  it("paints a hue only a reader could have chosen", () => {
    /* The other half of the same change: a slot in [8, 16) can never come out
       of `assignSlots`, so nothing upstream of here produces one by accident —
       and this is the line that decides whether a reader's own choice is drawn
       at all. A guard still bounded at eight would have dropped every
       hand-picked colour in the second half of the palette and painted the
       paragraph as though the search had matched nothing. */
    const out = annotateHtml(HTML, [hitMark({ slot: CATEGORICAL_SLOTS })]);
    expect(out).toContain('data-hues="1"');
    expect(out).toContain(`--cat-${CATEGORICAL_SLOTS}-rgb`);
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
       No suppression comment is needed here: NaN is a number, so this
       already typechecks. Note the missing `@`: TypeScript reads the
       expect-error directive out of block comments too, so writing its
       real spelling here — even mid-sentence, even to say we do not need
       it — turns this prose into a directive, and the typecheck then
       fails with an unused-directive error pointing at a comment. Which
       is what this comment did until 2026-08-26. */
    const out = annotateHtml(HTML, [hitMark({ slot: Number.NaN })]);
    expect(out).not.toContain("data-hues");
    expect(out).not.toContain("NaN");
  });

  /* ------------------------------- the two kinds of stripe share the band -- */

  /** A mark painted by direction — the shape `hitMarks` builds for a valence. */
  const valenceMark = (over: { id: string; hue: string; dir: "against" | "for" | "neither" }): Mark =>
    ({ id: over.id, start: 4, end: 8, kind: "hit", strength: 1, slot: 0, hue: over.hue, dir: over.dir }) as Mark;

  it("keeps a lane for the direction when six identities would fill the band", () => {
    /* **The starvation GPT Sol's finding 3 found in the built code.** The cap
       used to be applied to `[...identity, ...valence]`, so six single-ended
       criteria over one phrase took every lane and a diverging result over the
       same words drew **no colour at all** — while still printing its `−`,
       because the sign is written from a different branch. The stripes would
       then have said *six criteria matched here* and the sign *this counts
       against*, describing different facts side by side, which is the one thing
       this mark must never do: the sign is what pays for painting a judgement
       in colour in the first place.

       Six identities exactly, so this is the boundary rather than a case
       comfortably past it. Derived from `HUE_STRIPES` because the cap has moved
       once already. */
    const out = annotateHtml(HTML, [
      ...Array.from({ length: HUE_STRIPES }, (_, i) => hitMark({ id: `h${i}`, slot: i })),
      valenceMark({ id: "v", hue: "var(--div-rg-0-rgb)", dir: "against" }),
    ]);
    expect(out).toContain(`data-hues="${HUE_STRIPES}"`);
    expect(out, "the sign says 'against' and no lane is drawn in the against colour").toContain(
      "var(--div-rg-0-rgb)",
    );
    expect(out).toContain('data-dir="against"');
    /* And identity keeps the rest of the band rather than being cut to half of
       it: the guarantee is a floor for each kind, not a fixed split. */
    expect(out).toContain("--h4:var(--cat-4-rgb)");
  });

  it("keeps a lane for the criterion when six directions would fill the band", () => {
    /* The same reservation the other way round, which is the half a fix written
       only for the case that was reported would miss. A phrase inside six
       diverging results, marked by one ordinary search, must still show that
       the search found it. */
    const out = annotateHtml(HTML, [
      ...Array.from({ length: HUE_STRIPES }, (_, i) =>
        valenceMark({ id: `v${i}`, hue: `var(--div-rg-${i}-rgb)`, dir: "against" }),
      ),
      hitMark({ id: "h", slot: 6 }),
    ]);
    expect(out).toContain(`data-hues="${HUE_STRIPES}"`);
    expect(out).toContain("var(--cat-6-rgb)");
  });

  it("gives one kind the whole band when the other is absent", () => {
    /* The case that must not regress: every mark before referee mode existed,
       and most of them after. A reservation that always held three lanes back
       would silently halve the stripes on an eight-search phrase. */
    const out = annotateHtml(
      HTML,
      Array.from({ length: HUE_STRIPES + 2 }, (_, i) => hitMark({ id: `h${i}`, slot: i })),
    );
    expect(out).toContain(`data-hues="${HUE_STRIPES}"`);
    expect(out).toContain(`--h${HUE_STRIPES - 1}:var(--cat-${HUE_STRIPES - 1}-rgb)`);
  });

  /* ------------------------------------------ the sign over a partial overlap -- */

  it("says ± on a run two opposite directions both cover, not the one that ends there", () => {
    /* **GPT Sol's finding 5.** The sign is printed on the run where a valence
       mark *ends* — so a phrase broken across an `<em>` shows one sign rather
       than three — but it used to be *derived* from the ending marks alone. An
       against range over the whole sentence, overlapped by a for range over its
       first half, ends the `for` mark at the halfway cut: that run is drawn in
       both colours and used to print a bare `+`, hiding the against direction
       behind a plus sign. Which is worse than saying nothing, because it is a
       verdict this renderer invented.

       Two runs and two different answers, which is the assertion: `±` where
       both cover, `−` where only one does. Reverting the derivation to `ending`
       turns the first into "for". */
    const out = annotateHtml(HTML, [
      { id: "a", start: 0, end: 10, kind: "hit", strength: 1, slot: 0, hue: "var(--div-rg-0-rgb)", dir: "against" } as Mark,
      { id: "b", start: 0, end: 5, kind: "hit", strength: 1, slot: 0, hue: "var(--div-rg-8-rgb)", dir: "for" } as Mark,
    ]);
    const host = document.createElement("div");
    host.innerHTML = out;
    const marks = [...host.querySelectorAll("mark")];
    expect(marks.map((m) => m.getAttribute("data-dir"))).toEqual(["mixed", "against"]);
    /* And the overlapping run really is drawn in both colours, so the sign and
       the stripes are describing the same fact. */
    expect(marks[0]?.getAttribute("data-hues")).toBe("2");
  });

  it("still says one direction on a run only one mark covers", () => {
    /* The control for the case above: deriving from every *covering* mark must
       not turn an ordinary single-direction phrase into `±`, which would be a
       renderer that had stopped being able to answer at all. */
    const out = annotateHtml(HTML, [
      valenceMark({ id: "a", hue: "var(--div-rg-8-rgb)", dir: "for" }),
    ]);
    expect(out).toContain('data-dir="for"');
    expect(out).not.toContain("mixed");
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

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
import { annotateHtml, renderedText, resolveMark } from "../src/web/annotate.js";

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

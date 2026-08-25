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

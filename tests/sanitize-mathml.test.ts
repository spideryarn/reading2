/**
 * MathML through the sanitiser, and the one thing it used to promote into prose.
 *
 * Found on 2026-08-28 while measuring what Readability does to equation-heavy
 * pages (docs/plans/readability-repair-pass.md). A `<math>` carrying a
 * machine-readable TeX copy of itself —
 * `<semantics><mrow>…</mrow><annotation encoding="application/x-tex">…</annotation></semantics>`,
 * which is what Wikipedia and LaTeXML both emit — came out with the wrappers
 * gone and the TeX left behind as a bare text node inside the formula.
 *
 * **Not a rendering bug.** Chrome paints the formula identically either way; a
 * bare text node inside `<math>` is not in a token element, so MathML layout
 * ignores it, and the box measures the same width with and without. Verified in
 * a browser before this was written up, because the first draft claimed readers
 * were seeing `\frac{1}{2}` and they were not.
 *
 * **A `textContent` bug instead**, which is why it still matters: `textContent`
 * is what every stage after 2 reads. On the ar5iv *Attention Is All You Need*,
 * 25 of 151 blocks carried TeX in their text — 486 characters — so summaries,
 * ideas, the glossary, search, quote-matching and every embedding saw each
 * formula twice, once as symbols and once as source.
 *
 * The wrappers are stripped on purpose: DOMPurify lists `semantics`,
 * `annotation` and `annotation-xml` as `mathMlDisallowed`, and `annotation-xml`
 * is an **HTML integration point**, one of the classic mXSS surfaces. So the fix
 * is emphatically *not* to allow them back. It is to stop keeping the contents
 * of a wrapper we are dropping — strictly more restrictive than before, and it
 * removes a duplicate representation the reader was never meant to see.
 */
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../src/sanitize.js";

const TEX = "\\frac{1}{2}\\sqrt{x}";

describe("MathML survives sanitising", () => {
  it("keeps the presentation elements a formula is made of", () => {
    const html =
      `<p>Attention is <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>Q</mi>` +
      `<mo>&#x22C5;</mo><msup><mi>K</mi><mi>T</mi></msup></mrow></math> scaled.</p>`;
    const clean = sanitizeHtml(html);
    for (const tag of ["math", "mrow", "mi", "mo", "msup"]) {
      expect(clean, `<${tag}> should survive`).toContain(`<${tag}`);
    }
  });

  it("keeps a fraction and a root, which is what a formula usually is", () => {
    const html = `<p>See <math><mfrac><mn>1</mn><mn>2</mn></mfrac><msqrt><mi>x</mi></msqrt></math>.</p>`;
    const clean = sanitizeHtml(html);
    expect(clean).toContain("<mfrac");
    expect(clean).toContain("<msqrt");
  });
});

describe("the TeX annotation does not become prose", () => {
  const withAnnotation =
    `<p>See <math><semantics><mrow><mi>x</mi></mrow>` +
    `<annotation encoding="application/x-tex">${TEX}</annotation></semantics></math> here.</p>`;

  it("drops the TeX source rather than leaving it in the block's text", () => {
    const clean = sanitizeHtml(withAnnotation);
    expect(clean).not.toContain("\\frac");
    expect(clean).not.toContain("\\sqrt");
  });

  it("still keeps the formula itself", () => {
    const clean = sanitizeHtml(withAnnotation);
    expect(clean).toContain("<math");
    expect(clean).toContain("<mi");
    expect(clean).toContain("x");
  });

  it("does not allow the wrappers back — annotation-xml is an mXSS surface", () => {
    const clean = sanitizeHtml(withAnnotation);
    expect(clean).not.toContain("<semantics");
    expect(clean).not.toContain("<annotation");
  });

  it("drops annotation-xml's contents too, markup and all", () => {
    const html =
      `<p><math><semantics><mrow><mi>y</mi></mrow>` +
      `<annotation-xml encoding="text/html"><span>secret payload text</span></annotation-xml>` +
      `</semantics></math></p>`;
    const clean = sanitizeHtml(html);
    expect(clean).not.toContain("secret payload text");
    expect(clean).not.toContain("<annotation-xml");
    expect(clean).toContain("<mi");
  });

  it("has not replaced DOMPurify's own forbid-contents list", () => {
    /* **The bug this fix nearly shipped, pinned as a test.** The first version
       set `FORBID_CONTENTS` in the config, which REPLACES DOMPurify's default
       list rather than extending it — and the hand-copied array was missing
       `selectedcontent`, whose contents DOMPurify drops specifically to stop an
       infinite re-mirroring loop it documents as a denial of service. Seven
       tests went green over it.

       `<selectedcontent>` is checked here rather than `<script>` because script
       is caught by half a dozen other things; this one is caught by nothing
       else we own. If a future change reintroduces a hand-written list, this
       fails.

       Bare, NOT inside a `<select>`. The first attempt wrapped it the way the
       HTML spec does, and failed against the correct code too — `select` and
       `option` are in our own `FORBID_TAGS`, so the wrapper is unwrapped and
       its text hoisted before this rule ever gets a look. The test was
       measuring our config, not DOMPurify's list. */
    const clean = sanitizeHtml("<div><selectedcontent>mirrored text</selectedcontent></div>");
    expect(clean).not.toContain("mirrored text");
  });

  it("leaves an ordinary paragraph's text alone", () => {
    /* The guard on the guard: a rule that drops the contents of one element is
       one typo away from dropping the contents of everything. */
    const clean = sanitizeHtml("<p>A perfectly ordinary sentence with no mathematics in it.</p>");
    expect(clean).toContain("A perfectly ordinary sentence with no mathematics in it.");
  });
});

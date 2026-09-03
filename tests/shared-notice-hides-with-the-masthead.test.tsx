/**
 * **The visitor's notice must go wherever the masthead goes.**
 *
 * At iPad-portrait and below the mode band is full width, so `styles.css` hides
 * the article's masthead while one is open — the reasoning is written out at
 * that rule, and it ends *"the controls bar sticks at zero immediately and the
 * band sits exactly underneath it"*. The controls bar was the next thing in the
 * document when that was written. It is not, for a visitor: `SharedNotice` sits
 * between the two, and nothing hid it.
 *
 * So the notice became the first element on the page at `y: 0`, directly under
 * `.logo-home`, which is `position: fixed` at the same origin and cannot be
 * pushed by anything in flow. Measured in a browser on 2026-08-29 at 820px —
 * logo `(0,0,136,44)` against notice `(32,0,768,66)`, **4,576px² of overlap**,
 * both illegible where they crossed; and again at 390px, 1,320px². Found by a
 * browser pass; jsdom does no layout, so nothing in this suite could have.
 *
 * ## What this file can and cannot do
 *
 * It cannot measure the overlap. What it can do is hold the two halves of the
 * fix together, because the bug was never really about a rectangle — it was
 * that a rule about *the strip above the band* named one of the two things in
 * it. Any third thing added there will have the same bug.
 *
 * The first assertion is real: `SharedNotice` renders, and it carries the class
 * the stylesheet targets. Rename the class in the component and this goes red,
 * which is the failure a stylesheet cannot notice.
 *
 * The second is a **static gate and worth exactly what those are worth** — it
 * reads the file rather than the browser, so it proves the rule is written, not
 * that it applies. It is here because deleting it is the likely regression and
 * it is free. The browser measurement is in
 * docs/plans/260827ai-public-read-only-access.md § The logo sat on the sentence, with the
 * numbers either side of the fix.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SharedNotice } from "../src/web/PublicChrome.js";

const CSS = readFileSync(path.join(process.cwd(), "src/web/styles.css"), "utf8");

/**
 * The rule the whole thing hangs off, verbatim.
 *
 * **`.band-covers` since 2026-09-03.** These two rules used to sit inside
 * `@media (max-width: 843px)`, a width the stylesheet could not get right in
 * both spine states; `App.tsx` writes the fact as a class on `.reader` now and
 * these key off that (styles.css § a band with no room). Nothing about the
 * pairing changed, which is what this file is really about.
 */
const HIDES_MASTHEAD = ".reader.band-covers:has(.mode-band) .masthead { display: none; }";
const HIDES_NOTICE = ".reader.band-covers:has(.mode-band) .shared-notice { display: none; }";

describe("a visitor's notice, in the strip the band takes over", () => {
  it("carries the class the stylesheet reaches it by", () => {
    /* The ordinary notice: a session we could confirm, or none at all. The
       unconfirmed arm adds a second paragraph inside this same box, so it is
       covered by the same rule and needs no assertion of its own here.
       src/web/PublicChrome.tsx § SharedNotice. */
    const html = renderToStaticMarkup(<SharedNotice signedIn={false} sessionUnconfirmed={false} />);
    /* The class, not a substring of some Tailwind utility: `shared-notice`
       appears in `tw:` names nowhere, but asserting the attribute boundary is
       what stops that from becoming true later. */
    expect(html).toMatch(/class="[^"]*\bshared-notice\b/);
    /* And it really is the notice, so a component that rendered nothing but the
       right class could not pass. */
    expect(html).toContain("shared this article with you");
  });

  it("is hidden under the same condition, beside the masthead's rule", () => {
    /* Two halves, and the second is the invariant that matters:

       - the notice's rule follows the masthead's, close enough to be read as
         one decision rather than found by grep;
       - and it carries `.band-covers`, so it is conditional. An unguarded
         `.shared-notice { display: none }` would hide the notice at every
         width, including the reading view where it is the entire point — which
         is what the `@media` block this pair used to live in was buying. */
    const at = CSS.indexOf(HIDES_MASTHEAD);
    expect(at, "the masthead rule this one is paired with has moved or changed").toBeGreaterThan(-1);
    const near = CSS.indexOf(HIDES_NOTICE, at);
    expect(near, "the notice's rule is not below the masthead's any more").toBeGreaterThan(-1);
    expect(
      near - at,
      "the two rules have drifted apart; they are one decision and should read as one",
    ).toBeLessThan(2000);
    /* And nothing hides it unconditionally. Read from the stylesheet with its
       comments stripped, because this file and styles.css are both full of
       prose quoting rules that no longer exist. */
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const hides = [...code.matchAll(/^.*\.shared-notice\s*\{[^}]*display:\s*none/gm)].map((m) =>
      m[0].trim(),
    );
    expect(hides.length, "expected exactly one rule to hide the notice").toBe(1);
    expect(hides[0]).toContain(".band-covers");
  });
});

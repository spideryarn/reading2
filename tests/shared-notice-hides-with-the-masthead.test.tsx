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

/** The rule the whole thing hangs off, verbatim. */
const HIDES_MASTHEAD = ".reader:has(.mode-band) .masthead { display: none; }";

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

  it("is hidden by the same rule, in the same block, as the masthead", () => {
    /* Same `@media` block, which is the invariant — a rule sitting at top level
       would hide the notice at every width, including the reading view where it
       is the entire point. Sliced from the masthead rule to the end of its
       block rather than searched for globally. */
    const at = CSS.indexOf(HIDES_MASTHEAD);
    expect(at, "the masthead rule this one is paired with has moved or changed").toBeGreaterThan(-1);
    const blockEnd = CSS.indexOf("\n}", at);
    const rest = CSS.slice(at, blockEnd);
    expect(rest).toContain(".reader:has(.mode-band) .shared-notice { display: none; }");
  });
});

// @vitest-environment jsdom
/**
 * **A link out of the article opens a new tab, and one out of the app never
 * replaces the app.**
 *
 * > So I'm using Spideryarn shared to home page, and so if I click the link I
 * > certainly don't want it to open instead of Spideryarn, so then I have to
 * > click back. I wanted to open in a new blank tab or whatever.
 * >
 * > — Greg, 2026-09-04 (SPIDERYARN-READING2-10)
 *
 * Added to a home screen there is no browser chrome, so an in-place navigation
 * takes the whole app away and leaves nothing to go back with.
 *
 * The rule lives on the **browser** sanitiser (`src/web/sanitize.ts`), which is
 * why this file runs under jsdom: that pass is the one thing every article goes
 * through on every load, so the rule reaches articles ingested before it
 * existed. Two halves are asserted here and neither is decoration —
 *
 * - that the attributes are written on the links that leave, and
 * - that they are **not** written on the ones that do not, which is the half a
 *   regex fix would get wrong. A `mailto:` opening a blank tab is litter, and a
 *   same-origin link opening a second copy of Spideryarn is the report's own
 *   complaint pointed the other way.
 *
 * The pinned precondition — that DOMPurify strips an author's own `target` — is
 * what makes "only our hook can write one" true, and it was measured rather than
 * assumed: `src/web/TableView.tsx` carried a comment saying the opposite for
 * weeks.
 */
import { describe, expect, it } from "vitest";

import { sanitizeBlockHtml } from "../src/web/sanitize.js";

/** The first `<a>` of a sanitised block, as a real element. */
function anchor(html: string): HTMLAnchorElement | null {
  const holder = document.createElement("div");
  holder.innerHTML = sanitizeBlockHtml(html);
  return holder.querySelector("a");
}

describe("a link that leaves the app", () => {
  it("opens a new tab, without a referrer or an opener", () => {
    const a = anchor('<p><a href="https://gwern.net/xanadu">Xanadu</a></p>');
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the destination exactly as the author wrote it", () => {
    const href = "https://philpapers.org/rec/BUTAAT?x=1#frag";
    expect(anchor(`<p><a href="${href}">a paper</a></p>`)?.getAttribute("href")).toBe(href);
  });

  /* `http:` too, not only `https:` — an old page's links are the ones most
     likely to be worth leaving for, and a rule that covers one scheme of two
     looks exactly like a rule that covers both. */
  it("covers plain http", () => {
    const a = anchor('<p><a href="http://example.test/old">old</a></p>');
    expect(a?.getAttribute("target")).toBe("_blank");
  });
});

describe("a link that does not", () => {
  it("leaves an in-article fragment alone", () => {
    const a = anchor('<p><a href="#spya-k3m9qt">above</a></p>');
    expect(a?.hasAttribute("target")).toBe(false);
  });

  it("leaves a relative link alone", () => {
    const a = anchor('<p><a href="/library">the shelf</a></p>');
    expect(a?.hasAttribute("target")).toBe(false);
  });

  /* A blank tab that hands off to the mail client and then sits there empty is
     litter, and the reader never asked for it. */
  it("leaves a mailto alone", () => {
    const a = anchor('<p><a href="mailto:hi@example.test">write</a></p>');
    expect(a?.hasAttribute("target")).toBe(false);
  });

  /* The reading view is the app; a link back into it should stay in it. jsdom
     serves `http://localhost:3000` by default, so this is a genuine
     same-origin URL rather than a contrived one. */
  it("leaves a link back into Spideryarn alone", () => {
    const a = anchor(`<p><a href="${window.location.origin}/read/x">here</a></p>`);
    expect(a?.hasAttribute("target")).toBe(false);
  });
});

/**
 * **The invariant the whole design rests on.**
 *
 * If an author's `target` could reach the reader, a publisher could aim a link
 * at `_top` and take the app away on purpose — and the hover card's tap rule,
 * which is keyed on `target="_blank"`, would be theirs to opt into as well.
 */
describe("the article may not choose its own target", () => {
  it("drops a target the publisher wrote, and writes ours instead", () => {
    const a = anchor('<p><a href="https://example.test/x" target="_top">out</a></p>');
    expect(a?.getAttribute("target")).toBe("_blank");
  });

  it("drops one on a link that stays in the app", () => {
    const a = anchor('<p><a href="#spya-k3m9qt" target="_top">up</a></p>');
    expect(a?.hasAttribute("target")).toBe(false);
  });
});

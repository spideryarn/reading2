/**
 * **Every link that leaves this app opens a new tab** — the presentation rule,
 * kept deliberately outside the sanitiser.
 *
 * > So I'm using Spideryarn shared to home page, and so if I click the link I
 * > certainly don't want it to open instead of Spideryarn, so then I have to
 * > click back. I wanted to open in a new blank tab or whatever.
 * >
 * > — Greg, 2026-09-04 (SPIDERYARN-READING2-10)
 *
 * Added to a home screen, Spideryarn runs as a standalone web app: there is no
 * browser chrome, so a link that navigates in place replaces the whole app and
 * leaves the reader nothing to go back with. On the desktop the same click only
 * loses their place — worse than a new tab, and not the emergency. It is one
 * rule on both, so there is one behaviour to explain rather than two.
 *
 * ## Why this is its own file, and not a DOMPurify hook
 *
 * It **was** a hook on the browser sanitiser, from 0f754742 until 2026-09-04,
 * and that broke a property worth more than the convenience: the two sanitiser
 * bindings stopped being byte-for-byte the same function. `tests/sanitize-client.test.ts`
 * pins that equality and went red, and the comment at the top of it says why —
 * two passes that disagree "look like defence in depth and are really two
 * half-policies". A sanitiser answers *what is allowed*; where a link opens is
 * *how it is presented*, and a presentation rule living inside the security
 * seam is how that seam quietly stops being checkable.
 *
 * So: one policy, shared by both bindings and identical on both sides, and then
 * this, afterwards, on the browser only.
 *
 * ## Why at ingress, and not at the render sink
 *
 * `sanitizeArticle` (src/web/sanitize.ts) applies this once, as the article
 * arrives, to the same string it has just sanitised — so it reaches **every**
 * article already on the shelf, with nothing re-extracted, and it reaches every
 * place that html is later injected. That last part is the load-bearing half,
 * because `block.html` reaches the DOM at more than one sink:
 *
 *   - the prose column, `TableView.tsx` § `proseHtml`;
 *   - the note preview card, `notes-view.ts` § `notePreviewHtml` — a floating
 *     card whose links are live and are **not** inside `.prose`, so nothing
 *     else covers them, and a gwern footnote is mostly external links;
 *   - the figure lightbox, `Lightbox.tsx`.
 *
 * A pass bolted onto one sink would leave the other two navigating in place,
 * which is the reported complaint, unfixed, in the two places nobody looks.
 *
 * There is no per-render cost either: this runs once per article load, not on
 * the render path that `tests/prose-not-rebuilt.test.tsx` guards.
 *
 * ## What makes it safe
 *
 * **`target` is not in the sanitiser's allowlist.** Measured 2026-09-04:
 * DOMPurify drops `target` from article markup (`tests/prose-links-new-tab.test.ts`
 * pins it), so by the time this runs no anchor carries one, and the only
 * `target` that can reach a reader is the one written here. A publisher cannot
 * aim a link at `_top`, at a named frame, or at anything else — and cannot opt
 * into the hover card's tap rule, which is keyed on `target="_blank"`
 * (`ProseHoverCard.tsx`). **That is why the order is sanitise, then this**, and
 * never the other way round.
 *
 * Same-origin links are left alone: an `<a>` back into Spideryarn should stay
 * in Spideryarn, which is the whole point of the report.
 */

/**
 * An inert document to parse into, made once and reused.
 *
 * `createHTMLDocument` has no browsing context, so nothing loads and nothing
 * runs while the html sits in it — the same instrument, for the same reason, as
 * `notePreviewHtml` in notes-view.ts.
 *
 * A `<div>`, which is **what the reading view itself parses this html in** —
 * `TableView`'s `.prose` cell, the note preview card and the lightbox are all
 * `<div>`s. That is the equivalence worth having; it is deliberately *not* the
 * claim that this is DOMPurify's own context, which it is not (the installed
 * DOMPurify parses a whole document and serialises `body.innerHTML`). GPT Sol
 * corrected an earlier version of this comment that made the wrong claim,
 * 2026-09-04.
 */
let holder: HTMLElement | null = null;

function inertHolder(): HTMLElement {
  if (!holder) holder = document.implementation.createHTMLDocument("").createElement("div");
  return holder;
}

/** SVG 1.1's spelling of `href`, which SVG 2 deprecates and the policy allows. */
const XLINK = "http://www.w3.org/1999/xlink";

/**
 * Every element that is a hyperlink a reader can follow, not just `<a>`.
 *
 * `<area>` is an image map's link and behaves exactly like an anchor; an SVG
 * `<a>` inside inline SVG is one too, and it may spell its destination
 * `xlink:href`. Measured across the whole local store on 2026-09-04: **0 blocks
 * of 5,301** carry any of `xlink:href`, `<area>`, or an `<a>` inside an `<svg>`.
 * They are handled anyway, because the rule's promise is *every* link that
 * leaves the app and a promise with three quiet exceptions is not one. GPT Sol
 * found them, 2026-09-04.
 */
const LINKS = "a, area";

/**
 * Where this element sends the reader, whichever way it spells it.
 *
 * `href` wins over `xlink:href` — that is SVG 2's own rule, and it is what the
 * browser will do with an element carrying both.
 */
function destination(el: Element): string | null {
  return el.getAttribute("href") ?? el.getAttributeNS(XLINK, "href");
}

/**
 * Does following this href take the reader out of the app?
 *
 * The sanitiser's URI policy has already run, so a `javascript:`, `data:` or
 * `blob:` href is not something this can be handed — and this deliberately does
 * not build a second allowlist beside it. What it decides is *where a link
 * goes*, not whether it is allowed to exist.
 *
 * `http`/`https` only. A `mailto:` or a `tel:` hands off to another app and a
 * blank tab left behind is litter; an in-article `#fragment` is a jump we
 * handle ourselves. Anything that will not parse — a relative href with no base
 * to resolve against — resolves to our own origin and stays.
 */
export function leavesTheApp(href: string | null): boolean {
  if (!href) return false;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.origin !== window.location.origin;
}

/**
 * One block's **already-sanitised** html, with every outbound link aimed at a
 * new tab.
 *
 * Returns the input string **unchanged** when there was nothing to rewrite, and
 * that is not just an optimisation: it means a block with no external links is
 * never reparsed and never reserialised, so this pass cannot perturb the html
 * of the overwhelming majority of blocks, and `sanitizeArticle`'s identity
 * check still hands React the very same block object.
 */
export function openExternalLinksInNewTab(html: string): string {
  // Cheap gate before the parser: most blocks contain no link at all.
  if (!/<a(?:rea)?[\s>]/i.test(html)) return html;

  const div = inertHolder();
  div.innerHTML = html;
  let changed = false;
  for (const link of Array.from(div.querySelectorAll(LINKS))) {
    const href = destination(link);
    if (!leavesTheApp(href)) continue;
    /* **One spelling of a link reaches the reader.** An SVG anchor that said
       only `xlink:href` gets a plain `href` too, so the hover card's
       `closest("a[href]")`, `internalTarget` and the touch rule all find the
       destination the same way this pass did. Widening the rewrite without
       widening those would be exactly the disagreement this file exists to
       avoid — GPT Sol's point, 2026-09-04. */
    if (href && link.getAttribute("href") === null) link.setAttribute("href", href);
    /* **Removed before they are set**, so the serialised order is the same
       whether or not the author wrote a `rel` of their own. Otherwise a `rel`
       already on the element stays in place and `target` lands after it, and
       one round of ingress produces a different string from two — a block
       allocated afresh for no reason. GPT Sol, 2026-09-04. */
    link.removeAttribute("target");
    link.removeAttribute("rel");
    link.setAttribute("target", "_blank");
    /* `noreferrer` as well as `noopener`: the address of the article being read
       is a reading history, and a link the article supplied should not be handed
       ours. The same pair the hover card's own "open in a new tab" uses. It
       replaces the author's `rel` rather than joining it — a `nofollow` or a
       `license` is not worth the risk of a hand-written `rel` that drops one of
       our two. */
    link.setAttribute("rel", "noopener noreferrer");
    changed = true;
  }
  const out = changed ? div.innerHTML : html;
  div.textContent = ""; // don't hold an article's DOM alive between loads
  return out;
}

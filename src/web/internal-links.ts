/**
 * The article's own links, from one part of itself to another.
 *
 * A published page often links to its own sections — the Anthropic
 * constitution has five, "see the section on how we think about corrigibility"
 * among them. Those are `<a href="#some-id">`, and the reading view has to
 * decide what a click on one means.
 *
 * It cannot mean what it means on the original page. Two things are different
 * here:
 *
 *  - **The id has been renamed.** Stage 3 gives every block a spideryarn id and
 *    overwrites the author's (docs/project/block-ids.md), so by the time the
 *    HTML reaches this file the hrefs have already been repointed at ours —
 *    `retargetAnchors` in src/blocks.ts. That is where the rename is undone;
 *    this file is the other end of it.
 *  - **A native hash jump lands in the wrong place, and says nothing.** The
 *    browser puts the target's top edge at the top of the viewport, which here
 *    is behind two sticky bars, and it leaves `?at=` saying the reader is still
 *    where they were. Every other way of moving through this article goes
 *    through `scrollToBlock` and records where it went (src/web/scroll.ts,
 *    docs/project/url-state.md), and an internal link has no business being the
 *    one exception.
 *
 * So a click is resolved to a **block**, and handed to the same jump every gist,
 * spine segment and arrow key uses.
 *
 * **Which block, when the fragment is not itself a block id.** Stage 3 resolves
 * every anchor it can to a block, so after a fresh ingest this case should not
 * arise. It still has to be handled, because an article on disk from before
 * that landed has not been through it — and because an id on something smaller
 * than a block (a footnote span, an `<a name>`) survives stage 3 untouched and
 * is genuinely still in the document. Those links resolve to the *row that
 * contains* the target, which is the finest thing this view can put under the
 * reader's eye, and which is the same answer stage 3 would have given.
 *
 * Returns null for everything else, and null means **leave it to the browser**:
 * a link out to the web, a fragment nothing in this document answers to, `#`
 * on its own. Refusing to act is the honest response to a link we cannot
 * resolve — inventing a destination would be worse than the dead link.
 */
import { isSpideryarnId } from "../ids.js";

export function internalTarget(target: Element, doc: Document): string | null {
  const anchor = target.closest?.("a[href]");
  const href = anchor?.getAttribute("href");
  // `#` alone is a real thing in the wild and means "the top of this page",
  // which is not a block.
  if (!href || href.length < 2 || !href.startsWith("#")) return null;

  const fragment = decodeFragment(href.slice(1));
  const escaped = cssEscape(fragment);
  if (isSpideryarnId(fragment)) {
    return find(doc, `tr[data-block="${escaped}"]`)?.getAttribute("data-block") ?? null;
  }
  /* An id anywhere in the document beats a named anchor that claims the same
     word — the order the HTML spec resolves a fragment in, and the order stage
     3 renames them in (src/blocks.ts § WAS_ID). One selector matching either
     would return whichever came first in the document instead. */
  const named = find(doc, `[id="${escaped}"]`) ?? find(doc, `a[name="${escaped}"]`);
  return named?.closest("tr[data-block]")?.getAttribute("data-block") ?? null;
}

/**
 * `querySelector` throws on a selector it cannot parse, and the fragment in it
 * came out of somebody else's HTML. A strange link is not a reason for a click
 * to take the reading view down with it.
 */
function find(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector);
  } catch {
    return null;
  }
}

/** `decodeURIComponent` throws on a lone `%`; a malformed fragment is just text. */
function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * `CSS.escape` where there is one. jsdom has had it since 22 and every browser
 * we support has it; the fallback is here so a test environment without it
 * fails by not matching rather than by throwing.
 */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value;
}

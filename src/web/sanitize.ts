/**
 * The **browser** half of sanitising an article, and the one that actually
 * guards the render.
 *
 * Stage 3 already sanitised this HTML before storing it. Doing it again here is
 * not belt-and-braces nervousness — it closes a specific gap. The server pass
 * ran under **jsdom's** HTML parser; this page runs **Chrome's**. Two parsers
 * that disagree about the same bytes is the entire mechanism of mutation XSS,
 * and the disagreements are documented rather than hypothetical: DOMPurify's own
 * README names attack vectors present in specific jsdom versions and treats the
 * server DOM as part of your trusted computing base. Sanitising in the engine
 * that will render the result removes the differential instead of hoping about
 * it.
 *
 * It also means an article stored *before* the sanitiser existed still renders
 * safely — old `blocks.json` files are not retroactively cleaned on disk.
 *
 * ## Why at ingress, and not at the render sink
 *
 * This runs once when the article arrives (src/web/App.tsx), before anything
 * else looks at the HTML. Putting it next to `dangerouslySetInnerHTML` instead
 * would be too late, because React is not the first browser parser to touch the
 * string — there are two ahead of it in src/web/annotate.ts:
 *
 *   - `renderedText` does `div.innerHTML = html` to measure the offset space
 *     comments are anchored in, on every block;
 *   - `annotateHtml` does it again to wrap comment marks — and it has a fast
 *     path that returns the string **unparsed** when a block has no comments,
 *     so a sanitiser bolted onto its tail would skip almost every block anyway.
 *
 * Sanitising first also keeps the policy single. Annotation *adds* the
 * `data-comment` / `data-mark-end` / `data-open` attributes and the `cmt` class
 * that the policy deliberately forbids in source markup, so a pass placed after
 * it would need a second, laxer config — and the drift between two configs is a
 * better bug than the one it fixes. Sanitise, then annotate, and one policy
 * covers both ends. See docs/project/security.md.
 *
 * Identified by GPT-5's design review, 2026-08-25, which is also where the "not
 * at the sink" reasoning came from.
 */

import DOMPurify from "dompurify";
import type { Article } from "../types.js";
import { ARTICLE_CONFIG, installArticlePolicy } from "../sanitize-policy.js";

/*
 * Our **own** instance, not the shared default export — which is already bound
 * to `window` and would work.
 *
 * `addHook` appends; it does not replace. The default export is a singleton
 * shared with anything else that imports DOMPurify, so installing onto it means
 * a second evaluation of this module registers the policy hook a second time.
 * Vite's HMR re-evaluates modules on every edit, so in dev the hooks pile up and
 * — worse than the duplication — a stale callback from before an edit keeps
 * running alongside the new one, which makes the sanitiser's dev behaviour quietly
 * disagree with its source until a full reload. A private instance per module
 * evaluation cannot accumulate, and it mirrors what the server binding does.
 * Found by GPT-5's review, 2026-08-25.
 *
 * No jsdom appears anywhere in this module graph, which is the whole reason the
 * policy lives in its own file rather than in src/sanitize.ts — whose first
 * import is jsdom, and which would drag a Node HTML parser into the browser
 * bundle.
 */
const purify = DOMPurify(window);
installArticlePolicy(purify);

/**
 * **Every link that leaves this app opens a new tab.**
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
 * **Here, not in the shared policy**, and that is deliberate. `ARTICLE_CONFIG`
 * governs what is *stored*, and rewriting an author's markup to record a
 * decision about our own reading view would put it in the export, in the
 * public payload and in every model prompt. This is a rendering rule, so it
 * lives on the browser pass that runs at ingress on every load — which also
 * means it applies to every article already on the shelf, with nothing
 * re-extracted.
 *
 * **`target` is not in the sanitiser's allowlist, and that is what makes this
 * safe.** Measured 2026-09-04: DOMPurify drops `target` from article markup
 * (`tests/prose-links-new-tab.test.ts` pins it), so by the time this hook runs no anchor carries
 * one, and the only `target` that can reach a reader is the one written below.
 * A publisher therefore cannot aim a link at `_top`, at a named frame, or at
 * anything else. *(A comment in TableView.tsx said the sanitiser keeps an
 * article's own `target`. It never did.)*
 *
 * Same-origin links are left alone: an `<a>` back into Spideryarn should stay
 * in Spideryarn, which is the whole point of the report.
 */
purify.addHook("afterSanitizeAttributes", (node) => {
  // Duck-typed for the same reason the shared policy's hook is — see it.
  const el = node as Element;
  if (el.tagName !== "A") return;
  if (!leavesTheApp(el.getAttribute("href"))) return;
  el.setAttribute("target", "_blank");
  /* `noreferrer` as well as `noopener`: the address of the article being read
     is a reading history, and a link the article supplied should not be handed
     ours. The same pair the hover card's own "open in a new tab" uses. */
  el.setAttribute("rel", "noopener noreferrer");
});

/**
 * Does following this href take the reader out of the app?
 *
 * `http`/`https` only. A `mailto:` or a `tel:` hands off to another app and a
 * blank tab left behind is litter; an in-article `#fragment` is a jump we
 * handle ourselves. Anything that will not parse — a relative href with no base
 * to resolve against — resolves to our own origin and stays.
 */
function leavesTheApp(href: string | null): boolean {
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

/** One block's HTML, made safe for this engine to parse. */
export function sanitizeBlockHtml(html: string): string {
  return purify.sanitize(html, { ...ARTICLE_CONFIG });
}

/**
 * An article with every block's HTML re-sanitised, done once at ingress.
 *
 * Returns a new object rather than mutating: `Article` comes straight from
 * `res.json()` and nothing else should be holding the unsanitised version, but
 * a function that quietly rewrites its argument is a poor neighbour to React's
 * assumptions about props.
 *
 * Only `html` is touched. `text` is never rendered as markup — it goes to the
 * model and into offset arithmetic — so rewriting it here would change the
 * offset space comments are anchored in for no gain at all.
 */
export function sanitizeArticle(article: Article): Article {
  return {
    ...article,
    blocks: article.blocks.map((b) => {
      const clean = sanitizeBlockHtml(b.html);
      return clean === b.html ? b : { ...b, html: clean };
    }),
  };
}

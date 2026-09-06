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
 * This runs once when the article arrives (src/web/article/access.ts), before anything
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
import { openExternalLinksInNewTab } from "./external-links.js";

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
 * One block's HTML, made safe for this engine to parse.
 *
 * **This is the policy and nothing else**, and `tests/sanitize-client.test.ts`
 * pins it to be byte-for-byte what the server binding produces for the same
 * input, and to be a no-op on its output. Nothing that decides how the reading
 * view *presents* a block belongs in here — the new-tab rule was written as a
 * DOMPurify hook on 2026-09-04 and broke both of those assertions within the
 * day. It lives in external-links.ts, applied by `sanitizeArticle` below.
 */
export function sanitizeBlockHtml(html: string): string {
  return purify.sanitize(html, { ...ARTICLE_CONFIG });
}

/**
 * An article as the reading view wants it, done once at ingress: every block's
 * HTML re-sanitised in this engine, and then every link out of the app aimed at
 * a new tab.
 *
 * **Two passes, in that order, and the order is the safety argument.** The
 * sanitiser strips an author's own `target`, so by the time the second pass
 * runs the only `target` that can exist is the one it writes —
 * [external-links.ts](./external-links.ts) has the reasoning, and
 * `tests/prose-links-new-tab.test.ts` pins the precondition.
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
      const clean = openExternalLinksInNewTab(sanitizeBlockHtml(b.html));
      return clean === b.html ? b : { ...b, html: clean };
    }),
  };
}

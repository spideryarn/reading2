/**
 * The **server** half of sanitising an article: DOMPurify bound to jsdom, for
 * stage 3.
 *
 * The policy itself — what survives, what doesn't, and why — is in
 * [`sanitize-policy.ts`](sanitize-policy.ts), shared with the browser pass in
 * [`src/web/sanitize.ts`](web/sanitize.ts). This file is only the Node binding.
 *
 * Why it is needed at all: the reading view puts `block.html` on the page with
 * `dangerouslySetInnerHTML` (src/web/TableView.tsx), and that HTML came from a
 * stranger's website. So something has to remove the executable parts, and
 * **Readability is not that something** — Mozilla says so in Readability's own
 * security policy (linked from docs/project/security.md) and declines the bug
 * reports:
 *
 *   > `readability` itself does not intend to do security-related input
 *   > sanitization … it is expected that some interactive/scripting input may
 *   > remain after `readability` processes input.
 *
 * Measured, not assumed: `<img onerror>`, `<svg onload>`, `<span onmouseover>`
 * and `<video onerror>` all come through Readability intact and all of them
 * fire. `<script>` does not run via innerHTML, which is presumably why this went
 * unnoticed for so long. See docs/project/security.md for the full account.
 *
 * **This pass is not the last line of defence, and must not be treated as one.**
 * It runs under jsdom's parser; the browser runs Chrome's. Its job is to make
 * the *stored artefact* clean, so `blocks.json` on disk is not a loaded gun and
 * every later consumer inherits a sane starting point. The pass that guards the
 * actual render is the browser one.
 */

import createDOMPurify from "dompurify";
/* jsdom on first use rather than at module scope — src/jsdom-lazy.ts says why.
   Both exports below stay synchronous. */
import { jsdom } from "./jsdom-lazy.js";
import {
  ARTICLE_CONFIG,
  RISKY_ROOT_ATTR,
  SANITIZER_VERSION,
  installArticlePolicy,
} from "./sanitize-policy.js";

/**
 * One DOMPurify instance for the process, bound to a throwaway window. This is
 * the documented way to run DOMPurify under Node, and we only ever hand it
 * **strings**.
 *
 * The first version of this did something cleverer and worse: it passed live
 * nodes from stage 3's own JSDOM document with `IN_PLACE: true`, to save a
 * parse. That is three separate sharp edges at once, and DOMPurify has shipped
 * a CVE for each of them in the last three months —
 * [CVE-2026-49458](https://github.com/advisories/GHSA-hpcv-96wg-7vj8) for
 * sanitising a node from a *different realm* than the instance (fixed 3.4.6),
 * hook-driven element removal leaving a detached subtree executable (fixed
 * 3.4.13), and DOM clobbering via `ownerDocument` in `IN_PLACE` (also 3.4.13).
 * Our pinned 3.4.14 has all of those fixes. That is not the point: the string
 * path is the one everybody else uses and the one that gets the scrutiny, and a
 * reading app has no business spending its safety margin to skip one parse of a
 * 78KB document.
 *
 * **Built on the first sanitise, not at module evaluation.**
 *
 * It was a module-scope `const` until 2026-09-03, which meant that merely
 * *importing* this file — which `store/public-reader.ts` does, so every request
 * to the bundled API did — constructed a jsdom window and a DOMPurify bound to
 * it. The instance is still one per process and still built exactly once; the
 * only change is when. See src/jsdom-lazy.ts for the cold start this is part of.
 */
let purifier: ReturnType<typeof createDOMPurify> | null = null;

function purify(): ReturnType<typeof createDOMPurify> {
  if (purifier) return purifier;
  const built = createDOMPurify(
    new (jsdom().JSDOM)("").window as unknown as Window & typeof globalThis,
  );
  installArticlePolicy(built);
  /* Assigned only after the policy is on it. A throw from `installArticlePolicy`
     would otherwise leave a *usable* sanitiser with no policy memoised here, and
     every later call would quietly get the unconfigured one. */
  purifier = built;
  return built;
}

/**
 * Replace an element's contents with a sanitised copy of them.
 *
 * Stage 3 hands this the `document.body` of the page it just parsed, so the
 * `<head>` — our own `<style>`, the charset, the title — is untouched. Running
 * the whole document through `sanitize()` with `WHOLE_DOCUMENT` instead would
 * work, but it silently drops `<meta charset>`.
 *
 * Idempotent: sanitising already-sanitised HTML is a no-op. That is not a nice
 * property, it is a requirement — `npm run blocks` writes its output back over
 * its own input file and is re-run routinely.
 */
export function sanitizeInPlace(root: Element): void {
  for (const name of Array.from(root.attributes, (a) => a.name)) {
    if (RISKY_ROOT_ATTR.test(name)) root.removeAttribute(name);
  }
  root.innerHTML = sanitizeHtml(root.innerHTML);
}

/** The same policy applied to a fragment of HTML text. */
export function sanitizeHtml(html: string): string {
  return purify().sanitize(html, { ...ARTICLE_CONFIG });
}

/**
 * An artefact off the disk, cleaned only if its stamp says it needs it.
 *
 * ## The problem this solves, which is not the one it looks like
 *
 * `blocks.json` files written before the sanitiser landed are dirty and are
 * trusted as-is. docs/project/security.md carried that as a known gap with
 * "re-run stage 3 to clean them" as the remedy — and the flaw is not the remedy,
 * it is that **nothing anywhere says the re-run is needed**. A stale artefact
 * has the same shape as a current one and serves perfectly, so the check a
 * person would run to find out whether the old files were a problem comes back
 * saying no. Another [silent success](docs/reusable/silent-success.md), this
 * time in the fix rather than the bug.
 *
 * ## Why not simply sanitise every read
 *
 * Measured, not argued: 33ms and roughly 130MB of jsdom retention to re-clean
 * the 141-block Noema article, 10ms for the 34-block fixture. Per article load,
 * forever, on the deployed server, to protect against a case the browser pass at
 * ingress (src/web/sanitize.ts) already covers. Comparing an integer costs
 * nothing, and the article that actually needs the work is the rare one — and
 * stops being rare exactly once, because re-running stage 3 stamps it.
 *
 * That is why `blocks` comes back by **identity** on the current path rather
 * than as a fresh array: a version that mapped over the blocks and happened to
 * return the same strings would look correct in every test and would still be
 * paying for a parse per block on every request. tests/sanitize-stale-artefact.ts
 * asserts the identity for that reason.
 *
 * ## What it does not do
 *
 * It does not write anything back. The heal is per read and in memory, which is
 * the right shape for a store that is moving to Postgres and a server whose
 * filesystem is read-only in production (docs/project/deployment.md) — and a
 * read path that repairs files is a surprise nobody wants during an incident.
 * `stale` is returned rather than logged here so the caller says it, following
 * the rule `readJson` in src/api.ts already writes down: a helper that logs is
 * convenient until it is called in a loop, and the loop is always somewhere else.
 *
 * It also does not touch `text`. That is never rendered as markup — it goes to
 * the model, and it is the offset space comments and search hits are anchored in
 * (src/quote-match.ts) — so rewriting it would move every anchor in the article
 * for no gain. Same reasoning as `sanitizeArticle` in src/web/sanitize.ts.
 *
 * ## Blocks and a stamp, not a file
 *
 * The two arguments are deliberate. **There are two stores**, and the fix that
 * only guards one of them is the shape this whole area keeps failing in: the
 * filesystem reader is `loadArticle` in src/api.ts, and the Postgres reader is
 * `loadArticle` → `blocksFor` in src/store/pg.ts, where the blocks are rows and
 * the stamp is a column rather than a key in a JSON object. A parameter shaped
 * like `blocks.json` would fit one caller and have to be faked by the other.
 *
 * `stamp` is required rather than optional even though `undefined` is a legal
 * value, so that a caller with nothing to pass has to write `undefined` on
 * purpose. Forgetting an optional argument and deciding you have no stamp are
 * the same keystrokes otherwise, and only one of them is a decision. Both fail
 * safe — unknown means stale means clean it — but one of them is silent.
 */
export function sanitizeStoredBlocks<T extends { html: string }>(
  blocks: T[],
  stamp: number | undefined,
): { blocks: T[]; stale: boolean } {
  /* Not "older than", just "different from". A stamp from a build we are not —
     a rollback, a branch — is as unknown to us as no stamp at all, and
     sanitising is idempotent, so there is nothing to buy by working out which
     way the difference goes and a real cost to getting that wrong. */
  if (stamp === SANITIZER_VERSION) return { blocks, stale: false };

  return {
    blocks: blocks.map((b) => {
      const clean = sanitizeHtml(b.html);
      return clean === b.html ? b : { ...b, html: clean };
    }),
    stale: true,
  };
}

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
import { JSDOM } from "jsdom";
import { ARTICLE_CONFIG, RISKY_ROOT_ATTR, installArticlePolicy } from "./sanitize-policy.js";

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
 */
const purify = createDOMPurify(
  new JSDOM("").window as unknown as Window & typeof globalThis,
);
installArticlePolicy(purify);

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
  return purify.sanitize(html, { ...ARTICLE_CONFIG });
}

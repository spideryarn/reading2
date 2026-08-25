/**
 * Making an article's HTML safe to render.
 *
 * The reading view puts `block.html` on the page with `dangerouslySetInnerHTML`
 * (src/web/TableView.tsx), and that HTML came from a stranger's website. So
 * something has to remove the executable parts, and **Readability is not that
 * something** — Mozilla says so in Readability's own security policy (linked
 * from docs/project/security.md) and declines the bug reports:
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
 * This module is the one place that decides what survives. Everything else —
 * stage 3, the client, anything added later — inherits the answer rather than
 * re-deciding it.
 */

import createDOMPurify, { type Config } from "dompurify";
import { JSDOM } from "jsdom";

/**
 * One DOMPurify instance for the process, bound to a throwaway window. This is
 * the documented way to run DOMPurify under Node, and we only ever hand it
 * **strings**.
 *
 * The first version of this file did something cleverer and worse: it passed
 * live nodes from stage 3's own JSDOM document with `IN_PLACE: true`, to save a
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

/**
 * Video embeds, by exact origin and path prefix.
 *
 * Readability deliberately keeps embeds from video hosts, so dropping every
 * `<iframe>` would silently delete real content — a YouTube player vanished from
 * the Noema sample article when this was first written. Greg's call, 2026-08-25,
 * was to keep them behind an allowlist.
 *
 * **The check must compare `url.origin`, never `endsWith` or `includes`.**
 * `"https://www.youtube.com.evil.test/embed/x".includes("youtube.com")` is true,
 * and so is `endsWith` against a crafted subdomain on the attacker's own domain.
 * A sloppy host test here reopens exactly the hole this file exists to close,
 * and it reopens it in the one place nobody would think to look again.
 */
const EMBED_ORIGINS = new Map<string, string>([
  ["https://www.youtube.com", "/embed/"],
  ["https://www.youtube-nocookie.com", "/embed/"],
  ["https://player.vimeo.com", "/video/"],
]);

function isAllowedEmbed(src: string | null): boolean {
  if (!src) return false;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false; // relative, malformed, or protocol-relative — not a known embed
  }
  const prefix = EMBED_ORIGINS.get(url.origin);
  return prefix !== undefined && url.pathname.startsWith(prefix);
}

/**
 * Iframes are handled here rather than by configuration because the decision
 * depends on the attribute value, which is past what ALLOWED_TAGS can express.
 *
 * The frame is re-clothed rather than trusted: the author's `allow` attribute is
 * a permissions-policy grant (their copy asked for `autoplay`, `clipboard-write`
 * and `encrypted-media`) and we replace it with our own, and `sandbox` is set by
 * us on every embed.
 *
 * `allow-scripts allow-same-origin` together normally defeats the sandbox — a
 * frame that is same-origin with its parent can reach up and remove its own
 * sandbox attribute. It is safe *here*, and only here, because every allowed
 * origin is a third party: the frame keeps YouTube's origin, not ours, so
 * "same-origin" buys it nothing against us. Both flags are required — drop
 * `allow-same-origin` and the player gets an opaque origin and breaks.
 *
 * That argument leans on the frame's document really being third-party, which
 * is why `srcdoc` is forbidden in CONFIG below: a `srcdoc` frame runs in *our*
 * origin, and the reasoning above would then be exactly backwards.
 */
purify.addHook("afterSanitizeAttributes", (node) => {
  // Duck-typed, not `node instanceof Element`. There is no global `Element` in
  // Node, and the nodes arriving here belong to a JSDOM document anyway, so the
  // `instanceof` spelling throws ReferenceError on every single call — which is
  // to say it removes the iframe check entirely. Caught by tests/sanitize.test.ts.
  const el = node as Element;

  // `cmt` is the reading view's own class for a comment mark (src/web/annotate.ts,
  // styled in src/web/styles.css). Forbidding the `data-comment` attribute is
  // not quite enough on its own — the class alone still draws the highlight.
  if (el.classList?.contains("cmt")) {
    el.classList.remove("cmt");
    if (el.classList.length === 0) el.removeAttribute("class");
  }

  if (el.tagName !== "IFRAME") return;
  if (!isAllowedEmbed(el.getAttribute("src"))) {
    el.remove();
    return;
  }
  // Only written when the value is actually wrong, which is what makes a second
  // pass a genuine no-op.
  //
  // The tempting spelling — remove then set, unconditionally, to force our own
  // attribute order — is subtly not idempotent once stage 3 stamps an `id` on
  // the iframe. Pass one sanitises and *then* mints the id, so the id lands
  // last; pass two re-sanitises first, and remove-then-set moves all four of
  // these attributes to the far end, behind the id. The markup means the same
  // thing both times, so nothing fails — the article file and blocks.json just
  // churn on every run. Found by GPT-5's review, 2026-08-25.
  for (const [name, value] of EMBED_ATTRS) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
});

/**
 * Set on every embed we keep, replacing whatever the author asked for. The
 * Noema article's own YouTube embed requested `accelerometer`, `autoplay`,
 * `clipboard-write`, `encrypted-media`, `gyroscope` and `web-share`; a reading
 * app needs none of that.
 *
 * `allow-presentation` is deliberately absent: it governs the Presentation API
 * — casting to a second screen — and has nothing to do with playback,
 * fullscreen or picture-in-picture. It was in the first draft of this file by
 * mistake.
 */
const EMBED_ATTRS: ReadonlyArray<readonly [string, string]> = [
  ["sandbox", "allow-scripts allow-same-origin"],
  ["allow", "fullscreen; picture-in-picture"],
  ["referrerpolicy", "strict-origin-when-cross-origin"],
  ["loading", "lazy"],
];

/**
 * Four things in here are load-bearing, and three of them fail *silently* if
 * changed — the article still renders, it is just wrong or unsafe:
 *
 * 1. **`SANITIZE_NAMED_PROPS` must stay off** (it is off by default). Turning it
 *    on is DOM-clobbering protection that rewrites every `id` to
 *    `user-content-<id>` — which would rename all 139 block ids on the sample
 *    article, orphan every comment and every `#spya-…` link, and break the one
 *    contract the whole project rests on (docs/project/block-ids.md). Nothing
 *    would throw. The ToC would just quietly stop resolving.
 * 2. `id` is in DOMPurify's default attribute allowlist, which is why the block
 *    ids survive at all. A narrower hand-written `ALLOWED_ATTR` that forgot it
 *    would take the spine with it.
 * 3. **The default profile keeps SVG and MathML.** Greg's call, 2026-08-25:
 *    inline diagrams are worth keeping. The tradeoff is real and written down in
 *    docs/project/security.md — foreign content is where most historical mXSS
 *    bypasses live, and we sanitise under jsdom but render in Chrome.
 *
 * Three things are forbidden that DOMPurify would otherwise allow:
 *
 * - **Form controls.** Never prose, and a `<form action="https://evil.test">`
 *   rendered inside our own origin is a credible phishing surface for nothing
 *   in return.
 * - **CSS, both `style="…"` and `<style>`.** DOMPurify deliberately does not
 *   sanitise CSS — it is outside its
 *   [threat model](https://github.com/cure53/DOMPurify/wiki/Security-Goals-&-Threat-Model)
 *   — and article CSS is powerful enough to matter: a retained
 *   `<svg style="position:fixed;inset:0;width:100vw;height:100vh">` covers the
 *   whole reading view and takes the clicks. `url()` in author CSS is also a
 *   silent request to a third party. Prose gets its looks from our stylesheets
 *   (docs/project/design-css-overview.md), so nothing of value is lost.
 * - **The annotation attributes the client owns.** `annotateHtml` adds
 *   `data-comment` / `data-mark-end` / `data-open` and the `cmt` class *after*
 *   this runs, and the reading view treats them as its own. An article that
 *   ships `<mark class="cmt" data-comment="…">` in its source would draw a fake
 *   comment in someone else's document. Stripped below and in the hook.
 *
 * Both CSS and comment-spoofing were found by GPT-5's review, 2026-08-25.
 */
const CONFIG: Config = {
  ADD_TAGS: ["iframe"],
  // Every attribute the embed hook sets must be listed here, or DOMPurify
  // strips it on the *next* pass and the hook re-appends it in a different
  // position — output that converges only after two runs. `referrerpolicy` was
  // missing and did exactly that.
  ADD_ATTR: [
    "allowfullscreen", "frameborder", "loading", "sandbox", "allow", "referrerpolicy",
  ],
  FORBID_TAGS: [
    "form", "input", "button", "select", "textarea", "option", "label", "style",
  ],
  FORBID_ATTR: [
    "formaction", "autofocus", "style",
    // Pinning an invariant rather than fixing a bug: DOMPurify already drops
    // `srcdoc`, and it must keep doing so. A `srcdoc` iframe runs in *our*
    // origin, which is exactly what the sandbox reasoning above assumes cannot
    // happen.
    "srcdoc",
    "data-comment", "data-mark-end", "data-open",
  ],
};

/**
 * Attributes we strip from the root element itself. Sanitising a node's
 * `innerHTML` says nothing about the node's own attributes, and `<body onload>`
 * is the obvious way to walk through a gap like that.
 */
const RISKY_ROOT_ATTR = /^(on|style$|srcdoc$|data-(comment|mark-end|open)$)/i;

/**
 * Replace an element's contents with a sanitised copy of them.
 *
 * Stage 3 hands this the `document.body` of the page it just parsed, so the
 * `<head>` — our own `<style>`, the charset, the title — is untouched. Running
 * the whole document through `sanitize()` with `WHOLE_DOCUMENT` instead would
 * work, but it silently drops `<meta charset>`.
 *
 * The round trip through a string is deliberate; see the note on `purify`
 * above. `el.innerHTML = DOMPurify.sanitize(dirty)` is DOMPurify's canonical
 * usage, and its output is built to be safe when re-parsed in this exact
 * context.
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

/**
 * The same policy applied to a fragment of HTML text. Nothing in the pipeline
 * needs this — stage 3 works on a live DOM — but tests do, and so would any
 * later stage that has a string and no document.
 */
export function sanitizeHtml(html: string): string {
  return purify.sanitize(html, { ...CONFIG });
}

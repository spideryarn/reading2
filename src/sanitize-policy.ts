/**
 * **One policy, two bindings.** What survives from a stranger's HTML is decided
 * here and nowhere else.
 *
 * The article is sanitised twice — once in Node at stage 3
 * ([`src/sanitize.ts`](sanitize.ts)) so the stored `blocks.json` is clean, and
 * again in the browser at article ingress
 * ([`src/web/sanitize.ts`](web/sanitize.ts)) because the first pass used
 * *jsdom's* HTML parser and the reading view uses *Chrome's*. Two parsers that
 * disagree about a document is the whole mechanism of mutation XSS, so the pass
 * that matters is the one running in the engine that will actually render it.
 * See docs/project/security.md.
 *
 * **This file must never import jsdom.** It is in the browser bundle's module
 * graph, and it exists precisely so the two bindings cannot drift into two
 * different policies — which is the failure that makes a second pass worse than
 * useless: it looks like defence in depth and is really two half-policies.
 *
 * It must also stay free of anything Node-only for the same reason. Everything
 * here is either a constant or a function over a DOMPurify instance the caller
 * supplies.
 */

import type { Config, DOMPurify } from "dompurify";

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

export function isAllowedEmbed(src: string | null): boolean {
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
 * Set on every embed we keep, replacing whatever the author asked for. The
 * Noema article's own YouTube embed requested `accelerometer`, `autoplay`,
 * `clipboard-write`, `encrypted-media`, `gyroscope` and `web-share`; a reading
 * app needs none of that.
 *
 * `allow-presentation` is deliberately absent: it governs the Presentation API
 * — casting to a second screen — and has nothing to do with playback,
 * fullscreen or picture-in-picture. It was in the first draft of this by
 * mistake.
 */
const EMBED_ATTRS: ReadonlyArray<readonly [string, string]> = [
  ["sandbox", "allow-scripts allow-same-origin"],
  ["allow", "fullscreen; picture-in-picture"],
  ["referrerpolicy", "strict-origin-when-cross-origin"],
  ["loading", "lazy"],
];

/**
 * Three things in here are load-bearing, and they fail *silently* if changed —
 * the article still renders, it is just wrong or unsafe:
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
 *    bypasses live, and it is the main reason the browser pass exists.
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
 *   `data-comment` / `data-mark-end` / `data-open` and the `cmt` class, and the
 *   reading view treats them as its own. An article that ships
 *   `<mark class="cmt" data-comment="…">` in its source would draw a fake
 *   comment in someone else's document.
 *
 *   **This is why the browser pass runs at ingress rather than at the render
 *   sink.** Sanitising after `annotateHtml` would have to *allow* these three
 *   attributes to avoid erasing every real comment mark — a second, laxer
 *   policy, and the drift between the two would be the bug. Sanitise first,
 *   annotate second, and one policy covers both ends.
 *
 * Both CSS and comment-spoofing were found by GPT-5's review, 2026-08-25.
 */
export const ARTICLE_CONFIG: Config = {
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
    // origin, which is exactly what the sandbox reasoning below assumes cannot
    // happen.
    "srcdoc",
    "data-comment", "data-mark-end", "data-open",
  ],
};

/**
 * Attributes stripped from a root element whose *contents* are being sanitised.
 * Sanitising a node's `innerHTML` says nothing about the node's own attributes,
 * and `<body onload>` is the obvious way to walk through a gap like that.
 */
export const RISKY_ROOT_ATTR = /^(on|style$|srcdoc$|data-(comment|mark-end|open)$)/i;

/**
 * Install the parts of the policy that configuration cannot express. Call once
 * per DOMPurify instance, before the first `sanitize`.
 *
 * Iframes are handled in a hook because the decision depends on the attribute
 * *value*, which is past what `ALLOWED_TAGS` can say.
 *
 * The frame is re-clothed rather than trusted: the author's `allow` attribute is
 * a permissions-policy grant, and we replace it with our own; `sandbox` is set
 * by us on every embed.
 *
 * `allow-scripts allow-same-origin` together normally defeats the sandbox — a
 * frame that is same-origin with its parent can reach up and remove its own
 * sandbox attribute. It is safe *here*, and only here, because every allowed
 * origin is a third party: the frame keeps YouTube's origin, not ours, so
 * "same-origin" buys it nothing against us. Both flags are required — drop
 * `allow-same-origin` and the player gets an opaque origin and breaks.
 *
 * That argument leans on the frame's document really being third-party, which is
 * why `srcdoc` is forbidden above: a `srcdoc` frame runs in *our* origin, and
 * the reasoning would then be exactly backwards.
 */
export function installArticlePolicy(purify: DOMPurify): void {
  purify.addHook("afterSanitizeAttributes", (node) => {
    // Duck-typed, not `node instanceof Element`. There is no global `Element` in
    // Node, so the `instanceof` spelling throws ReferenceError on every call —
    // which is to say it removes the iframe check entirely, on the server side
    // only, while the browser side keeps working. Caught by tests/sanitize.test.ts.
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
    // Only written when the value is actually wrong, which is what makes a
    // second pass a genuine no-op.
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
}

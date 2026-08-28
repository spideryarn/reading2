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
 * Which version of the policy below an artefact on disk was cleaned with.
 *
 * Stage 3 stamps this into `blocks.json` (src/blocks.ts) and the read seam
 * compares it (`sanitizeStoredBlocks` in src/sanitize.ts). It exists because a
 * stale artefact is otherwise **indistinguishable from a current one** — same
 * shape, same fields, serves fine — so the check anybody would run to see
 * whether the old files were a problem comes back saying no. docs/project/security.md
 * carried "re-run stage 3 to clean them" as the remedy for a day, and nothing
 * anywhere said the re-run was needed.
 *
 * `1` is the DOMPurify policy as it stood on 2026-08-25, which is every artefact
 * that has ever carried a stamp. Files written before then have no `sanitizer`
 * key at all, and absent counts as stale — which is the case that matters,
 * because those are the ones written before there was a sanitiser.
 *
 * **Bump this whenever a change here means an already-stored artefact could now
 * be wrong** — a tag or attribute moving onto a forbidden list, a hook getting
 * stricter, the embed allowlist losing an origin. Do *not* bump it for a change
 * that only affects what is kept, since re-cleaning old files would not find
 * anything. Getting that call wrong in the safe direction costs one sanitise per
 * article on the next read; getting it wrong the other way leaves the artefact
 * claiming to have been cleaned by a policy it has never seen.
 *
 * A number rather than the DOMPurify version, deliberately. Upgrading the
 * library does not make what is on disk unsafe — the stored HTML was checked
 * against a policy, and this names the policy. Tying it to the dependency would
 * re-sanitise every article in the library on every patch release, for nothing.
 */
export const SANITIZER_VERSION = 2;
/* 1 → 2 on 2026-08-27: the policy now strips URLs pointing at our own `/api/`
   (see `isOwnApi`). Stricter, so every artefact stored under 1 was cleaned by a
   policy that has never seen this rule and has to be re-cleaned on next read —
   which is exactly what the paragraph above says to bump for, and what the
   first version of that change forgot to do. GPT Sol, 2026-08-27. */

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
 *   `data-comment` / `data-mark-end` / `data-term` / `data-chat`, a per-kind
 *   `data-…-open`, and the `cmt`, `chat` and `term` classes, and the reading view treats them as its own. An article
 *   that ships `<mark class="cmt" data-comment="…">` in its source would draw a
 *   fake comment in someone else's document, and `<mark class="term">` would
 *   underline whatever the publisher chose as though the glossary had found it.
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
    /* The annotation attributes the client owns — see the note above. Every one
       `annotateHtml` can write has to be here, or an article ships its own and
       draws a mark nobody made.

       `data-chat` and `data-chat-end` were missing until 2026-08-26: chat marks
       are clickable, so a forged one was a link in someone else's document to a
       conversation id of the publisher's choosing. `data-open` was replaced by
       the four per-kind attributes in the same change, and is kept in this list
       because forbidding an attribute nothing writes any more costs nothing and
       un-forbidding one is how a hole reopens. Found by a GPT Sol review. */
    "data-comment", "data-mark-end", "data-term",
    "data-chat", "data-chat-end",
    "data-open", "data-cmt-open", "data-chat-open", "data-hit-open", "data-term-open",
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
/**
 * The attributes that can carry a URL, across everything this policy allows.
 *
 * **The first version of this list had five holes, and GPT Sol found all five**
 * by running them through `sanitizeHtml` rather than by reading the list —
 * which is the lesson: an allowlist of attributes is only ever as good as the
 * adversarial cases someone actually tried.
 *
 * `background` is a presentational `<table>` attribute from HTML 4 that
 * browsers still fetch. `srcset` needs its own parsing (below) rather than
 * membership here. `data` and `formaction` are on elements this policy does not
 * allow today — kept because the cost is a string and the cost of missing one
 * is a hole.
 */
const URL_ATTRS = [
  "href",
  "src",
  "poster",
  "background",
  "data",
  "formaction",
  "xlink:href",
  "longdesc",
  "cite",
  "action",
];

/**
 * SVG presentation attributes that take a **functional IRI** — `url(#thing)`,
 * and equally `url(/api/health)`, which a browser will go and fetch as a paint
 * server.
 *
 * Separate from `URL_ATTRS` because the value is not a URL; it is a value that
 * may *contain* one, and the ordinary attribute check would look straight past
 * `fill="url(/api/health)"`. It did.
 */
const IRI_ATTRS = [
  "fill",
  "stroke",
  "filter",
  "mask",
  "clip-path",
  "marker-start",
  "marker-mid",
  "marker-end",
];

/** `url( … )`, however it is spaced or quoted. */
const FUNCTIONAL_IRI = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

/**
 * The origins that are *us*, for deciding whether a URL points at our own API.
 *
 * In a browser this is exact: `location.origin` is the page the article is
 * being rendered into, which is the only origin that matters. On the server —
 * where stage 3 runs — there is no such thing, so it takes a configured list
 * and falls back to the local dev origins.
 *
 * **This exists because the first version resolved everything against a
 * placeholder origin**, which made every absolute URL "foreign" — including
 * `https://spideryarn-greg-detre.vercel.app/api/library`, our own production
 * host. It stripped `/api/health` and let the fully-qualified version straight
 * through. GPT Sol found it; confirmed by running both through `sanitizeHtml`.
 */
function ownOrigins(): string[] {
  /* Read off `globalThis` rather than `process` directly: this module is
     imported by the browser build too (src/web/sanitize.ts), where `process`
     does not exist and a bare reference is a ReferenceError at load. */
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const configured = (env?.SPIDERYARN_ORIGINS ?? "")
    .split(",")
    .map((o: string) => o.trim())
    .filter(Boolean);
  const here = typeof location === "object" && location?.origin ? [location.origin] : [];
  return [...here, ...configured, "http://localhost:5273", "http://127.0.0.1:5273"];
}

/** A placeholder that no real host can collide with, for resolving relative URLs. */
const RELATIVE_BASE = "https://spideryarn.invalid";

/**
 * Does this URL point at our own API?
 *
 * Three shapes have to be caught, and the first version caught only one:
 *
 *  - **host-relative** — `/api/health`, and `/figures/../api/health`, which is
 *    why this resolves rather than string-matches;
 *  - **absolute, our host** — `https://<us>/api/library`;
 *  - **protocol-relative, our host** — `//<us>/api/library`.
 *
 * Somebody else's `/api/` path is left alone, which is the point: this is about
 * our API, not about the word "api" in a link.
 */
function isOwnApi(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;

  /* Protocol-relative inherits the page's scheme, so it is resolved against a
     scheme we pick and then compared by HOST rather than by full origin. */
  const protocolRelative = trimmed.startsWith("//");

  let url: URL;
  try {
    url = new URL(trimmed, RELATIVE_BASE);
  } catch {
    return false;
  }

  const path = url.pathname;
  if (path !== "/api" && !path.startsWith("/api/")) return false;

  // Host-relative: it resolved against the placeholder, so it is whatever
  // origin the page is served from — ours by definition.
  if (url.origin === RELATIVE_BASE) return true;

  const ours = ownOrigins();
  if (protocolRelative) {
    return ours.some((o) => {
      try {
        return new URL(o).host === url.host;
      } catch {
        return false;
      }
    });
  }
  return ours.includes(url.origin);
}

/**
 * `srcset`, minus any candidate pointing at our own API.
 *
 * **Parsed candidate by candidate**, because the whole value —
 * `"/safe.png 1x, /api/health 2x"` — is not a URL, so handing it to `new URL()`
 * throws and the old code concluded there was nothing to see. That is how a
 * mixed `srcset` walked through the first version of this rule.
 *
 * Returns `null` when nothing is left, so the caller drops the attribute rather
 * than leaving an empty one.
 */
function cleanSrcset(value: string): string | null {
  const kept = value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== "")
    .filter((candidate) => !isOwnApi(candidate.split(/\s+/)[0] ?? ""));
  return kept.length ? kept.join(", ") : null;
}

/**
 * Take every reference to our own API off one element.
 *
 * Its own function rather than three loops inside the hook, because the hook
 * runs on every node of every article and had grown to a complexity the linter
 * was right to complain about — and because these three are one idea in three
 * spellings, which reads better named once.
 *
 * The three spellings, and why each needs its own:
 *
 *  - **an attribute that is a URL** — `src`, `href`, `background`, the ordinary case;
 *  - **an attribute that is a list of URLs** — `srcset`, cleaned candidate by
 *    candidate so one bad entry does not cost the reader the other three;
 *  - **an attribute that merely contains one** — `fill="url(/api/health)"`, an
 *    SVG paint server the browser will happily go and fetch, and which the
 *    ordinary check looks straight past.
 */
function stripOwnApiUrls(el: Element): void {
  for (const name of URL_ATTRS) {
    const value = el.getAttribute(name);
    if (value !== null && isOwnApi(value)) el.removeAttribute(name);
  }

  const srcset = el.getAttribute("srcset");
  if (srcset !== null) {
    const cleaned = cleanSrcset(srcset);
    if (cleaned === null) el.removeAttribute("srcset");
    else if (cleaned !== srcset) el.setAttribute("srcset", cleaned);
  }

  for (const name of IRI_ATTRS) {
    const value = el.getAttribute(name);
    if (value === null || !value.includes("url(")) continue;
    const candidates = [...value.matchAll(FUNCTIONAL_IRI)].map((m) => m[1] ?? "");
    if (candidates.some(isOwnApi)) el.removeAttribute(name);
  }
}

export function installArticlePolicy(purify: DOMPurify): void {
  /**
   * MathML's machine-readable copy of a formula, removed along with its text.
   *
   * `<annotation encoding="application/x-tex">` holds the TeX a formula was
   * built from, and is never meant to be read. DOMPurify refuses the tag —
   * `semantics`, `annotation` and `annotation-xml` are all on its
   * `mathMlDisallowed` list, and `annotation-xml` is an HTML integration point
   * and a classic mXSS surface — but refusing a *tag* unwraps it and keeps its
   * text, so the TeX ended up as a bare text node inside the `<math>`.
   *
   * **It is not a rendering bug, and the first version of this comment said it
   * was.** Checked in Chrome on the ar5iv rendering of *Attention Is All You
   * Need*: the formulas paint correctly either way, because MathML layout
   * ignores a bare text node that is not in a token element — the `<math>` box
   * is the same width with the stray text and without it. Nobody ever saw a
   * `\frac`.
   *
   * **It is a `textContent` bug, which is worse in a quieter way**, because
   * `textContent` is what everything after stage 2 reads. On that paper, 25 of
   * 151 blocks carried TeX in their text — 486 characters, 1.3% of the article —
   * so the block text stage 3 mints ids from, and that summaries, ideas, the
   * glossary, search, quote-matching and every embedding are computed over, read
   * `(x1,…,xn)(x_{1},...,x_{n})`: the same formula twice, once as symbols and
   * once as source. Invisible on the page and present in every model call.
   *
   * It is also in the accessibility tree, in what a text selection copies, and
   * in anything that indexes the page — all of which read the DOM rather than
   * the paint. So "not painted" is narrower than "not seen": a screen-reader
   * user gets the TeX read out.
   *
   * Wikipedia emits one on all 188 formulas of a single article; LaTeXML emits
   * them too. Found 2026-08-28 — docs/plans/readability-repair-pass.md. Two
   * independent browser checks agree it never paints: the `<math>` box measures
   * the same width with the stray node and without, and `Range.getClientRects()`
   * returns zero boxes for all 45 of the affected elements on that page.
   *
   * **A hook rather than `FORBID_CONTENTS`, and that is the point of this
   * comment.** Setting that key *replaces* DOMPurify's default list rather than
   * extending it, so the obvious fix — copy their array, add one entry — was
   * written, went green, and had silently dropped `selectedcontent` from the
   * list. DOMPurify's own note says hoisting that element's children re-inserts
   * a mirror target ahead of the walk, which the engine refills: an infinite
   * loop and output amplification, which is to say a denial of service. A
   * vendor default copied into our source is a protection that rots at their
   * next release and says nothing when it does.
   *
   * Removing the node outright is strictly more restrictive than the behaviour
   * it replaces: nothing that used to be allowed becomes allowed.
   */
  purify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "annotation") return;
    (node as unknown as { remove?: () => void }).remove?.();
  });

  purify.addHook("afterSanitizeAttributes", (node) => {
    // Duck-typed, not `node instanceof Element`. There is no global `Element` in
    // Node, so the `instanceof` spelling throws ReferenceError on every call —
    // which is to say it removes the iframe check entirely, on the server side
    // only, while the browser side keeps working. Caught by tests/sanitize.test.ts.
    const el = node as Element;

    /* `cmt` and `term` are the reading view's own classes for a comment mark
       and a glossary occurrence (src/web/annotate.ts, styled in
       src/web/styles.css). Forbidding the `data-` attributes is not quite
       enough on its own — either class alone still draws its highlight.

       `term` joined `cmt` here when the glossary landed. It is the less obvious
       of the two and arguably the more useful to a publisher: a comment mark is
       visibly the reader's, whereas a forged term underline reads as *the app
       having decided* those words matter. */
    for (const own of ["cmt", "term"]) {
      if (el.classList?.contains(own)) el.classList.remove(own);
    }
    if (el.classList?.length === 0 && el.hasAttribute("class")) el.removeAttribute("class");

    /* **An article may not address our own API.**
     *
     * This policy keeps relative URLs, on purpose — the block splitter needs
     * figures, and tests/sanitize.test.ts pins that `<img src="/d.png">`
     * survives. Which means a published page can contain
     * `<img src="/api/health">` or `<a href="/api/library">`, and those resolve
     * against *our* origin when the reading view renders them.
     *
     * Neither is a catastrophe — the gate refuses the anchor and the image
     * reaches only the one public endpoint — but both are a stranger's page
     * making requests to our server from the reader's browser, and "bounded"
     * is a thing to decide rather than to discover. Found by GPT Sol,
     * 2026-08-26, in review of the auth work: no grep over our source can see
     * these, because they arrive at runtime.
     *
     * Every URL-bearing attribute, not just `href` and `src` — a rule that
     * covers four of six looks exactly like a rule that covers six. */
    stripOwnApiUrls(el);

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

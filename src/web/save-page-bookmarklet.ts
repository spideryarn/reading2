/**
 * **"Save for Spideryarn": a bookmarklet that saves the page the reader is
 * looking at as one `.html` file**, for them to upload on the add page.
 *
 * For a site that turns this app away but lets the reader's own browser in.
 * No browser offers a plain HTML file of the page as rendered (Chrome saves
 * MHTML, Safari a Web Archive), and printing to PDF costs a model call and
 * comes back as a transcription. This file is the DOM after the site's scripts
 * ran, which is the article the reader can see, and it goes through the
 * existing upload path unchanged.
 *
 * **Why a file rather than handing the page across to a Spideryarn window**:
 * the sites this is for send `Cross-Origin-Opener-Policy: same-origin` on at
 * least their check pages, under which a `postMessage` to a window we opened is
 * lost without an error. Saving a file makes no network request at all, so no
 * CSP and no COOP can stop it.
 * docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md
 * § Why B is a file the bookmarklet saves.
 *
 * **`savePageForSpideryarn` is stringified into the bookmark**, so it must be
 * self-contained: no imports, nothing from this module's scope, only what it is
 * passed, and plain ES2019 a bundler will not rewrite into helper calls. The
 * one constant it needs, the upload cap, is passed in by `bookmarkletHref` from
 * `MAX_UPLOAD_BYTES` rather than copied.
 */
import { MAX_UPLOAD_BYTES } from "../uploads.js";

/**
 * What `capturePage` hands back: the page as one HTML string with the file
 * name to give it, or why there is none.
 */
export type PageCapture =
  | { kind: "page"; html: string; filename: string; bytes: number }
  | { kind: "too-big"; bytes: number }
  | { kind: "pdf" };

/**
 * `win`'s page as one self-contained HTML string. Runs in the publisher's page,
 * from the bookmarklet (`savePageForSpideryarn`) and from the Chrome extension
 * (`chrome.scripting.executeScript`, which serialises it the way the bookmark
 * does, so it is self-contained for both).
 *
 * 1. **Every address made absolute, and no `<base>`.** An upload has no
 *    address of its own, so a relative image would have nothing to resolve
 *    against. Each `src`, `href`, `xlink:href`, `poster`, `data-src` and
 *    `srcset` candidate in the copy is resolved against the live page's
 *    `document.baseURI` (which is absolute whatever the page's own `<base>`
 *    says) and written back, and every `<base>` is removed. Not a single
 *    `<base>` instead: with one, the reader resolves an in-page `#fn1` against
 *    it too, and a footnote link would point at the publisher. So an `href`
 *    starting `#` is left exactly as written, as are `data:` and `mailto:`
 *    addresses and any the URL parser refuses. `javascript:` addresses,
 *    inline event handlers and `srcdoc` are removed with executable scripts.
 * 2. One `<meta charset="utf-8">`, first in `<head>`, every other charset
 *    declaration removed: the file is UTF-8 because a `Blob` of a string always
 *    is, and a page that said `iso-8859-1` would otherwise be decoded by its own
 *    word into mojibake (GPT Sol, plan review round 2, R2-2).
 * 3. What may be a credential, and is not the article, is removed — and no
 *    more, because stage 2 reads some things that look removable (R2-1):
 *    - every `<script>` except data the pipeline reads: `math/*` (MathJax 2's
 *      TeX, src/maths-import.ts) and `application/ld+json` (metadata). Other
 *      data scripts go too, since a JSON blob is where a page keeps its session;
 *    - hidden and password inputs; every other input's `value`, except a
 *      checkbox or radio, which carry Tufte-style sidenotes (src/notes.ts),
 *      and button/submit/reset values, which are visible labels;
 *    - `<meta>` named as a CSRF token, by exact name.
 *    Frames (video embeds the sanitiser keeps), `<noscript>` (lazy images'
 *    fallbacks), `<textarea>` and `<select>` (visible text) stay. The page as
 *    shown is otherwise what is saved, and Help says so.
 * 3a. **Where it was saved from**, as `<meta name="spideryarn-saved-from">`
 *    in `<head>`: `location.href` without its fragment, and only for an
 *    `http:`/`https:` address with no credentials. Any such meta the page
 *    carried is removed first, so the only one is ours. The upload path reads
 *    it as a claim to show ("Saved from <host>") and to match a later paste on
 *    the reader's own shelf, and never fetches it — docs/plans/261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md § Stage 3.
 * **Its arguments are numbers, and `win` comes last with `window` as its
 * default**, because `executeScript` sends arguments as JSON and a window
 * cannot be one (GPT Sol, 261024q F2). The bookmarklet and the tests pass a
 * window; the extension passes `maxBytes` and `messageCap` only.
 *
 * 4. Over the upload cap, counted in bytes, it is `too-big`; so is a page whose
 *    JSON serialisation is over `messageCap` when one is given, because Chrome
 *    carries the result and the extension's reply as JSON, capped at 64 MiB,
 *    and a quote or backslash serialises to two characters (F9). A PDF in Chrome's
 *    viewer is `pdf`: scripting the viewer works, and captures a 159-character
 *    wrapper around an embed (measured, docs/plans/261024q-chrome-extension-one-click-add-the-page.md
 *    § Stage 0).
 */
export function capturePage(
  maxBytes: number,
  messageCap = 0,
  win: Window & typeof globalThis = window,
): PageCapture {
  const doc = win.document;
  if ((doc.contentType || "").toLowerCase() === "application/pdf") return { kind: "pdf" };
  const base = doc.baseURI;
  const copy = doc.documentElement.cloneNode(true) as HTMLElement;

  const bases = copy.querySelectorAll("base");
  for (let i = 0; i < bases.length; i++) bases[i]!.remove();
  const absolute = (value: string): string => {
    const v = value.trim();
    if (v === "" || /^(?:data|mailto):/i.test(v)) return value;
    try {
      return new win.URL(v, base).href;
    } catch (_) {
      return value;
    }
  };
  const srcsetAbsolute = (value: string): string => {
    const isSpace = (char: string): boolean =>
      char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\r";
    let rewritten = "";
    let at = 0;
    while (at < value.length) {
      const leading = value.charAt(at);
      if (isSpace(leading) || leading === ",") {
        rewritten += leading;
        at++;
        continue;
      }

      let url = "";
      while (at < value.length && !isSpace(value.charAt(at))) {
        url += value.charAt(at++);
      }

      /* A comma inside a URL is data, not a separator. Only trailing commas
         end a candidate without a descriptor; a descriptor's comma is read
         below. This is the distinction `split(",")` loses for both data: URLs
         and ordinary filenames such as `figure,a.png`. */
      let trailingCommas = "";
      while (url.charAt(url.length - 1) === ",") {
        url = url.slice(0, -1);
        trailingCommas += ",";
      }
      rewritten += absolute(url) + trailingCommas;
      if (trailingCommas !== "") continue;

      /* Descriptors run to a comma, except for commas inside parentheses. We
         preserve them byte for byte; only the candidate URL is ours to edit. */
      let parentheses = 0;
      while (at < value.length) {
        const char = value.charAt(at);
        if (char === "(") parentheses++;
        else if (char === ")" && parentheses > 0) parentheses--;
        if (char === "," && parentheses === 0) break;
        rewritten += char;
        at++;
      }
    }
    return rewritten;
  };
  /* Inspect attributes rather than selecting `[xlink\:href]`: qualified SVG
     attributes are namespace-sensitive in selector engines, while
     `getAttribute("xlink:href")` is the interoperable DOM spelling. */
  const addressed = copy.querySelectorAll("*");
  /* `querySelectorAll` excludes `copy` itself; begin at -1 so executable
     attributes on the root `<html>` element are stripped too. */
  for (let i = -1; i < addressed.length; i++) {
    const el = i === -1 ? copy : addressed[i]!;
    /* A cloned element keeps executable attributes even after its `<script>`
       children are removed. Walk backwards because NamedNodeMap is live. */
    for (let a = el.attributes.length - 1; a >= 0; a--) {
      const attr = el.attributes[a]!;
      if (
        attr.name.toLowerCase().indexOf("on") === 0 ||
        attr.name.toLowerCase() === "srcdoc" ||
        /^\s*javascript:/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
    const names = ["src", "href", "poster", "data-src", "xlink:href"];
    for (let n = 0; n < names.length; n++) {
      const value = el.getAttribute(names[n]!);
      if (value === null) continue;
      if (
        (names[n] === "href" || names[n] === "xlink:href") &&
        value.trim().charAt(0) === "#"
      ) {
        continue;
      }
      el.setAttribute(names[n]!, absolute(value));
    }
    const srcset = el.getAttribute("srcset");
    if (srcset !== null) el.setAttribute("srcset", srcsetAbsolute(srcset));
  }
  const charsets = copy.querySelectorAll("meta[charset], meta[http-equiv]");
  for (let i = 0; i < charsets.length; i++) {
    const m = charsets[i]!;
    if (m.hasAttribute("charset") || (m.getAttribute("http-equiv") || "").toLowerCase() === "content-type") {
      m.remove();
    }
  }
  let head = copy.querySelector("head");
  if (!head) {
    head = doc.createElement("head");
    copy.insertBefore(head, copy.firstChild);
  }
  const charsetEl = doc.createElement("meta");
  charsetEl.setAttribute("charset", "utf-8");
  head.insertBefore(charsetEl, head.firstChild);

  const claimed = copy.querySelectorAll("meta[name]");
  for (let i = 0; i < claimed.length; i++) {
    if ((claimed[i]!.getAttribute("name") || "").trim().toLowerCase() === "spideryarn-saved-from") {
      claimed[i]!.remove();
    }
  }
  let savedFrom: URL | null = null;
  try {
    savedFrom = new win.URL(win.location.href);
  } catch (_) {
    savedFrom = null;
  }
  if (
    savedFrom &&
    (savedFrom.protocol === "http:" || savedFrom.protocol === "https:") &&
    savedFrom.username === "" &&
    savedFrom.password === ""
  ) {
    savedFrom.hash = "";
    const savedFromEl = doc.createElement("meta");
    savedFromEl.setAttribute("name", "spideryarn-saved-from");
    savedFromEl.setAttribute("content", savedFrom.href);
    head.insertBefore(savedFromEl, charsetEl.nextSibling);
  }

  const scripts = copy.querySelectorAll("script");
  for (let i = 0; i < scripts.length; i++) {
    const type = (scripts[i]!.getAttribute("type") || "").trim().toLowerCase();
    if (type.indexOf("math/") !== 0 && type !== "application/ld+json") scripts[i]!.remove();
  }
  const inputs = copy.querySelectorAll("input");
  const labelledButtons = ["button", "submit", "reset"];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const type = (input.getAttribute("type") || "text").trim().toLowerCase();
    if (type === "hidden" || type === "password") input.remove();
    else if (type !== "checkbox" && type !== "radio" && labelledButtons.indexOf(type) === -1) {
      input.removeAttribute("value");
    }
  }
  const tokenNames = ["csrf-token", "csrf-param", "csrf_token", "_csrf", "xsrf-token", "x-csrf-token"];
  const metas = copy.querySelectorAll("meta[name]");
  for (let i = 0; i < metas.length; i++) {
    const name = (metas[i]!.getAttribute("name") || "").trim().toLowerCase();
    if (tokenNames.indexOf(name) !== -1) metas[i]!.remove();
  }

  const html = `<!doctype html>\n${copy.outerHTML}`;
  const bytes = new win.Blob([html], { type: "text/html" }).size;
  if (bytes > maxBytes) return { kind: "too-big", bytes };
  if (messageCap > 0 && new win.Blob([JSON.stringify(html)]).size > messageCap) {
    return { kind: "too-big", bytes };
  }

  const title = (doc.title || "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what a filename must not carry.
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return { kind: "page", html, filename: `${title || "page"}.html`, bytes };
}

/**
 * Save `win`'s page as `<title>.html`: `capture` it, then a temporary
 * `<a download>` on a blob URL, clicked, removed, and the URL revoked a tick
 * later so the download has started. Over the cap, or a PDF, it says so and
 * stops.
 *
 * **`capture` is passed in, not imported**, because this function is
 * stringified into the bookmark too, and a minifier renames a module-level
 * name inside it but not in the string that would define it. A parameter is
 * renamed consistently or not at all. It is always `capturePage`.
 */
export function savePageForSpideryarn(
  win: Window & typeof globalThis,
  maxBytes: number,
  capture: typeof capturePage,
): void {
  const doc = win.document;
  const got = capture(maxBytes, 0, win);
  if (got.kind !== "page") {
    win.alert(
      got.kind === "pdf"
        ? "This is a PDF, not a web page. Download it and upload the file to Spideryarn."
        : "This page is too big to add to Spideryarn (the limit is " +
            Math.round(maxBytes / 1048576) +
            " MB).",
    );
    return;
  }
  const href = win.URL.createObjectURL(new win.Blob([got.html], { type: "text/html" }));
  const a = doc.createElement("a");
  a.href = href;
  a.download = got.filename;
  a.style.display = "none";
  (doc.body || doc.documentElement).appendChild(a);
  a.click();
  a.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(href), 1000);
}

/**
 * The `javascript:` URL a reader drags to their bookmarks bar.
 *
 * Wrapped in `void` because a `javascript:` URL whose expression has a value
 * replaces the page with that value. Percent-encoded whole: the browser decodes
 * a `javascript:` URL before running it, and an unencoded `%` or `#` in the
 * source would not survive.
 */
export function bookmarkletHref(): string {
  const body = `void (${savePageForSpideryarn.toString()})(window,${MAX_UPLOAD_BYTES},${capturePage.toString()});`;
  return `javascript:${encodeURIComponent(body)}`;
}

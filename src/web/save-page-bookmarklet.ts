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
 * Save `win`'s page as `<title>.html`. Runs in the publisher's page.
 *
 * 1. **Every address made absolute, and no `<base>`.** An upload has no
 *    address of its own, so a relative image would have nothing to resolve
 *    against. Each `src`, `href`, `poster`, `data-src` and `srcset` candidate
 *    in the copy is resolved against the live page's `document.baseURI` (which
 *    is absolute whatever the page's own `<base>` says) and written back, and
 *    every `<base>` is removed. Not a single `<base>` instead: with one, the
 *    reader resolves an in-page `#fn1` against it too, and a footnote link
 *    would point at the publisher. So an `href` starting `#` is left exactly as
 *    written, as are `javascript:`, `data:` and `mailto:` addresses and any
 *    the URL parser refuses.
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
 *      checkbox or radio, which carry Tufte-style sidenotes (src/notes.ts);
 *    - `<meta>` named as a CSRF token, by exact name.
 *    Frames (video embeds the sanitiser keeps), `<noscript>` (lazy images'
 *    fallbacks), `<textarea>` and `<select>` (visible text) stay. The page as
 *    shown is otherwise what is saved, and Help says so.
 * 4. Over the upload cap, counted in bytes, it says so and stops.
 * 5. A temporary `<a download>` on a blob URL, clicked, removed, and the URL
 *    revoked a tick later so the download has started.
 */
export function savePageForSpideryarn(win: Window & typeof globalThis, maxBytes: number): void {
  const doc = win.document;
  const base = doc.baseURI;
  const copy = doc.documentElement.cloneNode(true) as HTMLElement;

  const bases = copy.querySelectorAll("base");
  for (let i = 0; i < bases.length; i++) bases[i]!.remove();
  const absolute = (value: string): string => {
    const v = value.trim();
    if (v === "" || /^(?:javascript|data|mailto):/i.test(v)) return value;
    try {
      return new win.URL(v, base).href;
    } catch (_) {
      return value;
    }
  };
  const addressed = copy.querySelectorAll("[src], [href], [poster], [data-src], [srcset]");
  for (let i = 0; i < addressed.length; i++) {
    const el = addressed[i]!;
    const names = ["src", "href", "poster", "data-src"];
    for (let n = 0; n < names.length; n++) {
      const value = el.getAttribute(names[n]!);
      if (value === null) continue;
      if (names[n] === "href" && value.trim().charAt(0) === "#") continue;
      el.setAttribute(names[n]!, absolute(value));
    }
    const srcset = el.getAttribute("srcset");
    if (srcset !== null) {
      const candidates = srcset.split(",");
      for (let c = 0; c < candidates.length; c++) {
        const parts = candidates[c]!.trim().split(/\s+/);
        if (parts[0]) parts[0] = absolute(parts[0]);
        candidates[c] = parts.join(" ");
      }
      el.setAttribute("srcset", candidates.join(", "));
    }
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

  const scripts = copy.querySelectorAll("script");
  for (let i = 0; i < scripts.length; i++) {
    const type = (scripts[i]!.getAttribute("type") || "").trim().toLowerCase();
    if (type.indexOf("math/") !== 0 && type !== "application/ld+json") scripts[i]!.remove();
  }
  const inputs = copy.querySelectorAll("input");
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const type = (input.getAttribute("type") || "text").trim().toLowerCase();
    if (type === "hidden" || type === "password") input.remove();
    else if (type !== "checkbox" && type !== "radio") input.removeAttribute("value");
  }
  const tokenNames = ["csrf-token", "csrf-param", "csrf_token", "_csrf", "xsrf-token", "x-csrf-token"];
  const metas = copy.querySelectorAll("meta[name]");
  for (let i = 0; i < metas.length; i++) {
    const name = (metas[i]!.getAttribute("name") || "").trim().toLowerCase();
    if (tokenNames.indexOf(name) !== -1) metas[i]!.remove();
  }

  const html = `<!doctype html>\n${copy.outerHTML}`;
  const blob = new win.Blob([html], { type: "text/html" });
  if (blob.size > maxBytes) {
    win.alert(
      "This page is too big to add to Spideryarn (the limit is " +
        Math.round(maxBytes / 1048576) +
        " MB).",
    );
    return;
  }

  const title = (doc.title || "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what a filename must not carry.
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/^[\s.]+|[\s.]+$/g, "");
  const filename = `${title || "page"}.html`;

  const href = win.URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = href;
  a.download = filename;
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
  const body = `void (${savePageForSpideryarn.toString()})(window,${MAX_UPLOAD_BYTES});`;
  return `javascript:${encodeURIComponent(body)}`;
}

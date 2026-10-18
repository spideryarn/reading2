/**
 * **Where an uploaded web page says it was saved from** — the one
 * `<meta name="spideryarn-saved-from" content="…">` the "Save for Spideryarn"
 * bookmarklet writes into the file's `<head>` (src/web/save-page-bookmarklet.ts).
 *
 * Read by stage 1 for an uploaded `.html` file only (`acquireUpload` in
 * src/pipeline.ts), never for a converted one, and recorded as
 * `RawManifest.savedFrom` → `article_revisions.saved_from_url`.
 *
 * **It is a claim, and it is treated as one.** Anybody can write that meta into
 * a file, so the value is checked by `savedSource` (src/urls.ts) and then only
 * shown and matched on the uploader's own shelf. It is never fetched and never
 * a base for anything. docs/plans/261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md § Stage 3.
 */
import { jsdom } from "./jsdom-lazy.js";
import { savedSource } from "./urls.js";

/** The meta's name. The bookmarklet spells it as a literal, because it must be self-contained. */
export const SAVED_FROM_META = "spideryarn-saved-from";

/**
 * The saved-from address in `html`'s `<head>`, checked, or `null`.
 *
 * **Only the head is parsed**: the text up to the first `</head>`. The
 * bookmarklet writes its meta first in the head, so a `</head>` that appears
 * earlier inside a comment or a script costs nothing but this answer; a file
 * with no `</head>` at all has no claim. Parsed with a silent `VirtualConsole`
 * for the reason `sourceDom` in src/extract.ts gives (a dependency's errors can
 * quote the page), and with no URL, so nothing resolves against anything.
 *
 * **Exactly one** such meta, or none is taken: the bookmarklet removes any the
 * page carried and writes its own, so two means the file was made some other
 * way and neither is more believable than the other.
 */
export function savedFromInHtml(html: string): string | null {
  const end = html.search(/<\/head\s*>/i);
  if (end === -1) return null;
  const { JSDOM, VirtualConsole } = jsdom();
  const doc = new JSDOM(`${html.slice(0, end)}</head><body></body></html>`, {
    virtualConsole: new VirtualConsole(),
  }).window.document;
  const metas = [...doc.head.querySelectorAll("meta[name]")].filter(
    (m) => (m.getAttribute("name") ?? "").trim().toLowerCase() === SAVED_FROM_META,
  );
  if (metas.length !== 1) return null;
  return savedSource(metas[0]!.getAttribute("content"));
}

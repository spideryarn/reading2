/**
 * "View the original" — the reader's PDF, opened in a new tab.
 *
 * ## Why this is not an `<a href>`, which it was until 2026-08-27
 *
 * **A navigation carries no headers.** Every request to our API now needs an
 * `Authorization: Bearer` (lib/api.ts), and a plain link cannot send one — so
 * the day the gate landed these two links would have become a 401 page where
 * the reader's own document used to be. Worse, it would have looked like the
 * PDF was missing rather than like auth was working.
 *
 * The three ways out, and why this one:
 *
 *  1. *Exempt `/api/source/`.* No. It serves a stranger's uploaded file from
 *     our origin; of every route, that is the one with a body worth protecting.
 *  2. *A short-lived token in the query string.* Works, and puts a credential
 *     in an address bar, a browser history and a log line — the exact thing
 *     docs/project/logging.md redacts for and cannot redact here, because
 *     redaction matches key paths and never text.
 *  3. Fetch it with the token, then hand the tab a `blob:` URL. This.
 *
 * ## The two details that make it work
 *
 * **The tab is opened synchronously, on the click.** `window.open` after an
 * `await` is blocked by every browser, and the symptom is nothing happening at
 * all — no error, no tab, nothing to debug.
 *
 * **`opener` is nulled by hand.** The `<a>` carried `rel="noreferrer noopener"`;
 * a script-opened tab does not inherit that, and this is about to load a
 * stranger's document. Raised by GPT Sol, 2026-08-26.
 *
 * ## And it is already broken in production, for an unrelated reason
 *
 * `sendSource` in src/routes.ts reads the file off the local filesystem, which
 * Vercel does not have. So this link works locally and 404s in production until
 * source storage moves to the database. Worth knowing before anyone spends a
 * morning on it: the fix here is correct and is not what makes it work there.
 */
import { useState } from "react";

import type { Meta } from "../types.js";
import { apiFetch } from "./lib/api.js";

/**
 * **The article's own web address, or `null` when it has none.**
 *
 * Two callers ask this — the masthead and the metadata page — and they must
 * agree, because between them they decide whether the reader is offered a way
 * out to the publisher or told the article was uploaded. Two spellings of the
 * question is how those two answers come to disagree on the same article.
 *
 * It is stricter than `meta.url` in one way that matters. `npm run pdf --
 * <file.pdf>` records `url: "file:///Users/…/thing.pdf"` (src/pdf-read.ts §
 * `main`), which is not an address anybody can follow and *is* somebody's
 * home directory printed on the page. Rendered as a link it looked like a
 * source and did nothing; here it is a file, which is what it is.
 *
 * **Absence does not mean "uploaded" on its own**, and no caller may read it
 * that way. A visitor's `PublicMeta.url` is `articles.final_url` put through
 * `publicSourceUrl` (src/urls.ts), which withholds an address carrying a
 * credential — so for a visitor a `null` here is *either* an upload *or* an
 * address we would not publish, and nothing on this side can tell them apart.
 * Whoever turns a `null` into the sentence "this was uploaded" has to establish
 * the reader owns the article first; `OriginMark` in Masthead.tsx is the one
 * place that does.
 */
export function webSource(meta: Meta): string | null {
  const url = meta.url?.trim();
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

export function SourceLink({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setError(null);

    /* Synchronously, before any await. See the header. */
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;

    void (async () => {
      try {
        const res = await apiFetch(`/api/source/${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error(`The server said ${res.status}.`);
        const url = URL.createObjectURL(await res.blob());
        if (tab) tab.location.href = url;
        else window.location.href = url;
        /* Revoked on a timer rather than immediately: the tab has to have
           started loading it first, and there is no event here that says it
           has. A minute is far longer than the load and still bounds the leak. */
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        /* Close the blank tab rather than leaving the reader looking at
           about:blank wondering whether it is still loading. */
        tab?.close();
        setError(`Couldn't open the original. ${(err as Error).message} [source-open]`);
      }
    })();
  };

  return (
    <>
      {/* **A button, not an anchor with an href.**
       *
        The first version was an anchor pointing at the API route, so the element
        would look and behave like a link, cancelling the click in `onClick`. That
        is fine for an ordinary click and wrong for every other way a browser
        opens a link: middle-click, ⌘-click, "Open in new tab", "Copy link
        address" and some assistive navigation all skip the handler and hit the
        API with no `Authorization` header, giving the reader a 401 page where
        their own document should be. And `tests/no-api-hrefs.test.ts` exempted
        this component by name, so it passed the whole time. GPT Sol, 2026-08-27.
       *
        What that costs is "copy link address", which was never worth anything
        here — the URL 401s for anybody who is not signed in as you. */}
      <button type="button" onClick={open} className="tw:cursor-pointer tw:underline tw:bg-transparent tw:border-0 tw:p-0 tw:font-inherit tw:text-inherit">
        {children}
      </button>
      {error && <span className="tw:ml-2 tw:text-xs tw:text-destructive">{error}</span>}
    </>
  );
}

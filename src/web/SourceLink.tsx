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

import { apiFetch } from "./lib/api.js";

export function SourceLink({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  const open = (event: React.MouseEvent) => {
    event.preventDefault();
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
      {/* Still an `<a>` with an `href`, so it looks and behaves like a link —
          middle-click and "copy link address" will not work, which is the
          honest cost of this approach and is why the href is the API path
          rather than `#`. tests/no-api-hrefs.test.ts knows about this one. */}
      <a href={`/api/source/${encodeURIComponent(slug)}`} onClick={open}>
        {children}
      </a>
      {error && <span className="tw:ml-2 tw:text-xs tw:text-destructive">{error}</span>}
    </>
  );
}

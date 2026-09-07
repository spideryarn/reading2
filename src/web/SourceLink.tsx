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
 * ## It used to be broken in production, and that is worth knowing about
 *
 * `sendSource` in src/routes.ts read the file off the local filesystem, which
 * Vercel does not have — so this control worked on a laptop and 404d on every
 * production request, for as long as it existed. It goes through the store now
 * (`SourceStore.readPdf`), which on Postgres reads the object the revision names
 * out of Supabase Storage. Fixed 2026-08-31,
 * docs/plans/plain-mode-and-the-way-out.md § 5 and
 * docs/plans/260831b-finish-the-database-move.md § stage 1b, which arrived at
 * the same fix from two directions on the same day.
 *
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
 * It is stricter than `meta.url` in one way that matters. `npm run eval:pdf-read
 * -- <file.pdf>` records `url: "file:///Users/…/thing.pdf"` (src/pdf-read.ts §
 * `main`), which is not an address anybody can follow and *is* somebody's
 * home directory printed on the page. Rendered as a link it looked like a
 * source and did nothing; here it is a file, which is what it is.
 *
 * **It is also the URL sink's allowlist**, and that is not a second job so much
 * as the same one seen from the security side. `meta.url` is the revision's
 * `final_url`, which the fetcher validates — but an *imported* article's
 * metadata is written straight into the row, so a `javascript:` or `data:`
 * value is reachable and an unchecked `href` here would be an active sink. The
 * `https?` test refuses those for the same reason `isWebUrl` does (src/urls.ts,
 * docs/project/security.md); GPT Sol found three sinks on this field on
 * 2026-08-31 and this is what closes the two in the reading view.
 *
 * **Absence does not mean "uploaded" on its own**, and no caller may read it
 * that way. A visitor's `PublicMeta.url` is `articles.final_url` put through
 * `publicSourceUrl` (src/urls.ts), which withholds an address carrying a
 * credential — so for a visitor a `null` here is *either* an upload *or* an
 * address we would not publish, and nothing on this side can tell them apart.
 * Whoever turns a `null` into the sentence "this was uploaded" has to establish
 * the reader owns the article first; `OriginLine` in Masthead.tsx is the one
 * place that does.
 */
export function webSource(meta: Meta): string | null {
  const url = meta.url?.trim();
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * **Did this document come off the reader's own disk?** — the question the two
 * places above `webSource`'s last paragraph have to answer before they may say
 * *"you uploaded this"*.
 *
 * It was `meta.source === "pdf"` in both of them, written down twice, and it
 * was right for exactly as long as a PDF was the only thing anyone could
 * upload. A web page became one on 2026-09-07
 * (docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md) and that test then
 * had both errors at once: it says *no* about an uploaded HTML file, and it
 * asks about the **media kind** to learn the **origin** — the conflation
 * src/source.ts's own header warns against, on two axes it calls independent.
 *
 * `meta.filename` is `raw_filename`, which stage 1 writes from
 * `RawManifest.filename` and which nothing fetched ever has. So it is a fact
 * about provenance, recorded by the step that knew it.
 *
 * **The `source === "pdf"` arm stays, and is not redundant.** Every revision
 * written before `raw_filename` existed has none, and an uploaded PDF from
 * those weeks would otherwise lose a sentence it has been showing all along.
 * The two together are wrong only about a *fetched* PDF with no URL at all,
 * which is what the old test alone was wrong about too.
 *
 * **Never for a visitor.** `PublicMeta` carries neither field, deliberately —
 * see `Meta.filename`. Both callers already establish ownership first, and
 * `webSource`'s last paragraph says why that is not optional.
 */
export function cameOffADisk(meta: Meta): boolean {
  return meta.filename !== undefined || meta.source === "pdf";
}

export function SourceLink({
  slug,
  children,
  className,
  title,
  fragment,
}: {
  slug: string;
  children: React.ReactNode;
  /** Replaces the default link styling — most callers put this in a sentence. */
  className?: string;
  title?: string;
  /**
   * **Where in the document to open**, as a URL fragment without the `#` —
   * `page=7` for a PDF.
   *
   * Added 2026-09-06 for the figures in the prose: we know which page a figure
   * came from (its `data-spya-pdf-figure` marker carries it), so *view the
   * original* beside that figure can open the page it is on rather than page
   * one of a thirty-page paper. Greg asked for the control; opening it at the
   * page is what makes it worth pressing.
   *
   * **A fragment and not a query**, because that is what a PDF viewer reads:
   * `#page=N` is the PDF Open Parameters convention, honoured by Chrome's and
   * Firefox's built-in viewers. It is appended to the `blob:` URL rather than
   * sent to the server, which is the only place it *could* go — the bytes come
   * back through `apiFetch` and the tab is handed a local object URL, so the
   * server never sees it and there is nothing to validate.
   *
   * Not typed as a number or a page: a fragment is a fragment, and a caller
   * that one day wants `#nameddest=` should not have to change this signature.
   */
  fragment?: string;
}) {
  /* Said beside the button, which is where both callers want it: each of them
     sits in a paragraph, so the explanation can too. */
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
        /* The fragment goes on the address the tab is sent to, and **not** on
           the object URL we revoke below: `revokeObjectURL` matches the URL it
           was given, so a `#page=7` glued on before the revoke would leave the
           blob alive for the life of the document. */
        const at = fragment ? `${url}#${fragment}` : url;
        if (tab) tab.location.href = at;
        else window.location.href = at;
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
      <button
        type="button"
        onClick={open}
        className={
          className ??
          "tw:cursor-pointer tw:underline tw:bg-transparent tw:border-0 tw:p-0 tw:text-inherit"
        }
        {...(title === undefined ? {} : { title })}
      >
        {children}
      </button>
      {/* **`role="alert"`, because the failure is otherwise silent.** The visible
          half of a failed open is this sentence appearing and a blank tab
          closing — neither of which a screen reader announces on its own, so
          from that reader's side pressing the button did nothing at all. GPT
          Sol, second pass, 2026-08-31. */}
      {error && (
        <span role="alert" className="tw:ml-2 tw:text-xs tw:text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

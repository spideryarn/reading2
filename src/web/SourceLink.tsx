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
 * (`ArticleReader.loadSource`), which on Postgres reads the object the revision
 * names out of Supabase Storage. Fixed 2026-08-31,
 * docs/plans/plain-mode-and-the-way-out.md § 5.
 *
 */
import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";

import { hostOf, isWebUrl } from "../urls.js";
import type { Meta } from "../types.js";
import { apiFetch } from "./lib/api.js";

export function SourceLink({
  slug,
  children,
  className,
  title,
  onError,
}: {
  slug: string;
  children: React.ReactNode;
  /** Replaces the default link styling. The masthead's sentence wants a link; the controls bar wants an icon button. */
  className?: string;
  title?: string;
  /**
   * **Where the failure goes, when it must not go beside the button.**
   *
   * The default is the sentence below, which is right in the masthead: the
   * control sits in a paragraph and so does the explanation. It is wrong in the
   * controls bar, which is a fixed-height row that scrolls sideways on a phone
   * and does not shrink its children — so a sentence dropped into it either
   * pushes the granularity pills off the screen or lands past the right edge
   * where nobody will read it. GPT Sol, 2026-08-31.
   *
   * So a caller that has somewhere better to say it passes this, and takes
   * responsibility for saying it. `null` clears.
   */
  onError?: (message: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  /* One function, so the two arms cannot drift into reporting different text. */
  const report = (message: string | null) => {
    if (onError) onError(message);
    else setError(message);
  };

  const open = () => {
    report(null);

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
        report(`Couldn't open the original. ${(err as Error).message} [source-open]`);
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
          "tw:cursor-pointer tw:underline tw:bg-transparent tw:border-0 tw:p-0 tw:font-inherit tw:text-inherit"
        }
        {...(title === undefined ? {} : { title })}
      >
        {children}
      </button>
      {/* **`role="alert"`, because the failure is otherwise silent.** The visible
          half of a failed open is this sentence appearing and a blank tab
          closing — neither of which a screen reader announces on its own, so
          from that reader's side pressing the button did nothing at all. GPT
          Sol, second pass, 2026-08-31. The bar's own arm carries the same role;
          see `onError` above for why there are two places at all. */}
      {error && (
        <span role="alert" className="tw:ml-2 tw:text-xs tw:text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * **The way to the original, in the sticky bar.**
 *
 * > It should be easier to get to the original article somehow. Maybe an icon in
 * > the top bar that takes you to the original source url (maybe it becomes a
 * > download link if it was uploaded), with nice tooltips.
 * >
 * > — Greg, 2026-08-31
 *
 * ## Why the bar and not the masthead, which already has one
 *
 * The masthead's `<h1>` has been an `<a href={meta.url}>` all along, and a
 * browser pass measured why that is not an answer: it carries no `title`, no
 * `aria-label` and `text-decoration: none`, in the same `oklch(0.97 0 0)` as
 * unlinked heading text — so nothing distinguishes it from a title until you
 * happen to hover it. And the masthead scrolls away, which is the same reason
 * the About disclosure was moved out of it (Masthead.tsx).
 *
 * ## Three states, and the third is the one that matters
 *
 * A URL is a public address and anybody may follow it. An uploaded file is
 * somebody's private document, and offering it to a visitor would be a button
 * that can only fail — the rule `SeeTheOriginal` in Masthead.tsx already keeps,
 * and the reason it keeps it: *"What they cannot have is somebody else's
 * uploaded file."* An article with neither renders nothing at all rather than a
 * dimmed control, because there is no door here to advertise.
 *
 * **The URL is checked before it becomes an `href`.** `meta.url` is
 * `article_revisions.final_url`, which the fetcher validates — but an *imported*
 * article's metadata is written straight in, so a `javascript:` or `data:`
 * value is reachable and would become an active URL sink. `isWebUrl` is the
 * allowlist the rest of the app already uses for exactly this
 * (src/urls.ts, docs/project/security.md). GPT Sol raised it, 2026-08-31; the
 * masthead's own anchor was fixed in the same change.
 *
 * A `file://` source URL — which is what a PDF read off a local path carries —
 * fails that check and falls through to the download arm, which is where it
 * belongs.
 */
export function TheOriginal({
  meta,
  slug,
  owner,
  onError,
}: {
  meta: Meta;
  /** The address, not `meta.slug` — see the note on Masthead's own `slug` prop. */
  slug: string;
  owner: boolean;
  onError: (message: string | null) => void;
}) {
  if (meta.url && isWebUrl(meta.url)) {
    const host = hostOf(meta.url);
    return (
      <a
        className="source-link"
        href={meta.url}
        target="_blank"
        rel="noreferrer noopener"
        title={host ? `Open the original at ${host}` : "Open the original page"}
        aria-label="Open the original"
      >
        <ExternalLink size={14} aria-hidden />
      </a>
    );
  }

  /* Only a PDF has a file to give back, and only its owner may have it. */
  if (!owner || meta.source !== "pdf") return null;
  return (
    <SourceLink
      slug={slug}
      className="source-link"
      title={
        meta.unverified
          ? "Download the scanned pages this was transcribed from"
          : "Download the PDF this was made from"
      }
      onError={onError}
    >
      <Download size={14} aria-hidden />
    </SourceLink>
  );
}

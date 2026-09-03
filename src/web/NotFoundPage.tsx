/**
 * **An address nobody minted** — the page there was no notion of until
 * 2026-09-03.
 *
 * Greg:
 *
 * > We don't seem to have the notion of a 404 page. I tried heading to /asdf
 * > and it just took me to the homepage...
 *
 * Every unrecognised address rendered the shelf, on the documented reasoning
 * that a mistyped address lands you somewhere useful and self-explanatory
 * (router.ts § parseRoute, as it was). The cost of that is the one thing it
 * cannot do: a link that was never right, and a link that has stopped being
 * right, both fail without ever saying so — the reader is shown a plausible
 * page at an address that means nothing. docs/plans/260903j-not-found-page.md.
 *
 * ## Shaped like `NotSharedPage`, deliberately
 *
 * Same measure, same heading weight (PublicChrome.tsx). From the reader's side
 * these are two answers to one question — *why am I not looking at what I asked
 * for* — and a page that looked different would suggest a different kind of
 * problem.
 *
 * **The corner logo is the one thing not shared**, and it is App.tsx's to draw
 * rather than this file's: signed in it goes above this page like every other
 * standalone one, and signed out it does not, because it links at a shelf the
 * reader does not have. That is the same split `PrivacyPage` gets.
 *
 * ## The status code is 200, and that is a known limit
 *
 * `vercel.json` rewrites everything outside `/api/` to the static
 * `index.html`, and a static file cannot choose a status, so this page renders
 * under a 200 for every address but one. The exception is the one that arrives
 * from links: `/read/:slug` is rewritten to the serverless function, and
 * `decidePublicPage` in src/public/page.ts already answers 400 for a malformed
 * slug and 404 for one that is absent or unshared — so `/read/Upper` gets an
 * honest status *and* this page, with nothing here to do. The plan says why we
 * did not chase the rest of them, and it comes down to not putting a second
 * copy of `parseRoute` on the server.
 */
import { Link } from "./Link.js";
import { LIBRARY_HREF } from "./router.js";
import {
  NOT_FOUND,
  NOT_FOUND_HEADING,
  NOT_FOUND_TO_HOME,
  NOT_FOUND_TO_SHELF,
} from "../messages.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";

export function NotFoundPage({ signedIn }: {
  /**
   * Which word the link home uses — **not where it goes**, which is `/` either
   * way. `/` is the landing page for a stranger and the shelf for a reader who
   * has one (App.tsx), so this page never has to know where home is.
   *
   * Passed in rather than read from `useSession` here: App.tsx has already
   * answered the question by the time it renders either branch, and a second
   * subscription would be a second answer to disagree with the first.
   */
  signedIn: boolean;
}) {
  /* Its own tab, like every other terminal page. A page that sets no title
     leaves the *previous* page's standing over it — which is the bug behind the
     `not-shared` variant, found on 2026-08-30 — and here that would leave an
     article named in the tab above a page saying there is nothing at this
     address. The page itself claims nothing about any document, and the tab
     must not be the thing that does. */
  useDocumentTitle(pageTitle({ kind: "not-found" }));
  return (
    <main className="tw:mx-auto tw:max-w-xl tw:px-6 tw:pt-24 tw:font-sans">
      <h1 className="tw:m-0 tw:mb-3 tw:font-prose tw:text-2xl tw:text-foreground">
        {NOT_FOUND_HEADING}
      </h1>
      <p className="tw:m-0 tw:mb-4 tw:text-sm tw:text-ink-faint">{NOT_FOUND}</p>
      {/* **The link is the page**, and it is why this is not a bare sentence.
          The reader arrived by following or typing something wrong, so the one
          thing they need is a door — and a stranger has no corner logo above
          them to use as one (App.tsx renders this bare when nobody is signed
          in, for the reason PrivacyPage gets the same treatment: the logo links
          at a shelf they do not have). */}
      <Link href={LIBRARY_HREF} className="tw:text-sm tw:text-highlight">
        {signedIn ? NOT_FOUND_TO_SHELF : NOT_FOUND_TO_HOME}
      </Link>
      {/* No `SiteFooter`, and no sign-in controls. Both were weighed: a
          stranger who mistyped an address is a plausible reader for "what does
          this thing do", and the footer would put that one click away. But the
          page has one job — say the address is wrong, and offer the way out —
          and the front door it points at draws all of that already. Simplest
          version first (AGENTS.md); the footer is the easy thing to add if
          anybody asks. */}
    </main>
  );
}

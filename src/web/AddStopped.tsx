/**
 * **What an add address shows once another reader has signed in at it** —
 * docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md § 1.
 *
 * The add page was running for one reader, and the session became somebody
 * else's with the address still open (src/web/add-visit.ts has the rule, and
 * `App` keeps the visit). This is what is drawn instead, until the address is
 * left.
 *
 * **Its sentence has to be true for whoever reads it**, and that can be the
 * first reader, back again after somebody else was signed in: their own import
 * may be running, so it does not say that nothing was added.
 *
 * **It says nothing about what was being added, and does nothing.** No
 * address, no filename, no button, no request: every one of those would be
 * the first reader's, shown to or spent by the second. The reader adds the
 * article from the shelf, which is their own gesture.
 *
 * **It takes the tab title**, because a title outlives the page that set it:
 * `useDocumentTitle` writes `document.title` and a live region outside React,
 * and unmounting clears neither. An upload's filename would otherwise stay in
 * both (GPT Sol's F6). The hook empties the region at once and fills it with
 * the generic title.
 */
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { LIBRARY_HREF } from "./router.js";

export function AddStopped() {
  useDocumentTitle(pageTitle({ kind: "add" }));
  return (
    <main data-add-stopped className="tw:mx-auto tw:max-w-2xl tw:px-6 tw:py-10 tw:font-sans">
      <header className="tw:mb-6">
        <h1 className="tw:font-prose tw:text-2xl tw:text-foreground">This page has stopped</h1>
      </header>
      <p className="tw:m-0 tw:text-foreground">
        The account signed in here changed while this page was open, so it has stopped. To add an
        article, start from the shelf.
      </p>
      <p className="tw:mt-6 tw:mb-0 tw:text-sm">
        <Link href={LIBRARY_HREF} className="tw:text-muted-foreground tw:hover:text-highlight-text">
          ← Back to the shelf
        </Link>
      </p>
    </main>
  );
}

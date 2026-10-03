/**
 * **What the search left out, and the button that puts it back in** — one line
 * under the search's answers whenever a query is typed and Include archived or
 * Include public is off.
 *
 * > Let's add an extra button right there next to that empty-results-message
 * > for including archived (and another one for including public), so the user
 * > doesn't have to hunt around for it. For extra points, (always) include a
 * > sense of how many archived and public results would have matched, so that
 * > the user knows whether it's worth bothering to include them.
 * >
 * > — Greg, 2026-10-02 (spya-s9fhmw)
 *
 * **The buttons are the promise; the counts are the extra.** Each button is
 * drawn whenever its chip is off — at zero, while counting, after a failure —
 * and does exactly what the chip does. A number is shown only where it is
 * honest:
 *
 * - **Archived** is the server's own count of archived articles with a passage
 *   that matches (`archivedArticles` on the search answer), uncapped and by the
 *   same predicates as the passages. It is about the *text*, so it says
 *   "mention"; an archived card matching only by its title is not in it.
 * - **Public** is the public cards by other readers that the search box's card
 *   rule matches, off the same read the Include public section shows. The
 *   listing is capped, so a truncated one says "at least".
 *
 * docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md § Part D.
 */
import type { ReactNode } from "react";
import { queryTerms } from "./library-hits.js";
import type { usePublicShelf } from "./PublicLibraryPage.js";
import { filterEntries } from "./shelf-narrow.js";

/** What the archive's half knows. `null` count: not counted (yet, or at all). */
export interface ArchivedTally {
  count: number | null;
  checking: boolean;
}

export function ShelfSearchAlso({
  query,
  archivedOn,
  publicOn,
  archived,
  listing,
  listingReady,
  ownSlugs,
  narrowedElsewhere,
  onArchived,
  onPublic,
}: {
  query: string;
  archivedOn: boolean;
  publicOn: boolean;
  archived: ArchivedTally;
  /** `Library`'s one read of the public listing. */
  listing: ReturnType<typeof usePublicShelf>;
  /** The read has been allowed to start — the live owner shelf is in. */
  listingReady: boolean;
  ownSlugs: ReadonlySet<string>;
  /** Unread or a topic is on; the counts are taken before either. */
  narrowedElsewhere: boolean;
  onArchived: () => void;
  onPublic: () => void;
}) {
  const parts: ReactNode[] = [];
  let counted = false;

  if (!archivedOn) {
    let said: string | null = null;
    if (archived.count !== null) {
      counted = true;
      said =
        archived.count === 0
          ? "No archived article mentions it."
          : `${archived.count} archived ${archived.count === 1 ? "article mentions" : "articles mention"} it.`;
    } else if (archived.checking) {
      said = "Checking the archive…";
    }
    parts.push(
      <span key="archived">
        {said && <>{said} </>}
        <Act onClick={onArchived}>Include archived</Act>
      </span>,
    );
  }

  if (!publicOn) {
    let said: string | null = null;
    /* A query the card rule keeps no term of matches *every* card
       (`filterEntries`), so it is not counted at all — "every public article
       matches" would be true and useless. */
    const countable = queryTerms(query).length > 0;
    const { state } = listing;
    if (countable && listingReady && state.kind === "loaded") {
      counted = true;
      const n = filterEntries(
        state.shelf.entries.filter((e) => !ownSlugs.has(e.slug)),
        query,
      ).length;
      const capped = state.shelf.truncated;
      said =
        n === 0
          ? capped
            ? "None of the most recently shared public articles matches by title, author, site or description."
            : "No public article matches by title, author, site or description."
          : `${capped ? "At least " : ""}${n} public ${n === 1 ? "article matches" : "articles match"} by title, author, site or description.`;
    } else if (countable && listingReady && state.kind === "loading") {
      said = "Checking public articles…";
    }
    parts.push(
      <span key="public">
        {said && <>{said} </>}
        <Act onClick={onPublic}>Include public</Act>
      </span>,
    );
  }

  if (parts.length === 0) return null;
  return (
    <p data-search-also="" className="tw:mt-4 tw:flex tw:flex-wrap tw:gap-x-4 tw:gap-y-1 tw:text-sm tw:text-muted-foreground">
      {parts}
      {counted && narrowedElsewhere && <span>Counted before Unread and topics.</span>}
    </p>
  );
}

function Act({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:text-highlight-text tw:underline"
    >
      {children}
    </button>
  );
}

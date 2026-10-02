/**
 * **What other readers have shared, under your own shelf** — the half of the
 * page the Include public chip turns on.
 *
 * > We have a button to include archived when displaying stuff in the shelf and
 * > searching the shelf. Perhaps let's also have a button for include public.
 * > … be able to include public for everybody they want, including in
 * > searching, etc.
 * >
 * > — Greg, 2026-10-01 (spya-yy5x66)
 *
 * **Its own section, not rows in the shelf's one list**, and that is the v1's
 * one real decision. The archive could join the list (plan 260929a) because an
 * archived article is still *yours*: it has opens, a rename, Put back. A public
 * article has none of that, so a row for it would be a `ShelfCard` with every
 * owner verb switched off — the design public-shelf.md § The parts rejected for
 * the public page's card. So this draws `PublicCard`, the public page's own,
 * and the same anonymous read (`usePublicShelf`) that page makes: no new route,
 * no new query, nothing new in the public import graph.
 *
 * The results child is mounted only while the chip is on and a live owner
 * shelf has established whose slugs must be removed, so the public read happens
 * only then. A saved shelf copy may paint the owner's cards but cannot make
 * that ownership claim.
 *
 * docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md § Part A.
 */
import { useMemo } from "react";
import { PUBLIC_SHELF_FAILED, PUBLIC_SHELF_RETRY } from "../messages.js";
import { PublicCard, usePublicShelf } from "./PublicLibraryPage.js";
import { filterEntries } from "./shelf-narrow.js";
import { useSlow } from "./useSlow.js";

export function ShelfPublicSection({
  enabled,
  ownerLoaded,
  ownerReady,
  ...props
}: ShelfPublicProps & {
  enabled: boolean;
  ownerLoaded: boolean;
  ownerReady: boolean;
}) {
  if (!enabled || !ownerLoaded) return null;
  if (!ownerReady) {
    return (
      <p role="status" className="tw:mt-10 tw:text-sm tw:text-muted-foreground">
        Shared articles will appear once your shelf is up to date.
      </p>
    );
  }
  return <ShelfPublicResults {...props} />;
}

interface ShelfPublicProps {
  /** The shelf's search box — the one narrowing that applies here. */
  query: string;
  /**
   * Every slug already on the shelf above. **Your own public articles are left
   * out here**, because they are already up there with your verbs on them, and
   * a second copy without them would read as somebody else's.
   */
  ownSlugs: ReadonlySet<string>;
  /**
   * Unread or a topic is on. Neither applies here — both are facts about *your*
   * reading — so the section says so rather than looking unnarrowed by mistake.
   */
  narrowedElsewhere: boolean;
}

function ShelfPublicResults({
  query,
  ownSlugs,
  narrowedElsewhere,
}: ShelfPublicProps) {
  const { state, again } = usePublicShelf();
  const slow = useSlow(state.kind === "loading");

  const others = useMemo(
    () =>
      state.kind === "loaded" ? state.shelf.entries.filter((e) => !ownSlugs.has(e.slug)) : [],
    [state, ownSlugs],
  );
  const shown = useMemo(() => filterEntries(others, query), [others, query]);
  const searching = query.trim() !== "";

  return (
    <section aria-labelledby="shelf-public-heading" className="tw:mt-10">
      <h2
        id="shelf-public-heading"
        className="tw:mb-1 tw:font-sans tw:text-base tw:font-semibold tw:text-foreground"
      >
        Shared by other readers
      </h2>
      <p className="tw:mt-0 tw:mb-4 tw:text-sm tw:text-muted-foreground">
        {/* What narrows this list, and what does not — said every time,
            because a search box that silently skips half of what it seems to
            cover reads as a broken search. */}
        {searching
          ? "Matched on title, author, site and description; the text of these articles isn't searched."
          : "Articles other readers have made public. The search box above narrows these too."}
        {narrowedElsewhere && " Unread and topics apply to your own articles only."}
      </p>

      {slow && <p className="tw:text-sm tw:text-muted-foreground">Reading the public shelf…</p>}

      {state.kind === "failed" && (
        <p role="alert" className="tw:text-sm tw:text-foreground">
          {PUBLIC_SHELF_FAILED}{" "}
          <button
            type="button"
            onClick={again}
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:text-highlight tw:underline"
          >
            {PUBLIC_SHELF_RETRY}
          </button>
        </p>
      )}

      {state.kind === "loaded" && shown.length === 0 && (
        <p className="tw:text-sm tw:text-muted-foreground">
          {others.length > 0
            ? `No public article matches “${query.trim()}”.`
            : state.shelf.truncated
              ? /* Every row we were sent is yours, and there are more we were
                   not sent — so "nobody else" would be a claim about rows we
                   never saw. */
                "None of the most recently shared articles is somebody else's."
              : "Nobody else has shared anything yet."}
        </p>
      )}

      {shown.length > 0 && (
        // biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics from a `ul` whose `list-style` is `none` — PublicLibraryPage.tsx's reason
        <ul role="list" className="tw:m-0 tw:grid tw:list-none tw:gap-4 tw:p-0 tw:sm:grid-cols-2">
          {shown.map((entry) => (
            <li key={entry.slug} className="tw:m-0">
              <PublicCard entry={entry} />
            </li>
          ))}
        </ul>
      )}

      {/* **The cap, and what it does to the search.** The listing is the
          newest shared articles up to a ceiling, and this filters it in the
          browser — so past the ceiling an older article that matches is
          simply not here, and "no match" would be false. Not
          `PUBLIC_SHELF_TRUNCATED`, which says the *page* is capped and not
          that the *search* was. GPT Sol, plan review, 2026-10-02. */}
      {state.kind === "loaded" && state.shelf.truncated && (
        <p className="tw:mt-6 tw:text-sm tw:text-muted-foreground">
          There are more shared articles than this lists. Only the most recently shared are shown
          {searching ? " and searched" : ""} here.
        </p>
      )}
    </section>
  );
}

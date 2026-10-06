/**
 * **The add page's Sharing section** — one row under High-powered AI, shut by
 * default, holding *Make it public* (AddShare.tsx) and *Create a private
 * link* (AddShareLink.tsx).
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § Stage 2, 2b. Greg, 2026-10-06:
 *
 * > perhaps bundle all sharing-related stuff in a default-collapsed section,
 * > because most people won't want to use it
 *
 * ## What shut may hide, and what it may not
 *
 * A shut section hides two controls nobody has touched. It must never hide a
 * question, a refusal or a state we cannot vouch for, and it must never leave
 * an article public, or a link live, behind a row that says nothing. So:
 *
 *  - **Unsettled is open, and cannot be shut.** While either control is
 *    asking, waiting, saving, refused or unknown (`shareUnsettled`,
 *    `linkUnsettled`: the same test that keeps the page from leaving by
 *    itself), the row is a heading and not a button. That includes the
 *    reload warning of *Make it public*. Derived every render and never
 *    latched, for the reason PageSection.tsx gives at length: a section that
 *    latched shut is where the error went.
 *  - **On is open until the reader shuts it**, and shut, the row names what
 *    is on (`sharingAtAddSummary`).
 *  - **Shut unmounts both controls**, so a private link's key is not in the
 *    page while the section is shut. The controllers are the add page's and
 *    go on whatever is drawn.
 *
 * The reader's own toggle is local state: a shut section is not somewhere
 * you were (PageSection.tsx says why it is not in the address). The add page
 * keys this component on the slug, so another article starts shut.
 *
 * ## Over an article already on the shelf
 *
 * No row and no control: the one line saying where to share it, as stage 1
 * drew it. Both controllers ask the same probe, so they agree.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";

import { SHARE_AT_ADD_ALREADY_AN_ARTICLE, sharingAtAddSummary } from "../messages.js";
import { type LinkAtAdd, linkUnsettled } from "./add-share-link.js";
import { type ShareAtAdd, shareUnsettled } from "./add-share.js";
import { AddShare, shareDraws } from "./AddShare.js";
import { AddShareLink, linkDraws } from "./AddShareLink.js";

export function AddSharing({
  share,
  link,
  offer,
}: {
  share: ShareAtAdd;
  link: LinkAtAdd;
  /**
   * Whether the add is at a point where the page offers its boxes
   * (AddShare.tsx § `offer`). Outside it the section is drawn only for a
   * control the reader has acted on.
   */
  offer: boolean;
}) {
  const shared = useSyncExternalStore(share.subscribe, share.get);
  const linked = useSyncExternalStore(link.subscribe, link.get);
  /** The reader's own press on the row, or `null` before there has been one. */
  const [chosen, setChosen] = useState<boolean | null>(null);
  const unsettled = shareUnsettled(shared) || linkUnsettled(linked);
  /* A section that opened itself stays open when the matter settles, until
     the reader shuts it: unticking a box should not fold the box away. This
     only records it; what forces the section open is derived below. */
  useEffect(() => {
    if (unsettled) setChosen(true);
  }, [unsettled]);

  if (shared.kind === "adopted" || linked.kind === "adopted") {
    return offer ? (
      <p data-add-share="adopted" className="tw:mt-3 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        {SHARE_AT_ADD_ALREADY_AN_ARTICLE}
      </p>
    ) : null;
  }
  if (!shareDraws(shared, offer) && !linkDraws(linked, offer)) return null;

  const isPublic = shared.kind === "on";
  const linkOn = linked.kind === "on";
  const open = unsettled || (chosen ?? (isPublic || linkOn));
  const summary = sharingAtAddSummary(isPublic, linkOn);

  return (
    <section data-add-sharing data-open={open} className="tw:mt-3 tw:text-sm">
      {unsettled ? (
        /* Not a control while it may not be shut: a button that did nothing
           would be worse than no button. */
        <h2 className="tw:m-0 tw:flex tw:h-7 tw:items-center tw:gap-1.5 tw:text-xs tw:font-normal tw:text-muted-foreground">
          <ChevronRight size={13} className="tw:rotate-90" />
          {summary}
        </h2>
      ) : (
        /* The disclosure the shelf's *earlier imports* wears (AddArticle.tsx):
           a chevron that turns, `-ml-2` so the label stays on the margin, and
           the page's one small-control height. */
        <button
          type="button"
          data-add-sharing-toggle
          aria-expanded={open}
          onClick={() => setChosen(!open)}
          className="tw:-ml-2 tw:inline-flex tw:h-7 tw:items-center tw:gap-1.5 tw:rounded-md tw:bg-transparent tw:px-2 tw:text-xs tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground"
        >
          <ChevronRight size={13} className={`tw:transition-transform ${open ? "tw:rotate-90" : ""}`} />
          {summary}
        </button>
      )}
      {open && (
        <div className="tw:pl-5">
          <AddShare share={share} offer={offer} />
          <AddShareLink link={link} offer={offer} alsoPublic={isPublic} />
        </div>
      )}
    </section>
  );
}

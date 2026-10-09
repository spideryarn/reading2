/**
 * **The add page's Sharing section** — one row under High-powered AI, shut by
 * default, holding *Create a private link* (AddShareLink.tsx) and then *Make
 * it public* (AddShare.tsx): the Metadata card's order, the less exposed
 * first.
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
 * ## Said as a state, and saying where to learn more (2026-10-09)
 *
 * Plan 261009i (spya-nsrkju), after five critics read the page in character.
 * The row was the quietest thing on it, `text-xs` and grey, and a bare
 * *Sharing* read as the next step rather than as a setting that is off. It is
 * now the page's body size, names a state only when one is on, with an icon
 * as well as words (`sharingAtAddSummary` says why it never says *off*), and
 * the open section starts with what every article starts as, that nothing
 * goes out unconfirmed, that it can wait for the Metadata page, and a link to
 * Help.
 *
 * ## Over an article already on the shelf
 *
 * No row and no control: the one line saying where to share it, as stage 1
 * drew it. Both controllers ask the same probe, so they agree.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronRight, Globe, Link2 } from "lucide-react";

import {
  SHARE_AT_ADD_ALREADY_AN_ARTICLE,
  SHARING_AT_ADD_HELP,
  SHARING_AT_ADD_INTRO,
  sharingAtAddSummary,
} from "../messages.js";
import { helpHref } from "./help/help-anchors.js";
import { Link } from "./Link.js";
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
   * Whether the add is at a point where the page offers its controls
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
     the reader shuts it: cancelling or turning a share off should not fold the section away. This
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
  /* An on state in a shape as well as in words: public wins, as it does for
     who can read the article. Nothing for the rest, whose summary claims no
     state (no padlock: `sharingAtAddSummary` says why). */
  const StateIcon = isPublic ? Globe : linkOn ? Link2 : null;

  return (
    <section data-add-sharing data-open={open} className="tw:mt-3 tw:text-sm">
      {unsettled ? (
        /* Not a control while it may not be shut: a button that did nothing
           would be worse than no button. */
        <h2 className="tw:m-0 tw:flex tw:h-7 tw:items-center tw:gap-1.5 tw:text-sm tw:font-normal tw:text-foreground">
          <ChevronRight size={13} className="tw:rotate-90 tw:text-ink-faint" />
          {StateIcon && <StateIcon size={13} className="tw:text-ink-faint" />}
          {summary}
        </h2>
      ) : (
        /* The disclosure the shelf's *earlier imports* wears (AddArticle.tsx):
           a chevron that turns, `-ml-2` so the label stays on the margin, and
           the page's one small-control height. */
        /* The button stays inside an h2, as PageSection's disclosure does, so
           opening and closing the section never changes the page outline. */
        <h2 className="tw:m-0 tw:text-sm tw:font-normal">
          <button
            type="button"
            data-add-sharing-toggle
            aria-expanded={open}
            onClick={() => setChosen(!open)}
            className="tw:-ml-2 tw:inline-flex tw:h-7 tw:items-center tw:gap-1.5 tw:rounded-md tw:bg-transparent tw:px-2 tw:text-sm tw:text-foreground tw:transition-colors tw:hover:bg-highlight/10"
          >
            <ChevronRight
              size={13}
              className={`tw:text-ink-faint tw:transition-transform ${open ? "tw:rotate-90" : ""}`}
            />
            {StateIcon && <StateIcon size={13} className="tw:text-ink-faint" />}
            {summary}
          </button>
        </h2>
      )}
      {open && (
        <div className="tw:pl-5">
          <p data-add-sharing-intro className="tw:mt-1 tw:mb-0 tw:text-muted-foreground">
            {SHARING_AT_ADD_INTRO}{" "}
            <Link href={helpHref("sharing")} className="tw:text-highlight-text tw:underline">
              {SHARING_AT_ADD_HELP}
            </Link>
          </p>
          <AddShareLink link={link} offer={offer} alsoPublic={isPublic} />
          <AddShare share={share} offer={offer} />
        </div>
      )}
    </section>
  );
}

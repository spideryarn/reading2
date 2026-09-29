/**
 * **The piece's authors, one at a time** — a name you can point at to see
 * where they work, and click to find everything else of theirs on your shelf.
 *
 * Greg, 2026-09-29: *"for extra points, we'd add rich tooltips (as per
 * tooltips.md) to the author name, and clicking it would somehow take us to a
 * list (e.g. a filtered list on the homepage-shelf) of other stuff by [that
 * author]."*
 *
 * **The list is the shelf's own search**, `/?q=<name>`: it already lives in the
 * URL, already reads the byline, and is AND-of-substrings, so "Samuel A.
 * Nastase" finds every card whose byline names him that way. No second way of
 * narrowing the shelf. One person spelt two ways on two articles is two
 * searches — plan 260929d § Not in this plan.
 *
 * Only drawn from `meta.authors`. With no list the byline is shown as the
 * string it always was, because splitting a free-text byline into people is a
 * guess this component is not entitled to make.
 *
 * docs/plans/260929d-authors-and-affiliations-at-import-shown-and-linked.md § 4.
 */
import { useState } from "react";
import type { Author } from "../types.js";
import { Link } from "./Link.js";
import { LIBRARY_HREF } from "./router.js";
import { TipNote, Tooltip } from "./Tooltip.js";

/** How many names before the rest fold behind "+ N more". */
export const AUTHORS_SHOWN = 3;

/**
 * The shelf, searched for one author's name — **its words, without the
 * punctuation or the initials.**
 *
 * The shelf's search keeps punctuation in a term (src/web/library-hits.ts §
 * `queryTerms`), so the name as written, `Samuel A. Nastase`, would miss the
 * same man on a card that says `Samuel A Nastase` or `Nastase, Samuel A.`, and
 * `Yun-Fei Liu` would miss `Yun Fei Liu`. His words alone — `Samuel Nastase`,
 * `Yun Fei Liu` — are found in all of those, since each term is a substring
 * and their order does not matter. An initial on its own would be a
 * one-letter term, which the search drops anyway. GPT Sol, plan review of
 * 260929d, P1.
 */
export function shelfHrefFor(name: string): string {
  const query = name
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((w) => [...w].length >= 2)
    .join(" ");
  return `${LIBRARY_HREF}?q=${encodeURIComponent(query || name)}`;
}

interface Props {
  authors: readonly Author[];
  /**
   * **Whether a name is a link to the shelf.** The owner's shelf is theirs; a
   * visitor reading a shared article has a different one or none, so for them
   * the name is only a name with its card. Same *is this yours* stand-in the
   * masthead uses everywhere (`onRenamed !== undefined`).
   */
  linkToShelf: boolean;
  /** Show every name at once — the Metadata page, where there is room. */
  all?: boolean;
}

/** The names, comma-separated, each with its card. */
export function AuthorNames({ authors, linkToShelf, all = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const canFold = !all && authors.length > AUTHORS_SHOWN + 1;
  const shown = canFold && !expanded ? authors.slice(0, AUTHORS_SHOWN) : authors;
  const hidden = authors.length - AUTHORS_SHOWN;
  return (
    <span className="author-names" data-testid="author-names">
      {shown.map((author, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two authors can share a name; order is the identity
        <span key={i}>
          {i > 0 && ", "}
          <AuthorName author={author} linkToShelf={linkToShelf} />
        </span>
      ))}
      {canFold && (
        <>
          {" "}
          <button
            type="button"
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:font-[inherit] tw:text-[inherit] tw:text-ink-faint tw:underline tw:decoration-dotted tw:hover:text-highlight"
            aria-expanded={expanded}
            aria-label={expanded ? "Show fewer authors" : `Show ${hidden} more authors`}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Show fewer" : `+ ${hidden} more`}
          </button>
        </>
      )}
    </span>
  );
}

/** One name, and the card that says who they are. */
function AuthorName({ author, linkToShelf }: { author: Author; linkToShelf: boolean }) {
  const card = (
    <span className="tw:block tw:max-w-80">
      <span className="tw:block tw:text-sm tw:font-semibold">{author.name}</span>
      {author.affiliations.map((a, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static list, order is the identity
        <TipNote key={i}>{a}</TipNote>
      ))}
      {linkToShelf && (
        <span className="tw:mt-1 tw:block tw:text-xs tw:text-ink-faint">
          Click for everything on your shelf by {author.name}.
        </span>
      )}
    </span>
  );
  /* A visitor's name still needs to be focusable, or the card is mouse-only. */
  const trigger = linkToShelf ? (
    <Link href={shelfHrefFor(author.name)} className="author-name">
      {author.name}
    </Link>
  ) : (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the card is the content, and a keyboard has to reach it
    <span tabIndex={0} className="author-name">
      {author.name}
    </span>
  );
  return (
    <Tooltip placement="bottom" keepSide content={card}>
      {trigger}
    </Tooltip>
  );
}

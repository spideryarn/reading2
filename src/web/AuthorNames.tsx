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
 * The card also carries two outside searches for the author, Scholar and the
 * web, so it is a card the pointer can enter (`interactive`) — plan 261003f.
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

/** The longest affiliation hint a web search carries, cut at a word. */
const AFFILIATION_HINT = 80;

/** Text fit for a search: no quote marks of its own (they would close the
    quotes around a name), one line. */
function unquoted(text: string): string {
  return text
    .replace(/["“”„‟«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first affiliation, short enough to be a hint: whole words up to `AFFILIATION_HINT`. */
function affiliationHint(author: Author): string {
  const first = [...unquoted(author.affiliations[0] ?? "")];
  if (first.length <= AFFILIATION_HINT) return first.join("");
  const cut = first.slice(0, AFFILIATION_HINT + 1).join("");
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : first.slice(0, AFFILIATION_HINT).join("")).replace(/[\s,;:]+$/, "");
}

/**
 * **Where to find out more about one author, off the site** — Greg, 2026-09-12
 * (spya-uvxq8e): *"something I could click on or expand that would take me to
 * the top few links for them."*
 *
 * Two searches, never a guessed address. Scholar's `author:` operator lists
 * their papers, with a matching public profile first when Scholar has one; the
 * web search adds the first affiliation, unquoted, to tell them from someone
 * else of the same name. Plan 261003f.
 */
export function authorSearchLinks(author: Author): { scholar: string; web: string } {
  const name = unquoted(author.name);
  const hint = affiliationHint(author);
  const web = hint ? `"${name}" ${hint}` : `"${name}"`;
  return {
    scholar: `https://scholar.google.com/scholar?q=${encodeURIComponent(`author:"${name}"`)}`,
    web: `https://www.google.com/search?q=${encodeURIComponent(web)}`,
  };
}

/**
 * The two searches, inline: in the masthead's card, and under each name on the
 * Metadata page. A new tab, and `noreferrer`, so Google is told the name and
 * not which article the reader is in.
 */
export function AuthorSearchLinks({ author }: { author: Author }) {
  const links = authorSearchLinks(author);
  return (
    <span className="tw:mt-1 tw:block tw:text-xs tw:text-ink-faint" data-testid="author-out">
      Find out more:{" "}
      <a href={links.scholar} target="_blank" rel="noreferrer noopener" aria-label={`${author.name} on Google Scholar`}>
        Google Scholar
      </a>
      {" · "}
      <a href={links.web} target="_blank" rel="noreferrer noopener" aria-label={`Search the web for ${author.name}`}>
        Web search
      </a>
    </span>
  );
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
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:font-[inherit] tw:text-[inherit] tw:text-ink-faint tw:underline tw:decoration-dotted tw:hover:text-highlight-text"
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
      <AuthorSearchLinks author={author} />
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
    <Tooltip placement="bottom" keepSide content={card} interactive={{ label: `About ${author.name}` }}>
      {trigger}
    </Tooltip>
  );
}
